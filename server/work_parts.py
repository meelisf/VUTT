# server/work_parts.py
"""Teose osad (#464, ADR 0057): kirjad, luuletused, kõned, istungid ja lisad.

Osa on teose sees olev iseseisev üksus. Lehed on lehefailide tüvede HULK (võib olla
katkendlik; leht võib kuuluda mitmesse osasse). Salvestus: `_metadata.json` väli
`parts`, muudetakse AINULT selle mooduli toimingutega (mitte üldise metaandmete
salvestusega), et samaaegsed toimetajad ei kirjutaks teineteise osi üle.
"""
from __future__ import annotations

from typing import Optional

from .config import get_logger
from .utils import generate_nanoid
from .work_dating import clean_dating

logger = get_logger(__name__)

KINDS = frozenset({"letter", "poem", "speech", "session", "attachment"})
ROLES = frozenset({"auctor", "addressee", "praeses", "participant", "subject"})
_TEXT_FIELDS = ("title", "incipit", "notes")


class PartError(ValueError):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _place(value) -> Optional[dict]:
    if value in (None, ""):
        return None
    if not isinstance(value, dict) or not (value.get("id") or value.get("label")):
        raise PartError("Vigane koht")
    return {"id": value.get("id") or None, "label": (value.get("label") or "").strip()}


def _creators(value) -> list:
    out = []
    for c in value or []:
        if not isinstance(c, dict) or c.get("role") not in ROLES:
            raise PartError(f"Lubamatu roll: {c.get('role') if isinstance(c, dict) else c!r}")
        if not (c.get("id") or c.get("name")):
            raise PartError("Isikul peab olema id või nimi")
        out.append({k: c[k] for k in ("id", "name", "role", "source") if c.get(k) not in (None, "")})
    return out


def _normalize(p: dict, page_stems: set[str]) -> dict:
    if not isinstance(p, dict):
        raise PartError("Osa peab olema objekt")
    kind = p.get("kind")
    if kind not in KINDS:
        raise PartError(f"Tundmatu liik: {kind!r}")
    pages = p.get("pages") or []
    if not isinstance(pages, list) or any(not isinstance(s, str) for s in pages):
        raise PartError("Vigane lehtede loend")
    missing = [s for s in pages if s not in page_stems]
    if missing:
        raise PartError(f"Lehti pole teoses: {', '.join(missing[:5])}")
    needs_review = bool(p.get("needs_review"))
    if not pages and not needs_review:
        raise PartError("Osal peab olema vähemalt üks leht")
    place_to = _place(p.get("place_to"))
    if place_to and kind != "letter":
        raise PartError("Sihtkoht on lubatud ainult kirjal")
    try:
        dating = clean_dating(p.get("dating")) if p.get("dating") else None
    except ValueError as e:
        raise PartError(f"Vigane dateering: {e}")
    out = {
        "id": p.get("id"),
        "kind": kind,
        "pages": list(dict.fromkeys(pages)),
        "creators": _creators(p.get("creators")),
        "attached_to": p.get("attached_to") or None,
        "needs_review": needs_review,
    }
    for f in _TEXT_FIELDS:
        v = p.get(f)
        if isinstance(v, str) and v.strip():
            out[f] = v.strip()
    if dating:
        out["dating"] = dating
    if _place(p.get("place")):
        out["place"] = _place(p.get("place"))
    if place_to:
        out["place_to"] = place_to
    langs = p.get("languages")
    if isinstance(langs, list) and langs:
        out["languages"] = [l for l in langs if isinstance(l, str)]
    return out


def validate_parts(parts: list, page_stems: set[str]) -> list[dict]:
    out = [_normalize(p, page_stems) for p in parts or []]
    ids = [p["id"] for p in out]
    if any(not i for i in ids) or len(ids) != len(set(ids)):
        raise PartError("Osa id puudub või kordub")
    by_id = {p["id"]: p for p in out}
    for p in out:
        a = p["attached_to"]
        if a is None:
            continue
        if p["kind"] != "attachment":
            raise PartError("attached_to on lubatud ainult lisal")
        if a == p["id"] or a not in by_id or by_id[a]["kind"] == "attachment":
            raise PartError("Lisa peab viitama olemasolevale osale, mis ise ei ole lisa")
    return out


def new_part(data: dict, existing_ids: set[str]) -> dict:
    """Uus osa: server annab id; kliendi id ja needs_review ignoreeritakse."""
    pid = generate_nanoid(6)
    while pid in existing_ids:
        pid = generate_nanoid(6)
    return {**{k: v for k, v in (data or {}).items() if k not in ("id", "needs_review")},
            "id": pid, "needs_review": False}
