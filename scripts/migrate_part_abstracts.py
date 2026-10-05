#!/usr/bin/env python3
"""Teose osade `notes` → `abstract_et` + toimetaja `notes` (ADR 0063).

Osa märkmetes oli koos kaks asja: toimetaja info („Indeks F114 · liik … · lehed …;
aadress", kahtlused) ja avalik sisukokkuvõte („Sisu: …"). Mõõdetud 2026-10-05:
o17ekb 137 osa, igas täpselt üks „Sisu:"; jlctu4 17 osa, ainult kokkuvõte.

  - „Sisu:" olemas → enne = `notes`, pärast = `abstract_et`
  - „Sisu:" puudub → kogu tekst = `abstract_et`, `notes` kaob

Juba täidetud `abstract_et`-ga osa jäetakse vahele (kordus on ohutu).

Kasutus (serveris, KONTEINERIST — `data/` git commitib root'ina):
  docker exec vutt-backend python3 scripts/migrate_part_abstracts.py          # kuivkäivitus
  docker exec vutt-backend python3 scripts/migrate_part_abstracts.py --apply
"""
import argparse
import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

MARKER = "Sisu:"


def split_notes(text: str) -> tuple[str, str]:
    """(toimetaja märkus, eestikeelne kokkuvõte). Tühi string = väli jääb tühjaks."""
    text = (text or "").strip()
    if MARKER not in text:
        return "", text
    before, after = text.split(MARKER, 1)
    # Eraldaja „… lehed 11–12; aadress 14. Sisu: …" — lõpust ära jäävad ainult tühikud.
    return before.strip().rstrip("·").strip(), after.strip()


def migrate_parts(parts: list) -> tuple[list, int]:
    """Uued osad + muudetud osade arv. Puhas funktsioon (testitav)."""
    out, changed = [], 0
    for p in parts:
        p = dict(p)
        if p.get("notes") and not p.get("abstract_et"):
            notes, abstract = split_notes(p["notes"])
            if abstract:
                p["abstract_et"] = abstract
                if notes:
                    p["notes"] = notes
                else:
                    p.pop("notes", None)
                changed += 1
        out.append(p)
    return out, changed


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="kirjuta (vaikimisi kuivkäivitus)")
    args = ap.parse_args()

    from server.config import BASE_DIR
    from server.metadata_ops import bulk_update_works

    total = 0
    for meta_path in sorted(glob.glob(os.path.join(BASE_DIR, "*", "_metadata.json"))):
        try:
            with open(meta_path, encoding="utf-8") as f:
                meta = json.load(f)
        except (OSError, ValueError):
            continue
        new_parts, changed = migrate_parts(meta.get("parts") or [])
        if not changed:
            continue
        total += changed
        print(f"{meta.get('id')}: {changed} osa")
        for new in [p for p in new_parts if p.get("abstract_et")][:2]:
            print(f"  notes:       {(new.get('notes') or '—')[:100]}")
            print(f"  abstract_et: {(new.get('abstract_et') or '')[:100]}")
        if args.apply:
            # Transform loeb värske seisu luku all — kuivkäivituse hetktõmmist ei kirjutata.
            res = bulk_update_works(
                [(meta_path, lambda m: {"parts": migrate_parts(m.get("parts") or [])[0]})],
                "Automaatne", f"Osad: notes → abstract_et ({meta.get('id')}, ADR 0063)")
            print(f"  → {res}")
    print(f"KOKKU {total} osa{'' if args.apply else ' (kuivkäivitus, --apply kirjutab)'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
