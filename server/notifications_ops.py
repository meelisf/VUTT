"""
Kasutajateavituste (notifications) äraloogika.

Tõstetud ``server/main.py``-st refaktoreeringu Faas 1-s
(``docs/_archive/REFACTOR_main_py_2026-06-25.md``). Domeen on täielikult iseseisev:
teavitused salvestatakse iga kasutaja kohta eraldi JSON-faili
(``state/notifications/{username}.json``), piiratud 200 uuema teatisega.

Failipõhine salvestus (mitte andmebaas) on teadlik valik: teavitused on
kasutaja-kohased, madala sagedusega ja peavad säilima üle serveri taaskäivituse.
Lukustus (``_notifications_lock``, RLock) kaitseb samaaegseid kirjutusi.

``server/routers/notifications.py`` kasutab neid funktsioone; ``main.py`` jätab
backward-compat re-eksporti vanade ``_``-eelistatud nimedega (kuni kõik viited
uuenevad).

NB (tehniline võlg, märgitud): ``get_notifications_path`` tõstab ``HTTPException``
sisendi valideerimisel. Ideaalis peaks ops-moodul olema HTTP-vaba (tõstma
``ValueError``) ja endpoint teisendama selle. Praegu jäetud sellisena, et mitte
muuta käitumist — eraldi cleanup.
"""
import os
import json
import uuid
import threading
from datetime import datetime

from fastapi import HTTPException

from .auth import get_all_users
from .config import NOTIFICATIONS_DIR, get_logger
from .utils import atomic_write_json

logger = get_logger(__name__)

# Lõimedevaheline lukk kaitseb samaaegseid kirjutusi sama kasutaja failile.
# RLock lubab ümberkinnitust (nt create_notification → append_notification →
# save_notification hoiab lukku kogu ahela vältel).
_notifications_lock = threading.RLock()

# Maksimaalne säilitatavate teatiste arv kasutaja kohta. Vanemad kärbitakse.
MAX_NOTIFICATIONS = 200


def safe_username(username: str) -> str:
    """Piira teavituste failinimi lihtsa kasutajanime kujule.

    Eemaldab path-eraldajad (basename) — kaitse path-traversali vastu,
    et ``../etc/passwd``-stiilis kasutajanimi ei pääseks failisüsteemi.
    """
    return os.path.basename(username or "").strip()


def get_notifications_path(username: str) -> str:
    """Tagastab kasutaja teatiste faili tee.

    Tõstab ``HTTPException(400)`` tühja/vigase kasutajanime korral.
    """
    safe = safe_username(username)
    if not safe:
        raise HTTPException(status_code=400, detail="Vigane kasutajanimi")
    return os.path.join(NOTIFICATIONS_DIR, f"{safe}.json")


def load_notifications(username: str) -> list:
    """Laeb kasutaja teavitused. Tagastab ``[]`` kui faili pole või sisu on vigane.

    NB (teadlik resilience-paranus, mitte puhas tõstmine main.py-st): algne
    ``_load_notifications`` ei pakkunud ``json.load`` ümber try/except-i —
    korrumpeerunud teavituste-fail andis käsitlemata erindi → HTTP 500. Siin
    neelatakse see ja tagastatakse ``[]``: ühe kasutaja katkine teatistefail
    ei tohi lammutada kogu teavituste funktsionaalsust (GET /notifications,
    teatiste saatmine). Kaetud testiga
    ``test_load_notifications_returns_empty_for_corrupt_json``.
    """
    path = get_notifications_path(username)
    if not os.path.exists(path):
        return []
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception:
        return []
    return data if isinstance(data, list) else []


def save_notifications(username: str, notifications: list):
    """Salvestab kasutaja teavitused (kirjutab üle). Loob kataloogi vajadusel."""
    os.makedirs(NOTIFICATIONS_DIR, exist_ok=True)
    atomic_write_json(get_notifications_path(username), notifications)


def append_notification(username: str, notification: dict):
    """Lisab uue teatise kasutajale (ette, uuemad ees) ja kärpib MAX_NOTIFICATIONS-ni."""
    with _notifications_lock:
        notifications = load_notifications(username)
        notifications.insert(0, notification)
        save_notifications(username, notifications[:MAX_NOTIFICATIONS])


def create_notification(
    recipient_username: str,
    notification_type: str,
    title: str,
    body: str = "",
    link: str = "",
    actor=None,
    metadata=None,
):
    """Loob ja salvestab ühe teatise. Tagastab loodud teatise dict-i.

    ``actor`` on valikuline dict kasutaja kohta (``{"username", "name"}``) —
    kasutatakse teatise ``actor_username`` ja ``actor_name`` väljade täitmiseks.
    """
    now = datetime.now().isoformat()
    notification = {
        "id": uuid.uuid4().hex,
        "type": notification_type,
        "recipient_username": recipient_username,
        "title": title,
        "body": body,
        "link": link,
        "actor_username": actor.get("username") if actor else "",
        "actor_name": (actor.get("name") or actor.get("username")) if actor else "",
        "metadata": metadata or {},
        "created_at": now,
        "read_at": None,
    }
    append_notification(recipient_username, notification)
    return notification


def find_username_by_display_name(display_name):
    """Leiab kasutajanime kuvanime järgi (username VÕI name väli).

    Kasutatakse ``/page-comments/reply`` juures: vanemad kommentaarid sisaldavad
    vaid ``author`` (kuvanimi), mitte ``author_username``. Tagastab ``None`` kui
    ei leita.
    """
    if not display_name:
        return None
    for account in get_all_users():
        if account.get("username") == display_name or account.get("name") == display_name:
            return account.get("username")
    return None
