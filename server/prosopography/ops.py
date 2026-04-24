"""
Prosopograafia CRUD operatsioonid.
Per-person failid state/prosopography/{nanoid}.json.
Jagatud indeksid (prosopography_index.json, person_to_works.json) kaitstud threading.Lock()-iga.
"""
import glob as _glob
import json
import os
import re
import threading
from datetime import datetime, timezone
from typing import Optional

PERSON_IMAGES_DIR_NAME = "images"  # PROSOPOGRAPHY_DIR / images /

from ..config import (
    PROSOPOGRAPHY_DIR,
    PROSOPOGRAPHY_INDEX_FILE,
    PERSON_TO_WORKS_FILE,
    PERSON_ALIASES_FILE,
)
from ..utils import generate_nanoid, atomic_write_json
from .work_relations_ops import update_works_creators_index, build_works_creators_index
from .places_ops import (
    _resolve_origin_group,
    _get_parent_place,
    _get_place_labels,
    _get_place_coordinates,
    _enrich_origin_from_places,
    _load_origin_groups,
)

# Jagatud indeksite kirjutuslukkud
_index_lock = threading.Lock()
_works_lock = threading.Lock()
_aliases_lock = threading.Lock()


# =========================================================
# ABIFUNKTSIOONID
# =========================================================


def _id_to_path(person_id: str) -> str:
    """vutt:Pabc123 → state/prosopography/abc123.json"""
    nanoid = person_id.removeprefix("vutt:P")
    return os.path.join(PROSOPOGRAPHY_DIR, f"{nanoid}.json")


def _strip_markup(text: str) -> str:
    """Eemaldab VUTT XML-tägid biography_snippet jaoks."""
    if not text:
        return ""
    return re.sub(r"<[^>]+>", "", text).strip()


def _make_snippet(person: dict) -> str:
    biography = person.get("biography") or person.get("notes") or ""
    return _strip_markup(biography)[:120]


def _load_index() -> dict:
    if os.path.exists(PROSOPOGRAPHY_INDEX_FILE):
        try:
            with open(PROSOPOGRAPHY_INDEX_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"rebuilt_at": None, "entries": []}


