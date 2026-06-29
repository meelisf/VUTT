"""Isikukaartide CRUD ja seotud abifunktsioonid."""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from typing import Optional

from . import _legacy_ops as legacy
from . import state
from ._compat import sync_from_facade
from .locks import person_lock

# Lubatud nanoid-märgid: generate_nanoid annab [a-z0-9], lubame ka legacy variandid
# (A-Z, _, -). EI sisalda path-ohtlikke märke (., /, \) → kaitseb path traversal'i eest.
_NANOID_RE = re.compile(r"^[A-Za-z0-9_-]+$")


def _safe_nanoid(person_id: str) -> str:
    """vutt:Pabc123 → abc123; valideerib path traversal'i vastu."""
    nanoid = person_id.removeprefix("vutt:P")
    if not _NANOID_RE.match(nanoid):
        raise ValueError(f"Vigane person_id: {person_id!r}")
    return nanoid


def _id_to_path(person_id: str) -> str:
    """vutt:Pabc123 → data/config/prosopography/abc123.json"""
    sync_from_facade()
    nanoid = _safe_nanoid(person_id)
    path = os.path.join(state.PROSOPOGRAPHY_DIR, f"{nanoid}.json")
    # Kaitse sügavuti: lahendatud tee peab jääma PROSOPOGRAPHY_DIR sisse.
    if os.path.commonpath([os.path.realpath(path), os.path.realpath(state.PROSOPOGRAPHY_DIR)]) != os.path.realpath(state.PROSOPOGRAPHY_DIR):
        raise ValueError(f"person_id lahendub väljapoole prosopograafia kausta: {person_id!r}")
    return path


def _strip_markup(text: str) -> str:
    """Eemaldab VUTT XML-tägid biography_snippet jaoks."""
    if not text:
        return ""
    return re.sub(r"<[^>]+>", "", text).strip()


def _make_snippet(person: dict) -> str:
    biography = person.get("biography") or person.get("notes") or ""
    return _strip_markup(biography)[:120]


def get_person(person_id: str) -> Optional[dict]:
    """Laeb isiku faili. Tagastab None kui ei leitud või kui ID on vigane."""
    sync_from_facade()
    try:
        path = legacy._id_to_path(person_id)
    except ValueError:
        return None
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def create_person(data: dict, username: str) -> dict:
    """Loob uue prosopograafia kirje."""
    sync_from_facade()
    nanoid = state.generate_nanoid()
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

    os.makedirs(state.PROSOPOGRAPHY_DIR, exist_ok=True)
    name = (person.get("name") or {}).get("label") or person_id
    state.save_with_git(
        legacy._id_to_path(person_id),
        json.dumps(person, ensure_ascii=False, indent=2),
        username,
        message=f"Prosopo loomine: {name} [{person_id}]",
    )
    legacy._update_index_entry(person)
    legacy._update_aliases_entry(person)
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
    """Uuendab teoste _metadata.json creator/tag/publisher labelid kui nimi muutus."""
    # Import siin säilitab vana testitava käitumise: patch("server.config.BASE_DIR")
    # ja patch("server.git_ops.save_with_git") mõjutavad seda helperit.
    from ..config import BASE_DIR as data_dir
    from ..git_ops import save_with_git

    sync_from_facade()
    if not os.path.exists(data_dir):
        return

    changed_files = []
    for work_entry in os.scandir(data_dir):
        if not work_entry.is_dir():
            continue
        meta_path = os.path.join(work_entry.path, "_metadata.json")
        if not os.path.exists(meta_path):
            continue
        try:
            with open(meta_path, encoding="utf-8") as f:
                meta = json.load(f)
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

    from ..meilisearch_ops import sync_work_to_meilisearch_async
    for meta_path, _ in changed_files:
        dir_name = os.path.basename(os.path.dirname(meta_path))
        sync_work_to_meilisearch_async(dir_name)


