"""Isikuettepaneku realiigid väljaspool ametit ja haridust (#834, ADR 0058 täiendus 2026-11-18).

Sünd, surm, päritolu, sugu ja elulugu. Iga liik: `validate` (esitusel), hiljem
olek ülevaatusel ja kaardile kandmine. Amet ja haridus jäävad `enrichment_proposals`-i.
"""
import re

SCALAR_KINDS = ("birth", "death", "origin", "gender")
NEW_KINDS = SCALAR_KINDS + ("biography",)

MAX_BIOGRAPHY_CHARS = 40_000
MAX_SOURCES_ADD = 10

_KEYS = {
    "birth": ({"kind", "date", "evidence"}, {"kind", "date", "evidence"}),
    "death": ({"kind", "date", "evidence"}, {"kind", "date", "place_key", "evidence"}),
    "origin": ({"kind", "place_key", "evidence"}, {"kind", "place_key", "evidence"}),
    "gender": ({"kind", "value", "evidence"}, {"kind", "value", "evidence"}),
    "biography": ({"kind", "lang", "text", "base_hash"}, {"kind", "lang", "text", "base_hash", "sources_add"}),
}
_SOURCE_ADD_KEYS = ({"work_id", "part_id", "page", "printed_page", "note"}, {"text", "note"})

# VUTT-i lehe link eluloos: absoluutne või suhteline /work/<id>/<lk> (Markdown-lingi sihtmärk)
_VUTT_LINK = re.compile(r"\]\((?:https://vutt\.utlib\.ut\.ee)?/work/([A-Za-z0-9_-]+)/(\d+)\)")
_HTML = re.compile(r"<[A-Za-z/!]")
_HASH = re.compile(r"[0-9a-f]{12}")


def _error(message: str):
    from .enrichment_proposals import ProposalError
    return ProposalError(message)


def biography_links(text: str) -> list[dict]:
    """Eluloo VUTT-i lingid tõendi kujul — server kontrollib teose ja lehe olemasolu."""
    return [{"source_kind": "vutt_page", "work_id": m.group(1), "page": int(m.group(2))}
            for m in _VUTT_LINK.finditer(text or "")]


def _check_keys(item: dict) -> None:
    required, allowed = _KEYS[item["kind"]]
    unknown = sorted(set(item) - allowed)
    missing = sorted(required - set(item))
    if unknown or missing:
        raise _error(f"invalid_item: kind={item['kind']} võtmed {sorted(allowed)} "
                     f"(kohustuslik {sorted(required)}); tundmatud {unknown}, puudu {missing}")


def _check_place(key) -> None:
    from . import registries
    if not isinstance(key, str) or key not in registries._places():
        raise _error(f"unknown_place_key: {key!r} puudub koharegistrist — uut kohta ettepanek ei "
                     "loo; ütle kasutajale, et koht on vaja registrisse lisada")


def _check_sources_add(sources) -> None:
    from .enrichment_proposals import _short_string
    if not isinstance(sources, list):
        raise _error("invalid_sources_add: sources_add peab olema list")
    if len(sources) > MAX_SOURCES_ADD:
        raise _error(f"too_many_sources: sources_add kuni {MAX_SOURCES_ADD} kirjet")
    for source in sources:
        if not isinstance(source, dict):
            raise _error("invalid_sources_add: kirje peab olema objekt")
        if "source_kind" in source:
            # MCP asendab kirjanduskogu viite loetava `text`-iga enne saatmist
            raise _error("literature_not_resolved: sources_add kirjanduskogu viide jõudis "
                         "lahendamata — uuenda MCP-d")
        if not any(set(source) <= keys and (source.get("work_id") or source.get("text"))
                   for keys in _SOURCE_ADD_KEYS):
            raise _error("invalid_sources_add: kirje on {work_id, part_id?, page?, printed_page?, "
                         "note?} või {text, note?}")
        for key, value in source.items():
            if key == "page":
                if not isinstance(value, int) or isinstance(value, bool) or value < 1:
                    raise _error("invalid_sources_add: page peab olema täisarv ≥ 1")
            elif value is not None and not _short_string(value, 1000):
                raise _error(f"invalid_sources_add: {key} peab olema string (≤1000 märki)")


