"""Nimekuju ühtlustamine allikate vahel (issue #240).

GND annab nii eelisnime kui variandid pööratud kujul („Perekonnanimi, Eesnimi"),
AA-tee teisendas selle juba loomulikku järjekorda, Wikidata annab loomuliku
järjekorra. Tulemus oli, et sama isiku kaardil võis nimekuju sõltuda sellest,
millisest allikast keegi juhtus rikastama.
"""
import pytest

from server.prosopography.enrichment import natural_name_order


@pytest.mark.parametrize("raw,expected", [
    ("Kühlstaedt, Karl", "Karl Kühlstaedt"),
    ("Goethe, Johann Wolfgang von", "Johann Wolfgang von Goethe"),
    ("Luden, Lorenz", "Lorenz Luden"),
    ("Ludenius,Laurentius", "Laurentius Ludenius"),
])
def test_pooratud_nimi_keeratakse_loomulikku_jarjekorda(raw, expected):
    assert natural_name_order(raw) == expected


@pytest.mark.parametrize("raw", [
    "Lorenz Luden",
    "Gustav II Adolf",
    "",
])
def test_komata_nimi_jaab_muutmata(raw):
    assert natural_name_order(raw) == raw


def test_mitme_komaga_nimi_jaab_muutmata():
    """„Gustav II Adolf, Schweden, König" ei ole perekonnanimi + eesnimi."""
    assert natural_name_order("Gustav II Adolf, Schweden, König") == "Gustav II Adolf, Schweden, König"


@pytest.mark.parametrize("raw", [
    "Innocentius XII, Papst",
    "Karl XI, König",
    "Johann Georg I, Kurfürst",
])
def test_tiitliga_nimi_jaab_muutmata(raw):
    """GND kasutab koma ka tiitli ees — pööramine annaks „Papst Innocentius XII"."""
    assert natural_name_order(raw) == raw


def test_tyhjad_pooled_ei_tekita_lisatyhikuid():
    assert natural_name_order("Luden,") == "Luden"
    assert natural_name_order(", Lorenz") == "Lorenz"


# ─────────────────────────────────────────────────────────────
# Sulgudes olevad nimevariandid (AA-tee)
# ─────────────────────────────────────────────────────────────

def test_sulgudes_olev_koma_ei_ole_nime_jaotuskoht():
    """AA kirjutab variandid sulgudesse: „Ekebrodd (Ekeberg, Ekebärg), Laurentius".

    Esimese koma pealt poolitamine andis „Ekebärg), Laurentius Ekebrodd (Ekeberg".
    """
    assert natural_name_order("Ekebrodd (Ekeberg, Ekebärg), Laurentius", strict=False) == \
        "Laurentius Ekebrodd (Ekeberg, Ekebärg)"


def test_strict_lubab_ainult_yhe_ylataseme_koma():
    """GND-teel on mitu koma tiitli tunnus — seal ei pöörata."""
    assert natural_name_order("Ekebrodd (Ekeberg, Ekebärg), Laurentius") == \
        "Laurentius Ekebrodd (Ekeberg, Ekebärg)"
    assert natural_name_order("Gustav II Adolf, Schweden, König") == \
        "Gustav II Adolf, Schweden, König"


def test_mittestrict_poorab_esimese_ylataseme_koma_pealt():
    assert natural_name_order("Wag(e)ner, Henricus, Christianus", strict=False) == \
        "Henricus, Christianus Wag(e)ner"


def test_sulgudega_nimi_ilma_ylataseme_komata_jaab_muutmata():
    assert natural_name_order("Göse¹ (Giös, Göös)") == "Göse¹ (Giös, Göös)"