def update_person(person_id: str, data: dict, username: str) -> dict:
    """Uuendab isiku kirjet optimistliku konkurentsikontrolliga."""
    sync_from_facade()
    with person_lock(person_id):
        person = legacy.get_person(person_id)
        if person is None:
            raise KeyError(person_id)

        client_updated_at = data.get("updated_at")
        if client_updated_at and person.get("updated_at") != client_updated_at:
            raise ValueError(f"conflict:{person['updated_at']}")

        old_label = (person.get("name") or {}).get("label") or ""

        now = datetime.now(timezone.utc).isoformat()
        for key in ("id", "created_at", "created_by", "schema_version",
                    "import_batch_ids", "merged_into", "auth_token", "token"):
            data.pop(key, None)

        person.update(data)
        person["updated_at"] = now
        person["updated_by"] = username

        origin = person.get("origin") or {}
        if origin.get("place"):
            try:
                person["origin"] = state._enrich_origin_from_places(origin)
            except ValueError:
                state.logger.warning("Tundmatu päritolukoht: %r — place tühjendatakse", origin.get("place"))
                person["origin"] = {**origin, "place": None, "place_id": None, "place_labels": None}

        name = (person.get("name") or {}).get("label") or person_id
        state.save_with_git(
            legacy._id_to_path(person_id),
            json.dumps(person, ensure_ascii=False, indent=2),
            username,
            message=f"Prosopo muudatus: {name} [{person_id}]",
        )
    legacy._update_index_entry(person)
    legacy._update_aliases_entry(person)

    new_label = (person.get("name") or {}).get("label") or ""
    if new_label and new_label != old_label:
        legacy._propagate_name_to_works(person_id, new_label, username)

    return person


def add_identifier(person_id: str, scheme: str, ext_id: str, username: str) -> tuple:
    """Lisab identifikaatori ja käivitab rikastuse."""
    from .enrichment import fetch_and_diff

    sync_from_facade()
    with person_lock(person_id):
        person = legacy.get_person(person_id)
        if person is None:
            raise KeyError(person_id)

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
        name = (person.get("name") or {}).get("label") or person_id
        state.save_with_git(
            legacy._id_to_path(person_id),
            json.dumps(person, ensure_ascii=False, indent=2),
            username,
            message=f"Prosopo identifikaator: {name} [{person_id}]",
        )
    legacy._update_index_entry(person)
    legacy._update_aliases_entry(person)
    return person, diff


def _person_image_path(person_id: str, ext: str) -> str:
    """Tagastab isiku pildi failitee (state/prosopography/images/ — ei ole gitis)."""
    sync_from_facade()
    nanoid = _safe_nanoid(person_id)
    path = os.path.join(state.PROSOPOGRAPHY_IMAGES_DIR, f"{nanoid}{ext}")
    if os.path.commonpath([os.path.realpath(path), os.path.realpath(state.PROSOPOGRAPHY_IMAGES_DIR)]) != os.path.realpath(state.PROSOPOGRAPHY_IMAGES_DIR):
        raise ValueError(f"person_id lahendub väljapoole piltide kausta: {person_id!r}")
    return path


def upload_person_image(person_id: str, file_bytes: bytes, content_type: str, username: str) -> dict:
    """Salvestab isiku pildi ja uuendab image_url kirjes."""
    sync_from_facade()
    person = legacy.get_person(person_id)
    if person is None:
        raise KeyError(person_id)

    if content_type not in ("image/jpeg", "image/png", "image/webp"):
        raise ValueError("Toetatud formaadid: JPEG, PNG, WebP")

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

    for old_ext in (".jpg", ".webp"):
        old_path = _person_image_path(person_id, old_ext)
        if old_path.endswith(ext):
            continue
        if os.path.exists(old_path):
            os.remove(old_path)

    os.makedirs(state.PROSOPOGRAPHY_IMAGES_DIR, exist_ok=True)
    img_path = _person_image_path(person_id, ext)
    with open(img_path, "wb") as f:
        f.write(file_bytes)

    encoded_id = person_id.replace(":", "%3A")
    person["image_url"] = f"/api/files/prosopography/{encoded_id}/image"

    now = datetime.now(timezone.utc).isoformat()
    person["updated_at"] = now
    person["updated_by"] = username
    state.atomic_write_json(legacy._id_to_path(person_id), person)
    legacy._update_index_entry(person)
    return person


def get_person_image_path(person_id: str) -> Optional[str]:
    """Tagastab isiku pildi failitee kui olemas, muidu None (ka vigase ID korral)."""
    try:
        for ext in (".jpg", ".webp"):
            path = _person_image_path(person_id, ext)
            if os.path.exists(path):
                return path
    except ValueError:
        return None
    return None