def _validate_biography(item: dict) -> None:
    from .enrichment_proposals import _KIRILLITSA
    if item["lang"] not in ("et", "en"):
        raise _error("invalid_lang: lang on 'et' või 'en' (keel on väljanimes, ADR 0039)")
    text = item["text"]
    if not isinstance(text, str) or not text.strip():
        raise _error("invalid_biography: text peab olema mittetühi string")
    if len(text) > MAX_BIOGRAPHY_CHARS:
        raise _error(f"biography_too_long: elulugu kuni {MAX_BIOGRAPHY_CHARS} märki")
    if not isinstance(item["base_hash"], str) or not _HASH.fullmatch(item["base_hash"]):
        raise _error("invalid_base_hash: base_hash = get_person_enrichment_context'i "
                     "biography_<lang>_hash (12 hex-märki)")
    if _HTML.search(text):
        raise _error("html_not_allowed: elulugu on Markdown, toores HTML ei ole lubatud (ADR 0008)")
    if _KIRILLITSA.search(text):
        raise _error("cyrillic_not_allowed: elulugu on vene keeles. Venekeelne allikas on VUTT-is "
                     "ainult viide (lühiviide tekstis + sources_add), mitte tekst ega tsitaat")
    # Viide = VUTT-i link või lühiviide sulgudes, mille täiskirje on „Allikates"
    if not biography_links(text) and not re.search(r"\(([^()]*\d[^()]*)\)", text):
        raise _error("citation_required: elulugu vajab tekstisiseseid viiteid — VUTT-i lehe link "
                     "([VUTT, *pealkiri*, lk](…/work/<id>/<lk>)) või lühiviide (Autor aasta: lk)")
    if "sources_add" in item:
        _check_sources_add(item["sources_add"])


def validate(item: dict) -> None:
    """Esituse kujukontroll; korpuse lehed kontrollib `submit` (`_check_vutt_pages`)."""
    from .enrichment_proposals import _check_no_cyrillic, _validate_date, _validate_evidence
    _check_keys(item)
    kind = item["kind"]
    if kind == "biography":
        _validate_biography(item)
        return
    if kind in ("birth", "death"):
        _validate_date("date", item["date"])
    if kind == "origin" or (kind == "death" and "place_key" in item):
        _check_place(item["place_key"])
    if kind == "gender" and item["value"] not in ("M", "F"):
        raise _error("invalid_gender: value on 'M' või 'F'")
    _validate_evidence(item["evidence"])
    _check_no_cyrillic(item)


# ── Olek ülevaatusel ja kaardile kandmine ────────────────────────────────
#
# `patch` = sama ettepaneku eelmiste ridade poolt muudetud kaardiväljad (koopia).
# Read hinnatakse järjest, nagu amet ja haridus `_merge_row`-is.

_PRECISION_BY_LENGTH = {4: "year", 7: "month", 10: "day"}
_DATE_FIELDS = ("date", "precision", "bound", "calendar", "is_circa")


def _current(person: dict, patch: dict, field: str):
    return patch[field] if field in patch else person.get(field)


def _precision(date: dict) -> str | None:
    return date.get("precision") or _PRECISION_BY_LENGTH.get(len(date.get("date") or ""))


def _merge_evidence(old: list, new: list) -> list:
    return list(old) + [source for source in new if source not in old]


def _registry_place(key: str) -> dict:
    """Koharegistri kirje kuupäevaobjekti `place` kujul (nagu vormi kohaotsing)."""
    from . import registries
    entry = registries._places().get(key)
    if not isinstance(entry, dict):
        raise _error("unknown_place_key")
    labels = entry.get("labels") if isinstance(entry.get("labels"), dict) else None
    label = (labels or {}).get("et") or (labels or {}).get("en") or entry.get("label") or key
    return {"id": entry.get("id"), "label": label, "labels": labels}


def _same_place(a: dict | None, b: dict | None) -> bool:
    if not a or not b:
        return False
    if a.get("id") and b.get("id"):
        return a["id"] == b["id"]
    return (a.get("label") or "").strip().lower() == (b.get("label") or "").strip().lower()


