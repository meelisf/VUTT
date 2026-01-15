#!/usr/bin/env python3
"""
VUTT: Vanade backup-failide migreerimine Git ajalukku.

See skript:
1. Leiab kõik .txt failid andmekaustas
2. Leiab iga faili jaoks vanad .backup.* failid
3. Impordib need Git commitidena (kronoloogilises järjekorras)
4. Säilitab originaalsed ajatemplid commit kuupäevadena

Käivita serveris ühe korra:
    cd /path/to/data
    python3 /path/to/scripts/migrate_backups_to_git.py

Parameetrid:
    --dry-run       Näitab mida teeks, ei muuda midagi
    --delete-backups  Kustutab vanad .backup failid pärast migratsiooni
"""

import os
import sys
import glob
import argparse
from datetime import datetime, timezone

# Lisa projekti juurkaust importimiseks
script_dir = os.path.dirname(os.path.abspath(__file__))
project_dir = os.path.dirname(script_dir)
sys.path.insert(0, project_dir)

try:
    from git import Repo, Actor
    from git.exc import InvalidGitRepositoryError
except ImportError:
    print("VIGA: GitPython pole paigaldatud!")
    print("Käivita: pip install GitPython")
    sys.exit(1)


def get_backup_date(backup_path):
    """Eraldab backup failist kuupäeva (timezone-aware)."""
    filename = os.path.basename(backup_path)

    if filename.endswith('.backup.ORIGINAL'):
        # ORIGINAL: kasutame faili muutmisaega
        return datetime.fromtimestamp(os.path.getmtime(backup_path), tz=timezone.utc)

    # Parse: fail.txt.backup.20260115_143022
    try:
        parts = filename.rsplit('.backup.', 1)
        if len(parts) == 2:
            timestamp_str = parts[1]
            dt = datetime.strptime(timestamp_str, "%Y%m%d_%H%M%S")
            # Lisa timezone
            return dt.replace(tzinfo=timezone.utc)
    except ValueError:
        pass

    # Fallback: faili muutmisaeg
    return datetime.fromtimestamp(os.path.getmtime(backup_path), tz=timezone.utc)


def migrate_file_backups(txt_path, repo, dry_run=False):
    """Migreerib ühe faili vanad backupid Git commitideks."""
    backups = glob.glob(f"{txt_path}.backup.*")

    if not backups:
        return 0

    # Sorteeri: ORIGINAL esimeseks, siis ajatemplid kronoloogilises järjekorras
    original = [b for b in backups if 'ORIGINAL' in b]
    timestamped = sorted([b for b in backups if 'ORIGINAL' not in b])

    # Kronoloogiline järjekord (vanim enne)
    ordered_backups = original + timestamped

    base_dir = repo.working_dir
    relative_path = os.path.relpath(txt_path, base_dir)

    commits_made = 0

    for backup_path in ordered_backups:
        backup_date = get_backup_date(backup_path)
        is_original = 'ORIGINAL' in backup_path

        if is_original:
            message = f"Originaal OCR: {relative_path}"
        else:
            message = f"Muudatus {backup_date.strftime('%d.%m.%Y %H:%M')}: {relative_path}"

        if dry_run:
            print(f"  [DRY-RUN] Commit: {message} ({backup_date.isoformat()})")
            commits_made += 1
            continue

        # Loe backup sisu
        try:
            with open(backup_path, 'r', encoding='utf-8') as f:
                content = f.read()
        except Exception as e:
            print(f"  VIGA lugemisel {backup_path}: {e}")
            continue

        # Kirjuta txt faili (ajutiselt)
        with open(txt_path, 'w', encoding='utf-8') as f:
            f.write(content)

        # Lisa ja commit
        repo.index.add([relative_path])

        author = Actor("Migratsioon", "migrate@vutt.local")

        try:
            repo.index.commit(
                message,
                author=author,
                committer=author,
                author_date=backup_date,
                commit_date=backup_date
            )
            commits_made += 1
            print(f"  Commit: {message}")
        except Exception as e:
            print(f"  VIGA commitimisel: {e}")

    return commits_made


