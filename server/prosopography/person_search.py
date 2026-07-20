"""Isikute otsing, filtrid ja fassetid."""
from __future__ import annotations

import json
import os
from typing import Optional

from . import state
from .indices import ACADEMIA_INSTITUTION_NAMES, _load_index, _persons_in_collection, _person_collections
from .person_crud import _make_snippet, get_person
from .relations import get_person_relation_network_ids
from ._compat import sync_from_facade


def _load_person_aliases() -> dict:
    sync_from_facade()
    if os.path.exists(state.PERSON_ALIASES_FILE):
        try:
            with open(state.PERSON_ALIASES_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


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
    sync_from_facade()
    person = get_person(person_id)
    if not person:
        return []
    return _extract_occupation_entries(person)


def _entry_matches_year_range(entry: dict, year_from: Optional[int], year_to: Optional[int]) -> bool:
    lower = year_from if year_from is not None else -10**9
    upper = year_to if year_to is not None else 10**9

    def year_in_range(value) -> bool:
        return isinstance(value, int) and lower <= value <= upper

    if year_in_range(entry.get("birth_year")):
        return True
    if year_in_range(entry.get("death_year")):
        return True
    if year_in_range(entry.get("imm_year")):
        return True

    floruit_from = entry.get("floruit_year_from")
    floruit_to = entry.get("floruit_year_to")
    if isinstance(floruit_from, int) and isinstance(floruit_to, int):
        return floruit_from <= upper and floruit_to >= lower
    if year_in_range(floruit_from):
        return True
    if year_in_range(floruit_to):
        return True

    return False


def _filter_index_entries(
    q: Optional[str] = None,
    gender: Optional[str] = None,
    occupation: Optional[str] = None,
    origin_group: Optional[str] = None,
    origin_place: Optional[str] = None,
    institution: Optional[str] = None,
    status_id: Optional[str] = None,
    source: Optional[str] = None,
    verification_level: Optional[str] = None,
    year_from: Optional[int] = None,
    year_to: Optional[int] = None,
    imm_year_from: Optional[int] = None,
    imm_year_to: Optional[int] = None,
    ids: Optional[list] = None,
) -> list[dict]:
    sync_from_facade()
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
    if origin_place:
        results = [e for e in results if e.get("origin_place") == origin_place]
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
    if year_from is not None or year_to is not None:
        results = [e for e in results if _entry_matches_year_range(e, year_from, year_to)]
    if imm_year_from is not None:
        results = [e for e in results if (e.get("imm_year") or 0) >= imm_year_from]
    if imm_year_to is not None:
        results = [e for e in results if (e.get("imm_year") or 0) <= imm_year_to]

    return results


def list_persons(
    q: Optional[str] = None,
    gender: Optional[str] = None,
    occupation: Optional[str] = None,
    origin_group: Optional[str] = None,
    origin_place: Optional[str] = None,
    institution: Optional[str] = None,
    status_id: Optional[str] = None,
    source: Optional[str] = None,
    verification_level: Optional[str] = None,
    year_from: Optional[int] = None,
    year_to: Optional[int] = None,
    imm_year_from: Optional[int] = None,
    imm_year_to: Optional[int] = None,
    sort_by: Optional[str] = None,
    ids: Optional[list] = None,
    collection: Optional[str] = None,
    limit: int = 48,
    offset: int = 0,
) -> dict:
    """Tagastab prosopography_index.json kirjed filtreeritult, pagineeritult."""
    sync_from_facade()
    if collection:
        collection_ids = _persons_in_collection(collection)
        if ids is not None:
            ids = [i for i in ids if i in collection_ids]
        else:
            ids = list(collection_ids)

    results = _filter_index_entries(
        q=q,
        gender=gender,
        occupation=occupation,
        origin_group=origin_group,
        origin_place=origin_place,
        institution=institution,
        status_id=status_id,
        source=source,
        verification_level=verification_level,
        year_from=year_from,
        year_to=year_to,
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


def get_person_map_markers(
    q: Optional[str] = None,
    gender: Optional[str] = None,
    occupation: Optional[str] = None,
    origin_group: Optional[str] = None,
    institution: Optional[str] = None,
    status_id: Optional[str] = None,
    source: Optional[str] = None,
    verification_level: Optional[str] = None,
    year_from: Optional[int] = None,
    year_to: Optional[int] = None,
    imm_year_from: Optional[int] = None,
    imm_year_to: Optional[int] = None,
    ids: Optional[list] = None,
    related_to: Optional[str] = None,
    collection: Optional[str] = None,
) -> dict:
    """Tagastab koordinaadiga isikud grupeerituna päritolukoha markeriteks."""
    sync_from_facade()
    if related_to:
        network_ids = get_person_relation_network_ids(related_to)
        ids = list(dict.fromkeys([*(ids or []), *network_ids])) if ids else network_ids

    if collection:
        collection_ids = _persons_in_collection(collection)
        if ids is not None:
            ids = [i for i in ids if i in collection_ids]
        else:
            ids = list(collection_ids)

    entries = _filter_index_entries(
        q=q,
        gender=gender,
        occupation=occupation,
        origin_group=origin_group,
        institution=institution,
        status_id=status_id,
        source=source,
        verification_level=verification_level,
        year_from=year_from,
        year_to=year_to,
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
    response = {
        "markers": markers,
        "total_persons": len(entries),
        "mapped_persons": sum(m["count"] for m in markers),
        "without_coordinates": without_coordinates,
    }
    if related_to:
        focus_label = next(
            (e.get("label") for e in _load_index().get("entries", []) if e.get("id") == related_to),
            None,
        )
        response["focus"] = {
            "id": related_to,
            "label": focus_label,
            "collections": _person_collections(related_to),
        }
    return response


def get_person_facets(
    q: Optional[str] = None,
    gender: Optional[str] = None,
    ids: Optional[list] = None,
    collection: Optional[str] = None,
) -> dict:
    """Tagastab persons-listingu jaoks facetid."""
    sync_from_facade()
    filtered = list_persons(
        q=q,
        gender=gender,
        ids=ids,
        collection=collection,
        limit=10**9,
        offset=0,
    )["results"]

    groups_config = state._load_origin_groups()

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


def _index_entry_from_person(person: dict, work_count: int = 0) -> dict:
    """Ehitab prosopography_index.json kirje isiku täisandmetest."""
    sync_from_facade()
    birth = person.get("birth") or {}
    death = person.get("death") or {}
    identifiers = person.get("identifiers") or []
    schemes = {i.get("scheme") for i in identifiers}
    _statuses_list = person.get("statuses")
    if _statuses_list is None:
        _legacy_status = person.get("status") or {}
        _statuses_list = [{"id": _legacy_status["id"], "label": _legacy_status.get("label", "")}] if _legacy_status.get("id") else []
    _confessions_list = person.get("confessions")
    if _confessions_list is None:
        _conf_legacy = person.get("confession") or {}
        _confessions_list = [{"id": _conf_legacy["id"], "label": _conf_legacy.get("label", "")}] if _conf_legacy.get("id") else []
    name_obj = person.get("name") or {}
    label = name_obj.get("label") or person.get("id", "")
    family_name = name_obj.get("family_name") or ""
    if family_name:
        sort_name = family_name
    else:
        qualifier = (name_obj.get("qualifier") or "").strip().lower()
        words = label.split()
        if qualifier and words and words[-1].lower() == qualifier:
            words = words[:-1]
        sort_name = words[-1] if len(words) > 1 else label
    aliases = name_obj.get("aliases") or []
    occupations = _extract_occupation_entries(person)

    education_institutions = list(dict.fromkeys(
        e["institution"] for e in (person.get("education") or [])
        if e.get("institution")
    ))

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
    def _extract_edu_date(edu: dict) -> str:
        return (edu.get("date_from") or {}).get("date") or edu.get("date_start") or ""

    def _earliest_dated_education(entries: list[dict]) -> tuple[Optional[int], Optional[str]]:
        dated_entries: list[tuple[str, int]] = []
        for edu in entries:
            date_str = _extract_edu_date(edu)
            if len(date_str) >= 4:
                try:
                    year = int(date_str[:4])
                except ValueError:
                    continue
                dated_entries.append((date_str, year))
        if not dated_entries:
            return None, None
        date_str, year = min(dated_entries, key=lambda item: item[0])
        return year, date_str

    ag_entries = [
        edu for edu in (person.get("education") or [])
        if edu.get("institution") in ACADEMIA_INSTITUTION_NAMES
    ]
    imm_year, imm_date = _earliest_dated_education(ag_entries)

    if imm_year is None:
        aa_entries = [
            edu for edu in (person.get("education") or [])
            if edu.get("source") == "album_academicum"
        ]
        imm_year, imm_date = _earliest_dated_education(aa_entries)

    origin = person.get("origin") or {}
    place_key = origin.get("place") or None
    place_id = origin.get("place_id") or None
    origin_group = state._resolve_origin_group(place_id, place_key)
    origin_parent = state._get_parent_place(place_key)
    origin_place_labels = state._get_place_labels(place_key)
    origin_coordinates = state._get_place_coordinates(place_key)
    origin_group_labels: Optional[dict] = None
    if origin_group:
        groups_cfg = state._load_origin_groups()
        origin_group_labels = groups_cfg.get(origin_group, {}).get("labels")

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

    floruit = person.get("floruit") or {}
    floruit_year_from = floruit.get("year_from")
    floruit_year_to = floruit.get("year_to")

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
        "floruit_year_from": floruit_year_from if isinstance(floruit_year_from, int) else None,
        "floruit_year_to": floruit_year_to if isinstance(floruit_year_to, int) else None,
        "record_status": person.get("record_status", "draft"),
        "merged_into": person.get("merged_into"),
        "verification_level": person.get("verification_level", "draft"),
        "updated_at": person.get("updated_at"),
        "work_count": work_count,
        "biography_snippet": _make_snippet(person),
        "image_url": person.get("image_url"),
        "aliases": aliases,
        "occupations": occupations,
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


__all__ = ['list_persons', '_filter_index_entries', '_entry_matches_year_range', 'get_person_map_markers', 'get_person_facets', '_load_person_aliases', '_index_entry_from_person', '_extract_occupation_entries', '_entry_occupations']
