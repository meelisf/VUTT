"""Prosopograafia tuletatud indeksid ja kollektsiooniseosed."""
from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from typing import Any, Optional

from . import fresh_merge, state
from ._compat import sync_from_facade
from ..meili_doc import enumerate_page_images


def page_person_ids(page_data: Optional[dict]) -> set[str]:
    """Lehe JSON-i (ümbrisega või ilma) `vutt:P` isikutägid — ÜKS reegel, mida
    kasutavad nii teose skann kui salvestuse muutusekontroll (#420)."""
    if not isinstance(page_data, dict):
        return set()
    source = page_data.get('meta_content', page_data)
    if not isinstance(source, dict):
        return set()
    return {
        tag['id'] for tag in source.get('page_tags') or []
        if isinstance(tag, dict) and isinstance(tag.get('id'), str)
        and tag['id'].startswith('vutt:P')
    }


def mention_entries(work_id: str, work_dir: str, parts: Optional[list] = None) -> dict[str, dict]:
    """{person_id: 'mentioned' kirje} — ÜKS ehitaja uuendusele ja rebuildile (ADR 0007).

    Osadega teosel (#464) saab kirje `part_ids` (osad, kuhu mõni mainimise leht kuulub)
    ja `part_only: True`, kui ükski mainimise leht ei jää osadest välja. Seoste ehitaja
    paaritab mainimise siis ainult nende osade isikutega.
    """
    stem_parts: dict[str, list[str]] = {}
    for p in parts or []:
        if isinstance(p, dict) and p.get('id'):
            for stem in p.get('pages') or []:
                stem_parts.setdefault(stem, []).append(p['id'])
    out: dict[str, dict] = {}
    for pid, found in _scan_page_mentions(work_dir).items():
        entry: dict = {'work_id': work_id, 'role': 'mentioned', 'pages': found['pages']}
        if stem_parts:
            part_ids = sorted({x for s in found['stems'] for x in stem_parts.get(s, [])})
            if part_ids:
                entry['part_ids'] = part_ids
                if all(s in stem_parts for s in found['stems']):
                    entry['part_only'] = True
        out[pid] = entry
    return out


def _scan_page_mentions(work_dir: str) -> dict[str, dict]:
    """{person_id: {'pages': [nr], 'stems': [tüvi]}} teose leheküljefailide isikutägidest.

    Leheküljenumber on 1-põhine positsioon `enumerate_page_images` järjekorras —
    sama numeratsioon, mida kasutavad vaade /work/{id}/{nr} ja Meilisearch.
    Ilma pildita .json (orb) loeb isiku ikka mainituks, aga numbrita.
    """
    mentions: dict[str, dict] = {}
    try:
        page_nums = {
            os.path.splitext(img)[0]: idx
            for idx, img in enumerate(enumerate_page_images(work_dir), start=1)
        }
    except Exception:
        page_nums = {}

    try:
        page_files = sorted(os.listdir(work_dir))
    except Exception:
        return mentions

    for page_fname in page_files:
        if not page_fname.endswith('.json') or page_fname == '_metadata.json':
            continue
        try:
            with open(os.path.join(work_dir, page_fname), 'r', encoding='utf-8') as f:
                page_data = json.load(f)
        except Exception:
            continue
        stem = os.path.splitext(page_fname)[0]
        page_num = page_nums.get(stem)
        for pid in page_person_ids(page_data):
            found = mentions.setdefault(pid, {'pages': [], 'stems': []})
            found['stems'].append(stem)
            if page_num is not None and page_num not in found['pages']:
                found['pages'].append(page_num)

    for found in mentions.values():
        found['pages'].sort()
    return mentions


def _load_json_or_default(path: str, default: Any) -> Any:
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return default


def _load_index() -> dict:
    sync_from_facade()
    return _load_json_or_default(state.PROSOPOGRAPHY_INDEX_FILE, {"rebuilt_at": None, "entries": []})


def _load_person_to_works() -> dict:
    sync_from_facade()
    return _load_json_or_default(state.PERSON_TO_WORKS_FILE, {})


