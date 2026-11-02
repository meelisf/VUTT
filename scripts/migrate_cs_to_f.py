#!/usr/bin/env python3
"""Suhteline `<cs>` → absoluutne `<f>` (ADR 0077, punkt 6).

Iga leht läbib `server.script_migration.to_absolute` — SAMA funktsiooni, mida kasutab
üleminekukiht (re-OCR, upload'i import). Põhikiri tuleb KEELEST (kasutaja reegel
2026-11-02): ladina/prantsuse → antiikva, saksa/rootsi/eesti → fraktuur.
  - `<cs>`-iga leht: põhikiri = `<cs>`-ist väljapoole jääva teksti keel;
  - `<cs>`-ita leht: fraktuurikeelne → `<f>`, segaleht → rea kaupa, ladina → muutumata;
  - poolitusmärk on signaal ainult üle vaadatud lehel (Valmis/Annoteeritud/Parandatud);
    vastuolu keelega → ülevaatusse;
  - `--decisions otsused.json`: `{"work_id": "F"|"A"}` = teose varuvariant, kui lehe keel
    on tundmatu; `{"work_id": "F!"|"A!"}` = kõva otsus kogu teosele (nt kaasaegne
    sekundaarkirjandus, kus saksa tekst on antiikvas); `{"work_id/leht.txt": "F"|"A"}` =
    lehe otsus, võidab keele; `"H"` = käsikirjaline leht trükises (nt arhiivimärge):
    `<f>`-i ei tule, `<cs>` → `<hi>` nagu käsikirjades.
Ülevaatust vajavad lehed (tundmatu keel, vastuolu, segaleht) lähevad aruandesse
`review`-loendisse; tundmatu keelega `<cs>`-leht jääb muutmata, kuni saab otsuse.

Käsikiri (`type` Q87167) jääb VÄLJA: `<f>` on trükise märgend (ADR 0077 p 3). Käsikirja
`<cs>` (ladina kiri Kurrendi sees): `--manuscript-cs hi` → esiletõst `<hi>`, `strip` →
tägid välja, vaikimisi ei puudutata.

Teisendatuse tunnus on MANIFEST (`data/config/migrations/0077-f.json`), mitte `<f>`-i
olemasolu: korduskäivitus puudutab ainult lehte, mille praegune räsi ei ole manifestis
väljundina, ja ainult `<cs>`-iga lehte. Manifest commititakse teose lehtedega SAMAS
commitis (autor „Automaatne"). CAS + `page_lock`: leht loetakse enne kirjutust uuesti.

ENNE --apply: vt docs/runbook-adr-0077-migratsioon.md (git tag + tar).

Kasutus (serveris, KONTEINERIST — `data/` git commitib root'ina):
  docker exec vutt-backend python3 scripts/migrate_cs_to_f.py --decisions /tmp/otsused.json
  docker exec vutt-backend python3 scripts/migrate_cs_to_f.py --apply --decisions /tmp/otsused.json --manuscript-cs hi
  docker exec vutt-backend python3 scripts/migrate_cs_to_f.py --check
"""
import argparse
import glob
import json
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server.script_migration import (  # noqa: E402
    MANIFEST_PATH, load_manifest, text_hash, to_absolute,
)

MANUSCRIPT_TYPE = "Q87167"


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


