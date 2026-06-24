#!/usr/bin/env python3
"""
Verifitseerib, et seed/reseed-tee (scripts/1-1_consolidate_data.py) ja live-tee
(server/meilisearch_ops.sync_work_to_meilisearch) annavad PÄRIS serveri andmetel
sama teose kohta IDENTSED Meilisearch dokumendid (issue #23).

Ehitab iga teose dokumendid MÕLEMA uue koodi-tee kaudu mälus ja võrdleb need
väli-väljalt. `send_to_meilisearch` on stub'itud → live INDEKSIT EI MUUDETA.
Skript on seega TURVALINE jooksutada igal ajal (read-only otsinguindeksi suhtes;
loeb ainult data/ failisüsteemi).

Kasutamine (Dockeris, kus backend jookseb):
    docker exec vutt-backend python3 scripts/verify_meili_seed_live_parity.py
    docker exec vutt-backend python3 scripts/verify_meili_seed_live_parity.py --limit 50
    docker exec vutt-backend python3 scripts/verify_meili_seed_live_parity.py 1690-mingi-teos 1700-teine

Väljub koodiga 1 kui leiti erinevus (sobib automaatikaks/CI-le), muidu 0.

Taust: vt MEMORY project_meili_two_index_paths — kaks indekseerimisteed jagavad
nüüd server/meili_doc.py-d, mistõttu nad EI TOHIKS enam lahku minna. See skript on
ühekordne tootmisandmete kinnitus (issue #23 nõue) + korratav regressioonikontroll.
"""
import argparse
import importlib.util
import json
import os
import sys

# Projekti juur sys.path-i, et `import server.*` töötaks ka siis kui skript
# käivitatakse `python3 scripts/verify_...py` (cwd ei ole automaatselt path-is).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import server.meilisearch_ops as ops  # noqa: E402
from server.utils import calculate_work_status  # noqa: E402


def _load_seed_module():
    """Laeb scripts/1-1_consolidate_data.py moodulina (failinimes sidekriipsud)."""
    seed_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "1-1_consolidate_data.py")
    spec = importlib.util.spec_from_file_location("seed_consolidate", seed_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _diff_keys(live_doc, seed_doc):
    """Tagastab võtmed, mille väärtus erineb (või puudub ühes)."""
    return sorted(k for k in set(live_doc) | set(seed_doc) if live_doc.get(k) != seed_doc.get(k))


def main():
    parser = argparse.ArgumentParser(description="Seed vs live Meili dokumendi pariteedi kontroll.")
    parser.add_argument("works", nargs="*", help="Konkreetsed teose kaustanimed (vaikimisi: kõik).")
    parser.add_argument("--limit", type=int, default=0, help="Kontrolli ainult esimest N teost.")
    parser.add_argument("--max-print", type=int, default=8, help="Mitut erinevat välja teose kohta välja printida.")
    args = parser.parse_args()

    seed = _load_seed_module()

    # Sama konfiguratsioon mõlemale teele → erinevus saab tulla AINULT ehitusloogikast.
    collections = ops.load_collections()
    people = ops.load_people_aliases()
    labels = ops.load_labels_store()
    archives = {}
    if os.path.exists(ops.ARCHIVES_FILE):
        with open(ops.ARCHIVES_FILE, "r", encoding="utf-8") as f:
            archives = json.load(f)

    # Live dokumentide kinnipüük — index'it EI muudeta.
    captured = {}
    ops.send_to_meilisearch = lambda documents, wait=True: (captured.__setitem__("docs", documents) or True)
    ops._delete_extra_pages = lambda *a, **k: None

    base = ops.BASE_DIR
    skip = {"prosopography", "config"}
    if args.works:
        dirs = list(args.works)
    else:
        dirs = sorted(
            d for d in os.listdir(base)
            if os.path.isdir(os.path.join(base, d)) and not d.startswith(".") and d not in skip
        )
    if args.limit:
        dirs = dirs[:args.limit]

    print(f"Kontrollin {len(dirs)} teost (BASE_DIR={base})...\n")

    checked = mismatches = errors = 0
    for d in dirs:
        captured["docs"] = None
        try:
            ops.sync_work_to_meilisearch(d)
        except Exception as e:  # noqa: BLE001 — raporteeri ja jätka
            print(f"LIVE ERROR  {d}: {e!r}")
            errors += 1
            continue
        live = captured["docs"]
        if not live:
            continue

        _, seed_pages = seed.build_work_documents(
            os.path.join(base, d), d, collections, people, archives, labels
        )
        # teose_staatus lisab live _upsert-sammus; siin lisame seed-dokumentidele sama moodi.
        st = calculate_work_status([p["status"] for p in seed_pages])
        for p in seed_pages:
            p["teose_staatus"] = st

        checked += 1
        if len(live) != len(seed_pages):
            print(f"LEN DIFF    {d}: live={len(live)} seed={len(seed_pages)}")
            mismatches += 1
            continue
        for lv, sd in zip(live, seed_pages):
            if lv != sd:
                mismatches += 1
                keys = _diff_keys(lv, sd)
                print(f"DOC DIFF    {d} {lv.get('id')}: {keys}")
                for k in keys[:args.max_print]:
                    print(f"     {k}\n       LIVE= {repr(lv.get(k))[:200]}\n       SEED= {repr(sd.get(k))[:200]}")
                break  # üks näide teose kohta piisab

    print(f"\n=== Kontrollitud {checked} teost | {mismatches} erinevust | {errors} live-viga ===")
    return 1 if (mismatches or errors) else 0


if __name__ == "__main__":
    sys.exit(main())