def _apply_date(item: dict, person: dict, patch: dict) -> tuple[str, object]:
    field = item["kind"]
    current = dict(_current(person, patch, field) or {})
    proposed = item["date"]
    place = _registry_place(item["place_key"]) if item.get("place_key") else None
    snapshot = {k: current.get(k) for k in (*_DATE_FIELDS, "place")}
    same_date = (current.get("date") == proposed["date"]
                 and _precision(current) == _precision(proposed))
    if current.get("date") and same_date and (not place or not current.get("place")
                                               or _same_place(current["place"], place)):
        # Juba kaardil: tõend lisandub, täpsustused ainult tühja kohta
        for key in ("bound", "calendar", "is_circa"):
            if not current.get(key) and proposed.get(key):
                current[key] = proposed[key]
        if place and not current.get("place"):
            current["place"] = place
        current["evidence"] = _merge_evidence(current.get("evidence") or [], item["evidence"])
        patch[field] = current
        return "already_present", None
    state = "conflict" if current.get("date") or (place and current.get("place")) else "applicable"
    current.update({"date": proposed["date"], "precision": _precision(proposed),
                    "bound": proposed.get("bound"), "calendar": proposed.get("calendar"),
                    "is_circa": bool(proposed.get("is_circa")),
                    # Vana tõend käis vana väärtuse kohta
                    "evidence": list(item["evidence"])})
    if place:
        current["place"] = place
    patch[field] = current
    return state, snapshot if state == "conflict" else None


def _apply_origin(item: dict, person: dict, patch: dict) -> tuple[str, object]:
    _registry_place(item["place_key"])  # registris olemas
    current = dict(_current(person, patch, "origin") or {})
    if current.get("place") == item["place_key"]:
        current["evidence"] = _merge_evidence(current.get("evidence") or [], item["evidence"])
        patch["origin"] = current
        return "already_present", None
    state = "conflict" if current.get("place") else "applicable"
    previous = current.get("place")
    # ADR 0084: kanooniline koht on origin.place; birth.place-i ei puudutata.
    # place_id/place_labels täidab salvestusel `_enrich_origin_from_places`.
    current.update({"place": item["place_key"], "place_id": None, "place_labels": None,
                    "evidence": list(item["evidence"])})
    patch["origin"] = current
    return state, previous if state == "conflict" else None


def _apply_gender(item: dict, person: dict, patch: dict) -> tuple[str, object]:
    current = _current(person, patch, "gender")
    if current == item["value"]:
        return "already_present", None
    patch["gender"] = item["value"]
    return ("conflict", current) if current else ("applicable", None)


def _same_source(a: dict, b: dict) -> bool:
    if a.get("work_id") or b.get("work_id"):
        return (a.get("work_id"), a.get("page")) == (b.get("work_id"), b.get("page"))
    return (a.get("text") or "").strip() == (b.get("text") or "").strip()


def _apply_biography(item: dict, person: dict, patch: dict) -> tuple[str, object]:
    from ..prosopo_biography_fields import text_hash
    field = f"biography_{item['lang']}"
    current = _current(person, patch, field) or ""
    if text_hash(current) != item["base_hash"]:
        raise _error("stale_biography")
    patch[field] = item["text"]
    sources = list(_current(person, patch, "sources") or [])
    for source in item.get("sources_add") or []:
        if not any(isinstance(s, dict) and _same_source(s, source) for s in sources):
            sources.append(dict(source))
    patch["sources"] = sources
    return ("replace", current) if current.strip() else ("applicable", None)


_APPLY = {"birth": _apply_date, "death": _apply_date, "origin": _apply_origin,
          "gender": _apply_gender, "biography": _apply_biography}


def apply(item: dict, person: dict, patch: dict) -> str:
    """Kannab rea `patch`-i; tagastab oleku. Blokeeritud rida viskab ProposalError."""
    return _APPLY[item["kind"]](item, person, patch)[0]


def review_state(item: dict, person: dict, patch: dict) -> dict:
    """Serveri otsus paneelile; `current` = praegune väärtus konflikti/asenduse kuvamiseks."""
    from .enrichment_proposals import ProposalError
    try:
        state, current = _APPLY[item["kind"]](item, person, patch)
    except ProposalError as error:
        return {"state": "blocked", "reason": str(error)}
    result = {"state": state}
    if current is not None:
        result["current"] = current
    return result