def _load_work_collections() -> dict:
    sync_from_facade()
    return _load_json_or_default(state.WORK_COLLECTIONS_INDEX_FILE, {})


def update_work_collections(work_id: str, collections: list) -> None:
    """Uuendab work_collections_index.json üht kirjet teose salvestamisel."""
    if not work_id:
        return
    sync_from_facade()
    with state._work_collections_lock:
        data = _load_work_collections()
        if collections:
            data[work_id] = list(collections)
        else:
            data.pop(work_id, None)
        state.atomic_write_json(state.WORK_COLLECTIONS_INDEX_FILE, data)


def _collection_descendants(collection_id: str, collections: dict) -> set:
    """Tagastab {collection_id} ∪ kõik järglased (rekursiivselt) konfi põhjal."""
    target = {collection_id}
    changed = True
    while changed:
        changed = False
        for cid, col in (collections or {}).items():
            if isinstance(col, dict) and col.get("parent") in target and cid not in target:
                target.add(cid)
                changed = True
    return target


ACADEMIA_INSTITUTION_NAMES = frozenset({"Academia Gustaviana", "Academia Gustavo-Carolina"})

# Teosevälise kuuluvuse kaardistus peab olema eksplitsiitne, mitte tuletatud
# kollektsiooni kuvanimest: admin võib kuvanime muuta, aga domeeniseos jääb samaks.
COLLECTION_EDUCATION_INSTITUTIONS = {
    "academia-gustaviana": frozenset({"Academia Gustaviana"}),
    "academia-gustavo-carolina": frozenset({"Academia Gustavo-Carolina"}),
}


def _normalize_membership_label(value: str) -> str:
    """Normaliseerib asutuse nime kuuluvuse võrdluseks."""
    value = re.sub(r"\s*\([^)]*\)", " ", value or "")
    value = re.sub(r"\s+", " ", value).strip().lower()
    return value


def _collection_membership_institutions(collection_id: str, collections: dict) -> set:
    """Eksplitsiitselt kaardistatud haridusasutused kollektsioonile ja alamkollektsioonidele."""
    labels = set()
    for cid in _collection_descendants(collection_id, collections):
        for institution in COLLECTION_EDUCATION_INSTITUTIONS.get(cid, ()):
            normalized = _normalize_membership_label(institution)
            if normalized:
                labels.add(normalized)
    return labels


def _entry_matches_collection_membership(entry: dict, institutions: set) -> bool:
    """Kas indeksikirje kuulub kollektsiooni teosevälise asutusekuuluvuse kaudu."""
    if not institutions:
        return False
    for inst in entry.get("education_institutions") or []:
        if isinstance(inst, str) and _normalize_membership_label(inst) in institutions:
            return True
    return False


def _persons_in_collection(collection_id: str) -> set:
    """Isikute id-d, kes kuuluvad kollektsiooni või alamkollektsioonidesse."""
    from ..cache import get_cached_collections

    sync_from_facade()
    collections = get_cached_collections() or {}
    target = _collection_descendants(collection_id, collections)
    wc = _load_work_collections()
    ptw = _load_person_to_works()
    result = {
        pid for pid, entries in ptw.items()
        if any(target & set(wc.get(e.get("work_id"), ())) for e in entries)
    }

    membership_institutions = _collection_membership_institutions(collection_id, collections)
    for entry in _load_index().get("entries", []):
        pid = entry.get("id")
        if pid and entry.get("record_status") != "tombstone" and _entry_matches_collection_membership(entry, membership_institutions):
            result.add(pid)
    return result


def _persons_in_work_set(work_ids) -> set:
    """Isikud, kes on seotud MÕNE antud teosega (#354).

    Sisendiks tuleb juba KUTSUJALE NÄHTAV teoste loend (`search_visible_work_ids`) —
    siin õigusi enam ei kontrollita. Erinevalt kollektsioonist ei ole
    töökollektsioonil hierarhiat ega liikmesus-institutsioone: liikmesus on
    sõnaselge loend, mitte tuletatud reegel.
    """
    sync_from_facade()
    target = set(work_ids or ())
    if not target:
        return set()
    ptw = _load_person_to_works()
    return {
        pid for pid, entries in ptw.items()
        if any(e.get("work_id") in target for e in entries)
    }


