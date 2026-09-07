#!/usr/bin/env python3
"""Ühekordne koristus: eemalda kärpe/pöörde jäägid ._trash/{work_id}/replaced_images/ alt (#325).

Enne #325 kirjutas iga pildimuudatus sinna uue ajatempliga faili. Kiht kasvas
piiramatult, kuigi taastamiseks kasutatakse ainult ._originals pristine originaali.
Kirjutamine on nüüd lõpetatud kahes kohas; see skript koristab tekkinud jäägi.

Kaks kirjutajat eristuvad failinime ajatempli järgi:
  transform_page_image / restore_original_page_image  →  {base}_YYYYmmdd_HHMMSS_ffffff.ext
  replace-image (asenda parema skänniga)              →  {base}_YYYYmmdd_HHMMSS.ext

`replace-image` jääb ALLES: see tee kustutab ._originals kirje (routers/pages.py),
seega on tema varukoopia ainus olemasolev.

Turvareegel: kustutatakse ainult siis, kui vastav ._originals/{work_id}/{base}{ext}
on päriselt olemas. Kui ei ole (nt leht asendati hiljem), jääb fail alles.

Kasutus (SERVERIS, host-venv):
    ~/VUTT/.venv/bin/python3 scripts/cleanup_replaced_images.py          # kuivkäivitus
    ~/VUTT/.venv/bin/python3 scripts/cleanup_replaced_images.py --apply  # kustutab
"""
import argparse
import os
import re
import sys
import types

# Fake-package muster: registreerime ainult `server.config`, ilma et `server/__init__.py`
# käivituks (see impordiks FastAPI, gitpython jms, mida host-venv ei sisalda).
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if 'server' not in sys.modules:
    _pkg = types.ModuleType('server')
    _pkg.__path__ = [os.path.join(_PROJECT_ROOT, 'server')]
    _pkg.__package__ = 'server'
    sys.modules.setdefault('server', _pkg)
sys.path.insert(0, _PROJECT_ROOT)

from server.config import BASE_DIR  # noqa: E402  ← ainuõige teede allikas

TRASH_DIR = os.path.join(BASE_DIR, '._trash')
ORIGINALS_DIR = os.path.join(BASE_DIR, '._originals')

# Mikrosekundi-rühm lõpus = transform/restore. Ilma selleta = replace-image.
TRANSFORM_RE = re.compile(r'^(?P<base>.+)_\d{8}_\d{6}_\d{1,6}(?P<ext>\.[A-Za-z0-9]+)$')
PILDID = ('.jpg', '.jpeg', '.png')


def kogu_kandidaadid():
    """Tagastab (kustutatavad, sailivad, orvud) — kõik (tee, baidid) paaridena."""
    kustutatavad, sailivad, orvud = [], [], []
    if not os.path.isdir(TRASH_DIR):
        return kustutatavad, sailivad, orvud

    for work_id in sorted(os.listdir(TRASH_DIR)):
        kaust = os.path.join(TRASH_DIR, work_id, 'replaced_images')
        if not os.path.isdir(kaust):
            continue
        for nimi in sorted(os.listdir(kaust)):
            tee = os.path.join(kaust, nimi)
            if not os.path.isfile(tee) or not nimi.lower().endswith(PILDID):
                continue
            kirje = (tee, os.path.getsize(tee))
            m = TRANSFORM_RE.match(nimi)
            if not m:
                sailivad.append(kirje)           # replace-image → ainus koopia
                continue
            pristine = os.path.join(ORIGINALS_DIR, work_id,
                                    m.group('base') + m.group('ext'))
            (kustutatavad if os.path.exists(pristine) else orvud).append(kirje)
    return kustutatavad, sailivad, orvud


def mb(baidid):
    return baidid / 2 ** 20


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--apply', action='store_true',
                    help='kustuta päriselt (vaikimisi ainult kuivkäivitus)')
    args = ap.parse_args()

    kustutatavad, sailivad, orvud = kogu_kandidaadid()

    print(f"BASE_DIR = {BASE_DIR}")
    print(f"  kustutatav (kärbe/pööre, ._originals olemas): "
          f"{len(kustutatavad):5d} faili, {mb(sum(b for _, b in kustutatavad)):9.1f} MB")
    print(f"  säilib (replace-image, ainus koopia):         "
          f"{len(sailivad):5d} faili, {mb(sum(b for _, b in sailivad)):9.1f} MB")
    print(f"  säilib (kärbe/pööre, ._originals PUUDUB):     "
          f"{len(orvud):5d} faili, {mb(sum(b for _, b in orvud)):9.1f} MB")

    if orvud:
        print("\n  Ilma pristine originaalita (jäävad alles, vaata üle):")
        for tee, _ in orvud[:20]:
            print(f"    {os.path.relpath(tee, BASE_DIR)}")
        if len(orvud) > 20:
            print(f"    … ja veel {len(orvud) - 20}")

    if not args.apply:
        print("\nKUIVKÄIVITUS — midagi ei kustutatud. Päriselt: --apply")
        return 0

    kustutatud = vabastatud = 0
    for tee, baidid in kustutatavad:
        try:
            os.remove(tee)
            kustutatud += 1
            vabastatud += baidid
        except OSError as e:
            print(f"  VIGA {tee}: {e}")

    # Tühjaks jäänud replaced_images kaustad ära (ülemist ._trash/{work_id} EI puutu)
    tyhjad = 0
    for work_id in sorted(os.listdir(TRASH_DIR)):
        kaust = os.path.join(TRASH_DIR, work_id, 'replaced_images')
        if os.path.isdir(kaust) and not os.listdir(kaust):
            os.rmdir(kaust)
            tyhjad += 1

    print(f"\nKustutatud {kustutatud} faili, vabastatud {mb(vabastatud):.1f} MB, "
          f"eemaldatud {tyhjad} tühja kausta.")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
