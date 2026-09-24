"""
Väliste allikate rikastus: Wikidata SPARQL + GND (lobid.org REST) + VIAF (RDF/XML)
+ AA (kohalik fail).
fetch_and_diff(scheme, ext_id, person) → {auto_filled, conflicts}
"""
import json
import logging
import os
import re
import unicodedata
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from typing import Optional

from .ext_ids import normalize_ext_id
from ..prosopo_biography_fields import AA_RAW

logger = logging.getLogger(__name__)

HEADERS = {
    "User-Agent": "VUTT-Historical-Archive/1.0 (https://vutt.utlib.ut.ee; vutt@utlib.ut.ee)"
}

# GND kasutab koma ka tiitli ees ("Innocentius XII, Papst") — neid ei tohi
# pöörata, muidu tuleb "Papst Innocentius XII".
_NIMETIITLID = {
    "papst", "könig", "königin", "kaiser", "kaiserin", "herzog", "herzogin",
    "graf", "gräfin", "fürst", "fürstin", "bischof", "erzbischof", "landgraf",
    "markgraf", "kurfürst", "kurfürstin", "prinz", "prinzessin", "pfalzgraf",
    "freiherr", "freifrau", "ritter", "abt", "äbtissin", "heiliger", "heilige",
}


def _ylataseme_komad(name: str) -> list:
    """Komade positsioonid, mis EI ole sulgudes.

    AA kirjutab nimevariandid sulgudesse — "Ekebrodd (Ekeberg, Ekebärg),
    Laurentius" — ja seal olev koma ei ole nime jaotuskoht.
    """
    depth = 0
    positions = []
    for i, ch in enumerate(name):
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        elif ch == "," and depth == 0:
            positions.append(i)
    return positions


def natural_name_order(name: str, strict: bool = True) -> str:
    """Pöörab "Perekonnanimi, Eesnimi" loomulikku järjekorda (issue #240).

    GND annab nime pööratult, Wikidata loomulikult — ilma selleta sõltus
    kaardil olev nimekuju sellest, millisest allikast keegi rikastas.

    `strict=True` (GND, VIAF) pöörab ainult ühe ülataseme koma korral ja jätab
    tiitlid rahule: "Gustav II Adolf, Schweden, König" ega "Innocentius XII,
    Papst" ei ole perekonnanimi + eesnimi.

    `strict=False` (AA) pöörab esimese ülataseme koma pealt — AA kirje kuju on
    teada ja alati "Perekonnanimi, Eesnimed".
    """
    if not name:
        return name
    positions = _ylataseme_komad(name)
    if not positions or (strict and len(positions) > 1):
        return name

    cut = positions[0]
    family = name[:cut].strip()
    given = name[cut + 1:].strip()
    if strict and given.lower() in _NIMETIITLID:
        return name
    if not given:
        return family
    if not family:
        return given
    return f"{given} {family}"


# Wikidata soo koodid → meie skeem
_WD_GENDER = {
    "Q6581072": "F",
    "Q1052281": "F",
    "Q6581097": "M",
    "Q2449503": "M",
}


# Väljad, mille väärtus on HULK, mitte skalaar: allika variandid ei tühista
# kohalikke, vaid lisanduvad. Konfliktiks lugemine tähendas, et kaardil, millel
# juba oli mõni nimevariant, ei saanud allika omi üldse salvestada — rikastuse
# vaade näitab konflikte ainult loetavatena (#240).
_HULGA_VÄLJAD = ("name.aliases",)


def _ühenda_variandid(local_val, remote_val) -> Optional[list]:
    """Kohalikud variandid ees, uued allika omad järele. None = midagi uut ei ole.

    Võrdlus käib NFC-normaliseeritud ja trimmitud kujul: GND annab täpitähed
    NFD-na, kaardil on NFC — sama nimi ei tohi teist korda listi tulla.
    """
    def _võti(v):
        return unicodedata.normalize("NFC", str(v)).strip().casefold()

    olemas = [v for v in (local_val or []) if str(v).strip()]
    nähtud = {_võti(v) for v in olemas}

    lisandub = []
    for v in (remote_val or []):
        if not str(v).strip():
            continue
        k = _võti(v)
        if k in nähtud:
            continue
        nähtud.add(k)
        lisandub.append(str(v).strip())

    if not lisandub:
        return None
    return olemas + lisandub


