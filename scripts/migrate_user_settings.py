#!/usr/bin/env python3
"""
Migreerib kasutaja andmed uude struktuuri.

Jooksuta serveril ENNE uue koodi deployd:
  ssh vutt
  cd ~/VUTT
  python3 scripts/migrate_user_settings.py

Teeb järgmist:
  1. Mergib state/user_chars/{user}.json → state/user_settings/{user}.json
  2. Mergib data/state/user_settings/{user}.json → state/user_settings/{user}.json
  3. Nimetab vanad kaustad .bak laiendiga ümber (ei kustuta kohe)
"""
import json
import shutil
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
STATE_DIR = BASE / "state"
USER_CHARS_DIR = STATE_DIR / "user_chars"
USER_SETTINGS_DIR = STATE_DIR / "user_settings"
DATA_STATE_USER_SETTINGS = BASE / "data" / "state" / "user_settings"


def _load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def _save(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def main():
    USER_SETTINGS_DIR.mkdir(exist_ok=True)
    merged_users: set = set()

    # Samm 1: user_chars → user_settings (characters)
    if USER_CHARS_DIR.exists():
        for f in sorted(USER_CHARS_DIR.glob("*.json")):
            username = f.stem
            old = _load(f)
            target = USER_SETTINGS_DIR / f"{username}.json"
            existing = _load(target)
            if "characters" in old and "characters" not in existing:
                existing["characters"] = old["characters"]
                print(f"  [{username}] characters migreeritud user_chars → user_settings")
            _save(target, existing)
            merged_users.add(username)

    # Samm 2: data/state/user_settings → state/user_settings (ülejäänud võtmed)
    if DATA_STATE_USER_SETTINGS.exists():
        for f in sorted(DATA_STATE_USER_SETTINGS.glob("*.json")):
            username = f.stem
            old = _load(f)
            target = USER_SETTINGS_DIR / f"{username}.json"
            existing = _load(target)
            added = []
            for key, value in old.items():
                if key not in existing:
                    existing[key] = value
                    added.append(key)
            if added:
                print(f"  [{username}] lisatud data/state/user_settings-st: {added}")
            _save(target, existing)
            merged_users.add(username)

    if not merged_users:
        print("Migreerida pole midagi.")
        return

    print(f"\nMigreeritud kasutajad: {sorted(merged_users)}")

    # Samm 3: nimeta vanad kaustad .bak-iks
    if USER_CHARS_DIR.exists():
        bak = STATE_DIR / "user_chars.bak"
        shutil.move(str(USER_CHARS_DIR), str(bak))
        print(f"Varundatud: state/user_chars → state/user_chars.bak")

    if DATA_STATE_USER_SETTINGS.exists():
        bak = BASE / "data" / "state" / "user_settings.bak"
        shutil.move(str(DATA_STATE_USER_SETTINGS), str(bak))
        print(f"Varundatud: data/state/user_settings → data/state/user_settings.bak")

    print("\nMigratsioon valmis. Kontrolli state/user_settings/ sisu enne .bak kaustade kustutamist.")


if __name__ == "__main__":
    main()
