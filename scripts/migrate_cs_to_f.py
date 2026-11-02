#!/usr/bin/env python3
"""Suhteline `<cs>` → absoluutne `<f>` (ADR 0077, punkt 6).

Teisendus on `server.script_migration.cs_to_f` — SAMA funktsioon, mida
kasutavad ajaloo taastamine ja vana mudeli väljundi import.

Teose põhikiri:
  - käsitsi otsus (`--decisions otsused.json`, `{"work_id": "F" | "A" | "P"}`) võidab;
    `P` = segateos (nt ladina osad antiikvas, saksa/rootsi fraktuuris): `<cs>` oli
    märgitud LEHE põhikirja suhtes, põhikiri tuleb lehe poolitusmärgist; signaalita
    leht jääb vahele ja aruandesse, kuni ta saab otsuse võtmega `"work_id/leht.txt"`;
  - muidu rea lõpu poolitusmärgist (`infer_base`), kui signaal on ühene;
  - signaalita või vastuoluga teos, millel on `<cs>`, jääb VAHELE ja läheb
    aruandesse rühma „otsustamata" — inimene vaatab pildi ja lisab otsuse.
Antiikvateos ilma `<cs>`-ita ei muutu (ümbernimetamisel pole midagi teha).
Käsikiri (`type` Q87167) jääb VÄLJA: `<f>` on trükise märgend (ADR 0077 p 3). Käsikirja
`<cs>` (ladina kiri Kurrendi sees) läheb aruandesse rühma „manuscript"; `--manuscript-cs strip`
eemaldab tägid (tekst jääb), `hi` asendab nad esiletõstuga `<hi>` (kasutaja otsus
2026-11-02: kolm nime jäävad leitavaks), vaikimisi ei puudutata.

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


def page_base(work_base: str, fn: str, text: str, page_decisions: dict):
    """Lehe põhikiri: teose oma; segateosel (`P`) lehe otsus või lehe signaal (None = teadmata)."""
    if work_base != "P":
        return work_base
    return page_decisions.get(fn) or infer_base([text])[0]


def plan_work(work_id: str, texts: dict, decision, entry, page_decisions=None):
    """Puhas plaan ühele teosele.

    texts: {failinimi: tekst}; decision: 'F'|'A'|'P'|None; entry: manifesti kirje või None;
    page_decisions: {failinimi: 'F'|'A'} segateose signaalita lehtedele.
    Tagastab (staatus, põhikiri, päritolu, {failinimi: uus}, signaal); segateosel on
    signaal asemel {'unresolved': [failinimed]}.
    staatus: 'convert' | 'noop' | 'undecided' | 'no_signal'.
    """
    page_decisions = page_decisions or {}
    has_cs = any("<cs>" in t for t in texts.values())
    if entry:
        base = entry["base"]
        pages = entry.get("pages", {})
        plans, unresolved = {}, []
        for fn, t in texts.items():
            if pages.get(fn, {}).get("out") == text_hash(t):
                continue  # juba teisendatud ja muutmata
            if "<cs>" in t:
                pb = page_base(base, fn, t, page_decisions)
                if pb:
                    plans[fn] = cs_to_f(t, pb)
                else:
                    unresolved.append(fn)
        extra = {"unresolved": unresolved} if base == "P" else None
        return ("convert" if plans else "noop"), base, entry.get("source"), plans, extra

    inferred, f, a = infer_base(texts.values())
    if decision:
        base, source = decision, "käsitsi"
    elif inferred:
        base, source = inferred, "signaal"
    else:
        # Vastuoluline signaal on otsustamata ka <cs>-ita: fraktuurteos, kus <cs>-i
        # pole, jääks muidu märgendamata (kuvataks antiikvana, värav lipustaks).
        if has_cs or (f and a):
            return "undecided", None, None, {}, (f, a)
        return "no_signal", None, None, {}, (f, a)
    if base == "A" and not has_cs:
        return "noop", base, source, {}, (f, a)
    if base == "P":
        plans, unresolved = {}, []
        for fn, t in texts.items():
            pb = page_base(base, fn, t, page_decisions)
            if "<cs>" not in t and fn not in page_decisions:
                # <cs>-ita leht: kirja pole kunagi märgitud. Fraktuurisignaaliga leht
                # mähitakse, antiikva jääb puutumata, vastuoluline ⸗-ga leht → aruandesse.
                if pb == "F":
                    plans[fn] = cs_to_f(t, "F")
                elif pb is None and "⸗" in t:
                    unresolved.append(fn)
                continue
            if pb:
                plans[fn] = cs_to_f(t, pb)
            else:
                unresolved.append(fn)
        return ("convert" if plans or unresolved else "noop"), base, source, plans, {"unresolved": unresolved}
    plans = {fn: cs_to_f(t, base) for fn, t in texts.items()}
    return "convert", base, source, plans, (f, a)


def apply_work(work_dir: str, work_id: str, base: str, source: str,
               originals: dict, plans: dict, manifest: dict, page_decisions=None) -> dict:
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
            if base == "P":
                page_records[fn]["base"] = page_base(base, fn, originals[fn], page_decisions or {})
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


def manuscript_cs(text: str, mode: str) -> str:
    """Käsikirja <cs> (ADR 0077: <f> on trükise märgend): 'strip' → tägid välja, 'hi' → <hi>."""
    new_open, new_close = ("<hi>", "</hi>") if mode == "hi" else ("", "")
    return text.replace("<cs>", new_open).replace("</cs>", new_close)


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
    ap.add_argument("--manuscript-cs", choices=("skip", "strip", "hi"), default="skip",
                    help="käsikirja <cs>: jäta puutumata (vaikimisi), eemalda tägid või asenda <hi>-ga")
    ap.add_argument("--report", default="/tmp/cs_to_f_aruanne.json", help="aruande JSON")
    args = ap.parse_args()

    from server.config import BASE_DIR

    if args.check:
        return check(BASE_DIR)

    decisions, page_decisions = {}, {}
    if args.decisions:
        with open(args.decisions, encoding="utf-8") as f:
            raw = {k: str(v).upper() for k, v in json.load(f).items()}
        decisions = {k: v for k, v in raw.items() if "/" not in k}
        page_decisions = {}
        for k, v in raw.items():
            if "/" in k:
                wid, fn = k.split("/", 1)
                page_decisions.setdefault(wid, {})[fn] = v
        bad = {k: v for k, v in decisions.items() if v not in ("F", "A", "P")}
        bad.update({f"{w}/{fn}": v for w, d in page_decisions.items() for fn, v in d.items() if v not in ("F", "A")})
        if bad:
            print(f"Vigased otsused (teos F|A|P, leht F|A): {bad}")
            return 2

    manifest = load_manifest()
    totals = Counter()
    report = {"fraktur": {}, "antiqua": {}, "undecided": {}, "no_signal": [], "italic_in_fraktur": {}, "raced": {}}
    for meta_path in sorted(glob.glob(os.path.join(BASE_DIR, "*", "_metadata.json"))):
        work_dir = os.path.dirname(meta_path)
        try:
            work_id = json.load(open(meta_path, encoding="utf-8")).get("id")
        except (OSError, ValueError):
            continue
        if not work_id or (args.work and work_id not in args.work):
            continue
        texts = {os.path.basename(t): read(t) for t in page_txts(work_dir)}
        try:
            wtype = (json.load(open(meta_path, encoding="utf-8")).get("type") or {})
        except (OSError, ValueError):
            wtype = {}
        if isinstance(wtype, dict) and wtype.get("id") == "Q87167":
            cs_pages = {fn: t for fn, t in texts.items() if "<cs>" in t}
            if cs_pages:
                report.setdefault("manuscript", {})[work_id] = {
                    "slug": os.path.basename(work_dir), "cs_pages": sorted(cs_pages)}
                if args.apply and args.manuscript_cs != "skip":
                    plans = {fn: manuscript_cs(t, args.manuscript_cs) for fn, t in cs_pages.items()}
                    res = apply_work(work_dir, work_id, "A", "käsikiri", texts, plans, manifest)
                    print(f"{work_id} (käsikiri, <cs> → {args.manuscript_cs}): {res['written']} lehte, commit {res['commit']}")
            continue
        status, base, source, plans, signal = plan_work(
            work_id, texts, decisions.get(work_id), manifest["works"].get(work_id),
            page_decisions.get(work_id))
        slug = os.path.basename(work_dir)
        try:
            langs = json.load(open(meta_path, encoding="utf-8")).get("languages") or []
        except (OSError, ValueError):
            langs = []
        if status == "undecided":
            report["undecided"][work_id] = {"slug": slug, "signal_F": signal[0], "signal_A": signal[1],
                                            "cs_pages": sum("<cs>" in t for t in texts.values()),
                                            "pages": len(texts), "languages": langs}
            continue
        if status == "no_signal":
            # Ei muutu — aga loetle, et inimene näeks (nt lühike fraktuurtrükis poolitusteta).
            report["no_signal"].append({"work_id": work_id, "slug": slug, "pages": len(texts),
                                        "languages": langs})
            continue
        if status == "noop":
            continue
        changed = {fn: new for fn, new in plans.items() if new != texts[fn]}
        group = {"F": "fraktur", "A": "antiqua", "P": "mixed"}[base]
        report.setdefault(group, {})[work_id] = {
            "slug": slug, "source": source, "pages": len(changed),
            **({"unresolved_pages": signal["unresolved"]} if isinstance(signal, dict)
               else {"signal": list(signal) if signal else None})}
        if base == "F":
            n_i = sum(t.count("<i>") for t in texts.values())
            if n_i:
                report["italic_in_fraktur"][work_id] = {"slug": slug, "i": n_i}
        totals[f"{group}_works"] += 1
        totals[f"{group}_pages"] += len(changed)
        if args.apply:
            res = apply_work(work_dir, work_id, base, source, texts, plans, manifest,
                             page_decisions.get(work_id))
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
    unresolved = sum(len(v.get("unresolved_pages", [])) for v in report.get("mixed", {}).values())
    print(f"Segateosed (lehe kaupa): {totals['mixed_works']} teost, {totals['mixed_pages']} lehte; "
          f"signaalita <cs>-lehti {unresolved} — vaja otsust võtmega \"work_id/leht.txt\"")
    print(f"Otsustamata (<cs> + signaalita/vastuoluga): {len(report['undecided'])} teost — vaja --decisions")
    print(f"<i> fraktuurteostes (vaata üle): {len(report['italic_in_fraktur'])} teost")
    print(f"Käsikirjad <cs>-iga (välja jäetud, --manuscript-cs): {len(report.get('manuscript', {}))} teost")
    print(f"Signaalita ja <cs>-ita (ei muutu, aruandes nimekiri): {len(report['no_signal'])} teost")
    print("(kuivkäivitus, --apply kirjutab)" if not args.apply else f"Vahele (muutus vahepeal): {len(report['raced'])} teost")
    print(f"Aruanne: {args.report}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
