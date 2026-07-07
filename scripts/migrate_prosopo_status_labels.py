"""Ühekordne migratsioon: backfill mitmekeelsed `labels` staatuse/konfessiooni sildile.

Vanad prosopograafia kaardid salvestasid statuses[]/confessions[] ainult eesti
`label`-iga (ilma `labels` objektita) → detail-leht kuvab need eesti keeles ka
inglise UI-s. See skript lisab igale kirjele `labels` objekti (nt {"et":..,"en":..})
sõnavarast (`vocabularies.json` → seisused/konfessioonid), id järgi. Kuna
`useEntityLabel` eelistab `labels[lang]`, parandab see KÕIK kuvakohad korraga.

Kasutus (serveris, Dockeris):
  docker exec vutt-backend python3 scripts/migrate_prosopo_status_labels.py --dry-run
  docker exec vutt-backend python3 scripts/migrate_prosopo_status_labels.py --apply
  docker exec vutt-backend python3 scripts/migrate_prosopo_status_labels.py --apply --commit

Pärast --apply tee data/ git commit (käsitsi või --commit). Meilisearchi ei mõjuta
(staatus/konfessioon ei ole otsingu-väljad).
"""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = os.getenv("VUTT_DATA_DIR", str(_PROJECT_ROOT / "data"))
CONFIG_DIR = os.path.join(DATA_ROOT, "config")
VOCAB_FILE = os.path.join(CONFIG_DIR, "vocabularies.json")
PROSOPO_DIR = os.path.join(CONFIG_DIR, "prosopography")

FIELDS = ("statuses", "confessions")
VOCAB_KEYS = {"statuses": "seisused", "confessions": "konfessioonid"}


def _load_vocab_map():
    """Ehita {field: {id: label_dict}} sõnavarast."""
    with open(VOCAB_FILE, "r", encoding="utf-8") as f:
        vocab = json.load(f)
    maps = {}
    for field, vkey in VOCAB_KEYS.items():
        m = {}
        for item in vocab.get(vkey, []) or []:
            iid = item.get("id")
            label = item.get("label")
            if iid and isinstance(label, dict):
                # Ainult mittetühjad keeleväärtused
                clean = {k: v for k, v in label.items() if v}
                if clean:
                    m[iid] = clean
        maps[field] = m
    return maps


def _migrate_record(data, maps):
    """Muuda kirjet kohapeal; tagasta muudetud kirjete arv."""
    changed = 0
    for field in FIELDS:
        entries = data.get(field)
        if not isinstance(entries, list):
            continue
        vmap = maps.get(field, {})
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            iid = entry.get("id")
            if not iid or iid not in vmap:
                continue
            new_labels = vmap[iid]
            if entry.get("labels") != new_labels:
                entry["labels"] = new_labels
                changed += 1
    return changed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="Kirjuta muudatused (muidu dry-run)")
    ap.add_argument("--dry-run", action="store_true", help="Ainult näita muudatusi (vaikimisi, kui --apply puudub)")
    ap.add_argument("--commit", action="store_true", help="Pärast --apply tee data/ git commit")
    ap.add_argument("--limit", type=int, default=0, help="Töötle ainult N esimest muudetavat faili (test)")
    args = ap.parse_args()

    if not os.path.exists(VOCAB_FILE):
        print(f"Sõnavara puudub: {VOCAB_FILE}", file=sys.stderr)
        return 1
    if not os.path.isdir(PROSOPO_DIR):
        print(f"Prosopograafia kaust puudub: {PROSOPO_DIR}", file=sys.stderr)
        return 1

    maps = _load_vocab_map()
    print(f"Sõnavara: {len(maps['statuses'])} seisust, {len(maps['confessions'])} konfessiooni")

    files_changed = 0
    entries_changed = 0
    for fpath in sorted(Path(PROSOPO_DIR).glob("*.json")):
        try:
            data = json.loads(fpath.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"SKIP {fpath.name}: {e}", file=sys.stderr)
            continue

        n = _migrate_record(data, maps)
        if n == 0:
            continue

        files_changed += 1
        entries_changed += n
        if args.apply:
            fpath.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        else:
            print(f"[dry-run] {fpath.name}: {n} kirjet")

        if args.limit and files_changed >= args.limit:
            break

    mode = "APPLY" if args.apply else "DRY-RUN"
    print(f"[{mode}] {files_changed} faili, {entries_changed} kirjet backfill'itud.")

    if args.apply and args.commit and files_changed:
        msg = f"Backfill mitmekeelsed labels staatuse/konfessiooni sildile ({files_changed} kaarti)"
        try:
            subprocess.run(["git", "-C", DATA_ROOT, "add", "-A", "config/prosopography"], check=True)
            subprocess.run(["git", "-C", DATA_ROOT, "commit", "-m", msg], check=True)
            print(f"data/ git commit tehtud: {msg}")
        except subprocess.CalledProcessError as e:
            print(f"git commit ebaõnnestus: {e}", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