def _person_collections(person_id: str) -> list:
    """Kollektsioonid, kuhu isiku teosed kuuluvad; dedup esmaesinemise järjekorras."""
    sync_from_facade()
    wc = _load_work_collections()
    ptw = _load_person_to_works()
    result: list = []
    for entry in ptw.get(person_id, ()):
        for cid in wc.get(entry.get("work_id"), ()):
            if cid not in result:
                result.append(cid)
    return result


def _update_index_entry(person: dict):
    """Uuendab ühe kirje prosopography_index.json-s.

    Väliste ID-de indeksit (`ext_id_index`) SIIN EI uuendata: see käib
    `person_crud._save_person_locked`-is salvestusega samas kriitilises
    sektsioonis (ADR 0048). See funktsioon jookseb pärast luku vabastamist ja
    võib saada aegunud koopia — otsinguindeksile on see talutav, duplikaadikontrollile mitte.
    """
    sync_from_facade()
    from .person_search import _index_entry_from_person

    person_id = person["id"]
    works = _load_person_to_works()
    work_count = len(set(w["work_id"] for w in works.get(person_id, [])))
    new_entry = _index_entry_from_person(person, work_count)

    with state._index_lock:
        index = _load_index()
        entries = [e for e in index["entries"] if e["id"] != person_id]
        if person.get("record_status") != "tombstone":
            entries.append(new_entry)
        index["entries"] = entries
        state.atomic_write_json(state.PROSOPOGRAPHY_INDEX_FILE, index)


def _on_kaardi_voti(key: str) -> bool:
    """Kas see person_aliases.json võti kuulub kaardipõhisele kirjutajale?

    Kaardipoole võtmed on isiku ID-d (`vutt:P…`); kõik muu on `people_ops`
    kirjutatud välise ID (Wikidata Q-kood, GND-number) kirje (#347).
    """
    return isinstance(key, str) and key.startswith("vutt:")


def _update_aliases_entry(person: dict):
    """Uuendab person_aliases.json — vutt:P ID → nimevariandid."""
    sync_from_facade()
    person_id = person["id"]
    name_obj = person.get("name") or {}
    label = name_obj.get("label") or ""
    aliases = name_obj.get("aliases") or []
    all_names = list({label} | set(aliases))

    from .person_search import _load_person_aliases

    with state._aliases_lock:
        data = _load_person_aliases()
        if person.get("record_status") == "tombstone":
            data.pop(person_id, None)
        else:
            data[person_id] = {
                "primary_name": label,
                "aliases": all_names,
                "ids": {},
            }
        state.atomic_write_json(state.PERSON_ALIASES_FILE, data)


def metadata_entries(work_id: str, meta: dict) -> dict[str, list[dict]]:
    """{person_id: [kirje]} teose metaandmetest — ÜKS ehitaja uuendusele ja rebuildile.

    Teose rollid: `creators[]`, isikutägid (`subject`), `publisher`. Osa isikud (#464)
    saavad `part_id`: sama isik võib olla nii teose kui mitme osa tasandil.
    """
    out: dict[str, list[dict]] = {}

    def add(pid, role, part_id=None):
        if not isinstance(pid, str) or not pid.startswith("vutt:P"):
            return
        entry = {"work_id": work_id, "role": role}
        if part_id:
            entry["part_id"] = part_id
        if entry not in out.setdefault(pid, []):
            out[pid].append(entry)

    for creator in meta.get("creators") or []:
        add(creator.get("id"), creator.get("role") or "creator")
    for tag in meta.get("tags") or []:
        if isinstance(tag, dict) and tag.get("entity_type") == "person":
            add(tag.get("id"), "subject")
    publisher = meta.get("publisher")
    if isinstance(publisher, dict):
        add(publisher.get("id"), "publisher")
    for part in meta.get("parts") or []:
        if isinstance(part, dict) and part.get("id"):
            for creator in part.get("creators") or []:
                if isinstance(creator, dict):
                    add(creator.get("id"), creator.get("role") or "creator", part["id"])
    return out


