"""Kasutaja keel-eelistus: normaliseerimine ja ainuõige lugemiskoht.

`users.json` kannab keelt, mille inimene registreerudes valis. Kui ta hiljem
Seadetes keelt muudab, kirjutatakse `user_settings` — MITTE `users.json`.
Kaks kirjutuskohta lahkneksid ajas, seega on lugemiskohti täpselt üks:
`get_user_language`. Ükski saatja ei tohi lugeda `users.json` `language` välja
otse.
"""
from typing import Optional

from .auth import load_users
from .config import get_logger
from .user_settings_ops import load_user_settings

logger = get_logger(__name__)

DEFAULT_LANGUAGE = "et"
SUPPORTED_LANGUAGES = ("et", "en")


def normalize_language(value) -> str:
    """Viib keelekoodi kanoonilisele kujule. Tundmatu või puuduv → vaikekeel.

    Normaliseerimine käib nii kirjutus- kui lugemisteel, seega vanad kirjed
    ilma `language` väljata käituvad nagu `et` ilma migratsioonita.
    """
    if not isinstance(value, str):
        return DEFAULT_LANGUAGE
    code = value.strip().lower().split("-")[0]
    return code if code in SUPPORTED_LANGUAGES else DEFAULT_LANGUAGE


def get_user_language(username: Optional[str]) -> str:
    """Kasutaja praegune keel: user_settings → users.json → vaikekeel.

    Ainuõige allikas iga serveripoolse teksti jaoks, mis saadetakse
    KONKREETSELE kasutajale.
    """
    if not username:
        return DEFAULT_LANGUAGE

    try:
        settings = load_user_settings(username) or {}
        if settings.get("language"):
            return normalize_language(settings["language"])
    except Exception as e:
        # Katkine seadetefail ei tohi keele küsimist kukutada — kiri läheb ikka välja.
        logger.warning(f"Kasutaja seadete lugemine ebaõnnestus ({username}): {e}")

    user = (load_users() or {}).get(username) or {}
    return normalize_language(user.get("language"))
