"""Kontrollib, et fixture'id vastavad ENDISELT elavale ADA-le.

Vaikimisi vahele jäetud (pytest.ini: addopts = -m "not live").
Käsitsi: `.venv/bin/pytest tests/test_ada_live.py -m live`
"""
import pytest

from server.ada import client

pytestmark = pytest.mark.live


def test_elav_ada_annab_endiselt_65_pdfi():
    tulemus = client.lookup("10062/7822")
    assert len(tulemus["failid"]) == 65
    assert tulemus["meta"]["ester_id"] == "b1812728"


def test_elav_ada_uuid_tee_annab_sama():
    """item-by-UUID tee (`/core/items/{uuid}`) peab andma sama sisu, mis
    item-by-handle tee (`/pid/find`) — fixture'id ei saa seda kontrollida,
    sest need serveerivad mõlemale teele sama item.json'i."""
    tulemus = client.lookup("5a495195-44c1-463b-a425-643dc4dcf13f")
    assert len(tulemus["failid"]) == 65
    assert tulemus["meta"]["ester_id"] == "b1812728"
