"""
Serveri konfiguratsioon.
Kõik seaded ja konstandid ühes kohas.
"""
import logging
import logging.handlers
import os
import sys
from datetime import timedelta

# =========================================================
# LOGIMINE
# =========================================================

# Logide kaust
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_LOGS_DIR = os.path.join(_PROJECT_ROOT, "logs")

# Lae .env fail os.environ-isse (enne kõiki os.getenv() kutseid)
# Süsteemi muutujad on prioriteetsemad — .env kirjutab ainult puuduvad
_env_path = os.path.join(_PROJECT_ROOT, ".env")
if os.path.exists(_env_path):
    with open(_env_path, 'r') as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and '=' in _line and not _line.startswith('#'):
                _k, _v = _line.split('=', 1)
                _k = _k.strip()
                _v = _v.strip().strip('"').strip("'")
                if _k not in os.environ:
                    os.environ[_k] = _v
os.makedirs(_LOGS_DIR, exist_ok=True)

# Logging formaat
LOG_FORMAT = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
LOG_DATE_FORMAT = "%Y-%m-%d %H:%M:%S"

# Logifaili rotatsioon: max 10MB, hoiame 5 vana versiooni
# Kokku max ~60MB logisid (vutt.log + vutt.log.1 ... vutt.log.5)
_log_file_handler = logging.handlers.RotatingFileHandler(
    os.path.join(_LOGS_DIR, "vutt.log"),
    maxBytes=10 * 1024 * 1024,  # 10 MB
    backupCount=5,
    encoding="utf-8"
)
_log_file_handler.setFormatter(logging.Formatter(LOG_FORMAT, LOG_DATE_FORMAT))

_log_stream_handler = logging.StreamHandler(sys.stdout)
_log_stream_handler.setFormatter(logging.Formatter(LOG_FORMAT, LOG_DATE_FORMAT))

# Konfigureeri juurlogger
logging.basicConfig(
    level=logging.INFO,
    handlers=[_log_file_handler, _log_stream_handler]
)

# Vähenda kolmandate osapoolte logimist
logging.getLogger("urllib3").setLevel(logging.WARNING)
logging.getLogger("git").setLevel(logging.WARNING)

# Ekspordi logger teiste moodulite jaoks
def get_logger(name):
    """Tagastab loggeri antud nimega."""
    return logging.getLogger(name)

# =========================================================
# FAILISÜSTEEMI TEED
# =========================================================

# VUTT_DATA_DIR env variable allows overriding the path for Docker/Production
DEFAULT_DIR = "data"
BASE_DIR = os.getenv("VUTT_DATA_DIR", DEFAULT_DIR)

# JSON failide asukohad
# NB: _PROJECT_ROOT on defineeritud ülal logimise sektsioonis

# Runtime/tundlikud failid — projekti state/ kaustas (ei ole gitis)
_STATE_DIR = os.path.join(_PROJECT_ROOT, "state")
STATE_DIR = _STATE_DIR  # Ekspordi kasutamiseks teistes moodulites
USERS_FILE = os.path.join(_STATE_DIR, "users.json")
PENDING_REGISTRATIONS_FILE = os.path.join(_STATE_DIR, "pending_registrations.json")
INVITE_TOKENS_FILE = os.path.join(_STATE_DIR, "invite_tokens.json")
RESET_TOKENS_FILE = os.path.join(_STATE_DIR, "reset_tokens.json")
REOCR_LOG_FILE = os.path.join(_STATE_DIR, "reocr_log.json")

# Konfiguratsioonifailid — data/config/ kaustas (sisemises gitis)
_DATA_CONFIG_DIR = os.path.join(BASE_DIR, "config")
DATA_CONFIG_DIR = _DATA_CONFIG_DIR  # Ekspordi kasutamiseks teistes moodulites
COLLECTIONS_FILE = os.path.join(_DATA_CONFIG_DIR, "collections.json")
VOCABULARIES_FILE = os.path.join(_DATA_CONFIG_DIR, "vocabularies.json")
PERSON_ALIASES_FILE = os.path.join(_DATA_CONFIG_DIR, "person_aliases.json")
LABELS_FILE = os.path.join(_DATA_CONFIG_DIR, "labels.json")
PLACES_FILE = os.path.join(_DATA_CONFIG_DIR, "places.json")
ORIGIN_GROUPS_FILE = os.path.join(_DATA_CONFIG_DIR, "origin_groups.json")
PROSOPOGRAPHY_INDEX_FILE = os.path.join(_DATA_CONFIG_DIR, "prosopography_index.json")
PERSON_TO_WORKS_FILE = os.path.join(_DATA_CONFIG_DIR, "person_to_works.json")
WORKS_CREATORS_INDEX_FILE = os.path.join(_DATA_CONFIG_DIR, "works_creators_index.json")
WORK_COLLECTIONS_INDEX_FILE = os.path.join(_DATA_CONFIG_DIR, "work_collections_index.json")
ARCHIVES_FILE = os.path.join(_DATA_CONFIG_DIR, "archives.json")

# Kasutaja runtime seaded — state/user_settings/ kaustas (ei ole gitis)
USER_SETTINGS_DIR = os.path.join(_STATE_DIR, "user_settings")
NOTIFICATIONS_DIR = os.path.join(_STATE_DIR, "notifications")

# Re-OCR ülekirjutatud .ocr tulemuste varukoopiad (katkestamisel taastatakse).
# EI TOHI olla teose kaustas: data/.gitignore ignoreerib *.ocr, aga varukoopia
# nimi ei vastaks mustrile ja ilmuks git status'isse (#217).
REOCR_BACKUPS_DIR = os.path.join(_STATE_DIR, "reocr_backups")