def main():
    parser = argparse.ArgumentParser(
        description='Migreeri VUTT backup failid Git ajalukku'
    )
    parser.add_argument(
        '--data-dir',
        default=os.environ.get('VUTT_DATA_DIR', '/home/mf/Dokumendid/LLM/tartu-acad/data/04_sorditud_dokumendid/'),
        help='Andmekausta tee (vaikimisi: VUTT_DATA_DIR või default)'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Näitab mida teeks, ei muuda midagi'
    )
    parser.add_argument(
        '--delete-backups',
        action='store_true',
        help='Kustutab vanad .backup failid pärast migratsiooni'
    )

    args = parser.parse_args()

    data_dir = args.data_dir

    if not os.path.exists(data_dir):
        print(f"VIGA: Andmekausta ei leitud: {data_dir}")
        sys.exit(1)

    print(f"VUTT Backup -> Git migratsioon")
    print(f"Andmekaust: {data_dir}")
    print(f"Dry-run: {args.dry_run}")
    print("-" * 50)

    # Initsialiseeri või ava Git repo
    try:
        repo = Repo(data_dir)
        print(f"Git repo leitud: {data_dir}")
    except InvalidGitRepositoryError:
        if args.dry_run:
            print(f"[DRY-RUN] Git repo initsialiseeritakse: {data_dir}")
            repo = None
        else:
            repo = Repo.init(data_dir)
            print(f"Git repo initsialiseeritud: {data_dir}")

            # Loome .gitignore
            gitignore_path = os.path.join(data_dir, '.gitignore')
            with open(gitignore_path, 'w') as f:
                f.write("# VUTT Git versioonihaldus\n")
                f.write("*.jpg\n")
                f.write("*.jpeg\n")
                f.write("*.png\n")
                f.write("*.backup.*\n")
                f.write("_metadata.json\n")
                f.write("*.json\n")
            print("Loodud .gitignore")

    # Leia kõik txt failid
    txt_files = glob.glob(os.path.join(data_dir, "**/*.txt"), recursive=True)
    # Filtreeri välja backup failid
    txt_files = [f for f in txt_files if '.backup.' not in f]

    print(f"Leitud {len(txt_files)} tekstifaili")
    print("-" * 50)

    total_commits = 0
    files_with_backups = 0
    backup_files_found = 0

    for txt_path in sorted(txt_files):
        backups = glob.glob(f"{txt_path}.backup.*")
        if backups:
            backup_files_found += len(backups)
            files_with_backups += 1
            relative = os.path.relpath(txt_path, data_dir)
            print(f"\n{relative} ({len(backups)} backup)")

            if repo:
                commits = migrate_file_backups(txt_path, repo, args.dry_run)
                total_commits += commits

    print("\n" + "=" * 50)
    print(f"KOKKUVÕTE:")
    print(f"  Faile backup-idega: {files_with_backups}")
    print(f"  Backup-faile kokku: {backup_files_found}")
    print(f"  Git committe {'(tehtaks)' if args.dry_run else 'tehtud'}: {total_commits}")

    # Kustuta vanad backup failid
    if args.delete_backups and not args.dry_run and total_commits > 0:
        print("\nKutsutan vanu backup faile...")
        deleted = 0
        for txt_path in txt_files:
            for backup in glob.glob(f"{txt_path}.backup.*"):
                try:
                    os.remove(backup)
                    deleted += 1
                except Exception as e:
                    print(f"  VIGA kustutamisel {backup}: {e}")
        print(f"Kustutatud {deleted} backup-faili")

    if args.dry_run:
        print("\n[DRY-RUN] Tegelikke muudatusi ei tehtud.")
        print("Käivita ilma --dry-run liputa, et migreerida.")


if __name__ == "__main__":
    main()
