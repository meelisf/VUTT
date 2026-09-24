"""Isikukaartide CRUD ja seotud abifunktsioonid."""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from typing import Optional

from . import state
from . import ext_id_index
from ._compat import sync_from_facade
from .ext_ids import normalize_ext_id
from .locks import ext_id_claim_lock, person_lock
from ..entity_labels_ops import fill_person_labels_from_registry
from ..prosopo_biography_fields import (
    AA_RAW, ANCHOR_FIELDS, ANCHOR_OF, ANCHOR_SOURCE, BIOGRAPHY_EN, BIOGRAPHY_ET,
    LEGACY_BIOGRAPHY, SRC_EN, SRC_ET, text_hash,
)


def _normalize_identifiers(identifiers) -> list:
    """Taandab välised ID-d kanoonilisele kujule ja eemaldab tekkinud kordused (#240).

    Vorming tuli varem otse kliendilt (`GND:123` vs `123`), mis lõhkus nii
    rikastuse URL-i kui dublikaadikontrolli — vt `ext_ids.normalize_ext_id`.
    """
    if not isinstance(identifiers, list):
        return identifiers
    out = []
    seen = set()
    for ident in identifiers:
        if not isinstance(ident, dict):
            out.append(ident)
            continue
        scheme = ident.get("scheme")
        ext_id = normalize_ext_id(scheme, ident.get("id"))
        if not ext_id:
            continue
        key = (scheme, ext_id)
        if key in seen:
            continue
        seen.add(key)
        out.append({**ident, "id": ext_id})
    return out


def _indices():
    """Hilinenud import väldib CRUD/index moodulite import-tsüklit."""
    from . import indices
    return indices


# Sessioonitokenid, mis on kunagi PUT-keha kaudu kaardile salvestunud (#237).
# Filtreeritakse NII kirjutamisel (update_person) kui lugemisel (get_person) —
# kirjutusteel üksi ei puhasta juba salvestatud kirjeid.
SECRET_FIELDS = ("auth_token", "token")


# Serveri väljad (ADR 0048): kliendi saadetud väärtus visatakse ALATI ära —
# nii võti ise kui iga väljarada `võti.…` (apply_enrichment kirjutab radu).
# Muudavad ainult loomine, taustarikastus ja admini kinnitus.
SERVER_FIELDS = ("review",)


def strip_server_fields(data: dict) -> dict:
    """Koopia ilma serveriväljadeta. Kõik kliendi kirjutusteed kutsuvad seda."""
    return {
        k: v for k, v in (data or {}).items()
        if not any(k == f or k.startswith(f + ".") for f in SERVER_FIELDS)
    }


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


def _save_person_locked(person: dict, username: str, message: str) -> None:
    """Kaardi salvestus + väliste ID-de indeks SAMAS kriitilises sektsioonis (ADR 0048).

    Kutsuja PEAB hoidma `person_lock(person["id"])`-i (ID-lisavas teel ka
    `ext_id_claim_lock`-i). Indeks uuendatakse just salvestatud koopiast — pärast
    luku vabastamist tehtud uuendus võiks kirjutada aegunud ID-loendi tagasi ja
    kustutada vahepeal teise tee lisatud ID (spekk §4.6).
    """
    state.save_with_git(
        _id_to_path(person["id"]),
        json.dumps(person, ensure_ascii=False, indent=2),
        username,
        message=message,
    )
    ext_id_index.update_for_person(person)


