"""Parooli-taastamise token-mooduli unit-testid.

Failipõhised laadijad on monkeypatch'itud tmp-failile, et vältida reaalset I/O-d
ja jagatud olekut. Kasutajate fail (`load_users`) samuti tmp-failile.
"""
import json
from datetime import datetime, timedelta

import pytest

import server.password_reset as pr


@pytest.fixture
def reset_env(tmp_path, monkeypatch):
    tokens_file = tmp_path / "reset_tokens.json"
    tokens_file.write_text('{"tokens": []}', encoding="utf-8")
    users_file = tmp_path / "users.json"
    users_file.write_text(
        json.dumps({
            "mari": {"password_hash": "x", "name": "Mari Maa", "role": "editor"},
            "juku": {"password_hash": "y", "name": "Juku Tamm", "role": "contributor"},
        }),
        encoding="utf-8",
    )
    monkeypatch.setattr(pr, "RESET_TOKENS_FILE", str(tokens_file))
    # load_users loeb auth.USERS_FILE kaudu; pr.load_users on viide auth.load_users-le
    import server.auth as auth
    monkeypatch.setattr(auth, "USERS_FILE", str(users_file))
    monkeypatch.setattr(auth, "_users_cache", None)
    return {"tokens_file": tokens_file, "users_file": users_file}


def test_create_reset_token_kehtivale_kasutajale(reset_env):
    token_data, error = pr.create_reset_token("mari", "admin")
    assert error is None
    assert token_data["username"] == "mari"
    assert token_data["name"] == "Mari Maa"
    assert token_data["used"] is False
    assert token_data["revoked"] is False
    assert len(token_data["token"]) >= 32  # uuid4


def test_create_reset_token_olematu_kasutaja(reset_env):
    token_data, error = pr.create_reset_token("puudub", "admin")
    assert token_data is None
    assert error is not None


def test_validate_kehtiv(reset_env):
    token_data, _ = pr.create_reset_token("mari", "admin")
    got, error = pr.validate_reset_token(token_data["token"])
    assert error is None
    assert got["username"] == "mari"


def test_validate_olematu(reset_env):
    got, error = pr.validate_reset_token("ei-eksisteeri")
    assert got is None
    assert error is not None


def test_validate_aegunud(reset_env):
    token_data, _ = pr.create_reset_token("mari", "admin")
    # Sea aegumine minevikku
    data = pr.load_reset_tokens()
    data["tokens"][0]["expires_at"] = (datetime.now() - timedelta(hours=1)).isoformat()
    pr.save_reset_tokens(data)
    got, error = pr.validate_reset_token(token_data["token"])
    assert got is None
    assert "aeg" in error.lower()


def test_consume_uhekordne(reset_env):
    token_data, _ = pr.create_reset_token("mari", "admin")
    tok = token_data["token"]
    first, e1 = pr._validate_and_consume_token(tok)
    assert e1 is None and first is not None
    second, e2 = pr._validate_and_consume_token(tok)
    assert second is None and e2 is not None  # juba kasutatud


def test_unconsume_taastab(reset_env):
    token_data, _ = pr.create_reset_token("mari", "admin")
    tok = token_data["token"]
    pr._validate_and_consume_token(tok)
    pr._unconsume_token(tok)
    got, error = pr.validate_reset_token(tok)
    assert error is None and got is not None


def test_uus_token_tuhistab_varasema(reset_env):
    first, _ = pr.create_reset_token("mari", "admin")
    second, _ = pr.create_reset_token("mari", "admin")
    # Esimene peab olema revoked superseded
    data = pr.load_reset_tokens()
    by_token = {t["token"]: t for t in data["tokens"]}
    assert by_token[first["token"]]["revoked"] is True
    assert by_token[first["token"]]["revocation_reason"] == "superseded"
    assert by_token[second["token"]]["revoked"] is False
    # Valideerimine: esimene → tühistatud viga, teine OK
    _, e1 = pr.validate_reset_token(first["token"])
    assert e1 is not None
    got2, e2 = pr.validate_reset_token(second["token"])
    assert e2 is None and got2 is not None


def test_revoke_user_reset_tokens(reset_env):
    t1, _ = pr.create_reset_token("mari", "admin")
    n = pr.revoke_user_reset_tokens("mari", "role_changed")
    assert n == 1
    _, error = pr.validate_reset_token(t1["token"])
    assert error is not None


def test_passiivne_puhastus_eemaldab_vanad(reset_env):
    # Loo token, sea aegumine 8 päeva minevikku, siis loo uus → vana kustub failist
    old, _ = pr.create_reset_token("mari", "admin")
    data = pr.load_reset_tokens()
    data["tokens"][0]["expires_at"] = (datetime.now() - timedelta(days=8)).isoformat()
    pr.save_reset_tokens(data)
    pr.create_reset_token("juku", "admin")
    data2 = pr.load_reset_tokens()
    tokens = [t["token"] for t in data2["tokens"]]
    assert old["token"] not in tokens  # > 7 päeva vana eemaldatud


def test_complete_reset_muudab_hashi_ja_kustutab_sessioonid(reset_env, monkeypatch):
    import server.auth as auth
    # Loo aktiivne sessioon kasutajale mari
    auth.sessions.clear()
    auth.sessions["tok-mari"] = {"user": {"username": "mari"}, "created_at": datetime.now().isoformat()}
    token_data, _ = pr.create_reset_token("mari", "admin")

    result, error = pr.complete_password_reset(token_data["token"], "uusparool1234")
    assert error is None
    assert result["username"] == "mari"
    # Uus hash on bcrypt
    users = auth.load_users()
    assert users["mari"]["password_hash"].startswith("$2b$")
    assert auth.bcrypt.checkpw(b"uusparool1234", users["mari"]["password_hash"].encode())
    # Sessioon kustutatud
    assert "tok-mari" not in auth.sessions


def test_complete_reset_nork_parool_keeldub(reset_env):
    token_data, _ = pr.create_reset_token("mari", "admin")
    result, error = pr.complete_password_reset(token_data["token"], "lyhike")
    assert result is None
    assert error is not None
    # Token EI tohi olla tarbitud (parool ei läbinud poliitikat enne consume'i)
    got, e = pr.validate_reset_token(token_data["token"])
    assert e is None and got is not None


def test_complete_reset_sessiooni_kustutus_ebaonnestub_taastab_hashi(reset_env, monkeypatch):
    import server.auth as auth
    auth.load_users()  # cache
    old_hash = auth.load_users()["mari"]["password_hash"]
    token_data, _ = pr.create_reset_token("mari", "admin")

    def boom(_username):
        raise RuntimeError("sessiooni kustutus ebaõnnestus")
    monkeypatch.setattr(pr, "delete_user_sessions", boom)

    result, error = pr.complete_password_reset(token_data["token"], "uusparool1234")
    assert result is None
    assert error is not None
    # Vana hash taastatud
    assert auth.load_users()["mari"]["password_hash"] == old_hash
    # Token unconsume'itud
    got, e = pr.validate_reset_token(token_data["token"])
    assert e is None and got is not None


def test_complete_reset_kahe_jarjestikuse_lingi_esimene_kehtetu(reset_env):
    first, _ = pr.create_reset_token("mari", "admin")
    second, _ = pr.create_reset_token("mari", "admin")
    r1, e1 = pr.complete_password_reset(first["token"], "uusparool1234")
    assert r1 is None and e1 is not None  # superseded
    r2, e2 = pr.complete_password_reset(second["token"], "uusparool1234")
    assert e2 is None and r2["username"] == "mari"