def fetch_remote(scheme: str, ext_id: str) -> Optional[dict]:
    """Ühe allika toorvastus (normaliseeritud ID-ga). None = tõrge või tundmatu skeem."""
    # Vorming kanooniliseks ENNE päringut: `lobid.org/gnd/GND:123` andis 404 ja
    # rikastus ebaõnnestus vaikselt (#240).
    ext_id = normalize_ext_id(scheme, ext_id)
    if scheme == "wikidata":
        return _fetch_wikidata(ext_id)
    if scheme == "gnd":
        return _fetch_gnd(ext_id)
    if scheme in ("aa", "album_academicum"):
        return _fetch_aa(ext_id)
    if scheme == "viaf":
        return _fetch_viaf(ext_id)
    return None


def fetch_and_diff(scheme: str, ext_id: str, person: dict) -> dict:  # noqa: E501
    """
    Küsib allika andmed ja võrdleb kohaliku kirjega.
    Tagastab:
      auto_filled: {field_path: value}  — kohalik null, allikas täidab
      conflicts:   [{field, local, remote}]  — mõlemal väärtus, aga erinevad
    """
    if scheme not in ("wikidata", "gnd", "aa", "album_academicum", "viaf"):
        return {"auto_filled": {}, "conflicts": [], "error": f"Tundmatu skeem: {scheme}"}
    remote = fetch_remote(scheme, ext_id)

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

        if field_path in _HULGA_VÄLJAD:
            ühend = _ühenda_variandid(local_val, remote_val)
            if ühend is not None:
                auto_filled[field_path] = ühend
            return

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

_WD_API = "https://www.wikidata.org/w/api.php"
_WD_ALIAS_LANGS = ("et", "en", "de", "la", "mul")
# Sildi keelejärjestus. Vana SPARQL-tee: "et,en", muidu Q-kood — `mul` on
# Wikidata mitmekeelne silt ja parem kui paljas kood.
_WD_LABEL_LANGS = ("et", "en", "mul")


def _wd_get_json(url: str) -> Optional[dict]:
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        logger.warning(f"Wikidata päring ebaõnnestus ({url[:120]}): {e}")
        return None


def _wd_entity(qid: str) -> Optional[dict]:
    """Üks entiteet `Special:EntityData` kaudu (CDN-vahemälus, ~1 s)."""
    data = _wd_get_json(f"https://www.wikidata.org/wiki/Special:EntityData/{qid}.json")
    if not data:
        return None
    entities = data.get("entities") or {}
    # Ümbersuunatud (liidetud) Q-kood tuleb teise võtme all.
    return entities.get(qid) or next(iter(entities.values()), None)


def _wd_labels(ids) -> Optional[dict]:
    """Sildid `{qid: {lang: tekst}}` ühe `wbgetentities` päringuga (≤ 50 id-d partii kohta).

    Tõrge → None, MITTE osaline tulemus: sildita viide kirjutaks kaardile Q-koodi
    kohanimeks.
    """
    ids = sorted(set(ids))
    out = {}
    for i in range(0, len(ids), 50):
        params = urllib.parse.urlencode({
            "action": "wbgetentities",
            "ids": "|".join(ids[i:i + 50]),
            "props": "labels",
            "languages": "|".join(_WD_LABEL_LANGS),
            "format": "json",
        })
        data = _wd_get_json(f"{_WD_API}?{params}")
        if data is None or "entities" not in data:
            return None
        for qid, ent in data["entities"].items():
            out[qid] = {lang: v["value"] for lang, v in (ent.get("labels") or {}).items()}
    return out