def update_person_to_works(
    work_id: str,
    creators: list,
    tags: list,
    publisher=None,
    title: str = "",
    year: Optional[int] = None,
    parts: Optional[list] = None,
):
    """Uuendab person_to_works.json pöördindeksit ühe teose salvestamisel."""
    sync_from_facade()
    new_by_pid = metadata_entries(work_id, {
        "creators": creators, "tags": tags, "publisher": publisher, "parts": parts,
    })

    with state._works_lock:
        data = _load_person_to_works()

        # Eemalda selle teose metaandmetest tuletatud viited.
        # 'mentioned' tuleb leheküljefailide page_tags-ist (update_page_person_mentions)
        # — seda me siin uuesti ei arvuta, seega ei tohi seda ka kustutada.
        for pid_entries in data.values():
            pid_entries[:] = [
                e for e in pid_entries
                if e.get("work_id") != work_id or e.get("role") == "mentioned"
            ]

        # Lisa uued.
        for pid, entries in new_by_pid.items():
            data.setdefault(pid, []).extend(entries)

        state.atomic_write_json(state.PERSON_TO_WORKS_FILE, data)

    # Teose faktid (works_creators_index) kirjutab AINULT update_work_facts, mida
    # metaandmete kirjutajad kutsuvad tingimusteta (#461). Siin kutsutud vana kirjutaja
    # kirjutas kirje üle ilma location/genres-ita ja kustutas loojateta teose.


