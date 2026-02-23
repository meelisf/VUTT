#!/usr/bin/env python3
"""
Migreerib olemasolevad _thumb_*.jpg failid _thumbs/ alamkataloogi.

Enne: data/{slug}/_thumb_NIMI.jpg
Pärast: data/{slug}/_thumbs/_thumb_NIMI.jpg

Käivita üks kord pärast image_server.py uuendamist.
"""
import glob
import os
import shutil
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from server.config import BASE_DIR


def migrate(dry_run=False):
    pattern = os.path.join(BASE_DIR, '*', '_thumb_*.jpg')
    thumb_files = glob.glob(pattern)

    if not thumb_files:
        print("Migreerida vajavaid faile ei leitud.")
        return

    print(f"Leitud {len(thumb_files)} thumbnailifaili.")
    if dry_run:
        print("(dry-run — faile ei liigutata)\n")

    migrated = 0
    errors = 0

    for src in sorted(thumb_files):
        work_dir = os.path.dirname(src)
        filename = os.path.basename(src)
        thumbs_dir = os.path.join(work_dir, '_thumbs')
        dst = os.path.join(thumbs_dir, filename)

        print(f"  {os.path.relpath(src, BASE_DIR)}  →  _thumbs/{filename}")

        if not dry_run:
            try:
                os.makedirs(thumbs_dir, exist_ok=True)
                shutil.move(src, dst)
                os.chmod(dst, 0o644)
                migrated += 1
            except Exception as e:
                print(f"    VIGA: {e}")
                errors += 1

    if not dry_run:
        print(f"\nMigreeritud: {migrated}, vigu: {errors}")
    else:
        print(f"\nKokku {len(thumb_files)} faili (dry-run).")


if __name__ == '__main__':
    dry_run = '--dry-run' in sys.argv
    migrate(dry_run=dry_run)
