from fastapi import APIRouter, Depends, Request

from ..deps import get_json_data, get_user
from ..user_settings_ops import load_user_settings, save_user_settings

router = APIRouter()


@router.get("/user-settings")
async def get_user_settings(request: Request, user=Depends(get_user)):
    """Tagastab kasutaja kõik seaded."""
    settings = load_user_settings(user["username"])
    return {"status": "success", "settings": settings}


@router.post("/user-settings")
async def save_user_settings_endpoint(request: Request, user=Depends(get_user)):
    """Salvestab kasutaja seaded (keel, vaiketab, erimärgid jne)."""
    data = await get_json_data(request)
    settings = load_user_settings(user["username"])
    # Uuenda ainult lubatud väljad
    allowed_fields = ["language", "default_tab", "characters"]
    for field in allowed_fields:
        if field in data:
            settings[field] = data[field]
    save_user_settings(user["username"], settings)
    return {"status": "success", "settings": settings}


@router.get("/user-chars")
async def get_user_chars(request: Request, user=Depends(get_user)):
    """Tagastab kasutaja kohandatud erimärgid."""
    settings = load_user_settings(user["username"])
    chars = settings.get("characters", [])
    is_custom = len(chars) > 0
    return {"status": "success", "characters": chars, "is_custom": is_custom}


@router.post("/user-chars")
async def save_user_chars(request: Request, user=Depends(get_user)):
    """Salvestab kasutaja kohandatud erimärgid."""
    data = await get_json_data(request)
    settings = load_user_settings(user["username"])
    if data.get("reset"):
        settings.pop("characters", None)
    else:
        settings["characters"] = data.get("characters", [])
    save_user_settings(user["username"], settings)
    return {"status": "success", "reset": bool(data.get("reset"))}
