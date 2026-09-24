"""Isikupaneeli kandidaatide kokkuvõtted (spekk §4.1).

Kokkuvõte ehitatakse SAMADEST parseritest mis rikastus (`enrichment`), et
paneel näitaks täpselt seda, mis kaardile loomisel kirjutatakse. Lukke siin
ei võeta — ainult loetakse välisallikaid ja VUTT-i indekseid.
"""
from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor, wait
from typing import Optional

from . import enrichment
from .enrichment import natural_name_order
from .ext_ids import normalize_ext_id

_WD_NAME_LANGS = ("et", "en", "de", "la", "sv", "mul")
_MAX_REFS = 15
_BUDGET_S = 8.0


def _date_unit(r: dict, prefix: str) -> dict:
    place = r.get(f"{prefix}.place")
    return {"date": r.get(f"{prefix}.date"), "precision": r.get(f"{prefix}.precision"),
            "place": place if isinstance(place, dict) and place.get("label") else None}


def _fields(r: dict) -> dict:
    occ = r.get("_occupations") or ([{"label": r["_occupation_label"]}]
                                    if r.get("_occupation_label") else [])
    return {"birth": _date_unit(r, "birth"), "death": _date_unit(r, "death"),
            "occupations": [{"id": o.get("id"), "label": o.get("label")} for o in occ if o.get("label")]}


def _links(r: dict) -> dict:
    return {k.removeprefix("_linked_"): v for k, v in r.items()
            if k in ("_linked_wikidata", "_linked_gnd", "_linked_viaf") and v}


def _names_plain(label: Optional[str], aliases) -> list:
    out = [{"text": label, "lang": None, "kind": "label"}] if label else []
    out += [{"text": a, "lang": None, "kind": "alias"} for a in aliases or [] if a and a != label]
    return out


def _wikidata(qid: str) -> Optional[dict]:
    if not re.fullmatch(r"Q\d+", qid or ""):
        return None
    entity = enrichment._wd_entity(qid)
    if entity is None:
        return None
    r = enrichment._wikidata_result(entity)
    if r is None:
        return None
    labels = entity.get("labels") or {}
    names = [{"text": labels[l]["value"], "lang": l, "kind": "label"}
             for l in _WD_NAME_LANGS if (labels.get(l) or {}).get("value")]
    for l in _WD_NAME_LANGS:
        for a in (entity.get("aliases") or {}).get(l, []):
            if a.get("value"):
                names.append({"text": a["value"], "lang": l, "kind": "alias"})
    descs = entity.get("descriptions") or {}
    description = next((descs[l]["value"] for l in ("et", "en", "de")
                        if (descs.get(l) or {}).get("value")), None)
    links = {}
    for prop, key in (("P227", "gnd"), ("P214", "viaf")):
        vals = enrichment._wd_best_values(entity, prop)
        if vals and isinstance(vals[0], str):
            links[key] = normalize_ext_id(key, vals[0])
    return {"label": names[0]["text"] if names else qid, "names": names,
            "description": description, **_fields(r),
            "url": f"https://www.wikidata.org/wiki/{qid}", "links": links}


def _gnd(gnd_id: str) -> Optional[dict]:
    raw = enrichment._fetch_lobid_raw(gnd_id)
    url = f"https://explore.gnd.network/gnd/{gnd_id}"
    if raw is not None:
        r = enrichment._parse_lobid(raw)
        label = r.get("name.label")
        names = _names_plain(label, [natural_name_order(v) for v in raw.get("variantName") or []])
        info = raw.get("biographicalOrHistoricalInformation") or []
        return {"label": label or gnd_id, "names": names,
                "description": info[0] if info else None, **_fields(r),
                "url": url, "links": _links(r)}
    r = enrichment._fetch_gnd_dnb(gnd_id)
    if r is None:
        return None
    return {"label": r.get("name.label") or gnd_id,
            "names": _names_plain(r.get("name.label"), r.get("name.aliases")),
            "description": None, **_fields(r), "url": url, "links": _links(r)}


def _viaf(viaf_id: str) -> Optional[dict]:
    r = enrichment._fetch_viaf(viaf_id)
    if r is None:
        return None
    return {"label": r.get("name.label") or viaf_id,
            "names": _names_plain(r.get("name.label"), r.get("name.aliases")),
            "description": None, **_fields(r),
            "url": f"https://viaf.org/viaf/{viaf_id}", "links": _links(r)}


_BUILDERS = {"wikidata": _wikidata, "gnd": _gnd, "viaf": _viaf}


def candidate_summary(scheme: str, ext_id: str) -> Optional[dict]:
    """Ühe viite kokkuvõte; tundmatu skeem või allika tõrge → None."""
    builder = _BUILDERS.get(scheme)
    if builder is None:
        return None
    ext_id = normalize_ext_id(scheme, ext_id)
    if not ext_id:
        return None
    try:
        return builder(ext_id)
    except Exception:
        enrichment.logger.warning("Kandidaadi kokkuvõte ebaõnnestus: %s:%s", scheme, ext_id, exc_info=True)
        return None


# Moodulitasandi executor: kokkuvõtete päringud on I/O-ootel, mitte CPU-l.
_executor = ThreadPoolExecutor(max_workers=8, thread_name_prefix="candidates")


def _similar(name: str) -> list:
    """Nimepõhine VUTT-i vaste (sama mis vormi SimilarPersonsWarning)."""
    from .person_search import list_persons
    if len((name or "").strip()) < 3:
        return []
    res = list_persons(q=name.strip(), limit=5)
    return [{k: e.get(k) for k in ("id", "label", "birth_year", "death_year", "work_count")}
            for e in res.get("results") or [] if e.get("record_status") != "tombstone"]


def _existing(scheme: str, ext_id: str) -> Optional[str]:
    from .person_crud import _find_by_external_id, _resolve_owner
    found = _find_by_external_id(scheme, ext_id)
    return _resolve_owner(found["id"]) if found else None


def candidates(name: str, refs: list) -> dict:
    """Kuni 15 viite kokkuvõtted paralleelselt, koguaja eelarvega; iga viite
    tõrge märgitakse sellele viitele, teised tulevad."""
    refs = [r for r in refs if isinstance(r, dict) and r.get("scheme") and r.get("id")][:_MAX_REFS]
    futures = [_executor.submit(candidate_summary, r["scheme"], str(r["id"])) for r in refs]
    wait(futures, timeout=_BUDGET_S)
    results = []
    for ref, fut in zip(refs, futures):
        scheme, ext_id = ref["scheme"], normalize_ext_id(ref["scheme"], str(ref["id"]))
        if not fut.done():
            summary, error = None, "timeout"
        else:
            summary = fut.result() if fut.exception() is None else None
            error = None if summary is not None else "source_unavailable"
        results.append({"scheme": scheme, "id": ext_id, "ok": summary is not None,
                        "summary": summary, "error": error,
                        "existing_person_id": _existing(scheme, ext_id)})
    return {"results": results, "similar_persons": _similar(name)}