def _wd_best_values(entity: dict, prop: str) -> list:
    """Väärtused nagu `wdt:` neid annab: parim auaste (preferred, muidu normal),
    deprecated mitte kunagi. Järjekord nagu entiteedis."""
    claims = [c for c in (entity.get("claims") or {}).get(prop, [])
              if c.get("rank") != "deprecated"
              and (c.get("mainsnak") or {}).get("snaktype") == "value"]
    preferred = [c for c in claims if c.get("rank") == "preferred"]
    return [c["mainsnak"]["datavalue"]["value"] for c in (preferred or claims)]


def _wd_item_ids(entity: dict, prop: str) -> list:
    return [v["id"] for v in _wd_best_values(entity, prop)
            if isinstance(v, dict) and isinstance(v.get("id"), str)]


def _wd_time(entity: dict, prop: str):
    """(kuupäev, täpsus) esimesest parima auastmega väärtusest.

    Entity API: `+1621-00-00T00:00:00Z` aasta täpsusel; SPARQL andis
    `1621-01-01` — nullkuu/-päev asendatakse 01-ga, et väljund ei muutuks.
    """
    for v in _wd_best_values(entity, prop):
        if not isinstance(v, dict) or not v.get("time"):
            continue
        aeg = v["time"].lstrip("+")
        kuupaev = aeg.split("T")[0]
        osad = kuupaev.rsplit("-", 2)
        if len(osad) == 3:
            aasta, kuu, paev = osad
            kuupaev = f"{aasta}-{kuu if kuu != '00' else '01'}-{paev if paev != '00' else '01'}"
        prec = int(v.get("precision", 11))
        return kuupaev, ("year" if prec <= 9 else ("month" if prec == 10 else "day"))
    return None, None


def _fetch_wikidata(qid: str) -> Optional[dict]:
    """Isiku andmed Wikidata entity API-st: üks entiteedipäring + üks sildipäring.

    Varem kaks järjestikust SPARQL-päringut (WDQS): külmalt 10–15 s kumbki ja
    klient loobus 15 s järel (nginx 499, 2026-09-24). Väljundi kuju on sama.
    """
    # Range Q-ID kontroll — id läheb URL-i.
    if not re.fullmatch(r"Q\d+", qid):
        return None

    entity = _wd_entity(qid)
    if entity is None:
        return None

    gender_ids = _wd_item_ids(entity, "P21")
    birth_places = _wd_item_ids(entity, "P19")
    death_places = _wd_item_ids(entity, "P20")
    occupation_ids = list(dict.fromkeys(_wd_item_ids(entity, "P106")))
    confession_ids = _wd_item_ids(entity, "P140")
    status_ids = _wd_item_ids(entity, "P3716")

    viited = set(birth_places[:1] + death_places[:1] + occupation_ids
                 + confession_ids[:1] + status_ids[:1])
    sildid = _wd_labels(viited) if viited else {}
    if sildid is None:
        return None

    def silt(q: str) -> str:
        labels = sildid.get(q) or {}
        return next((labels[l] for l in _WD_LABEL_LANGS if labels.get(l)), q)

    def viide(q: str) -> dict:
        return {"id": q, "label": silt(q)}

    result = {}
    if gender_ids:
        result["gender"] = _WD_GENDER.get(gender_ids[0])

    for väli, prop in (("birth", "P569"), ("death", "P570")):
        kuupaev, tapsus = _wd_time(entity, prop)
        if kuupaev:
            result[f"{väli}.date"] = kuupaev
            result[f"{väli}.precision"] = tapsus

    if birth_places:
        result["birth.place"] = viide(birth_places[0])
    if death_places:
        result["death.place"] = viide(death_places[0])

    aliases = list(dict.fromkeys(
        a["value"].strip()
        for lang in _WD_ALIAS_LANGS
        for a in (entity.get("aliases") or {}).get(lang, [])
        if a.get("value", "").strip()
    ))
    if aliases:
        result["name.aliases"] = aliases

    # Ametite silt on dedup-võti nagu vanas teel (sama sildiga eri Q-koodid üheks).
    occupations, nähtud = [], set()
    for q in occupation_ids:
        label = silt(q)
        if label not in nähtud:
            nähtud.add(label)
            occupations.append({"id": q, "label": label})
    if occupations:
        result["_occupations"] = occupations
    if confession_ids:
        result["confession"] = viide(confession_ids[0])
    if status_ids:
        result["status"] = viide(status_ids[0])

    return result