# Markdowni süntaks, mis tuleb snippetist välja võtta. Biograafia on Markdown
# (ADR 0008), snippet läheb kaardile lihttekstina — ilma selle sammuta jõudis
# `**Carl Lund**` ekraanile toorelt (#240).
#
# Kaks asja, mida SIIN korpuses ei tohi ära rikkuda:
#   `*1617`  — tärn on sünnisümbol, mitte rõhutuse algus (nõuame tähte järel);
#   `1759.`  — rea alguses on aastaarv, mitte loendimarker (nummerdatud
#              loendi markerit seetõttu EI eemaldata, vrd
#              `escapeAccidentalOrderedLists` frontendis).
_MD_ASENDUSED = (
    (re.compile(r"!\[([^\]]*)\]\([^)]*\)"), r"\1"),                    # pilt
    (re.compile(r"\[([^\]]+)\]\([^)]*\)"), r"\1"),                     # link
    (re.compile(r"`([^`\n]+)`"), r"\1"),                                 # koodijupp
    (re.compile(r"\*\*([^\n]+?)\*\*"), r"\1"),                          # **paks**
    (re.compile(r"__([^\n]+?)__"), r"\1"),                               # __paks__
    (re.compile(r"~~([^\n]+?)~~"), r"\1"),                               # ~~maha~~
    (re.compile(r"\*(?=[^\W\d_])([^*\n]*?)(?<=\S)\*"), r"\1"),          # *kaldu*
    (re.compile(r"(?<!\w)_(?=[^\W\d_])([^_\n]*?)(?<=\S)_(?!\w)"), r"\1"),  # _kaldu_
    (re.compile(r"^\s{0,3}#{1,6}\s+", re.M), ""),                        # pealkiri
    (re.compile(r"^\s{0,3}>\s?", re.M), ""),                             # tsitaat
    (re.compile(r"^\s{0,3}[-+*]\s+", re.M), ""),                         # loendirida
)


def _strip_markup(text: str) -> str:
    """Taandab biograafia/märkmed lihttekstiks biography_snippet jaoks.

    Eemaldab nii VUTT XML-tägid kui Markdowni süntaksi ja lamedab
    reavahetused tühikuks — snippet on kaardil ühel real.
    """
    if not text:
        return ""
    out = re.sub(r"<[^>]+>", "", text)
    for pattern, repl in _MD_ASENDUSED:
        out = pattern.sub(repl, out)
    return re.sub(r"\s+", " ", out).strip()


SNIPPET_LENGTH = 120

# Katke allikas → indeksi võtmenimi. Iga katke on tuletatud TÄPSELT ÜHEST
# väljast; varuvariandi valib vaade (ADR 0039, spekk otsus 6).
_SNIPPET_SOURCES = (
    (BIOGRAPHY_ET, "biography_snippet_et"),
    (BIOGRAPHY_EN, "biography_snippet_en"),
    ("notes", "notes_snippet"),
    (AA_RAW, "aa_snippet"),
)


def _make_snippets(person: dict) -> dict:
    """Neli katget, igaüks ühest väljast. Puuduv allikas → tühi string."""
    return {
        key: _strip_markup(person.get(field) or "")[:SNIPPET_LENGTH]
        for field, key in _SNIPPET_SOURCES
    }


def get_person(person_id: str) -> Optional[dict]:
    """Laeb isiku faili. Tagastab None kui ei leitud või kui ID on vigane.

    Salajased väljad filtreeritakse LUGEMISEL (#237) — avalik
    `GET /prosopography/{id}` tagastab selle tulemuse otse. Failis olevat
    väärtust ei muudeta; salvestatud kirjed puhastab `scripts/strip_person_auth_tokens.py`.
    """
    sync_from_facade()
    try:
        path = _id_to_path(person_id)
    except ValueError:
        return None
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            person = json.load(f)
    except Exception:
        return None
    if isinstance(person, dict):
        for key in SECRET_FIELDS:
            person.pop(key, None)
    return person


def _new_person_skeleton(data: dict, username: str) -> dict:
    """Uue kaardi põhi (ei salvesta). Väljade kuju on sama mis create_person-il."""
    nanoid = state.generate_nanoid()
    person_id = f"vutt:P{nanoid}"
    now = datetime.now(timezone.utc).isoformat()
    person = {
        "id": person_id,
        "identifiers": _normalize_identifiers(data.get("identifiers", [])),
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
        BIOGRAPHY_ET: None,
        BIOGRAPHY_EN: None,
        AA_RAW: None,
        SRC_ET: None,
        SRC_EN: None,
        "notes": data.get("notes"),
        "image_url": None,
        "source_data": {},
    }
    return person


