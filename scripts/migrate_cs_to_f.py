#!/usr/bin/env python3
"""Suhteline `<cs>` → absoluutne `<f>` (ADR 0077, punkt 6).

Teisendus on `server.script_migration.cs_to_f` — SAMA funktsioon, mida
kasutavad ajaloo taastamine ja vana mudeli väljundi import.

Teose põhikiri:
  - käsitsi otsus (`--decisions otsused.json`, `{"work_id": "F" | "A"}`) võidab;
  - muidu rea lõpu poolitusmärgist (`infer_base`), kui signaal on ühene;
  - signaalita või vastuoluga teos, millel on `<cs>`, jääb VAHELE ja läheb
    aruandesse rühma „otsustamata" — inimene vaatab pildi ja lisab otsuse.
Antiikvateos ilma `<cs>`-ita ei muutu (ümbernimetamisel pole midagi teha).

Teisendatuse tunnus on MANIFEST (`data/config/migrations/0077-f.json`), mitte
`<f>`-i olemasolu: korduskäivitus puudutab ainult lehte, mille praegune räsi ei
ole manifestis väljundina, ja ka siis ainult `<cs>`-iga lehte (vana mudeli väljund).
Manifest commititakse teose lehtedega SAMAS commitis (autor „Automaatne"), nii
et katkenud jooks ei jäta teisendatud lehte manifestita.

Skript jookseb eraldi protsessis — CAS: leht loetakse vahetult enne kirjutust
uuesti ja kui ta on muutunud, jäetakse vahele (nagu `migrate_macron_corpus.py`).

ENNE --apply (ADR 0077 p 6.1), serveris:
  cd ~/VUTT/data && git tag pre-0077-f
  tar czf ~/vutt-pre-0077-f-$(date +%F).tar.gz --exclude='*.jpg' -C ~/VUTT data
Rakendus vaiksel ajal; toimetajate vananenud seansid kaitseb `/save` 409.

Kasutus (serveris, KONTEINERIST — `data/` git commitib root'ina):
  docker exec vutt-backend python3 scripts/migrate_cs_to_f.py                        # kuivkäivitus
  docker exec vutt-backend python3 scripts/migrate_cs_to_f.py --apply --decisions /data/otsused.json
  docker exec vutt-backend python3 scripts/migrate_cs_to_f.py --check                # <cs> jääke?
"""
import argparse
import glob
import json
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server.script_migration import (  # noqa: E402
    MANIFEST_PATH, cs_to_f, infer_base, load_manifest, text_hash,
)


def page_txts(work_dir: str):
    """Lehekülgede .txt-d (pildiga paar) — muud .txt-d ei ole lehed."""
    out = []
    for txt in sorted(glob.glob(os.path.join(work_dir, "*.txt"))):
        if os.path.exists(os.path.splitext(txt)[0] + ".jpg"):
            out.append(txt)
    return out


def read(path: str) -> str:
    with open(path, encoding="utf-8") as f:
        return f.read()


def plan_work(work_id: str, texts: dict, decision, entry):
    """Puhas plaan ühele teosele.

    texts: {failinimi: tekst}; decision: 'F'|'A'|None; entry: manifesti kirje või None.
    Tagastab (staatus, põhikiri, päritolu, {failinimi: uus}, signaal).
    staatus: 'convert' | 'noop' | 'undecided' | 'no_signal'.
    """
    has_cs = any("<cs>" in t for t in texts.values())
    if entry:
        base = entry["base"]
        pages = entry.get("pages", {})
        plans = {}
        for fn, t in texts.items():
            if pages.get(fn, {}).get("out") == text_hash(t):
                continue  # juba teisendatud ja muutmata
            if "<cs>" in t:
                plans[fn] = cs_to_f(t, base)
        return ("convert" if plans else "noop"), base, entry.get("source"), plans, None

    inferred, f, a = infer_base(texts.values())
    if decision:
        base, source = decision, "käsitsi"
    elif inferred:
        base, source = inferred, "signaal"
    else:
        if has_cs:
            return "undecided", None, None, {}, (f, a)
        return "no_signal", None, None, {}, (f, a)
    if base == "A" and not has_cs:
        return "noop", base, source, {}, (f, a)
    plans = {fn: cs_to_f(t, base) for fn, t in texts.items()}
    return "convert", base, source, plans, (f, a)


