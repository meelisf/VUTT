from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from ..auth import create_session, delete_session, get_session, load_users, require_token, verify_user
from ..config import get_logger
from ..rate_limit import (
    check_account_lockout,
    check_rate_limit,
    clear_login_failures,
    get_client_ip,
    record_login_failure,
)
from ..registration import (
    add_registration,
    create_user_from_invite,
    suggest_username_for_email,
    validate_invite_token,
)
from ..password_reset import complete_password_reset, validate_reset_token

# TODO: server/routers/auth.py (HTTP endpointid) ja server/auth.py (auth core)
# on sarnase nimega. Pärast main.py routeriteks jagamist kaaluda eraldi cleanup'is
# server/auth.py ümbernimetamist nt auth_ops.py/auth_service.py-ks.
logger = get_logger(__name__)
router = APIRouter()


@router.post("/login")
async def login(request: Request):
    client_ip = get_client_ip(request)
    # IP-põhine rate-limit (kaitse ühelt IP-lt tuleva brute-force'i vastu)
    allowed, retry_after = check_rate_limit(client_ip, "/login")
    if not allowed:
        return JSONResponse(status_code=429, content={"status": "error", "message": f"Proovi uuesti {retry_after}s pärast"})
    data = await request.json()
    username = data.get("username", "").strip()
    # Konto-põhine lockout (kaitse credential-stuffingu vastu — palju IP-sid, üks konto)
    locked, acc_retry = check_account_lockout(username)
    if locked:
        logger.warning(f"Login blokeeritud (konto lukus): username={username!r} ip={client_ip} retry_after={acc_retry}s")
        return JSONResponse(status_code=429, content={"status": "error", "message": f"Liiga palju ebaõnnestunud katseid. Proovi uuesti {acc_retry}s pärast"})
    user = verify_user(username, data.get("password", ""))
    if user:
        clear_login_failures(username)
        from ..meilisearch_ops import generate_meili_token
        try:
            meili_token = generate_meili_token(user=user, ttl_seconds=3600)
        except Exception as e:
            logger.info(f"Meili token genereerimine ebaõnnestus (test env?): {e}")
            meili_token = None
        return {
            "status": "success",
            "user": user,
            "token": create_session(user),
            "meili_token": meili_token,
        }
    record_login_failure(username)
    logger.warning(f"Ebaõnnestunud login: username={username!r} ip={client_ip}")
    return {"status": "error", "message": "Vale kasutajanimi või parool"}


@router.post("/verify-token")
async def verify_token(request: Request):
    # NB: See endpoint kasutab tahtlikult POST body tokenit, mitte Bearer päist.
    # Põhjus: endpoint verifitseerib tokenit iseennast — get_user() dependency
    # nõuaks kehtivat tokenit, mida me just kontrollima hakkame.
    data = await request.json()
    token = data.get("token", "").strip()
    user, error = require_token({"auth_token": token})
    if error:
        return {"status": "error", "valid": False, "message": error["message"]}
    return {"status": "success", "user": user, "valid": True}


@router.post("/logout")
async def logout(request: Request):
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
        if token:
            delete_session(token)
    return {"status": "success"}


@router.get("/api/meili-token")
async def public_meili_token():
    """Anonüümne Meilisearchi tenant token — filter: is_public = true."""
    from ..meilisearch_ops import generate_meili_token
    try:
        token = generate_meili_token(user=None, ttl_seconds=3600)
        return {"token": token}
    except Exception as e:
        logger.info(f"Meili token genereerimine ebaõnnestus (test env?): {e}")
        return {"token": ""}


@router.post("/api/meili-token/refresh")
async def refresh_meili_token(request: Request):
    """Uuendab autentitud kasutaja Meilisearchi tokeni."""
    from ..meilisearch_ops import generate_meili_token
    token_str = request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
    session = get_session(token_str)
    if not session:
        raise HTTPException(status_code=401, detail="Sessioon aegunud")
    user = session["user"]
    users = load_users()
    full_user = users.get(user["username"], user)
    user_with_collections = {**user, "allowed_collections": full_user.get("allowed_collections", [])}
    try:
        new_token = generate_meili_token(user=user_with_collections, ttl_seconds=3600)
        return {"token": new_token}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Token refresh ebaõnnestus: {e}")


@router.post("/register")
async def register(request: Request):
    client_ip = get_client_ip(request)
    allowed, retry_after = check_rate_limit(client_ip, "/register")
    if not allowed:
        return JSONResponse(status_code=429, content={"status": "error", "message": "Liiga palju päringuid"})
    data = await request.json()
    if data.get("website"):
        return {"status": "success"}
    registration, error = add_registration(
        data.get("name", ""),
        data.get("email", ""),
        data.get("affiliation"),
        data.get("motivation", ""),
        gdpr_consent=bool(data.get("gdpr_consent")),
    )
    if not registration:
        raise HTTPException(status_code=400, detail=error)
    return {"status": "success", "id": registration["id"], "username": registration.get("username")}


@router.get("/register/username-preview")
async def register_username_preview(email: str = ""):
    email = email.strip().lower()
    if not email or "@" not in email:
        return {"status": "success", "username": ""}
    return {"status": "success", "username": suggest_username_for_email(email)}


@router.get("/invite/{token}")
async def check_invite(token: str):
    token_data, error = validate_invite_token(token)
    if token_data:
        return {
            "status": "success",
            "valid": True,
            "email": token_data["email"],
            "username": token_data.get("username"),
            "name": token_data["name"],
            "expires_at": token_data["expires_at"],
        }
    return {"status": "error", "valid": False, "message": error}


@router.post("/invite/set-password")
async def set_password(request: Request):
    client_ip = get_client_ip(request)
    allowed, retry_after = check_rate_limit(client_ip, "/invite/set-password")
    if not allowed:
        return JSONResponse(status_code=429, content={"status": "error", "message": "Liiga palju päringuid"})
    data = await request.json()
    new_user, error = create_user_from_invite(data.get("token", ""), data.get("password", ""))
    if not new_user:
        raise HTTPException(status_code=400, detail=error)
    return {"status": "success", "username": new_user["username"]}


@router.post("/reset/validate")
async def reset_validate(request: Request):
    """Valideerib parooli-reset tokeni (POST body, MITTE URL — token logidest väljas)."""
    client_ip = get_client_ip(request)
    allowed, retry_after = check_rate_limit(client_ip, "/reset/validate")
    if not allowed:
        return JSONResponse(status_code=429, content={"status": "error", "valid": False, "message": "Liiga palju päringuid"})
    data = await request.json()
    token_data, error = validate_reset_token((data.get("token") or "").strip())
    if token_data:
        return {
            "status": "success",
            "valid": True,
            "username": token_data["username"],
            "name": token_data["name"],
            "expires_at": token_data["expires_at"],
        }
    return {"status": "error", "valid": False, "message": error}


@router.post("/reset/set-password")
async def reset_set_password(request: Request):
    """Seab reset-tokeni põhjal olemasolevale kasutajale uue parooli."""
    client_ip = get_client_ip(request)
    allowed, retry_after = check_rate_limit(client_ip, "/reset/set-password")
    if not allowed:
        return JSONResponse(status_code=429, content={"status": "error", "message": "Liiga palju päringuid"})
    data = await request.json()
    result, error = complete_password_reset((data.get("token") or "").strip(), data.get("password", ""))
    if not result:
        raise HTTPException(status_code=400, detail=error)
    return {"status": "success", "username": result["username"]}
