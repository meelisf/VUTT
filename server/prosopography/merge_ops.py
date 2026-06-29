"""Prosopograafia suuremad admin-operatsioonid: merge ja delete."""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone

from . import _legacy_ops as legacy
from . import state
from ._compat import sync_from_facade


def merge_person(source_id: str, target_id: str, username: str) -> dict:
    """
    Liidab source kirje target kirjesse ja sünkroniseerib read-modelid.
    """
    sync_from_facade()
    if source_id == target_id:
        raise ValueError("Source ja target ei tohi olla samad.")

    source = legacy.get_person(source_id)
    target = legacy.get_person(target_id)

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
        src_val = source.get(field)
        tgt_val = target.get(field)
        src_date = (src_val or {}).get("date") if isinstance(src_val, dict) else None
        tgt_date = (tgt_val or {}).get("date") if isinstance(tgt_val, dict) else None
        if src_date and not tgt_date:
            target[field] = src_val
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

    if source.get("biography") and not target.get("biography"):
        target["biography"] = source["biography"]
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
        [(legacy._id_to_path(target_id), json.dumps(target, ensure_ascii=False, indent=2))]
        if target_changed else None
    )
    state.save_with_git(
        legacy._id_to_path(source_id),
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
        changed = False
        for rel in p.get("relations", []):
            if rel.get("target_id") == source_id:
                rel["target_id"] = target_id
                changed = True
        if changed:
            p["updated_at"] = now
            p["updated_by"] = username
            state.atomic_write_json(fpath, p)

    target_label = (target.get("name") or {}).get("label") or source.get("name", {}).get("label", "")
    from ..config import BASE_DIR as data_dir
    from ..meilisearch_ops import sync_work_to_meilisearch_async

    changed_files = []
    if os.path.exists(data_dir):
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
                if isinstance(c, dict) and c.get("id") == source_id:
                    c["id"] = target_id
                    c["label"] = target_label
                    c["name"] = target_label
                    changed = True
            for tag in meta.get("tags", []):
                if isinstance(tag, dict) and tag.get("id") == source_id:
                    tag["id"] = target_id
                    tag["label"] = target_label
                    changed = True
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
        state.save_with_git(primary_path, primary_content, username,
                             message=commit_msg, additional_files=additional)
        for meta_path, _ in changed_files:
            dir_name = os.path.basename(os.path.dirname(meta_path))
            sync_work_to_meilisearch_async(dir_name)

    legacy.rebuild_indices()
    return legacy.get_person(target_id)


def delete_person(person_id: str, username: str) -> dict:
    """Kustutab isikukaardi jäädavalt, kui viiteid pole."""
    sync_from_facade()
    person = legacy.get_person(person_id)
    if person is None:
        raise KeyError(person_id)
    if person.get("record_status") == "tombstone":
        raise ValueError(f"Isik on tombstone, kasuta merge: {person_id}")

    ptw = legacy._load_person_to_works()
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

    path = legacy._id_to_path(person_id)
    name = (person.get("name") or {}).get("label") or person_id
    state.delete_file_from_git(path, f"Prosopo kustutamine: {name} [{person_id}]", username)

    with state._index_lock:
        index = legacy._load_index()
        index["entries"] = [e for e in index["entries"] if e["id"] != person_id]
        state.atomic_write_json(state.PROSOPOGRAPHY_INDEX_FILE, index)

    legacy._remove_aliases_entry(person_id)

    return {"deleted": person_id, "work_refs": 0, "relation_refs": 0}


__all__ = ['merge_person', 'delete_person']