# =========================================================
# GND (lobid.org, varutee d-nb.info)
# =========================================================

_GND_NS = "https://d-nb.info/standards/elementset/gnd#"

# lobid saab tavapärasest lühema timeouti, sest tema järel on veel varutee.
# Kliendi fetchWithTimeout katkestab 15 s pealt — 15 + 1 ei mahuks sinna ära.
_LOBID_TIMEOUT = 4


def _date_precision(date_str: str) -> str:
    """GND kuupäev on "1805", "1805-08" või "1805-08-28"."""
    return "year" if len(date_str) <= 4 else ("month" if len(date_str) <= 7 else "day")


_WIKIDATA_ENTITY_RE = re.compile(r"wikidata\.org/entity/(Q\d+)$")
_VIAF_RE = re.compile(r"viaf\.org/viaf/(\d+)$")


def _linked_from_same_as(uris) -> dict:
    """GND `sameAs` URI-d → isiku enda seotud Wikidata/VIAF ID.

    `sameAs` all on sama isiku kirjed teistes normandmebaasides — mitte kohad
    ega ametid —, seega esimene Wikidata/VIAF vaste on selle isiku oma.
    """
    linked: dict = {}
    for uri in uris:
        uri = str(uri or "").rstrip("/")
        m = _WIKIDATA_ENTITY_RE.search(uri)
        if m and "_linked_wikidata" not in linked:
            linked["_linked_wikidata"] = m.group(1)
        m = _VIAF_RE.search(uri)
        if m and "_linked_viaf" not in linked:
            linked["_linked_viaf"] = m.group(1)
    return linked


def _parse_dnb_jsonld(nodes: list, gnd_id: str) -> dict:
    """Sõelub DNB laiendatud JSON-LD vastuse. Eraldi funktsioon, et olla testitav.

    Katab nimed, kuupäevad ja soo. Sünni-/surmakohta ega ameteid EI anna:
    DNB viitab neile ainult GND-URI-ga ilma sildita (lobid lahendas sildid ise),
    nende kättesaamine nõuaks eraldi päringut iga viite kohta.
    """
    main = next(
        (n for n in nodes if str(n.get("@id", "")).rstrip("/").endswith(f"gnd/{gnd_id}")),
        None,
    )
    if main is None:
        return {}

    def _values(prop: str) -> list:
        return [v.get("@value") for v in main.get(_GND_NS + prop, [])
                if isinstance(v, dict) and v.get("@value")]

    result: dict = {}

    preferred = _values("preferredNameForThePerson")
    if preferred:
        result["name.label"] = natural_name_order(preferred[0])

    variants = _values("variantNameForThePerson")
    if variants:
        result["name.aliases"] = [natural_name_order(v) for v in variants[:10]]

    for prop, field in (("dateOfBirth", "birth"), ("dateOfDeath", "death")):
        dates = _values(prop)
        if dates:
            date_str = str(dates[0]).strip()
            result[f"{field}.date"] = date_str[:10]
            result[f"{field}.precision"] = _date_precision(date_str)

    for g in main.get(_GND_NS + "gender", []):
        g_id = str(g.get("@id", "")).rsplit("#", 1)[-1].lower()
        if g_id == "female":
            result["gender"] = "F"
        elif g_id == "male":
            result["gender"] = "M"

    result.update(_linked_from_same_as(
        v.get("@id") for v in main.get("http://www.w3.org/2002/07/owl#sameAs", [])
        if isinstance(v, dict)))

    return result


def _fetch_gnd_dnb(gnd_id: str) -> Optional[dict]:
    """Varutee otse Saksa rahvusraamatukogust, kui lobid.org ei vasta."""
    url = f"https://d-nb.info/gnd/{gnd_id}/about/lds.jsonld"
    try:
        req = urllib.request.Request(url, headers=dict(HEADERS, Accept="application/json"))
        with urllib.request.urlopen(req, timeout=15) as resp:
            nodes = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        logger.warning("GND varutee (d-nb.info) ebaõnnestus (%s): %s", url, e)
        return None

    try:
        return _parse_dnb_jsonld(nodes, gnd_id)
    except Exception as e:
        logger.warning("GND varutee vastuse sõelumine ebaõnnestus (%s): %s", url, e)
        return None


