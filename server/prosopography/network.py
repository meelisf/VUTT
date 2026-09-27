# server/prosopography/network.py
"""Isiku seoste võrgustik (#461): üks ehitaja isikulehele ja /persons seoste kaardile.

Allikad (kõik read-modelid, ADR 0007): person_to_works (rollid, mainimiste lehed),
works_creators_index (teose faktid), work_collections_index (kogud → filter ja
restricted), prosopography_index (isikute sildid, päritolu), isikukaardid (pereseosed).
Serv on alati fookuse ja teise isiku vahel, üks serv teose (osadega teosel osa) kohta
(ego-võrgustik). Osa ulatus: #464, ADR 0056 laiendus.
"""
from __future__ import annotations

import json
import os
import threading
from typing import Optional

from . import state
from ._compat import sync_from_facade
from .indices import _collection_descendants, _load_index, _load_person_to_works, _load_work_collections
from .network_rules import classify_pair
from .person_crud import get_person
from .places_ops import _get_place_coordinates, _load_places_cache
from . import work_relations_ops as _wro
from .work_relations_ops import _load_creators_index

# Read-modelid mälus faili allkirja (mtime_ns, suurus) järgi. Iga /network päring luges
# varem neli indeksifaili kettalt (~80 ms ka väikese isiku puhul); isikuleht küsib seda
# igal avamisel. Tuletatud struktuur (nt rollid teose kaupa) hoitakse koos failiga.
_index_cache: dict = {}
_index_lock = threading.Lock()


def _file_sig(path: str) -> tuple:
    try:
        st = os.stat(path)
        return (path, st.st_mtime_ns, st.st_size)
    except OSError:
        return (path, None, None)


def _cached(name: str, path: str, load, derive=lambda x: x):
    sig = _file_sig(path)
    with _index_lock:
        hit = _index_cache.get(name)
        if hit and hit[0] == sig:
            return hit[1]
    value = derive(load())
    with _index_lock:
        _index_cache[name] = (sig, value)
    return value


WORK_SCOPE = None   # ulatus = teose tasand; muidu osa id (#464)


def _roles_by_work(ptw: dict) -> dict:
    """{work_id: {person_id: {ulatus: set(rollid)}, "pages": set}} — pöördindeks ühest päringust.

    Ulatus on osa id või WORK_SCOPE. Osa isik (`part_id`) on ainult oma osas. Mainimine on
    kõigis `part_ids` osades ja lisaks teose tasandil, kui mõni leht jääb osadest välja
    (`part_only` puudub) — ADR 0056 laiendus.
    """
    out: dict = {}
    for pid, entries in ptw.items():
        for e in entries or []:
            wid = e.get("work_id")
            if not wid:
                continue
            slot = out.setdefault(wid, {}).setdefault(pid, {"scopes": {}, "pages": set()})
            role = e.get("role") or "creator"
            if e.get("part_id"):
                scopes = [e["part_id"]]
            else:
                scopes = list(e.get("part_ids") or [])
                if not e.get("part_only"):
                    scopes.append(WORK_SCOPE)
            for scope in scopes:
                slot["scopes"].setdefault(scope, set()).add(role)
            slot["pages"].update(e.get("pages") or [])
    return out


# Osa koha liik: kiri saadetakse kohast, istung ja kõne toimuvad kohas (#464).
_PART_PLACE_KIND = {"letter": "sent_from", "session": "event", "speech": "event"}


def _edge_place(fact: dict, part: Optional[dict]) -> Optional[dict]:
    if part and part.get("place") and part.get("kind") in _PART_PLACE_KIND:
        return {"id": part["place"].get("id"), "label": part["place"].get("label") or "",
                "kind": _PART_PLACE_KIND[part["kind"]]}
    loc = fact.get("location")
    return {"id": loc.get("id"), "label": loc.get("label") or "", "kind": "print"} if loc else None


def _scope_pages(pages: set, fact: dict, scope) -> list:
    """Tõendi lehed ulatuse piires: osa lehed või (osadega teosel) osadest välja jäävad."""
    parts = fact.get("parts") or {}
    if scope is not WORK_SCOPE:
        return sorted(pages & set((parts.get(scope) or {}).get("pages") or []))
    in_parts = {n for p in parts.values() for n in p.get("pages") or []}
    return sorted(pages - in_parts)