def create_person(data: dict, username: str) -> dict:
    """Madala taseme loomine (ilma ID-kontrolli ja ülevaatusmärketa). Kutsujad:
    ainult testid — tootmiskood kutsub `create_person_checked`-i."""
    sync_from_facade()
    person = _new_person_skeleton(data, username)
    os.makedirs(state.PROSOPOGRAPHY_DIR, exist_ok=True)
    fill_person_labels_from_registry(person)
    name = (person.get("name") or {}).get("label") or person["id"]
    with person_lock(person["id"]):
        _save_person_locked(person, username, f"Prosopo loomine: {name} [{person['id']}]")
    _indices()._update_index_entry(person)
    _indices()._update_aliases_entry(person)
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


def _apply_card_update(person: dict, data: dict, now: str) -> None:
    """Kliendi kaardisisu rakendamine (update_person JA create_person_checked).

    Viskab kliendi saadetud serveriväljad, ankrud ja pärandvälja ära;
    normaliseerib ID-d; kinnitab tõlke; rikastab päritolukoha. Muteerib
    `person`-it.
    """
    for key in ("id", "created_at", "created_by", "schema_version",
                "import_batch_ids", "merged_into") + SECRET_FIELDS:
        data.pop(key, None)

    # Ankur on SERVERI TULETIS: kliendi saadetu visatakse alati ära, nagu
    # `id` ja `created_at`. Lubadus, et uus frontend seda ei saada, ei ole
    # kaitse (spekk, „Avaliku API üleminek").
    for key in ANCHOR_FIELDS:
        data.pop(key, None)

    # Kinnitusruut („Vastab eestikeelsele tekstile"). Ajutine võti — kaardile
    # ei jõua. Väärtus on sihtväljade loend: `biography_en` tähendab, et
    # kinnitatakse `biography_en` vastavust `biography_et`-le.
    confirm = data.pop("_confirm_translation", None) or []

    # Pärandväli: vana avatud vorm saadab `biography` tagasi ja tekitaks
    # välja uuesti ka pärast migratsiooni passi B.
    if LEGACY_BIOGRAPHY in data:
        saadetud = data.pop(LEGACY_BIOGRAPHY)
        salvestatud = person.get(LEGACY_BIOGRAPHY)
        if (saadetud or None) != (salvestatud or None):
            # Vaikne teisendus `biography_et`-sse võiks üle kirjutada teksti,
            # mida uus vorm vahepeal muutis — seepärast 409, mitte parandus.
            raise ValueError("legacy_biography_changed")

    if "identifiers" in data:
        data["identifiers"] = _normalize_identifiers(data["identifiers"])
    person.update(data)

    # Ankur on serveri tuletis: räsi arvutatakse SIIN, salvestatava seisu
    # pealt. Klient räsi ei saada (vt ANCHOR pop ülal).
    for field in (BIOGRAPHY_ET, BIOGRAPHY_EN):
        anchor_field = ANCHOR_OF[field]
        if field in confirm:
            source_text = (person.get(ANCHOR_SOURCE[anchor_field]) or "").strip()
            if not source_text:
                raise ValueError("confirm_without_source")
            person[anchor_field] = {"hash": text_hash(source_text), "at": now}
        elif not (person.get(field) or "").strip():
            # Tühjaks jäänud tekstil ei ole midagi kinnitada — jäänud ankur
            # tekitaks hoiatuse tekstile, mida ei ole.
            person[anchor_field] = None

    origin = person.get("origin") or {}
    if origin.get("place"):
        try:
            person["origin"] = state._enrich_origin_from_places(origin)
        except ValueError:
            state.logger.warning("Tundmatu päritolukoht: %r — place tühjendatakse", origin.get("place"))
            person["origin"] = {**origin, "place": None, "place_id": None, "place_labels": None}


