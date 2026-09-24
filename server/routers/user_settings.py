from fastapi import APIRouter, Depends, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from ..deps import get_json_data, get_user
from ..user_language import get_user_language
from ..user_settings_ops import load_user_settings, save_user_settings

router = APIRouter()

# Lemmikkogud: tokenid nagu URL-is (ADR 0038) — püsikogu = paljas id,
# töökollektsioon = `s:<id>`. Lagi on kaitsepiir faili suuruse vastu.
FAVORITE_COLLECTIONS_MAX = 200
FAVORITE_TOKEN_MAX_LEN = 200


def _validate_favorite_collections(value) -> list:
    """Stringide loend, kordused eemaldatud, järjekord säilib. Muu → 400."""
    if (not isinstance(value, list)
            or len(value) > FAVORITE_COLLECTIONS_MAX
            or not all(isinstance(v, str) and 0 < len(v) <= FAVORITE_TOKEN_MAX_LEN
                       for v in value)):
        raise HTTPException(status_code=400, detail="favorite_collections peab olema id-de loend")
    return list(dict.fromkeys(value))


# sync def → threadpool: kasutaja seadete faililugemine ei blokeeri event-loopi
@router.get("/user-settings")
def get_user_settings(request: Request, user=Depends(get_user)):
    """Tagastab kasutaja kõik seaded.

    Puuduv `language` täidetakse kontolt (registreerimisel valitud keel) —
    seeme, MITTE migratsioon: faili siin ei kirjutata. Fail tekib alles siis,
    kui kasutaja midagi päriselt salvestab.
    """
    settings = load_user_settings(user["username"])
    if not settings.get("language"):
        settings["language"] = get_user_language(user["username"])
    return {"status": "success", "settings": settings}


@router.post("/user-settings")
async def save_user_settings_endpoint(request: Request, user=Depends(get_user)):
    """Salvestab kasutaja seaded (keel, vaiketab, erimärgid jne)."""
    data = await get_json_data(request)
    if "favorite_collections" in data:
        data["favorite_collections"] = _validate_favorite_collections(data["favorite_collections"])
    settings = await run_in_threadpool(load_user_settings, user["username"])
    # Uuenda ainult lubatud väljad
    allowed_fields = ["language", "default_tab", "characters", "favorite_collections"]
    for field in allowed_fields:
        if field in data:
            settings[field] = data[field]
    await run_in_threadpool(save_user_settings, user["username"], settings)
    return {"status": "success", "settings": settings}


@router.get("/user-chars")
def get_user_chars(request: Request, user=Depends(get_user)):
    """Tagastab kasutaja kohandatud erimärgid."""
    settings = load_user_settings(user["username"])
    chars = settings.get("characters", [])
    is_custom = len(chars) > 0
    return {"status": "success", "characters": chars, "is_custom": is_custom}


@router.post("/user-chars")
async def save_user_chars(request: Request, user=Depends(get_user)):
    """Salvestab kasutaja kohandatud erimärgid."""
    data = await get_json_data(request)
    settings = await run_in_threadpool(load_user_settings, user["username"])
    if data.get("reset"):
        settings.pop("characters", None)
    else:
        settings["characters"] = data.get("characters", [])
    await run_in_threadpool(save_user_settings, user["username"], settings)
    return {"status": "success", "reset": bool(data.get("reset"))}
