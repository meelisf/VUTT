"""Isiku nimeajalugu (ADR 0083): `name.names[]` ja „teine nimi?” reegel.

Reegli juhtumid (`OTHER_NAME_CASES`) on samad mis kliendi testis
`src/prosopography/utils/__tests__/personNames.test.ts` — kaks teostust peavad
andma sama vastuse (vormi vihje kliendis, loendi filter serveris).
"""
import pytest

from server.prosopography import person_names as pn

OTHER_NAME_CASES = [
    # (alias, kanooniline nimi, kas teine nimi)
    ("Johan Stiernstråle", "Johannes Erici Stregnensis", True),
    ("Johann Erici Strognensis", "Johannes Erici Stregnensis", False),
    ("Emund Gripenhielm", "Emundus Figrelius", True),
    ("Olaus Swebilius", "Olaus Svebilius", False),
    ("Olavus Suebilius", "Olaus Svebilius", False),
    ("Ol. Swebelius", "Olaus Svebilius", False),
    ("Olao Svebilio", "Olaus Svebilius", False),
    ("Samuel von Pufendorf", "Samuel Pufendorf", False),
    ("Laurentius Ludenius", "Lorenz Luden", False),
    ("Ludenius", "Lorenz Luden", False),
    ("Nicolaus (Niclas) Silfverskiöld", "Nicolaus Hyltenius", True),
    ("", "Lorenz Luden", False),
    # Tootmise läbijooks 2026-11-12: päris nimemuutused
    ("Sven Camenhjelm", "Sven Caméen", True),
    ("Petrus Cederschiöld", "Petrus Elias Gavelius", True),
    ("Rosine Elisabeth Marckthaler", "Rosine Elisabeth Fischer", True),
    ("Nicolaus Drysander", "Nicolaus Querculander", True),
    ("Scardanelli", "Friedrich Hölderlin", True),
    # … ja valepositiivsed, mis EI tohi märkida (ladinastus, kirjaviis, tähised, GND kuju)
    ("Esbernus Leimonius", "Esbernus Leiman", False),
    ("Georgius Langius", "Georgius Lange", False),
    ("Nicolaus Duncan", "Nicolaus Dunkanus", False),
    ("Joannes Paullius", "Joannes Pauli", False),
    ("Bengt Skydde", "Bengt Skytte", False),
    ("Jonas Johannis Scarinius", "Jonas Johannis Scarensis", False),
    ("Ericus Golstenius", "Ericus Gulsteen", False),
    ("Elaus Tellerus", "Elaus Tollenius", False),
    ("Jānis Rytter", "Jānis Reiters", False),
    ("Johan Heinrich Gerdtz", "Johann Heinrich Gerth", False),
    ("Michael Dau jun.", "Michael Dau", False),
    ("Michael Dau junior", "Michael Dau", False),
    ("Ammersbach, Heinrich, Ev. Theologe, Prof. an der Univ. Jena, später Pastor in Halberstadt",
     "Heinrich Ammersbach", False),
    # Teine läbijooks: lisatud päritolunimi ja c/k-kirjaviis on variandid …
    ("Petrus Laurentii Arbogensis", "Petrus Laurentii", False),
    ("Friedrich Breckling Holsatus", "Friedrich Breckling", False),
    ("Kamenios, Jōannes Amos", "Johann Amos Comenius", False),
    ("Christianus Klockhoff", "Christianus Clocovius", False),
    ("Johannes Chemnitius", "Johannes Kamnitz", False),
    # … aga patronüüm, aadlinimi ja tõlkenimi on teine nimi
    ("Erik Jönsson", "Erik Dahlberg", True),
    ("Lars Liljenstolpe", "Laurentius Micrander", True),
    ("Jacob Pistorius", "Jacob Becker", True),
]


@pytest.mark.parametrize("alias,label,expected", OTHER_NAME_CASES)
def test_looks_like_other_name(alias, label, expected):
    assert pn.looks_like_other_name(alias, label) is expected


def test_possible_name_change_only_without_names():
    name = {"label": "Emundus Figrelius", "aliases": ["Emund Gripenhielm", "Emundus Figrelfius"]}
    assert pn.possible_name_change(name) is True
    name["names"] = [{"label": "Emund Gripenhielm", "type": "ennobled"}]
    assert pn.possible_name_change(name) is False


def test_possible_name_change_false_for_spelling_variants_only():
    assert pn.possible_name_change({"label": "Olaus Svebilius", "aliases": ["Olaus Swebilius"]}) is False


def test_normalize_cleans_entries_and_moves_out_of_aliases():
    name = {
        "label": "Emundus Figrelius",
        "aliases": ["Emund Gripenhielm", "Emundus Figrelfius"],
        "names": [
            {"label": "  Emund Gripenhielm ", "type": "ennobled", "from": "1654", "to": None,
             "source": " SBL ", "notes": ""},
            {"label": "", "type": "ennobled"},                      # tühi → välja
            {"label": "X Y", "type": "tundmatu"},                   # tundmatu liik → other
            {"label": "emund gripenhielm", "type": "other"},        # kordus → välja
        ],
    }
    out = pn.normalize_name_obj(name)
    assert out["names"] == [
        {"label": "Emund Gripenhielm", "type": "ennobled", "from": 1654, "to": None,
         "source": "SBL", "notes": None},
        {"label": "X Y", "type": "other", "from": None, "to": None, "source": None, "notes": None},
    ]
    # Liigiga kuju ei ole samal ajal kirjaviisi variant
    assert out["aliases"] == ["Emundus Figrelfius"]


def test_normalize_without_names_is_noop():
    name = {"label": "A B", "aliases": ["A C"]}
    assert pn.normalize_name_obj(dict(name)) == name


