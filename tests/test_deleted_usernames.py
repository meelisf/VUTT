"""Kustutatud kasutajanimede püsiv register (ADR 0043 p8).

Nime taaskasutus annaks uuele kontole vanadesse `access`-kaartidesse alles
jäänud õigused. Register on konto elutsükli AUTORITEETNE olek, mitte cache.
"""
import json

import pytest


def test_delete_user_reserveerib_nime(backend_env):
    auth = backend_env["auth"]
    admin = {"username": "admin", "role": "admin"}

    ok, _ = auth.delete_user("contrib", admin)
    assert ok

    assert auth.is_username_reserved("contrib")
    kettal = json.loads(backend_env["deleted_usernames_file"].read_text())
    assert kettal == ["contrib"]


def test_registri_kirjutusveaga_kontot_ei_eemaldata(backend_env, monkeypatch):
    auth = backend_env["auth"]
    admin = {"username": "admin", "role": "admin"}

    def katkine_write(path, data):
        raise OSError("ketas täis")

    monkeypatch.setattr(auth, "atomic_write_json", katkine_write)
    ok, sonum = auth.delete_user("contrib", admin)

    assert not ok
    assert "contrib" in auth.reload_users_cache()


def test_katkist_registrit_ei_kasitleta_tuhjana(backend_env, monkeypatch):
    auth = backend_env["auth"]
    backend_env["deleted_usernames_file"].write_text('{"vale": "kuju"}')
    monkeypatch.setattr(auth, "_deleted_usernames_cache", None)

    with pytest.raises(auth.DeletedUsernamesCorrupt):
        auth.load_deleted_usernames()


def test_reserveering_ei_blokeeri_olemasoleva_konto_sisselogimist(backend_env, login):
    auth = backend_env["auth"]
    auth.reserve_username("editor")   # jäänuk vanast impordist
    assert login("editor", "editorpass")
