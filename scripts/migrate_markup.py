#!/usr/bin/env python3
"""
migrate_markup.py — Teisendab VUTT .txt failide pseudo-markdown uueks XML märgenduseks.

Enne:  *italic*  **bold**  ~cs~  [[m:tekst]]  ==hi==  [^1]  --lk--
Pärast: <i>...</i> <b>...</b> <cs>...</cs> <m>...</m> <hi>...</hi> <fn>1</fn> <pb/>

Kasutus:
    python3 scripts/migrate_markup.py --dry-run   # vaata muudatusi
    python3 scripts/migrate_markup.py --apply     # rakenda muudatused
    python3 scripts/migrate_markup.py --apply --commit  # + git commit
"""

import os
import re
import sys
import argparse
import subprocess
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / 'data'

# Asendused rakendatakse järjestuses (** enne *, et vältida topelt asendust)
REPLACEMENTS = [
    # Bold enne italic
    (r'\*\*(.*?)\*\*', r'<b>\1</b>'),
    # Italic (multiline toetuse nimel: re.DOTALL)
    (r'\*(.*?)\*', r'<i>\1</i>'),
    # Koodivahetus
    (r'~(.*?)~', r'<cs>\1</cs>'),
    # Ääremärkus
    (r'\[\[m:(.*?)\]\]', r'<m>\1</m>'),
    # Esiletõst
    (r'==(.*?)==', r'<hi>\1</hi>'),
    # Joonealuse viite MARKER (mitte definitsioon: [^1]: tekst jääb muutmata)
    (r'\[\^(\d+)\](?!:)', r'<fn>\1</fn>'),
    # Leheküljevahetus
    (r'--lk--', r'<pb/>'),
]


def migrate_text(text: str) -> str:
    """Rakendab kõik asendused ühele teksti stringile."""
    result = text
    for pattern, replacement in REPLACEMENTS:
        result = re.sub(pattern, replacement, result, flags=re.DOTALL)
    return result


def find_txt_files() -> list[Path]:
    """Leiab kõik .txt failid data/ kataloogis."""
    return sorted(DATA_DIR.rglob('*.txt'))


def process_file(path: Path, apply: bool) -> bool:
    """Töötleb ühe faili. Tagastab True kui fail muutus."""
    try:
        original = path.read_text(encoding='utf-8')
    except Exception as e:
        print(f'  VIGA lugemisел {path}: {e}')
        return False

    migrated = migrate_text(original)
    if migrated == original:
        return False

    if apply:
        try:
            path.write_text(migrated, encoding='utf-8')
        except Exception as e:
            print(f'  VIGA kirjutamisel {path}: {e}')
            return False

    return True


def show_diff(path: Path) -> None:
    """Kuvab muudatuse diff'i."""
    original = path.read_text(encoding='utf-8')
    migrated = migrate_text(original)
    if migrated == original:
        return
    # Lihtsustatud diff — kuvame muutunud ridu
    orig_lines = original.splitlines()
    new_lines = migrated.splitlines()
    print(f'\n  {path.relative_to(DATA_DIR)}:')
    for i, (a, b) in enumerate(zip(orig_lines, new_lines)):
        if a != b:
            print(f'    rida {i+1}:')
            print(f'      - {a[:120]}')
            print(f'      + {b[:120]}')
    if len(orig_lines) != len(new_lines):
        print(f'    (ridude arv muutus: {len(orig_lines)} -> {len(new_lines)})')


def git_commit(changed_files: list[Path]) -> None:
    """Commitib muutunud failid git'i."""
    repo_root = DATA_DIR.parent
    rel_paths = [str(f.relative_to(repo_root)) for f in changed_files]

    # git add
    result = subprocess.run(['git', 'add'] + rel_paths, cwd=repo_root, capture_output=True, text=True)
    if result.returncode != 0:
        print(f'git add viga: {result.stderr}')
        return

    # git commit
    msg = f'migrate: pseudo-markdown → XML märgendus ({len(changed_files)} faili)'
    result = subprocess.run(
        ['git', 'commit', '-m', msg],
        cwd=repo_root, capture_output=True, text=True
    )
    if result.returncode != 0:
        print(f'git commit viga: {result.stderr}')
    else:
        print(f'\ngit commit OK: {result.stdout.strip()}')


def main():
    parser = argparse.ArgumentParser(description='VUTT märgenduse migratsioon')
    parser.add_argument('--dry-run', action='store_true', help='Näita muudatusi ilma rakendamata')
    parser.add_argument('--apply', action='store_true', help='Rakenda muudatused')
    parser.add_argument('--commit', action='store_true', help='Lisa git commit (--apply-ga koos)')
    parser.add_argument('--limit', type=int, default=0, help='Töötle ainult N faili (testimiseks)')
    parser.add_argument('--dir', type=str, default='', help='Töötle ainult konkreetset alamkataloogi')
    args = parser.parse_args()

    if not args.dry_run and not args.apply:
        print('Määra --dry-run või --apply')
        sys.exit(1)

    if args.commit and not args.apply:
        print('--commit nõuab --apply')
        sys.exit(1)

    if not DATA_DIR.exists():
        print(f'data/ kataloog ei leita: {DATA_DIR}')
        sys.exit(1)

    txt_files = find_txt_files()

    if args.dir:
        txt_files = [f for f in txt_files if args.dir in str(f)]

    if args.limit:
        txt_files = txt_files[:args.limit]

    print(f'Leitud {len(txt_files)} .txt faili')
    if args.dry_run:
        print('Režiim: DRY-RUN (muudatusi ei salvestata)\n')
    else:
        print(f'Režiim: APPLY\n')

    changed = []
    unchanged = 0

    for path in txt_files:
        if args.dry_run:
            original = path.read_text(encoding='utf-8')
            migrated = migrate_text(original)
            if migrated != original:
                changed.append(path)
                show_diff(path)
            else:
                unchanged += 1
        else:
            if process_file(path, apply=True):
                changed.append(path)
                print(f'  OK  {path.relative_to(DATA_DIR)}')
            else:
                unchanged += 1

    print(f'\nKokku: {len(changed)} muudetud, {unchanged} muutmata')

    if args.apply and args.commit and changed:
        git_commit(changed)
    elif args.apply and changed:
        print('\nNB! Käivita meilisearch reindekseerimine:')
        print('  python3 scripts/sync_meilisearch.py --apply')


if __name__ == '__main__':
    main()
