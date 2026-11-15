"""MCP-serveri read-only teed (töökollektsioonid).

MCP-l ei ole sessiooni: ta käib VUTT-i vastu Meili otsinguvõtmega. See võti näeb
Meilis niikuinii KÕIKI teoseid (ka piiratud kogudes) ja antakse ainult adminile
(`mcp/README.md`). Seepärast on võtme esitaja siin admini õigustes — kogude
piiramine võtme taga ei lisaks turvalisust, kuni võti ise ei ole kasutajapõhine.

Õigusloogikat siin EI kirjutata: kasutatakse samu predikaate mis
`routers/work_sets.py`-s, sünteetilise admini-kasutajaga. Vastus ei kanna
`access`-i ega auditivälju (kasutajanimed).

`server/cache.py` on siin keelatud (ADR 0042): ID-loend sõltub kutsujast.
`Authorization` päist EI kasutata — see on sessioonitokeni koht (`deps.py`).
"""
import hmac

from fastapi import APIRouter, Depends, HTTPException, Request

from .. import config
from ..work_sets_access import search_visible_work_ids
from ..work_sets_ops import list_work_sets, load_work_set

router = APIRouter()

KEY_HEADER = "X-Vutt-Search-Key"
MCP_USER = {"username": "mcp", "role": "admin"}


def require_search_key(request: Request) -> dict:
    """Võti loetakse kutse ajal, mitte mooduli laadimisel (testid ja env-muutus)."""
    server_key = config.MEILI_SEARCH_KEY or ""
    if not server_key:
        raise HTTPException(status_code=503, detail="Otsinguvõti ei ole serveris seadistatud")
    given = request.headers.get(KEY_HEADER, "")
    if not given or not hmac.compare_digest(given.encode(), server_key.encode()):
        raise HTTPException(status_code=401, detail="Vale või puuduv otsinguvõti")
    return dict(MCP_USER)


@router.get("/mcp/work-sets")
def mcp_list_work_sets(user=Depends(require_search_key)):
    out = []
    for ws in list_work_sets():
        out.append({
            "id": ws["id"],
            "name": ws.get("name"),
            "description": ws.get("description"),
            "status": ws.get("status", "active"),
            "visibility": ws.get("visibility"),
            "count": len(search_visible_work_ids(ws, user)),
        })
    return {"status": "success", "work_sets": out}


@router.get("/mcp/work-sets/{set_id}/works")
def mcp_work_set_works(set_id: str, user=Depends(require_search_key)):
    ws = load_work_set(set_id)
    if ws is None:
        raise HTTPException(status_code=404, detail="Töökollektsiooni ei leitud")
    ids = search_visible_work_ids(ws, user)
    return {"status": "success", "work_ids": ids, "count": len(ids)}