def update_person(person_id: str, data: dict, username: str) -> dict:
    """Uuendab isiku kirjet optimistliku konkurentsikontrolliga."""
    sync_from_facade()
    from contextlib import nullcontext
    claim = ext_id_claim_lock if "identifiers" in data else nullcontext()
    with claim, person_lock(person_id):
        person = get_person(person_id)
        if person is None:
            raise KeyError(person_id)

        data = strip_server_fields(data)

        client_updated_at = data.get("updated_at")
        if not isinstance(client_updated_at, str) or not client_updated_at.strip():
            raise ValueError("updated_at_required")
        if person.get("updated_at") != client_updated_at:
            raise ValueError(f"conflict:{person['updated_at']}")

        old_label = (person.get("name") or {}).get("label") or ""

        now = datetime.now(timezone.utc).isoformat()

        if "identifiers" in data:
            normalized = _normalize_identifiers(data["identifiers"])
            # Ainult LISANDUNUD ID-d: pärandduplikaat (sama AA kahel kaardil)
            # ei tohi kaardi tavasalvestust blokeerida.
            _check_identifiers_free(
                person_id, _added_identifiers(person.get("identifiers"), normalized))

        _apply_card_update(person, data, now)
        person["updated_at"] = now
        person["updated_by"] = username

        name = (person.get("name") or {}).get("label") or person_id
        # Täida inline labels registrist (self-healing), et EN-UI ei kuvaks ET-silte
        fill_person_labels_from_registry(person)
        _save_person_locked(person, username, f"Prosopo muudatus: {name} [{person_id}]")
    _indices()._update_index_entry(person)
    _indices()._update_aliases_entry(person)

    new_label = (person.get("name") or {}).get("label") or ""
    if new_label and new_label != old_label:
        _propagate_name_to_works(person_id, new_label, username)

    return person


def add_identifier(person_id: str, scheme: str, ext_id: str, username: str) -> tuple:
    """Lisab identifikaatori; rikastuse eelvaade (võrk) PÄRAST lukke (spekk §4.6)."""
    from .enrichment import fetch_and_diff

    sync_from_facade()
    ext_id = normalize_ext_id(scheme, ext_id)
    with ext_id_claim_lock, person_lock(person_id):
        person = get_person(person_id)
        if person is None:
            raise KeyError(person_id)
        existing = _normalize_identifiers(person.get("identifiers") or [])
        if not any(i.get("scheme") == scheme and i.get("id") == ext_id for i in existing):
            _check_identifiers_free(person_id, [{"scheme": scheme, "id": ext_id}])
            existing.append({"scheme": scheme, "id": ext_id, "checked_at": None})
        person["identifiers"] = existing
        person["updated_at"] = datetime.now(timezone.utc).isoformat()
        person["updated_by"] = username
        name = (person.get("name") or {}).get("label") or person_id
        _save_person_locked(person, username, f"Prosopo identifikaator: {name} [{person_id}]")
    _indices()._update_index_entry(person)
    _indices()._update_aliases_entry(person)
    diff = fetch_and_diff(scheme, ext_id, person)
    return person, diff


def _person_image_path(person_id: str, ext: str) -> str:
    """Tagastab isiku pildi failitee (PROSOPOGRAPHY_IMAGES_DIR — ei ole gitis)."""
    sync_from_facade()
    nanoid = _safe_nanoid(person_id)
    path = os.path.join(state.PROSOPOGRAPHY_IMAGES_DIR, f"{nanoid}{ext}")
    if os.path.commonpath([os.path.realpath(path), os.path.realpath(state.PROSOPOGRAPHY_IMAGES_DIR)]) != os.path.realpath(state.PROSOPOGRAPHY_IMAGES_DIR):
        raise ValueError(f"person_id lahendub väljapoole piltide kausta: {person_id!r}")
    return path