def _parse_lobid(data: dict) -> dict:
    """Sõelub lobid.org JSON-vastuse. Eraldi funktsioon, et olla ilma võrguta testitav."""
    result: dict = {}

    try:
        preferred = data.get("preferredName")
        if preferred:
            result["name.label"] = natural_name_order(preferred)
    except Exception:
        pass

    try:
        variants = data.get("variantName") or []
        if variants:
            result["name.aliases"] = [natural_name_order(v) for v in variants[:10]]
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
            # lobid annab "…/gnd/gender#male" (väike täht) — varasem
            # tõstutundlik võrdlus ei sobitunud kunagi ja sugu jäi täitmata.
            g = ((gender_list[0].get("id") or "").rsplit("#", 1)[-1] + " "
                 + (gender_list[0].get("label") or "")).lower()
            if "female" in g or "weiblich" in g:
                result["gender"] = "F"
            elif "male" in g or "männlich" in g:
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

    result.update(_linked_from_same_as(
        s.get("id") for s in (data.get("sameAs") or []) if isinstance(s, dict)))

    return result


def _fetch_gnd(gnd_id: str) -> Optional[dict]:
    """Küsib GND andmed lobid.org REST API kaudu, tõrke korral d-nb.info-st.

    lobid annab rohkem (kohad ja ametid siltidega), aga on üksik veapunkt —
    2026-08-07 oli päev otsa täiesti kättesaamatu.
    """
    url = f"https://lobid.org/gnd/{gnd_id}.json"
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=_LOBID_TIMEOUT) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        logger.warning("GND rikastus lobid.org kaudu ebaõnnestus (%s): %s — proovin d-nb.info", url, e)
        return _fetch_gnd_dnb(gnd_id)

    return _parse_lobid(data)


# =========================================================
# VIAF (Virtual International Authority File)
# =========================================================

_SCHEMA_NS = "{http://schema.org/}"
_RDF_NS = "{http://www.w3.org/1999/02/22-rdf-syntax-ns#}"


def _parse_viaf_rdf(xml_text: str) -> dict:
    """Sõelub VIAF RDF/XML kirje. Eraldi funktsioon, et olla ilma võrguta testitav.

    Tagastab:
      name.aliases     — nimevariandid (schema:name + schema:alternateName)
      _linked_wikidata — Wikidata Q-kood (kui leidub)
      _linked_gnd      — GND ID (kui leidub)
    """
    root = ET.fromstring(xml_text)

    # VIAF liidab ees- ja perekonnanime tühikuta ("KarlKühlstaedt"), aga annab
    # samas kirjes ka osad eraldi — nende järgi saab tühiku täpselt tagasi panna.
    givens = {el.text.strip() for el in root.iter(_SCHEMA_NS + "givenName")
              if el.text and el.text.strip()}
    families = {el.text.strip() for el in root.iter(_SCHEMA_NS + "familyName")
                if el.text and el.text.strip()}

    def _unglue(text: str) -> str:
        for g in givens:
            if text.startswith(g) and text[len(g):] in families:
                return f"{g} {text[len(g):]}"
        return text

    result: dict = {}

    # Nimevariandid. skos:altLabel jäetakse teadlikult välja — need on
    # pööratud kujul ja eluaastad on nime külge liidetud ("Kühlstädt, Karl1805-1838").
    seen = set()
    aliases = []
    for tag in ("name", "alternateName"):
        for el in root.iter(_SCHEMA_NS + tag):
            text = (el.text or "").strip()
            if not text:
                continue
            text = _unglue(text)
            if text not in seen and len(aliases) < 20:
                seen.add(text)
                aliases.append(text)
    if aliases:
        result["name.aliases"] = aliases

    # Seotud identifikaatorid — AINULT schema:sameAs alt. Wikidata Q-koode esineb
    # kirjes ka mujal (nt schema:gender rdf:resource = Q6581097 „mees").
    for same_as in root.iter(_SCHEMA_NS + "sameAs"):
        for desc in same_as.iter(_RDF_NS + "Description"):
            about = (desc.get(_RDF_NS + "about") or "").strip()
            m = re.search(r"wikidata\.org/entity/(Q\d+)", about)
            if m and "_linked_wikidata" not in result:
                result["_linked_wikidata"] = m.group(1)
            m = re.search(r"d-nb\.info/gnd/([\w-]+)", about)
            if m and "_linked_gnd" not in result:
                result["_linked_gnd"] = m.group(1)

    return result