def _person_view(entry: Optional[dict], pid: str, card: Optional[dict] = None) -> dict:
    """Isik vastuse jaoks: indeksikirjest, puudumisel kaardist."""
    e = entry or {}
    label = e.get("label") or ((card or {}).get("name") or {}).get("label") or pid
    origin = None
    if e.get("origin_place") or e.get("origin_place_id"):
        origin = {"place": e.get("origin_place"), "place_id": e.get("origin_place_id"),
                  "coordinates": e.get("origin_coordinates")}
    return {"id": pid, "label": label, "birth_year": e.get("birth_year"),
            "death_year": e.get("death_year"), "origin": origin}


def _place_coords(location: Optional[dict]) -> Optional[dict]:
    """Trükikoha koordinaadid kohtade registrist.

    Järjekord: Q-kood → registri võti → sildid (et/en/de/la/sv) → ajaloolised nimekujud.
    Sildi tagavara on vajalik: teose kohal võib Q-kood puududa („Berliin") või olla
    registris teine (Pärnu kandis kuni 2026-09-26 olematut Q164673-t), samas kui
    registri võti on ajalooline nimi („Berlin", „Pernau").
    """
    if not location:
        return None
    places = _load_places_cache()
    key = None
    if location.get("id"):
        key = next((k for k, v in places.items() if isinstance(v, dict) and v.get("id") == location["id"]), None)
    label = location.get("label")
    if key is None and label:
        if label in places:
            key = label
        else:
            key = next((k for k, v in places.items() if isinstance(v, dict) and (
                label in (v.get("labels") or {}).values() or label in (v.get("historical_names") or [])
            )), None)
    return _get_place_coordinates(key) if key else None


def _is_public(collections_of_work: list) -> bool:
    from ..access_ops import is_work_public
    return is_work_public({"collections": collections_of_work})


# Pöördkaart {sihtisik: [(allikas, tüüp)]} kõigist kaartidest. Kõigi ~2350 kaardi
# parsimine igal avalikul päringul oleks ~80 ms GIL-i all (#461 arvustus), seega
# ehitatakse kaart uuesti ainult siis, kui kaardikausta allkiri muutub. Allkiri on
# scandir-i stat (failide arv + mtime-d), mis on JSON-i lugemisest palju odavam.
# Kaardi salvestus käib atomic write'iga (uus fail + rename) → mtime muutub alati.
_reverse_lock = threading.Lock()
_reverse_cache: dict = {"sig": None, "map": {}}


def _cards_signature(directory: str) -> tuple:
    count = total = latest = 0
    try:
        with os.scandir(directory) as it:
            for entry in it:
                if entry.name.endswith(".json") and entry.is_file():
                    mtime = entry.stat().st_mtime_ns
                    count += 1
                    total += mtime
                    latest = max(latest, mtime)
    except FileNotFoundError:
        pass
    return (directory, count, total, latest)


def _reverse_relations() -> dict:
    sig = _cards_signature(state.PROSOPOGRAPHY_DIR)
    with _reverse_lock:
        if _reverse_cache["sig"] == sig:
            return _reverse_cache["map"]
        rev: dict = {}
        for path in state._glob.glob(os.path.join(state.PROSOPOGRAPHY_DIR, "*.json")):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    card = json.load(f)
            except Exception:
                continue
            oid = card.get("id")
            if not oid or card.get("record_status") == "tombstone":
                continue
            for r in card.get("relations") or []:
                if isinstance(r, dict) and isinstance(r.get("target_id"), str):
                    rev.setdefault(r["target_id"], []).append((oid, r.get("type")))
        _reverse_cache["sig"] = sig
        _reverse_cache["map"] = rev
        return rev


def _family_records(person_id: str, focus_card: dict) -> dict:
    """{teine_id: [{source_id, target_id, type}]} mõlemast suunast, tombstone'ideta."""
    recs: dict = {}

    def add(src: str, tgt: str, typ):
        other = tgt if src == person_id else src
        if other == person_id or not isinstance(other, str) or not other.startswith("vutt:P"):
            return
        rec = {"source_id": src, "target_id": tgt, "type": typ or None}
        if rec not in recs.setdefault(other, []):
            recs[other].append(rec)

    for r in focus_card.get("relations") or []:
        if isinstance(r, dict):
            add(person_id, r.get("target_id"), r.get("type"))
    for oid, typ in _reverse_relations().get(person_id, []):
        if oid != person_id:
            add(oid, person_id, typ)
    return recs


