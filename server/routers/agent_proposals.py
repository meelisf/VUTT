# server/routers/agent_proposals.py
"""Ühtne agendikood ja ootel ettepanekute loend `/review`-l (ADR 0058 täiendus 2026-10-20).

Mõlemad otspunktid on superadminile (ADR 0058, 2026-09-29). Loogika elab
`server/agent_proposals.py`-s; siin on ainult HTTP-kiht.
"""
from fastapi import APIRouter, Depends, HTTPException, Request

from .. import agent_proposals as ap
from ..deps import require_role
from ..rate_limit import check_rate_limit

router = APIRouter()


@router.post("/agent-handoff")
def agent_handoff(request: Request, user=Depends(require_role("superadmin"))):
    """ÜKS agendikood (8 h, mitu esitust): lehe tekst, teose osad ja isikukaardid."""
    allowed, retry = check_rate_limit(user["username"], "/agent-handoff")
    if not allowed:
        raise HTTPException(status_code=429, detail="Liiga palju koode",
                            headers={"Retry-After": str(retry)})
    try:
        return ap.issue_agent_handoff(user["username"], request.state.session_fingerprint)
    except ap.AgentHandoffError as e:
        raise HTTPException(status_code=503, detail=str(e))


@router.get("/agent-proposals")
def agent_proposals(user=Depends(require_role("superadmin"))):
    return ap.list_agent_proposals(user["username"])
