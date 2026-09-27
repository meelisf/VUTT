"""Autoriteetsed ametite ja asutuste registrid (#462, #471).

Võti on VUTT-i püsiv identiteet; Q-kood on valikuline väline tunnus. Isiku
allikasõnastus elab isikukaardil ega muutu registrikirje muutmisel.
"""
from __future__ import annotations

import json
import os
import re
import threading

from ..config import DATA_CONFIG_DIR, PLACES_FILE
from ..git_ops import save_config_with_git

_FILES = {"occupation": "occupations.json", "institution": "institutions.json"}
_KEY = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_QID = re.compile(r"^Q[1-9][0-9]*$")
_LOCK = threading.RLock()
_MAX_ENTRIES = 5000


class RegistryError(ValueError):
    pass


def _path(kind: str) -> str:
    if kind not in _FILES:
        raise RegistryError("invalid_kind")
    return os.path.join(DATA_CONFIG_DIR, _FILES[kind])


def load(kind: str) -> dict:
    path = _path(kind)
    try:
        with open(path, encoding="utf-8") as handle:
            value = json.load(handle)
    except FileNotFoundError:
        return {}
    except (OSError, ValueError) as error:
        raise RegistryError("registry_unreadable") from error
    if not isinstance(value, dict):
        raise RegistryError("registry_invalid")
    return value


def _text(value, field: str, *, required: bool = False) -> str | None:
    if value is None and not required:
        return None
    if not isinstance(value, str) or len(value) > 300 or (required and not value.strip()):
        raise RegistryError(f"invalid_{field}")
    return value.strip() or None


def validate_entry(kind: str, key: str, data: dict, *, places: dict | None = None) -> dict:
    _path(kind)
    if not isinstance(key, str) or not _KEY.fullmatch(key) or len(key) > 100:
        raise RegistryError("invalid_key")
    if not isinstance(data, dict):
        raise RegistryError("invalid_entry")
    allowed = {"id", "labels", "variants", "notes"}
    if kind == "institution":
        allowed |= {"type", "place_key"}
    if set(data) - allowed:
        raise RegistryError("unknown_fields")
    qid = _text(data.get("id"), "id")
    if qid and not _QID.fullmatch(qid):
        raise RegistryError("invalid_id")
    labels = data.get("labels")
    if not isinstance(labels, dict) or not labels:
        raise RegistryError("invalid_labels")
    clean_labels = {}
    for lang, label in labels.items():
        if not isinstance(lang, str) or not re.fullmatch(r"[a-z]{2,3}", lang):
            raise RegistryError("invalid_language")
        clean_labels[lang] = _text(label, "label", required=True)
    variants = data.get("variants", [])
    if not isinstance(variants, list) or len(variants) > 100:
        raise RegistryError("invalid_variants")
    clean_variants = []
    seen = set()
    for variant in variants:
        value = _text(variant, "variant", required=True)
        folded = value.casefold()
        if folded not in seen:
            clean_variants.append(value)
            seen.add(folded)
    result = {"id": qid, "labels": clean_labels, "variants": clean_variants}
    notes = _text(data.get("notes"), "notes")
    if notes:
        result["notes"] = notes
    if kind == "institution":
        result["type"] = _text(data.get("type"), "type", required=True)
        place_key = _text(data.get("place_key"), "place_key")
        if place_key and places is not None and place_key not in places:
            raise RegistryError("unknown_place_key")
        result["place_key"] = place_key
    return result


def _places() -> dict:
    try:
        with open(PLACES_FILE, encoding="utf-8") as handle:
            data = json.load(handle)
    except FileNotFoundError:
        return {}
    if not isinstance(data, dict):
        raise RegistryError("places_invalid")
    return data


def put(kind: str, key: str, data: dict, username: str) -> dict:
    """Loe-muuda-commiti ühe luku all; mitme kirjutaja kirjed ei kao."""
    with _LOCK:
        entries = load(kind)
        clean = validate_entry(kind, key, data, places=_places() if kind == "institution" else None)
        if key not in entries and len(entries) >= _MAX_ENTRIES:
            raise RegistryError("registry_full")
        if clean["id"] and any(k != key and isinstance(v, dict) and v.get("id") == clean["id"]
                               for k, v in entries.items()):
            raise RegistryError("duplicate_id")
        entries[key] = clean
        save_config_with_git(_path(kind), entries, username, message=f"Register {kind}: uuenda {key}")
        return clean


def normalize_person_facts(data: dict) -> dict:
    """Püsivõti on tõde; ühilduvus-Q võetakse registrist, toorsilt säilib."""
    if not ("occupations" in data or "education" in data):
        return data
    occupations = load("occupation")
    institutions = load("institution")
    places = _places()
    out = dict(data)
    for section in ("occupations", "education"):
        if section not in data:
            continue
        if not isinstance(data[section], list):
            raise RegistryError(f"invalid_{section}")
        result = []
        for original in data[section]:
            if not isinstance(original, dict):
                raise RegistryError(f"invalid_{section}_entry")
            fact = dict(original)
            occupation_key = fact.get("occupation_key")
            institution_key = fact.get("institution_key")
            place_key = fact.get("place_key")
            for field, key in (("occupation_key", occupation_key),
                               ("institution_key", institution_key), ("place_key", place_key)):
                if key is not None and not isinstance(key, str):
                    raise RegistryError(f"invalid_{field}")
            if section == "education" and (occupation_key or place_key):
                raise RegistryError("invalid_education_links")
            if institution_key and place_key:
                raise RegistryError("institution_and_place_are_exclusive")
            if occupation_key:
                entry = occupations.get(occupation_key)
                if not isinstance(entry, dict):
                    raise RegistryError("unknown_occupation_key")
                if entry.get("id"):
                    fact["id"] = entry["id"]
                else:
                    fact.pop("id", None)
            if institution_key:
                entry = institutions.get(institution_key)
                if not isinstance(entry, dict):
                    raise RegistryError("unknown_institution_key")
                if entry.get("id"):
                    fact["institution_id"] = entry["id"]
                else:
                    fact.pop("institution_id", None)
            if place_key:
                if place_key not in places:
                    raise RegistryError("unknown_place_key")
                fact.pop("institution_id", None)
            result.append(fact)
        out[section] = result
    return out
