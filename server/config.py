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


def _read_dotenv() -> dict:
    """Loeb projekti `.env` faili sõnastikuks. Puuduv fail → {}.

    `VUTT_DOTENV_DIR` on ainult testide seam (import toimub üks kord, nii et
    faili teed ei saa hiljem monkeypatch'ida). Tootmises seda ei seata.
    """
    root = os.getenv("VUTT_DOTENV_DIR") or _PROJECT_ROOT
    path = os.path.join(root, ".env")
    values = {}
    if not os.path.exists(path):
        return values
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    return values


# ÜKS lugeja (ADR 0021). Varem oli neid kaks — see siin ja `load_env_file()`
# allpool — eri reeglitega, mis oli üks põhjus, miks nimede segadus püsis.
_DOTENV = _read_dotenv()


# ADR 0021: üks nimi ühe seade kohta. Vana nimi → uus; None = surnud väli,
# mille väärtust ei loe keegi.
_LEGACY_ENV_NAMES = {
    "MEILISEARCH_URL": "MEILI_URL",
    "MEILISEARCH_MASTER_KEY": "MEILI_MASTER_KEY",
    # Nimi valetas: `config.py` omistas selle master-võtme pesasse.
    "MEILI_SEARCH_API_KEY": "MEILI_MASTER_KEY",
    # Ainus tarbija oli `vite.config.ts` define, mida ükski komponent ei kasutanud.
    "MEILI_API_KEY": None,
    # Frontend ei loe Meili võtit — ta küsib backendilt runtime'is tenant-tokeni.
    "VITE_MEILI_SEARCH_API_KEY": None,
}


def _fail_on_legacy_env_names():
    """Peatab käivituse, kui keskkonnas või `.env`-is on ADR 0021 eelne nimi.

    Vaikne fallback-ahel oli juurpõhjus: vale nimi ei andnud kunagi viga,
    vaid halvimal juhul jooksis backend otsinguvõtmega master-võtme pesas.
    Vali viga on parem kui vaikselt valede õigustega server.

    Käib ENNE os.environ-i süstimist — muidu jõuaks tagasi lükatud nimi
    protsessi keskkonda ja jääks sinna ka pärast veateadet.
    """
    found = []
    for legacy, canonical in sorted(_LEGACY_ENV_NAMES.items()):
        if legacy in os.environ or legacy in _DOTENV:
            target = canonical if canonical else "(surnud väli — eemalda)"
            found.append(f"  - {legacy} → {target}")
    if found:
        sys.exit(
            "FATAL: kasutusel on aegunud keskkonnamuutuja nimi (ADR 0021).\n"
            + "\n".join(found)
            + "\nParanda .env / docker-compose.yml ja käivita uuesti."
        )


_fail_on_legacy_env_names()

# Süstime puuduvad väärtused os.environ-i, sest osa mooduleid ja teeke loeb
# otse sealt. Süsteemi muutujad jäävad ülimuslikuks.
for _k, _v in _DOTENV.items():
    if _k not in os.environ:
        os.environ[_k] = _v


def env(name: str, default: str = "") -> str:
    """Seade väärtus: süsteemi keskkond → projekti `.env` → vaikeväärtus."""
    return os.getenv(name) or _DOTENV.get(name) or default


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

# OCR-jooksude kaugkataloogide HILINE eemaldamine (#225). Katkestamise koristus
# kustutab failid kohe (see peatab GPU-töö), aga kataloogi ennast mitte: kui
# batch on juba GPU-s, kirjutab OCR-valvur .txt ilma veakäsitluseta ja kadunud
# kataloog kukutaks kogu teenuse. Kataloog eemaldatakse alles siis, kui ükski
# batch ei saa enam lennus olla.
OCR_RUN_REAPS_FILE = os.path.join(_STATE_DIR, "ocr_run_reaps.json")
RUN_DIR_REAP_GRACE = 600   # s; mõõdetud batch (4 lk) ≈ 100 s, varu on tahtlik

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

INDEX_NAME = "teosed"


MEILI_URL = env("MEILI_URL", _DEFAULT_MEILI_URL)
MEILI_KEY = env("MEILI_MASTER_KEY")
MEILI_SEARCH_KEY = env("MEILI_SEARCH_KEY")
MEILI_SEARCH_KEY_UID = env("MEILI_SEARCH_KEY_UID")

# Pildi-HMAC allkirjastamise saladus (image_server + main.py jagavad sama saladust)
IMAGE_TOKEN_SECRET = env("IMAGE_TOKEN_SECRET", "dev-image-secret-change-in-production")

print(f"Meilisearch: URL={MEILI_URL}, master-võti={'määratud' if MEILI_KEY else 'puudu'}")


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
        ("MEILI_MASTER_KEY", MEILI_KEY),
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


def check_render_concurrency():
    """Hoiatab, kui veebiprotsesse on rohkem kui üks.

    `prepress.RENDER_SEMAPHORE(1)` piirab rasterdust ÜHE protsessi sees. Pärast
    ADR 0028 läbivad KÕIK upload'id rasterduse (varem ainult poolitatavad),
    seega mitu workerit tähendaks mitut samaaegset 300 DPI renderdust ilma
    ühegi piiranguta. Tagastab hoiatuse teksti või None.
    """
    for nimi in ("WEB_CONCURRENCY", "UVICORN_WORKERS", "GUNICORN_WORKERS"):
        try:
            workereid = int(os.getenv(nimi, "1") or "1")
        except ValueError:
            continue
        if workereid > 1:
            return (
                "{}={}: RENDER_SEMAPHORE(1) on protsessi-lokaalne. Enne mitme "
                "workeri kasutamist tuleb see asendada protsessideülese lukuga "
                "(ADR 0028), muidu renderdab masin korraga {} 300 DPI PDF-i."
            ).format(nimi, workereid, workereid)
    return None
