"""Kirjanduskogu konfiguratsioon ja aktiveerimise värav.

Tööriistad registreeruvad AINULT siis, kui indeksifail on olemas — nii ei teki
neid kellelgi, kes vutt-mcp paigaldab ilma oma koguta.
"""
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

# Tõstmine sunnib teksti ümbertöötluse (ekstraktsioon/normaliseerimine muutus).
EXTRACTOR_VERSION = 1
# Tõstmine sunnib indeksi ümberehituse (skeem muutus).
INDEXER_SCHEMA_VERSION = 1
# Zotero Local API (Settings → Advanced → luba suhtlus).
ZOTERO_API_BASE = "http://127.0.0.1:23119/api/users/0"

DEFAULT_COLLECTION = "VUTT kirjandus"


@dataclass(frozen=True)
class LibrarySettings:
    db_path: Path
    collection: str
    zotero_dir: Path      # storage/ asukoht; metaandmed tulevad API-st
    api_base: str = ZOTERO_API_BASE


def load_library_settings(env: Mapping[str, str] | None = None) -> LibrarySettings:
    env = os.environ if env is None else env
    home = Path(env.get("HOME", "~")).expanduser()
    db = env.get("VUTT_LIBRARY_DB")
    zot = env.get("VUTT_LIBRARY_ZOTERO_DIR")
    return LibrarySettings(
        db_path=Path(db) if db else home / ".local/share/vutt-library/library.db",
        collection=env.get("VUTT_LIBRARY_COLLECTION", DEFAULT_COLLECTION),
        zotero_dir=Path(zot) if zot else home / ".zotero/Zotero",
        api_base=env.get("VUTT_LIBRARY_ZOTERO_API", ZOTERO_API_BASE),
    )


def library_available(settings: LibrarySettings) -> bool:
    """Värav: kogu on olemas siis ja ainult siis, kui indeksifail eksisteerib."""
    return settings.db_path.exists()
