"""Agendi ameti- ja haridusettepanekud ning toimetaja kinnitamine."""
import hashlib
import json
import os
import re
import secrets
import sqlite3
import time
from contextlib import contextmanager
from typing import Optional

from ..config import STATE_DIR, DATA_CONFIG_DIR, PLACES_FILE

DB_PATH = os.path.join(STATE_DIR, "prosopo_enrichment_proposals.sqlite3")
# Kood on toimetaja tööpäeva pikkune ja lubab ulatuse piires mitu esitust (#492, ADR 0058
# täiendus). Kood annab ainult ootel ettepaneku esitamise õiguse: ülevaatus ja kinnitus
# nõuavad sama kasutaja sessiooni, seega ei ava laiem kood ühtegi andmete kirjutusteed.
CODE_TTL = 8 * 60 * 60
PERSON_MAX_USES = 20
ANY_MAX_USES = 200
PROPOSAL_TTL = 7 * 24 * 60 * 60
MAX_ITEMS = 20
MAX_BODY_BYTES = 32_000
_PERSON_ID = re.compile(r"^vutt:P[A-Za-z0-9_-]+$")
_DATE_RE = re.compile(r"^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$")
_KINDS = {"occupation", "education"}
_MATCHES = {"already_present", "matched", "ambiguous", "new_registry_candidate"}
_ITEM_KEYS = {"kind", "raw_occupation", "raw_institution", "occupation_key",
              "institution_key", "place_key", "date_from", "date_to", "evidence",
              "match_status", "existing_index", "edu_type", "occupation_variant",
              "institution_variant", "occupation_entry", "institution_entry"}
_SOURCE_KINDS = {"vutt_page", "literature"}
_DATE_KEYS = {"date", "precision", "bound", "calendar", "is_circa"}
_EVIDENCE_KEYS = {"source_kind", "source_id", "locator", "work_id", "page",
                  "printed_page", "part_id", "quote", "citation"}
# Rea uus registrikirje: (registri liik, kirje väli, võtmeväli).
_ENTRY_FIELDS = (("occupation", "occupation_entry", "occupation_key"),
                 ("institution", "institution_entry", "institution_key"))


class ProposalError(ValueError):
    """Vigane või aegunud ettepanek; ei ole serveri sisemine viga."""


def valid_person_id(person_id: str) -> bool:
    return isinstance(person_id, str) and _PERSON_ID.fullmatch(person_id) is not None


