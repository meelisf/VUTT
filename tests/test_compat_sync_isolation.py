"""`sync_from_facade` ei tohi mocki üle testipiiri kanda (#342).

`_compat` on ühilduvussild: vanad testid patchivad `ops.py` fassaadil, uus kood
elab domeenimoodulites. Sild kandis patch'i alla — aga cache'is „originaali"
laisalt esimesel sync'il, ja kui see hetk tabas otse patchitud moodulit,
talletus MOKK originaalina ning kirjutati hiljem sõltumatusse testi tagasi.
"""
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.prosopography import _compat, ops, person_crud  # noqa: E402


def test_otsene_patch_ei_talletu_originaalina():
    """#342 reproduktsioon: mokk ei tohi ellu jääda teda seadnud testi üle."""
    paris = person_crud.get_person
    mokk = lambda pid: {"id": "MOKK"}  # noqa: E731
    try:
        person_crud.get_person = mokk
        ops.get_person = ops.get_person      # → _FACADE_DIRTY
        _compat.sync_from_facade()           # siin talletus varem mokk
    finally:
        person_crud.get_person = paris

    _compat.mark_facade_dirty()
    _compat.sync_from_facade()

    assert person_crud.get_person is paris, (
        f"LEKE: sync taastas {person_crud.get_person!r}, mitte päris funktsiooni"
    )


def test_fassaadi_patch_kantakse_alla_ja_voetakse_tagasi():
    """Sild peab ikka töötama: fassaadi patch jõuab domeenimoodulisse ja kaob."""
    paris = person_crud.get_person
    mokk = lambda pid: {"id": "FASSAAD"}  # noqa: E731
    try:
        ops.get_person = mokk
        _compat.sync_from_facade()
        assert person_crud.get_person is mokk, "fassaadi patch ei jõudnud kohale"
    finally:
        ops.get_person = paris
    _compat.sync_from_facade()
    assert person_crud.get_person is paris, "fassaadi patch ei võetud tagasi"


def test_sync_ei_kirjuta_ule_voorast_otsest_patchi():
    """Vaikeväärtusega fassaad ei tohi teise testi enda patchi maha võtta.

    Just selle pärast pidi kuus testifaili `sync_from_facade`-i neutraliseerima.
    """
    paris = person_crud.get_person
    minu_mokk = lambda pid: {"id": "MINU"}  # noqa: E731
    try:
        person_crud.get_person = minu_mokk
        _compat.mark_facade_dirty()
        _compat.sync_from_facade()
        assert person_crud.get_person is minu_mokk, "sync võttis võõra patchi maha"
    finally:
        person_crud.get_person = paris
