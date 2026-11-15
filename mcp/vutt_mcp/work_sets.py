"""Töökollektsioonid: liikmete loend ja kogude vormindus.

Liikmesus EI OLE Meilis (ADR 0042): server annab `/mcp/work-sets/{id}/works`
kaudu otsingus nähtavad `work_id`-d ja otsing filtreerib `work_id IN [...]`
teiste filtrite KÕRVAL. Tühi loend tähendab null tulemust, mitte filtri
ärajätmist — selle eest vastutab kutsuja (`server.py`).
"""
from urllib.parse import quote

from .errors import VuttError, VuttNotFound


def member_ids(client, work_set: str) -> list[str]:
    """Kogu liikmed; tundmatu id → juhis, kust õige leida."""
    try:
        data = client.mcp_get(f"/mcp/work-sets/{quote(work_set, safe='')}/works")
    except VuttNotFound:
        raise VuttError(
            f"Tundmatu töökollektsioon „{work_set}\". Õige id saad list_work_sets'ist."
        ) from None
    return [str(w) for w in (data.get("work_ids") or [])]


def empty_set_message(work_set: str) -> str:
    return (
        f"Töökollektsioonis {work_set} on 0 otsingus nähtavat teost — "
        f"otsingut ei tehtud. Kontrolli id-d list_work_sets'iga."
    )


def _name(ws: dict) -> str:
    name = ws.get("name") or {}
    if isinstance(name, dict):
        return name.get("et") or name.get("en") or "(nimetu)"
    return str(name) or "(nimetu)"


def format_work_sets(data: dict) -> str:
    sets = data.get("work_sets") or []
    if not sets:
        return "Töökollektsioone ei ole."
    # Aktiivsed enne arhiveerituid: tavaliselt küsitakse käimasolevat tööd.
    sets = sorted(sets, key=lambda ws: ws.get("status") == "archived")
    lines = [f"Töökollektsioone: {len(sets)}. Piira otsingut: work_set=<id>."]
    for ws in sets:
        märked = [f"{ws.get('count', 0)} teost"]
        if ws.get("status") == "archived":
            märked.append("arhiveeritud")
        if ws.get("visibility") == "public":
            märked.append("avalik")
        line = f"- {ws['id']}: {_name(ws)} ({', '.join(märked)})"
        desc = ws.get("description")
        if isinstance(desc, dict):
            desc = desc.get("et") or desc.get("en")
        if desc:
            line += f"\n  {str(desc).strip()[:300]}"
        lines.append(line)
    return "\n".join(lines)
