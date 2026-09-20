"""Isikuvalija relevantsusjärjestus (`sort_by="relevance"`).

Miks see olemas on: valija näitab 384 „Johann"-vaste seast 6 esimest. Kui lõige
tehakse tähestiku järgi, on ta otsituga risti — Johann Vogel (507 teost) jääb
nägemata. Perekonnanime otsingul on olukord veel halvem: kõigil vastetel on
IDENTNE `sort_name`, nii et sort ei tee midagi ja järjekorra otsustab
indeksifaili juhuslik järjekord.

Astmestik (leksikograafiline võti):
  0 mõni nimesõna algab päringuga
  1 alias või alamstring mujal nimes
  2 ainult sildi vaste

`sort_name` ei osale astme määramisel: ta on heuristika (`family_name`
puudumisel nime viimane sõna) ja eksib kahtpidi — patronüüm „Ericus Johannis"
ja kuju „Horn, Petrus" annavad `sort_name`-iks eesnime. Mõõdetud tootmises
2026-09-20. Perekonnanimeotsing ei kaota: perekonnanimi ON nimesõna.
  → iga astme SEES: work_count kahanevalt, siis sort_name, siis id
"""
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


@pytest.fixture
def ps():
    import server.prosopography.person_search as person_search
    return person_search


def kirje(label, sort_name, work_count=0, aliases=None, pid=None):
    return {
        "id": pid or f"vutt:P{label.replace(' ', '').lower()}",
        "label": label,
        "sort_name": sort_name,
        "work_count": work_count,
        "aliases": aliases or [],
    }


def jarjesta(ps, entries, q, aliases_data=None):
    return [e["label"] for e in sorted(
        entries, key=lambda e: ps._relevance_key(e, q.casefold(), aliases_data or {})
    )]


# ---- aste võidab kaalu ----

def test_tapne_perekonnanimi_voidab_suurema_teosearvu(ps):
    """„dau" → Fridericus Dau (0 teost) enne Lindaud, kus päring on ainult alamstring."""
    entries = [
        kirje("Johannes Lindau", "Lindau", work_count=500),
        kirje("Fridericus Dau", "Dau", work_count=0),
    ]
    assert jarjesta(ps, entries, "dau") == ["Fridericus Dau", "Johannes Lindau"]


def test_patronuum_ei_torju_kaalukat_eesnime(ps):
    """`sort_name` on heuristika: „Johannis" ei ole perekonnanimi.

    Eesnime- ja perekonnanimevaste on SAMAL astmel; otsustab teosearv.
    """
    entries = [
        kirje("Ericus Johannis", "Johannis", work_count=0),
        kirje("Roothkirch, Johannes", "Johannes", work_count=1),
        kirje("Johann Vogel", "Vogel", work_count=507),
    ]
    assert jarjesta(ps, entries, "johann")[0] == "Johann Vogel"


def test_perekonnanimevaste_ei_kao_eesnimevaste_taha(ps):
    """Sama aste, aga alamstringi-vaste jääb ikka alla — „fisch" leiab Fischeri."""
    entries = [
        kirje("Keegi Hirschfisch", "Hirschfisch", work_count=900),
        kirje("Adamus Fischer", "Fischer", work_count=0),
    ]
    assert jarjesta(ps, entries, "fisch") == ["Adamus Fischer", "Keegi Hirschfisch"]


def test_nimesovaste_voidab_ainult_sildivaste(ps):
    """Kirje, mille nimes päringut ei ole, matšis sildi või välise aliase kaudu."""
    entries = [
        kirje("Keegi Tundmatu", "Tundmatu", work_count=99),
        kirje("Michael Dau", "Dau", work_count=1),
    ]
    assert jarjesta(ps, entries, "dau") == ["Michael Dau", "Keegi Tundmatu"]


def test_alias_voidab_ainult_sildivaste(ps):
    """Nimevariant on nimevaste: „Ludenius" peab leidma Lorenz Ludeni (ADR 0022)."""
    entries = [
        kirje("Keegi Tundmatu", "Tundmatu", work_count=99),
        kirje("Lorenz Luden", "Luden", work_count=1, aliases=["Laurentius Ludenius"]),
    ]
    assert jarjesta(ps, entries, "ludenius") == ["Lorenz Luden", "Keegi Tundmatu"]


def test_valine_alias_loeb_nimevasteks(ps):
    """`person_aliases.json` võtmed (Wikidata/GND) on sama väärt kui kaardi omad."""
    entries = [
        kirje("Keegi Tundmatu", "Tundmatu", work_count=99, pid="vutt:Ptundmatu"),
        kirje("Lorenz Luden", "Luden", work_count=1, pid="vutt:Pluden"),
    ]
    aliases_data = {"vutt:Pluden": {"aliases": ["Laurentius Ludenius"]}}
    assert jarjesta(ps, entries, "ludenius", aliases_data) == \
        ["Lorenz Luden", "Keegi Tundmatu"]


