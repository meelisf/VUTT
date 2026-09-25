"""Sünni-/surmakoha Q-kood → kohtade registri koht (#427, ADR 0052).

Register on ajalooline, Wikidata P131 tänapäevane. Ahelat käiakse üles ja
esimene leid võidab: registrikoht annab `parent_key` (grupp päritakse),
grupi ankur (`origin_groups.json` → `wikidata_anchors`) annab ainult `group`.
Kumbagi → koht jääb registrist välja ja kaart saab `place_needs_group`
märke. Nimevaste Q-koodita registrikirjega on ettepanek, mitte seos.

Kolm kihti:
  * `resolve_place` — võrk (Wikidata), EI OLE ühegi luku all;
  * `plan_register_entry` — puhas: otsus + uus kirje;
  * `ensure_register_place` — kirjutab registrisse `places_write_lock`-i all,
    loeb registri luku all uuesti (vahepeal võis sama koha keegi teine lisada).
"""
from __future__ import annotations

import logging
import unicodedata
from typing import Callable, Optional

from ..config import PLACES_FILE
from ..git_ops import save_config_with_git
from . import places_ops as po

logger = logging.getLogger(__name__)

MAX_CHAIN_DEPTH = 6
# Registri võti on ajalooline nimi: saksa silt esimesena, Rootsi ja Soome
# kohtadel rootsi (registris Åbo, Strängnäs — mitte „Gemeinde Strängnäs").
_KEY_LANGS = ("de", "sv", "la", "en", "et")
_KEY_LANGS_SV = ("sv", "de", "la", "en", "et")
_SV_GROUPS = ("rootsi", "soome")


def _norm(s) -> str:
    return unicodedata.normalize("NFC", str(s or "")).strip().casefold()


def _is_qid(v) -> bool:
    return isinstance(v, str) and v.startswith("Q") and v[1:].isdigit()


def load_anchors(groups: Optional[dict] = None) -> dict:
    """{Q-kood: grupp} kõigist gruppidest."""
    groups = po._load_origin_groups() if groups is None else groups
    out: dict = {}
    for g, meta in groups.items():
        for q in (meta or {}).get("wikidata_anchors") or []:
            if _is_qid(q):
                out[q] = g
    return out


def _qid_index(places: dict) -> dict:
    return {e["id"]: k for k, e in places.items() if _is_qid(e.get("id"))}


def resolve_place(qid: str, *, places: dict, anchors: dict,
                  fetch: Callable[[str], Optional[dict]] = None) -> dict:
    """Käib P131 ahelat. Tagastab `{"kind", "qid", "wd", "parent_key", "group", "path"}`.

    kind: `register` (Q-kood on registris; `key`), `chain` (ülemüksus registris →
    `parent_key`), `anchor` (→ `group`), `none`, `error` (Wikidata tõrge).
    Ahel käiakse tasemete kaupa; sama taseme sees võidab registrikoht ankrut.
    """
    fetch = fetch or po.fetch_place_wikidata
    qmap = _qid_index(places)
    if qid in qmap:
        return {"kind": "register", "qid": qid, "key": qmap[qid], "wd": None, "path": [qid]}

    wd = fetch(qid)
    if wd is None:
        return {"kind": "error", "qid": qid, "wd": None, "path": [qid]}
    # Koht ise võib olla ankur (Hamburg, Berliin on liidumaad).
    if qid in anchors:
        return {"kind": "anchor", "qid": qid, "wd": wd, "group": anchors[qid], "path": [qid]}

    frontier, seen = [(qid, wd, [qid])], {qid}
    for _ in range(MAX_CHAIN_DEPTH):
        level = []
        for _cur, data, path in frontier:
            for p in (data or {}).get("parents") or []:
                if p["q"] not in seen:
                    seen.add(p["q"])
                    level.append((p["q"], path + [p["q"]]))
        if not level:
            break
        for pq, path in level:
            if pq in qmap:
                return {"kind": "chain", "qid": qid, "wd": wd, "parent_key": qmap[pq], "path": path}
        for pq, path in level:
            if pq in anchors:
                return {"kind": "anchor", "qid": qid, "wd": wd, "group": anchors[pq], "path": path}
        frontier = []
        for pq, path in level:
            data = fetch(pq)
            if data is None:
                return {"kind": "error", "qid": qid, "wd": wd, "path": path}
            frontier.append((pq, data, path))
    return {"kind": "none", "qid": qid, "wd": wd, "path": [qid]}


