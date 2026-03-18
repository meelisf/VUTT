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
from ..utils import generate_nanoid

# Jagatud indeksite kirjutuslukkud
_index_lock = threading.Lock()
_works_lock = threading.Lock()
_aliases_lock = threading.Lock()


# =========================================================
# ABIFUNKTSIOONID
# =========================================================

def _atomic_write(path: str, data: dict):
    """Kirjutab JSON faili atomically (tmp + os.replace)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


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
    status_obj = person.get("status") or {}
    confession_obj = person.get("confession") or {}
    name_obj = person.get("name") or {}
    label = name_obj.get("label") or person.get("id", "")
    family_name = name_obj.get("family_name") or ""
    sort_name = family_name or label
    aliases = name_obj.get("aliases") or []

    # birth/death_year — võtame täisarvuna kui date olemas
    def _extract_year(date_obj: dict):
        date_str = date_obj.get("date") or ""
        if date_str and len(date_str) >= 4:
            try:
                return int(date_str[:4])
            except ValueError:
                pass
        return None

    return {
        "id": person["id"],
        "label": label,
        "sort_name": sort_name,
        "birth_year": _extract_year(birth),
        "death_year": _extract_year(death),
        "gender": person.get("gender"),
        "status_id": status_obj.get("id"),
        "status_label": status_obj.get("label"),
        "confession_id": confession_obj.get("id"),
        "has_wikidata": "wikidata" in schemes,
        "has_gnd": "gnd" in schemes,
        "has_aa": "album_academicum" in schemes,
        "record_status": person.get("record_status", "draft"),
        "verification_level": person.get("verification_level", "draft"),
        "work_count": work_count,
        "biography_snippet": _make_snippet(person),
        "image_url": person.get("image_url"),
        "aliases": aliases,
    }


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
        _atomic_write(PROSOPOGRAPHY_INDEX_FILE, index)


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
        _atomic_write(PERSON_ALIASES_FILE, data)


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
        "origin": {"city": None, "region": None, "geonames_id": None, "coordinates": None},
        "status": None,
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
    _atomic_write(_id_to_path(person_id), person)
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
            if isinstance(c, dict) and c.get("id") == person_id and c.get("label") != new_label:
                c["label"] = new_label
                c["name"] = new_label
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

    _atomic_write(_id_to_path(person_id), person)
    _update_index_entry(person)
    _update_aliases_entry(person)

    new_label = (person.get("name") or {}).get("label") or ""
    if new_label and new_label != old_label:
        _propagate_name_to_works(person_id, new_label, username)

    return person


def list_persons(
    q: Optional[str] = None,
    gender: Optional[str] = None,
    status_id: Optional[str] = None,
    source: Optional[str] = None,
    verification_level: Optional[str] = None,
) -> list:
    """
    Tagastab prosopography_index.json kirjed filtreeritult.
    Otsing q= töötab label + sort_name vastu (väiketähelistena).
    """
    index = _load_index()
    results = [
        e for e in index.get("entries", [])
        if e.get("record_status") != "tombstone"
    ]

    if q:
        q_lower = q.lower()
        results = [
            e for e in results
            if q_lower in (e.get("label") or "").lower()
            or q_lower in (e.get("sort_name") or "").lower()
            or any(q_lower in a.lower() for a in (e.get("aliases") or []))
        ]
    if gender:
        results = [e for e in results if e.get("gender") == gender]
    if status_id:
        results = [e for e in results if e.get("status_id") == status_id]
    if verification_level:
        results = [e for e in results if e.get("verification_level") == verification_level]
    if source:
        source_map = {"wikidata": "has_wikidata", "gnd": "has_gnd", "aa": "has_aa"}
        field = source_map.get(source)
        if field:
            results = [e for e in results if e.get(field)]

    results.sort(key=lambda e: (e.get("sort_name") or "").lower())
    return results


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
    _atomic_write(_id_to_path(person_id), person)
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
    _atomic_write(_id_to_path(person_id), person)
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
    _atomic_write(_id_to_path(person_id), person)
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
    _atomic_write(_id_to_path(person_id), person)
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

        _atomic_write(PERSON_TO_WORKS_FILE, data)


# =========================================================
# INDEKSITE TAASTAMINE
# =========================================================

def rebuild_indices():
    """
    Taastab kõik kolm read-modeli nullist:
      1. prosopography_index.json
      2. person_aliases.json
      3. person_to_works.json (teoste _metadata.json põhjal)
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

    # Kirjuta person_to_works
    with _works_lock:
        _atomic_write(PERSON_TO_WORKS_FILE, ptw)

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
        _atomic_write(PROSOPOGRAPHY_INDEX_FILE, {
            "rebuilt_at": datetime.now(timezone.utc).isoformat(),
            "entries": entries,
        })

    with _aliases_lock:
        _atomic_write(PERSON_ALIASES_FILE, aliases_data)


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

    # 0. Tõsta source identifikaatorid target'ile (skeemid, mis target'il puuduvad)
    src_idents = source.get("identifiers") or []
    tgt_idents = target.get("identifiers") or []
    tgt_schemes = {i.get("scheme") for i in tgt_idents}
    added_idents = [i for i in src_idents if i.get("scheme") not in tgt_schemes]
    if added_idents:
        target["identifiers"] = tgt_idents + added_idents
        target["updated_at"] = now
        target["updated_by"] = username
        _atomic_write(_id_to_path(target_id), target)

    # 1. Source → tombstone
    source["record_status"] = "tombstone"
    source["merged_into"] = target_id
    source["updated_at"] = now
    source["updated_by"] = username
    _atomic_write(_id_to_path(source_id), source)

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
            _atomic_write(fpath, p)

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
