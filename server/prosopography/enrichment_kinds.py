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
