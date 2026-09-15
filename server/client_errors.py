"""Kliendipoolsete vigade kogumine (#133).

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
import threading
from datetime import datetime, timezone
from typing import List, Optional

from .config import STATE_DIR, get_logger
from .utils import atomic_write_json

logger = get_logger(__name__)

CLIENT_ERRORS_FILE = os.path.join(STATE_DIR, "client_errors.json")

MAX_ERRORS = 500
MAX_MESSAGE_LEN = 500
MAX_STACK_LEN = 4000
MAX_URL_LEN = 500
MAX_UA_LEN = 300

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
        return data if isinstance(data, list) else []
    except (json.JSONDecodeError, OSError) as e:
        logger.warning("client_errors.json loetamatu, alustan tühjalt: %s", e)
        return []


def _lyhenda(vaartus, piir: int) -> Optional[str]:
    if vaartus is None:
        return None
    tekst = str(vaartus)
    return tekst[:piir] if len(tekst) > piir else tekst


def record_error(payload: dict, *, ip: str = "", username: Optional[str] = None) -> bool:
    """Lisab vea logi algusesse. Tagastab False, kui kirje ei kõlba.

    Ajatempli, IP ja kasutajanime paneb SERVER — kliendi oma väide nende kohta
    ei ole tõend.
    """
    if not isinstance(payload, dict):
        return False
    message = _lyhenda(payload.get("message"), MAX_MESSAGE_LEN)
    if not message or not message.strip():
        # Teateta kirje ei ütle midagi ja ainult ujutab logi üle.
        return False

    kirje = {
        "received_at": datetime.now(timezone.utc).isoformat(),
        "message": message.strip(),
        "stack": _lyhenda(payload.get("stack"), MAX_STACK_LEN),
        "url": _lyhenda(payload.get("url"), MAX_URL_LEN),
        "user_agent": _lyhenda(payload.get("user_agent"), MAX_UA_LEN),
        # Kust viga tuli: "boundary" (React), "window" (onerror),
        # "promise" (unhandledrejection). Kliendi enda silt, ainult vihjeks.
        "source": _lyhenda(payload.get("source"), 40),
        "username": username,
        "ip": ip or None,
    }

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
