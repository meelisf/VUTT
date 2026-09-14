"""Ühekordne juurutuse eelsamm: vanade access-kaartide tundmatud nimed registrisse."""
import pytest


def test_kogub_tundmatud_nimed():
    from scripts.import_deleted_usernames import collect_unknown_access_usernames

    kogud = [
        {"id": "ws_1", "access": {"editor": "manager", "kadunud": "viewer"}},
        {"id": "ws_2", "access": {"kadunud": "manager", "teine_kadunud": "viewer"}},
    ]
    users = {"editor": {}, "admin": {}}
    assert collect_unknown_access_usernames(kogud, users) == ["kadunud", "teine_kadunud"]


def test_katkine_kogufail_katkestab_impordi(tmp_path):
    from scripts import import_deleted_usernames as skript

    kaust = tmp_path / "work_sets"
    kaust.mkdir()
    (kaust / "ws_1.json").write_text('{"id": "ws_1", "access": {}}')
    (kaust / "ws_2.json").write_text("{ katki")

    with pytest.raises(ValueError, match="ws_2"):
        skript.load_all_work_sets(str(kaust))


def test_puuduv_kaust_ei_ole_viga(tmp_path):
    from scripts import import_deleted_usernames as skript

    assert skript.load_all_work_sets(str(tmp_path / "puudub")) == []