# Prosopograafia: ÜKS juur, selle all varatüübid (#221).
# Kaardid on gitis, pildid mitte (data/.gitignore → *.jpg), aga MÕLEMAD elavad
# siin — pildid olid varem state/-is ja see lahknemine tekitas kolm koopiat.
# Pildi-tee tuletatakse juurest: kaks sõltumatut liitmist lahkneksid uuesti.
PROSOPOGRAPHY_DIR = os.path.join(_DATA_CONFIG_DIR, "prosopography")
PROSOPOGRAPHY_IMAGES_DIR = os.path.join(PROSOPOGRAPHY_DIR, "images")

# Album Academicum referentsandmed
AA_FILE = os.path.join(_PROJECT_ROOT, "reference_data", "album_academicum.json")

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
    '/register': (6, 3600),         # 6 taotlust tunnis
    '/invite/set-password': (5, 300),  # 5 katset 5 minuti jooksul
    '/reset/validate': (10, 300),       # 10 valideerimist 5 min jooksul IP kohta
    '/reset/set-password': (5, 300),    # 5 katset 5 min jooksul (nagu invite)
    '/download': (20, 60),          # 20 allalaadimist minutis IP kohta
    # Avalikke /meta/* SEO endpointe ei piirata IP järgi: Google'i sitemap'i
    # valideerimine küsib tuhandeid URL-e lühikese aja jooksul ning serverini
    # jõuavad ülikooli pöördproksi tõttu eri kliendid sama IP-ga.
    '/prosopography/wikidata': (30, 60),  # 30 Wikidata-proksi päringut minutis IP kohta (anonüümne)
    '/prosopography/map-regions': (120, 60),  # Kaardi liigutamine võib teha mitu cache'itud päringut
}

# =========================================================
# UPLOAD (admin teose lisamine PDF/piltidest OCR kaudu)
# =========================================================

UPLOAD_ENABLED = os.getenv("UPLOAD_ENABLED", "false").lower() == "true"

OCR_SERVER_HOST = os.getenv("OCR_SERVER_HOST", "172.17.120.146")
OCR_SERVER_USER = os.getenv("OCR_SERVER_USER", "mf")
# Juurkaust OCR serveris — AUTO-OCR/ ja VIGASED/ on selle alamkaustad
OCR_SERVER_PATH = os.getenv("OCR_SERVER_PATH", "/home/mf/Dokumendid/LLM")

# Uploads staging kaust VUTT juurkataloogis (väljaspool data/)
UPLOADS_DIR = os.path.join(_PROJECT_ROOT, "uploads")

# =========================================================
# MEILISEARCH
# =========================================================

# Vaikimisi väärtused (arenduseks)
_DEFAULT_MEILI_URL = "http://127.0.0.1:7700"

# 1. Proovime lugeda süsteemi keskkonnamuutujatest (Docker/Production eelistatud)
MEILI_URL = os.getenv("MEILISEARCH_URL")
MEILI_KEY = os.getenv("MEILISEARCH_MASTER_KEY") or os.getenv("MEILI_MASTER_KEY")
MEILI_SEARCH_KEY = os.getenv("MEILI_SEARCH_KEY", "")
MEILI_SEARCH_KEY_UID = os.getenv("MEILI_SEARCH_KEY_UID", "")
INDEX_NAME = "teosed"

# Pildi-HMAC allkirjastamise saladus (image_server + main.py jagavad sama saladust)
# Tootmises sea IMAGE_TOKEN_SECRET keskkonnamuutujaga
IMAGE_TOKEN_SECRET = os.getenv("IMAGE_TOKEN_SECRET", "dev-image-secret-change-in-production")

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


# =========================================================
# TOOTMISE SALADUSTE KONTROLL (Leid 1)
# =========================================================

# Teadaolevad arendusvaikeväärtused — tootmises ei tohi nendega käivituda.
# Vt docker-compose.yml: MEILI_MASTER_KEY ja IMAGE_TOKEN_SECRET fallbackid.
_KNOWN_DEFAULT_SECRETS = {
    "vutt_master_key",
    "dev-image-secret-change-in-production",
}


def check_production_secrets(exit_on_fail=True):
    """Tootmises (VUTT_ENV=production) keeldu käivitumast teadaolevate arendussaladustega.

    Kontrollib backend-i kontrolli all olevaid saladusi (Meilisearch master key, pildi-HMAC).
    Umami saladused (UMAMI_DB_PASSWORD, UMAMI_APP_SECRET) on eraldi konteinerites — backend
    neid ei näe — ja tuleb hallata deploy-tasandil (.env / docker-compose).

    Tagastab probleemide nimekirja. exit_on_fail=True korral kutsub sys.exit, kui leidub.
    """
    if os.getenv("VUTT_ENV", "dev").lower() != "production":
        return []

    problems = []
    checks = [
        ("MEILISEARCH master key (MEILISEARCH_MASTER_KEY / MEILI_MASTER_KEY)", MEILI_KEY),
        ("IMAGE_TOKEN_SECRET", IMAGE_TOKEN_SECRET),
    ]
    for name, val in checks:
        if not val:
            problems.append(f"  - {name}: puudub")
        elif val in _KNOWN_DEFAULT_SECRETS:
            problems.append(f"  - {name}: kasutab teadaolevat arendusvaikeväärtust")

    if problems and exit_on_fail:
        sys.exit(
            "FATAL: tootmises (VUTT_ENV=production) ei tohi käivituda arendussaladustega:\n"
            + "\n".join(problems)
            + "\nSea õiged saladused keskkonnamuutujatega ja käivita uuesti."
        )
    return problems


# Käivita kontroll kohe mooduli importimisel (enne serveri starti)
check_production_secrets()
