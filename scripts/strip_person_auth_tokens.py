"""Ühekordne puhastus: eemalda salvestatud isikukaartidelt sessioonitoken (#237).

`GET /api/files/prosopography/{id}` on autentimata avalik endpoint ja tagastas
kaardi JSON-i tervikuna. Osal kaartidest oli väljal `auth_token` kellegi
sessioonitoken, mis oli kunagi PUT-keha kaudu kaardi külge salvestunud.

Lugemistee filter (`person_crud.get_person`, SECRET_FIELDS) on tegelik parandus
ja katab ka selle, kui mõni tulevane kirjutustee jälle lekitab. See skript
puhastab lisaks salvestatud failid, et saast git-ajalukku edasi ei kanduks.

Kasutus (serveris, Dockeris — data/ git commitib root'ina):
  docker exec vutt-backend python3 scripts/strip_person_auth_tokens.py --dry-run
  docker exec vutt-backend python3 scripts/strip_person_auth_tokens.py --apply
  docker exec vutt-backend python3 scripts/strip_person_auth_tokens.py --apply --commit

Väljundis EI kuvata tokeni väärtust — ainult failinimi ja pikkus.
Meilisearchi ei mõjuta (`auth_token` ei ole indekseeritav väli).
"""
import argparse
import json
import os
import subprocess
import sys
import types
from pathlib import Path

# Fake-package muster (vt scripts/detect_greek.py): registreerib `server`
# nimeruumi ILMA `server/__init__.py` käivitamiseta, et hosti venv-is puuduvad
# sõltuvused (fastapi, gitpython) skripti alla ei tõmbaks.
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if "server" not in sys.modules:
    _server_pkg = types.ModuleType("server")
    _server_pkg.__path__ = [os.path.join(_PROJECT_ROOT, "server")]
    _server_pkg.__package__ = "server"
    sys.modules.setdefault("server", _server_pkg)
sys.path.insert(0, _PROJECT_ROOT)

# Sama loend nagu server/prosopography/person_crud.py SECRET_FIELDS.
# Skript ei impordi seda otse: person_crud tõmbaks kaasa gitpythoni.
SECRET_FIELDS = ("auth_token", "token")


def _prosopo_dir() -> str:
    """server.config on ainuõige allikas."""
    from server.config import PROSOPOGRAPHY_DIR
    return PROSOPOGRAPHY_DIR


def _strip_record(data: dict) -> list:
    """Eemaldab salajased väljad kohapeal. Tagastab eemaldatud väljanimed."""
    removed = []
    for key in SECRET_FIELDS:
        if key in data:
            value = data.pop(key)
            removed.append((key, len(value) if isinstance(value, str) else "?"))
    return removed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true",
                    help="Kirjuta muudatused (vaikimisi dry-run)")
    ap.add_argument("--dry-run", action="store_true",
                    help="Ainult näita (vaikimisi, kui --apply puudub)")
    ap.add_argument("--commit", action="store_true",
                    help="Pärast --apply tee data/ git commit")
    args = ap.parse_args()

    prosopo_dir = _prosopo_dir()
    if not os.path.isdir(prosopo_dir):
        print("Prosopograafia kaust puudub: {}".format(prosopo_dir), file=sys.stderr)
        return 1

    changed_paths = []
    scanned = 0
    for fpath in sorted(Path(prosopo_dir).glob("*.json")):
        scanned += 1
        try:
            data = json.loads(fpath.read_text(encoding="utf-8"))
        except Exception as e:
            print("SKIP {}: {}".format(fpath.name, e), file=sys.stderr)
            continue
        if not isinstance(data, dict):
            continue

        removed = _strip_record(data)
        if not removed:
            continue

        fields = ", ".join("{} ({} märki)".format(k, n) for k, n in removed)
        print("{} {}: {}".format("[apply]" if args.apply else "[dry-run]",
                                 fpath.name, fields))
        changed_paths.append(fpath)
        if args.apply:
            fpath.write_text(json.dumps(data, ensure_ascii=False, indent=2),
                             encoding="utf-8")

    mode = "APPLY" if args.apply else "DRY-RUN"
    print("[{}] {} faili skaneeritud, {} puhastatud.".format(
        mode, scanned, len(changed_paths)))

    if args.apply and args.commit and changed_paths:
        # Laval AINULT need failid, mida see skript muutis — `git add -A` haaraks
        # kaasa paralleelselt toimetatud kaardid (vt CLAUDE.md andmeasukohad).
        from server.config import BASE_DIR  # data/ juur, kus sisemine git elab
        rel = [os.path.relpath(str(p), BASE_DIR) for p in changed_paths]
        msg = "Turvalisus: eemalda sessioonitoken {} isikukaardilt (#237)".format(
            len(changed_paths))
        try:
            subprocess.run(["git", "-C", BASE_DIR, "add"] + rel, check=True)
            subprocess.run(["git", "-C", BASE_DIR, "commit", "-m", msg], check=True)
            print("data/ git commit tehtud: {}".format(msg))
        except subprocess.CalledProcessError as e:
            print("git commit ebaõnnestus: {}".format(e), file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
