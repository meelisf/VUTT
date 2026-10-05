"""Autoriteetsed ametite ja asutuste registrid (#462, #471).

Võti on VUTT-i püsiv identiteet; Q-kood on valikuline väline tunnus. Isiku
allikasõnastus elab isikukaardil ega muutu registrikirje muutmisel.
"""
from __future__ import annotations

import json
import os
import re
import threading
import unicodedata
from typing import Optional

from ..config import DATA_CONFIG_DIR, PLACES_FILE
from ..git_ops import save_config_with_git

_FILES = {"occupation": "occupations.json", "institution": "institutions.json"}
_KEY = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_QID = re.compile(r"^Q[1-9][0-9]*$")
_LOCK = threading.RLock()
_MAX_ENTRIES = 5000


class RegistryError(ValueError):
    pass


class DuplicateIdError(RegistryError):
    """Sama Q-kood on registris juba teisel kirjel; `key` = see kirje (klient pakub seda)."""

    def __init__(self, key: str):
        super().__init__("duplicate_id")
        self.key = key


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


def _text(value, field: str, *, required: bool = False) -> Optional[str]:
    if value is None and not required:
        return None
    if not isinstance(value, str) or len(value) > 300 or (required and not value.strip()):
        raise RegistryError(f"invalid_{field}")
    return value.strip() or None


def validate_entry(kind: str, key: str, data: dict, *, places: Optional[dict] = None) -> dict:
    _path(kind)
    if not isinstance(key, str) or not _KEY.fullmatch(key) or len(key) > 100:
        raise RegistryError("invalid_key")
    if not isinstance(data, dict):
        raise RegistryError("invalid_entry")
    allowed = {"id", "labels", "variants", "notes"}
    if kind == "institution":
        allowed |= {"type", "place_key", "place_periods", "active_from", "active_to"}
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
        periods = _place_periods(data.get("place_periods"), places)
        if periods:
            result["place_periods"] = periods
        # Tegutsemisaeg eristab samanimelisi asutusi (Tartu gümnaasium 1630–1632 vs
        # kubermangugümnaasium 1804–1890). See EI OLE koht ajas (`place_periods`).
        years = {}
        for field in ("active_from", "active_to"):
            value = data.get(field)
            if value is None:
                continue
            if type(value) is not int or not 1000 <= value <= 2100:
                raise RegistryError("invalid_active_years")
            years[field] = value
        if len(years) == 2 and years["active_from"] > years["active_to"]:
            raise RegistryError("invalid_active_years")
        result.update(years)
    return result


def _place_periods(value, places: Optional[dict]) -> list:
    """Asutuse koht ajas (nt AGC: Tartu kuni 1699, Pärnu alates 1699). Klient valib
    koha faktide aasta järgi; `place_key` jääb vaikekohaks aastata faktile."""
    if value in (None, []):
        return []
    if not isinstance(value, list) or len(value) > 20:
        raise RegistryError("invalid_place_periods")
    out = []
    for period in value:
        if not isinstance(period, dict) or set(period) - {"place_key", "from", "to"}:
            raise RegistryError("invalid_place_periods")
        place_key = _text(period.get("place_key"), "place_key", required=True)
        if places is not None and place_key not in places:
            raise RegistryError("unknown_place_key")
        years = {k: period[k] for k in ("from", "to") if period.get(k) is not None}
        if any(type(y) is not int or not 1000 <= y <= 2100 for y in years.values()):
            raise RegistryError("invalid_place_periods")
        if "from" in years and "to" in years and years["from"] > years["to"]:
            raise RegistryError("invalid_place_periods")
        out.append({"place_key": place_key, **years})
    return out


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


def _slug(text: str) -> str:
    plain = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "-", plain.lower()).strip("-")[:60].strip("-")


def generate_key(entries: dict, data: dict) -> str:
    """Püsivõti nimest; kokkupõrkel algusaasta, siis järjekorranumber.
    Kasutaja võtit ei vali: temale on oluline, et teine asutus ei saaks sama võtit."""
    labels = data.get("labels") or {}
    base = _slug(str(labels.get("et") or labels.get("en") or next(iter(labels.values()), ""))) or "kirje"
    candidates = [base]
    if isinstance(data.get("active_from"), int):
        candidates.append(f"{base}-{data['active_from']}")
    for candidate in candidates:
        if candidate not in entries:
            return candidate
    n = 2
    while f"{candidates[-1]}-{n}" in entries:
        n += 1
    return f"{candidates[-1]}-{n}"


def create(kind: str, data: dict, username: str) -> tuple[str, dict]:
    """Uus kirje serveri genereeritud võtmega. Võtme valik, Q-kontroll ja kirjutus
    on ühe luku all — kaks samaaegset loomist ei saa sama võtit."""
    with _LOCK:
        entries = load(kind)
        if len(entries) >= _MAX_ENTRIES:
            raise RegistryError("registry_full")
        qid = data.get("id") if isinstance(data, dict) else None
        if qid:
            for key, value in entries.items():
                if isinstance(value, dict) and value.get("id") == qid:
                    raise DuplicateIdError(key)
        key = generate_key(entries, data if isinstance(data, dict) else {})
        clean = validate_entry(kind, key, data, places=_places() if kind == "institution" else None)
        entries[key] = clean
        save_config_with_git(_path(kind), entries, username, message=f"Register {kind}: lisa {key}")
        return key, clean


