"""
Interaktiivne skript sulunimega prosopo isikute sobitamiseks AA-koodiga duplikaatidega.

Käivitus (serveril):
    cd ~/VUTT && python3 scripts/match_aa_duplicates.py
    python3 scripts/match_aa_duplicates.py --dry-run   # merge ei toimu

Progress salvestatakse: state/match_aa_progress.json
"""
import json
import os
import re
import sys
from typing import Optional

# Projekti juur sys.path-i — serverimoodulite importimiseks
_BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BASE_DIR not in sys.path:
    sys.path.insert(0, _BASE_DIR)


def extract_name_variants(label: str) -> list:
    """
    Ekstraheerib kõik nimevariandid sulgunimest.

    "Limacius (Limasius), Andreas" → ["limacius", "limasius", "andreas"]
    "Wag(e)ner, Heinrich"          → ["wagner", "wagener", "heinrich"]
    "Bus(sch)man(nus)"             → ["busman", "busschmannus"]
    """
    tokens = set()

    # 1. Täissõna variandid suludes (≥4 tähemärki)
    for v in re.findall(r'\(([A-Za-zÀ-ÿ]{4,})\)', label):
        tokens.add(v.lower())

    # 2. Stripitud versioon — sulud eemaldatud: Wag(e)ner → wagner
    stripped = re.sub(r'\([^)]*\)', '', label)
    for w in re.split(r'[,\s]+', stripped):
        if len(w) >= 3:
            tokens.add(w.lower())

    # 3. Kaasav versioon — sulu sisu lisatakse: Wag(e)ner → wagener
    included = re.sub(r'\(([^)]*)\)', r'\1', label)
    for w in re.split(r'[,\s]+', included):
        if len(w) >= 3:
            tokens.add(w.lower())

    return list(tokens)


def _build_historical_date(date_str: str, precision: str, existing: Optional[dict] = None) -> dict:
    """Ehitab HistoricalDate objekti. Säilitab olemasoleva koha kui on."""
    y = date_str[:4]
    m = date_str[5:7] if precision != "year" and len(date_str) >= 7 else "01"
    d = date_str[8:10] if precision == "day" and len(date_str) >= 10 else "01"
    result = {
        "original_text": None,
        "date": f"{y}-{m}-{d}",
        "date_to": None,
        "bound": None,
        "precision": precision,
        "calendar": None,
        "is_circa": False,
        "place": None,
        "notes": None,
    }
    if existing:
        for field in ("place", "is_circa", "calendar", "bound", "original_text"):
            if existing.get(field):
                result[field] = existing[field]
    return result


def apply_aa_to_person(person: dict, auto_filled: dict) -> dict:
    """
    Rakendab AA rikastuse isiku dictile.
    Replitseerib applyEnrichmentToDraft + draftToPayload (helpers.ts) loogika.
    EI kasuta apply_enrichment() — see salvestaks _aa_education raw väljana.
    """
    import copy
    p = copy.deepcopy(person)

    # Nimi
    name = p.setdefault("name", {})
    if auto_filled.get("name.label") and not (name.get("label") or "").strip():
        name["label"] = auto_filled["name.label"]
    if auto_filled.get("name.aliases"):
        name["aliases"] = auto_filled["name.aliases"]

    # Sünnikuupäev
    if auto_filled.get("birth.date"):
        p["birth"] = _build_historical_date(
            auto_filled["birth.date"],
            auto_filled.get("birth.precision", "day"),
            existing=p.get("birth"),
        )
    # Sünnikoht — ainult kui tühi
    if auto_filled.get("birth.place") and not (p.get("birth") or {}).get("place"):
        birth = p.setdefault("birth", {})
        bp = auto_filled["birth.place"]
        birth["place"] = {"id": bp.get("id"), "label": bp["label"]}

    # Surmakuupäev
    if auto_filled.get("death.date"):
        p["death"] = _build_historical_date(
            auto_filled["death.date"],
            auto_filled.get("death.precision", "day"),
            existing=p.get("death"),
        )
    # Surmakoht — ainult kui tühi
    if auto_filled.get("death.place") and not (p.get("death") or {}).get("place"):
        death = p.setdefault("death", {})
        dp = auto_filled["death.place"]
        death["place"] = {"id": dp.get("id"), "label": dp["label"]}

    # Biograafia — ainult kui tühi
    if auto_filled.get("biography") and not (p.get("biography") or "").strip():
        p["biography"] = auto_filled["biography"]

    # Päritolukoht — ainult kui tühi (_aa_origin on string, mitte {id,label} dict)
    if auto_filled.get("_aa_origin"):
        origin = p.setdefault("origin", {})
        if not origin.get("place"):
            origin["place"] = auto_filled["_aa_origin"]

    # Haridustee — dedup institution nime järgi (case-insensitive)
    if auto_filled.get("_aa_education"):
        existing_edu = p.get("education") or []
        existing_inst = {(e.get("institution") or "").lower() for e in existing_edu}
        new_entries = []
        for e in auto_filled["_aa_education"]:
            inst_raw = e.get("institution") or ""
            if not inst_raw or inst_raw.lower() in existing_inst:
                continue
            entry: dict = {"institution": inst_raw}
            if e.get("edu_type"):
                entry["type"] = e["edu_type"]  # "type" not "edu_type" — matches draftToPayload
            if e.get("source"):
                entry["source"] = e["source"]
            if e.get("date_from") and e["date_from"].get("date"):
                entry["date_from"] = _build_historical_date(
                    e["date_from"]["date"],
                    e["date_from"].get("precision", "day"),
                )
            new_entries.append(entry)
            existing_inst.add(inst_raw.lower())
        if new_entries:
            p["education"] = existing_edu + new_entries

    return p
