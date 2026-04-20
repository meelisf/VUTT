#!/usr/bin/env python3
"""
Eemaldab konkreetse vutt:P isiku viited kõigist _metadata.json failidest.
publisher/creators/tags väljades: id eemaldatakse, label jääb alles.

Käivitus (serveris, VUTT/ kataloogis):
    python3 scripts/dereference_person_from_works.py <vutt:Pxxxxxx> [--dry-run]

Näide:
    python3 scripts/dereference_person_from_works.py vutt:P0r3s3u --dry-run
    python3 scripts/dereference_person_from_works.py vutt:P0r3s3u
"""

import json, glob, os, sys, subprocess
from datetime import datetime, timezone

DRY_RUN = "--dry-run" in sys.argv
ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]

if not ARGS:
    print("Kasutus: python3 scripts/dereference_person_from_works.py <vutt:Pxxxxxx> [--dry-run]")
    sys.exit(1)

PERSON_ID = ARGS[0]
if not PERSON_ID.startswith("vutt:P"):
    print(f"Viga: ID peab algama 'vutt:P', saadi '{PERSON_ID}'")
    sys.exit(1)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")


def dereference_entity(obj: dict, person_id: str) -> bool:
    """Eemaldab id välja kui see vastab person_id-le. Tagastab True kui muutus."""
    if isinstance(obj, dict) and obj.get("id") == person_id:
        del obj["id"]
        if "source" in obj:
            del obj["source"]
        if "labels" in obj:
            del obj["labels"]
        return True
    return False


changed_files = []

meta_files = glob.glob(os.path.join(DATA_DIR, "*", "_metadata.json"))
for fpath in sorted(meta_files):
    try:
        with open(fpath, encoding="utf-8") as f:
            meta = json.load(f)
    except Exception as e:
        print(f"  VIGA lugemisel {fpath}: {e}")
        continue

    changed = False

    # publisher
    if dereference_entity(meta.get("publisher") or {}, PERSON_ID):
        changed = True

    # creators
    for c in (meta.get("creators") or []):
        if dereference_entity(c, PERSON_ID):
            changed = True

    # tags
    for t in (meta.get("tags") or []):
        if dereference_entity(t, PERSON_ID):
            changed = True

    if changed:
        slug = os.path.basename(os.path.dirname(fpath))
        label = (meta.get("publisher") or {}).get("label") or meta.get("title") or slug
        print(f"  {'[dry-run] ' if DRY_RUN else ''}Dereferencin {slug} ({label})")
        changed_files.append(fpath)
        if not DRY_RUN:
            with open(fpath, "w", encoding="utf-8") as f:
                json.dump(meta, f, ensure_ascii=False, indent=2)

print(f"\nKokku: {len(changed_files)} faili {'muudetaks' if DRY_RUN else 'muudetud'}.")

if not DRY_RUN and changed_files:
    # data/ on omas gitis (VUTT peamine repo ignoreerib data/ kausta)
    print("Git commit (data/ sisemises gitis)...")
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    msg = f"scripts: dereference {PERSON_ID} teostest ({len(changed_files)} faili) [{now}]"
    # Relative paths data/ repo jaoks
    rel_files = [os.path.relpath(f, DATA_DIR) for f in changed_files]
    try:
        subprocess.run(["git", "-C", DATA_DIR, "add"] + rel_files, check=True)
        subprocess.run(["git", "-C", DATA_DIR, "commit", "-m", msg], check=True)
        print("Git commit OK.")
    except subprocess.CalledProcessError as e:
        print(f"Git viga: {e}")
        sys.exit(1)

    print(f"\nValmis. Käivita järgmisena rebuild_indices serveris:")
    print(f"  curl -X POST http://localhost:8002/prosopography/admin/rebuild-indices \\")
    print(f"       -H 'Authorization: Bearer <admin_token>'")
