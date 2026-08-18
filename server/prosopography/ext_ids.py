"""Väliste identifikaatorite kanooniline kuju — ÜKS allikas (issue #240).

Kanooniline kuju on **paljas identifikaator**: `1029967695`, `104367439X`,
`341`, `Q20933569`. Skeem on juba eraldi väli (`identifiers[].scheme`), nii et
prefiks ID sees on üleliigne — ja aktiivselt kahjulik:

- `_fetch_gnd` ehitab URL-i `lobid.org/gnd/{id}.json`; `GND:123` andis 404,
  mille peale rikastus vaikselt ebaõnnestus;
- `ext_id_index` võti on `f"{scheme}:{ext_id}"`, seega `gnd:GND:123` ja
  `gnd:123` olid eri võtmed → dublikaadikontroll ei leidnud olemasolevat
  kaarti ja tekitas uue.

Moodul ei impordi paketist midagi — teda kutsutakse nii kirjutusteelt
(`person_crud`) kui indeksist (`ext_id_index`) ja ringimport oleks muidu käes.
"""
from typing import Optional

# Skeem → prefiksid, mida tema enda välja seest tohib eemaldada.
# Võõra skeemi prefiksit EI eemaldata: `AA:341` gnd-väljal on andmeviga,
# mitte vormingu küsimus, ja vaikne parandus peidaks selle ära.
_PREFIXES = {
    "gnd": ("gnd:",),
    "viaf": ("viaf:",),
    "wikidata": ("wikidata:", "wd:"),
    "album_academicum": ("album_academicum:", "aa:"),
}


def normalize_ext_id(scheme: Optional[str], ext_id: Optional[str]) -> str:
    """Taandab välise identifikaatori kanoonilisele kujule.

    Tühi või puuduv väärtus annab tühja stringi — kutsuja otsustab, kas see
    tähendab „ära salvesta" või „viga".
    """
    if not ext_id:
        return ""
    value = str(ext_id).strip()
    if not value:
        return ""

    scheme_key = (scheme or "").strip().lower()
    for prefix in _PREFIXES.get(scheme_key, ()):
        if value.lower().startswith(prefix):
            value = value[len(prefix):].strip()
            break

    if scheme_key == "wikidata":
        value = value.upper()
    elif scheme_key == "gnd" and value[-1:].lower() == "x":
        # GND kontrollnumber on alati suur X
        value = value[:-1] + "X"

    return value
