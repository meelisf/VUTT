"""Prosopograafia suuremad admin-operatsioonid: merge ja delete."""
from __future__ import annotations

import json
import os
from contextlib import ExitStack
from datetime import datetime, timezone

from . import state
from .indices import _load_index, _load_person_to_works, _remove_aliases_entry, rebuild_indices
from .person_crud import _AsyncTasks, _id_to_path, copy_person_image, get_person
from .locks import ext_id_claim_lock, merge_operation_lock, person_lock
from ..prosopo_biography_fields import (
    ANCHOR_FIELDS, BIOGRAPHY_EN, BIOGRAPHY_ET, TEXT_FIELDS,
)


def _merge_biography_fields(source: dict, target: dict) -> bool:
    """Kolm tekstivälja + ankrud. Tagastab, kas sihtmärk muutus.

    Tekstiväljad: tavaline „allikas täidab ainult tühja sihtvälja" reegel.
    Ankrud: pärast ühendamist on MÕLEMAD `None`, välja arvatud kui mõlemad
    keeleväljad tulid samalt kaardilt tühjale sihtmärgile. Kahtluse korral
    `None` — kaotatud kinnitus on üks märkeruudu vajutus, vale kinnitus on
    vaikne viga (ADR 0039).
    """
    # Seis ENNE kopeerimist: pärast on mõlemad väljad täidetud ja tingimust
    # ei saaks enam hinnata.
    sihil_oli_elulugu = bool(target.get(BIOGRAPHY_ET)) or bool(target.get(BIOGRAPHY_EN))

    changed = False
    for field in TEXT_FIELDS:
        if source.get(field) and not target.get(field):
            target[field] = source[field]
            changed = True

    molemad_allikast = (
        not sihil_oli_elulugu
        and bool(source.get(BIOGRAPHY_ET))
        and bool(source.get(BIOGRAPHY_EN))
    )
    for anchor in ANCHOR_FIELDS:
        uus = source.get(anchor) if molemad_allikast else None
        if target.get(anchor) != uus:
            changed = True
        # Seatakse ALATI: skeem hoiab mõlemat ankrut olemas (person_crud
        # `create_person`), ja puuduv võti annaks lugejale KeyError'i.
        target[anchor] = uus

    return changed


# Täpsus → kuupäevastringi tähendusega osa pikkus (`1640-02-05`[:4] = aasta).
_DATE_PRECISION_LEN = {"year": 4, "month": 7, "day": 10}


def _merged_date(src_val, tgt_val):
    """Sünni-/surmaaja väärtus sihtkaardile või None (siht jääb).

    Tühi siht saab allika. Täidetud siht asendub ainult TÄPSUSTUSEGA: allika
    täpsus on peenem ja kuupäev algab sihi täpsusega lõigatud osaga
    (`1640` täpsusega „aasta" → `1640-02-05`). `-01-01` täpsusega „aasta" on
    kohatäide, mitte 1. jaanuar (#240). Vastuolu või puuduv täpsus → siht jääb.
    """
    src_date = src_val.get("date") if isinstance(src_val, dict) else None
    tgt_date = tgt_val.get("date") if isinstance(tgt_val, dict) else None
    if not src_date:
        return None
    if not tgt_date:
        return src_val
    src_len = _DATE_PRECISION_LEN.get(src_val.get("precision"))
    tgt_len = _DATE_PRECISION_LEN.get(tgt_val.get("precision"))
    if src_len is None or tgt_len is None or src_len <= tgt_len:
        return None
    if str(src_date)[:tgt_len] != str(tgt_date)[:tgt_len]:
        return None
    merged = dict(src_val)
    # Koht on kuupäevast sõltumatu teadmine — sihi oma ei tohi kaduda.
    if not merged.get("place") and tgt_val.get("place"):
        merged["place"] = tgt_val["place"]
    return merged


