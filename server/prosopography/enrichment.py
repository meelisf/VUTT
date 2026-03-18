"""
Väliste allikate rikastus: Wikidata SPARQL + GND (lobid.org REST) + AA (kohalik fail).
fetch_and_diff(scheme, ext_id, person) → {auto_filled, conflicts}
"""
import json
import os
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
    elif scheme in ("aa", "album_academicum"):
        remote = _fetch_aa(ext_id)
    elif scheme == "viaf":
        remote = _fetch_viaf(ext_id)
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

        if local_val is None or local_val == "" or local_val == []:
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

def _sparql_query(sparql: str) -> Optional[list]:
    """Käivitab SPARQL päringu Wikidata vastu, tagastab bindings-lista või None vea korral."""
    url = "https://query.wikidata.org/sparql?" + urllib.parse.urlencode({
        "query": sparql,
        "format": "json"
    })
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return data.get("results", {}).get("bindings", [])
    except Exception:
        return None


def _fetch_wikidata(qid: str) -> Optional[dict]:
    """Küsib Wikidata andmed kahes SPARQL päringus.

    Päring 1: ühe väärtusega väljad (sugu, sünd/surm kuupäev+koht).
    Päring 2: mitme väärtusega väljad (ametid, konfessioon, seisus) — LIMIT 1 puudub.
    """
    if not qid.startswith("Q"):
        return None

    # ── Päring 1: ühe väärtusega omadused (sh kuupäeva täpsus) ───────────────
    sparql1 = f"""
SELECT ?gender ?birthDate ?birthPrec ?deathDate ?deathPrec
       ?birthPlaceLabel ?birthPlaceQ ?deathPlaceLabel ?deathPlaceQ
       (GROUP_CONCAT(DISTINCT ?altLabel; SEPARATOR="||") AS ?altLabels)
WHERE {{
  OPTIONAL {{ wd:{qid} wdt:P21 ?gender. }}
  OPTIONAL {{ wd:{qid} p:P569/psv:P569 ?birthNode.
              ?birthNode wikibase:timeValue ?birthDate.
              ?birthNode wikibase:timePrecision ?birthPrec. }}
  OPTIONAL {{ wd:{qid} p:P570/psv:P570 ?deathNode.
              ?deathNode wikibase:timeValue ?deathDate.
              ?deathNode wikibase:timePrecision ?deathPrec. }}
  OPTIONAL {{ wd:{qid} wdt:P19 ?birthPlace. BIND(?birthPlace AS ?birthPlaceQ) }}
  OPTIONAL {{ wd:{qid} wdt:P20 ?deathPlace. BIND(?deathPlace AS ?deathPlaceQ) }}
  OPTIONAL {{ wd:{qid} skos:altLabel ?altLabel. FILTER(LANG(?altLabel) IN ("et","en","de","la")) }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "et,en". }}
}}
GROUP BY ?gender ?birthDate ?birthPrec ?deathDate ?deathPrec
         ?birthPlaceLabel ?birthPlaceQ ?deathPlaceLabel ?deathPlaceQ
"""

    # ── Päring 2: mitme väärtusega omadused ──────────────────────────────────
    sparql2 = f"""
SELECT ?occupationLabel ?occupationQ ?confessionLabel ?confessionQ ?statusLabel ?statusQ
WHERE {{
  OPTIONAL {{ wd:{qid} wdt:P106 ?occupation. BIND(?occupation AS ?occupationQ) }}
  OPTIONAL {{ wd:{qid} wdt:P140 ?confession. BIND(?confession AS ?confessionQ) }}
  OPTIONAL {{ wd:{qid} wdt:P3716 ?status. BIND(?status AS ?statusQ) }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "et,en". }}
}}
LIMIT 10
"""

    b1_list = _sparql_query(sparql1)
    b2_list = _sparql_query(sparql2)

    if b1_list is None and b2_list is None:
        return None
    if b1_list is not None and len(b1_list) == 0 and (b2_list is None or len(b2_list) == 0):
        return {}

    result = {}
    b1 = b1_list[0] if b1_list else {}

    try:
        gender_q = (b1.get("gender") or {}).get("value", "").split("/")[-1]
        if gender_q:
            result["gender"] = _WD_GENDER.get(gender_q)
    except Exception:
        pass

    try:
        birth_date = (b1.get("birthDate") or {}).get("value")
        if birth_date:
            prec_num = int((b1.get("birthPrec") or {}).get("value", "11"))
            result["birth.date"] = birth_date[:10]
            result["birth.precision"] = "year" if prec_num <= 9 else ("month" if prec_num == 10 else "day")
    except Exception:
        pass

    try:
        death_date = (b1.get("deathDate") or {}).get("value")
        if death_date:
            prec_num = int((b1.get("deathPrec") or {}).get("value", "11"))
            result["death.date"] = death_date[:10]
            result["death.precision"] = "year" if prec_num <= 9 else ("month" if prec_num == 10 else "day")
    except Exception:
        pass

    try:
        bp_label = (b1.get("birthPlaceLabel") or {}).get("value")
        bp_q = (b1.get("birthPlaceQ") or {}).get("value", "").split("/")[-1]
        if bp_label:
            result["birth.place"] = {"id": bp_q if bp_q.startswith("Q") else None, "label": bp_label}
    except Exception:
        pass

    try:
        dp_label = (b1.get("deathPlaceLabel") or {}).get("value")
        dp_q = (b1.get("deathPlaceQ") or {}).get("value", "").split("/")[-1]
        if dp_label:
            result["death.place"] = {"id": dp_q if dp_q.startswith("Q") else None, "label": dp_label}
    except Exception:
        pass

    try:
        alt_raw = (b1.get("altLabels") or {}).get("value", "")
        aliases = [a.strip() for a in alt_raw.split("||") if a.strip()]
        if aliases:
            result["name.aliases"] = aliases
    except Exception:
        pass

    # ── Mitme väärtusega väljad ───────────────────────────────────────────────
    if b2_list:
        seen_occ = set()
        occupations = []
        confession = None
        status = None

        for b in b2_list:
            try:
                occ_label = (b.get("occupationLabel") or {}).get("value")
                occ_q = (b.get("occupationQ") or {}).get("value", "").split("/")[-1]
                if occ_label and occ_label not in seen_occ:
                    seen_occ.add(occ_label)
                    occupations.append({"id": occ_q if occ_q.startswith("Q") else None, "label": occ_label})
            except Exception:
                pass

            try:
                conf_label = (b.get("confessionLabel") or {}).get("value")
                conf_q = (b.get("confessionQ") or {}).get("value", "").split("/")[-1]
                if conf_label and confession is None:
                    confession = {"id": conf_q if conf_q.startswith("Q") else None, "label": conf_label}
            except Exception:
                pass

            try:
                st_label = (b.get("statusLabel") or {}).get("value")
                st_q = (b.get("statusQ") or {}).get("value", "").split("/")[-1]
                if st_label and status is None:
                    status = {"id": st_q if st_q.startswith("Q") else None, "label": st_label}
            except Exception:
                pass

        if occupations:
            result["_occupations"] = occupations
        if confession:
            result["confession"] = confession
        if status:
            result["status"] = status

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
            date_str = str(birth[0]).strip()
            result["birth.date"] = date_str[:10]
            result["birth.precision"] = "year" if len(date_str) <= 4 else ("month" if len(date_str) <= 7 else "day")
    except Exception:
        pass

    try:
        death = data.get("dateOfDeath") or []
        if death:
            date_str = str(death[0]).strip()
            result["death.date"] = date_str[:10]
            result["death.precision"] = "year" if len(date_str) <= 4 else ("month" if len(date_str) <= 7 else "day")
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

    try:
        profs = data.get("professionOrOccupation") or []
        occs = []
        for p in profs:
            label = p.get("label") or (p.get("id") or "").split("/")[-1]
            if label:
                occs.append({"id": None, "label": label})
        if occs:
            result["_occupations"] = occs[:5]
    except Exception:
        pass

    return result


