"""
Muutusteta salvestuse tuvastamine (#173).

Kui salvestus ei muuda ühtegi sisulist välja, ei tohi järgneda Git commit,
tuletatud indeksite ümberkirjutamine ega Meilisearchi sünk. Võrdlus on
semantiline (Pythoni struktuuride võrdlus), mitte serialiseeritud JSON-i
stringivõrdlus — võtmete järjekord ega vormindus ei loe, loendi järjekord loeb.
"""
import json
import os

# Klient lööb igale lehekülje salvestusele uue ajatempli. Ainuüksi see ei ole
# sisuline muudatus, muidu tekitaks iga juhuslik Ctrl+S uue commiti.
VOLATILE_PAGE_FIELDS = ("updated_at",)


def metadata_unchanged(old: dict, new: dict) -> bool:
    """True kui kaks metaandmete dict-i on sisuliselt samad."""
    return old == new


def _read_json(path: str):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _without_volatile(meta: dict) -> dict:
    return {k: v for k, v in meta.items() if k not in VOLATILE_PAGE_FIELDS}


def page_content_unchanged(txt_path: str, text: str, json_path, meta_content) -> bool:
    """
    True kui lehekülje tekst JA meta vastavad juba kettal olevale sisule.

    Puuduv fail on alati muudatus — uus lehekülg peab kettale ja commiti jõudma.
    Vigast/loetamatut JSON-i käsitleme samuti muudatusena, et salvestus selle üle
    kirjutaks.
    """
    if not os.path.exists(txt_path):
        return False
    try:
        with open(txt_path, "r", encoding="utf-8") as f:
            if f.read() != text:
                return False
    except OSError:
        return False

    if meta_content is None or not json_path:
        return True

    if not os.path.exists(json_path):
        return False
    try:
        on_disk = _read_json(json_path)
    except (OSError, ValueError):
        return False
    if not isinstance(on_disk, dict) or not isinstance(meta_content, dict):
        return False

    return _without_volatile(on_disk) == _without_volatile(meta_content)
