"""Kliendi- ja serveripoolsete vigade kogumine (#133).

Serveripool (`record_server_error`) kirjutab samasse ringi sisemise teega;
konksud elavad `server_errors.py`-s.

**Miks kohalik, mitte Sentry/GlitchTip.** Issue pakkus välist agregaatorit;
GlitchTip on Docker-stack pluss andmebaas hooldada ja Sentry nõuab otsust, kas
kasutajate andmed tohivad välja minna. Mõlemad on omaette projektid. Siin on
ainult see osa, mis kaotab pimeala: vead jõuavad ise kohale, ilma et kasutaja
peaks kirjutama. Väline agregaator saab hiljem sama endpointi taha tulla.

**Kaetud ring.** `MAX_ERRORS` viimast kirjet, vanemad langevad välja.
Vea-agregaator, mis ise ketta täis kirjutab, on hullem kui mitte ükski.

**Kliendi saadetu on ANDMED, mitte skeem.** Endpoint on avalik (vead tabavad ka
välja logimata kasutajaid), seega kirje ehitatakse VALGE NIMEKIRJA järgi ja
väljad lõigatakse. Ilma selleta saaks igaüks kirjutada admini vaatesse suvalise
struktuuri — ja `auth_token`-i nimelise välja sinna kõrvale (vt #237).
"""
import json
import os
import re
import threading
import time
import traceback
from datetime import datetime, timezone
from typing import List, Optional
from urllib.parse import unquote

from .config import STATE_DIR, get_logger
from .utils import atomic_write_json

logger = get_logger(__name__)

CLIENT_ERRORS_FILE = os.path.join(STATE_DIR, "client_errors.json")

MAX_ERRORS = 500
MAX_MESSAGE_LEN = 500
MAX_STACK_LEN = 4000
MAX_URL_LEN = 500
MAX_UA_LEN = 300

# --- Volituste eemaldamine --------------------------------------------------
#
# `/set-password?token=<uuid>` loeb tokeni päringustringist, seega puhastamata
# URL kirjutaks kehtiva kutse- või paroolivahetuse tokeni admini nähtavasse
# logisse. Klient puhastab juba oma pool (`src/services/scrubSensitive.ts`),
# aga KLIENT ON ANDMED: vana vahemälust laaditud bundle või käsitsi koostatud
# päring saadab mida tahes. Server ei tohi salvestada seda, mida ta kuvada ei
# tohi — sama õppetund kui #237, kus kirjutustee-pop ei puhastanud juba
# salvestatud kirjeid.
#
# Reegel on KAHEOSALINE, sest kumbki pool üksi lekiks:
#   1. võtmenimi — katab lühikesi väärtusi (`?reset=1`)
#   2. väärtuse KUJU — katab tulevasi võtmenimesid, mida keegi ei mäletanud
#      nimekirja lisada. Paljas denylist on nimekiri, mis jääb alati maha.
#
# Kaks keelt, üks reegel: TS-pool peab kandma sama nimekirja ja sama kuju.
REDACTED = "<eemaldatud>"

SENSITIVE_KEYS = {
    "token", "auth_token", "access_token", "refresh_token",
    "reset", "invite", "key", "apikey", "api_key",
    "password", "pwd", "secret", "sig", "signature", "exp", "session",
}

_TOKENISH = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
_LONG_OPAQUE = re.compile(r"^[A-Za-z0-9_-]{24,}$")
_PARAM = re.compile(r"([?&#;])([^=\s?&#;]+)=(\"[^\"]*\"|'[^']*'|[^?&#;\s)\]]*)")


def _on_tundlik(votme_nimi: str, vaartus: str) -> bool:
    if votme_nimi.lower() in SENSITIVE_KEYS:
        return True
    return bool(_TOKENISH.fullmatch(vaartus) or _LONG_OPAQUE.fullmatch(vaartus))


def _decode_for_inspection(value: str) -> str:
    for _ in range(4):
        if "%" not in value:
            return value
        if re.search(r"%(?![0-9a-fA-F]{2})", value):
            raise ValueError("Vigane kodeering")
        value = unquote(value, errors="strict")
    if "%" in value:
        raise ValueError("Liiga sügav kodeering")
    return value


