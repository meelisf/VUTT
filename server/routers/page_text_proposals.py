# server/routers/page_text_proposals.py
"""Agendi lehe teksti ettepanekud (#641, ADR 0058 täiendus 2026-10-19).

Koodiga otspunktid (`source`, `submit`) on autentimata — kood on ainus õigus ja
see annab ainult lugemise + ootel ettepaneku. Ülevaatus ja otsused: superadmin.
`/api/files/` proksib kõik teed avalikult, seega toortekst (ka piiratud
teosel) väljastatakse AINULT kehtiva koodiga.
"""
import json

from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response
from starlette.concurrency import run_in_threadpool

from .. import page_text_proposal_jobs as jobs
from .. import page_text_proposals as ptp
from ..deps import require_role
from ..rate_limit import check_rate_limit, get_client_ip
from ..utils import find_directory_by_id
from ..vutt_tags import VUTT_TAG_REGISTRY

router = APIRouter()

_SUBMIT_KEYS = {"code", "work_id", "pages", "note"}
_CONFLICT_PREFIXES = ("stale_page", "handoff_used_up", "proposal_decided")


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except ptp.ProposalError as e:
        code = str(e)
        status = 404 if code == "unknown_proposal" else 409 if code.startswith(_CONFLICT_PREFIXES) else 400
        raise HTTPException(status_code=status, detail=code)


def _work_dir(work_id: str, *, status: int = 404) -> str:
    path = find_directory_by_id(work_id) if isinstance(work_id, str) else None
    if not path:
        raise HTTPException(status_code=status, detail="Teost ei leitud" if status == 404
                            else "invalid_or_expired_handoff")
    return path


def _own_pack(proposal_id: str, work_id: str) -> str:
    if _call(ptp.pack_work_id, proposal_id) != work_id:
        raise HTTPException(status_code=404, detail="unknown_proposal")
    return _work_dir(work_id)


def _rate(request: Request, key: str) -> None:
    allowed, retry = check_rate_limit(get_client_ip(request), key)
    if not allowed:
        raise HTTPException(status_code=429, detail="Liiga palju katseid", headers={"Retry-After": str(retry)})


@router.get("/markup/tags")
def markup_tags():
    """VUTT-i märgenduse register agendile (ADR 0071) — ainult avalik kirjeldus."""
    return [{"name": t.name, "paired": t.paired, "tei": t.tei} for t in VUTT_TAG_REGISTRY]


@router.post("/works/text-proposals/source")
def text_proposal_source(request: Request, body: dict = Body(...)):
    """MCP: lehe toortekst koodiga (lugemine kasutuskorda ei kuluta)."""
    _rate(request, "/works/text-proposals-source")
    if not isinstance(body, dict) or set(body) != {"code", "work_id", "page"}:
        raise HTTPException(status_code=400, detail="Vigane päring")
    # Koodita küsija ei tohi teose olemasolust midagi teada saada.
    path = _work_dir(body["work_id"], status=400)
    return _call(ptp.read_source, body["code"], body["work_id"], path, body["page"])


@router.post("/works/text-proposals/submit")
async def text_proposal_submit(request: Request):
    """MCP: ainult ootel ettepaneku talletamine; kood ei anna kirjutusõigust."""
    _rate(request, "/works/text-proposals-submit")
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > ptp.MAX_BODY_BYTES:
            raise HTTPException(status_code=413, detail="Ettepanek on liiga suur")
    try:
        data = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        raise HTTPException(status_code=400, detail="Vigane JSON")
    if not isinstance(data, dict) or not {"code", "work_id", "pages"} <= set(data) \
            or not set(data) <= _SUBMIT_KEYS:
        raise HTTPException(status_code=400, detail="Vigane ettepaneku kuju")
    path = await run_in_threadpool(_work_dir, data["work_id"], status=400)
    return await run_in_threadpool(_call, ptp.submit, data["code"], data["work_id"], path,
                                   data["pages"], data.get("note"))


@router.get("/text-proposals")
def text_proposals_all(user=Depends(require_role("superadmin"))):
    return ptp.list_pending()


@router.get("/works/{work_id}/text-proposals")
def text_proposals_for_work(work_id: str, user=Depends(require_role("superadmin"))):
    return ptp.list_pending(work_id)


@router.get("/works/{work_id}/text-proposals/job")
def text_proposal_job(work_id: str, user=Depends(require_role("superadmin"))):
    return jobs.get_status(work_id)


@router.get("/works/{work_id}/text-proposals/{proposal_id}/pages/{stem}")
def text_proposal_page(work_id: str, proposal_id: str, stem: str, user=Depends(require_role("superadmin"))):
    """Lehe ettepanek ülevaatuseks: lehe vaade + selle vastu liidetud kandidaat ÜHEST hetktõmmisest."""
    path = _own_pack(proposal_id, work_id)
    return _call(ptp.review_page, proposal_id, stem, path)


@router.post("/works/{work_id}/text-proposals/{proposal_id}/pages/{stem}/reject")
def text_proposal_page_reject(work_id: str, proposal_id: str, stem: str,
                              user=Depends(require_role("superadmin"))):
    _own_pack(proposal_id, work_id)
    return {"rejected": ptp.reject_page(proposal_id, stem, user["username"])}


@router.post("/works/{work_id}/text-proposals/{proposal_id}/reject")
def text_proposal_reject(work_id: str, proposal_id: str, user=Depends(require_role("superadmin"))):
    _own_pack(proposal_id, work_id)
    return {"rejected": ptp.reject_pack(proposal_id, user["username"])}


@router.post("/works/{work_id}/text-proposals/{proposal_id}/accept", status_code=202)
def text_proposal_accept(work_id: str, proposal_id: str, response: Response,
                         user=Depends(require_role("superadmin"))):
    """Paki kinnitus taustatööna; olekut pollitakse `…/text-proposals/job` kaudu."""
    path = _own_pack(proposal_id, work_id)
    if not jobs.start(proposal_id, work_id, path, user["username"]):
        raise HTTPException(status_code=409, detail="job_running")
    return {"state": "running"}
