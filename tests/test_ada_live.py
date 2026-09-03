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