def page_meta(work_dir: str, fn: str) -> dict:
    try:
        with open(os.path.join(work_dir, fn[:-4] + ".json"), encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def plan_work(texts: dict, statuses: dict, decision=None, entry=None, page_decisions=None):
    """Puhas plaan ühele teosele: ({failinimi: uus}, {failinimi: info}).

    texts: {failinimi: tekst}; statuses: {failinimi: staatus}; decision: teose varuvariant
    'F'|'A'|None; entry: manifesti kirje (korduskäivitus); page_decisions: {failinimi: 'F'|'A'}.
    Info on kõigi läbi vaadatud lehtede kohta (ka muutmata), muudatus ainult `plans`-is.
    """
    page_decisions = page_decisions or {}
    fallback = decision if decision in ("A", "F") else None
    forced = decision[0] if decision in ("A!", "F!") else None
    done = (entry or {}).get("pages", {})
    plans, infos = {}, {}
    for fn, t in texts.items():
        if entry is not None:
            if done.get(fn, {}).get("out") == text_hash(t):
                continue  # juba teisendatud ja muutmata
            if "<cs>" not in t and fn not in page_decisions:
                continue  # korduskäivitus: ainult <cs>-lehed (vana mudeli väljund)
        if page_decisions.get(fn) == "H":
            new = manuscript_cs(t, "hi")
            info = {"kind": "manuscript", "base": None, "lang": None, "conflict": False,
                    "reason": "lehe otsus: käsikiri"}
        else:
            new, info = to_absolute(t, statuses.get(fn), fallback=fallback,
                                    override=page_decisions.get(fn) or forced)
        infos[fn] = info
        if new != t or "<cs>" in t:
            plans[fn] = new
    return plans, infos


def needs_review(info: dict) -> str:
    """Ülevaatuse põhjus või ''."""
    if info["kind"] == "unknown":
        return "keel tundmatu"
    if info["conflict"]:
        return "poolitus vastuolus keelega"
    if info["kind"] == "mixed":
        return "segaleht (rea kaupa)"
    return ""


def apply_work(work_dir: str, work_id: str, originals: dict, plans: dict, infos: dict,
               manifest: dict) -> dict:
    """Kirjutab teose lehed + manifesti ÜHE commitiga. Tagastab {'written', 'raced', 'commit'}."""
    from datetime import datetime, timezone

    from server.git_ops import save_with_git
    from server.page_locks import page_lock
    from server.reocr_apply import _reconcile_annotations

    # `migrated_at` (enne commitit): ajaloo taastamine teisendab sellest vanema versiooni
    # (ADR 0077 p 7). Commiti räsi manifest kanda ei saa — ta commititakse samas commitis.
    entry = manifest["works"].setdefault(work_id, {
        "slug": os.path.basename(work_dir), "pages": {},
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
            info = infos.get(fn, {})
            page_records[fn] = {"in": text_hash(originals[fn]), "out": text_hash(text),
                                "base": info.get("base"), "kind": info.get("kind")}
            if text != originals[fn]:
                writes.append((txt, text))
                if json_write:
                    writes.append(json_write)
    if not page_records:
        return {"written": 0, "raced": raced, "commit": None}
    entry["pages"].update(page_records)
    os.makedirs(os.path.dirname(MANIFEST_PATH), exist_ok=True)
    manifest_write = (MANIFEST_PATH, json.dumps(manifest, ensure_ascii=False, indent=2))
    n_pages = sum(1 for p, _ in writes if p.endswith(".txt"))
    if not writes:
        res = save_with_git(MANIFEST_PATH, manifest_write[1], "Automaatne",
                            message=f"Fraktuur <f>: manifest {work_id} (ADR 0077)")
    else:
        first, first_text = writes[0]
        res = save_with_git(first, first_text, "Automaatne",
                            message=f"Fraktuur: <cs> → <f>, {n_pages} lehte (ADR 0077)",
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


def _snippet(text: str, n: int = 160) -> str:
    return " / ".join(ln.strip() for ln in text.strip().split("\n")[:3])[:n]


def load_decisions(path):
    with open(path, encoding="utf-8") as f:
        raw = {k: str(v).upper() for k, v in json.load(f).items()}
    decisions, page_decisions, bad = {}, {}, {}
    for k, v in raw.items():
        if "/" in k:
            wid, fn = k.split("/", 1)
            if v not in ("F", "A", "H"):
                bad[k] = v
            page_decisions.setdefault(wid, {})[fn] = v
        else:
            if v not in ("F", "A", "P", "F!", "A!"):  # P (vana segateose märge) = keel lehe kaupa
                bad[k] = v
            decisions[k] = v
    return decisions, page_decisions, bad


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="kirjuta (vaikimisi kuivkäivitus)")
    ap.add_argument("--decisions", help='otsused JSON: {"work_id": "F"|"A", "work_id/leht.txt": "F"|"A"}')
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
        decisions, page_decisions, bad = load_decisions(args.decisions)
        if bad:
            print(f"Vigased otsused (teos F|A|F!|A!, leht F|A|H): {bad}")
            return 2

    manifest = load_manifest()
    kinds = Counter()
    report = {"works": {}, "review": [], "manuscript": {}, "raced": {}}
    for meta_path in sorted(glob.glob(os.path.join(BASE_DIR, "*", "_metadata.json"))):
        work_dir = os.path.dirname(meta_path)
        try:
            meta = json.load(open(meta_path, encoding="utf-8"))
        except (OSError, ValueError):
            continue
        work_id = meta.get("id")
        if not work_id or (args.work and work_id not in args.work):
            continue
        slug = os.path.basename(work_dir)
        texts = {os.path.basename(t): read(t) for t in page_txts(work_dir)}
        wtype = meta.get("type") if isinstance(meta.get("type"), dict) else {}
        if wtype.get("id") == MANUSCRIPT_TYPE:
            cs_pages = {fn: t for fn, t in texts.items() if "<cs>" in t}
            if cs_pages:
                report["manuscript"][work_id] = {"slug": slug, "cs_pages": sorted(cs_pages)}
                if args.apply and args.manuscript_cs != "skip":
                    plans = {fn: manuscript_cs(t, args.manuscript_cs) for fn, t in cs_pages.items()}
                    infos = {fn: {"kind": "manuscript", "base": None} for fn in plans}
                    res = apply_work(work_dir, work_id, texts, plans, infos, manifest)
                    print(f"{work_id} (käsikiri, <cs> → {args.manuscript_cs}): "
                          f"{res['written']} lehte, commit {res['commit']}")
            continue

        metas = {fn: page_meta(work_dir, fn) for fn in texts}
        statuses = {fn: m.get("status") for fn, m in metas.items()}
        plans, infos = plan_work(texts, statuses, decisions.get(work_id),
                                 manifest["works"].get(work_id), page_decisions.get(work_id))
        changed = {fn for fn, new in plans.items() if new != texts[fn]}
        wk = Counter(i["kind"] for i in infos.values())
        kinds.update(wk)
        if changed or any(needs_review(i) for i in infos.values()):
            report["works"][work_id] = {"slug": slug, "languages": meta.get("languages") or [],
                                        "changed": len(changed), "kinds": dict(wk)}
        for fn, info in infos.items():
            why = needs_review(info)
            if why:
                report["review"].append({
                    "work_id": work_id, "slug": slug, "page": fn,
                    "page_number": metas[fn].get("page_number"),
                    "status": statuses.get(fn), "why": why, "kind": info["kind"],
                    "base": info["base"], "lang": info["lang"], "reason": info["reason"],
                    "has_cs": "<cs>" in texts[fn], "snippet": _snippet(texts[fn]),
                })
        if args.apply and plans:
            # Tundmatu keelega <cs>-leht jääb muutmata ega lähe manifesti (ootab otsust).
            plans = {fn: new for fn, new in plans.items() if infos[fn]["kind"] != "unknown"}
            res = apply_work(work_dir, work_id, texts, plans, infos, manifest)
            if res["raced"]:
                report["raced"][work_id] = res["raced"]
            if res["written"]:
                from server.meilisearch_ops import sync_work_to_meilisearch
                sync_work_to_meilisearch(slug)
            if res["written"] or res["raced"]:
                print(f"{work_id}: {res['written']} lehte, commit {res['commit']}"
                      + (f", VAHELE (muutus vahepeal): {res['raced']}" if res["raced"] else ""))

    with open(args.report, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    why = Counter(r["why"] for r in report["review"])
    print(f"Lehed liigi järgi: {dict(kinds)}")
    print(f"Muutuvaid teoseid: {sum(1 for w in report['works'].values() if w['changed'])}, "
          f"lehti: {sum(w['changed'] for w in report['works'].values())}")
    print(f"Ülevaatuseks: {dict(why)}")
    print(f"Käsikirjad <cs>-iga (--manuscript-cs): {len(report['manuscript'])} teost")
    print("(kuivkäivitus, --apply kirjutab)" if not args.apply else f"Vahele (muutus vahepeal): {len(report['raced'])} teost")
    print(f"Aruanne: {args.report}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