def _fetch_viaf(viaf_id: str) -> Optional[dict]:
    """Küsib VIAF andmed RDF/XML kujul sisusobituse (content negotiation) kaudu.

    Vanad JSON-teed (`justlinks.json`, `viaf.json`) on VIAF-i 2025. a uuenduse
    järel kadunud (404) ja uus veebiliides on Cloudflare'i taga JS-rakendus.
    `Accept: application/rdf+xml` `/viaf/{id}` peal töötab endiselt ja annab
    kogu vajaliku sisu.
    """
    # Puhasta ID (eralda "VIAF:" prefiksist kui on)
    raw_id = viaf_id.replace("VIAF:", "").replace("viaf:", "").strip()
    if not raw_id.isdigit():
        return None

    url = f"https://viaf.org/viaf/{raw_id}"
    headers = dict(HEADERS, Accept="application/rdf+xml")
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=15) as resp:
            xml_text = resp.read().decode("utf-8")
    except Exception as e:
        logger.warning("VIAF rikastus ebaõnnestus (%s): %s", url, e)
        return None

    try:
        return _parse_viaf_rdf(xml_text)
    except Exception as e:
        logger.warning("VIAF vastuse sõelumine ebaõnnestus (%s): %s", url, e)
        return None


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
        canonical = natural_name_order((name_obj.get("full") or "").strip(), strict=False)
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

    # Päritolupiirkond → origin_place (mitte sünnikoht)
    try:
        origin = entry.get("person", {}).get("origin") or {}
        region = origin.get("standardized_region") or origin.get("region")
        if region:
            result["_aa_origin"] = region
    except Exception:
        pass

    # Raw text → AA-toorik. AA `raw_text` on KIRJE, mitte elulugu (ADR 0039).
    try:
        raw = entry.get("raw_text", "").strip()
        if raw:
            result[AA_RAW] = raw
    except Exception:
        pass

    # Haridustee: immatrikuleerumine AA-sse + teised ülikoolid
    try:
        edu_entries = []
        entry_date = entry.get("entry_date")
        if entry_date:
            prec = "day" if len(entry_date) >= 10 else ("month" if len(entry_date) >= 7 else "year")
            edu_entries.append({
                "institution": "Academia Gustaviana",
                "edu_type": "imm.",
                "date_from": {"date": entry_date[:10], "precision": prec},
                "source": "album_academicum",
            })
        for s in (entry.get("studies") or []):
            inst = s.get("institution")
            date_str = s.get("date")
            if not inst:
                continue
            entry_obj: dict = {"institution": inst, "edu_type": s.get("type") or "imm.", "source": "album_academicum"}
            if date_str:
                prec = "day" if len(date_str) >= 10 else ("month" if len(date_str) >= 7 else "year")
                entry_obj["date_from"] = {"date": date_str[:10], "precision": prec}
            edu_entries.append(entry_obj)
        if edu_entries:
            result["_aa_education"] = edu_entries
    except Exception:
        pass

    # Seisus: aadel (noble_status "Nob." jms → Q134737)
    try:
        noble_status = name_obj.get("noble_status")
        if noble_status:
            result["status"] = {
                "id": "Q134737",
                "label": "Aadel",
                "labels": {"et": "Aadel", "de": "Adel", "en": "nobility", "la": "Nobilitas"},
            }
    except Exception:
        pass

    return result
