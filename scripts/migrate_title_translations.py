#!/usr/bin/env python3
"""Kahekeelsed ` / `-pealkirjad → `title` + `title_en` + `title_devised` (ADR 0064, #551).

Nimekiri on KÄSITSI kinnitatud (2026-10-06), mitte regexi tulemus: ` / ` tähendab
ka vastutusandmeid („… põhikiri / ümber kirjutanud H. Baumann") ja nimevariante
(„Oesel [Ösel / Saaremaa]") — need jäävad puutumata.

Teos muudetakse ainult siis, kui tema praegune pealkiri on TÄPSELT see, mis
nimekirja koostamisel kinnitati. Muul juhul jäetakse vahele ja öeldakse välja —
vahepeal käsitsi parandatud pealkirja ei kirjutata üle. Kordus on ohutu.

Kõik muudatused lähevad ÜHE commitina (`bulk_update_works`). Pärast on vaja
täisreindeksit (`server_seed_data.sh`): uued väljad peavad saama otsitavaks.

Kasutus (serveris, KONTEINERIST — `data/` git commitib root'ina):
  docker exec vutt-backend python3 scripts/migrate_title_translations.py          # kuivkäivitus
  docker exec vutt-backend python3 scripts/migrate_title_translations.py --apply
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

_KIRI = ("Kiri Karl Morgensternile", "Letter to Karl Morgenstern")

# work_id → (title, title_en). Praegune pealkiri = f"{title} / {title_en}".
SPLITS = {
    "0ajcsn": ("Tartu Ülikooli (Academia Gustaviana) senati protokollid : kontseptid",
               "Minutes of the Senate of Tartu Ülikool (Academia Gustaviana) : drafts"),
    "ms169i": ("Ülemkonsistooriumi generalsuperintendendi Johann Fischeri kirjad pastor J. H. Geisti omavolitsemise kohta",
               "Letters of Johann Fischer, General Superintendent of the High Consistory, concerning the arbitrary actions of Pastor J. H. Geist"),
    "ffqg7z": ("7 kirja Karl Morgensternile, St.Petersburg", "7 letters to Karl Morgenstern, St.Petersburg"),
    "t9zd42": ("65 kirja Karl Morgensternile, St. Petersburg", "65 letters to Karl Morgenstern, St. Petersburg"),
    **{wid: _KIRI for wid in (
        "05nctg", "4bq8ta", "9vmaug", "irhk00", "k1kdxh", "l7dp90", "m3rk1w", "mlkwgl",
        "n0zcqu", "o40y5h", "t3oczp", "tkzjnu", "wl7ocj", "xcqbk3", "ysjk67", "yssfb6",
    )},
}

# work_id → title_original (allikas olev pealkiri)
ORIGINALS = {
    "0ajcsn": "Protocollum Sub Rectore Magnifico Andreae Virginio D. D. Theol.",
}


def title_updates(work_id: str, meta: dict) -> dict:
    """Rakendatavad väljad või {} (vahele). Puhas funktsioon (testitav)."""
    split = SPLITS.get(work_id)
    if not split:
        return {}
    title, title_en = split
    current = meta.get("title") or ""
    if current == f"{title} / {title_en}":
        updates = {"title": title, "title_en": title_en, "title_devised": True}
    elif current == title and meta.get("title_en") == title_en:
        updates = {}  # juba tehtud
    else:
        return {}
    original = ORIGINALS.get(work_id)
    if original and not meta.get("title_original"):
        updates["title_original"] = original
    return updates


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="kirjuta (vaikimisi kuivkäivitus)")
    args = ap.parse_args()

    import json
    from server.utils import find_directory_by_id
    from server.metadata_ops import bulk_update_works

    items, skipped = [], []
    for work_id in sorted(SPLITS):
        path = find_directory_by_id(work_id)
        meta_path = os.path.join(path, "_metadata.json") if path else None
        if not meta_path or not os.path.exists(meta_path):
            skipped.append((work_id, "teost ei leitud"))
            continue
        with open(meta_path, encoding="utf-8") as f:
            meta = json.load(f)
        updates = title_updates(work_id, meta)
        if not updates:
            done = meta.get("title_en") == SPLITS[work_id][1]
            skipped.append((work_id, "juba tehtud" if done else f"pealkiri erineb: {meta.get('title', '')[:80]}"))
            continue
        print(f"{work_id}: {updates}")
        # Transform arvutab uuesti värskelt luku all loetud seisust (ADR: ei kirjuta hetktõmmist).
        items.append((meta_path, lambda m, wid=work_id: title_updates(wid, m)))

    for work_id, reason in skipped:
        print(f"VAHELE {work_id}: {reason}")
    print(f"KOKKU {len(items)} teost{'' if args.apply else ' (kuivkäivitus, --apply kirjutab)'}")
    if args.apply and items:
        res = bulk_update_works(items, "Automaatne", "Pealkiri: title_en + title_devised (ADR 0064, #551)")
        print(f"→ {res}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