def upload_person_image(person_id: str, file_bytes: bytes, content_type: str, username: str) -> dict:
    """Salvestab isiku pildi ja uuendab image_url kirjes."""
    sync_from_facade()

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

    with person_lock(person_id):
        person = get_person(person_id)
        if person is None:
            raise KeyError(person_id)

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
        person["updated_at"] = datetime.now(timezone.utc).isoformat()
        person["updated_by"] = username
        name = (person.get("name") or {}).get("label") or person_id
        _save_person_locked(person, username, f"Prosopo pildi lisamine: {name} [{person_id}]")
    _indices()._update_index_entry(person)
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
    with person_lock(person_id):
        person = get_person(person_id)
        if person is None:
            raise KeyError(person_id)

        for ext in (".jpg", ".webp"):
            path = _person_image_path(person_id, ext)
            if os.path.exists(path):
                os.remove(path)

        person["image_url"] = None
        person["updated_at"] = datetime.now(timezone.utc).isoformat()
        person["updated_by"] = username
        name = (person.get("name") or {}).get("label") or person_id
        _save_person_locked(person, username, f"Prosopo pildi kustutamine: {name} [{person_id}]")
    _indices()._update_index_entry(person)
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
        person = get_person(person_id)
        if person is None:
            raise KeyError(person_id)

        # Tehniline võti juhib checked_at uuendust, kuid ei kuulu isikukaardile.
        # Koopia väldib kutsuja request-dict'i muteerimist.
        approved_fields = strip_server_fields(approved)
        # ID-d ainult add_identifier kaudu (ID-lukk + duplikaadikontroll, §4.6).
        if any(k == "identifiers" or k.startswith("identifiers.") for k in approved_fields):
            raise ValueError("identifiers_via_enrich")
        scheme = approved_fields.pop("_enrichment_scheme", None)

        # Pärandväli ei tohi ühegi tee kaudu tagasi tekkida (ADR 0039). Siin
        # VAIKSELT maha, mitte 409: rikastus on masina ettepanek, mitte kasutaja
        # kirjutatud tekst — tema pärast dialoogi ei visata.
        approved_fields.pop(LEGACY_BIOGRAPHY, None)

        # Ankur on SERVERI TULETIS ka siin — ilma selleta saaks klient ise
        # "originaaltekst ei ole muutunud" kinnituse võltsida (spekk, „Avaliku
        # API üleminek": ankrud visatakse ALATI ära, nagu `id`/`created_at`).
        for key in ANCHOR_FIELDS:
            approved_fields.pop(key, None)

        for field_path, value in approved_fields.items():
            _deep_set(person, field_path, value)

        if scheme:
            for ident in person.get("identifiers") or []:
                if ident.get("scheme") == scheme:
                    ident["checked_at"] = datetime.now(timezone.utc).date().isoformat()

        now = datetime.now(timezone.utc).isoformat()
        person["updated_at"] = now
        person["updated_by"] = username
        name = (person.get("name") or {}).get("label") or person_id
        _save_person_locked(person, username, f"Prosopo rikastus: {name} [{person_id}]")
    _indices()._update_index_entry(person)
    _indices()._update_aliases_entry(person)
    return person