def delete_person_image(person_id: str, username: str) -> dict:
    """Kustutab isiku pildi ja tühjendab image_url. Tagastab uuendatud kirje."""
    sync_from_facade()
    person = legacy.get_person(person_id)
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
    state.atomic_write_json(legacy._id_to_path(person_id), person)
    legacy._update_index_entry(person)
    return person


def apply_enrichment(person_id: str, approved: dict, username: str) -> dict:
    """Rakendab kasutaja kinnitatud rikastusmuudatused."""
    def _deep_set(obj: dict, path: str, value):
        parts = path.split(".", 1)
        if len(parts) == 1:
            obj[parts[0]] = value
        else:
            if parts[0] not in obj or not isinstance(obj[parts[0]], dict):
                obj[parts[0]] = {}
            _deep_set(obj[parts[0]], parts[1], value)

    sync_from_facade()
    with person_lock(person_id):
        person = legacy.get_person(person_id)
        if person is None:
            raise KeyError(person_id)

        for field_path, value in approved.items():
            _deep_set(person, field_path, value)

        scheme = approved.get("_enrichment_scheme")
        if scheme:
            for ident in person.get("identifiers") or []:
                if ident.get("scheme") == scheme:
                    ident["checked_at"] = datetime.now(timezone.utc).date().isoformat()

        now = datetime.now(timezone.utc).isoformat()
        person["updated_at"] = now
        person["updated_by"] = username
        name = (person.get("name") or {}).get("label") or person_id
        state.save_with_git(
            legacy._id_to_path(person_id),
            json.dumps(person, ensure_ascii=False, indent=2),
            username,
            message=f"Prosopo rikastus: {name} [{person_id}]",
        )
    legacy._update_index_entry(person)
    legacy._update_aliases_entry(person)
    return person


def _find_by_external_id(scheme: str, ext_id: str) -> Optional[dict]:
    """Otsib prosopo kaarti välise identifikaatori (scheme + id) järgi."""
    sync_from_facade()
    for fpath in state._glob.glob(os.path.join(state.PROSOPOGRAPHY_DIR, "*.json")):
        if state.PERSON_IMAGES_DIR_NAME in fpath:
            continue
        try:
            with open(fpath, encoding="utf-8") as f:
                p = json.load(f)
        except Exception:
            continue
        if p.get("record_status") == "tombstone":
            continue
        for ident in p.get("identifiers") or []:
            if ident.get("scheme") == scheme and ident.get("id") == ext_id:
                return p
    return None


def ensure_prosopo_for_entity(entity: dict, username: str) -> dict:
    """Tagab, et LinkedEntity objektil on vutt:P ID."""
    if not isinstance(entity, dict):
        return entity
    eid = (entity.get("id") or "").strip()
    if eid.startswith("vutt:P") or not eid:
        return entity

    source = (entity.get("source") or "").lower()
    if source not in ("wikidata", "gnd", "viaf"):
        return entity

    scheme = source
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
    """Asendab creators/tags/publisher Wikidata/GND/VIAF ID-d vutt:P ID-dega."""
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
    sync_from_facade()
    updated = 0
    skipped = 0
    occ_id = occupation.get("id")
    occ_label = (occupation.get("label") or "").strip().lower()

    for person_id in person_ids:
        # Per-isiku lukk: read-modify-write serialiseerimine iga isiku kohta.
        with person_lock(person_id):
            person = legacy.get_person(person_id)
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
            state.atomic_write_json(legacy._id_to_path(person_id), person)
            legacy._update_index_entry(person)
            updated += 1

    return {"updated": updated, "skipped": skipped, "total": len(person_ids)}


__all__ = ['_safe_nanoid', '_id_to_path', '_strip_markup', '_make_snippet', 'get_person', 'create_person', '_make_date_obj', '_propagate_name_to_works', 'update_person', 'add_identifier', '_person_image_path', 'upload_person_image', 'get_person_image_path', 'delete_person_image', 'apply_enrichment', '_find_by_external_id', 'ensure_prosopo_for_entity', 'ensure_prosopo_stubs', 'bulk_update_occupation']
