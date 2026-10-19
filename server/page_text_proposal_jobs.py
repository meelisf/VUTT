"""Agendi tekstiettepaneku paki kinnitus taustatööna (#641; `page_ops_jobs` muster).

Olek elab PROTSESSI mälus (üks uvicorn-worker). Teose kohta korraga üks töö —
teine start saab 409. Serveri restart keset tööd → „idle"; lehtede olek elab
SQLite-s ja ülevaatus taastub (`page_text_proposals.review_page`).
"""
import threading
import time

from . import page_text_proposals as ptp
from .config import get_logger

logger = get_logger(__name__)

_lock = threading.Lock()
_jobs: dict = {}          # work_id → olek
KEEP_FINISHED_S = 600


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


def start(proposal_id: str, work_id: str, work_dir: str, username: str) -> bool:
    """False = selle teose töö juba käib."""
    with _lock:
        if (_jobs.get(work_id) or {}).get("state") == "running":
            return False
        _jobs[work_id] = {"state": "running", "done": 0, "total": 0, "proposal_id": proposal_id,
                          "username": username, "started_at": time.time()}

    def run():
        try:
            result = ptp.apply_pack(proposal_id, work_dir, username,
                                    progress=lambda d, t: _set(work_id, done=d, total=t))
            _set(work_id, state="done", result=result, finished_at=time.time())
        except Exception as e:
            if not isinstance(e, (ptp.ProposalError, RuntimeError)):
                logger.exception(f"Tekstiettepaneku pakk {proposal_id} ({work_id}) kukkus")
            _set(work_id, state="error", error=str(e), finished_at=time.time())

    threading.Thread(target=run, daemon=True, name=f"text-proposal-{work_id}").start()
    return True


def _reset_for_tests() -> None:
    with _lock:
        _jobs.clear()
