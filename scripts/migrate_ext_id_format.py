"""Ühekordne migratsioon: väliste identifikaatorite ühtne vorming (issue #240).

Andmetes esines sama identifikaator kahel kujul — `GND:1029967695` ja
`1029967695`, `VIAF:316024504` ja `316024504`. See lõhkus kaks asja:

1. rikastuse URL (`lobid.org/gnd/GND:123` → 404, rikastus ebaõnnestus vaikselt);
2. dublikaadikontrolli, mis võrdleb `scheme:id` võtit stringina — prefiksiga ja
   prefiksita kirje olid eri võtmed, nii et kirjutustee tegi olemasoleva kaardi
   asemel uue.

Mõlemad on nüüdseks parandatud koodis (`server/prosopography/ext_ids.py` +
normaliseerimine kirjutus- ja lugemisteel), nii et see skript on KOSMEETIKA:
teeb ka salvestatud kuju ühtlaseks. Ilma selleta töötab kõik, aga andmes on
kaks kuju kõrvuti.

`album_academicum` jäetakse teadlikult puutumata — see on staatiline baas
(kõik imporditud, juurde ei tule) ja 1603 kaardi ümberkirjutamine ei ostaks
midagi peale git-müra.

Kasutus (serveris, Dockeris — git commit peab käima konteinerist):
  docker exec vutt-backend python3 scripts/migrate_ext_id_format.py --dry-run
  docker exec vutt-backend python3 scripts/migrate_ext_id_format.py --apply
  docker exec vutt-backend python3 scripts/migrate_ext_id_format.py --apply --commit

Meilisearchi ei mõjuta (väliseid ID-sid ei indekseerita).
"""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from server.prosopography.ext_ids import normalize_ext_id  # noqa: E402

DATA_ROOT = os.getenv("VUTT_DATA_DIR", str(_PROJECT_ROOT / "data"))
PROSOPO_DIR = os.path.join(DATA_ROOT, "config", "prosopography")

# Dünaamilised baasid — siia tuleb ID-sid pidevalt juurde, seega vorming loeb.
SCHEMES = ("gnd", "viaf", "wikidata")


def normalize_identifiers(identifiers):
    """Tagastab (uued_identifikaatorid, muudatuste_arv)."""
    if not isinstance(identifiers, list):
        return identifiers, 0

    out = []
    seen = set()
    changed = 0
    for ident in identifiers:
        if not isinstance(ident, dict) or ident.get("scheme") not in SCHEMES:
            out.append(ident)
            continue

        scheme = ident.get("scheme")
        old_id = ident.get("id")
        new_id = normalize_ext_id(scheme, old_id)
        if not new_id:
            changed += 1
            continue

        key = (scheme, new_id)
        if key in seen:
            # Sama ID kaks kuju samal kaardil — esimene (rikkalikum) jääb
            changed += 1
            continue
        seen.add(key)

        if new_id != old_id:
            changed += 1
            out.append({**ident, "id": new_id})
        else:
            out.append(ident)

    return out, changed


def migrate(prosopo_dir: str, apply: bool = False, limit: int = 0) -> dict:
    """Käib kaardid läbi. `apply=False` = dry-run, midagi ei kirjutata."""
    files_changed = 0
    ids_changed = 0
    näited = []

    for fpath in sorted(Path(prosopo_dir).glob("*.json")):
        try:
            data = json.loads(fpath.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"SKIP {fpath.name}: {e}", file=sys.stderr)
            continue

        new_idents, n = normalize_identifiers(data.get("identifiers"))
        if n == 0:
            continue

        vanad = [i for i in (data.get("identifiers") or [])
                 if isinstance(i, dict) and i.get("scheme") in SCHEMES]
        näited.append((fpath.name, vanad, [i for i in new_idents
                                           if isinstance(i, dict) and i.get("scheme") in SCHEMES]))
        files_changed += 1
        ids_changed += n

        if apply:
            data["identifiers"] = new_idents
            fpath.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

        if limit and files_changed >= limit:
            break

    return {"files_changed": files_changed, "ids_changed": ids_changed, "examples": näited}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="Kirjuta muudatused (muidu dry-run)")
    ap.add_argument("--dry-run", action="store_true", help="Ainult näita (vaikimisi)")
    ap.add_argument("--commit", action="store_true", help="Pärast --apply tee data/ git commit")
    ap.add_argument("--limit", type=int, default=0, help="Ainult N esimest muudetavat faili")
    args = ap.parse_args()

    if not os.path.isdir(PROSOPO_DIR):
        print(f"Prosopograafia kaust puudub: {PROSOPO_DIR}", file=sys.stderr)
        return 1

    stats = migrate(PROSOPO_DIR, apply=args.apply, limit=args.limit)

    for name, vanad, uued in stats["examples"]:
        print(f"  {name}: {vanad} → {uued}")

    mode = "APPLY" if args.apply else "DRY-RUN"
    print(f"[{mode}] {stats['files_changed']} faili, {stats['ids_changed']} identifikaatorit.")

    if args.apply and args.commit and stats["files_changed"]:
        msg = f"Väliste identifikaatorite ühtne vorming ({stats['files_changed']} kaarti, #240)"
        try:
            subprocess.run(["git", "-C", DATA_ROOT, "add", "config/prosopography"], check=True)
            subprocess.run(["git", "-C", DATA_ROOT, "commit", "-m", msg], check=True)
            print(f"data/ git commit tehtud: {msg}")
        except subprocess.CalledProcessError as e:
            print(f"git commit ebaõnnestus: {e}", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