def put_many(kind: str, updates: dict, username: str, message: str) -> dict:
    """Mitu olemasolevat kirjet ühe commitiga (hooldusskriptid). Kõik valideeritakse
    enne kirjutamist — üks vigane kirje ei jäta faili poolikuks."""
    with _LOCK:
        entries = load(kind)
        places = _places() if kind == "institution" else None
        clean = {}
        for key, data in updates.items():
            if key not in entries:
                raise RegistryError("unknown_key")
            clean[key] = validate_entry(kind, key, data, places=places)
        merged = {**entries, **clean}
        for key, entry in clean.items():
            if entry["id"] and any(k != key and isinstance(v, dict) and v.get("id") == entry["id"]
                                   for k, v in merged.items()):
                raise RegistryError("duplicate_id")
        if not clean:
            return {}
        entries.update(clean)
        save_config_with_git(_path(kind), entries, username, message=message)
        return clean


def same_entry(a: dict, b: dict) -> bool:
    """Sama kirje: sama Q-kood; kui Q-koodi pole kummalgi, sama eestikeelne nimi."""
    if a.get("id") or b.get("id"):
        return a.get("id") == b.get("id")

    def nimi(entry: dict) -> str:
        return str((entry.get("labels") or {}).get("et") or "").strip().casefold()
    return bool(nimi(a)) and nimi(a) == nimi(b)


def _ensure_decision(entries: dict, kind: str, key: str, data: dict) -> tuple[dict, bool]:
    """Ühine otsus kinnituse eelkontrollile ja `ensure`-ile: (kirje, kas luua)."""
    clean = validate_entry(kind, key, data, places=_places() if kind == "institution" else None)
    existing = entries.get(key)
    if isinstance(existing, dict):
        if same_entry(existing, clean):
            return existing, False
        raise RegistryError("registry_conflict")
    if len(entries) >= _MAX_ENTRIES:
        raise RegistryError("registry_full")
    if clean["id"] and any(isinstance(v, dict) and v.get("id") == clean["id"]
                           for v in entries.values()):
        raise RegistryError("duplicate_id")
    return clean, True


def check_ensure(kind: str, key: str, data: dict) -> dict:
    """`ensure`-i reegel ilma kirjutamata (agendi ettepaneku eelkontroll)."""
    return _ensure_decision(load(kind), kind, key, data)[0]


def ensure(kind: str, key: str, data: dict, username: str) -> tuple[dict, bool]:
    """Loob kirje, kui võtit pole; sama kirje korral seob. Erinevalt `put`-ist ei
    kirjuta kunagi olemasolevat üle: lugemine, võrdlus ja kirjutus on ühe luku all,
    muidu võiks samaaegne kinnitus vahepeal loodud kirje üle kirjutada."""
    with _LOCK:
        entries = load(kind)
        entry, create = _ensure_decision(entries, kind, key, data)
        if not create:
            return entry, False
        entries[key] = entry
        save_config_with_git(_path(kind), entries, username,
                             message=f"Register {kind}: lisa {key} (agendi ettepanek)")
        return entry, True


def registry_name(entry: dict, key: str) -> str:
    """Registrikirje nimi: eesti → inglise → esimene silt → võti."""
    labels = entry.get("labels") or {}
    return labels.get("et") or labels.get("en") or next(iter(labels.values()), None) or key


def _known_names(entry: dict) -> set:
    names = list((entry.get("labels") or {}).values()) + list(entry.get("variants") or [])
    return {str(n).strip().casefold() for n in names if str(n).strip()}


def _keep_known_wording(fact: dict, field: str, entry: dict, key: str) -> None:
    """Seotud fakti sõnastus peab olema registrile tuntud nimi (nimi või variant).

    Muu sõnastus („Professore Ordinario", „Lutherischer Theologe") liigub fakti
    `notes`-i ja välja saab registri nimi — muidu näitas vorm kastis sõna, mida
    lugeja kunagi ei näe (ADR 0059 täiendus 2026-10-05). Variant („Pfarrer") jääb:
    ta on ameti nimi teises keeles ja register teab teda juba.

    AINULT ameti `label`-ile. Asutuse sõnastus oli mõõtmisel peamiselt rikastuse
    vaiketekst („Academia Gustaviana" AGC võtmega, 594 tõendita fakti) — „Allikas"
    märge väidaks seal midagi, mida ükski allikas ei ütle.
    """
    text = str(fact.get(field) or "").strip()
    if not text or text.casefold() in _known_names(entry):
        return
    fact[field] = registry_name(entry, key)
    note = f"Allikas: „{text}“"
    notes = str(fact.get("notes") or "").strip()
    if note not in notes:
        fact["notes"] = f"{notes}; {note}" if notes else note


def normalize_person_facts(data: dict) -> dict:
    """Püsivõti on tõde; ühilduvus-Q võetakse registrist. Seotud ameti sõnastus on
    registrile tuntud nimi; muu sõnastus säilib `notes`-is (`_keep_known_wording`)."""
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
                _keep_known_wording(fact, "label", entry, occupation_key)
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