def _load_person_to_works() -> dict:
    if os.path.exists(PERSON_TO_WORKS_FILE):
        try:
            with open(PERSON_TO_WORKS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _load_person_aliases() -> dict:
    if os.path.exists(PERSON_ALIASES_FILE):
        try:
            with open(PERSON_ALIASES_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _index_entry_from_person(person: dict, work_count: int = 0) -> dict:
    """Ehitab prosopography_index.json kirje isiku täisandmetest."""
    birth = person.get("birth") or {}
    death = person.get("death") or {}
    identifiers = person.get("identifiers") or []
    schemes = {i.get("scheme") for i in identifiers}
    # Toetab nii statuses[] kui legacy status {}
    _statuses_list = person.get("statuses")
    if _statuses_list is None:
        _legacy = person.get("status") or {}
        _statuses_list = [{"id": _legacy["id"], "label": _legacy.get("label", "")}] if _legacy.get("id") else []
    _confessions_list = person.get("confessions")
    if _confessions_list is None:
        # legacy fallback
        _conf_legacy = person.get("confession") or {}
        _confessions_list = [{"id": _conf_legacy["id"], "label": _conf_legacy.get("label", "")}] if _conf_legacy.get("id") else []
    name_obj = person.get("name") or {}
    label = name_obj.get("label") or person.get("id", "")
    family_name = name_obj.get("family_name") or ""
    if family_name:
        sort_name = family_name
    else:
        # Kui family_name puudub (nt patronüümiline nimi "Achatius Georgii"),
        # kasuta viimast sõna labelis (v.a qualifier "vanem"/"noorem")
        qualifier = (name_obj.get("qualifier") or "").strip().lower()
        words = label.split()
        if qualifier and words and words[-1].lower() == qualifier:
            words = words[:-1]
        sort_name = words[-1] if len(words) > 1 else label
    aliases = name_obj.get("aliases") or []
    occupations = _extract_occupation_entries(person)

    # Haridusasutused
    education_institutions = list(dict.fromkeys(
        e["institution"] for e in (person.get("education") or [])
        if e.get("institution")
    ))

    # AA kirje number ja immatrikuleerimise aasta
    aa_id_str = next(
        (i["id"] for i in identifiers if i.get("scheme") == "album_academicum"),
        None,
    )
    aa_number: Optional[int] = None
    if aa_id_str:
        try:
            aa_number = int(aa_id_str.removeprefix("AA:"))
        except ValueError:
            pass
    imm_year: Optional[int] = None
    imm_date: Optional[str] = None
    _AG_NAMES = {"Academia Gustaviana", "Academia Gustavo-Carolina"}

    def _extract_date(edu: dict) -> str:
        return (edu.get("date_from") or {}).get("date") or edu.get("date_start") or ""

    # Prioriteet 1: Academia Gustaviana / Gustavo-Carolina kirje (= Tartu immatrikuleerumine)
    for edu in (person.get("education") or []):
        if edu.get("institution") in _AG_NAMES:
            date_str = _extract_date(edu)
            if len(date_str) >= 4:
                try:
                    imm_year = int(date_str[:4])
                    imm_date = date_str
                    break
                except ValueError:
                    pass

    # Prioriteet 2: muu album_academicum kirje millel on kuupäev (fallback)
    if imm_year is None:
        for edu in (person.get("education") or []):
            if edu.get("source") == "album_academicum":
                date_str = _extract_date(edu)
                if len(date_str) >= 4:
                    try:
                        imm_year = int(date_str[:4])
                        imm_date = date_str
                        break
                    except ValueError:
                        pass

    # Päritolukoht
    origin = person.get("origin") or {}
    place_key = origin.get("place") or None
    place_id = origin.get("place_id") or None
    origin_group = _resolve_origin_group(place_id, place_key)
    origin_parent = _get_parent_place(place_key)
    origin_place_labels = _get_place_labels(place_key)
    origin_coordinates = _get_place_coordinates(place_key)
    origin_group_labels: Optional[dict] = None
    if origin_group:
        groups_cfg = _load_origin_groups()
        origin_group_labels = groups_cfg.get(origin_group, {}).get("labels")

    # birth/death_year + sort_date (ISO string, lexicographic = kronoloogiline)
    def _extract_year(date_obj: dict) -> Optional[int]:
        date_str = date_obj.get("date") or ""
        if date_str and len(date_str) >= 4:
            try:
                return int(date_str[:4])
            except ValueError:
                pass
        return None

    def _extract_date(date_obj: dict) -> Optional[str]:
        date_str = (date_obj.get("date") or "").strip()
        return date_str if len(date_str) >= 4 else None

    return {
        "id": person["id"],
        "label": label,
        "sort_name": sort_name,
        "birth_year": _extract_year(birth),
        "birth_date": _extract_date(birth),
        "death_year": _extract_year(death),
        "death_date": _extract_date(death),
        "gender": person.get("gender"),
        "status_ids": [s["id"] for s in _statuses_list if s.get("id")],
        "status_labels": [s.get("label", "") for s in _statuses_list if s.get("id")],
        "confession_ids": [c["id"] for c in _confessions_list if c.get("id")],
        "has_wikidata": "wikidata" in schemes,
        "has_gnd": "gnd" in schemes,
        "has_aa": "album_academicum" in schemes,
        "aa_number": aa_number,
        "imm_year": imm_year,
        "imm_date": imm_date,
        "record_status": person.get("record_status", "draft"),
        "verification_level": person.get("verification_level", "draft"),
        "work_count": work_count,
        "biography_snippet": _make_snippet(person),
        "image_url": person.get("image_url"),
        "aliases": aliases,
        "occupations": occupations,
        # Päritolu (uued väljad)
        "education_institutions": education_institutions,
        "origin_place": place_key,
        "origin_place_id": place_id,
        "origin_place_labels": origin_place_labels,
        "origin_coordinates": origin_coordinates,
        "origin_parent": origin_parent,
        "origin_group": origin_group,
        "origin_group_labels": origin_group_labels,
        "tags": person.get("tags") or [],
    }


def _extract_occupation_entries(person: dict) -> list[dict]:
    raw_occupations = person.get("occupations") or []

    def _occupation_entry(item):
        if isinstance(item, dict):
            label = item.get("label")
            occ_id = item.get("id")
            labels = item.get("labels")
            if (not isinstance(label, str) or not label.strip()) and isinstance(labels, dict):
                label = labels.get("et") or labels.get("en") or next((v for v in labels.values() if isinstance(v, str) and v.strip()), "")
            label = label.strip() if isinstance(label, str) else ""
            occ_id = occ_id.strip() if isinstance(occ_id, str) else None
            normalized_labels = {
                key: value.strip()
                for key, value in labels.items()
                if isinstance(key, str) and isinstance(value, str) and value.strip()
            } if isinstance(labels, dict) else None
            if occ_id or label:
                return {"id": occ_id, "label": label, "labels": normalized_labels}
            return None
        if isinstance(item, str):
            label = item.strip()
            return {"id": None, "label": label, "labels": None} if label else None
        return None

    deduped: dict[str, dict] = {}
    for item in raw_occupations:
        entry = _occupation_entry(item)
        if not entry:
            continue
        key = entry["id"] or f"label:{entry['label'].lower()}"
        if key not in deduped:
            deduped[key] = entry
    return sorted(deduped.values(), key=lambda item: (item.get("label") or "").lower())


def _entry_occupations(entry: dict) -> list[dict]:
    occupations = entry.get("occupations")
    if occupations is not None:
        normalized = []
        for item in occupations:
            if isinstance(item, dict):
                label = item.get("label")
                occ_id = item.get("id")
                labels = item.get("labels")
                normalized_labels = {
                    key: value.strip()
                    for key, value in labels.items()
                    if isinstance(key, str) and isinstance(value, str) and value.strip()
                } if isinstance(labels, dict) else None
                if isinstance(label, str) and label.strip():
                    normalized.append({
                        "id": occ_id if isinstance(occ_id, str) and occ_id.strip() else None,
                        "label": label.strip(),
                        "labels": normalized_labels,
                    })
            elif isinstance(item, str) and item.strip():
                normalized.append({"id": None, "label": item.strip(), "labels": None})
        if normalized:
            return normalized

    person_id = entry.get("id")
    if not person_id:
        return []
    person = get_person(person_id)
    if not person:
        return []
    return _extract_occupation_entries(person)


def _update_index_entry(person: dict):
    """Uuendab ühe kirje prosopography_index.json-s."""
    person_id = person["id"]
    works = _load_person_to_works()
    work_count = len(set(w["work_id"] for w in works.get(person_id, [])))
    new_entry = _index_entry_from_person(person, work_count)

    with _index_lock:
        index = _load_index()
        entries = [e for e in index["entries"] if e["id"] != person_id]
        if person.get("record_status") != "tombstone":
            entries.append(new_entry)
        index["entries"] = entries
        atomic_write_json(PROSOPOGRAPHY_INDEX_FILE, index)


def _update_aliases_entry(person: dict):
    """Uuendab person_aliases.json — vutt:P ID → nimevariandid."""
    person_id = person["id"]
    name_obj = person.get("name") or {}
    label = name_obj.get("label") or ""
    aliases = name_obj.get("aliases") or []
    all_names = list({label} | set(aliases))

    with _aliases_lock:
        data = _load_person_aliases()
        if person.get("record_status") == "tombstone":
            data.pop(person_id, None)
        else:
            data[person_id] = {
                "primary_name": label,
                "aliases": all_names,
                "ids": {},
            }
        atomic_write_json(PERSON_ALIASES_FILE, data)


# =========================================================
# CRUD
# =========================================================

def get_person(person_id: str) -> Optional[dict]:
    """Laeb isiku faili. Tagastab None kui ei leitud."""
    path = _id_to_path(person_id)
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def get_person_with_works(person_id: str) -> Optional[dict]:
    """Laeb isiku + tema teosed pöördindeksist (O(1))."""
    person = get_person(person_id)
    if person is None:
        return None
    works = _load_person_to_works()
    person["works"] = works.get(person_id, [])
    return person


def create_person(data: dict, username: str) -> dict:
    """
    Loob uue prosopograafia kirje.
    Tagastab salvestatud kirje (koos genereeritud vutt:P ID-ga).
    """
    nanoid = generate_nanoid()
    person_id = f"vutt:P{nanoid}"
    now = datetime.now(timezone.utc).isoformat()

    person = {
        "id": person_id,
        "identifiers": data.get("identifiers", []),
        "merged_into": None,
        "import_batch_ids": [],
        "schema_version": 1,
        "record_status": "draft",
        "verification_level": "draft",
        "created_at": now,
        "updated_at": now,
        "created_by": username,
        "updated_by": username,
        "name": {
            "label": data.get("name", ""),
            "family_name": data.get("family_name"),
            "first_name": data.get("first_name"),
            "qualifier": data.get("qualifier"),
            "qualifier_type": None,
            "noble_status": None,
            "maiden_name": None,
            "aliases": [],
            "family_name_variants": [],
            "first_name_variants": [],
        },
        "gender": data.get("gender"),
        "birth": _make_date_obj(data.get("birth_year")),
        "death": _make_date_obj(data.get("death_year")),
        "origin": {"place": None, "place_id": None, "place_labels": None, "geonames_id": None, "coordinates": None},
        "statuses": [],
        "confession": None,
        "occupations": [],
        "education": [],
        "burial": None,
        "relations": [],
        "sources": [],
        "biography": None,
        "notes": data.get("notes"),
        "image_url": None,
        "source_data": {},
    }

    os.makedirs(PROSOPOGRAPHY_DIR, exist_ok=True)
    atomic_write_json(_id_to_path(person_id), person)
    _update_index_entry(person)
    _update_aliases_entry(person)
    return person


def _make_date_obj(year) -> dict:
    """Loob minimaalse HistoricalDate objekti aastast (või None)."""
    return {
        "original_text": None,
        "date": str(year) if year else None,
        "date_to": None,
        "bound": None,
        "precision": "year" if year else None,
        "calendar": None,
        "is_circa": False,
        "place": None,
        "notes": None,
    }


def _propagate_name_to_works(person_id: str, new_label: str, username: str) -> None:
    """
    Uuendab teoste _metadata.json creator labelid kui nimi muutus.
    Kõik muutused pannakse ühte git commit'i.
    """
    from ..config import BASE_DIR as _DATA_DIR
    from ..git_ops import save_with_git
    if not os.path.exists(_DATA_DIR):
        return

    changed_files = []  # [(meta_path, json_content_str), ...]
    for work_entry in os.scandir(_DATA_DIR):
        if not work_entry.is_dir():
            continue
        meta_path = os.path.join(work_entry.path, "_metadata.json")
        if not os.path.exists(meta_path):
            continue
        try:
            meta = json.load(open(meta_path, encoding="utf-8"))
        except Exception:
            continue
        changed = False
        for c in meta.get("creators", []):
            if not isinstance(c, dict) or c.get("id") != person_id:
                continue
            if c.get("label") == new_label and c.get("name") == new_label:
                continue
            c["label"] = new_label
            c["name"] = new_label
            changed = True
        for t in meta.get("tags", []):
            if not isinstance(t, dict) or t.get("id") != person_id:
                continue
            if t.get("label") == new_label:
                continue
            t["label"] = new_label
            changed = True
        pub = meta.get("publisher")
        if isinstance(pub, dict) and pub.get("id") == person_id:
            if pub.get("label") != new_label:
                pub["label"] = new_label
                changed = True
        if changed:
            changed_files.append((meta_path, json.dumps(meta, ensure_ascii=False, indent=2)))

    if not changed_files:
        return

    commit_msg = f"Prosopo nime uuendus ({person_id}): {new_label}"
    primary_path, primary_content = changed_files[0]
    additional = changed_files[1:] if len(changed_files) > 1 else None
    save_with_git(primary_path, primary_content, username,
                  message=commit_msg, additional_files=additional)

    # Meilisearch sync muutunud teoste jaoks (async)
    from ..meilisearch_ops import sync_work_to_meilisearch_async
    for meta_path, _ in changed_files:
        dir_name = os.path.basename(os.path.dirname(meta_path))
        sync_work_to_meilisearch_async(dir_name)


def update_person(person_id: str, data: dict, username: str) -> dict:
    """
    Uuendab isiku kirjet optimistliku konkurentsikontrolliga.
    Kui data["updated_at"] ei klapi failiga → tõstatab ValueError("conflict").
    Kui name.label muutus, uuendatakse ka teoste creator labelid.
    """
    person = get_person(person_id)
    if person is None:
        raise KeyError(person_id)

    # Optimistlik konkurentsikontroll
    client_updated_at = data.get("updated_at")
    if client_updated_at and person.get("updated_at") != client_updated_at:
        raise ValueError(f"conflict:{person['updated_at']}")

    old_label = (person.get("name") or {}).get("label") or ""

    now = datetime.now(timezone.utc).isoformat()
    # Säilitame süsteemiväljad, ülekirjutame kasutaja andmed
    for key in ("id", "created_at", "created_by", "schema_version",
                "import_batch_ids", "merged_into", "auth_token", "token"):
        data.pop(key, None)

    person.update(data)
    person["updated_at"] = now
    person["updated_by"] = username

    # Normaliseeri päritolukoht places.json-st
    origin = person.get("origin") or {}
    if origin.get("place"):
        try:
            person["origin"] = _enrich_origin_from_places(origin)
        except ValueError:
            # Tundmatu koht places.json-s — tühjenda place, salvesta muud väljad
            logger.warning("Tundmatu päritolukoht: %r — place tühjendatakse", origin.get("place"))
            person["origin"] = {**origin, "place": None, "place_id": None, "place_labels": None}

    atomic_write_json(_id_to_path(person_id), person)
    _update_index_entry(person)
    _update_aliases_entry(person)

    new_label = (person.get("name") or {}).get("label") or ""
    if new_label and new_label != old_label:
        _propagate_name_to_works(person_id, new_label, username)

    return person


def list_persons(
    q: Optional[str] = None,
    gender: Optional[str] = None,
    occupation: Optional[str] = None,
    origin_group: Optional[str] = None,
    institution: Optional[str] = None,
    status_id: Optional[str] = None,
    source: Optional[str] = None,
    verification_level: Optional[str] = None,
    imm_year_from: Optional[int] = None,
    imm_year_to: Optional[int] = None,
    sort_by: Optional[str] = None,
    ids: Optional[list] = None,
    limit: int = 48,
    offset: int = 0,
) -> dict:
    """
    Tagastab prosopography_index.json kirjed filtreeritult, pagineeritult.
    Otsing q= töötab label + sort_name + aliases (sh Wikidata/GND) vastu.
    """
    results = _filter_index_entries(
        q=q,
        gender=gender,
        occupation=occupation,
        origin_group=origin_group,
        institution=institution,
        status_id=status_id,
        source=source,
        verification_level=verification_level,
        imm_year_from=imm_year_from,
        imm_year_to=imm_year_to,
        ids=ids,
    )

    if sort_by == "birth_year":
        results.sort(key=lambda e: (e.get("birth_date") is None, e.get("birth_date") or ""))
    elif sort_by == "death_year":
        results.sort(key=lambda e: (e.get("death_date") is None, e.get("death_date") or ""))
    elif sort_by == "imm_year":
        results.sort(key=lambda e: (e.get("imm_date") is None, e.get("imm_date") or ""))
    else:
        results.sort(key=lambda e: (e.get("sort_name") or "").lower())
    total = len(results)
    return {
        "results": results[offset:offset + limit],
        "total": total,
        "offset": offset,
        "limit": limit,
    }


def _filter_index_entries(
    q: Optional[str] = None,
    gender: Optional[str] = None,
    occupation: Optional[str] = None,
    origin_group: Optional[str] = None,
    institution: Optional[str] = None,
    status_id: Optional[str] = None,
    source: Optional[str] = None,
    verification_level: Optional[str] = None,
    imm_year_from: Optional[int] = None,
    imm_year_to: Optional[int] = None,
    ids: Optional[list] = None,
) -> list[dict]:
    index = _load_index()
    results = [
        e for e in index.get("entries", [])
        if e.get("record_status") != "tombstone"
    ]

    if ids is not None:
        id_set = set(ids)
        results = [e for e in results if e.get("id") in id_set]
    if q:
        q_lower = q.lower()
        aliases_data = _load_person_aliases()
        results = [
            e for e in results
            if q_lower in (e.get("label") or "").lower()
            or q_lower in (e.get("sort_name") or "").lower()
            or any(q_lower in a.lower() for a in (e.get("aliases") or []))
            or any(q_lower in a.lower() for a in (aliases_data.get(e.get("id"), {}).get("aliases") or []))
        ]
    if gender:
        results = [e for e in results if e.get("gender") == gender]
    if occupation:
        occupation_filter = occupation.strip()
        results = [
            e for e in results
            if any(
                (item.get("id") and item.get("id") == occupation_filter)
                or ((not item.get("id")) and item.get("label", "").strip().lower() == occupation_filter.lower())
                for item in _entry_occupations(e)
            )
        ]
    if origin_group:
        results = [e for e in results if e.get("origin_group") == origin_group]
    if institution:
        inst_lower = institution.strip().lower()
        results = [
            e for e in results
            if any(inst_lower in (i or "").lower() for i in (e.get("education_institutions") or []))
        ]
    if status_id:
        results = [e for e in results if status_id in (e.get("status_ids") or [])]
    if verification_level:
        results = [e for e in results if e.get("verification_level") == verification_level]
    if source:
        source_map = {"wikidata": "has_wikidata", "gnd": "has_gnd", "aa": "has_aa"}
        field = source_map.get(source)
        if field:
            results = [e for e in results if e.get(field)]
    if imm_year_from is not None:
        results = [e for e in results if (e.get("imm_year") or 0) >= imm_year_from]
    if imm_year_to is not None:
        results = [e for e in results if (e.get("imm_year") or 0) <= imm_year_to]

    return results


def get_person_map_markers(
    q: Optional[str] = None,
    gender: Optional[str] = None,
    occupation: Optional[str] = None,
    origin_group: Optional[str] = None,
    institution: Optional[str] = None,
    status_id: Optional[str] = None,
    source: Optional[str] = None,
    verification_level: Optional[str] = None,
    imm_year_from: Optional[int] = None,
    imm_year_to: Optional[int] = None,
    ids: Optional[list] = None,
) -> dict:
    """Tagastab koordinaadiga isikud grupeerituna päritolukoha markeriteks."""
    entries = _filter_index_entries(
        q=q,
        gender=gender,
        occupation=occupation,
        origin_group=origin_group,
        institution=institution,
        status_id=status_id,
        source=source,
        verification_level=verification_level,
        imm_year_from=imm_year_from,
        imm_year_to=imm_year_to,
        ids=ids,
    )

    markers_by_place: dict[str, dict] = {}
    without_coordinates = 0

    for entry in entries:
        coordinates = entry.get("origin_coordinates")
        if not isinstance(coordinates, dict):
            without_coordinates += 1
            continue
        lat = coordinates.get("lat")
        lon = coordinates.get("lon")
        if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
            without_coordinates += 1
            continue

        place_key = entry.get("origin_place") or entry.get("origin_place_id") or "unknown"
        marker = markers_by_place.setdefault(place_key, {
            "place_key": entry.get("origin_place"),
            "place_id": entry.get("origin_place_id"),
            "place_labels": entry.get("origin_place_labels"),
            "parent": entry.get("origin_parent"),
            "origin_group": entry.get("origin_group"),
            "origin_group_labels": entry.get("origin_group_labels"),
            "coordinates": coordinates,
            "count": 0,
            "persons": [],
        })
        marker["count"] += 1
        marker["persons"].append({
            "id": entry.get("id"),
            "label": entry.get("label"),
            "birth_year": entry.get("birth_year"),
            "death_year": entry.get("death_year"),
            "imm_year": entry.get("imm_year"),
            "image_url": entry.get("image_url"),
            "work_count": entry.get("work_count", 0),
        })

    markers = sorted(
        markers_by_place.values(),
        key=lambda m: (-m["count"], (m.get("place_key") or "").lower()),
    )
    return {
        "markers": markers,
        "total_persons": len(entries),
        "mapped_persons": sum(m["count"] for m in markers),
        "without_coordinates": without_coordinates,
    }


def get_relation_type_suggestions() -> list:
    """
    Kogub kõigist isikukaartidest unikaalsed seose tüübid.
    Tagastab [{label, id, labels}] listi, dedup Q-koodi alusel.
    """
    seen: dict[str, dict] = {}
    pattern = os.path.join(PROSOPOGRAPHY_DIR, "*.json")
    for path in _glob.glob(pattern):
        try:
            with open(path, "r", encoding="utf-8") as f:
                person = json.load(f)
        except Exception:
            continue
        for rel in person.get("relations", []):
            type_label = (rel.get("type") or "").strip()
            type_id = rel.get("type_id") or None
            type_labels = rel.get("type_labels") or None
            if not type_label:
                continue
            key = type_id or f"manual:{type_label.lower()}"
            if key not in seen:
                seen[key] = {"label": type_label, "id": type_id, "labels": type_labels}
    return sorted(seen.values(), key=lambda x: (x["label"] or "").lower())


def get_person_facets(
    q: Optional[str] = None,
    gender: Optional[str] = None,
    ids: Optional[list] = None,
) -> dict:
    """
    Tagastab persons-listingu jaoks facetid.
    origin_groups: päritolugruppide loend sagedustega (asendab occupations).
    occupations: jääb tagasiühilduvuseks (tühi nimekiri).
    """
    filtered = list_persons(
        q=q,
        gender=gender,
        ids=ids,
        limit=10**9,
        offset=0,
    )["results"]

    groups_config = _load_origin_groups()

    group_counts: dict = {}
    for entry in filtered:
        grp = entry.get("origin_group")
        if grp:
            group_counts[grp] = group_counts.get(grp, 0) + 1

    origin_groups = []
    for grp_key, count in group_counts.items():
        grp_config = groups_config.get(grp_key, {})
        labels = grp_config.get("labels", {})
        origin_groups.append({
            "value": grp_key,
            "labels": labels,
            "label_et": labels.get("et", grp_key),
            "label_en": labels.get("en", grp_key),
            "sort_order": grp_config.get("sort_order", 999),
            "count": count,
        })

    origin_groups.sort(key=lambda x: (-x["count"], x.get("sort_order", 999)))

    # Haridusasutuste facet
    inst_counts: dict = {}
    for entry in filtered:
        for inst in (entry.get("education_institutions") or []):
            if inst:
                inst_counts[inst] = inst_counts.get(inst, 0) + 1

    institutions = [
        {"value": inst, "count": count}
        for inst, count in inst_counts.items()
    ]
    institutions.sort(key=lambda x: (-x["count"], x["value"].lower()))

    return {
        "origin_groups": origin_groups,
        "institutions": institutions,
        "occupations": [],  # tagasiühilduvus
    }


def add_identifier(person_id: str, scheme: str, ext_id: str, username: str) -> tuple:
    """
    Lisab identifikaatori ja käivitab rikastuse.
    Tagastab (uuendatud_isik, diff) tuple.
    """
    from .enrichment import fetch_and_diff

    person = get_person(person_id)
    if person is None:
        raise KeyError(person_id)

    # Kontrolli duplikaati
    existing = person.get("identifiers") or []
    for ident in existing:
        if ident.get("scheme") == scheme and ident.get("id") == ext_id:
            break
    else:
        existing.append({"scheme": scheme, "id": ext_id, "checked_at": None})
        person["identifiers"] = existing

    diff = fetch_and_diff(scheme, ext_id, person)

    now = datetime.now(timezone.utc).isoformat()
    person["updated_at"] = now
    person["updated_by"] = username
    atomic_write_json(_id_to_path(person_id), person)
    _update_index_entry(person)
    _update_aliases_entry(person)
    return person, diff


def _person_image_path(person_id: str, ext: str) -> str:
    """Tagastab isiku pildi failitee."""
    nanoid = person_id.removeprefix("vutt:P")
    img_dir = os.path.join(PROSOPOGRAPHY_DIR, PERSON_IMAGES_DIR_NAME)
    return os.path.join(img_dir, f"{nanoid}{ext}")


def upload_person_image(person_id: str, file_bytes: bytes, content_type: str, username: str) -> dict:
    """
    Salvestab isiku pildi ja uuendab image_url kirjes.
    Toetab JPEG ja PNG. PNG teisendatakse JPEG-iks.
    Tagastab uuendatud isiku kirje.
    """
    person = get_person(person_id)
    if person is None:
        raise KeyError(person_id)

    if content_type not in ("image/jpeg", "image/png", "image/webp"):
        raise ValueError("Toetatud formaadid: JPEG, PNG, WebP")

    # Teisenda PNG → JPEG pillow abil
    if content_type == "image/png":
        try:
            from PIL import Image
            import io
            img = Image.open(io.BytesIO(file_bytes)).convert("RGB")
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=90)
            file_bytes = buf.getvalue()
            content_type = "image/jpeg"
        except Exception as e:
            raise ValueError(f"PNG teisendamine ebaõnnestus: {e}")

    ext = ".jpg" if content_type in ("image/jpeg",) else ".webp"

    # Kustuta vana pilt (kui teise laiendiga)
    for old_ext in (".jpg", ".webp"):
        old_path = _person_image_path(person_id, old_ext)
        if old_path.endswith(ext):
            continue
        if os.path.exists(old_path):
            os.remove(old_path)

    img_dir = os.path.join(PROSOPOGRAPHY_DIR, PERSON_IMAGES_DIR_NAME)
    os.makedirs(img_dir, exist_ok=True)
    img_path = _person_image_path(person_id, ext)
    with open(img_path, "wb") as f:
        f.write(file_bytes)

    # image_url — suhteline URL frontendi jaoks
    encoded_id = person_id.replace(":", "%3A")
    person["image_url"] = f"/api/files/prosopography/{encoded_id}/image"

    now = datetime.now(timezone.utc).isoformat()
    person["updated_at"] = now
    person["updated_by"] = username
    atomic_write_json(_id_to_path(person_id), person)
    _update_index_entry(person)
    return person


def get_person_image_path(person_id: str) -> Optional[str]:
    """Tagastab isiku pildi failitee kui olemas, muidu None."""
    for ext in (".jpg", ".webp"):
        path = _person_image_path(person_id, ext)
        if os.path.exists(path):
            return path
    return None


def delete_person_image(person_id: str, username: str) -> dict:
    """Kustutab isiku pildi ja tühjendab image_url. Tagastab uuendatud kirje."""
    person = get_person(person_id)
    if person is None:
        raise KeyError(person_id)

    for ext in (".jpg", ".webp"):
        path = _person_image_path(person_id, ext)
        if os.path.exists(path):
            os.remove(path)

    person["image_url"] = None
    now = datetime.now(timezone.utc).isoformat()
    person["updated_at"] = now
    person["updated_by"] = username
    atomic_write_json(_id_to_path(person_id), person)
    _update_index_entry(person)
    return person


def apply_enrichment(person_id: str, approved: dict, username: str) -> dict:
    """Rakendab kasutaja kinnitatud rikastusmuudatused."""
    person = get_person(person_id)
    if person is None:
        raise KeyError(person_id)

    def _deep_set(obj: dict, path: str, value):
        """Seab obj[a][b] = value dotted path järgi."""
        parts = path.split(".", 1)
        if len(parts) == 1:
            obj[parts[0]] = value
        else:
            if parts[0] not in obj or not isinstance(obj[parts[0]], dict):
                obj[parts[0]] = {}
            _deep_set(obj[parts[0]], parts[1], value)

    for field_path, value in approved.items():
        _deep_set(person, field_path, value)

    # Märgi identifikaatorid kontrollituks
    scheme = approved.get("_enrichment_scheme")
    if scheme:
        for ident in person.get("identifiers") or []:
            if ident.get("scheme") == scheme:
                ident["checked_at"] = datetime.now(timezone.utc).date().isoformat()

    now = datetime.now(timezone.utc).isoformat()
    person["updated_at"] = now
    person["updated_by"] = username
    atomic_write_json(_id_to_path(person_id), person)
    _update_index_entry(person)
    _update_aliases_entry(person)
    return person


# =========================================================
# PÖÖRDINDEKS: person → teosed
# =========================================================

def _find_by_external_id(scheme: str, ext_id: str) -> Optional[dict]:
    """Otsib prosopo kaarti välise identifikaatori (scheme + id) järgi."""
    for fpath in _glob.glob(os.path.join(PROSOPOGRAPHY_DIR, "*.json")):
        if PERSON_IMAGES_DIR_NAME in fpath:
            continue
        try:
            p = json.load(open(fpath, encoding="utf-8"))
        except Exception:
            continue
        if p.get("record_status") == "tombstone":
            continue
        for ident in p.get("identifiers") or []:
            if ident.get("scheme") == scheme and ident.get("id") == ext_id:
                return p
    return None


def ensure_prosopo_for_entity(entity: dict, username: str) -> dict:
    """
    Tagab, et LinkedEntity objektil on vutt:P ID.
    Wikidata / GND / VIAF → otsi olemasolev kaart, kui pole → loo stub.
    Kõik muud ID-d (manual, tundmatu) tagastatakse muutmata.
    """
    if not isinstance(entity, dict):
        return entity
    eid = (entity.get("id") or "").strip()
    if eid.startswith("vutt:P") or not eid:
        return entity

    source = (entity.get("source") or "").lower()
    # Toetatud välisallikad
    if source not in ("wikidata", "gnd", "viaf"):
        return entity

    scheme = source  # source nimi = prosopo scheme nimi

    existing = _find_by_external_id(scheme, eid)
    if existing:
        return {**entity, "id": existing["id"]}

    label = (entity.get("label") or entity.get("name") or eid).strip()
    stub = create_person(
        {"name": label, "identifiers": [{"scheme": scheme, "id": eid}]},
        username=username,
    )
    return {**entity, "id": stub["id"]}


def ensure_prosopo_stubs(updates: dict, username: str) -> dict:
    """
    Käitleb updates dict-i creators/tags/publisher väljad:
    asendab Wikidata Q-koodid vutt:P ID-dega (luues stub kaardid vajadusel).
    Tagastab uuendatud updates koopiaga.
    """
    changed = {}

    if "creators" in updates:
        changed["creators"] = [
            ensure_prosopo_for_entity(c, username)
            if isinstance(c, dict) else c
            for c in (updates["creators"] or [])
        ]

    if "tags" in updates:
        changed["tags"] = [
            ensure_prosopo_for_entity(t, username)
            if isinstance(t, dict) and t.get("entity_type") == "person" else t
            for t in (updates["tags"] or [])
        ]

    if "publisher" in updates:
        pub = updates["publisher"]
        if isinstance(pub, dict) and pub.get("entity_type") == "person":
            changed["publisher"] = ensure_prosopo_for_entity(pub, username)

    if changed:
        return {**updates, **changed}
    return updates


def update_person_to_works(
    work_id: str,
    creators: list,
    tags: list,
    publisher=None,
    title: str = "",
    year: Optional[int] = None,
):
    """
    Uuendab person_to_works.json pöördindeksit ühe teose salvestamisel.
    Kutsutakse file_server.py-st POST /save ja PUT /update-metadata järel.
    """
    # Kogu kõik selle teose isikud rollide järgi
    new_entries: dict[str, set[str]] = {}  # person_id → set of roles

    for creator in (creators or []):
        pid = creator.get("id") or ""
        if pid.startswith("vutt:P"):
            role = creator.get("role") or "creator"
            new_entries.setdefault(pid, set()).add(role)

    for tag in (tags or []):
        if isinstance(tag, dict) and tag.get("entity_type") == "person":
            pid = tag.get("id") or ""
            if pid.startswith("vutt:P"):
                new_entries.setdefault(pid, set()).add("subject")

    if publisher and isinstance(publisher, dict):
        pid = publisher.get("id") or ""
        if pid.startswith("vutt:P"):
            new_entries.setdefault(pid, set()).add("publisher")

    with _works_lock:
        data = _load_person_to_works()

        # Eemalda kõik olemasolevad viited sellele teosele
        for pid_entries in data.values():
            pid_entries[:] = [e for e in pid_entries if e.get("work_id") != work_id]

        # Lisa uued
        for pid, roles in new_entries.items():
            if pid not in data:
                data[pid] = []
            for role in roles:
                data[pid].append({"work_id": work_id, "role": role})

        atomic_write_json(PERSON_TO_WORKS_FILE, data)

    # Uuenda works_creators_index (background-ühilduv, ei nõua locks)
    try:
        update_works_creators_index(work_id, creators, title=title, year=year)
    except Exception:
        logger.exception("update_works_creators_index viga teose %s jaoks", work_id)


def update_page_person_mentions(work_id: str, work_dir: str):
    """Uuendab person_to_works 'mentioned' rolle antud teose lehekülje page_tags põhjal."""
    if not work_id:
        return

    person_ids: set[str] = set()
    try:
        for fname in os.listdir(work_dir):
            if not fname.endswith('.json') or fname == '_metadata.json':
                continue
            fpath = os.path.join(work_dir, fname)
            try:
                with open(fpath, 'r', encoding='utf-8') as f:
                    page = json.load(f)
                source = page.get('meta_content', page)
                for tag in source.get('page_tags', []):
                    if isinstance(tag, dict):
                        pid = tag.get('id') or ''
                        if pid.startswith('vutt:P'):
                            person_ids.add(pid)
            except Exception:
                pass
    except Exception as e:
        print(f"update_page_person_mentions viga: {e}")
        return

    with _works_lock:
        data = _load_person_to_works()
        # Eemalda ainult 'mentioned' viited sellele teosele
        for pid_entries in data.values():
            pid_entries[:] = [
                e for e in pid_entries
                if not (e.get('work_id') == work_id and e.get('role') == 'mentioned')
            ]
        # Lisa uued
        for pid in person_ids:
            if pid not in data:
                data[pid] = []
            data[pid].append({'work_id': work_id, 'role': 'mentioned'})
        atomic_write_json(PERSON_TO_WORKS_FILE, data)


# =========================================================
# INDEKSITE TAASTAMINE
# =========================================================

def rebuild_indices():
    """
    Taastab kõik kolm read-modeli nullist:
      1. prosopography_index.json
      2. person_aliases.json
      3. person_to_works.json (teoste _metadata.json ja leheküljefailide põhjal)
    """
    from ..config import BASE_DIR

    if not os.path.exists(PROSOPOGRAPHY_DIR):
        return

    # --- 1+2: käi läbi kõik prosopograafia kirjed ---
    all_persons = []
    for fname in os.listdir(PROSOPOGRAPHY_DIR):
        if not fname.endswith(".json"):
            continue
        path = os.path.join(PROSOPOGRAPHY_DIR, fname)
        try:
            with open(path, "r", encoding="utf-8") as f:
                person = json.load(f)
            all_persons.append(person)
        except Exception:
            continue

    # person_to_works: kogu esmalt teoste metadata põhjal
    ptw: dict[str, list] = {}
    if os.path.exists(BASE_DIR):
        for entry in os.scandir(BASE_DIR):
            if not entry.is_dir():
                continue
            meta_path = os.path.join(entry.path, "_metadata.json")
            if not os.path.exists(meta_path):
                continue
            try:
                with open(meta_path, "r", encoding="utf-8") as f:
                    meta = json.load(f)
            except Exception:
                continue
            work_id = meta.get("id") or meta.get("work_id")
            if not work_id:
                continue
            for creator in meta.get("creators") or []:
                pid = creator.get("id") or ""
                if pid.startswith("vutt:P"):
                    role = creator.get("role") or "creator"
                    ptw.setdefault(pid, []).append({"work_id": work_id, "role": role})
            tags_list = meta.get("tags") or []
            for tag in tags_list:
                if isinstance(tag, dict) and tag.get("entity_type") == "person":
                    pid = tag.get("id") or ""
                    if pid.startswith("vutt:P"):
                        ptw.setdefault(pid, []).append({"work_id": work_id, "role": "subject"})
            pub = meta.get("publisher")
            if pub and isinstance(pub, dict):
                pid = pub.get("id") or ""
                if pid.startswith("vutt:P"):
                    ptw.setdefault(pid, []).append({"work_id": work_id, "role": "publisher"})

            # page_tags isikud ('mentioned' roll) — set tagab duplikaatide vältimise
            mentioned_ids: set[str] = set()
            try:
                for page_fname in os.listdir(entry.path):
                    if not page_fname.endswith('.json') or page_fname == '_metadata.json':
                        continue
                    page_fpath = os.path.join(entry.path, page_fname)
                    try:
                        with open(page_fpath, 'r', encoding='utf-8') as pf:
                            page_data = json.load(pf)
                        source = page_data.get('meta_content', page_data)
                        for tag in source.get('page_tags', []):
                            if isinstance(tag, dict):
                                pid = tag.get('id') or ''
                                if pid.startswith('vutt:P'):
                                    mentioned_ids.add(pid)
                    except Exception:
                        pass
            except Exception:
                pass
            for pid in mentioned_ids:
                ptw.setdefault(pid, []).append({'work_id': work_id, 'role': 'mentioned'})

    # Kirjuta person_to_works
    with _works_lock:
        atomic_write_json(PERSON_TO_WORKS_FILE, ptw)

    # Ehita works_creators_index
    try:
        build_works_creators_index()
    except Exception:
        logger.exception("build_works_creators_index viga rebuild_indices sees")

    # Ehita index entries
    entries = []
    aliases_data = {}
    for person in all_persons:
        if person.get("record_status") == "tombstone":
            continue
        pid = person["id"]
        works_list = ptw.get(pid, [])
        work_count = len({w["work_id"] for w in works_list})
        entries.append(_index_entry_from_person(person, work_count))

        name_obj = person.get("name") or {}
        label = name_obj.get("label") or ""
        person_aliases = name_obj.get("aliases") or []
        all_names = list({label} | set(person_aliases))
        aliases_data[pid] = {
            "primary_name": label,
            "aliases": all_names,
            "ids": {},
        }

    entries.sort(key=lambda e: (e.get("sort_name") or "").lower())

    with _index_lock:
        atomic_write_json(PROSOPOGRAPHY_INDEX_FILE, {
            "rebuilt_at": datetime.now(timezone.utc).isoformat(),
            "entries": entries,
        })

    with _aliases_lock:
        atomic_write_json(PERSON_ALIASES_FILE, aliases_data)


# =========================================================
# LIITMINE (MERGE)
# =========================================================

def merge_person(source_id: str, target_id: str, username: str) -> dict:
    """
    Liidab source kirje target kirjesse.
      - source → record_status=tombstone, merged_into=target_id
      - Relations teistes prosopo kaartides source_id → target_id
      - Teoste _metadata.json creator kirjetes source_id → target_id
      - rebuild_indices() sünkroniseerib kõik kolm read-mudelit
    Tagastab uuendatud target kirje.
    """
    if source_id == target_id:
        raise ValueError("Source ja target ei tohi olla samad.")

    source = get_person(source_id)
    target = get_person(target_id)

    if source is None:
        raise KeyError(source_id)
    if target is None:
        raise KeyError(target_id)
    if source.get("record_status") == "tombstone":
        raise ValueError(f"Source on juba tombstone: {source_id}")
    if target.get("record_status") == "tombstone":
        raise ValueError(f"Target on tombstone, ei saa liita: {target_id}")

    now = datetime.now(timezone.utc).isoformat()

    # 0. Tõsta source andmed target'ile (kui targetil puuduvad)
    target_changed = False

    # Identifikaatorid: tõsta puuduvad skeemid üle
    src_idents = source.get("identifiers") or []
    tgt_idents = target.get("identifiers") or []
    tgt_schemes = {i.get("scheme") for i in tgt_idents}
    added_idents = [i for i in src_idents if i.get("scheme") not in tgt_schemes]
    if added_idents:
        target["identifiers"] = tgt_idents + added_idents
        target_changed = True

    # Haridustee: lisa source kirjed, mida targetil pole (institution+date combo järgi)
    src_edu = source.get("education") or []
    tgt_edu = target.get("education") or []
    if src_edu:
        def _edu_key(e):
            raw = e.get("institution") or ""
            if isinstance(raw, dict):
                inst = raw.get("id") or raw.get("label") or ""
            else:
                inst = str(raw)
            date = (e.get("date_from") or {}).get("date") or ""
            return (inst, date)
        tgt_edu_keys = {_edu_key(e) for e in tgt_edu}
        added_edu = [e for e in src_edu if _edu_key(e) not in tgt_edu_keys]
        if added_edu:
            target["education"] = tgt_edu + added_edu
            target_changed = True

    # Sünni/surma kuupäev: täida tühjad väljad
    for field in ("birth", "death"):
        src_val = source.get(field)
        tgt_val = target.get(field)
        src_date = (src_val or {}).get("date") if isinstance(src_val, dict) else None
        tgt_date = (tgt_val or {}).get("date") if isinstance(tgt_val, dict) else None
        if src_date and not tgt_date:
            target[field] = src_val
            target_changed = True

    # Päritolu: täida tühi väli
    src_origin = source.get("origin") or {}
    tgt_origin = target.get("origin") or {}
    if src_origin.get("place") and not tgt_origin.get("place"):
        target["origin"] = src_origin
        target_changed = True

    # Ametid: lisa puuduvad (id või label järgi)
    src_occs = source.get("occupations") or []
    tgt_occs = target.get("occupations") or []
    if src_occs:
        def _occ_key(o):
            return (o.get("id") or "").strip() or (o.get("label") or "").strip().lower()
        tgt_occ_keys = {_occ_key(o) for o in tgt_occs if _occ_key(o)}
        added_occs = [o for o in src_occs if _occ_key(o) not in tgt_occ_keys]
        if added_occs:
            target["occupations"] = tgt_occs + added_occs
            target_changed = True

    # Elulugu: täida tühi väli
    if source.get("biography") and not target.get("biography"):
        target["biography"] = source["biography"]
        target_changed = True

    # Märkmed: ühenda
    src_notes = (source.get("notes") or "").strip()
    tgt_notes = (target.get("notes") or "").strip()
    if src_notes and src_notes not in tgt_notes:
        target["notes"] = (tgt_notes + "\n\n" + src_notes).strip() if tgt_notes else src_notes
        target_changed = True

    if target_changed:
        target["updated_at"] = now
        target["updated_by"] = username
        atomic_write_json(_id_to_path(target_id), target)

    # 1. Source → tombstone
    source["record_status"] = "tombstone"
    source["merged_into"] = target_id
    source["updated_at"] = now
    source["updated_by"] = username
    atomic_write_json(_id_to_path(source_id), source)

    # 2. Relations teistes kaartides: source_id → target_id
    for fpath in _glob.glob(os.path.join(PROSOPOGRAPHY_DIR, "*.json")):
        if PERSON_IMAGES_DIR_NAME in fpath:
            continue
        try:
            p = json.load(open(fpath, encoding="utf-8"))
        except Exception:
            continue
        if p.get("id") in (source_id, target_id):
            continue
        if p.get("record_status") == "tombstone":
            continue
        changed = False
        for rel in p.get("relations", []):
            if rel.get("target_id") == source_id:
                rel["target_id"] = target_id
                changed = True
        if changed:
            p["updated_at"] = now
            p["updated_by"] = username
            atomic_write_json(fpath, p)

    # 3. Teoste _metadata.json: creator source_id → target_id + git + Meilisearch
    target_label = (target.get("name") or {}).get("label") or source.get("name", {}).get("label", "")
    from ..config import BASE_DIR as _DATA_DIR
    from ..git_ops import save_with_git
    from ..meilisearch_ops import sync_work_to_meilisearch_async
    changed_files = []
    if os.path.exists(_DATA_DIR):
        for work_entry in os.scandir(_DATA_DIR):
            if not work_entry.is_dir():
                continue
            meta_path = os.path.join(work_entry.path, "_metadata.json")
            if not os.path.exists(meta_path):
                continue
            try:
                meta = json.load(open(meta_path, encoding="utf-8"))
            except Exception:
                continue
            changed = False
            for c in meta.get("creators", []):
                if isinstance(c, dict) and c.get("id") == source_id:
                    c["id"] = target_id
                    c["label"] = target_label
                    c["name"] = target_label
                    changed = True
            # tags: source_id → target_id
            for tag in meta.get("tags", []):
                if isinstance(tag, dict) and tag.get("id") == source_id:
                    tag["id"] = target_id
                    tag["label"] = target_label
                    changed = True
            # publisher: source_id → target_id
            pub = meta.get("publisher")
            if isinstance(pub, dict) and pub.get("id") == source_id:
                meta["publisher"]["id"] = target_id
                meta["publisher"]["label"] = target_label
                changed = True
            if changed:
                changed_files.append((meta_path, json.dumps(meta, ensure_ascii=False, indent=2)))

    if changed_files:
        commit_msg = f"Prosopo liitmine: {source_id} → {target_id} ({target_label})"
        primary_path, primary_content = changed_files[0]
        additional = changed_files[1:] if len(changed_files) > 1 else None
        save_with_git(primary_path, primary_content, username,
                      message=commit_msg, additional_files=additional)
        for meta_path, _ in changed_files:
            dir_name = os.path.basename(os.path.dirname(meta_path))
            sync_work_to_meilisearch_async(dir_name)

    # 4. Rebuild — eemaldab source indeksist, uuendab person_to_works
    rebuild_indices()

    return get_person(target_id)


def delete_person(person_id: str, username: str) -> dict:
    """
    Kustutab isikukaardi jäädavalt.
    Blokeerib kui isikul on viited teostes (creators/tags/publisher) või
    teiste isikute relations.
    Tagastab {"deleted": person_id, "work_refs": 0, "relation_refs": 0}.
    """
    person = get_person(person_id)
    if person is None:
        raise KeyError(person_id)
    if person.get("record_status") == "tombstone":
        raise ValueError(f"Isik on tombstone, kasuta merge: {person_id}")

    from ..config import BASE_DIR as _DATA_DIR

    # Kontrolli teose viiteid
    ptw = _load_person_to_works()
    work_refs = len(set(w["work_id"] for w in ptw.get(person_id, [])))
    if work_refs > 0:
        raise ValueError(f"WORK_REFS:{work_refs}")

    # Kontrolli teiste isikute relations viiteid
    relation_refs = 0
    for fpath in _glob.glob(os.path.join(PROSOPOGRAPHY_DIR, "*.json")):
        if PERSON_IMAGES_DIR_NAME in fpath:
            continue
        try:
            p = json.load(open(fpath, encoding="utf-8"))
        except Exception:
            continue
        if p.get("id") == person_id:
            continue
        if p.get("record_status") == "tombstone":
            continue
        for rel in p.get("relations", []):
            if rel.get("target_id") == person_id:
                relation_refs += 1
    if relation_refs > 0:
        raise ValueError(f"RELATION_REFS:{relation_refs}")

    # Kustuta fail
    path = _id_to_path(person_id)
    if os.path.exists(path):
        os.remove(path)

    # Eemalda indeksist ja aliasestest
    with _index_lock:
        index = _load_index()
        index["entries"] = [e for e in index["entries"] if e["id"] != person_id]
        atomic_write_json(PROSOPOGRAPHY_INDEX_FILE, index)

    _remove_aliases_entry(person_id)

    return {"deleted": person_id, "work_refs": 0, "relation_refs": 0}


def _remove_aliases_entry(person_id: str):
    """Eemaldab person_aliases.json-st kõik viited person_id-le."""
    from ..config import DATA_CONFIG_DIR
    aliases_file = os.path.join(DATA_CONFIG_DIR, "person_aliases.json")
    if not os.path.exists(aliases_file):
        return
    try:
        data = json.load(open(aliases_file, encoding="utf-8"))
    except Exception:
        return
    if person_id in data:
        del data[person_id]
        atomic_write_json(aliases_file, data)


def bulk_update_occupation(
    occupation: dict,
    mode: str,
    person_ids: list,
) -> dict:
    """
    Massiga ameti määramine/asendamine mitmele isikule korraga.
    mode='add'     — lisab ameti kui seda veel pole
    mode='replace' — asendab kõik olemasolevad ametid uuega
    """
    updated = 0
    skipped = 0
    occ_id = occupation.get("id")
    occ_label = (occupation.get("label") or "").strip().lower()

    for person_id in person_ids:
        person = get_person(person_id)
        if not person:
            skipped += 1
            continue

        existing = person.get("occupations") or []

        if mode == "replace":
            new_occupations = [occupation]
        else:
            already = any(
                (occ_id and isinstance(item, dict) and item.get("id") == occ_id)
                or (not occ_id and isinstance(item, dict) and (item.get("label") or "").strip().lower() == occ_label)
                for item in existing
            )
            if already:
                skipped += 1
                continue
            new_occupations = list(existing) + [occupation]

        person["occupations"] = new_occupations
        atomic_write_json(_id_to_path(person_id), person)
        _update_index_entry(person)
        updated += 1

    return {"updated": updated, "skipped": skipped, "total": len(person_ids)}
