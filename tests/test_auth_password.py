"""
Testid bcrypt paroolihashi migratsiooni jaoks.
Kaetud käitumine:
- SHA-256 hashid toimivad edasi (tagasiühilduvus)
- SHA-256 hashiga sisselogimisel uuendatakse hash automaatselt bcrypt-ile
- bcrypt hashid toimivad
- Sama parooliga kasutajatel on erinevad hashid (sool)
- hash_password() toodab bcrypt hashi
- Uued kasutajad (registreerimine) saavad bcrypt hashi
"""
import hashlib
import json
import pytest


def _sha256(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


# ---------------------------------------------------------------------------
# hash_password
# ---------------------------------------------------------------------------

def test_hash_password_produces_bcrypt_hash():
    from server.auth import hash_password
    h = hash_password("salajane")
    assert h.startswith("$2b$"), f"Oodati bcrypt hashi, saadi: {h[:10]}"


def test_hash_password_same_password_different_hashes():
    from server.auth import hash_password
    h1 = hash_password("parool123")
    h2 = hash_password("parool123")
    assert h1 != h2, "Sama parooliga hashid peavad erinema (sool)"


# ---------------------------------------------------------------------------
# verify_user — bcrypt hash
# ---------------------------------------------------------------------------

def test_verify_user_bcrypt_hash_works(tmp_path, monkeypatch):
    from server.auth import hash_password
    import server.auth as auth_mod

    users = {
        "mari": {
            "password_hash": hash_password("korrektne"),
            "name": "Mari",
            "role": "editor",
            "allowed_collections": [],
        }
    }
    monkeypatch.setattr(auth_mod, "_users_cache", users)

    result = auth_mod.verify_user("mari", "korrektne")
    assert result is not None
    assert result["username"] == "mari"


def test_verify_user_bcrypt_wrong_password_returns_none(tmp_path, monkeypatch):
    from server.auth import hash_password
    import server.auth as auth_mod

    users = {
        "mari": {
            "password_hash": hash_password("korrektne"),
            "name": "Mari",
            "role": "editor",
            "allowed_collections": [],
        }
    }
    monkeypatch.setattr(auth_mod, "_users_cache", users)

    result = auth_mod.verify_user("mari", "vale_parool")
    assert result is None


# ---------------------------------------------------------------------------
# verify_user — SHA-256 tagasiühilduvus
# ---------------------------------------------------------------------------

def test_verify_user_sha256_hash_still_works(monkeypatch):
    import server.auth as auth_mod

    users = {
        "jaan": {
            "password_hash": _sha256("vana_parool"),
            "name": "Jaan",
            "role": "editor",
            "allowed_collections": [],
        }
    }
    monkeypatch.setattr(auth_mod, "_users_cache", users)

    result = auth_mod.verify_user("jaan", "vana_parool")
    assert result is not None
    assert result["username"] == "jaan"


def test_verify_user_sha256_wrong_password_returns_none(monkeypatch):
    import server.auth as auth_mod

    users = {
        "jaan": {
            "password_hash": _sha256("vana_parool"),
            "name": "Jaan",
            "role": "editor",
            "allowed_collections": [],
        }
    }
    monkeypatch.setattr(auth_mod, "_users_cache", users)

    result = auth_mod.verify_user("jaan", "vale_parool")
    assert result is None


# ---------------------------------------------------------------------------
# verify_user — automaatne SHA-256 → bcrypt uuendus
# ---------------------------------------------------------------------------

def test_verify_user_sha256_upgrades_to_bcrypt_on_login(monkeypatch):
    """SHA-256 hashiga sisselogimisel uuendatakse hash automaatselt bcrypt-ile."""
    import server.auth as auth_mod

    users = {
        "peeter": {
            "password_hash": _sha256("vana_parool"),
            "name": "Peeter",
            "role": "editor",
            "allowed_collections": [],
        }
    }
    monkeypatch.setattr(auth_mod, "_users_cache", users)

    saved = {}

    def fake_save_users(u):
        saved.update(u)

    monkeypatch.setattr(auth_mod, "save_users", fake_save_users)

    auth_mod.verify_user("peeter", "vana_parool")

    assert "peeter" in saved, "save_users ei kutsutud"
    new_hash = saved["peeter"]["password_hash"]
    assert new_hash.startswith("$2b$"), f"Hash ei uuendatud bcrypt-ile: {new_hash[:20]}"


def test_verify_user_sha256_upgrade_new_hash_verifies_correctly(monkeypatch):
    """Pärast uuendust töötab bcrypt hash sisselogimiseks."""
    import server.auth as auth_mod

    users = {
        "peeter": {
            "password_hash": _sha256("vana_parool"),
            "name": "Peeter",
            "role": "editor",
            "allowed_collections": [],
        }
    }
    monkeypatch.setattr(auth_mod, "_users_cache", users)
    monkeypatch.setattr(auth_mod, "save_users", lambda u: users.update(u))

    # Esimene login — uuendab hashi
    auth_mod.verify_user("peeter", "vana_parool")

    # Teine login — peaks töötama bcrypt hashiga
    result = auth_mod.verify_user("peeter", "vana_parool")
    assert result is not None


# ---------------------------------------------------------------------------
# registration — uued kasutajad saavad bcrypt hashi
# ---------------------------------------------------------------------------

def test_new_user_from_invite_gets_bcrypt_hash(monkeypatch, tmp_path):
    import server.registration as reg_mod
    import server.auth as auth_mod

    # Loo ajutine state kataloog invite tokeniga
    state_dir = tmp_path / "state"
    state_dir.mkdir()
    tokens_file = state_dir / "invite_tokens.json"
    from datetime import datetime, timedelta
    tokens_file.write_text(json.dumps({
        "tokens": [{
            "token": "tok123",
            "email": "uus@example.com",
            "name": "Uus Kasutaja",
            "used": False,
            "expires_at": (datetime.now() + timedelta(hours=24)).isoformat(),
        }]
    }), encoding="utf-8")
    users_file = state_dir / "users.json"
    users_file.write_text(json.dumps({}), encoding="utf-8")

    monkeypatch.setattr(reg_mod, "INVITE_TOKENS_FILE", str(tokens_file))
    monkeypatch.setattr(reg_mod, "USERS_FILE", str(users_file))
    monkeypatch.setattr(auth_mod, "USERS_FILE", str(users_file))
    monkeypatch.setattr(auth_mod, "_users_cache", None)

    new_user, error = reg_mod.create_user_from_invite("tok123", "UusParool123!")
    assert error is None, f"Ootamatu viga: {error}"

    saved_users = json.loads(users_file.read_text())
    username = new_user["username"]
    stored_hash = saved_users[username]["password_hash"]
    assert stored_hash.startswith("$2b$"), f"Uus kasutaja peab saama bcrypt hashi, saadi: {stored_hash[:20]}"