def apply_work(work_dir: str, work_id: str, base: str, source: str,
               originals: dict, plans: dict, manifest: dict) -> dict:
    """Kirjutab teose lehed + manifesti ÜHE commitiga. Tagastab {'written', 'raced', 'commit'}."""
    from server.git_ops import save_with_git
    from server.page_locks import page_lock
    from server.reocr_apply import _reconcile_annotations

    from datetime import datetime, timezone
    # `migrated_at` (enne commitit): ajaloo taastamine teisendab sellest vanema
    # versiooni (ADR 0077 p 7). Commiti räsi manifest kanda ei saa — ta commititakse
    # samas commitis.
    entry = manifest["works"].setdefault(work_id, {
        "base": base, "source": source, "slug": os.path.basename(work_dir), "pages": {},
        "migrated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    })
    writes, raced, page_records = [], [], {}
    for fn, new in plans.items():
        txt = os.path.join(work_dir, fn)
        with page_lock(txt):
            if read(txt) != originals[fn]:
                raced.append(fn)  # toimetaja salvestas vahepeal
                continue
            text, json_write = _reconcile_annotations(work_dir, fn, new)
            page_records[fn] = {"in": text_hash(originals[fn]), "out": text_hash(text)}
            if text != originals[fn]:
                writes.append((txt, text))
                if json_write:
                    writes.append(json_write)
    entry["pages"].update(page_records)
    manifest_write = (MANIFEST_PATH, json.dumps(manifest, ensure_ascii=False, indent=2))
    n_pages = sum(1 for p, _ in writes if p.endswith(".txt"))
    os.makedirs(os.path.dirname(MANIFEST_PATH), exist_ok=True)
    if not writes and not page_records:
        return {"written": 0, "raced": raced, "commit": None}  # kõik muutusid vahepeal
    if not writes:
        # Ainult manifest (nt antiikvaleht, mis ei muutunud): kirje peab siiski jääma.
        res = save_with_git(MANIFEST_PATH, manifest_write[1], "Automaatne",
                            message=f"Fraktuur <f>: manifest {work_id} (ADR 0077)")
    else:
        first, first_text = writes[0]
        res = save_with_git(first, first_text, "Automaatne",
                            message=f"Fraktuur: <cs> → <f>, {n_pages} lehte, põhikiri {base} (ADR 0077)",
                            additional_files=writes[1:] + [manifest_write])
    return {"written": n_pages, "raced": raced, "commit": (res.get("commit_hash") or "")[:8]}


def check(base_dir: str) -> int:
    left = []
    for meta_path in sorted(glob.glob(os.path.join(base_dir, "*", "_metadata.json"))):
        for txt in page_txts(os.path.dirname(meta_path)):
            if "<cs>" in read(txt):
                left.append(os.path.relpath(txt, base_dir))
    for p in left:
        print(p)
    print(f"<cs>-iga lehti: {len(left)}")
    return 1 if left else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="kirjuta (vaikimisi kuivkäivitus)")
    ap.add_argument("--decisions", help='käsitsi otsused JSON: {"work_id": "F"|"A"}')
    ap.add_argument("--work", action="append", default=[], help="ainult see work_id (korduv)")
    ap.add_argument("--check", action="store_true", help="loetle <cs>-iga lehed (valvur pärast üleminekut)")
    ap.add_argument("--report", default="/tmp/cs_to_f_aruanne.json", help="aruande JSON")
    args = ap.parse_args()

    from server.config import BASE_DIR

    if args.check:
        return check(BASE_DIR)

    decisions = {}
    if args.decisions:
        with open(args.decisions, encoding="utf-8") as f:
            decisions = {k: v.upper() for k, v in json.load(f).items()}
        bad = {k: v for k, v in decisions.items() if v not in ("F", "A")}
        if bad:
            print(f"Vigased otsused (lubatud F|A): {bad}")
            return 2

    manifest = load_manifest()
    totals = Counter()
    report = {"fraktur": {}, "antiqua": {}, "undecided": {}, "no_signal": 0, "italic_in_fraktur": {}, "raced": {}}
    for meta_path in sorted(glob.glob(os.path.join(BASE_DIR, "*", "_metadata.json"))):
        work_dir = os.path.dirname(meta_path)
        try:
            work_id = json.load(open(meta_path, encoding="utf-8")).get("id")
        except (OSError, ValueError):
            continue
        if not work_id or (args.work and work_id not in args.work):
            continue
        texts = {os.path.basename(t): read(t) for t in page_txts(work_dir)}
        status, base, source, plans, signal = plan_work(
            work_id, texts, decisions.get(work_id), manifest["works"].get(work_id))
        slug = os.path.basename(work_dir)
        if status == "undecided":
            report["undecided"][work_id] = {"slug": slug, "signal_F": signal[0], "signal_A": signal[1],
                                            "cs_pages": sum("<cs>" in t for t in texts.values())}
            continue
        if status == "no_signal":
            report["no_signal"] += 1
            continue
        if status == "noop":
            continue
        changed = {fn: new for fn, new in plans.items() if new != texts[fn]}
        group = "fraktur" if base == "F" else "antiqua"
        report[group][work_id] = {"slug": slug, "source": source, "pages": len(changed),
                                  "signal": list(signal) if signal else None}
        if base == "F":
            n_i = sum(t.count("<i>") for t in texts.values())
            if n_i:
                report["italic_in_fraktur"][work_id] = {"slug": slug, "i": n_i}
        totals[f"{group}_works"] += 1
        totals[f"{group}_pages"] += len(changed)
        if args.apply:
            res = apply_work(work_dir, work_id, base, source, texts, plans, manifest)
            if res["raced"]:
                report["raced"][work_id] = res["raced"]
            if res["written"]:
                from server.meilisearch_ops import sync_work_to_meilisearch
                sync_work_to_meilisearch(slug)
            print(f"{work_id} ({base}): {res['written']} lehte, commit {res['commit']}"
                  + (f", VAHELE (muutus vahepeal): {res['raced']}" if res["raced"] else ""))

    with open(args.report, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    print(f"Antiikvateosed (<cs> → <f>): {totals['antiqua_works']} teost, {totals['antiqua_pages']} lehte")
    print(f"Fraktuurteosed (ümberpööramine): {totals['fraktur_works']} teost, {totals['fraktur_pages']} lehte")
    print(f"Otsustamata (<cs> + signaalita/vastuoluga): {len(report['undecided'])} teost — vaja --decisions")
    print(f"<i> fraktuurteostes (vaata üle): {len(report['italic_in_fraktur'])} teost")
    print(f"Signaalita ja <cs>-ita (ei muutu): {report['no_signal']} teost")
    print("(kuivkäivitus, --apply kirjutab)" if not args.apply else f"Vahele (muutus vahepeal): {len(report['raced'])} teost")
    print(f"Aruanne: {args.report}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