def _name_match(labels: dict, places: dict) -> Optional[str]:
    """Q-koodita registrikirje, mille võti / ajalooline nimi / silt kattub."""
    names = {_norm(v) for v in (labels or {}).values() if v}
    if not names:
        return None
    for key, e in places.items():
        if _is_qid(e.get("id")):
            continue
        own = {_norm(key), _norm(key.replace("_", " "))}
        own |= {_norm(n) for n in e.get("historical_names") or []}
        own |= {_norm(v) for v in (e.get("labels") or {}).values() if v}
        if names & own:
            return key
    return None


def _key_langs(group: Optional[str], groups: dict) -> tuple:
    g = group
    for _ in range(3):
        if not g:
            break
        if g in _SV_GROUPS:
            return _KEY_LANGS_SV
        g = (groups.get(g) or {}).get("parent")
    return _KEY_LANGS


def plan_register_entry(res: dict, places: dict, groups: Optional[dict] = None) -> dict:
    """Puhas otsus resolve'i tulemuse põhjal.

    Tagastab ühe:
      `{"action": "exists", "key"}` — Q-kood on registris;
      `{"action": "create", "key", "entry"}` — lisada registrisse;
      `{"action": "name_match", "key"}` — sama nimega kirje (Q-koodita või sama
        võtmega teise Q-koodiga) → ettepanek, mitte peaaegu-duplikaat;
      `{"action": "needs_group"}` — grupp jäi leidmata → admini järjekord;
      `{"action": "error"}`.
    """
    kind = res["kind"]
    if kind == "error":
        return {"action": "error"}
    qmap = _qid_index(places)
    if res["qid"] in qmap:
        return {"action": "exists", "key": qmap[res["qid"]]}
    labels = (res.get("wd") or {}).get("labels") or {}
    match = _name_match(labels, places)
    if match:
        return {"action": "name_match", "key": match}
    if kind == "none":
        return {"action": "needs_group"}

    groups = po._load_origin_groups() if groups is None else groups
    group = res.get("group") if kind == "anchor" else po._walk_to_group(res.get("parent_key"), places)
    key = next((labels[lang] for lang in _key_langs(group, groups) if labels.get(lang)), res["qid"])
    if key in places:
        # Urvaste (vald) vs registri Urvaste (küla): kas sama koht, otsustab admin.
        return {"action": "name_match", "key": key}
    wd = res["wd"] or {}
    entry = {
        "id": res["qid"],
        "labels": labels,
        "type": wd.get("type"),
        "parent_key": res.get("parent_key"),
        "group": res.get("group") if kind == "anchor" else None,
        "historical_names": [],
        "notes": "Automaatselt lisatud Wikidatast (#427): " + " > ".join(res.get("path") or []),
        "coordinates": wd.get("coordinates"),
    }
    return {"action": "create", "key": key, "entry": entry}


def ensure_register_place(qid: str, *, fetch: Callable[[str], Optional[dict]] = None,
                          username: str = "Automaatne") -> dict:
    """Võrk lukust väljas, siis registri kirjutus luku all. Tagastab `plan_register_entry` kuju."""
    if not _is_qid(qid):
        return {"action": "error"}
    places = po._load_places_cache(force_reload=True)
    res = resolve_place(qid, places=places, anchors=load_anchors(), fetch=fetch)
    if res["kind"] == "register":
        return {"action": "exists", "key": res["key"]}

    with po.places_write_lock:
        places = po._load_places_cache(force_reload=True)
        plan = plan_register_entry(res, places)
        if plan["action"] != "create":
            return plan
        places[plan["key"]] = plan["entry"]
        save_config_with_git(PLACES_FILE, places, username,
                             message=f"Koht: lisa {plan['key']} ({qid}) automaatselt (#427)")
        po._load_places_cache(force_reload=True)
    logger.info("Kohtade register: lisatud %s (%s) — %s", plan["key"], qid, res["kind"])
    return plan
