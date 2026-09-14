"""Registreerimise username-tuletamise testid.

Katab (issue #19):
- `_base_username_from_email` — email → puhas kasutajanimi
- `_next_available_username` — kollisioid lahendav loendur (kasutajad + aktiivsed tokenid)
- `suggest_username_for_email` — kõikehõlmav soovitus (kasutajad + pending + tokenid)

Need on puhtad unit-testid: failipõhised laadijad (`load_users`,
`load_invite_tokens`, `load_pending_registrations`) on monkeypatch'itud, et vältida
reaalset faili-I/O-d ja testimata olekust sõltumist.
"""
from datetime import datetime, timedelta

import server.registration as registration
from server.registration import (
    _base_username_from_email,
    _next_available_username,
    suggest_username_for_email,
)


# =========================================================
# _base_username_from_email
# =========================================================

def test_base_username_lihtne():
    assert _base_username_from_email("john.doe@example.com") == "johndoe"


def test_base_username_lowercases():
    assert _base_username_from_email("John.DOE@Example.COM") == "johndoe"


def test_base_username_eemaldab_eraldaajad():
    # Lubatud on vaid [a-z0-9]; punkt, allkriips, pluss jms eemaldatakse
    assert _base_username_from_email("john_doe+work@example.com") == "johndoework"


def test_base_username_eemaldab_aksendid():
    # Ü, Ö, ä jms (mitte-ASCII) eemaldatakse
    assert _base_username_from_email("üõöä@example.com") == ""


def test_base_username_tyhi():
    assert _base_username_from_email("@example.com") == ""


def test_base_username_ainult_numbrid():
    assert _base_username_from_email("12345@example.com") == "12345"


# =========================================================
# _next_available_username
# =========================================================

def _patch_loaders(monkeypatch, *, users=None):
    """Asendab load_users fikseeritud väärtusega.

    NB: `_next_available_username` EI kutsu load_invite_tokens() ise — see võtab
    tokens_data argumendina (vt all token-teste). Ainult suggest_username_for_email
    laeb tokenid/pending'i sisemiselt.
    """
    monkeypatch.setattr(registration, "load_users", lambda: dict(users or {}))


def test_next_available_kui_vaba(monkeypatch):
    _patch_loaders(monkeypatch, users={})
    assert _next_available_username("john@example.com") == "john"


def test_next_available_kasutaja_kollisioon_loendur(monkeypatch):
    _patch_loaders(monkeypatch, users={"john": {}})
    assert _next_available_username("john@example.com") == "john1"


def test_next_available_mitu_kollisioon(monkeypatch):
    _patch_loaders(monkeypatch, users={"john": {}, "john1": {}, "john2": {}})
    assert _next_available_username("john@example.com") == "john3"


def test_next_available_token_aktiivne_loeb(monkeypatch):
    # Aktiivse (kasutamata, kehtiva) tokeni username loeb kollisioonina
    future = (datetime.now() + timedelta(days=1)).isoformat()
    _patch_loaders(monkeypatch)
    tokens_data = {"tokens": [{"username": "john", "used": False, "expires_at": future}]}
    assert _next_available_username("john@example.com", tokens_data=tokens_data) == "john1"


def test_next_available_token_kasutatud_ei_loe(monkeypatch):
    future = (datetime.now() + timedelta(days=1)).isoformat()
    _patch_loaders(monkeypatch)
    tokens_data = {"tokens": [{"username": "john", "used": True, "expires_at": future}]}
    # Kasutatud token ei blokeeri — baasnimi on vaba
    assert _next_available_username("john@example.com", tokens_data=tokens_data) == "john"


def test_next_available_token_aegunud_ei_loe(monkeypatch):
    past = (datetime.now() - timedelta(days=1)).isoformat()
    _patch_loaders(monkeypatch)
    tokens_data = {"tokens": [{"username": "john", "used": False, "expires_at": past}]}
    assert _next_available_username("john@example.com", tokens_data=tokens_data) == "john"


def test_next_available_token_invalid_expires_skipitakse(monkeypatch):
    # Vigane expires_at (mitte-ISO) → token skipitakse, ei loe kollisioonina
    _patch_loaders(monkeypatch)
    tokens_data = {"tokens": [{"username": "john", "used": False, "expires_at": "mitte-kuupäev"}]}
    assert _next_available_username("john@example.com", tokens_data=tokens_data) == "john"


def test_next_available_token_ilma_username_leta_skipitakse(monkeypatch):
    future = (datetime.now() + timedelta(days=1)).isoformat()
    _patch_loaders(monkeypatch)
    tokens_data = {"tokens": [{"username": None, "used": False, "expires_at": future}]}
    assert _next_available_username("john@example.com", tokens_data=tokens_data) == "john"


def test_next_available_tokens_data_none_ei_kontrolli_tokeneid(monkeypatch):
    # Vaikimisi tokens_data=None → tokenid ei loe (vaid olemasolevad kasutajad)
    _patch_loaders(monkeypatch)
    future = (datetime.now() + timedelta(days=1)).isoformat()
    # load_invite_tokens on patch'itud, aga _next_available ei kasuta seda — token jääb arvestamata
    monkeypatch.setattr(registration, "load_invite_tokens", lambda: {
        "tokens": [{"username": "john", "used": False, "expires_at": future}]
    })
    assert _next_available_username("john@example.com") == "john"


def test_next_available_preferred_override(monkeypatch):
    _patch_loaders(monkeypatch, users={})
    assert _next_available_username("john@example.com", preferred_username="custom") == "custom"


