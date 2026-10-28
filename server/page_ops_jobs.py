"""Teose halduse ootel lehetoimingute taustatöö + edenemine (#431, ADR 0050).

Pakk-poolitus võib kesta minuteid; sünkroonne päring jäi kasutajale tummaks ja
suure paki korral jooksis brauseri/nginx-i 600 s piiri vastu (töö serveris
jätkus, aga UI näitas viga). Nüüd: POST käivitab lõime, klient pollib olekut.

Olek elab PROTSESSI mälus (üks uvicorn-worker, sama eeldus mis
`RENDER_SEMAPHORE`-il). Serveri restart keset tööd → olek „idle"; klient
laeb siis nimekirja uuesti ja näeb, mis kettale jõudis. Teose kohta korraga
üks töö sõltumata liigist (`page_ops`, `add_pdf`) — teine start saab 409.
"""
import threading
import time

from .admin_page_ops import PageOpsPartialError, apply_page_ops
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


def start_job(work_id: str, kind: str, total: int, username: str, fn, on_error=None) -> bool:
    """Käivitab teose taustatöö. False = selle teose MISTAHES liigi töö juba käib.

    Teose kohta on korraga üks töö sõltumata liigist (`page_ops`, `add_pdf`):
    mõlemad võtavad `work_lock`-i ja muudavad failinimede loendit. `kind` on
    olekus, et klient jälgiks ainult oma liiki tööd ja käsitleks lõppu õigesti —
    PDF-töö lõpp ei tohi tühjendada ootel lehetoimingute plaani.

    fn(progress) tagastab `result`; progress(done, total). Erindi korral
    lisatakse olekusse `on_error(e)` väljad.
    """
    with _lock:
        if (_jobs.get(work_id) or {}).get("state") == "running":
            return False
        _jobs[work_id] = {"state": "running", "kind": kind, "done": 0, "total": total,
                          "username": username, "started_at": time.time()}

    def run():
        try:
            result = fn(lambda d, t: _set(work_id, done=d, total=t))
            _set(work_id, state="done", result=result, finished_at=time.time())
        except Exception as e:
            # ValueError ja RuntimeError on kasutajale mõeldud sõnumid; muu logitakse ka.
            if not isinstance(e, (ValueError, RuntimeError)):
                logger.exception(f"{kind} töö {work_id} kukkus")
            extra = on_error(e) if on_error else {}
            _set(work_id, state="error", error=str(e), finished_at=time.time(), **extra)

    threading.Thread(target=run, daemon=True, name=f"{kind}-{work_id}").start()
    return True


def _page_ops_error_fields(e: Exception) -> dict:
    # `applied`/`transformed` ütlevad kliendile, mis plaanist maha võtta;
    # ValueError tuleb enne muutmist → midagi ei tehtud. Puuduv väli =
    # teadmata (ootamatu erind) → klient tühjendab plaani.
    if isinstance(e, PageOpsPartialError):
        return {"applied": e.applied, "transformed": e.transformed}
    if isinstance(e, ValueError):
        return {"applied": [], "transformed": []}
    return {}


def start(work_id: str, ops, username: str, total: int) -> bool:
    """Ootel lehetoimingute töö. False = selle teose töö juba käib."""
    return start_job(
        work_id, "page_ops", total, username,
        lambda progress: apply_page_ops(work_id, ops, username, progress=progress),
        on_error=_page_ops_error_fields,
    )


def _reset_for_tests() -> None:
    with _lock:
        _jobs.clear()