def build_person_network(person_id: str, collection: Optional[str] = None) -> Optional[dict]:
    sync_from_facade()
    card = get_person(person_id)
    if card is None:
        return None
    index = _cached("index", state.PROSOPOGRAPHY_INDEX_FILE, _load_index,
                    lambda d: {e.get("id"): e for e in d.get("entries", [])})
    facts = _cached("facts", _wro.WORKS_CREATORS_INDEX_FILE, _load_creators_index)
    wc = _cached("wc", state.WORK_COLLECTIONS_INDEX_FILE, _load_work_collections)
    allowed_cols = None
    if collection:
        from ..cache import get_cached_collections
        allowed_cols = _collection_descendants(collection, get_cached_collections() or {})

    by_work = _cached("by_work", state.PERSON_TO_WORKS_FILE, _load_person_to_works, _roles_by_work)
    edges: list = []
    works: dict = {}
    parts_out: dict = {}
    others: set = set()
    focus_works = {w for w, members in by_work.items() if person_id in members}
    for wid in sorted(focus_works):
        fact = facts.get(wid)
        if fact is None:
            continue          # ptw vananenud või teos kustutatud — tõendita serva ei tehta
        cols = wc.get(wid) or []
        if allowed_cols is not None and not (allowed_cols & set(cols)):
            continue
        mine = by_work[wid][person_id]
        fact_parts = fact.get("parts") or {}
        for oid, theirs in sorted(by_work[wid].items()):
            if oid == person_id:
                continue
            # Paar ainult ühises ulatuses: teose tasand teose tasandiga, osa sama osaga.
            shared = sorted(set(mine["scopes"]) & set(theirs["scopes"]), key=lambda x: (x is not None, x or ""))
            for scope in shared:
                a_roles, b_roles = mine["scopes"][scope], theirs["scopes"][scope]
                kind, direction = classify_pair(a_roles, b_roles)
                if direction == "ab":
                    frm, to, directed = person_id, oid, True
                elif direction == "ba":
                    frm, to, directed = oid, person_id, True
                else:
                    frm, to = sorted((person_id, oid))
                    directed = False
                part = fact_parts.get(scope) if scope is not WORK_SCOPE else None
                evidence = {"work_id": wid,
                            "pages": _scope_pages(mine["pages"] | theirs["pages"], fact, scope)}
                if scope is not WORK_SCOPE:
                    evidence["part_id"] = scope
                    if part and scope not in parts_out:
                        parts_out[scope] = {"work_id": wid, "part_id": scope, "kind": part.get("kind"),
                                            "title": part.get("title") or "", "year": part.get("year"),
                                            "first_page": part.get("first_page")}
                edges.append({
                    "kind": kind, "from": frm, "to": to, "directed": directed,
                    "roles": {person_id: sorted(a_roles), oid: sorted(b_roles)},
                    "year": ((part or {}).get("year") or fact.get("year")),
                    "place": _edge_place(fact, part),
                    "evidence": evidence,
                })
            if not shared:
                continue
            others.add(oid)
            loc = fact.get("location")
            if wid not in works:
                works[wid] = {"work_id": wid, "title": fact.get("title") or "", "year": fact.get("year"),
                              "place": ({**loc, "coordinates": _place_coords(loc)} if loc else None),
                              "genres": fact.get("genres") or [], "restricted": not _is_public(cols),
                              "manuscript": bool(fact.get("manuscript"))}

    for oid, recs in _family_records(person_id, card).items():
        frm, to = sorted((person_id, oid))
        edges.append({"kind": "family", "from": frm, "to": to, "directed": False, "records": recs,
                      "year": None, "place": None, "evidence": None})
        others.add(oid)

    persons = []
    for oid in sorted(others):
        entry = index.get(oid)
        persons.append(_person_view(entry, oid, None if entry else get_person(oid)))
    return {"focus": _person_view(index.get(person_id), person_id, card),
            "persons": persons, "works": list(works.values()), "parts": list(parts_out.values()),
            "edges": edges}
