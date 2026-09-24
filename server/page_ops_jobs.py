"""Teose halduse ootel lehetoimingute taustatöö + edenemine (#431, ADR 0050).

Pakk-poolitus võib kesta minuteid; sünkroonne päring jäi kasutajale tummaks ja
suure paki korral jooksis brauseri/nginx-i 600 s piiri vastu (töö serveris
jätkus, aga UI näitas viga). Nüüd: POST käivitab lõime, klient pollib olekut.

Olek elab PROTSESSI mälus (üks uvicorn-worker, sama eeldus mis
`RENDER_SEMAPHORE`-il). Serveri restart keset tööd → olek „idle"; klient
laeb siis nimekirja uuesti ja näeb, mis kettale jõudis. Teose kohta korraga
üks töö — teine start saab 409.
"""
import threading
import time

from .admin_page_ops import apply_page_ops
from .config import get_logger

logger = get_logger(__name__)

_lock = threading.Lock()
_jobs: dict = {}          # work_id → olek
KEEP_FINISHED_S = 600     # lõpetatud töö olek jääb pollimiseks alles


def _set(work_id: str, **fields) -> None:
    with _lock:
        _jobs.setdefault(work_id, {}).update(fields)


def get_status(work_id: str) -> dict:
    with _lock:
        job = dict(_jobs.get(work_id) or {})
    if not job:
        return {"state": "idle"}
    if job.get("state") != "running" and time.time() - job.get("finished_at", 0) > KEEP_FINISHED_S:
        return {"state": "idle"}
    return job


def start(work_id: str, ops, username: str, total: int) -> bool:
    """False = selle teose töö juba käib."""
    with _lock:
        if (_jobs.get(work_id) or {}).get("state") == "running":
            return False
        _jobs[work_id] = {"state": "running", "done": 0, "total": total,
                          "username": username, "started_at": time.time()}

    def run():
        try:
            result = apply_page_ops(work_id, ops, username,
                                    progress=lambda d, t: _set(work_id, done=d, total=t))
            _set(work_id, state="done", result=result, finished_at=time.time())
        except Exception as e:
            # ValueError (leht kadus vahepeal) ja RuntimeError (osaline) on
            # kasutajale mõeldud sõnumid; muu logitakse ka.
            if not isinstance(e, (ValueError, RuntimeError)):
                logger.exception(f"PAGE-OPS töö {work_id} kukkus")
            _set(work_id, state="error", error=str(e), finished_at=time.time())

    threading.Thread(target=run, daemon=True, name=f"page-ops-{work_id}").start()
    return True


def _reset_for_tests() -> None:
    with _lock:
        _jobs.clear()
