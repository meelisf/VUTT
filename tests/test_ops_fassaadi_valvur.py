"""Valvur: testid ei patchi `server.prosopography.ops`-i (#690 samm 3)."""
from unittest import mock

import pytest

from server.prosopography import ops


def test_monkeypatch_fassaadil_viskab(monkeypatch):
    with pytest.raises(AssertionError, match="ops.PROSOPOGRAPHY_DIR"):
        monkeypatch.setattr(ops, "PROSOPOGRAPHY_DIR", "/tmp/x")


def test_mock_patch_stringiga_viskab():
    with pytest.raises(AssertionError, match="ops._load_index"):
        with mock.patch("server.prosopography.ops._load_index", return_value={}):
            pass


def test_silla_nimekirjast_puuduv_nimi_viskab_ka():
    with pytest.raises(AssertionError, match="ops.get_person_relation_network_ids"):
        with mock.patch.object(ops, "get_person_relation_network_ids", return_value=[]):
            pass


def test_algvaartuse_tagasipanek_on_lubatud():
    ops.get_person = ops.get_person
