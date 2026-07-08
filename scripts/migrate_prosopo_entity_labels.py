"""Ühekordne migratsioon: backfill mitmekeelsed inline `labels` prosopograafia
entiteedi-väljadele (ametid, asutused, kohad, tagid, seosed) Q-koodi järgi.

Erinevalt migrate_prosopo_status_labels.py-st (mis loeb vocabularies.json)
võtab see labelid kanooniilisest labels.json registrist ja pärib puuduvad
Wikidatast (uuendades ka labels.json-i). Kuna useEntityLabel / getLabel
eelistavad `labels[lang]`, parandab see kõik kuvakohad korraga.

Kasutus (serveris, Dockeris):
  docker exec vutt-backend python3 scripts/migrate_prosopo_entity_labels.py --dry-run
  docker exec vutt-backend python3 scripts/migrate_prosopo_entity_labels.py --apply
  docker exec vutt-backend python3 scripts/migrate_prosopo_entity_labels.py --apply --commit
"""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server.entity_labels_ops import (  # noqa: E402
    collect_entity_qcodes, fill_entity_labels, _fetch_wikidata_labels,
    load_entity_labels, _TARGET_LANGS,
)
from server.config import LABELS_FILE, PROSOPOGRAPHY_DIR  # noqa: E402
from server.utils import atomic_write_json  # noqa: E402

DATA_ROOT = os.getenv("VUTT_DATA_DIR", "data")


def _needs_fetch(qid, registry):
    return qid not in registry or any(l not in registry[qid] for l in _TARGET_LANGS)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="Kirjuta muudatused (muidu dry-run)")
    ap.add_argument("--dry-run", action="store_true", help="Ainult näita (vaikimisi)")
    ap.add_argument("--commit", action="store_true", help="Pärast --apply tee data/ git commit")
    ap.add_argument("--limit", type=int, default=0, help="Töötle ainult N esimest muudetavat faili")
    args = ap.parse_args()

    prosopo_dir = Path(PROSOPOGRAPHY_DIR)
    if not prosopo_dir.is_dir():
        print(f"Prosopograafia kaust puudub: {prosopo_dir}", file=sys.stderr)
        return 1

    files = sorted(prosopo_dir.glob("*.json"))
    records = {}
    all_qcodes = set()
    for fpath in files:
        try:
            data = json.loads(fpath.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"SKIP {fpath.name}: {e}", file=sys.stderr)
            continue
        records[fpath] = data
        all_qcodes |= collect_entity_qcodes(data)

    registry = load_entity_labels()
    to_fetch = {q for q in all_qcodes if _needs_fetch(q, registry)}
    print(f"{len(files)} faili, {len(all_qcodes)} unikaalset Q-koodi, "
          f"{len(to_fetch)} vajab Wikidata päringut.")

    labels_written = False
    if to_fetch:
        fetched = _fetch_wikidata_labels(to_fetch)
        registry.update(fetched)
        if args.apply:
            os.makedirs(os.path.dirname(LABELS_FILE), exist_ok=True)
            atomic_write_json(LABELS_FILE, registry)
            labels_written = True
            print(f"labels.json uuendatud: +{len(fetched)} kirjet.")

    files_changed = 0
    slots_changed = 0
    for fpath, data in records.items():
        n = fill_entity_labels(data, registry)
        if n == 0:
            continue
        files_changed += 1
        slots_changed += n
        if args.apply:
            fpath.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        else:
            print(f"[dry-run] {fpath.name}: {n} pesa")
        if args.limit and files_changed >= args.limit:
            break

    mode = "APPLY" if args.apply else "DRY-RUN"
    print(f"[{mode}] {files_changed} faili, {slots_changed} pesa backfill'itud.")

    if args.apply and args.commit and (files_changed or labels_written):
        if files_changed:
            msg = f"Backfill mitmekeelsed inline labels prosopo entiteedi-väljadele ({files_changed} kaarti)"
        else:
            msg = "Backfill mitmekeelsed inline labels prosopo entiteedi-väljadele (ainult labels.json)"
        try:
            subprocess.run(["git", "-C", DATA_ROOT, "add", "-A", "config/prosopography", "config/labels.json"], check=True)
            subprocess.run(["git", "-C", DATA_ROOT, "commit", "-m", msg], check=True)
            print(f"data/ git commit: {msg}")
        except subprocess.CalledProcessError as e:
            print(f"git commit ebaõnnestus: {e}", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