@contextmanager
def _db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    try:
        fd = os.open(DB_PATH, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        pass
    else:
        os.close(fd)
    db = sqlite3.connect(DB_PATH, timeout=5)
    try:
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA busy_timeout=5000")
        db.executescript("""
            CREATE TABLE IF NOT EXISTS handoff (
                code_hash TEXT PRIMARY KEY, person_id TEXT NOT NULL,
                username TEXT NOT NULL, session_fingerprint TEXT NOT NULL,
                base_updated_at TEXT NOT NULL,
                expires_at INTEGER NOT NULL, used_at INTEGER
            );
            CREATE TABLE IF NOT EXISTS proposal (
                id TEXT PRIMARY KEY, person_id TEXT NOT NULL,
                username TEXT NOT NULL, session_fingerprint TEXT NOT NULL,
                base_updated_at TEXT NOT NULL,
                created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
                payload TEXT NOT NULL, applied_at INTEGER
            );
        """)
        if not any(column[1] == "applied_at" for column in db.execute("PRAGMA table_info(proposal)")):
            db.execute("ALTER TABLE proposal ADD COLUMN applied_at INTEGER")
        handoff_columns = {column[1] for column in db.execute("PRAGMA table_info(handoff)")}
        # Vanad (ühekordsed) koodid: max_uses 1, kasutatud kood uses 1.
        if "scope" not in handoff_columns:
            db.execute("ALTER TABLE handoff ADD COLUMN scope TEXT NOT NULL DEFAULT 'person'")
        if "max_uses" not in handoff_columns:
            db.execute("ALTER TABLE handoff ADD COLUMN max_uses INTEGER NOT NULL DEFAULT 1")
        if "uses" not in handoff_columns:
            db.execute("ALTER TABLE handoff ADD COLUMN uses INTEGER NOT NULL DEFAULT 0")
            db.execute("UPDATE handoff SET uses = 1 WHERE used_at IS NOT NULL")
        with db:
            yield db
    finally:
        db.close()


def _clean(db, now: int) -> None:
    db.execute("DELETE FROM handoff WHERE expires_at < ?", (now,))
    db.execute("DELETE FROM proposal WHERE expires_at < ?", (now,))


def issue_handoff(person_id: Optional[str], username: str, session_fingerprint: str,
                  updated_at: str = "") -> dict:
    """Esituskood ühele isikule (`person_id`) või kõigile isikutele (`None`).

    Editori rolli kontrollib router. Kood on seotud kasutajaga: ettepanekud näeb ja
    kinnitab sama kasutaja igas oma seansis (#492).
    """
    scope = "person" if person_id is not None else "any"
    if (scope == "person" and not valid_person_id(person_id)) or not session_fingerprint:
        raise ProposalError("invalid_person_or_version")
    max_uses = PERSON_MAX_USES if scope == "person" else ANY_MAX_USES
    code = secrets.token_urlsafe(32)
    now = int(time.time())
    with _db() as db:
        _clean(db, now)
        db.execute(
            "INSERT INTO handoff (code_hash, person_id, username, session_fingerprint, base_updated_at,"
            " expires_at, used_at, scope, max_uses, uses) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, 0)",
            (hashlib.sha256(code.encode()).hexdigest(), person_id or "*",
             username, session_fingerprint, updated_at or "", now + CODE_TTL, scope, max_uses),
        )
    return {"code": code, "expires_at": now + CODE_TTL, "scope": scope, "max_uses": max_uses,
            "person_id": person_id, "base_updated_at": updated_at}


def _short_string(value, limit: int = 500) -> bool:
    return isinstance(value, str) and len(value) <= limit


def _validate_item(item: dict) -> None:
    # Veateade on agendile juhis: kood ees (masinloetav), selgitus järel. Paljas
    # „invalid_item" jättis agendi pimesi variante proovima.
    if not isinstance(item, dict):
        raise ProposalError("invalid_item: kirje peab olema objekt")
    unknown = sorted(set(item) - _ITEM_KEYS)
    if unknown:
        raise ProposalError(
            f"invalid_item: tundmatud võtmed {unknown}; lubatud {sorted(_ITEM_KEYS)}")
    if item.get("kind") not in _KINDS or item.get("match_status") not in _MATCHES:
        raise ProposalError(
            f"invalid_kind_or_match: kind peab olema üks {sorted(_KINDS)}, "
            f"match_status üks {sorted(_MATCHES)}")
    if item["kind"] == "occupation" and (
            not _short_string(item.get("raw_occupation"))
            or not item["raw_occupation"].strip()):
        raise ProposalError("raw_occupation_required: kind=occupation vajab mittetühja raw_occupation-i (allika sõnastus)")
    if item["kind"] == "education" and (
            not _short_string(item.get("raw_institution"))
            or not item["raw_institution"].strip()):
        raise ProposalError("raw_institution_required: kind=education vajab mittetühja raw_institution-i (allika sõnastus)")
    for key in ("raw_occupation", "raw_institution", "occupation_key",
                "institution_key", "place_key", "edu_type", "occupation_variant",
                "institution_variant"):
        if key in item and item[key] is not None and not _short_string(item[key]):
            raise ProposalError(f"invalid_text_field: {key} peab olema string (≤500 märki) või null")
    for key in ("date_from", "date_to"):
        if key in item and item[key] is not None:
            value = item[key]
            if not isinstance(value, dict) or not set(value) <= _DATE_KEYS:
                raise ProposalError(
                    f"invalid_date: {key} peab olema objekt võtmetega {sorted(_DATE_KEYS)}, "
                    'nt {"date": "1650-03", "precision": "month"}')
            if not _short_string(value.get("date"), 32) or not value["date"].strip():
                raise ProposalError(f"invalid_date: {key}.date on kohustuslik (YYYY, YYYY-MM või YYYY-MM-DD)")
            match = _DATE_RE.fullmatch(value["date"])
            if (not match or (match.group(2) and not 1 <= int(match.group(2)) <= 12)
                    or (match.group(3) and not 1 <= int(match.group(3)) <= 31)):
                raise ProposalError(f"invalid_date: {key}.date peab olema YYYY, YYYY-MM või YYYY-MM-DD")
            if value.get("precision") not in (None, "day", "month", "year"):
                raise ProposalError(f"invalid_date_precision: {key}.precision on day, month, year või null")
            if value.get("bound") not in (None, "before", "after"):
                raise ProposalError(f"invalid_date_bound: {key}.bound on before, after või null")
            if value.get("calendar") not in (None, "julian", "gregorian"):
                raise ProposalError(f"invalid_date_calendar: {key}.calendar on julian, gregorian või null")
            if "is_circa" in value and not isinstance(value["is_circa"], bool):
                raise ProposalError(f"invalid_date_circa: {key}.is_circa peab olema true/false")
    if "existing_index" in item and (not isinstance(item["existing_index"], int)
                                     or isinstance(item["existing_index"], bool)
                                     or item["existing_index"] < 0):
        raise ProposalError("invalid_existing_index: existing_index peab olema täisarv ≥ 0")
    evidence = item.get("evidence")
    if not isinstance(evidence, list) or not 1 <= len(evidence) <= 5:
        raise ProposalError("evidence_required: evidence peab olema 1–5 viitega list")
    for source in evidence:
        if not isinstance(source, dict):
            raise ProposalError("invalid_evidence: iga viide peab olema objekt")
        unknown = sorted(set(source) - _EVIDENCE_KEYS)
        if unknown:
            raise ProposalError(
                f"invalid_evidence: tundmatud võtmed {unknown}; lubatud {sorted(_EVIDENCE_KEYS)}")
        # Tõend peab olema VUTT-is kontrollitav: korpuse leht või kirjanduskogu dokument.
        # Veebiallikas (ka akadeemiline) ei kõlba — agent teatab selle kasutajale, kes
        # lisab allika kirjanduskogusse; alles siis saab fakti viitega esitada.
        if source.get("source_kind") not in _SOURCE_KINDS:
            raise ProposalError(
                "invalid_evidence_kind: source_kind on vutt_page või literature. Allikat, "
                "mis ei ole VUTT-i korpuses ega kirjanduskogus, ei esitata tõendina — "
                "teata see kasutajale, kes lisab ta kirjanduskogusse")
        if source["source_kind"] == "vutt_page" and (
                not source.get("work_id") or not isinstance(source.get("page"), int)):
            raise ProposalError("vutt_page_requires_work_and_page: vutt_page vajab work_id-d ja täisarvulist page-i")
        if source["source_kind"] == "literature" and (
                not source.get("source_id") or not source.get("locator")):
            raise ProposalError("literature_requires_source_and_locator: literature vajab source_id-d ja locator-it")
        for key, value in source.items():
            if key == "page":
                if not isinstance(value, int) or isinstance(value, bool) or value < 1:
                    raise ProposalError("invalid_page: page peab olema täisarv ≥ 1")
            elif value is not None and not _short_string(value, 1000 if key == "quote" else 500):
                raise ProposalError(f"invalid_evidence_text: {key} peab olema string (quote ≤1000, muu ≤500 märki)")
    for _, field, key_field in _ENTRY_FIELDS:
        entry = item.get(field)
        if entry is None:
            continue
        if field == "occupation_entry" and item["kind"] != "occupation":
            raise ProposalError("invalid_registry_entry: occupation_entry ainult kind=occupation real")
        if (not isinstance(entry, dict) or not isinstance(entry.get("key"), str)
                or not entry["key"]):
            raise ProposalError(f"invalid_registry_entry: {field} peab olema objekt mittetühja key-ga")
        if item["match_status"] != "new_registry_candidate":
            raise ProposalError(
                f"registry_entry_requires_new_candidate: {field} nõuab "
                "match_status=new_registry_candidate")
        if item.get(key_field) not in (None, entry["key"]):
            raise ProposalError(
                f"registry_entry_key_mismatch: {key_field} peab puuduma või võrduma {field}.key-ga")


def _check_vutt_pages(items: list) -> None:
    """Korpuse viide peab osutama olemasolevale teosele ja leheküljele (1-põhine, nagu
    /work/{id}/{nr}). Kirjanduskogu doc_id-d kontrollib MCP — kogu elab agendi masinas."""
    from ..utils import find_directory_by_id
    from ..work_parts import page_stems
    counts: dict = {}
    for index, item in enumerate(items):
        for source in item["evidence"]:
            if source["source_kind"] != "vutt_page":
                continue
            work_id = source["work_id"]
            if work_id not in counts:
                work_dir = find_directory_by_id(work_id)
                counts[work_id] = len(page_stems(work_dir)) if work_dir else None
            if counts[work_id] is None:
                raise ProposalError(
                    f"items[{index}]: unknown_work: work_id {work_id!r} puudub VUTT-is")
            if source["page"] > counts[work_id]:
                raise ProposalError(
                    f"items[{index}]: page_out_of_range: teoses {work_id} on "
                    f"{counts[work_id]} lehekülge")


def _split_entry(entry: dict) -> tuple[str, dict]:
    """Lepingus on `key` kirje sees (agendile lihtsam); registri kirjekujus võtit ei
    ole ja `validate_entry` lükkaks selle tagasi (`unknown_fields`)."""
    return entry["key"], {k: v for k, v in entry.items() if k != "key"}


def _check_registry_entries(items: list) -> None:
    """Uus registrikirje peab olema kehtiv ja registris veel puuduma. Viga suunab
    agenti olemasolevat kirjet kasutama; sama võti ühes ettepanekus = sama sisu."""
    from . import registries
    seen: dict = {}
    for index, item in enumerate(items):
        for kind, field, _ in _ENTRY_FIELDS:
            if not item.get(field):
                continue
            key, data = _split_entry(item[field])
            try:
                clean = registries.validate_entry(
                    kind, key, data,
                    places=registries._places() if kind == "institution" else None)
                entries = registries.load(kind)
            except registries.RegistryError as error:
                raise ProposalError(
                    f"items[{index}]: invalid_registry_entry: {field}: {error}") from None
            if key in entries:
                raise ProposalError(f"items[{index}]: registry_key_exists: {key} — kasuta seda")
            owner = next((k for k, v in entries.items() if clean["id"]
                          and isinstance(v, dict) and v.get("id") == clean["id"]), None)
            if owner:
                raise ProposalError(
                    f"items[{index}]: registry_id_exists: {clean['id']} on kirjel {owner}")
            if seen.setdefault((kind, key), clean) != clean:
                raise ProposalError(
                    f"items[{index}]: registry_entry_mismatch: {key} on ettepanekus eri sisuga")


def submit(code: str, person_id: str, base_updated_at: str, items: list) -> dict:
    """Kulutab koodi ja talletab ainult ajutise ettepaneku ühe transaktsiooniga."""
    if not isinstance(code, str) or len(code) > 100 or not valid_person_id(person_id):
        raise ProposalError("invalid_handoff")
    if not isinstance(base_updated_at, str) or not base_updated_at:
        raise ProposalError("invalid_version")
    if not isinstance(items, list) or not 1 <= len(items) <= MAX_ITEMS:
        raise ProposalError(f"invalid_items: items peab olema 1–{MAX_ITEMS} kirjega list")
    for index, item in enumerate(items):
        try:
            _validate_item(item)
        except ProposalError as error:
            raise ProposalError(f"items[{index}]: {error}") from None
    _check_registry_entries(items)
    for item in items:
        for _, field, key_field in _ENTRY_FIELDS:
            if item.get(field):
                item[key_field] = item[field]["key"]
    payload = json.dumps(items, ensure_ascii=False)
    if len(payload.encode("utf-8")) > MAX_BODY_BYTES:
        raise ProposalError("proposal_too_large")
    _check_vutt_pages(items)
    # Ettepanek peab põhinema elaval kaardiversioonil (enne koodi kasutust, et viga seda ei kulutaks).
    from .person_crud import get_person
    person = get_person(person_id)
    if person is None or person.get("record_status") == "tombstone" or person.get("merged_into"):
        raise ProposalError("person_not_found")
    if person.get("updated_at") != base_updated_at:
        raise ProposalError("stale_person")

    now = int(time.time())
    digest = hashlib.sha256(code.encode()).hexdigest()
    proposal_id = secrets.token_urlsafe(16)
    with _db() as db:
        _clean(db, now)
        row = db.execute("SELECT * FROM handoff WHERE code_hash=?", (digest,)).fetchone()
        if (row is None or row["expires_at"] <= now
                or (row["scope"] == "person" and row["person_id"] != person_id)):
            raise ProposalError("invalid_or_expired_handoff")
        # Tingimuslik UPDATE hoiab lae ka samaaegsete esituste korral.
        changed = db.execute(
            "UPDATE handoff SET uses = uses + 1, used_at=? WHERE code_hash=? AND uses < max_uses",
            (now, digest),
        ).rowcount
        if changed != 1:
            raise ProposalError("handoff_used_up")
        db.execute(
            "INSERT INTO proposal VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)",
            (proposal_id, person_id, row["username"], row["session_fingerprint"], base_updated_at,
             now, now + PROPOSAL_TTL, payload),
        )
    return {"proposal_id": proposal_id, "person_id": person_id,
            "status": "pending", "expires_at": now + PROPOSAL_TTL}


def list_pending(person_id: str, username: str, session_fingerprint: str = "") -> list[dict]:
    """Toimetaja näeb ainult enda algatatud ettepanekuid — igas oma seansis (#492)."""
    from .person_crud import get_person
    person = get_person(person_id)
    if person is not None and (person.get("record_status") == "tombstone" or person.get("merged_into")):
        person = None
    now = int(time.time())
    with _db() as db:
        _clean(db, now)
        rows = db.execute(
            "SELECT * FROM proposal WHERE person_id=? AND username=? AND applied_at IS NULL ORDER BY created_at DESC",
            (person_id, username),
        ).fetchall()
    result = []
    for row in rows:
        items = json.loads(row["payload"])
        for item in items:
            item["review_state"] = _review_state(item, person)
            labels, ids = {}, {}
            for key, filename in (
                ("occupation_key", os.path.join(DATA_CONFIG_DIR, "occupations.json")),
                ("institution_key", os.path.join(DATA_CONFIG_DIR, "institutions.json")),
                ("place_key", PLACES_FILE),
            ):
                if not item.get(key):
                    continue
                # Uue kirje sildid tulevad ettepanekust — registris teda veel pole.
                new = next((item[f] for _, f, k in _ENTRY_FIELDS if k == key and item.get(f)), None)
                entry = new or _registry_entry(filename, item[key])
                if entry:
                    names = entry.get("labels") or {}
                    label = (names.get("et") or names.get("en") if isinstance(names, dict) else None) \
                        or entry.get("label")
                    if label:
                        labels[key] = label
                    if entry.get("id"):
                        ids[key] = entry["id"]
            item["registry_labels"] = labels
            item["registry_ids"] = ids
            if item.get("institution_key"):
                institution = item.get("institution_entry") or _registry_entry(
                    os.path.join(DATA_CONFIG_DIR, "institutions.json"), item["institution_key"])
                item["institution_place_key"] = institution.get("place_key") if institution else None
        result.append({"proposal_id": row["id"], "person_id": person_id,
                       "base_updated_at": row["base_updated_at"],
                       "created_at": row["created_at"], "expires_at": row["expires_at"],
                       "items": items})
    return result


def _registry_entry(filename: str, key: str) -> Optional[dict]:
    """Võtmega seos lubatakse ainult reaalselt olemasoleva registrikirjega."""
    try:
        with open(filename, encoding="utf-8") as handle:
            entries = json.load(handle)
    except (OSError, ValueError):
        return None
    if isinstance(entries, dict):
        entry = entries.get(key)
        return entry if isinstance(entry, dict) else None
    if isinstance(entries, list):
        return next((entry for entry in entries
                     if isinstance(entry, dict) and entry.get("key") == key), None)
    return None


def _card_item(item: dict, planned: Optional[dict] = None) -> dict:
    kind = item["kind"]
    if kind == "occupation":
        result = {"label": item["raw_occupation"].strip()}
        if item.get("raw_institution"):
            result["institution"] = item["raw_institution"].strip()
    else:
        result = {"institution": item["raw_institution"].strip()}
        if item.get("edu_type"):
            result["type"] = item["edu_type"].strip()
    for key in ("occupation_key", "institution_key", "place_key", "date_from", "date_to"):
        if item.get(key) is not None:
            result[key] = item[key]
    # Q-koodid jäävad vana andmelepingu ühilduvusväljadeks. Püsiv identiteet on
    # registrivõti; Q-koodita kirje puhul neid välju ei fabritseerita (#462/#471).
    if item.get("occupation_key"):
        occupation = (planned or {}).get("occupation_key") or _registry_entry(
            os.path.join(DATA_CONFIG_DIR, "occupations.json"), item["occupation_key"])
        if occupation and occupation.get("id"):
            result["id"] = occupation["id"]
    if item.get("institution_key"):
        institution = (planned or {}).get("institution_key") or _registry_entry(
            os.path.join(DATA_CONFIG_DIR, "institutions.json"), item["institution_key"])
        if institution and institution.get("id"):
            result["institution_id"] = institution["id"]
    result["evidence"] = item["evidence"]
    return result


def _check_links(item: dict, planned: Optional[dict] = None) -> None:
    """Seosed peavad osutama olemasolevale kirjele; `planned` = kinnitusel loodavad."""
    planned = planned or {}
    if item.get("institution_key") and item.get("place_key"):
        raise ProposalError("institution_and_place_are_exclusive")
    if item["kind"] == "education" and (item.get("occupation_key") or item.get("place_key")):
        raise ProposalError("invalid_education_links")
    for key, filename in (
        ("occupation_key", os.path.join(DATA_CONFIG_DIR, "occupations.json")),
        ("institution_key", os.path.join(DATA_CONFIG_DIR, "institutions.json")),
        ("place_key", PLACES_FILE),
    ):
        if item.get(key):
            entry = planned.get(key) or _registry_entry(filename, item[key])
            if entry is None:
                raise ProposalError(f"unknown_{key}")
            variant_key = key.removesuffix("_key") + "_variant"
            if item.get(variant_key) and item[variant_key] not in (entry.get("variants") or []):
                raise ProposalError(f"unknown_{variant_key}")
    if item.get("occupation_variant") and not item.get("occupation_key"):
        raise ProposalError("occupation_variant_requires_key")
    if item.get("institution_variant") and not item.get("institution_key"):
        raise ProposalError("institution_variant_requires_key")


def _year(value) -> Optional[int]:
    if not isinstance(value, dict):
        return None
    match = re.match(r"^(\d{4})", str(value.get("date") or ""))
    return int(match.group(1)) if match else None


def _same_fact(existing: dict, candidate: dict, kind: str) -> bool:
    identity = ("occupation_key", "institution_key", "place_key") if kind == "occupation" else ("institution_key", "type")
    if not candidate.get("occupation_key" if kind == "occupation" else "institution_key"):
        return False
    if any(existing.get(key) != candidate.get(key) for key in identity):
        return False
    a_from, a_to = _year(existing.get("date_from")), _year(existing.get("date_to"))
    b_from, b_to = _year(candidate.get("date_from")), _year(candidate.get("date_to"))
    return not ((a_to is not None and b_from is not None and a_to < b_from)
                or (b_to is not None and a_from is not None and b_to < a_from))


def _same_legacy_fact(existing: dict, candidate: dict, kind: str) -> bool:
    """Match an unlinked row by its preserved wording before adding a registry key."""
    key = "occupation_key" if kind == "occupation" else "institution_key"
    raw = "label" if kind == "occupation" else "institution"
    if (existing.get(key) or not candidate.get(key)
            or str(existing.get(raw) or "").strip().casefold()
            != str(candidate.get(raw) or "").strip().casefold()):
        return False
    if kind == "occupation" and (
            str(existing.get("institution") or "").strip().casefold()
            != str(candidate.get("institution") or "").strip().casefold()):
        return False
    if kind == "education" and existing.get("type") != candidate.get("type"):
        return False
    for link in ("institution_key", "place_key"):
        if existing.get(link) and existing.get(link) != candidate.get(link):
            return False
    for identifier in ("id", "institution_id"):
        if existing.get(identifier) and existing.get(identifier) != candidate.get(identifier):
            return False
    a_from, a_to = _year(existing.get("date_from")), _year(existing.get("date_to"))
    b_from, b_to = _year(candidate.get("date_from")), _year(candidate.get("date_to"))
    return not ((a_to is not None and b_from is not None and a_to < b_from)
                or (b_to is not None and a_from is not None and b_to < a_from))


def _planned_entries(item: dict) -> dict:
    """Rea uued registrikirjed kujul võtmeväli → kirje, mida kinnitus kasutaks."""
    from . import registries
    planned = {}
    for kind, field, key_field in _ENTRY_FIELDS:
        if item.get(field):
            key, data = _split_entry(item[field])
            try:
                planned[key_field] = registries.check_ensure(kind, key, data)
            except registries.RegistryError as error:
                raise ProposalError(f"{error}: {key}") from None
    return planned


def _merge_row(item: dict, occupations: list, education: list) -> str:
    """Kannab rea kaardi loendite KOOPIASSE. Sihtkirje leitakse sisu järgi —
    `existing_index` on agendi vihje ja nihkub, kui kaardilt midagi kustutatakse."""
    if item["match_status"] == "ambiguous":
        raise ProposalError("ambiguous_match")
    key_field = "occupation_key" if item["kind"] == "occupation" else "institution_key"
    if not item.get(key_field):
        raise ProposalError("registry_key_missing")
    planned = _planned_entries(item)
    _check_links(item, planned)
    target = occupations if item["kind"] == "occupation" else education
    candidate = _card_item(item, planned)
    matching = [i for i, e in enumerate(target)
                if isinstance(e, dict) and _same_fact(e, candidate, item["kind"])]
    legacy = [i for i, e in enumerate(target)
              if isinstance(e, dict) and _same_legacy_fact(e, candidate, item["kind"])]
    if item["match_status"] != "already_present":
        if matching or legacy:
            raise ProposalError("duplicate_entry")
        target.append(candidate)
        return "applicable"
    hits = matching or legacy
    if len(hits) != 1:
        raise ProposalError("unresolved_existing_entry")
    existing = target[hits[0]]
    links = {}
    if not matching:
        # Pärandrida (sõnastus ilma registriseoseta) saab seose, sõnastus jääb.
        for key in ("occupation_key", "institution_key", "place_key", "id", "institution_id"):
            if candidate.get(key) and not existing.get(key):
                links[key] = candidate[key]
    evidence = existing.get("evidence") or []
    target[hits[0]] = {**existing, **links, "evidence": evidence + [
        source for source in item["evidence"] if source not in evidence]}
    return "already_present"


def _review_state(item: dict, person: Optional[dict]) -> dict:
    """Serveri otsus paneelile — klient olekut ise ei arvuta."""
    if person is None:
        return {"state": "blocked", "reason": "person_not_found"}
    try:
        state = _merge_row(item, list(person.get("occupations") or []),
                           list(person.get("education") or []))
    except ProposalError as error:
        return {"state": "blocked", "reason": str(error)}
    return {"state": state}


def apply_selected(proposal_id: str, person_id: str, username: str,
                   session_fingerprint: str, selected: list[int],
                   corrections: Optional[dict] = None) -> dict:
    """Salvestab ainult toimetaja valitud uued read kaardi versioonikontrolliga."""
    from .person_crud import get_person, update_person

    if not isinstance(selected, list) or not selected or len(selected) > MAX_ITEMS or any(
        not isinstance(index, int) or isinstance(index, bool) for index in selected
    ) or len(set(selected)) != len(selected):
        raise ProposalError("invalid_selection")
    corrections = {} if corrections is None else corrections
    allowed = {"occupation_key", "institution_key", "place_key",
               "occupation_variant", "institution_variant", "date_from", "date_to",
               "edu_type", "evidence"}
    if not isinstance(corrections, dict) or any(
        not isinstance(index, str) or not index.isdecimal() or str(int(index)) != index
        or int(index) not in selected
        or not isinstance(patch, dict) or not set(patch) <= allowed
        for index, patch in corrections.items()
    ):
        raise ProposalError("invalid_corrections")
    with _db() as db:
        row = db.execute(
            "SELECT * FROM proposal WHERE id=? AND person_id=? AND username=? AND applied_at IS NULL AND expires_at>?",
            (proposal_id, person_id, username, int(time.time())),
        ).fetchone()
        if row is None:
            raise ProposalError("proposal_not_found")
        items = json.loads(row["payload"])
        if any(index < 0 or index >= len(items) for index in selected):
            raise ProposalError("invalid_selection")
        chosen = []
        for index in selected:
            item = items[index].copy()
            patch = corrections.get(str(index), {})
            if patch and item["match_status"] == "already_present" and set(patch) != {"evidence"}:
                raise ProposalError("cannot_correct_existing_entry")
            if "occupation_key" in patch and patch["occupation_key"] != item.get("occupation_key"):
                item.pop("occupation_variant", None)
            if "institution_key" in patch and patch["institution_key"] != item.get("institution_key"):
                item.pop("institution_variant", None)
            item.update(patch)
            if item["match_status"] in {"ambiguous", "new_registry_candidate"}:
                required_key = "occupation_key" if item["kind"] == "occupation" else "institution_key"
                if required_key not in patch or not item.get(required_key):
                    raise ProposalError("unresolved_match")
                item["match_status"] = "matched"
            _validate_item(item)
            _check_links(item)
            chosen.append(item)

        person = get_person(person_id)
        if person is None:
            raise ProposalError("person_not_found")
        if person.get("updated_at") != row["base_updated_at"]:
            raise ProposalError("stale_person")
        occupations = list(person.get("occupations") or [])
        education = list(person.get("education") or [])
        for item in chosen:
            target = occupations if item["kind"] == "occupation" else education
            candidate = _card_item(item)
            matching = [index for index, existing in enumerate(target) if isinstance(existing, dict)
                        and _same_fact(existing, candidate, item["kind"])]
            if item["match_status"] == "already_present":
                index = item.get("existing_index")
                if index is None or index >= len(target) or not isinstance(target[index], dict):
                    raise ProposalError("unresolved_existing_entry")
                legacy = _same_legacy_fact(target[index], candidate, item["kind"])
                if matching != [index] and not (legacy and not matching):
                    raise ProposalError("unresolved_existing_entry")
                evidence = target[index].get("evidence") or []
                links = {}
                if legacy:
                    for key in ("occupation_key", "institution_key", "place_key", "id", "institution_id"):
                        if candidate.get(key) and not target[index].get(key):
                            links[key] = candidate[key]
                target[index] = {**target[index], **links, "evidence": evidence + [
                    source for source in item["evidence"] if source not in evidence
                ]}
                continue
            if matching or any(isinstance(existing, dict)
                               and _same_legacy_fact(existing, candidate, item["kind"])
                               for existing in target):
                raise ProposalError("duplicate_entry")
            target.append(candidate)
        # update_person teeb isikuluku all teise versioonikontrolli ja uuendab indeksi.
        updated = update_person(person_id, {
            "updated_at": row["base_updated_at"],
            "occupations": occupations, "education": education,
        }, username)
        remaining = [item for index, item in enumerate(items) if index not in set(selected)]
        if remaining:
            db.execute("UPDATE proposal SET payload=?, base_updated_at=? WHERE id=? AND applied_at IS NULL",
                       (json.dumps(remaining, ensure_ascii=False), updated["updated_at"], proposal_id))
        else:
            db.execute("UPDATE proposal SET applied_at=? WHERE id=? AND applied_at IS NULL",
                       (int(time.time()), proposal_id))
    return updated