def rebuild_indices():
    """Taastab prosopograafia read-modelid nullist.

    Jookseb taustal, kui API juba kirjutab (#417): baasseis loetakse ENNE
    lähteandmeid ja avaldamine jätab vahepeal kirjutatud võtmed kettalt
    (`fresh_merge`). Uus indeksi kirjutaja peab kirjutama oma indeksi luku all.
    """
    sync_from_facade()
    if not os.path.exists(state.PROSOPOGRAPHY_DIR):
        return

    from .person_search import _load_person_aliases
    base_ptw = fresh_merge.ptw_groups(_load_person_to_works())
    base_wc = _load_work_collections()
    base_index = _index_by_id(_load_index())
    base_aliases = _vutt_keys(_load_person_aliases())

    all_persons = []
    for fname in os.listdir(state.PROSOPOGRAPHY_DIR):
        if not fname.endswith(".json"):
            continue
        path = os.path.join(state.PROSOPOGRAPHY_DIR, fname)
        try:
            with open(path, "r", encoding="utf-8") as f:
                person = json.load(f)
            all_persons.append(person)
        except Exception:
            continue

    ptw: dict[str, list] = {}
    wc: dict[str, list] = {}
    if os.path.exists(state.BASE_DIR):
        for entry in os.scandir(state.BASE_DIR):
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
            cols = meta.get("collections") or []
            if cols:
                wc[work_id] = list(cols)
            for pid, entries in metadata_entries(work_id, meta).items():
                ptw.setdefault(pid, []).extend(entries)
            for pid, mention in mention_entries(work_id, entry.path, meta.get("parts")).items():
                ptw.setdefault(pid, []).append(mention)

    with state._works_lock:
        ptw = fresh_merge.ptw_from_groups(fresh_merge.merge_fresh(
            fresh_merge.ptw_groups(ptw), base_ptw,
            fresh_merge.ptw_groups(_load_person_to_works())))
        state.atomic_write_json(state.PERSON_TO_WORKS_FILE, ptw)

    with state._work_collections_lock:
        wc = fresh_merge.merge_fresh(wc, base_wc, _load_work_collections())
        state.atomic_write_json(state.WORK_COLLECTIONS_INDEX_FILE, wc)

    try:
        state.build_works_creators_index()
    except Exception:
        state.logger.exception("build_works_creators_index viga rebuild_indices sees")

    entries = {}
    aliases_data = {}
    for person in all_persons:
        if person.get("record_status") == "tombstone" or person.get("merged_into"):
            continue
        pid = person["id"]
        works_list = ptw.get(pid, [])
        work_count = len({w["work_id"] for w in works_list})
        from .person_search import _index_entry_from_person
        entries[pid] = _index_entry_from_person(person, work_count)

        name_obj = person.get("name") or {}
        label = name_obj.get("label") or ""
        person_aliases = name_obj.get("aliases") or []
        all_names = list({label} | set(person_aliases))
        aliases_data[pid] = {
            "primary_name": label,
            "aliases": all_names,
            "ids": {},
        }

    with state._index_lock:
        merged = fresh_merge.merge_fresh(entries, base_index, _index_by_id(_load_index()))
        state.atomic_write_json(state.PROSOPOGRAPHY_INDEX_FILE, {
            "rebuilt_at": datetime.now(timezone.utc).isoformat(),
            "entries": sorted(merged.values(), key=lambda e: (e.get("sort_name") or "").lower()),
        })

    with state._aliases_lock:
        # person_aliases.json-il on KAKS kirjutajat eri võtmeruumis (#347):
        # siin ehitatakse kaardipõhine pool (`vutt:P…`) nullist, aga
        # `people_ops.update_person_async` kirjutab samasse faili Wikidata/GND
        # võtmeid (`Q…`, GND-number). Tervikuna ülekirjutamine pühkis need iga
        # serveri stardi ajal minema ja Meili `authors_text` jäi ilma
        # nimevariantideta. Võõrad võtmed lähevad seetõttu muutmata edasi.
        olemasolev = _load_person_aliases()
        aliases_data = fresh_merge.merge_fresh(aliases_data, base_aliases, _vutt_keys(olemasolev))
        for key, value in olemasolev.items():
            if not _on_kaardi_voti(key):
                aliases_data.setdefault(key, value)
        state.atomic_write_json(state.PERSON_ALIASES_FILE, aliases_data)

    # Väliste ID-de pöördindeks: EI asendata rebuild alguses loetud hetktõmmisest
    # ehitatud kaardiga — vahepeal (rebuild kestab, salvestused jätkuvad) lisatud
    # ID-d kaoksid siis indeksist. `invalidate()` sunnib järgmise päringu laisale
    # taasehitusele värske kaustaskanni pealt; claim-lukk on RLock, seega ohutu
    # ka liitmise seest kutsutuna.
    from . import ext_id_index
    from .locks import ext_id_claim_lock
    with ext_id_claim_lock:
        ext_id_index.invalidate()


def _index_by_id(index: dict) -> dict:
    return {e["id"]: e for e in index.get("entries") or [] if isinstance(e, dict) and e.get("id")}


def _vutt_keys(aliases: dict) -> dict:
    """Kaardipoolsed (`vutt:P…`) võtmed — taaste omab ainult neid (#347)."""
    return {k: v for k, v in aliases.items() if _on_kaardi_voti(k)}


def _remove_aliases_entry(person_id: str):
    """Eemaldab person_aliases.json-st kõik viited person_id-le.

    Luku all: taaste avaldamine (#417) võrdleb kettaseisu baasseisuga ja
    lukuta kirjutus võiks jääda avaldamise vahele.
    """
    sync_from_facade()
    from .person_search import _load_person_aliases
    with state._aliases_lock:
        data = _load_person_aliases()
        if person_id in data:
            del data[person_id]
            state.atomic_write_json(state.PERSON_ALIASES_FILE, data)

__all__ = ['_load_index', '_load_person_to_works', '_load_work_collections', 'update_work_collections', '_collection_descendants', '_persons_in_collection', '_person_collections', '_update_index_entry', '_update_aliases_entry', 'update_person_to_works', 'rebuild_indices', '_remove_aliases_entry']
