"""
Bulk-uuendus: täida gender (M) ja status (Aadel) kõigile AA-koodiga isikutele.

Käivita serveril Dockeri kaudu (et Meilisearch sync töötaks):
    docker exec vutt-backend python3 scripts/bulk_fill_gender_status.py
    docker exec vutt-backend python3 scripts/bulk_fill_gender_status.py --dry-run

Pärast käivitamist:
    ./scripts/server_seed_data.sh  (Meilisearch re-indeks)
"""
import argparse
import json
import os
import sys
from pathlib import Path
from typing import Optional

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

AADEL_STATUS = {
    "id": "Q134737",
    "label": "Aadel",
    "labels": {"et": "Aadel", "de": "Adel", "en": "nobility", "la": "Nobilitas"},
}


def _load_aa_noble_ids() -> set:
    """Tagastab AA entry numberite hulga kus noble_status on märgitud."""
    aa_path = PROJECT_ROOT / "reference_data" / "album_academicum.json"
    if not aa_path.exists():
        print(f"! AA fail puudub: {aa_path}")
        return set()
    with open(aa_path, encoding="utf-8") as f:
        aa = json.load(f)
    entries = aa if isinstance(aa, list) else aa.get("entries", [])
    noble = set()
    for e in entries:
        if (e.get("person") or {}).get("name", {}).get("noble_status"):
            noble.add(e.get("entry_number"))
    return noble


def _get_aa_entry_num(person: dict) -> Optional[int]:
    for ident in person.get("identifiers") or []:
        if ident.get("scheme") == "album_academicum":
            raw = str(ident.get("id", "")).replace("AA:", "").strip()
            if raw.isdigit():
                return int(raw)
    return None


def main():
    parser = argparse.ArgumentParser(description="Bulk gender+status täitmine AA isikutele")
    parser.add_argument("--dry-run", action="store_true", help="Ära kirjuta, kuva ainult muudatused")
    args = parser.parse_args()

    from server.prosopography.ops import update_person

    state_dir = PROJECT_ROOT / "state" / "prosopography"
    if not state_dir.exists():
        print(f"! Prosopograafia kataloog puudub: {state_dir}")
        sys.exit(1)

    noble_entry_nums = _load_aa_noble_ids()
    print(f"AA aadlisikuid: {len(noble_entry_nums)}")

    updated_gender = 0
    updated_status = 0
    skipped = 0
    errors = 0

    files = sorted(state_dir.glob("*.json"))
    for fpath in files:
        try:
            with open(fpath, encoding="utf-8") as f:
                person = json.load(f)
        except Exception as e:
            print(f"  ! Lugemine ebaõnnestus {fpath.name}: {e}")
            errors += 1
            continue

        # Ainult AA-koodiga isikud
        entry_num = _get_aa_entry_num(person)
        if not entry_num:
            skipped += 1
            continue

        if person.get("record_status") == "tombstone":
            skipped += 1
            continue

        changes = {}
        label = (person.get("name") or {}).get("label", fpath.stem)

        # Sugu: täida M kui tühi
        if not person.get("gender"):
            changes["gender"] = "M"
            updated_gender += 1

        # Aadlistaatus: täida kui AA märgib noble_status ja väli tühi
        if entry_num in noble_entry_nums and not person.get("status"):
            changes["status"] = AADEL_STATUS
            updated_status += 1

        if not changes:
            continue

        change_str = ", ".join(
            f"{k}={v if not isinstance(v, dict) else v.get('label')}"
            for k, v in changes.items()
        )
        print(f"  {'[DRY RUN] ' if args.dry_run else ''}({person['id']}) {label}: {change_str}")

        if not args.dry_run:
            payload = dict(person)
            payload.update(changes)
            try:
                update_person(person["id"], payload, username="bulk_fill_script")
            except Exception as e:
                print(f"    ! Salvestamine ebaõnnestus: {e}")
                errors += 1

    print(f"\nValmis. Sugu täidetud: {updated_gender}  |  Aadel täidetud: {updated_status}  |  Vead: {errors}")
    if args.dry_run:
        print("[DRY RUN — midagi ei kirjutatud]")
    else:
        print("Jooksuta järgmisena: ./scripts/server_seed_data.sh")


if __name__ == "__main__":
    main()