def test_next_available_preferred_kollisioon(monkeypatch):
    # preferred_username on võetud → lisatakse loendur
    _patch_loaders(monkeypatch, users={"custom": {}})
    assert _next_available_username("john@example.com", preferred_username="custom") == "custom1"


# =========================================================
# suggest_username_for_email
# =========================================================

def _patch_all(monkeypatch, *, users=None, tokens=None, pending=None):
    monkeypatch.setattr(registration, "load_users", lambda: dict(users or {}))
    monkeypatch.setattr(registration, "load_invite_tokens", lambda: tokens or {"tokens": []})
    monkeypatch.setattr(registration, "load_pending_registrations",
                        lambda: pending or {"registrations": []})


def test_suggest_kui_vaba(monkeypatch):
    _patch_all(monkeypatch)
    assert suggest_username_for_email("john@example.com") == "john"


def test_suggest_kasutaja_kollisioon(monkeypatch):
    _patch_all(monkeypatch, users={"john": {}})
    assert suggest_username_for_email("john@example.com") == "john1"


def test_suggest_pending_kollisioon(monkeypatch):
    # Ootel registreerimise username loeb kollisioonina (erinevalt _next_available)
    _patch_all(monkeypatch, pending={"registrations": [
        {"status": "pending", "username": "john"}
    ]})
    assert suggest_username_for_email("john@example.com") == "john1"


def test_suggest_pending_mitterelevant_staatus_ei_loe(monkeypatch):
    # Kõik muud kui 'pending' (nt 'approved') ei blokeeri
    _patch_all(monkeypatch, pending={"registrations": [
        {"status": "approved", "username": "john"}
    ]})
    assert suggest_username_for_email("john@example.com") == "john"


def test_suggest_pending_ilma_username_leta_ei_loe(monkeypatch):
    _patch_all(monkeypatch, pending={"registrations": [
        {"status": "pending", "username": None}
    ]})
    assert suggest_username_for_email("john@example.com") == "john"


def test_suggest_token_aktiivne_kollisioon(monkeypatch):
    future = (datetime.now() + timedelta(days=1)).isoformat()
    _patch_all(monkeypatch, tokens={"tokens": [
        {"username": "john", "used": False, "expires_at": future}
    ]})
    assert suggest_username_for_email("john@example.com") == "john1"


def test_suggest_token_aegunud_ei_loe(monkeypatch):
    past = (datetime.now() - timedelta(days=1)).isoformat()
    _patch_all(monkeypatch, tokens={"tokens": [
        {"username": "john", "used": False, "expires_at": past}
    ]})
    assert suggest_username_for_email("john@example.com") == "john"


def test_suggest_token_invalid_expires_skipitakse(monkeypatch):
    _patch_all(monkeypatch, tokens={"tokens": [
        {"username": "john", "used": False, "expires_at": "xyz"}
    ]})
    assert suggest_username_for_email("john@example.com") == "john"


def test_suggest_kombineeritud_kaudne_kollisioon(monkeypatch):
    # Kasutaja + pending + aktiivne token moodustavad järjestikuse vaba nime
    future = (datetime.now() + timedelta(days=1)).isoformat()
    _patch_all(
        monkeypatch,
        users={"john": {}},
        pending={"registrations": [{"status": "pending", "username": "john1"}]},
        tokens={"tokens": [{"username": "john2", "used": False, "expires_at": future}]},
    )
    assert suggest_username_for_email("john@example.com") == "john3"


# =========================================================
# Nimevaliku võidujooks ja kustutatud nimede register (#318, ADR 0043 p8)
# =========================================================

import threading  # noqa: E402


def _tee_token(backend_env, token, email, username):
    import json
    fail = backend_env["invite_tokens_file"]
    data = json.loads(fail.read_text())
    data["tokens"].append({
        "token": token,
        "email": email,
        "name": "Uus Kasutaja",
        "username": username,
        "role": "contributor",
        "used": False,
        "expires_at": "2099-01-01T00:00:00",
    })
    fail.write_text(json.dumps(data, ensure_ascii=False))


def test_kaks_samaaegset_kutset_saavad_eri_nimed(backend_env):
    reg = backend_env["registration"]
    _tee_token(backend_env, "tok-a", "uus@example.test", "uus")
    _tee_token(backend_env, "tok-b", "uus@example.test", "uus")

    tulemused = []
    barjaar = threading.Barrier(2, timeout=10)

    def loo(token):
        barjaar.wait()
        tulemused.append(reg.create_user_from_invite(token, "TugevParool123!"))

    lõimed = [threading.Thread(target=loo, args=(t,)) for t in ("tok-a", "tok-b")]
    for l in lõimed:
        l.start()
    for l in lõimed:
        l.join(timeout=20)

    nimed = [k["username"] for k, viga in tulemused if k]
    assert len(nimed) == 2, tulemused
    assert len(set(nimed)) == 2, f"kaks kontot said sama nime: {nimed}"


def test_kustutatud_nime_ei_anta_uuesti(backend_env):
    auth = backend_env["auth"]
    reg = backend_env["registration"]
    auth.reserve_username("uus")
    _tee_token(backend_env, "tok-c", "uus@example.test", "uus")

    kasutaja, viga = reg.create_user_from_invite("tok-c", "TugevParool123!")
    assert viga is None, viga
    assert kasutaja["username"] != "uus"


def test_suggest_username_arvestab_reserveeritud_nime(backend_env):
    auth = backend_env["auth"]
    reg = backend_env["registration"]
    auth.reserve_username("uus")
    assert reg.suggest_username_for_email("uus@example.test") != "uus"
