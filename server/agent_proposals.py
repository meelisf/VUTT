# server/agent_proposals.py
"""Ühtne agendikood ja ootel ettepanekute loend (ADR 0058 täiendus 2026-10-20).

Kolm hoidlat (lehe tekst, teose osad, isikukaart) jäävad eraldi SQLite-failideks.
Üks kood registreeritakse kõigis kolmes sama räsiga; kui mõni registreerimine
ebaõnnestub, tühistatakse kood juba õnnestunud hoidlatest — osaliselt kehtivat
koodi kasutajale ei näidata (ühist tehingut kolm faili ei anna).

Loendi `target_url` koostab server: klient ei tuleta sihtlehte ise.
"""
import logging
import secrets
from typing import Optional

from . import page_text_proposals as ptp
from . import work_part_proposals as wpp
from . import work_parts as wp
from .prosopography import enrichment_proposals as ep
from .prosopography.person_crud import get_person
from .utils import find_directory_by_id
from .work_sets_access import load_work_metadata_by_id

logger = logging.getLogger(__name__)


class AgentHandoffError(RuntimeError):
    pass


def issue_agent_handoff(username: str, session_fingerprint: str) -> dict:
    """Kood kõigile kolmele hoidlale, ulatus „kõik teosed + kõik isikud"."""
    code = secrets.token_urlsafe(32)
    steps = (
        (ptp, lambda: ptp.issue_handoff(None, username, code=code)),
        (wpp, lambda: wpp.issue_handoff(username, code=code)),
        (ep, lambda: ep.issue_handoff(None, username, session_fingerprint, code=code)),
    )
    done, results = [], []
    for store, issue in steps:
        try:
            results.append(issue())
        except Exception as e:
            logger.exception("Agendikoodi registreerimine ebaõnnestus (%s)", store.__name__)
            for registered in done:
                try:
                    registered.revoke_code(code)
                except Exception:
                    logger.exception("Agendikoodi tühistus ebaõnnestus (%s)", registered.__name__)
            raise AgentHandoffError("agent_handoff_failed") from e
        done.append(store)
    text, parts, persons = results
    return {"code": code, "expires_at": min(r["expires_at"] for r in results),
            "max_uses": {"text": text["max_uses"], "parts": parts["max_uses"],
                         "persons": persons["max_uses"]}}


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
    näevad kõik superadminid, osi ja isikuid ainult koodi loonud kasutaja."""
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
