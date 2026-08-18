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


# ─────────────────────────────────────────────────────────────
# Nimekuju: GND annab pööratud kuju, kaardile läheb loomulik (issue #240)
# ─────────────────────────────────────────────────────────────

def test_dnb_nimi_ja_variandid_loomulikus_jarjekorras():
    result = _parse_dnb_jsonld(DNB_NODES, "122483294")
    assert result["name.label"] == "Karl Kühlstaedt"
    assert result["name.aliases"] == [
        "Carl Kühlstädt",
        "Carolus Kühlstaedt",
        "Carl Gotthard Kühlstaedt",
    ]


def test_lobid_nimi_ja_variandid_loomulikus_jarjekorras():
    from server.prosopography.enrichment import _parse_lobid

    result = _parse_lobid({
        "preferredName": "Ludenius, Laurentius",
        "variantName": ["Luden, Lorenz", "Ludenius, Laurentius"],
    })
    assert result["name.label"] == "Laurentius Ludenius"
    assert result["name.aliases"] == ["Lorenz Luden", "Laurentius Ludenius"]


def test_lobid_koht_ja_amet_sailivad():
    """Nimekuju muutus ei tohi ülejäänud kaardistust ära lõhkuda."""
    from server.prosopography.enrichment import _parse_lobid

    result = _parse_lobid({
        "dateOfBirth": ["1592-03-11"],
        "placeOfBirth": [{"label": "Stockholm"}],
        "gender": [{"id": "https://d-nb.info/standards/vocab/gnd/gender#male", "label": "Männlich"}],
        "professionOrOccupation": [{"label": "Hochschullehrer"}],
    })
    assert result["birth.date"] == "1592-03-11"
    assert result["birth.precision"] == "day"
    assert result["birth.place"] == {"id": None, "label": "Stockholm"}
    assert result["gender"] == "M"
    assert result["_occupations"] == [{"id": None, "label": "Hochschullehrer"}]