def restore_person(person_id: str, restored: dict, username: str) -> dict:
    """Taastab kaardi varasemale seisule (git). ID-lisav tee: võib tuua tagasi ID,
    mis on vahepeal teisele kaardile läinud — seega ID-lukk + kontroll."""
    sync_from_facade()
    with ext_id_claim_lock, person_lock(person_id):
        current = get_person(person_id) or {}
        # Hauakivi (tombstone) või liidetud kaart kannab endiselt lähtekaardi ID-sid,
        # aga need ID-d KUULUVAD liitmise sihile (vt _resolve_owner) — nende
        # arvestamine "juba olemasolevaks" laseks taastamisel dublikaadi läbi,
        # sest miski ei loeks neid "lisatuks". Loeme vana seisu ID-loendi tühjaks.
        current_identifiers = (
            [] if current.get("record_status") == "tombstone" or current.get("merged_into")
            else current.get("identifiers")
        )
        restored = {**restored, "id": person_id}
        restored["identifiers"] = _normalize_identifiers(restored.get("identifiers") or [])
        _check_identifiers_free(
            person_id, _added_identifiers(current_identifiers, restored["identifiers"]))
        restored["updated_at"] = datetime.now(timezone.utc).isoformat()
        restored["updated_by"] = username
        name = (restored.get("name") or {}).get("label") or person_id
        _save_person_locked(restored, username, f"Prosopo taastamine: {name} [{person_id}]")
    _indices()._update_index_entry(restored)
    _indices()._update_aliases_entry(restored)
    return restored


_enrichment_scheduler = lambda person_id: None  # noqa: E731 — Task 6 registreerib


def set_enrichment_scheduler(fn) -> None:
    """auto_enrich_runner registreerib käivitusel; testid asendavad."""
    global _enrichment_scheduler
    _enrichment_scheduler = fn


def _has_similar_name(label: str, exclude: Optional[str] = None) -> bool:
    """Nimepõhine sarnasus (sama mis vormi SimilarPersonsWarning). Server otsustab
    ise — kliendi väidet `possible_duplicate` kohta ei usaldata (spekk §4.2)."""
    from .person_search import list_persons
    if len((label or "").strip()) < 3:
        return False
    res = list_persons(q=label.strip(), limit=5)
    return any(r.get("id") != exclude and r.get("record_status") != "tombstone"
               for r in res.get("results") or [])


def create_person_checked(*, username: str, created_via: str, name: Optional[str] = None,
                          identifiers: Optional[list] = None, aliases: Optional[list] = None,
                          note: Optional[str] = None, card: Optional[dict] = None,
                          context: Optional[dict] = None) -> dict:
    """Uue kaardi AINUS loomistee (spekk §4.2): üks allikas (card VÕI tipuväljad),
    lõplik kaart enne kontrolli, ID-lukk üle kontrolli + salvestuse, ülevaatusmärge,
    rikastus järjekorda alles pärast salvestust."""
    from .auto_enrich import ENRICH_SCHEMES, new_review

    sync_from_facade()
    if card is not None and any(v is not None for v in (name, identifiers, aliases, note)):
        raise ValueError("card_and_fields")

    # Kuju kontrollitakse ENNE ühtki muud tööd — vale kuju peab andma 400,
    # mitte AttributeError'i (500) esimesel `.get`-kutsel.
    if card is not None and not isinstance(card, dict):
        raise ValueError("invalid_card")
    if card is not None and card.get("name") is not None and not isinstance(card["name"], dict):
        raise ValueError("invalid_card")
    if card is not None and card.get("identifiers") is not None and (
            not isinstance(card["identifiers"], list)
            or not all(isinstance(i, dict) for i in card["identifiers"])):
        raise ValueError("invalid_identifiers")
    if identifiers is not None and (
            not isinstance(identifiers, list) or not all(isinstance(i, dict) for i in identifiers)):
        raise ValueError("invalid_identifiers")
    if aliases is not None and (
            not isinstance(aliases, list) or not all(isinstance(a, str) for a in aliases)):
        raise ValueError("invalid_aliases")

    now = datetime.now(timezone.utc).isoformat()
    if card is not None:
        card_data = strip_server_fields(dict(card))
        card_name = card_data.get("name")
        label = ((card_name or {}).get("label") or "").strip()
        if not label:
            raise ValueError("name_required")
        if isinstance(card_name, dict):
            # Trimmitud silt salvestatakse kaardile tagasi — muidu jõuaks
            # tühikutega ümbritsetud nimi salvestusse (spekk §4.2).
            card_data["name"] = {**card_name, "label": label}
        person = _new_person_skeleton({"name": label}, username)
        _apply_card_update(person, card_data, now)
        person["updated_at"] = now
        person["updated_by"] = username
    else:
        label = (name or "").strip()
        if not label:
            raise ValueError("name_required")
        person = _new_person_skeleton({"name": label, "notes": note}, username)
        person["identifiers"] = _normalize_identifiers(identifiers or [])
        person["name"]["aliases"] = [a for a in dict.fromkeys(aliases or []) if a and a != label]

    enrichable = any(isinstance(i, dict) and i.get("scheme") in ENRICH_SCHEMES
                     for i in person.get("identifiers") or [])
    person["review"] = new_review(created_via=created_via, context=context,
                                  has_enrichable_ids=enrichable,
                                  possible_duplicate=_has_similar_name(label))
    os.makedirs(state.PROSOPOGRAPHY_DIR, exist_ok=True)
    fill_person_labels_from_registry(person)
    with ext_id_claim_lock:
        # Kontroll käib just salvestatavate (normaliseeritud) ID-de peal.
        _check_identifiers_free(None, person.get("identifiers") or [])
        with person_lock(person["id"]):
            _save_person_locked(person, username,
                                f"Prosopo loomine: {label} [{person['id']}]")
    _indices()._update_index_entry(person)
    _indices()._update_aliases_entry(person)
    if enrichable:
        _enrichment_scheduler(person["id"])
    return person


