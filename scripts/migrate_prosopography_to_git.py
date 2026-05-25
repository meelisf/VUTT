#!/usr/bin/env python3
"""
Migreerib prosopograafia isikukaardid state/prosopography/ → data/config/prosopography/
ja loob git-initsiaalse commit-i.

Käivita AINULT ÜKS KORD serveris:
    .venv/bin/python3 scripts/migrate_prosopography_to_git.py

Skript on idempotentne — kui failid on juba sihtkohas, ei tee kahju.
"""
import os
import sys
import shutil
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))


def migrate():
    from server.config import PROSOPOGRAPHY_DIR, STATE_DIR
    from server.git_ops import get_or_init_repo, BASE_DIR
    from git import Actor

    src_dir = Path(STATE_DIR) / "prosopography"
    dst_dir = Path(PROSOPOGRAPHY_DIR)

    if not src_dir.exists():
        print(f"Lähtekausta {src_dir} ei leitud — midagi migreerida pole.")
        return

    dst_dir.mkdir(parents=True, exist_ok=True)

    json_files = [f for f in src_dir.glob("*.json") if f.is_file()]
    print(f"Leitud {len(json_files)} isikukaarti {src_dir}")

    copied = 0
    skipped = 0
    for src_file in json_files:
        dst_file = dst_dir / src_file.name
        if dst_file.exists():
            skipped += 1
            continue
        shutil.copy2(str(src_file), str(dst_file))
        copied += 1

    print(f"Kopeeritud: {copied}, vahele jäetud (juba olemas): {skipped}")

    if copied == 0:
        print("Kõik failid on juba sihtkohas — git commit vahele jäetud.")
        return

    # Git commit
    repo = get_or_init_repo()
    relative_files = []
    for f in json_files:
        dst = dst_dir / f.name
        if dst.exists():
            rel = os.path.relpath(str(dst), BASE_DIR)
            relative_files.append(rel)

    repo.index.add(relative_files)
    actor = Actor("VUTT Server", "vutt@vutt.local")
    total = len(json_files)
    repo.index.commit(
        f"Prosopo migratsioon: {total} isikut",
        author=actor,
        committer=actor,
    )
    print(f"Git commit tehtud: Prosopo migratsioon: {total} isikut")
    print("Migratsioon valmis.")


if __name__ == "__main__":
    migrate()
