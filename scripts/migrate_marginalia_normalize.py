#!/usr/bin/env python3
"""
Ühekordne migratsioon: normaliseerib KÕIGI lehekülgede .txt marginaalia-tägid
kanoonilisele kujule (<m> välimiseks) JA koristab tühjad tagid (<m></m>, <i></i>
jms). Vt server/marginalia_normalize.py.

Taust (2026-06-13): ~1500 rida 4171-st on ristuva tägiga (<i><m>X</i></m>) →
ei renderdu editoris ega indekseeru otsingus.
Taust (2026-06-16): kopeerimised/kustutused jätsid tühje tage (<m><i></i></m>) →
ei renderdu, aga risustavad faili ja segavad mudeli treenimist.
See skript parandab olemasolevad failid; edaspidi hoiab /save + import need puhtana.

KASUTUS (serveris, Dockeris):
  docker exec vutt-backend python3 scripts/migrate_marginalia_normalize.py --dry-run
  docker exec vutt-backend python3 scripts/migrate_marginalia_normalize.py --apply

Pärast --apply: data/ git commit (käsitsi või --commit) + Meilisearch reindeks
(./scripts/server_seed_data.sh või seed-sammud), et otsing kajastaks muutust.
"""
import os
import sys
import argparse
import subprocess
import types

# Fake-package muster (väldib server/__init__.py kõrvalefekte) — vt 1-1_consolidate_data.py
_project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if 'server' not in sys.modules:
    _server_pkg = types.ModuleType('server')
    _server_pkg.__path__ = [os.path.join(_project_root, 'server')]
    _server_pkg.__package__ = 'server'
    sys.modules.setdefault('server', _server_pkg)
sys.path.insert(0, _project_root)
from server.marginalia_normalize import normalize_marginalia_tags

DATA_ROOT = os.getenv("VUTT_DATA_DIR", os.path.join(_project_root, "data"))


def find_txt_files(root):
    for dp, _, fs in os.walk(root):
        # Jäta vahele config ja .git
        if os.sep + '.git' in dp or os.sep + 'config' in dp:
            continue
        for f in fs:
            if f.endswith('.txt'):
                yield os.path.join(dp, f)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true', help='Kirjuta muudatused (muidu dry-run)')
    ap.add_argument('--commit', action='store_true', help='Pärast --apply tee data/ git commit')
    ap.add_argument('--limit', type=int, default=0, help='Töötle ainult N esimest muudetavat (test)')
    args = ap.parse_args()

    changed = []
    scanned = 0
    for path in find_txt_files(DATA_ROOT):
        scanned += 1
        try:
            with open(path, 'r', encoding='utf-8') as f:
                raw = f.read()
        except Exception as e:
            print(f"  LUGEMISVIGA {path}: {e}")
            continue
        # Töötle faile, kus on mistahes täg — normalize koristab ka inline-tühjad
        # (<i></i>) failides ILMA <m>-ta. Tagideta failid jätame vahele (kiirus).
        if '<' not in raw:
            continue
        fixed = normalize_marginalia_tags(raw)
        if fixed == raw:
            continue
        changed.append(path)
        if args.apply:
            with open(path, 'w', encoding='utf-8') as f:
                f.write(fixed)
        if args.limit and len(changed) >= args.limit:
            break

    print(f"Skanniti {scanned} .txt faili.")
    print(f"{'Muudetud' if args.apply else 'Muudaks (dry-run)'}: {len(changed)} faili.")
    for p in changed[:15]:
        print(f"   {os.path.relpath(p, DATA_ROOT)}")
    if len(changed) > 15:
        print(f"   ... ja veel {len(changed) - 15}")

    if args.apply and args.commit and changed:
        msg = f"marginaalia: normaliseeri <m> tägid kanoonilisele kujule ({len(changed)} faili)"
        try:
            subprocess.run(['git', '-C', DATA_ROOT, 'add', '-A'], check=True)
            subprocess.run(['git', '-C', DATA_ROOT, 'commit', '-m', msg], check=True)
            print(f"data/ git commit tehtud: {msg}")
        except subprocess.CalledProcessError as e:
            print(f"git commit ebaõnnestus: {e}")

    return 0


if __name__ == '__main__':
    sys.exit(main())