# =========================================================
# VIAF (Virtual International Authority File)
# =========================================================

def _fetch_viaf(viaf_id: str) -> Optional[dict]:
    """Küsib VIAF andmed JSON API kaudu.

    Tagastab:
      name.aliases  — nimevariandid kõigist kirjetest
      _linked_wikidata — Wikidata Q-kood (kui leidub)
      _linked_gnd      — GND ID (kui leidub)
    """
    # Puhasta ID (eralda "VIAF:" prefiksist kui on)
    raw_id = viaf_id.replace("VIAF:", "").replace("viaf:", "").strip()
    if not raw_id.isdigit():
        return None

    url = f"https://viaf.org/viaf/{raw_id}/justlinks.json"
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None

    result = {}

    # Seotud identifikaatorid: Wikidata + GND
    try:
        wd_list = data.get("WKP") or []
        if not isinstance(wd_list, list):
            wd_list = [wd_list]
        for item in wd_list:
            qid = (item.get("@") if isinstance(item, dict) else str(item)).strip()
            if qid.startswith("Q") and qid[1:].isdigit():
                result["_linked_wikidata"] = qid
                break
    except Exception:
        pass

    try:
        gnd_list = data.get("DNB") or []
        if not isinstance(gnd_list, list):
            gnd_list = [gnd_list]
        for item in gnd_list:
            gnd_id = (item.get("@") if isinstance(item, dict) else str(item)).strip()
            if gnd_id:
                result["_linked_gnd"] = gnd_id
                break
    except Exception:
        pass

    # Nimevariandid — küsi täiskirje
    try:
        names_url = f"https://viaf.org/viaf/{raw_id}/viaf.json"
        req2 = urllib.request.Request(names_url, headers=HEADERS)
        with urllib.request.urlopen(req2, timeout=15) as resp2:
            full = json.loads(resp2.read().decode("utf-8"))

        seen = set()
        aliases = []

        # mainHeadings
        main = full.get("mainHeadings") or {}
        headings = main.get("data") or []
        if not isinstance(headings, list):
            headings = [headings]
        for h in headings:
            text = h.get("text") if isinstance(h, dict) else None
            if text and text not in seen:
                seen.add(text)
                aliases.append(text)

        # x400 (variantNamesForThePerson)
        x400 = full.get("x400s") or {}
        x400_data = x400.get("x400") or []
        if not isinstance(x400_data, list):
            x400_data = [x400_data]
        for entry in x400_data:
            if not isinstance(entry, dict):
                continue
            subfields = entry.get("datafield", {}).get("subfield") or []
            if not isinstance(subfields, list):
                subfields = [subfields]
            parts = [sf.get("#text", "") for sf in subfields
                     if isinstance(sf, dict) and sf.get("@code") in ("a", "b", "c")]
            name = " ".join(p.strip().rstrip(",") for p in parts if p.strip())
            if name and name not in seen and len(aliases) < 20:
                seen.add(name)
                aliases.append(name)

        if aliases:
            result["name.aliases"] = aliases
    except Exception:
        pass

    return result if result else {}


