#!/usr/bin/env python3
"""Backfill only derived dating fields, preserving index contents and source metadata.

Run after deploying the backend, BEFORE deploying the date-aware frontend:
    python3 scripts/backfill_work_dates.py --data-dir data          # preview
    python3 scripts/backfill_work_dates.py --data-dir data --apply  # apply and verify tasks
"""
import argparse
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from dotenv import load_dotenv
from meilisearch import Client
from server.work_dating import dating_updates, index_dating
from server.utils import parse_year_range

FIELDS = ('dating', 'date_start', 'date_end', 'date_sort')


def main():
    load_dotenv()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', default=os.environ.get('VUTT_DATA_DIR', 'data'))
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    key = os.environ.get('MEILI_MASTER_KEY')
    if not key:
        parser.error('MEILI_MASTER_KEY is required')
    root = Path(args.data_dir)
    if not root.is_dir():
        parser.error('data directory does not exist')
    client = Client(os.environ.get('MEILI_URL', 'http://localhost:7700'), key)
    index = client.index('teosed')
    by_id = {}
    for path in root.glob('*/_metadata.json'):
        meta = dating_updates(json.loads(path.read_text(encoding='utf-8')))
        if meta.get('id'):
            by_id[meta['id']] = index_dating(meta, parse_year_range(meta.get('year'), meta.get('year_display')))
    if not by_id:
        parser.error('no work metadata found')
    updates, unknown = [], set()
    offset = 0
    while True:
        result = index.get_documents({'offset': offset, 'limit': 1000, 'fields': ['id', 'work_id', *FIELDS]})
        docs = result.results
        if not docs:
            break
        for doc in docs:
            doc = dict(doc) if isinstance(doc, dict) else vars(doc)
            fields = by_id.get(doc.get('work_id'))
            if fields is None:
                unknown.add(doc.get('work_id'))
                continue
            if any(doc.get(k) != fields[k] for k in FIELDS):
                updates.append({'id': doc['id'], **fields})
        offset += len(docs)
    print(f'{len(by_id)} works; {offset} indexed pages; {len(updates)} pages need dating fields; {len(unknown)} unknown work IDs')
    if unknown:
        parser.error('indexed works without source metadata: resolve before deploying the frontend')
    if not args.apply:
        print('Preview only. Source metadata and index were not changed.')
        return

    def wait(task):
        result = client.wait_for_task(task.task_uid, timeout_in_ms=600000, interval_in_ms=500)
        if result.status != 'succeeded':
            raise RuntimeError(f'Meilisearch task {task.task_uid}: {result.status}: {result.error}')

    # Additive settings: never discard existing deployment-specific attributes.
    wait(index.update_filterable_attributes(sorted(set(index.get_filterable_attributes()) | {'date_start', 'date_end'})))
    wait(index.update_sortable_attributes(sorted(set(index.get_sortable_attributes()) | {'date_sort'})))
    for start in range(0, len(updates), 1000):
        wait(index.update_documents(updates[start:start + 1000]))
        print(f'Updated {min(start + 1000, len(updates))}/{len(updates)} pages')
    print('All tasks succeeded. Source metadata was not changed. Run preview again to verify zero pending pages.')


if __name__ == '__main__':
    main()
