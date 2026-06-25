import os

from .config import USER_SETTINGS_DIR
from .utils import atomic_write_json
import json


def get_user_settings_path(username: str) -> str:
    """Tagastab kasutaja seadete faili tee."""
    return os.path.join(USER_SETTINGS_DIR, f"{username}.json")


def load_user_settings(username: str) -> dict:
    """Laeb kasutaja seaded failist."""
    path = get_user_settings_path(username)
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_user_settings(username: str, settings: dict):
    """Salvestab kasutaja seaded faili."""
    os.makedirs(USER_SETTINGS_DIR, exist_ok=True)
    path = get_user_settings_path(username)
    atomic_write_json(path, settings)
