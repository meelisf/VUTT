"""GND varutee (d-nb.info) JSON-LD sõeluja testid.

lobid.org on üksik veapunkt (2026-08-07 oli päev otsa kättesaamatu), varutee
käib otse Saksa rahvusraamatukogust. Näidis on lühendatud väljavõte päris
vastusest: d-nb.info/gnd/122483294 (Karl Kühlstaedt).
"""
from server.prosopography.enrichment import _parse_dnb_jsonld

GND = "https://d-nb.info/standards/elementset/gnd#"

DNB_NODES = [
    {
        "@id": "_:node1",
        f"{GND}forename": [{"@value": "Carl"}],
        f"{GND}surname": [{"@value": "Kühlstädt"}],
    },
    {
        "@id": "https://d-nb.info/gnd/122483294",
        f"{GND}gndIdentifier": [{"@value": "122483294"}],
        f"{GND}preferredNameForThePerson": [{"@value": "Kühlstaedt, Karl"}],
        f"{GND}variantNameForThePerson": [
            {"@value": "Kühlstädt, Carl"},
            {"@value": "Kühlstaedt, Carolus"},
            {"@value": "Kühlstaedt, Carl Gotthard"},
        ],
        f"{GND}dateOfBirth": [{"@value": "1805"}],
        f"{GND}dateOfDeath": [{"@value": "1838"}],
    },
]


def test_nimi_ja_variandid():
    result = _parse_dnb_jsonld(DNB_NODES, "122483294")
    assert result["name.label"] == "Kühlstaedt, Karl"
    assert "Kühlstaedt, Carl Gotthard" in result["name.aliases"]
    assert len(result["name.aliases"]) == 3


def test_kuupaeva_tapsus_aasta():
    result = _parse_dnb_jsonld(DNB_NODES, "122483294")
    assert result["birth.date"] == "1805"
    assert result["birth.precision"] == "year"
    assert result["death.date"] == "1838"
    assert result["death.precision"] == "year"


def test_kuupaeva_tapsus_paev_ja_sugu():
    nodes = [{
        "@id": "https://d-nb.info/gnd/118540238",
        f"{GND}preferredNameForThePerson": [{"@value": "Goethe, Johann Wolfgang von"}],
        f"{GND}dateOfBirth": [
            {"@type": "http://www.w3.org/2001/XMLSchema#date", "@value": "1749-08-28"}
        ],
        f"{GND}gender": [{"@id": "https://d-nb.info/standards/vocab/gnd/gender#male"}],
    }]
    result = _parse_dnb_jsonld(nodes, "118540238")
    assert result["birth.date"] == "1749-08-28"
    assert result["birth.precision"] == "day"
    assert result["gender"] == "M"


def test_vale_id_ei_sega_teisi_kirjeid():
    """Blank node'id ja kõrvalkirjed ei tohi peakirje asemel läbi minna."""
    assert _parse_dnb_jsonld(DNB_NODES, "999999") == {}


def test_aliaste_arv_on_piiratud():
    nodes = [{
        "@id": "https://d-nb.info/gnd/1",
        f"{GND}variantNameForThePerson": [{"@value": f"Nimi {i}"} for i in range(30)],
    }]
    assert len(_parse_dnb_jsonld(nodes, "1")["name.aliases"]) == 10
