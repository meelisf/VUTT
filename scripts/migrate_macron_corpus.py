#!/usr/bin/env python3
"""Korpuse lühendusmärk tilde → makron (ADR 0062, #533 samm 5).

Teisendus on `server.macron.to_macron` — SAMA funktsioon, mis OCR-i järeltöötlus.
Iga teos:
  - keel teadmata (`languages` loetamatu) → vahele, aruandesse;
  - valvuriga keel (est/spa/por) → EI teisendata, tildega sõnad aruandesse
    (inimene otsustab käsitsi);
  - muidu iga leht, kus vähemalt üks märk muutub → uus tekst. Leht, kus
    muutuks ainult NFC-kuju, jääb puutumata (ADR 0012).
Kirjutus: ÜKS commit teose kohta (autor „Automaatne"), ankrud lepitatakse
(ADR 0041), Meili sünk üks kord teose kohta.

Skript jookseb eraldi protsessis — serveri `page_lock` teda EI kaitse. Seepärast
CAS: leht loetakse vahetult enne kirjutust uuesti ja kui tekst on vahepeal
muutunud (toimetaja salvestas), jäetakse leht vahele ja öeldakse välja.
Käivita vaiksel ajal.

Kasutus (serveris, KONTEINERIST — `data/` git commitib root'ina):
  docker exec vutt-backend python3 scripts/migrate_macron_corpus.py                  # kuivkäivitus + aruanne
  docker exec vutt-backend python3 scripts/migrate_macron_corpus.py --work tc80j9    # üks teos
  docker exec vutt-backend python3 scripts/migrate_macron_corpus.py --apply --skip 0cxkz3

0cxkz3 jäeti 2026-10-06 kasutaja otsusel vahele (lk 24 OCR-kordusloop, 1804 tildet).
"""
import argparse
import glob
import json
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server.macron import is_guarded, tilde_words, to_macron, work_languages  # noqa: E402


def plan_page(text: str, languages):
    """('convert', uus, n) | ('guarded', None, sõnad) | ('skip', None, 0). Puhas."""
    if is_guarded(languages):
        words = tilde_words(text)
        return ("guarded", None, words) if words else ("skip", None, 0)
    new, n = to_macron(text)
    if n == 0:
        return "skip", None, 0
    return "convert", new, n


def page_txts(work_dir: str):
    """Lehekülgede .txt-d (pildiga paar) — muud .txt-d ei ole lehed."""
    out = []
    for txt in sorted(glob.glob(os.path.join(work_dir, "*.txt"))):
        stem = os.path.splitext(txt)[0]
        if os.path.exists(stem + ".jpg"):
            out.append(txt)
    return out


def read(path: str) -> str:
    with open(path, encoding="utf-8") as f:
        return f.read()


def apply_work(work_dir: str, plans: dict) -> dict:
    """plans: {txt_path: (vana, uus)}. Tagastab {'written', 'raced', 'commit'}."""
    from server.git_ops import save_with_git
    from server.page_locks import page_lock
    from server.reocr_apply import _reconcile_annotations

    writes, raced = [], []
    for txt, (old, new) in plans.items():
        with page_lock(txt):
            # CAS: toimetaja võis vahepeal salvestada (teine protsess, lukk ei kaitse)
            if read(txt) != old:
                raced.append(os.path.basename(txt))
                continue
            text, json_write = _reconcile_annotations(work_dir, os.path.basename(txt), new)
            writes.append((txt, text))
            if json_write:
                writes.append(json_write)
    if not writes:
        return {"written": 0, "raced": raced, "commit": None}
    n_pages = sum(1 for p, _ in writes if p.endswith(".txt"))
    first, first_text = writes[0]
    res = save_with_git(first, first_text, "Automaatne",
                        message=f"Lühend: tilde → makron, {n_pages} lehte (ADR 0062)",
                        additional_files=writes[1:])
    return {"written": n_pages, "raced": raced, "commit": (res.get("commit_hash") or "")[:8]}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="kirjuta (vaikimisi kuivkäivitus)")
    ap.add_argument("--work", action="append", default=[], help="ainult see work_id (korduv)")
    ap.add_argument("--skip", action="append", default=[], help="jäta see work_id vahele (korduv)")
    ap.add_argument("--report", default="/tmp/makron_aruanne.json", help="aruande JSON")
    args = ap.parse_args()

    from server.config import BASE_DIR

    totals = Counter()
    report = {"guarded": {}, "unknown_language": [], "converted": {}, "raced": {}}
    for meta_path in sorted(glob.glob(os.path.join(BASE_DIR, "*", "_metadata.json"))):
        work_dir = os.path.dirname(meta_path)
        try:
            work_id = json.load(open(meta_path, encoding="utf-8")).get("id")
        except (OSError, ValueError):
            continue
        if args.work and work_id not in args.work:
            continue
        if work_id in args.skip:
            report.setdefault("skipped", []).append(work_id)
            continue
        languages = work_languages(work_dir)
        txts = page_txts(work_dir)
        if languages is None:
            report["unknown_language"].append(work_id)
            continue

        plans, guarded, chars = {}, {}, 0
        for txt in txts:
            text = read(txt)
            kind, new, x = plan_page(text, languages)
            if kind == "convert":
                plans[txt] = (text, new)
                chars += x
            elif kind == "guarded":
                guarded[os.path.basename(txt)] = x
        if guarded:
            report["guarded"][work_id] = {"languages": languages, "pages": guarded}
            totals["guarded_works"] += 1
            totals["guarded_words"] += sum(len(w) for w in guarded.values())
        if not plans:
            continue
        totals["works"] += 1
        totals["pages"] += len(plans)
        totals["chars"] += chars
        report["converted"][work_id] = {"pages": len(plans), "chars": chars}

        if args.apply:
            res = apply_work(work_dir, plans)
            totals["written"] += res["written"]
            if res["raced"]:
                report["raced"][work_id] = res["raced"]
                totals["raced"] += len(res["raced"])
            if res["written"]:
                from server.meilisearch_ops import sync_work_to_meilisearch
                sync_work_to_meilisearch(os.path.basename(work_dir))
            print(f"{work_id}: {res['written']} lehte, commit {res['commit']}"
                  + (f", VAHELE (muutus vahepeal): {res['raced']}" if res["raced"] else ""))

    with open(args.report, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    print(f"Teisendatav: {totals['works']} teost, {totals['pages']} lehte, {totals['chars']} märki")
    print(f"Valvuriga keel (est/spa/por), teisendamata: {totals['guarded_works']} teost, "
          f"{totals['guarded_words']} tildega sõna")
    print(f"Keel teadmata, vahele: {len(report['unknown_language'])} teost")
    if args.apply:
        print(f"Kirjutatud {totals['written']} lehte; vahele (muutus vahepeal) {totals['raced']}")
    else:
        print("(kuivkäivitus, --apply kirjutab)")
    print(f"Aruanne: {args.report}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