# ---- kaal otsustab astme sees ----

def test_teosearv_otsustab_sama_astme_sees(ps):
    """„fischer" → kõigil identne perekonnanimi; ainus eristaja on teosearv."""
    entries = [
        kirje("Christiana Elisabeth Fischer", "Fischer", work_count=1),
        kirje("Christianus Fischer", "Fischer", work_count=0),
        kirje("Johann Fischer", "Fischer", work_count=8),
    ]
    assert jarjesta(ps, entries, "fischer")[0] == "Johann Fischer"


def test_puuduv_teosearv_ei_viska(ps):
    """Vana indeksikirje võib olla ilma `work_count`-ita — 0, mitte erand."""
    entries = [kirje("Adamus Fischer", "Fischer", work_count=3)]
    entries.append({"id": "vutt:Pvana", "label": "Vana Kirje", "sort_name": "Fischer"})
    assert jarjesta(ps, entries, "fischer") == ["Adamus Fischer", "Vana Kirje"]


# ---- järjestus peab olema TÄIELIK ----

def test_jarjestus_on_taielik(ps):
    """Kaks igas mõõdus võrdset kirjet ei tohi laadimiste vahel kohta vahetada."""
    a = kirje("Johannes Andreae", "Andreae", work_count=1, pid="vutt:Pa")
    b = kirje("Johannes Andreae", "Andreae", work_count=1, pid="vutt:Pb")
    assert ps._relevance_key(a, "andreae", {}) != ps._relevance_key(b, "andreae", {})


# ---- list_persons integratsioon ----

INDEX_ENTRIES = [
    kirje("Christiana Elisabeth Fischer", "Fischer", work_count=1),
    kirje("Christianus Fischer", "Fischer", work_count=0),
    kirje("Adamus Fischer", "Fischer", work_count=0),
    kirje("Johann Fischer", "Fischer", work_count=8),
    kirje("Petrus Aaberg", "Aaberg", work_count=300, aliases=["Petrus Fischerus"]),
]


@pytest.fixture
def indeks(ps, monkeypatch):
    monkeypatch.setattr(ps, "sync_from_facade", lambda: None)
    monkeypatch.setattr(ps, "_load_index", lambda: {"entries": INDEX_ENTRIES})
    monkeypatch.setattr(ps, "_load_person_aliases", lambda: {})
    return ps


def test_list_persons_relevantsus_tostab_kaaluka_nimekaimu_ette(indeks):
    res = indeks.list_persons(q="fischer", sort_by="relevance")
    assert res["results"][0]["label"] == "Johann Fischer"


def test_list_persons_relevantsus_hoiab_tapse_vaste_eespool_suuremast(indeks):
    """Aabergil on 300 teost, aga „fischer" on ainult tema aliases.

    Aaberg on tähestikus esimene — nii eristab test parandust vanast koodist.
    """
    labels = [e["label"] for e in indeks.list_persons(q="fischer", sort_by="relevance")["results"]]
    assert labels.index("Johann Fischer") < labels.index("Petrus Aaberg")


def test_list_persons_relevantsus_ilma_paringuta_on_tahestikuline(indeks):
    """Relevantsus ilma `q`-ta ei ole olek — vaikimisi tähestik jääb kehtima."""
    ilma_q = [e["label"] for e in indeks.list_persons(sort_by="relevance")["results"]]
    vaikimisi = [e["label"] for e in indeks.list_persons()["results"]]
    assert ilma_q == vaikimisi


def test_list_persons_vaikejarjestus_ei_muutu(indeks):
    """Sirvimisloend (`PersonsPage`) peab jääma tähestikuliseks."""
    labels = [e["label"] for e in indeks.list_persons(q="fischer")["results"]]
    assert labels[0] == "Petrus Aaberg"


def test_umberpooratud_kuju_ei_tee_eesnimest_tapset_vastet(ps):
    """„Horn, Petrus" annab `sort_name = "Petrus"` — see ei ole perekonnanimi.

    Mõõdetud tootmises: „Petrus" (97 vastet) tõstis nii kolm 1-teoselist
    isikut 7-teoselise Petrus Andreae ette.
    """
    entries = [
        kirje("Horn, Petrus", "Petrus", work_count=1),
        kirje("Petrus Andreae", "Andreae", work_count=7),
    ]
    assert jarjesta(ps, entries, "petrus")[0] == "Petrus Andreae"