def _find_by_external_id(scheme: str, ext_id: str) -> Optional[dict]:
    """Otsib prosopo kaarti välise identifikaatori (scheme + id) järgi.

    Käib pöördindeksi kaudu (#180) — varem skanniti kogu kausta iga ID kohta.
    """
    person_id = ext_id_index.find_person_id(scheme, ext_id)
    if not person_id:
        return None
    person = get_person(person_id)
    if person is None:
        # Indeks viitab kaardile, mida enam pole (väline kustutus) — koristame kirje.
        ext_id_index.remove_person(person_id)
        return None
    return person


class IdentifierConflict(Exception):
    """Väline ID on juba teisel kaardil. `split` = ID-d on ERI kaartidel."""

    def __init__(self, kind: str, person_ids: list):
        super().__init__(f"{kind}: {', '.join(person_ids)}")
        self.kind = kind
        self.person_ids = person_ids


def _resolve_owner(person_id: str) -> Optional[str]:
    """Liidetud kaardi omanik on liitmise siht (ahel, max 5 sammu)."""
    for _ in range(5):
        person = get_person(person_id)
        if person is None:
            return None
        target = person.get("merged_into")
        if not target:
            return person_id
        person_id = target
    return person_id


def _check_identifiers_free(person_id: Optional[str], identifiers: list) -> None:
    """Kutsuja hoiab `ext_id_claim_lock`-i. Viskab IdentifierConflict, kui mõni
    antud ID on teisel (aktiivsel) kaardil. `person_id=None` = uus kaart."""
    owners: list = []
    for ident in _normalize_identifiers(identifiers or []):
        if not isinstance(ident, dict):
            continue
        found = _find_by_external_id(ident.get("scheme"), ident.get("id"))
        if not found:
            continue
        owner = _resolve_owner(found["id"])
        if owner and owner != person_id and owner not in owners:
            owners.append(owner)
    if owners:
        raise IdentifierConflict("exists" if len(owners) == 1 else "split", owners)


def _added_identifiers(old: list, new: list) -> list:
    """Uues loendis olevad ID-d, mida vanas ei olnud (normaliseeritud võrdlus)."""
    vana = {(i.get("scheme"), i.get("id")) for i in _normalize_identifiers(old or [])
            if isinstance(i, dict)}
    return [i for i in _normalize_identifiers(new or [])
            if isinstance(i, dict) and (i.get("scheme"), i.get("id")) not in vana]