def _merge_person_locked(source_id: str, target_id: str, username: str) -> dict:
    """Liidab kirjed; kutsuja hoiab liitmis- ning source/target isikulukke."""
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
    target_changed = False

    src_idents = source.get("identifiers") or []
    tgt_idents = target.get("identifiers") or []
    tgt_schemes = {i.get("scheme") for i in tgt_idents}
    added_idents = [i for i in src_idents if i.get("scheme") not in tgt_schemes]
    if added_idents:
        target["identifiers"] = tgt_idents + added_idents
        target_changed = True

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

    for field in ("birth", "death"):
        merged = _merged_date(source.get(field), target.get(field))
        if merged is not None:
            target[field] = merged
            target_changed = True

    src_origin = source.get("origin") or {}
    tgt_origin = target.get("origin") or {}
    if src_origin.get("place") and not tgt_origin.get("place"):
        target["origin"] = src_origin
        target_changed = True

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

    if _merge_biography_fields(source, target):
        target_changed = True

    # Pildifail ei ole kaardi JSON-is — ilma kopeerimiseta jäi ainuke pilt
    # tombstone'i taha (#240, Glück 2026-10-30).
    image_url = copy_person_image(source_id, target_id)
    if image_url:
        target["image_url"] = image_url
        target_changed = True

    src_notes = (source.get("notes") or "").strip()
    tgt_notes = (target.get("notes") or "").strip()
    if src_notes and src_notes not in tgt_notes:
        target["notes"] = (tgt_notes + "\n\n" + src_notes).strip() if tgt_notes else src_notes
        target_changed = True

    if target_changed:
        target["updated_at"] = now
        target["updated_by"] = username

    source["record_status"] = "tombstone"
    source["merged_into"] = target_id
    source["updated_at"] = now
    source["updated_by"] = username

    source_name = (source.get("name") or {}).get("label") or source_id
    target_name = (target.get("name") or {}).get("label") or target_id
    additional = (
        [(_id_to_path(target_id), json.dumps(target, ensure_ascii=False, indent=2))]
        if target_changed else None
    )
    state.save_with_git(
        _id_to_path(source_id),
        json.dumps(source, ensure_ascii=False, indent=2),
        username,
        message=f"Prosopo liitmine: {source_name} → {target_name}",
        additional_files=additional,
    )

    for fpath in state._glob.glob(os.path.join(state.PROSOPOGRAPHY_DIR, "*.json")):
        if state.PERSON_IMAGES_DIR_NAME in fpath:
            continue
        try:
            with open(fpath, encoding="utf-8") as f:
                p = json.load(f)
        except Exception:
            continue
        if p.get("id") in (source_id, target_id):
            continue
        if p.get("record_status") == "tombstone":
            continue
        person_id = p.get("id")
        if not person_id:
            continue
        # Loe luku all uuesti: skannimise ja kirjutamise vahel võis kaart muutuda.
        with person_lock(person_id):
            p = get_person(person_id)
            if p is None or p.get("record_status") == "tombstone":
                continue
            changed = False
            for rel in p.get("relations", []):
                if rel.get("target_id") == source_id:
                    rel["target_id"] = target_id
                    changed = True
            if changed:
                p["updated_at"] = now
                p["updated_by"] = username
                person_name = (p.get("name") or {}).get("label") or person_id
                state.save_with_git(
                    fpath,
                    json.dumps(p, ensure_ascii=False, indent=2),
                    username,
                    message=f"Prosopo liitmise seoseuuendus: {person_name} [{person_id}]",
                )

    target_label = (target.get("name") or {}).get("label") or source.get("name", {}).get("label", "")
    _rebind_work_metadata(source_id, target_id, target_label, username)

    rebuild_indices()
    return get_person(target_id)


def _works_referencing(source_id: str) -> tuple[list[str], list[str]]:
    """(_metadata.json teed, kus isik on juurväljal; teosekaustad, kus ta on osas).

    Eelfilter luku VÄLJAS — tegelik muudatus käib värske koopia peal luku all."""
    from ..config import BASE_DIR as data_dir

    root_paths, parts_dirs = [], []
    if not os.path.exists(data_dir):
        return root_paths, parts_dirs
    for work_entry in os.scandir(data_dir):
        if not work_entry.is_dir():
            continue
        meta_path = os.path.join(work_entry.path, "_metadata.json")
        try:
            with open(meta_path, encoding="utf-8") as f:
                meta = json.load(f)
        except (OSError, ValueError):
            continue
        refs = [*(meta.get("creators") or []), *(meta.get("tags") or []), meta.get("publisher")]
        if any(isinstance(r, dict) and r.get("id") == source_id for r in refs):
            root_paths.append(meta_path)
        if any(isinstance(c, dict) and c.get("id") == source_id
               for p in meta.get("parts") or [] if isinstance(p, dict)
               for c in p.get("creators") or []):
            parts_dirs.append(work_entry.path)
    return root_paths, parts_dirs


