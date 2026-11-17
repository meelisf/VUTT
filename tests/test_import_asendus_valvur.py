"""Asendus-upload ei tohi tavaimpordiga uueks teoseks saada.

2026-11-17: „Asenda leheküljed" alustas upload'i `replace_work_id`-ga, viisard
kaotas jätkamisel asendusrežiimi ja „Impordi" tegi duubli (bgxmdx ← jpmek8).
"""
import pytest

from server.upload import import_work


def _olek(**lisa):
    olek = {"id": "u1", "status": "reviewing", **lisa}
    kirjutatud = []

    class _Lukk:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    return (
        olek,
        kirjutatud,
        dict(
            get_upload_lock_func=lambda uid: _Lukk(),
            read_state_func=lambda uid: dict(olek),
            write_state_func=lambda uid, s: kirjutatud.append(s),
        ),
    )


def test_asendus_upload_tavaimport_keeldub_ja_ei_muuda_staatust():
    _, kirjutatud, f = _olek(replace_work_id="jpmek8")
    with pytest.raises(ValueError, match="jpmek8"):
        import_work._alusta_importi("u1", **f)
    assert kirjutatud == []


def test_tavaline_upload_alustab_importi():
    _, kirjutatud, f = _olek(replace_work_id=None)
    assert import_work._alusta_importi("u1", **f) == "reviewing"
    assert kirjutatud[-1]["status"] == "importing"
