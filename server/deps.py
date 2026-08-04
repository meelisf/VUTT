"""
Ühised FastAPI dependency'd autentimiseks ja JSON-body lugemiseks.

Need on tõstetud ``server/main.py``-st Faas 0 refaktoreeringus
(``docs/_archive/REFACTOR_main_py_2026-06-25.md``), et luua üks tõene allikas
auth-dependency'dele, mida kõik domeeni-routerid saavad jagada.

Semantika (main.py päritolu):
- ``get_user``: loeb tokeni ``Authorization: Bearer`` headerist; kui puudub,
  ``query``-parameetrist ``token`` (ainult ``<img src>`` tüüpi GET-id, nt upload thumb).
- ``optional_user``: loeb tokeni ``Authorization`` headerist; tagastab ``None``
  anonüümsele. Ei nõua autentimist.

NB: ``server/prosopography/router.py``-s on eraldi ``_get_user``/``_optional_user``
implementatsioonid, mis toetavad lisaks JSON body-st tokeni lugemist (legacy kanal)
ja millel on natuke teistsugused semantikad (query-only optional). Need on teadlikult
eraldi jäetud — nende ühendamine ``deps.py``-sse vajab hoolikat testimist (body stream
topeltlugemise vältimine) ja tehakse eraldi sammuna.
"""
from fastapi import HTTPException, Request

from .auth import require_token, get_session, load_users


async def get_user(request: Request, min_role: str = "contributor"):
    """
    Ühtne autentimine. Järjekord:
    1. Authorization: Bearer <token> header (eelistatud)
    2. query-param 'token' (ainult <img src> tüüpi GET-id, nt upload thumb)
    """
    token = None

    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()

    if not token:
        token = request.query_params.get("token")

    if not token:
        raise HTTPException(status_code=401, detail="Autentimine nõutud")

    user, error = require_token({"auth_token": token}, min_role=min_role)
    if error:
        raise HTTPException(status_code=401, detail=error["message"])
    return user


def require_role(role: str):
    """FastAPI dependency factory: nõuab vähemalt antud rolli."""
    async def role_dependency(request: Request):
        return await get_user(request, min_role=role)
    return role_dependency


async def get_json_data(request: Request):
    """Loeb ja tagastab request body JSON-ina."""
    return await request.json()


def optional_user(request: Request):
    """
    Tagastab autentitud kasutaja (koos allowed_collections) või ``None``
    anonüümsele päringule. Erinevalt ``get_user``-st ei tõsta 401.

    NB: on teadlikult SYNC (mitte async). ``get_session`` ja ``load_users`` on
    sünkroonsed (in-memory dict + faililugemine) ja osa callereid main.py-s
    (viewer-token, download, SEO meta) kutsub seda ilma ``await``-ta. Põhjus,
    miks ``get_user`` on async: FastAPI dependency injekteerib selle ja starlette
    ootab awaitable'it — aga ``optional_user``-i kutsutakse otse endpointides
    (``user = _get_optional_user(request)``), mitte ``Depends`` kaudu.
    """
    token_str = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
    if not token_str:
        return None
    session = get_session(token_str)
    if not session:
        return None
    username = session["user"]["username"]
    users = load_users()
    user_data = users.get(username, {})
    return {**session["user"], "allowed_collections": user_data.get("allowed_collections", [])}
