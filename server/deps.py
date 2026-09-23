"""
Ühised FastAPI dependency'd autentimiseks ja JSON-body lugemiseks.

Need on tõstetud ``server/main.py``-st Faas 0 refaktoreeringus
(``docs/_archive/REFACTOR_main_py_2026-06-25.md``), et luua üks tõene allikas
auth-dependency'dele, mida kõik domeeni-routerid saavad jagada.

Semantika (main.py päritolu):
- ``get_user``: loeb tokeni ``Authorization: Bearer`` headerist; kui puudub,
  ``query``-parameetrist ``token`` (ainult ``<img src>`` tüüpi GET-id, nt upload thumb).
- ``optional_user``: loeb tokeni ``Authorization`` headerist; tagastab ``None``
  anonüümsele. Ei nõua autentimist. Kasutaja on sama mis ``get_user``-il.

Need on AINSAD kutsuja-lugejad (#356). Prosopograafia routeri oma ``_get_user``
(luges tokeni ka JSON-kehast) ja ``_optional_user`` (ainult ``?token=``) on
kustutatud. Valvur: ``tests/test_token_lugeja_uks_reegel.py``.
"""
from fastapi import HTTPException, Request

from .auth import require_token


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
    Tagastab autentitud kasutaja või ``None`` anonüümsele päringule. Erinevalt
    ``get_user``-st ei tõsta 401.

    Kasutaja on SAMA mis ``get_user``-il (``require_token``: sessiooni
    hetktõmmis + 24 h aegumine) — ainult puudumise käitumine erineb. Varem
    kirjutas see ``allowed_collections``-i üle värskest ``users.json``-ist ega
    kontrollinud aegumist: kaks lugejat andsid sama tokeni peale eri vastuse.
    Sessioon on õiguste ainus tõde, sest iga õigusvälja kirjutus katkestab
    sessiooni (ADR 0046, valvur ``test_oigusvalja_kirjutus_katkestab_sessiooni``).

    NB: on teadlikult SYNC (mitte async) — osa callereid (viewer-token,
    download, SEO meta) kutsub seda otse, ilma ``await``-ta.
    """
    token_str = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
    if not token_str:
        return None
    user, error = require_token({"auth_token": token_str})
    if error:
        return None
    return dict(user)
