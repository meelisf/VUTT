# server/prosopography/network.py
"""Isiku seoste võrgustik (#461): üks ehitaja isikulehele ja /persons seoste kaardile.

Allikad (kõik read-modelid, ADR 0007): person_to_works (rollid, mainimiste lehed),
works_creators_index (teose faktid), work_collections_index (kogud → filter ja
restricted), prosopography_index (isikute sildid, päritolu), isikukaardid (pereseosed).
Serv on alati fookuse ja teise isiku vahel, üks serv teose kohta (ego-võrgustik).
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
from .work_relations_ops import _load_creators_index


def _roles_by_work(ptw: dict) -> dict:
    """{work_id: {person_id: {"roles": set, "pages": set}}} — pöördindeks ühest päringust."""
    out: dict = {}
    for pid, entries in ptw.items():
        for e in entries or []:
            wid = e.get("work_id")
            if not wid:
                continue
            slot = out.setdefault(wid, {}).setdefault(pid, {"roles": set(), "pages": set()})
            slot["roles"].add(e.get("role") or "creator")
            slot["pages"].update(e.get("pages") or [])
    return out


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
    index = {e.get("id"): e for e in _load_index().get("entries", [])}
    facts = _load_creators_index()
    wc = _load_work_collections()
    allowed_cols = None
    if collection:
        from ..cache import get_cached_collections
        allowed_cols = _collection_descendants(collection, get_cached_collections() or {})

    by_work = _roles_by_work(_load_person_to_works())
    edges: list = []
    works: dict = {}
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
        for oid, theirs in sorted(by_work[wid].items()):
            if oid == person_id:
                continue
            kind, direction = classify_pair(mine["roles"], theirs["roles"])
            if direction == "ab":
                frm, to, directed = person_id, oid, True
            elif direction == "ba":
                frm, to, directed = oid, person_id, True
            else:
                frm, to = sorted((person_id, oid))
                directed = False
            loc = fact.get("location")
            edges.append({
                "kind": kind, "from": frm, "to": to, "directed": directed,
                "roles": {person_id: sorted(mine["roles"]), oid: sorted(theirs["roles"])},
                "year": fact.get("year"),
                "place": {"id": loc.get("id"), "kind": "print"} if loc else None,
                "evidence": {"work_id": wid, "pages": sorted(mine["pages"] | theirs["pages"])},
            })
            others.add(oid)
            if wid not in works:
                works[wid] = {"work_id": wid, "title": fact.get("title") or "", "year": fact.get("year"),
                              "place": ({**loc, "coordinates": _place_coords(loc)} if loc else None),
                              "genres": fact.get("genres") or [], "restricted": not _is_public(cols)}

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
            "persons": persons, "works": list(works.values()), "edges": edges}
