"""
Testid server/deps.py ühistele auth-dependency'dele (Faas 0 refaktoreering).

Kaetud käitumine:
- get_user: kehtiv Bearer token → tagastab kasutaja; puuduv token → 401
- get_user: query-param 'token' toimib (img src tüüpi GET-id)
- require_role: liiga madal roll → 401; piisav roll → läheb läbi
- get_json_data: loeb body JSON-ina
- optional_user: anonüümne → None; kehtiv token → kasutaja koos allowed_collections
- optional_user on SYNC (mitte async) — ei tagasta koruutinit

Need dependency'd on refaktoreeringu Faas 0 tõstmised main.py-st;
tagavad, et kõik domeeni-routerid saavad neid turvaliselt jagada.
"""
import json
import asyncio
import pytest
from fastapi import HTTPException


# ---------------------------------------------------------------------------
# get_user
# ---------------------------------------------------------------------------

def test_get_user_with_valid_bearer_token(login):
    from server.deps import get_user
    from starlette.requests import Request

    token = login("editor", "editorpass")
    scope = {"type": "http", "headers": [(b"authorization", f"Bearer {token}".encode())]}
    request = Request(scope)

    user = asyncio.run(get_user(request))
    assert user["username"] == "editor"
    assert user["role"] == "editor"


def test_get_user_missing_token_raises_401(backend_env):
    from server.deps import get_user
    from starlette.requests import Request

    scope = {"type": "http", "headers": [], "query_string": b""}
    request = Request(scope)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(get_user(request))
    assert exc.value.status_code == 401


def test_get_user_with_query_param_token(login):
    """query-param 'token' on <img src> tüüpi GET-id jaoks (nt upload thumb)."""
    from server.deps import get_user
    from starlette.requests import Request

    token = login("editor", "editorpass")
    scope = {
        "type": "http",
        "headers": [],
        "query_string": f"token={token}".encode(),
    }
    request = Request(scope)

    user = asyncio.run(get_user(request))
    assert user["username"] == "editor"


def test_get_user_invalid_token_raises_401(backend_env):
    from server.deps import get_user
    from starlette.requests import Request

    scope = {"type": "http", "headers": [(b"authorization", b"Bearer vorst-token")]}
    request = Request(scope)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(get_user(request))
    assert exc.value.status_code == 401


# ---------------------------------------------------------------------------
# require_role
# ---------------------------------------------------------------------------

def test_require_role_allows_sufficient_role(login):
    from server.deps import require_role

    token = login("admin", "adminpass")
    dep = require_role("editor")  # admin > editor, peab läbi minema

    from starlette.requests import Request
    scope = {"type": "http", "headers": [(b"authorization", f"Bearer {token}".encode())]}
    request = Request(scope)

    user = asyncio.run(dep(request))
    assert user["username"] == "admin"


def test_require_role_rejects_insufficient_role(login):
    """editor ei tohi pääseda admin endpointi."""
    from server.deps import require_role

    token = login("editor", "editorpass")
    dep = require_role("admin")

    from starlette.requests import Request
    scope = {"type": "http", "headers": [(b"authorization", f"Bearer {token}".encode())]}
    request = Request(scope)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(dep(request))
    assert exc.value.status_code == 401


# ---------------------------------------------------------------------------
# get_json_data
# ---------------------------------------------------------------------------

def test_get_json_data_parses_body(backend_env):
    from server.deps import get_json_data
    from starlette.requests import Request

    body = json.dumps({"foo": "bar", "n": 42}).encode()

    async def _make_request():
        scope = {
            "type": "http",
            "method": "POST",
            "headers": [(b"content-type", b"application/json")],
        }
        request = Request(scope)
        # Sünteetiline receive callable, mis tagastab body ühe chunkina
        async def receive():
            return {"type": "http.request", "body": body, "more_body": False}
        request._receive = receive
        return request

    request = asyncio.run(_make_request())
    data = asyncio.run(get_json_data(request))
    assert data == {"foo": "bar", "n": 42}


# ---------------------------------------------------------------------------
# optional_user
# ---------------------------------------------------------------------------

