"""Agendi tekstiettepaneku paki kinnitus taustatööna (#641; `page_ops_jobs` muster).

Register on `server/jobs.py` (olek protsessi mälus). Teose kohta korraga üks
töö — teine start saab 409. Serveri restart keset tööd → „idle"; lehtede olek
elab SQLite-s ja ülevaatus taastub (`page_text_proposals.review_page`).
"""
from . import page_text_proposals as ptp
from .jobs import JobRegistry

_registry = JobRegistry("page_text_proposal_jobs", expected_errors=(ptp.ProposalError, RuntimeError))
get_status = _registry.get_status
_reset_for_tests = _registry._reset_for_tests


def start(proposal_id: str, work_id: str, work_dir: str, username: str) -> bool:
    """False = selle teose töö juba käib."""
    return _registry.start(
        work_id, "text_proposal",
        lambda progress: ptp.apply_pack(proposal_id, work_dir, username, progress=progress),
        username=username, proposal_id=proposal_id,
    )
