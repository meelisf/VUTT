"""Ametite ja asutuste registri lugemine agendi kandidaatotsinguks.

Otsing ei kinnita vastet. Eriti nimevariant võib viidata mitmele kirjele.
"""
import json
import os
import re
import unicodedata

from ..config import DATA_CONFIG_DIR

MAX_QUERY_LENGTH = 120
MAX_RESULTS = 20
_FILES = {"occupation": "occupations.json", "institution": "institutions.json"}


class RegistrySearchError(ValueError):
    pass


def _norm(value: str) -> str:
    return re.sub(r"\s+", " ", unicodedata.normalize("NFKC", value).casefold()).strip()


def _fold(value: str) -> str:
    return "".join(char for char in unicodedata.normalize("NFKD", _norm(value))
                   if not unicodedata.combining(char))


def _load(kind: str) -> dict | None:
    path = os.path.join(DATA_CONFIG_DIR, _FILES[kind])
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
    except FileNotFoundError:
        return None
    except (OSError, ValueError) as error:
        raise RegistrySearchError("registry_unreadable") from error
    if not isinstance(data, dict):
        raise RegistrySearchError("registry_invalid")
    return data


def search(kind: str, query: str, limit: int = 10) -> dict:
    if kind not in _FILES:
        raise RegistrySearchError("invalid_kind")
    if not isinstance(query, str) or not query.strip() or len(query) > MAX_QUERY_LENGTH:
        raise RegistrySearchError("invalid_query")
    if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= MAX_RESULTS:
        raise RegistrySearchError("invalid_limit")

    entries = _load(kind)
    if entries is None:
        return {"kind": kind, "query": query, "registry_available": False,
                "results": [], "total_matches": 0, "truncated": False, "ambiguous": False}

    needle = _norm(query)
    folded = _fold(query)
    candidates = []
    for key, entry in entries.items():
        if not isinstance(key, str) or not isinstance(entry, dict):
            continue
        qid = entry.get("id")
        labels = entry.get("labels") if isinstance(entry.get("labels"), dict) else {}
        variants = entry.get("variants") if isinstance(entry.get("variants"), list) else []
        names = [("label", value) for value in labels.values() if isinstance(value, str)]
        names += [("variant", value) for value in variants if isinstance(value, str)]
        ranked = []
        if needle == _norm(key):
            ranked.append((0, "key", key))
        if isinstance(qid, str) and needle == _norm(qid):
            ranked.append((0, "qid", qid))
        for source, value in names:
            normalized = _norm(value)
            if needle == normalized:
                ranked.append((1 if source == "variant" else 2, source, value))
            elif folded == _fold(value):
                ranked.append((3, "accent_variant", value))
            elif len(needle) >= 3 and needle in normalized:
                ranked.append((4, "partial", value))
        if not ranked:
            continue
        rank, match_kind, matched_text = min(ranked, key=lambda result: result[0])
        matched_variant = next((value for value in variants if isinstance(value, str)
                                and needle == _norm(value)), None)
        candidate = {"key": key, "id": qid if isinstance(qid, str) else None,
                     "labels": labels, "match_kind": match_kind,
                     "matched_text": matched_text, "matched_variant": matched_variant}
        if kind == "institution":
            candidate["type"] = entry.get("type")
            candidate["place_key"] = entry.get("place_key")
        candidates.append((rank, key, candidate))

    candidates.sort(key=lambda row: (row[0], row[1]))
    return {"kind": kind, "query": query, "registry_available": True,
            "results": [candidate for _, _, candidate in candidates[:limit]],
            "total_matches": len(candidates), "truncated": len(candidates) > limit,
            "ambiguous": len(candidates) > 1}
