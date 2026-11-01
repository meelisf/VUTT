# server/agent_proposals.py
"""Ühtne agendikood ja ootel ettepanekute loend (ADR 0058 täiendused 2026-10-20, 2026-10-29).

Kood elab ühes hoidlas (`agent_handoff`), üks rida liigi kohta; ettepanekud jäävad
liigiti eraldi SQLite-failidesse.

Loendi `target_url` koostab server: klient ei tuleta sihtlehte ise.
"""
import logging
from typing import Optional

from . import agent_handoff
from . import page_text_proposals as ptp
from . import work_part_proposals as wpp
from . import exemplar_proposals as epp
from . import work_parts as wp
from .prosopography import enrichment_proposals as ep
from .prosopography.person_crud import get_person
from .utils import find_directory_by_id
from .work_sets_access import load_work_metadata_by_id

logger = logging.getLogger(__name__)


class AgentHandoffError(RuntimeError):
    pass


def issue_agent_handoff(username: str, session_fingerprint: str) -> dict:
    """Kood kõigile liikidele, ulatus „kõik teosed + kõik isikud"; üks tehing."""
    limits = {"text": ptp.MAX_USES, "parts": wpp.MAX_USES, "person": ep.ANY_MAX_USES,
              "exemplars": epp.MAX_USES}
    try:
        out = agent_handoff.issue(username, session_fingerprint,
                                  {kind: (None, n) for kind, n in limits.items()})
    except Exception as e:
        logger.exception("Agendikoodi registreerimine ebaõnnestus")
        raise AgentHandoffError("agent_handoff_failed") from e
    return {**out, "max_uses": {"text": limits["text"], "parts": limits["parts"],
                                "persons": limits["person"], "exemplars": limits["exemplars"]}}


def _work_title(meta: Optional[dict], work_id: str) -> str:
    title = (meta or {}).get("title")
    return title if isinstance(title, str) and title.strip() else work_id


def _person_label(person: Optional[dict], person_id: str) -> str:
    if not person or person.get("record_status") == "tombstone" or person.get("merged_into"):
        return person_id
    label = (person.get("name") or {}).get("label")
    return label if isinstance(label, str) and label.strip() else person_id


class _Works:
    """Teose kaust, lehed ja pealkiri — üks lugemine teose kohta."""

    def __init__(self):
        self._cache: dict = {}

    def get(self, work_id: str) -> dict:
        if work_id not in self._cache:
            work_dir = find_directory_by_id(work_id)
            stems = wp.page_stems(work_dir) if work_dir else []
            self._cache[work_id] = {
                "dir": work_dir,
                "number": {s: i for i, s in enumerate(stems, start=1)},
                "version": wpp.pages_version(work_dir) if work_dir else None,
                "label": _work_title(load_work_metadata_by_id(work_id) if work_dir else None, work_id),
            }
        return self._cache[work_id]


def _text_page(pack: dict, number: dict) -> int:
    """Paki esimene ülevaatust vajav leht, mis on teoses alles — praeguse numbriga."""
    for page in pack["pages"]:
        if page["state"] in ptp.REVIEW_STATES and page["stem"] in number:
            return number[page["stem"]]
    return 1


def list_agent_proposals(username: str) -> list[dict]:
    """Kõik ootel ettepanekud ühes loendis. Nähtavus järgib sihtvaadet: tekstipakke
    näevad kõik superadminid, osi, eksemplare ja isikuid ainult koodi loonud kasutaja."""
    works = _Works()
    rows = []
    for pack in ptp.list_pending():
        w = works.get(pack["work_id"])
        rows.append({
            "kind": "text", "proposal_id": pack["proposal_id"], "target_id": pack["work_id"],
            "target_label": w["label"],
            "target_url": f"/work/{pack['work_id']}/{_text_page(pack, w['number'])}"
                          f"?proposal={pack['proposal_id']}",
            "pending": pack["counts"]["pending"], "stale": pack["counts"]["stale"],
            "created_at": pack["created_at"],
        })
    for p in wpp.list_pending_summary(username):
        w = works.get(p["work_id"])
        changed = w["version"] is not None and p["pages_version"] != w["version"]
        rows.append({
            "kind": "parts", "proposal_id": p["proposal_id"], "target_id": p["work_id"],
            "target_label": w["label"], "target_url": f"/work/{p['work_id']}/manage?tab=parts",
            "pending": p["pending"], "stale": p["pending"] if changed else 0,
            "created_at": p["created_at"],
        })
    for p in epp.list_pending_summary(username):
        w = works.get(p["work_id"])
        rows.append({
            "kind": "exemplars", "proposal_id": p["proposal_id"], "target_id": p["work_id"],
            "target_label": w["label"], "target_url": f"/work/{p['work_id']}/manage?tab=exemplars",
            "pending": p["pending"], "stale": p["stale"], "created_at": p["created_at"],
        })
    people: dict = {}
    for p in ep.list_pending_summary(username):
        pid = p["person_id"]
        if pid not in people:
            people[pid] = _person_label(get_person(pid), pid)
        rows.append({
            "kind": "person", "proposal_id": p["proposal_id"], "target_id": pid,
            "target_label": people[pid], "target_url": f"/persons/{pid}/edit?agent=1",
            "pending": p["pending"], "stale": None, "created_at": p["created_at"],
        })
    rows.sort(key=lambda r: r["created_at"], reverse=True)
    return rows
