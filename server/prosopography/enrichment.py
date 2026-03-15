"""
Väliste allikate rikastus: Wikidata SPARQL + GND (lobid.org REST).
fetch_and_diff(scheme, ext_id, person) → {auto_filled, conflicts}
"""
import json
import urllib.request
import urllib.parse
from typing import Optional

HEADERS = {
    "User-Agent": "VUTT-Historical-Archive/1.0 (https://vutt.utlib.ut.ee; vutt@utlib.ut.ee)"
}

# Wikidata soo koodid → meie skeem
_WD_GENDER = {
    "Q6581072": "F",
    "Q1052281": "F",
    "Q6581097": "M",
    "Q2449503": "M",
}


def fetch_and_diff(scheme: str, ext_id: str, person: dict) -> dict:  # noqa: E501
    """
    Küsib allika andmed ja võrdleb kohaliku kirjega.
    Tagastab:
      auto_filled: {field_path: value}  — kohalik null, allikas täidab
      conflicts:   [{field, local, remote}]  — mõlemal väärtus, aga erinevad
    """
    if scheme == "wikidata":
        remote = _fetch_wikidata(ext_id)
    elif scheme == "gnd":
        remote = _fetch_gnd(ext_id)
    else:
        return {"auto_filled": {}, "conflicts": [], "error": f"Tundmatu skeem: {scheme}"}

    if remote is None:
        return {"auto_filled": {}, "conflicts": [], "error": "Andmete laadimine ebaõnnestus"}

    auto_filled = {}
    conflicts = []

    def _check(field_path: str, remote_val):
        """Võrdleb remote_val kohaliku väljaga."""
        if remote_val is None:
            return
        parts = field_path.split(".")
        local_obj = person
        for part in parts[:-1]:
            if not isinstance(local_obj, dict):
                return
            local_obj = local_obj.get(part) or {}
        last = parts[-1]
        local_val = local_obj.get(last) if isinstance(local_obj, dict) else None

        if local_val is None or local_val == "":
            auto_filled[field_path] = remote_val
        elif local_val != remote_val:
            conflicts.append({"field": field_path, "local": local_val, "remote": remote_val})

    for path, val in remote.items():
        _check(path, val)

    return {
        "auto_filled": auto_filled,
        "conflicts": conflicts,
        "_enrichment_scheme": scheme,
    }


# =========================================================
# WIKIDATA
# =========================================================

def _fetch_wikidata(qid: str) -> Optional[dict]:
    """Küsib Wikidata SPARQL kaudu isiku andmed."""
    if not qid.startswith("Q"):
        return None

    # SPARQL päring: sugu, sünd, surm, sünnikoht, surmakoht, ametikoht, konfessioon, seisus
    sparql = f"""
SELECT ?genderLabel ?birthDate ?deathDate ?birthPlaceLabel ?birthPlaceQ
       ?deathPlaceLabel ?deathPlaceQ ?occupationLabel ?confessionLabel ?statusLabel
WHERE {{
  OPTIONAL {{ wd:{qid} wdt:P21 ?gender. }}
  OPTIONAL {{ wd:{qid} wdt:P569 ?birthDate. }}
  OPTIONAL {{ wd:{qid} wdt:P570 ?deathDate. }}
  OPTIONAL {{ wd:{qid} wdt:P19 ?birthPlace.
              BIND(?birthPlace AS ?birthPlaceQ) }}
  OPTIONAL {{ wd:{qid} wdt:P20 ?deathPlace.
              BIND(?deathPlace AS ?deathPlaceQ) }}
  OPTIONAL {{ wd:{qid} wdt:P106 ?occupation. }}
  OPTIONAL {{ wd:{qid} wdt:P140 ?confession. }}
  OPTIONAL {{ wd:{qid} wdt:P3716 ?status. }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "et,en". }}
}}
LIMIT 1
"""
    url = "https://query.wikidata.org/sparql?" + urllib.parse.urlencode({
        "query": sparql,
        "format": "json"
    })
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None

    bindings = data.get("results", {}).get("bindings", [])
    if not bindings:
        return {}

    b = bindings[0]
    result = {}

    try:
        gender_label = b.get("genderLabel", {}).get("value")
        if gender_label:
            gender_q = b.get("gender", {}).get("value", "").split("/")[-1]
            result["gender"] = _WD_GENDER.get(gender_q)
    except Exception:
        pass

    try:
        birth_date = b.get("birthDate", {}).get("value")
        if birth_date:
            result["birth.date"] = birth_date[:10]
            result["birth.precision"] = "day" if len(birth_date) >= 10 else "year"
    except Exception:
        pass

    try:
        death_date = b.get("deathDate", {}).get("value")
        if death_date:
            result["death.date"] = death_date[:10]
            result["death.precision"] = "day" if len(death_date) >= 10 else "year"
    except Exception:
        pass

    try:
        bp_label = b.get("birthPlaceLabel", {}).get("value")
        bp_q = b.get("birthPlaceQ", {}).get("value", "").split("/")[-1]
        if bp_label:
            result["birth.place"] = {"id": bp_q if bp_q.startswith("Q") else None, "label": bp_label}
    except Exception:
        pass

    try:
        dp_label = b.get("deathPlaceLabel", {}).get("value")
        dp_q = b.get("deathPlaceQ", {}).get("value", "").split("/")[-1]
        if dp_label:
            result["death.place"] = {"id": dp_q if dp_q.startswith("Q") else None, "label": dp_label}
    except Exception:
        pass

    try:
        occ_label = b.get("occupationLabel", {}).get("value")
        if occ_label:
            result["_occupation_label"] = occ_label
    except Exception:
        pass

    return result


# =========================================================
# GND (lobid.org)
# =========================================================

def _fetch_gnd(gnd_id: str) -> Optional[dict]:
    """Küsib GND andmed lobid.org REST API kaudu."""
    url = f"https://lobid.org/gnd/{gnd_id}.json"
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None

    result = {}

    try:
        preferred = data.get("preferredName")
        if preferred:
            result["name.label"] = preferred
    except Exception:
        pass

    try:
        variants = data.get("variantName") or []
        if variants:
            result["name.aliases"] = variants[:10]
    except Exception:
        pass

    try:
        birth = data.get("dateOfBirth") or []
        if birth:
            result["birth.date"] = str(birth[0])[:10]
    except Exception:
        pass

    try:
        death = data.get("dateOfDeath") or []
        if death:
            result["death.date"] = str(death[0])[:10]
    except Exception:
        pass

    try:
        birth_place = data.get("placeOfBirth") or []
        if birth_place:
            bp = birth_place[0]
            label = bp.get("label") or bp.get("id", "")
            result["birth.place"] = {"id": None, "label": label}
    except Exception:
        pass

    try:
        death_place = data.get("placeOfDeath") or []
        if death_place:
            dp = death_place[0]
            label = dp.get("label") or dp.get("id", "")
            result["death.place"] = {"id": None, "label": label}
    except Exception:
        pass

    try:
        gender_list = data.get("gender") or []
        if gender_list:
            g_id = (gender_list[0].get("id") or "").split("/")[-1]
            if "Female" in g_id or "weiblich" in g_id.lower():
                result["gender"] = "F"
            elif "Male" in g_id or "männlich" in g_id.lower():
                result["gender"] = "M"
    except Exception:
        pass

    return result