# =========================================================
# AA (Album Academicum — kohalik fail)
# =========================================================

_aa_data: Optional[list] = None


def _load_aa() -> list:
    """Laeb AA andmed mällu (lazy, üks kord)."""
    global _aa_data
    if _aa_data is not None:
        return _aa_data
    try:
        from ..config import AA_FILE
        with open(AA_FILE, encoding="utf-8") as f:
            _aa_data = json.load(f)
    except Exception:
        _aa_data = []
    return _aa_data


def _fetch_aa(aa_id: str) -> Optional[dict]:
    """Otsib AA kirje numbri järgi (nt "AA:1390" → entry_number 1390)."""
    raw = aa_id.replace("AA:", "").strip()
    if not raw.isdigit():
        return None
    entry_num = int(raw)

    entries = _load_aa()
    entry = next((e for e in entries if e.get("entry_number") == entry_num), None)
    if entry is None:
        return None

    result = {}
    person = entry.get("person") or {}
    name_obj = person.get("name") or {}

    # Nimi: "Last, First" → "First Last"
    try:
        full = name_obj.get("full") or ""
        if "," in full:
            parts = full.split(",", 1)
            canonical = f"{parts[1].strip()} {parts[0].strip()}"
        else:
            canonical = full.strip()
        if canonical:
            result["name.label"] = canonical
    except Exception:
        pass

    # Nimevariandid
    try:
        family_name = name_obj.get("family_name") or ""
        first_name = name_obj.get("first_name") or ""
        aliases = []
        for fv in (name_obj.get("family_name_variants") or []):
            aliases.append(f"{first_name} {fv}".strip())
        for fn_v in (name_obj.get("first_name_variants") or []):
            aliases.append(f"{fn_v} {family_name}".strip())
        if aliases:
            result["name.aliases"] = aliases
    except Exception:
        pass

    # Sünniaasta
    try:
        birth_date = (person.get("birth") or {}).get("date")
        if birth_date:
            date_str = str(birth_date).strip()
            result["birth.date"] = date_str[:10]
            result["birth.precision"] = "year" if len(date_str) <= 4 else ("month" if len(date_str) <= 7 else "day")
    except Exception:
        pass

    # Surmaaasta
    try:
        death_date = (person.get("death") or {}).get("date")
        if death_date:
            date_str = str(death_date).strip()
            result["death.date"] = date_str[:10]
            result["death.precision"] = "year" if len(date_str) <= 4 else ("month" if len(date_str) <= 7 else "day")
    except Exception:
        pass

    # Sünnikoht päritolu järgi (kui sünnikoht puudub)
    try:
        origin = entry.get("person", {}).get("origin") or {}
        region = origin.get("standardized_region") or origin.get("region")
        if region:
            result["birth.place"] = {"id": None, "label": region}
    except Exception:
        pass

    # Raw text → biograafia
    try:
        raw = entry.get("raw_text", "").strip()
        if raw:
            result["biography"] = raw
    except Exception:
        pass

    return result