def _scrub_params(tekst: str) -> str:
    def _asenda(m):
        eraldaja, votme_nimi, vaartus = m.group(1), m.group(2), m.group(3)
        try:
            key = _decode_for_inspection(votme_nimi)
            value = _decode_for_inspection(vaartus).strip("\"'")
            if _on_tundlik(key, value):
                return "{}{}={}".format(eraldaja, key, REDACTED)
        except (UnicodeError, ValueError):
            return eraldaja + REDACTED
        return m.group(0)
    return _PARAM.sub(_asenda, tekst)


def scrub(tekst: Optional[str]) -> Optional[str]:
    """Puhastab päringu/fragmendi ka veateate sees ja kodeeritud kujul.

    Kodeeritud ohtlik lõik eemaldatakse tervikuna: dekodeeritud eraldaja või
    tühik ei tohi jätta saladuse lõppu alles. Sama nelja sammu piir on TS-is.
    """
    if not tekst:
        return tekst

    def _kodeeritud(m):
        algne = m.group(0)
        if "%" not in algne:
            return algne
        try:
            decoded = _decode_for_inspection(algne)
            if _scrub_params(decoded) != decoded:
                return REDACTED
            return algne
        except (UnicodeError, ValueError):
            return REDACTED

    return _scrub_params(re.sub(r"\S+", _kodeeritud, _scrub_params(tekst)))


_lock = threading.Lock()
_cache: Optional[List[dict]] = None


def invalidate_cache() -> None:
    """Sunnib järgmise lugemise kettalt. Testidele ja käsitsi muutmisele."""
    global _cache
    with _lock:
        _cache = None


def _load() -> List[dict]:
    """Loeb logi kettalt. Katkine või puuduv fail = tühi logi.

    Vea-agregaator on diagnostika, mitte andmed: tema kadu on talutav, tema
    tõttu kukkuv admin-vaade ei ole.
    """
    if not os.path.exists(CLIENT_ERRORS_FILE):
        return []
    try:
        with open(CLIENT_ERRORS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, list):
            return []
        cleaned = [_clean_record(row) for row in data if isinstance(row, dict)][:MAX_ERRORS]
        if cleaned != data:
            try:
                atomic_write_json(CLIENT_ERRORS_FILE, cleaned)
            except OSError:
                # Ka kirjutustõrke korral tagastame ainult puhastatud koopia.
                logger.warning("Vana vealogi puhastatud koopia salvestamine ebaõnnestus")
        return cleaned
    except (json.JSONDecodeError, OSError) as e:
        logger.warning("client_errors.json loetamatu, alustan tühjalt: %s", e)
        return []


def _puhasta_ja_lyhenda(vaartus, piir: int) -> Optional[str]:
    if vaartus is None:
        return None
    tekst = scrub(str(vaartus))
    return tekst[:piir] if len(tekst) > piir else tekst


# Vana logi peab läbima sama väljade ja pikkuste lepingu kui uus kirje.
_RECORD_LIMITS = {
    "received_at": 80, "message": MAX_MESSAGE_LEN, "stack": MAX_STACK_LEN,
    "url": MAX_URL_LEN, "user_agent": MAX_UA_LEN, "source": 40,
    "username": 200, "ip": 80,
}


def _clean_record(row: dict) -> dict:
    return {key: _puhasta_ja_lyhenda(value, _RECORD_LIMITS[key])
            for key, value in row.items() if key in _RECORD_LIMITS}


def record_error(payload: dict, *, ip: str = "", username: Optional[str] = None) -> bool:
    """Lisab vea logi algusesse. Tagastab False, kui kirje ei kõlba.

    Ajatempli, IP ja kasutajanime paneb SERVER — kliendi oma väide nende kohta
    ei ole tõend.
    """
    if not isinstance(payload, dict):
        return False
    message = _puhasta_ja_lyhenda(payload.get("message"), MAX_MESSAGE_LEN)
    if not message or not message.strip():
        # Teateta kirje ei ütle midagi ja ainult ujutab logi üle.
        return False

    kirje = {
        "received_at": datetime.now(timezone.utc).isoformat(),
        "message": message.strip(),
        "stack": _puhasta_ja_lyhenda(payload.get("stack"), MAX_STACK_LEN),
        "url": _puhasta_ja_lyhenda(payload.get("url"), MAX_URL_LEN),
        "user_agent": _puhasta_ja_lyhenda(payload.get("user_agent"), MAX_UA_LEN),
        # Kust viga tuli: "boundary" (React), "window" (onerror),
        # "promise" (unhandledrejection). Kliendi enda silt, ainult vihjeks.
        "source": _puhasta_ja_lyhenda(payload.get("source"), 40),
        "username": username,
        "ip": ip or None,
    }

    return _lisa(kirje)


