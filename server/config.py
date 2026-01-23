"""
Serveri konfiguratsioon.
Kõik seaded ja konstandid ühes kohas.
"""
import os
from datetime import timedelta

# =========================================================
# FAILISÜSTEEMI TEED
# =========================================================

# VUTT_DATA_DIR env variable allows overriding the path for Docker/Production
DEFAULT_DIR = "/home/mf/Dokumendid/LLM/tartu-acad/data/04_sorditud_dokumendid/"
BASE_DIR = os.getenv("VUTT_DATA_DIR", DEFAULT_DIR)

# JSON failide asukohad (state/ kaustas projekti juurkataloogis)
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_STATE_DIR = os.path.join(_PROJECT_ROOT, "state")
STATE_DIR = _STATE_DIR  # Ekspordi kasutamiseks teistes moodulites
USERS_FILE = os.path.join(_STATE_DIR, "users.json")
PENDING_REGISTRATIONS_FILE = os.path.join(_STATE_DIR, "pending_registrations.json")
INVITE_TOKENS_FILE = os.path.join(_STATE_DIR, "invite_tokens.json")
PENDING_EDITS_FILE = os.path.join(_STATE_DIR, "pending_edits.json")
COLLECTIONS_FILE = os.path.join(_STATE_DIR, "collections.json")
VOCABULARIES_FILE = os.path.join(_STATE_DIR, "vocabularies.json")

# =========================================================
# SERVERI SEADED
# =========================================================

PORT = 8002

# =========================================================
# SESSIOONID
# =========================================================

# Sessiooni kehtivusaeg
SESSION_DURATION = timedelta(hours=24)

# =========================================================
# CORS - lubatud päritolud
# =========================================================

ALLOWED_ORIGINS = [
    'https://vutt.utlib.ut.ee',
    'http://vutt.utlib.ut.ee',
    'http://localhost:5173',      # Vite dev server
    'http://localhost:3000',      # Alternatiivne dev port
    'http://127.0.0.1:5173',
    'http://127.0.0.1:3000',
]

# =========================================================
# RATE LIMITING
# =========================================================

# (max_requests, window_seconds)
RATE_LIMITS = {
    '/login': (5, 60),              # 5 katset minutis
    '/register': (3, 3600),         # 3 taotlust tunnis
    '/invite/set-password': (5, 300),  # 5 katset 5 minuti jooksul
}

# =========================================================
# MEILISEARCH
# =========================================================

# Vaikimisi väärtused (arenduseks)
_DEFAULT_MEILI_URL = "http://127.0.0.1:7700"

# 1. Proovime lugeda süsteemi keskkonnamuutujatest (Docker/Production eelistatud)
MEILI_URL = os.getenv("MEILISEARCH_URL")
MEILI_KEY = os.getenv("MEILISEARCH_MASTER_KEY") or os.getenv("MEILI_MASTER_KEY")
INDEX_NAME = "teosed"

def load_env_file():
    """
    Laeb .env failist seaded, kui süsteemi muutujad puuduvad.
    Mõeldud lokaalseks arenduseks.
    """
    global MEILI_URL, MEILI_KEY
    
    # Kui mõlemad on juba olemas (nt Dockerist), siis me EI loe .env faili
    if MEILI_URL and MEILI_KEY:
        print(f"Meilisearch: Kasutan süsteemi keskkonnamutujaid (URL: {MEILI_URL})")
        return

    env_path = os.path.join(_PROJECT_ROOT, ".env")
    if os.path.exists(env_path):
        print(f"Meilisearch: Loen seadeid failist {env_path}")
        with open(env_path, 'r') as f:
            for line in f:
                if '=' in line and not line.startswith('#'):
                    key, value = line.strip().split('=', 1)
                    value = value.strip('"').strip("'")
                    if key == "MEILISEARCH_URL" and not MEILI_URL:
                        MEILI_URL = value
                    elif key in ["MEILISEARCH_MASTER_KEY", "MEILI_MASTER_KEY"] and not MEILI_KEY:
                        MEILI_KEY = value
                    elif key == "MEILI_SEARCH_API_KEY" and not MEILI_KEY:
                        MEILI_KEY = value

    # Kui ikka pole, kasuta vaikimisi URL-i
    if not MEILI_URL:
        MEILI_URL = _DEFAULT_MEILI_URL
    
    print(f"Meilisearch: URL={MEILI_URL}, Key={'määratud' if MEILI_KEY else 'puudu'}")

# Lae seaded kohe mooduli importimisel
load_env_file()
