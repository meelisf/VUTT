#!/usr/bin/env python3
"""Audit legacy birthplace/origin links; write only with --apply.

Run in the backend container after deployment:
  python3 scripts/unify_person_origins.py
  python3 scripts/unify_person_origins.py --apply

No Wikidata calls. Existing git history and all date/source metadata are kept.
Conflicts and unlinked places are listed for manual review, never discarded.
Writes use the normal person writer, version check and index updates.
"""
import argparse
import collections
import glob
import json
import os
import sys
import types
from pathlib import Path

root = Path(__file__).resolve().parents[1]
# Match other maintenance scripts: importing server.__init__ would initialize
# unrelated services even during a read-only audit.
if 'server' not in sys.modules:
    package = types.ModuleType('server')
    package.__path__ = [str(root / 'server')]
    package.__package__ = 'server'
    sys.modules['server'] = package
sys.path.insert(0, str(root))

from server.config import PROSOPOGRAPHY_DIR  # noqa: E402
from server.prosopography.origin_unification import plan_origin_unification  # noqa: E402
from server.prosopography.places_ops import get_places  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Write unambiguous consolidations')
    args = parser.parse_args()
    places = get_places()
    counts = collections.Counter()
    for path in sorted(glob.glob(os.path.join(PROSOPOGRAPHY_DIR, '*.json'))):
        with open(path, encoding='utf-8') as source:
            card = json.load(source)
        if card.get('merged_into') or card.get('record_status') == 'tombstone':
            continue
        plan = plan_origin_unification(card, places)
        counts[plan['action']] += 1
        if plan['action'] == 'review':
            print(json.dumps({'id': card['id'], 'review': plan['reason'],
                              'birthplace': (card.get('birth') or {}).get('place'),
                              'origin': (card.get('origin') or {}).get('place')}, ensure_ascii=False))
        elif plan['action'] == 'update':
            print(json.dumps({'id': card['id'], 'origin': plan['key'], 'apply': args.apply}, ensure_ascii=False))
            if args.apply:
                from server.prosopography.person_crud import update_person
                update_person(card['id'], {**plan['changes'], 'updated_at': card['updated_at']}, 'Päritolu ühendamine')
    print(json.dumps({'apply': args.apply, 'counts': dict(counts)}, ensure_ascii=False))


if __name__ == '__main__':
    main()