def test_normalize_rejects_non_list():
    with pytest.raises(ValueError):
        pn.normalize_name_obj({"label": "A", "names": "Stiernstråle"})


def test_bad_year_becomes_none():
    out = pn.normalize_name_obj({"label": "A", "names": [{"label": "B", "type": "ennobled", "from": "u. 1650"}]})
    assert out["names"][0]["from"] is None


# ---- Ühendus kirjutustee, indeksi ja otsinguga ----

def test_update_person_normaliseerib_nimed(prosopo_env):
    from server.prosopography import person_crud
    k = prosopo_env.write("nnn", name={"label": "Emundus Figrelius", "aliases": ["Emund Gripenhielm", "Emundus Figrelfius"]})
    person_crud.update_person("vutt:Pnnn", {
        "name": {**k["name"], "names": [{"label": "Emund Gripenhielm", "type": "ennobled", "from": "1654"}]},
        "updated_at": k["updated_at"]}, "toimetaja")
    name = prosopo_env.read("nnn")["name"]
    assert name["names"][0]["label"] == "Emund Gripenhielm" and name["names"][0]["from"] == 1654
    assert name["aliases"] == ["Emundus Figrelfius"]


def test_update_person_vigane_names_annab_vea(prosopo_env):
    from server.prosopography import person_crud
    k = prosopo_env.write("nnm")
    with pytest.raises(ValueError, match="names_not_list"):
        person_crud.update_person("vutt:Pnnm", {
            "name": {**k["name"], "names": "Stiernstråle"}, "updated_at": k["updated_at"]}, "toimetaja")


def test_otsitavad_nimed_sisaldavad_liigiga_nimesid():
    from server.prosopography.indices import card_search_names
    names = card_search_names({"label": "Emundus Figrelius", "aliases": ["Emundus Figrelfius"],
                               "names": [{"label": "Emund Gripenhielm", "type": "ennobled"}]})
    assert "Emund Gripenhielm" in names


def test_indeksikirje_kannab_nimesid_ja_lippu():
    from tests.test_prosopography_ops import _build_entry
    e = _build_entry({"id": "p1", "name": {"label": "Emundus Figrelius", "aliases": ["Emund Gripenhielm"]}})
    assert e["possible_name_change"] is True and e["names"] == []
    e = _build_entry({"id": "p2", "name": {"label": "Emundus Figrelius", "aliases": [],
                                           "names": [{"label": "Emund Gripenhielm", "type": "ennobled", "from": 1654}]}})
    assert e["possible_name_change"] is False
    assert e["names"] == [{"label": "Emund Gripenhielm", "type": "ennobled", "from": 1654, "to": None}]
    assert "Emund Gripenhielm" in e["aliases"]  # otsing leiab


def test_filter_name_change(prosopo_env):
    from server.prosopography.person_search import list_persons, PersonFilters
    prosopo_env.index({"entries": [
        {"id": "a", "label": "A", "sort_name": "A", "record_status": "draft", "possible_name_change": True},
        {"id": "b", "label": "B", "sort_name": "B", "record_status": "draft", "possible_name_change": False},
    ]})
    res = list_persons(PersonFilters(name_change=True))
    assert [r["id"] for r in res["results"]] == ["a"]


def test_names_votmeta_salvestus_ei_kustuta_nimeajalugu(prosopo_env):
    """Vana vorm / rikastus saadab `name`-objekti ilma `names`-ita — ajalugu jääb."""
    from server.prosopography import person_crud
    k = prosopo_env.write("nno", name={"label": "Emundus Figrelius", "aliases": [],
                                       "names": [{"label": "Emund Gripenhielm", "type": "ennobled",
                                                  "from": 1654, "to": None, "source": None, "notes": None}]})
    person_crud.update_person("vutt:Pnno", {
        "name": {"label": "Emundus Figrelius", "aliases": ["Emund Gripenhielm", "Figrelius Emundus"]},
        "updated_at": k["updated_at"]}, "toimetaja")
    name = prosopo_env.read("nno")["name"]
    assert [n["label"] for n in name["names"]] == ["Emund Gripenhielm"]
    assert name["aliases"] == ["Figrelius Emundus"]  # kordus aliastest välja


def test_tuhi_names_loend_kustutab(prosopo_env):
    from server.prosopography import person_crud
    k = prosopo_env.write("nnp", name={"label": "A B", "aliases": [], "names": [{"label": "C D", "type": "other"}]})
    person_crud.update_person("vutt:Pnnp", {"name": {"label": "A B", "aliases": [], "names": []},
                                            "updated_at": k["updated_at"]}, "toimetaja")
    assert prosopo_env.read("nnp")["name"]["names"] == []


def test_liitmine_uhendab_nimeajaloo(prosopo_env, monkeypatch):
    from server.prosopography import merge_ops
    monkeypatch.setattr(merge_ops, "_rebind_work_parts", lambda *a, **k: None)
    prosopo_env.write("src", name={"label": "Emund Gripenhielm", "aliases": [],
                                   "names": [{"label": "Emund Gripenhielm", "type": "ennobled"},
                                             {"label": "Edmund Figrel", "type": "other"}]})
    prosopo_env.write("tgt", name={"label": "Emundus Figrelius", "aliases": [],
                                   "names": [{"label": "emund gripenhielm", "type": "ennobled", "from": 1654}]})
    merge_ops.merge_person("vutt:Psrc", "vutt:Ptgt", "admin")
    names = prosopo_env.read("tgt")["name"]["names"]
    assert [n["label"] for n in names] == ["emund gripenhielm", "Edmund Figrel"]
    assert names[0]["from"] == 1654  # sihtkaardi kirje jääb
