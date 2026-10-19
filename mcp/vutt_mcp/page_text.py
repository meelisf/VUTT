"""Lehe teksti ettepanek (#641, ADR 0058 täiendus 2026-10-19).

Agent loeb lehe TOORTEKSTI (märgendus, reavahetused) koodiga ja esitab
asendused. VUTT talletab need AINULT ootel ettepanekuna; superadmin vaatab need
pildi kõrval üle. `get_pages` ei kõlba aluseks — see on otsinguks puhastatud tekst.
"""
from __future__ import annotations

import json
import re

from .errors import VuttError

_WORK_ID = re.compile(r"^[A-Za-z0-9_-]{4,40}$")
MAX_PAGES = 200
MAX_EDITS = 100
_TAGS_CACHE: list = []
# Need koodid tähendavad, et agendi nähtud tekst ei klapi enam — loe uuesti.
_REREAD = ("stale_page", "old_not_found", "old_ambiguous", "unknown_page")


def _check_work_id(work_id: str) -> None:
    if not isinstance(work_id, str) or not _WORK_ID.fullmatch(work_id):
        raise VuttError("Vigane work_id; kasuta search_works'i tulemuse work_id-d.")


def _tags(client) -> list:
    if not _TAGS_CACHE:
        _TAGS_CACHE.extend(client.api_get("/markup/tags"))
    return list(_TAGS_CACHE)


def page_source(client, handoff_code: str, work_id: str, page: int) -> str:
    _check_work_id(work_id)
    data = client.api_post("/works/text-proposals/source",
                           {"code": handoff_code, "work_id": work_id, "page": page})
    return json.dumps({**data, "tags": _tags(client)}, ensure_ascii=False, indent=1)


def _check_pages(pages) -> None:
    if not isinstance(pages, list) or not 1 <= len(pages) <= MAX_PAGES:
        raise VuttError(f"Ettepanekus peab olema 1–{MAX_PAGES} lehte.")
    for i, p in enumerate(pages):
        if not isinstance(p, dict) or not isinstance(p.get("stem"), str) \
                or not isinstance(p.get("text_hash"), str):
            raise VuttError(f"pages[{i}]: stem ja text_hash on kohustuslikud (get_page_source'ist).")
        edits = p.get("edits")
        if not isinstance(edits, list) or not 1 <= len(edits) <= MAX_EDITS:
            raise VuttError(f"pages[{i}]: edits peab olema 1–{MAX_EDITS} asendust.")
        for j, e in enumerate(edits):
            if not isinstance(e, dict) or not isinstance(e.get("old"), str) or not e["old"] \
                    or not isinstance(e.get("new"), str):
                raise VuttError(f"pages[{i}].edits[{j}]: vaja on {{old, new}} stringe, old ei tohi olla tühi.")


def submit(client, handoff_code: str, work_id: str, pages: list, note: str) -> str:
    _check_work_id(work_id)
    _check_pages(pages)
    body = {"code": handoff_code, "work_id": work_id, "pages": pages, "note": note or ""}
    try:
        result = client.api_post_once("/works/text-proposals/submit", body)
    except VuttError as exc:
        if any(k in str(exc) for k in _REREAD):
            raise VuttError(f"{exc} — loe leht uuesti get_page_source'iga ja koosta "
                            "asendused uue teksti põhjal (vajadusel pikem old).") from exc
        raise
    sup = result.get("superseded") or []
    extra = f"; asendas {len(sup)} varasemat ootel lehte" if sup else ""
    return (f"Ettepanek talletatud teose {work_id} jaoks: {result.get('pages')} lehte{extra}, "
            f"proposal_id={result.get('proposal_id')}. Superadmin vaatab need Workspace'is pildi "
            "kõrval üle; lehti ei muudetud.")