def ensure_prosopo_for_entity(entity: dict, username: str, work_id: Optional[str] = None,
                              role: Optional[str] = None) -> dict:
    """Tagab, et LinkedEntity objektil on vutt:P ID. Uus kaart käib
    `create_person_checked`-i kaudu (ülevaatusmärge + rikastus, spekk §4.4)."""
    if not isinstance(entity, dict):
        return entity
    eid = (entity.get("id") or "").strip()
    if eid.startswith("vutt:P") or not eid:
        return entity

    source = (entity.get("source") or "").lower()
    if source not in ("wikidata", "gnd", "viaf"):
        return entity

    scheme = source
    eid = normalize_ext_id(scheme, eid)
    if not eid:
        return entity
    existing = _find_by_external_id(scheme, eid)
    if existing:
        return {**entity, "id": existing["id"]}

    label = (entity.get("label") or entity.get("name") or eid).strip()
    context = {"work_id": work_id, "role": role or entity.get("role")} if work_id else None
    try:
        stub = create_person_checked(
            username=username, created_via="server_stub", name=label,
            identifiers=[{"scheme": scheme, "id": eid}], context=context)
    except IdentifierConflict as e:
        # Võidujooks: keegi lõi sama ID-ga kaardi vahepeal. `split` ei saa siin
        # tekkida (üks ID), aga kui tekib, jäta entiteet sidumata ja logi.
        if e.kind == "exists":
            return {**entity, "id": e.person_ids[0]}
        state.logger.warning("Stub: %s:%s konflikt %s", scheme, eid, e.person_ids)
        return entity
    return {**entity, "id": stub["id"]}


def ensure_prosopo_stubs(updates: dict, username: str, work_id: Optional[str] = None) -> dict:
    """Asendab creators/tags/publisher Wikidata/GND/VIAF ID-d vutt:P ID-dega."""
    changed = {}

    if "creators" in updates:
        changed["creators"] = [
            ensure_prosopo_for_entity(c, username, work_id=work_id)
            if isinstance(c, dict) else c
            for c in (updates["creators"] or [])
        ]

    if "tags" in updates:
        changed["tags"] = [
            ensure_prosopo_for_entity(t, username, work_id=work_id, role="subject")
            if isinstance(t, dict) and t.get("entity_type") == "person" else t
            for t in (updates["tags"] or [])
        ]

    if "publisher" in updates:
        pub = updates["publisher"]
        if isinstance(pub, dict) and pub.get("entity_type") == "person":
            changed["publisher"] = ensure_prosopo_for_entity(pub, username, work_id=work_id, role="publisher")

    if changed:
        return {**updates, **changed}
    return updates


def bulk_update_occupation(
    occupation: dict,
    mode: str,
    person_ids: list,
    username: str,
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
            person["updated_at"] = datetime.now(timezone.utc).isoformat()
            person["updated_by"] = username
            name = (person.get("name") or {}).get("label") or person_id
            _save_person_locked(person, username, f"Prosopo ametite massmuudatus: {name} [{person_id}]")
            _indices()._update_index_entry(person)
            updated += 1

    return {"updated": updated, "skipped": skipped, "total": len(person_ids)}


__all__ = ['_safe_nanoid', '_id_to_path', '_save_person_locked', '_strip_markup', '_make_snippets', 'get_person', 'create_person', '_new_person_skeleton', '_make_date_obj', '_propagate_name_to_works', '_apply_card_update', 'update_person', 'add_identifier', '_person_image_path', 'upload_person_image', 'get_person_image_path', 'delete_person_image', 'apply_enrichment', 'restore_person', 'IdentifierConflict', '_check_identifiers_free', '_find_by_external_id', 'ensure_prosopo_for_entity', 'ensure_prosopo_stubs', 'bulk_update_occupation', 'SERVER_FIELDS', 'strip_server_fields', 'create_person_checked', 'set_enrichment_scheduler', '_has_similar_name']