def _lisa(kirje: dict) -> bool:
    """Lisab valmis kirje ringi algusesse ja kirjutab kettale."""
    global _cache
    with _lock:
        if _cache is None:
            _cache = _load()
        _cache.insert(0, kirje)
        del _cache[MAX_ERRORS:]
        try:
            atomic_write_json(CLIENT_ERRORS_FILE, _cache)
        except OSError as e:
            # Kirjutamise tõrge ei tohi kliendi päringut kukutada: raportöör ise
            # ei tohi vigu tekitada.
            logger.warning("client_errors.json kirjutamine ebaõnnestus: %s", e)
            return False
    return True


# --- Serveripoolsed vead ------------------------------------------------------
#
# Sama ring, sisemine kirjutustee (mitte avalik POST). Kliendivigadel hoiab
# dedupe + lehesessiooni lagi tsükli kinni; serveril tuleb see siin teha:
# iga päringuga korduv viga täidaks muidu 500-kirjelise ringi minutitega ja
# tõrjuks kliendivead välja. Võti on erindi TÜÜP + VISKEKOHT, mitte teade —
# teade kannab sageli muutuvat id-d.
SERVER_DEDUPE_SECONDS = 300
_server_viimati: dict = {}
_server_lock = threading.Lock()


def _viskekoht(exc: BaseException) -> str:
    tb = exc.__traceback__
    viimane = None
    while tb is not None:
        viimane, tb = tb, tb.tb_next
    if viimane is None:
        return ""
    return "{}:{}".format(viimane.tb_frame.f_code.co_filename, viimane.tb_lineno)


def record_server_error(source: str, exc, *, thread: Optional[str] = None,
                        url: Optional[str] = None) -> bool:
    """Salvestab serveri erindi ringi. Ei viska KUNAGI; tagastab, kas salvestus.

    `source`: "server:thread" (taustalõime surm) või "server:http" (käsitlemata
    erind päringus). Traceback'ist hoitakse LÕPP — Pythoni stack'is on
    viskekoht viimasel real, mitte esimesel.
    """
    try:
        if not isinstance(exc, BaseException):
            return False
        nimi = type(exc).__name__
        votme = (source, nimi, _viskekoht(exc))
        nuud = time.monotonic()
        with _server_lock:
            eelmine = _server_viimati.get(votme)
            if eelmine is not None and nuud - eelmine < SERVER_DEDUPE_SECONDS:
                return False
            _server_viimati[votme] = nuud

        teade = "{}: {}".format(nimi, exc) if str(exc) else nimi
        if thread:
            teade += " (lõim {})".format(thread)
        # Puhastus ENNE lõikamist: lõige saladuse keskelt jätaks poole alles,
        # mida kujureegel enam ära ei tunne.
        stack = scrub("".join(traceback.format_exception(type(exc), exc, exc.__traceback__)))
        kirje = {
            "received_at": datetime.now(timezone.utc).isoformat(),
            "message": _puhasta_ja_lyhenda(teade, MAX_MESSAGE_LEN),
            "stack": stack[-MAX_STACK_LEN:],
            "url": _puhasta_ja_lyhenda(url, MAX_URL_LEN),
            "user_agent": None,
            "source": source[:40],
            "username": None,
            "ip": None,
        }
        return _lisa(kirje)
    except Exception:
        # Raportöör ei tohi ise vigu tekitada — lõime konksus peidaks visatud
        # erind algse vea.
        logger.warning("Serveri vea salvestamine ebaõnnestus", exc_info=True)
        return False


def list_errors(limit: Optional[int] = None) -> List[dict]:
    """Uusim ees."""
    global _cache
    with _lock:
        if _cache is None:
            _cache = _load()
        kirjed = list(_cache)
    return kirjed[:limit] if limit else kirjed


def clear_errors() -> None:
    global _cache
    with _lock:
        _cache = []
        try:
            atomic_write_json(CLIENT_ERRORS_FILE, [])
        except OSError as e:
            logger.warning("client_errors.json tühjendamine ebaõnnestus: %s", e)
