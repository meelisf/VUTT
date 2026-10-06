#!/usr/bin/env python3
"""
Ühekordne migratsioon: normaliseerib KÕIGI lehekülgede .txt marginaalia-tägid
kanoonilisele kujule (<m> välimiseks) JA koristab tühjad tagid (<m></m>, <i></i>
jms). Vt server/marginalia_normalize.py.

Taust (2026-06-13): ~1500 rida 4171-st on ristuva tägiga (<i><m>X</i></m>) →
ei renderdu editoris ega indekseeru otsingus.
Taust (2026-06-16): kopeerimised/kustutused jätsid tühje tage (<m><i></i></m>) →
ei renderdu, aga risustavad faili ja segavad mudeli treenimist.
Taust (2026-10-06): ploki-rea servatühik (`<m> <i>…`, ~3 255 rida vana süntaksi
teisendusest) — trükimudel õppis selle ja kirjutas edasi.
See skript parandab olemasolevad failid; edaspidi hoiab /save + import need puhtana.

KASUTUS (serveris, Dockeris):
  docker exec vutt-backend python3 scripts/migrate_marginalia_normalize.py --dry-run
  docker exec vutt-backend python3 scripts/migrate_marginalia_normalize.py --apply --commit --sync-meili

--commit lisab AINULT muudetud failid (mitte `git add -A` — data/ tööpuus võib
olla muud). --sync-meili sünkroonib muudetud teosed ükshaaval: redaktor laeb
lehe `text_content`-i Meilist ja /save liidab selle vastu (ADR 0054), seega
peab Meili kohe failiga kattuma, mitte alles järgmise täisreindeksiga.
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
    ap.add_argument('--sync-meili', action='store_true', help='Pärast --apply sünkrooni muudetud teosed Meilisse')
    ap.add_argument('--naited', type=int, default=10, help='Mitu muudetud rida näidiseks trükkida')
    args = ap.parse_args()

    changed = []
    scanned = 0
    ridu = 0
    naited = []
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
        vanad, uued = raw.split('\n'), fixed.split('\n')
        if len(vanad) == len(uued):
            for a, b in zip(vanad, uued):
                if a != b:
                    ridu += 1
                    if len(naited) < args.naited:
                        naited.append((a, b))
        if args.apply:
            with open(path, 'w', encoding='utf-8') as f:
                f.write(fixed)
        if args.limit and len(changed) >= args.limit:
            break

    print(f"Skanniti {scanned} .txt faili.")
    print(f"{'Muudetud' if args.apply else 'Muudaks (dry-run)'}: {len(changed)} faili, "
          f"{ridu} rida (ridade arvu muutvad failid pole loetud).")
    for a, b in naited:
        print(f"   - {a!r}\n   + {b!r}")
    for p in changed[:15]:
        print(f"   {os.path.relpath(p, DATA_ROOT)}")
    if len(changed) > 15:
        print(f"   ... ja veel {len(changed) - 15}")

    if args.apply and args.commit and changed:
        msg = f"marginaalia: normaliseeri <m> tägid kanoonilisele kujule ({len(changed)} faili)"
        rel = [os.path.relpath(p, DATA_ROOT) for p in changed]
        try:
            # Partiidena — 300+ teed ei mahu alati ühte käsureale
            for i in range(0, len(rel), 200):
                subprocess.run(['git', '-C', DATA_ROOT, 'add', '--'] + rel[i:i + 200], check=True)
            subprocess.run(['git', '-C', DATA_ROOT, 'commit', '-m', msg, '--'] + rel, check=True)
            print(f"data/ git commit tehtud: {msg}")
        except subprocess.CalledProcessError as e:
            print(f"git commit ebaõnnestus: {e}")

    if args.apply and args.sync_meili and changed:
        from server.meilisearch_ops import sync_work_to_meilisearch
        kaustad = sorted({os.path.relpath(p, DATA_ROOT).split(os.sep)[0] for p in changed})
        vead = 0
        for k in kaustad:
            try:
                ok = sync_work_to_meilisearch(k)    # viga → False, mitte erind
            except Exception as e:      # üks teos ei tohi teisi peatada
                ok = False
                print(f"   Meili sünk viskas {k}: {e}")
            if not ok:
                vead += 1
                print(f"   Meili sünk ebaõnnestus: {k}")
        print(f"Meili: sünkrooniti {len(kaustad) - vead}/{len(kaustad)} teost.")
        if vead:
            return 1

    return 0


if __name__ == '__main__':
    sys.exit(main())
