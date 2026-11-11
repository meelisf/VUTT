"""Püsisessioonid ja libisev aegumine (ADR 0081, #761)."""
import json
from datetime import datetime, timedelta

import pytest

from server import auth

USER = {"username": "mari", "name": "Mari", "role": "editor",
        "allowed_collections": [], "edit_collections": []}


@pytest.fixture
def store(tmp_path, monkeypatch):
    path = tmp_path / "sessions.json"
    monkeypatch.setattr(auth, "SESSIONS_FILE", str(path))
    monkeypatch.setattr(auth, "sessions", {})
    monkeypatch.setattr(auth, "_version", 0)
    monkeypatch.setattr(auth, "_persisted_version", 0)
    return path


def _restart():
    """Simuleeri protsessi restarti: mälu tühjaks, laadi kettalt."""
    auth.sessions.clear()
    return auth.load_persisted_sessions()


def _valid(token):
    user, error = auth.require_token({"auth_token": token})
    return user is not None and error is None


def _set(token, **fields):
    """Testi otsemuudatus — tõstab versiooni nagu päris muutjad."""
    with auth._sessions_lock:
        auth.sessions[auth.token_key(token)].update(fields)
        auth._bump_locked()


def _ago(**delta):
    return (datetime.now() - timedelta(**delta)).isoformat()


def test_sessioon_elab_restardi_ule_ja_kettal_pole_toortokenit(store):
    token = auth.create_session(USER)
    raw = store.read_text(encoding="utf-8")
    assert token not in raw                        # toortokenit ei salvestata
    assert auth.token_key(token) in raw
    assert _restart() == 1
    assert _valid(token)


def test_oiguste_aravott_on_kohe_kettal(store):
    """ADR 0046 p 2: delete_user_sessions ei tohi restardi järel tagasi tulla."""
    token = auth.create_session(USER)
    auth.create_session({**USER, "username": "jaan"})
    assert auth.delete_user_sessions("mari") == 1
    _restart()
    assert not _valid(token)
    assert len(auth.sessions) == 1


def test_logout_on_kohe_kettal(store):
    token = auth.create_session(USER)
    auth.delete_session(token)
    _restart()
    assert not _valid(token)


def test_libisev_aegumine(store):
    token = auth.create_session(USER)
    _set(token, created_at=_ago(days=3), last_seen=_ago(hours=23))
    assert _valid(token)                            # 23 h tegevusetust: kehtib
    # Tegevus pikendas: last_seen on nüüd värske
    seen = datetime.fromisoformat(auth.sessions[auth.token_key(token)]["last_seen"])
    assert datetime.now() - seen < timedelta(minutes=1)

    _set(token, last_seen=_ago(hours=25))
    assert not _valid(token)                        # 25 h tegevusetust: aegunud
    assert auth.token_key(token) not in auth.sessions


def test_absoluutne_lagi_14_paeva(store):
    token = auth.create_session(USER)
    _set(token, created_at=_ago(days=14, minutes=1), last_seen=_ago(minutes=1))
    assert not _valid(token)                        # aktiivne, aga lagi ületatud


def test_tegevus_ei_kirjuta_ketast_paringu_teel(store, monkeypatch):
    """get_user on async def — require_token ei tohi teha faili-I/O-d (ADR 0002)."""
    token = auth.create_session(USER)
    _set(token, last_seen=_ago(hours=2))
    monkeypatch.setattr(auth, "atomic_write_json",
                        lambda *a, **k: pytest.fail("require_token kirjutas kettale"))
    assert _valid(token)


def test_flush_kirjutab_last_seen_kettale(store):
    token = auth.create_session(USER)
    _set(token, last_seen=_ago(hours=2))
    assert _valid(token)                            # touch mälus
    auth.flush_sessions()
    stored = json.loads(store.read_text(encoding="utf-8"))["sessions"][auth.token_key(token)]
    assert datetime.now() - datetime.fromisoformat(stored["last_seen"]) < timedelta(minutes=1)


def test_laadimine_jatab_aegunud_ja_vigased_valja(store):
    good = auth.create_session(USER)
    old = auth.create_session({**USER, "username": "vana"})
    _set(old, last_seen=_ago(hours=30))
    auth.flush_sessions()
    data = json.loads(store.read_text(encoding="utf-8"))
    data["sessions"]["x" * 64] = {"user": "ei ole dict", "created_at": _ago(minutes=1)}
    data["sessions"]["lühike"] = {"user": USER, "created_at": _ago(minutes=1)}
    data["sessions"]["y" * 64] = {"user": USER}     # created_at puudub
    store.write_text(json.dumps(data), encoding="utf-8")

    assert _restart() == 1
    assert _valid(good)
    # Laadimine koristas ka ketta
    assert list(json.loads(store.read_text(encoding="utf-8"))["sessions"]) == [auth.token_key(good)]


@pytest.mark.parametrize("content", ["{katki", "[]", '{"sessions": []}'])
def test_vigane_fail_annab_tuhja_hoidla(store, content):
    store.write_text(content, encoding="utf-8")
    assert _restart() == 0
    assert auth.sessions == {}


def test_puhastus_eemaldab_aegunud_ja_kirjutab(store):
    token = auth.create_session(USER)
    _set(token, last_seen=_ago(hours=30))
    assert auth.cleanup_expired_sessions() == 1
    assert json.loads(store.read_text(encoding="utf-8"))["sessions"] == {}


def test_kirjutustorge_ei_kuku_ja_jargmine_proovib_uuesti(store, monkeypatch):
    real = auth.atomic_write_json
    state = {"broken": True}

    def maybe_broken(*a, **k):
        if state["broken"]:
            raise OSError("ketas täis")
        return real(*a, **k)
    monkeypatch.setattr(auth, "atomic_write_json", maybe_broken)
    token = auth.create_session(USER)               # ei viska
    assert _valid(token)                            # mälu kehtib
    assert not store.exists()
    state["broken"] = False
    auth.flush_sessions()                           # versioon jäi kirjutamata → proovib uuesti
    assert auth.token_key(token) in store.read_text(encoding="utf-8")
