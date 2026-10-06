#!/usr/bin/env python3
"""Leinatrükiste kaasteksti autorid: `dedicator` → `gratulator`.

9.–10.09.2026 sisestati neljas leinatrükises leinaluuletuste autorid
pühendajaks, sest rolli `gratulator` silt oli siis „Õnnitleja" ja ei sobinud.
Silt on nüüd „Kaasteksti autor" (ADR 0057 täiendus 2026-10-05). Pühendaja on
see, kes kirjutab teosele pühenduse — ka seoste kaardil on ta nõrk seos
(`network_rules.DEDICATED_CREATORS`), nii et vale roll nõrgendas neid isikuid.

Nimekiri on KÄSITSI kinnitatud (2026-10-06). q3u9fz ja 416nry (üks
`dedicator` autori kõrval) jäävad puutumata — võivad olla päris pühendused.

Kasutus (serveris, KONTEINERIST):
  docker exec vutt-backend python3 scripts/migrate_dedicator_to_gratulator.py          # kuivkäivitus
  docker exec vutt-backend python3 scripts/migrate_dedicator_to_gratulator.py --apply
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# work_id → oodatav `dedicator`-kannete arv (kinnitamise hetkel)
WORKS = {"shj0nu": 12, "jlctu4": 11, "vb1kk6": 7, "pzq67a": 6}


def retag(creators: list) -> tuple[list, int]:
    """Uued loojad + muudetud kannete arv. Puhas funktsioon (testitav)."""
    out, n = [], 0
    for c in creators or []:
        if isinstance(c, dict) and c.get("role") == "dedicator":
            c = {**c, "role": "gratulator"}
            n += 1
        out.append(c)
    return out, n


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="kirjuta (vaikimisi kuivkäivitus)")
    args = ap.parse_args()

    from server.utils import find_directory_by_id
    from server.metadata_ops import bulk_update_works

    items, total = [], 0
    for work_id, expected in sorted(WORKS.items()):
        path = find_directory_by_id(work_id)
        meta_path = os.path.join(path, "_metadata.json") if path else None
        if not meta_path or not os.path.exists(meta_path):
            print(f"VAHELE {work_id}: teost ei leitud")
            continue
        with open(meta_path, encoding="utf-8") as f:
            meta = json.load(f)
        _, n = retag(meta.get("creators"))
        if n != expected:
            # Keegi on vahepeal rolle muutnud — ära oleta, vaata üle.
            print(f"VAHELE {work_id}: oodatud {expected} pühendajat, leitud {n}")
            continue
        total += n
        print(f"{work_id}: {n} × dedicator → gratulator")
        items.append((meta_path, lambda m: {"creators": retag(m.get("creators"))[0]}))

    print(f"KOKKU {total} kannet {len(items)} teoses{'' if args.apply else ' (kuivkäivitus, --apply kirjutab)'}")
    if args.apply and items:
        # call_ptw: person_to_works kannab rolle — peab uuenema koos metaandmetega.
        res = bulk_update_works(items, "Automaatne",
                                "Roll: leinatrükiste kaasteksti autorid dedicator → gratulator",
                                call_ptw=True)
        print(f"→ {res}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
