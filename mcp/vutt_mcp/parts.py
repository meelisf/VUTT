"""Teose osad (#464) ja agendi osade ettepanek (#492 samm 2).

Agent loeb olemasolevad osad ja lehtede järjekorra versiooni, tunneb lehtedelt ära
kirjade/istungite piirid ning esitab ettepaneku. VUTT talletab selle AINULT ootel
ettepanekuna; toimetaja otsustab teose halduse „Osad" vahekaardil osa kaupa.
"""
from __future__ import annotations

import json
import re
from urllib.parse import quote

from .errors import VuttError, VuttNotFound

_WORK_ID = re.compile(r"^[A-Za-z0-9_-]{4,40}$")
MAX_PARTS = 50


def _check_work_id(work_id: str) -> None:
    if not isinstance(work_id, str) or not _WORK_ID.fullmatch(work_id):
        raise VuttError("Vigane work_id; kasuta search_works'i tulemuse work_id-d.")


def work_parts(client, work_id: str) -> str:
    """Olemasolevad osad leheküljenumbritega + lehtede arv ja `pages_version`."""
    _check_work_id(work_id)
    try:
        data = client.api_get(f"/works/{quote(work_id, safe='')}/parts")
    except VuttNotFound as exc:
        raise VuttNotFound(f"Teost work_id={work_id} ei leitud või pole avalik.") from exc
    if not isinstance(data, dict) or "pages_version" not in data:
        raise VuttError("VUTT ei tagastanud teose osi.")
    numbers = data.get("page_numbers") or {}
    parts = []
    for p in data.get("parts") or []:
        parts.append({
            "id": p.get("id"), "kind": p.get("kind"), "title": p.get("title"),
            "incipit": p.get("incipit"), "abstract_et": p.get("abstract_et"),
            "abstract_en": p.get("abstract_en"), "notes": p.get("notes"), "languages": p.get("languages"),
            "pages": sorted(numbers[s] for s in p.get("pages") or [] if s in numbers),
            "creators": p.get("creators") or [], "dating": p.get("dating"),
            "place": p.get("place"), "place_to": p.get("place_to"),
            "attached_to": p.get("attached_to"),
        })
    return json.dumps({"work_id": work_id, "page_count": data.get("page_count"),
                       "pages_version": data["pages_version"], "parts": parts},
                      ensure_ascii=False, indent=1)


def submit_parts(client, handoff_code: str, work_id: str, pages_version: str, parts: list,
                 persons: list | None = None) -> str:
    _check_work_id(work_id)
    if not isinstance(parts, list) or not 1 <= len(parts) <= MAX_PARTS:
        raise VuttError(f"Ettepanekus peab olema 1–{MAX_PARTS} osa.")
    if persons is not None and (not isinstance(persons, list) or len(persons) > MAX_PARTS):
        raise VuttError(f"Uusi isikuid võib olla kuni {MAX_PARTS}.")
    body = {"code": handoff_code, "work_id": work_id, "pages_version": pages_version, "parts": parts}
    if persons:
        body["persons"] = persons
    result = client.api_post_once("/works/parts-proposals/submit", body)
    extra = f", {result.get('persons')} uut isikut" if result.get("persons") else ""
    return (f"Ettepanek talletatud teose {work_id} jaoks: {result.get('parts')} osa{extra}, "
            f"proposal_id={result.get('proposal_id')}. Toimetaja vaatab need üle teose halduse "
            "„Osad\" vahekaardil; teost ei muudetud.")
