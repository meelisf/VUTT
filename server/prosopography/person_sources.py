"""Isikukaardi „Allikad ja bibliograafia" (`sources[]`) kuju ja kontroll (ADR 0078).

Kirje on kas vabatekst (`text`) või viide VUTT-i teosele (`work_id`, valikuliselt
`part_id`, `page`, `printed_page`). Pealkirja EI kopeerita kaardile — vaade loeb selle
teoselt, nii et pealkirja parandus jõuab ka kaardile. `text` on VUTT-i kirjel
valikuline täiendus (nt „personaalia").

Viide peab salvestamise hetkel kehtima (teos olemas, osa sellel teosel). Hiljem
kustutatud teos/osa kaarti ei riku: kontroll käib ainult kirjutusteel.
"""
import json
import os

from ..utils import find_directory_by_id

_TEXT_KEYS = ("text", "note", "printed_page")
_MAX_TEXT = 2000
_MAX_ITEMS = 200


def _load_meta(work_id: str):
    folder = find_directory_by_id(work_id)
    if not folder:
        return None
    try:
        with open(os.path.join(folder, "_metadata.json"), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _clean_str(value, field: str):
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError(f"invalid_sources: {field} peab olema tekst")
    value = value.strip()
    if len(value) > _MAX_TEXT:
        raise ValueError(f"invalid_sources: {field} on liiga pikk")
    return value or None


def normalize_sources(data: dict) -> dict:
    """Puhastab `sources` kirjed; viskab ValueError-i vigase kuju või kehtetu viite korral.

    Tühjad väljad jäetakse välja (tühi = võtme puudumine). Kirje, millel pole ei
    teksti ega teost, visatakse vaikselt ära — vormi tühi rida, mitte viga.
    """
    if "sources" not in data:
        return data
    raw = data["sources"]
    if raw is None:
        return {**data, "sources": []}
    if not isinstance(raw, list) or len(raw) > _MAX_ITEMS:
        raise ValueError("invalid_sources: sources peab olema massiiv")
    metas: dict = {}
    result = []
    for item in raw:
        if isinstance(item, str):
            # Vanim vorm: paljas string.
            item = {"text": item}
        if not isinstance(item, dict):
            raise ValueError("invalid_sources: kirje peab olema objekt")
        unknown = set(item) - {*_TEXT_KEYS, "work_id", "part_id", "page"}
        if unknown:
            raise ValueError(f"invalid_sources: tundmatu väli {sorted(unknown)[0]}")
        entry = {}
        for key in _TEXT_KEYS:
            value = _clean_str(item.get(key), key)
            if value:
                entry[key] = value
        work_id = _clean_str(item.get("work_id"), "work_id")
        part_id = _clean_str(item.get("part_id"), "part_id")
        page = item.get("page")
        if not work_id:
            if part_id or page is not None or "printed_page" in entry:
                raise ValueError("invalid_sources: osa ja lehekülg vajavad teost")
            if "text" not in entry:
                continue
            result.append(entry)
            continue
        if work_id not in metas:
            metas[work_id] = _load_meta(work_id)
        meta = metas[work_id]
        if meta is None:
            raise ValueError(f"invalid_sources: teost {work_id} ei ole")
        entry["work_id"] = work_id
        if part_id:
            if not any(p.get("id") == part_id for p in meta.get("parts") or []):
                raise ValueError(f"invalid_sources: teosel {work_id} ei ole osa {part_id}")
            entry["part_id"] = part_id
        if page is not None:
            if isinstance(page, bool) or not isinstance(page, int) or page < 1:
                raise ValueError("invalid_sources: page peab olema positiivne täisarv")
            entry["page"] = page
        result.append(entry)
    return {**data, "sources": result}