def _rebind_work_metadata(source_id: str, target_id: str, target_label: str, username: str) -> None:
    """Teoste juurväljad (creators/tags/publisher) source → target.

    `bulk_update_works` kaudu (#615): `metadata_lock` lugemisest kirjutamiseni,
    üks commit, `update_work_facts` ja Meili sünk iga muutunud teose kohta.
    Varem kirjutati faile otse ja samaaegne metaandmete salvestus läks kaduma.
    Osad (`parts[].creators`) EI käi siit — need muudab `merge_person` pärast
    isikulukke `work_parts` kaudu (ADR 0057).
    """
    import copy
    from ..metadata_ops import bulk_update_works

    root_paths, _ = _works_referencing(source_id)
    if not root_paths:
        return

    def transform(meta: dict) -> dict:
        updates = {}
        for field in ("creators", "tags"):
            items = copy.deepcopy(meta.get(field) or [])
            hit = False
            for item in items:
                if isinstance(item, dict) and item.get("id") == source_id:
                    item["id"] = target_id
                    item["label"] = target_label
                    if field == "creators":
                        item["name"] = target_label
                    hit = True
            if hit:
                updates[field] = items
        pub = meta.get("publisher")
        if isinstance(pub, dict) and pub.get("id") == source_id:
            updates["publisher"] = {**pub, "id": target_id, "label": target_label}
        return updates

    bulk_update_works(
        [(p, transform) for p in root_paths], username,
        f"Prosopo liitmine teostes: {source_id} → {target_id} ({target_label})",
        background_tasks=_AsyncTasks,
    )


def _rebind_work_parts(source_id: str, target_id: str, username: str) -> None:
    """Osade loojad source → target. Kutsutakse isikulukkude VÄLJAS: `work_parts`
    võtab `work_lock`-i ja lukkude järjekord peab jääma work_lock → metadata_lock."""
    from .. import work_parts

    _, parts_dirs = _works_referencing(source_id)
    if not parts_dirs:
        return
    target = get_person(target_id) or {}
    target_label = (target.get("name") or {}).get("label") or ""
    for work_dir in parts_dirs:
        try:
            work_parts.rebind_person(work_dir, source_id, target_id, target_label, username)
        except Exception as e:
            state.logger.warning("Osade liitmine ebaõnnestus (%s): %s", work_dir, e)


def merge_person(source_id: str, target_id: str, username: str) -> dict:
    """Liidab source kirje target kirjesse ja sünkroniseerib read-modelid."""
    if source_id == target_id:
        raise ValueError("Source ja target ei tohi olla samad.")
    # Globaalne lukk serialiseerib ka relation-loop'is ja kohaliitmisel võetavad
    # lisalukud; järjestus väldib source/target paaris ebavajalikku ristootamist.
    # ID-lukk kõige välimisena (ADR 0048) — liitmine kannab source'i ID-d
    # target'ile, mis on samuti ID-lisav tee.
    with ext_id_claim_lock, merge_operation_lock:
        with ExitStack() as stack:
            for person_id in sorted((source_id, target_id)):
                stack.enter_context(person_lock(person_id))
            merged = _merge_person_locked(source_id, target_id, username)
    # Kirjade saatjad/saajad jt osade loojad — ilma selleta jäid nad viitama
    # hauakivile (#615). Osa kirjutus uuendab ka oma person_to_works kirjed.
    _rebind_work_parts(source_id, target_id, username)
    return merged


def delete_person(person_id: str, username: str) -> dict:
    """Kustutab isikukaardi jäädavalt, kui viiteid pole."""
    person = get_person(person_id)
    if person is None:
        raise KeyError(person_id)
    if person.get("record_status") == "tombstone":
        raise ValueError(f"Isik on tombstone, kasuta merge: {person_id}")

    ptw = _load_person_to_works()
    work_refs = len(set(w["work_id"] for w in ptw.get(person_id, [])))
    if work_refs > 0:
        raise ValueError(f"WORK_REFS:{work_refs}")

    relation_refs = 0
    for fpath in state._glob.glob(os.path.join(state.PROSOPOGRAPHY_DIR, "*.json")):
        if state.PERSON_IMAGES_DIR_NAME in fpath:
            continue
        try:
            with open(fpath, encoding="utf-8") as f:
                p = json.load(f)
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

    path = _id_to_path(person_id)
    name = (person.get("name") or {}).get("label") or person_id
    state.delete_file_from_git(path, f"Prosopo kustutamine: {name} [{person_id}]", username)

    with state._index_lock:
        index = _load_index()
        index["entries"] = [e for e in index["entries"] if e["id"] != person_id]
        state.atomic_write_json(state.PROSOPOGRAPHY_INDEX_FILE, index)

    _remove_aliases_entry(person_id)

    from . import ext_id_index
    ext_id_index.remove_person(person_id)  # jäädav kustutus (#180)

    return {"deleted": person_id, "work_refs": 0, "relation_refs": 0}


__all__ = ['merge_person', 'delete_person']
