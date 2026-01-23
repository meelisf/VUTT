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

# Proovime lugeda keskkonnamuutujatest (Docker/Prod)
MEILI_URL = os.getenv("MEILISEARCH_URL", "http://127.0.0.1:7700")
MEILI_KEY = os.getenv("MEILISEARCH_MASTER_KEY") or os.getenv("MEILI_MASTER_KEY", "")
INDEX_NAME = "teosed"

def load_env():
    """
    Laeb .env failist Meilisearchi andmed (arenduskeskkonna jaoks).
    Ainult siis, kui neid pole juba keskkonnamuutujatest leitud.
    """
    global MEILI_URL, MEILI_KEY
    
    # Kui võtmed on juba olemas (nt Dockerist), siis ära loe failist üle
    if MEILI_URL and MEILI_KEY and MEILI_URL != "http://127.0.0.1:7700":
        return

    env_path = os.path.join(_PROJECT_ROOT, ".env")
    if os.path.exists(env_path):
        with open(env_path, 'r') as f:
            for line in f:
                if '=' in line and not line.startswith('#'):
                    key, value = line.strip().split('=', 1)
                    value = value.strip('"').strip("'")
                    if key == "MEILISEARCH_URL":
                        MEILI_URL = value
                    elif key in ["MEILISEARCH_MASTER_KEY", "MEILI_MASTER_KEY"]:
                        MEILI_KEY = value
                    elif key == "MEILI_SEARCH_API_KEY" and not MEILI_KEY:
                        MEILI_KEY = value
    print(f"Meilisearch URL: {MEILI_URL}")

# Lae env kohe mooduli importimisel
load_env()
