"""Duplikaadikontroll uue isiku loomisel: kirjapildi erinevused (2026-11-25).

„Justus Samuel Scharschmidt" (valikust, Wikidata ID-ga) ei leidnud olemasolevat
kaarti „Justus Samuel Scharschmid" (variant „Scharschmied", AA:1371), sest
`name_matches` nõuab, et päringusõna oleks nimesõna ALGUS. Duplikaadikontroll
võrdleb nüüd normaliseeritud kujusid ja lubab ühe tähe erinevuse; tavaline
isikuotsing jääb nagu oli.
"""
import pytest

from server.prosopography import person_search as ps


@pytest.mark.parametrize("uus,olemas", [
    ("Justus Samuel Scharschmidt", "Justus Samuel Scharschmid"),
    ("Scharschmidt", "Scharschmied"),
    ("Laurentius Ludenius", "Laurentius Luden"),
    ("Christian Müller", "Christianus Muller"),
    ("Johann Schmidt", "Johannes Schmid"),
    ("Michael Wittenberg", "Michael Wittenbergk"),
    ("Petrus Hylander", "Petrus Hilander"),
    ("J. S. Scharschmidt", "Justus Samuel Scharschmid"),
])
def test_kirjapildi_variant_on_duplikaadikandidaat(uus, olemas):
    assert ps.dup_name_matches(uus, olemas)


@pytest.mark.parametrize("uus,olemas", [
    ("Justus Samuel Scharschmidt", "Justus Samuel Schmidt"),
    ("Johann Schmidt", "Johann Schultz"),
    ("Petrus Hylander", "Paulus Hylander"),
    ("Anna Berg", "Anders Berg"),
    # Pärisandmete müra (2130 isikut): initsiaalid kandidaadi aliases ja sõnajärg.
    ("Johannes Acander", "J. A. Comenius"),
    ("Abraham Agricola", "M. G. A. E. G."),
    ("Petrus Andreae", "Andreas Petri"),
])
def test_eri_nimi_ei_ole_kandidaat(uus, olemas):
    assert not ps.dup_name_matches(uus, olemas)


def test_tavaline_nimeotsing_jaab_rangeks():
    """Regressioonivalvur: muudatus ei puuduta `name_matches`-i (isikuotsing)."""
    assert not ps.name_matches("Scharschmidt", "Justus Samuel Scharschmid")


def _index(monkeypatch, entries):
    monkeypatch.setattr(ps, "_load_index_readonly", lambda: {"entries": entries})


def test_similar_persons_leiab_variandi_ja_perekonnanime_variandi(monkeypatch):
    _index(monkeypatch, [
        {"id": "vutt:Pvana", "label": "Justus Samuel Scharschmid", "aliases": [],
         "family_name_variants": [], "first_name": "Justus Samuel",
         "birth_year": 1664, "death_year": 1724},
        {"id": "vutt:Pvar", "label": "Georg Weber", "aliases": [],
         "family_name_variants": ["Scharschmied"], "first_name": "Georg"},
        {"id": "vutt:Pmuu", "label": "Justus Samuel Schmidt", "aliases": []},
    ])
    ids = [p["id"] for p in ps.similar_persons("Justus Samuel Scharschmidt")]
    assert ids == ["vutt:Pvana"]
    assert [p["id"] for p in ps.similar_persons("Georg Scharschmidt")] == ["vutt:Pvar"]


def test_similar_persons_eluaastad_jarjestavad(monkeypatch):
    _index(monkeypatch, [
        {"id": "vutt:Pvale", "label": "Johann Schmid", "aliases": [], "birth_year": 1580, "death_year": 1630},
        {"id": "vutt:Poige", "label": "Johann Schmid", "aliases": [], "birth_year": 1664, "death_year": 1724},
        {"id": "vutt:Pteadmata", "label": "Johann Schmid", "aliases": []},
    ])
    ids = [p["id"] for p in ps.similar_persons("Johann Schmidt", birth_year=1664, death_year=1724)]
    assert ids == ["vutt:Poige", "vutt:Pteadmata", "vutt:Pvale"]


def test_similar_persons_jatab_tombstone_valja(monkeypatch):
    _index(monkeypatch, [
        {"id": "vutt:Psurnud", "label": "Johann Schmid", "aliases": [], "record_status": "tombstone"},
    ])
    assert ps.similar_persons("Johann Schmidt") == []


def test_similar_otspunkt_kasutab_duplikaadikontrolli(monkeypatch):
    """GET /prosopography/similar — vorm ja paneel kutsuvad seda, mitte nimeotsingut."""
    from fastapi.testclient import TestClient
    from server.main import app
    _index(monkeypatch, [
        {"id": "vutt:Pvana", "label": "Justus Samuel Scharschmid", "aliases": []},
    ])
    r = TestClient(app).get("/prosopography/similar", params={"name": "Justus Samuel Scharschmidt"})
    assert r.status_code == 200
    assert [p["id"] for p in r.json()["results"]] == ["vutt:Pvana"]


def test_kandidaatide_similar_kasutab_duplikaadikontrolli(monkeypatch):
    from server.prosopography import candidates
    _index(monkeypatch, [
        {"id": "vutt:Pvana", "label": "Justus Samuel Scharschmid", "aliases": []},
    ])
    assert [p["id"] for p in candidates._similar("Scharschmidt")] == ["vutt:Pvana"]
