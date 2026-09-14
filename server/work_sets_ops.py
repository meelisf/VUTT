"""Töökollektsioonide salvestuskiht (#354).

Liikmesus EI OLE tuletatud read-model: see on kuraatori otsus, millel on autor ja
taastepunkt → `save_config_with_git` (ADR 0040). Liikmesust ei indekseerita
Meilisearchi; otsing filtreerib `work_id IN [...]` serverilt saadud loendiga.
"""
import json
import os
import threading
from datetime import datetime, timezone
from typing import Optional

from .config import WORK_SETS_DIR, WORK_SET_MAX_MEMBERS, get_logger
from .git_ops import save_config_with_git
from .utils import generate_nanoid

logger = get_logger(__name__)

# Loe-muuda-salvesta peab olema jagamatu: kaks haldurit kirjutaksid muidu
# teineteise muudatuse üle. PIIRANG: protsessi-lokaalne — mitme workeriga
# gunicorni juures vajab protsessideülest lukku (sama hoiatus nagu RENDER_SEMAPHORE).
_work_sets_lock = threading.RLock()


class WorkSetNotFound(Exception):
    pass


class WorkSetConflict(Exception):
    """Oodatud `revision` ei vasta failis olevale."""

    def __init__(self, current_revision):
        super().__init__(f"revision {current_revision}")
        self.current_revision = current_revision


class WorkSetLimit(Exception):
    """Lisamine viiks liikmete arvu üle lae. Kannab ARVE — router otsustab,
    kas need kutsujale näidatakse (varjatud liikmete arv on admin-info)."""

    def __init__(self, current, adding, limit):
        super().__init__("limit")
        self.current, self.adding, self.limit = current, adding, limit


def _path(set_id: str) -> str:
    return os.path.join(WORK_SETS_DIR, f"{set_id}.json")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def load_work_set(set_id: str) -> Optional[dict]:
    """Katkine JSON EI ole tühi kogu: viskab, et kutsuja ei kirjutaks teda üle."""
    path = _path(set_id)
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def list_work_sets() -> list:
    if not os.path.isdir(WORK_SETS_DIR):
        return []
    out = []
    for name in sorted(os.listdir(WORK_SETS_DIR)):
        if not name.endswith(".json"):
            continue
        try:
            with open(os.path.join(WORK_SETS_DIR, name), "r", encoding="utf-8") as f:
                out.append(json.load(f))
        except Exception as e:
            logger.error(f"Katkine töökollektsioon {name}: {e}")
    return out


def _save(ws: dict, username: str, message: str) -> dict:
    os.makedirs(WORK_SETS_DIR, exist_ok=True)
    ws["updated_at"] = _now()
    ws["updated_by"] = username
    save_config_with_git(_path(ws["id"]), ws, username, message)
    return ws


def create_work_set(name: dict, description: Optional[dict], username: str) -> dict:
    with _work_sets_lock:
        set_id = f"ws_{generate_nanoid()}"
        ws = {
            "id": set_id,
            "name": name,
            "description": description or {"et": "", "en": ""},
            "visibility": "members",
            "status": "active",
            "ever_published": False,
            "access": {username: "manager"},
            "works": [],
            "revision": 1,
            "created_by": username,
            "created_at": _now(),
        }
        return _save(ws, username, f"Töökollektsioon: loo {set_id}")


def delete_work_set(set_id: str) -> None:
    """Faili kustutamine. Elutsükli otsuse (kas tohib) teeb router — siin on
    ainult salvestus. Tee tuleb `_path`-ist, et testid saaksid kausta asendada."""
    with _work_sets_lock:
        path = _path(set_id)
        if not os.path.exists(path):
            raise WorkSetNotFound(set_id)
        os.remove(path)


def _check_revision(ws: dict, expected_revision: Optional[int]):
    if expected_revision is not None and ws.get("revision") != expected_revision:
        raise WorkSetConflict(ws.get("revision"))


def update_work_set(set_id: str, changes: dict, username: str,
                    expected_revision: Optional[int] = None) -> dict:
    with _work_sets_lock:
        ws = load_work_set(set_id)
        if ws is None:
            raise WorkSetNotFound(set_id)
        _check_revision(ws, expected_revision)
        muutus = False
        for key in ("name", "description", "status", "visibility", "access"):
            if key in changes and changes[key] != ws.get(key):
                ws[key] = changes[key]
                muutus = True
        if not muutus:
            return ws  # muutusteta salvestus on no-op (ADR 0012 joon)
        if changes.get("visibility") == "public":
            # Avaldamine on pöördumatu MÄRGE, mitte olek: arhiveeritud avalik kogu
            # ei tohi hiljem kustutatavaks muutuda, sest ta link on levinud.
            ws["ever_published"] = True
        ws["revision"] = ws.get("revision", 1) + 1
        return _save(ws, username, f"Töökollektsioon: muuda {set_id}")


def mutate_members(set_id: str, add, remove, username: str,
                   expected_revision: Optional[int] = None) -> dict:
    """Lisamine ja eemaldamine EI ole sümmeetrilised (#354 arvustus).

    Lisatavate ID-de olemasolu ja loetavuse kontrollib router (tal on kutsuja).
    Siin: unikaalsus, lagi ja järjekorra säilimine. Eemaldamine ei nõua, et
    teos veel eksisteeriks — just nii koristatakse kustutatud teoste viiteid.
    """
    with _work_sets_lock:
        ws = load_work_set(set_id)
        if ws is None:
            raise WorkSetNotFound(set_id)
        _check_revision(ws, expected_revision)
        praegu = list(ws.get("works", []))
        olemas = set(praegu)
        lisatavad = [w for w in dict.fromkeys(add or []) if w not in olemas]
        if lisatavad and len(olemas) + len(lisatavad) > WORK_SET_MAX_MEMBERS:
            raise WorkSetLimit(len(olemas), len(lisatavad), WORK_SET_MAX_MEMBERS)
        eemaldatavad = set(remove or [])
        uus = [w for w in praegu if w not in eemaldatavad] + lisatavad
        if uus == praegu:
            return ws
        ws["works"] = uus
        ws["revision"] = ws.get("revision", 1) + 1
        return _save(ws, username, f"Töökollektsioon: liikmed {set_id}")