def test_optional_user_returns_none_for_anonymous(backend_env):
    """Anonüümne päring (ilma Authorization headerita) → None, mitte 401."""
    from server.deps import optional_user
    from starlette.requests import Request

    scope = {"type": "http", "headers": []}
    request = Request(scope)
    user = optional_user(request)
    assert user is None


def test_optional_user_returns_user_for_valid_token(login):
    """Kehtiv token → kasutaja koos allowed_collections väljaga."""
    from server.deps import optional_user
    from starlette.requests import Request

    token = login("editor", "editorpass")
    scope = {"type": "http", "headers": [(b"authorization", f"Bearer {token}".encode())]}
    request = Request(scope)
    user = optional_user(request)
    assert user is not None
    assert user["username"] == "editor"
    # allowed_collections peab olema list (isegi kui tühi)
    assert isinstance(user.get("allowed_collections"), list)


def test_optional_user_returns_none_for_invalid_token(backend_env):
    from server.deps import optional_user
    from starlette.requests import Request

    scope = {"type": "http", "headers": [(b"authorization", b"Bearer eba-kehtiv")]}
    request = Request(scope)
    user = optional_user(request)
    assert user is None


def test_optional_user_is_synchronous(backend_env):
    """optional_user peab olema sync (def), sest callereid main.py-s kutsuvad
    seda ilma await-ta (viewer-token, download, SEO meta). Koruutini tagastamine
    on regressioon, mis murdis viewer-token testid Faas 0 mustandis."""
    from server.deps import optional_user
    import inspect
    assert not inspect.iscoroutinefunction(optional_user), (
        "optional_user peab olema sync def, mitte async — muidu viewer-token jms "
        "endpointid saavad koruutini mitte kasutaja."
    )


# ---------------------------------------------------------------------------
# Üks kutsuja-reegel (#356 punkt 4): sessioon on ainus tõde
# ---------------------------------------------------------------------------

def _paisega(token):
    from starlette.requests import Request
    return Request({"type": "http", "headers": [(b"authorization", f"Bearer {token}".encode())]})


def test_optional_user_ja_get_user_annavad_sama_kasutaja(login):
    """Õigusväljad tulevad sessioonist mõlemal. Varem kirjutas `optional_user`
    `allowed_collections`-i üle värskest `users.json`-ist ja kaks lugejat
    andsid sama tokeni peale eri vastuse. Õigusmuudatus katkestab sessiooni
    (ADR 0031/0043), seega värske lugemine oli teine tõeallikas, mitte kate."""
    from server import auth
    from server.deps import get_user, optional_user

    token = login("editor", "editorpass")
    # Otse muudetud users.json ILMA sessiooni katkestamiseta — seda ükski
    # kirjutustee ei tee (valvur: test_oigusvalja_kirjutus_katkestab_sessiooni).
    with auth.users_transaction() as users:
        users["editor"]["allowed_collections"] = ["uus-kogu"]
        auth.save_users(users)

    via_get = asyncio.run(get_user(_paisega(token)))
    via_optional = optional_user(_paisega(token))

    assert via_optional == via_get
    assert "uus-kogu" not in via_optional["allowed_collections"]


def test_optional_user_ei_anna_aegunud_sessiooni(login):
    """`get_user` lükkab üle 24 h sessiooni tagasi; `optional_user` ei tohi seda
    enne taustapuhastust (5 min tsükkel) kasutajana tagastada."""
    from datetime import datetime, timedelta
    from server import auth
    from server.deps import optional_user

    token = login("editor", "editorpass")
    with auth._sessions_lock:
        auth.sessions[token]["created_at"] = (datetime.now() - timedelta(hours=25)).isoformat()

    assert optional_user(_paisega(token)) is None


def test_optional_user_tagastab_koopia(login):
    """Kutsuja muudatus ei tohi jõuda jagatud sessiooniobjekti."""
    from server import auth
    from server.deps import optional_user

    token = login("editor", "editorpass")
    optional_user(_paisega(token))["role"] = "superadmin"

    assert auth.get_session(token)["user"]["role"] == "editor"
