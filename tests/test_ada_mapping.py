"""ADA Dublin Core → VUTT väljad. Fixture'id on PÄRIS API vastused (2026-09-03)."""
import json
from pathlib import Path

import pytest

from server.ada import mapping

FIXTURES = Path(__file__).parent / "fixtures" / "ada"


@pytest.fixture
def item():
    return json.loads((FIXTURES / "item.json").read_text(encoding="utf-8"))


@pytest.fixture
def bitstreams():
    d = json.loads((FIXTURES / "bitstreams.json").read_text(encoding="utf-8"))
    return d["_embedded"]["bitstreams"]


# --- failinime kuupäev ---

def test_taiskuupaev():
    assert mapping.parse_failinime_kuupaev("07.03.1813.pdf")[:4] == (1813, 3, 7, 0)


def test_ainult_kuu_ja_aasta_ei_valeta_paeva():
    """11.1815.pdf EI OLE 1815-11-01 — päev on teadmata, mitte esimene."""
    assert mapping.parse_failinime_kuupaev("11.1815.pdf")[:4] == (1815, 11, 0, 1)


def test_ainult_aasta():
    assert mapping.parse_failinime_kuupaev("1813.pdf")[:4] == (1813, 0, 0, 2)


def test_parsimatu_laheb_loppu():
    aasta = mapping.parse_failinime_kuupaev("9997.pdf")[0]
    assert aasta > 9000


# --- sortimine ---

def test_sortimine_parandab_ada_jarjekorra(bitstreams):
    """ADA annab neli 1816. aasta kirja loendi LÕPUS — sortimine toob nad tagasi."""
    sorditud = [b["name"] for b in mapping.sordi_bitstreamid(bitstreams)]
    assert sorditud.index("28.12.1816.pdf") < sorditud.index("09.01.1823.pdf")


def test_dateerimata_on_loppu(bitstreams):
    """Dateerimata failid lähevad lõppu ja säilitavad seal ADA ENDA järjekorra.

    ADA annab need järjekorras 9999 → 9998 → 9997; tähestik annaks vastupidise.
    Import ei tohi järjestust välja mõelda seal, kus tal alust ei ole.
    """
    sorditud = [b["name"] for b in mapping.sordi_bitstreamid(bitstreams)]
    assert sorditud[-3:] == ["9999.pdf", "9998.pdf", "9997.pdf"]


def test_dateerimata_ei_sorteerita_tahestikuliselt():
    """Mõõdetud ADA-s: enamik failinimesid EI OLE `dd.mm.yyyy` (0/127 valimis).

    Nende puhul oli varasem tähestikuline sortimine aktiivne kahju — kirjes
    10062/1778 tõstis see kirjaveaga `kinger.pdf` ette ja dateeritud kirjad lõppu,
    kuigi ADA oli need mõistlikult järjestanud.
    """
    ada_jarjekord = [
        {"name": "klinger17.05.1803.pdf"},
        {"name": "zzz.pdf"},
        {"name": "klinger.fr.pdf"},
        {"name": "kinger.pdf"},
    ]
    sorditud = [b["name"] for b in mapping.sordi_bitstreamid(ada_jarjekord)]
    # Dateeritud fail tuleb ette; ülejäänud kolm SÄILITAVAD ADA järjekorra
    # (tähestik annaks kinger → klinger.fr → zzz).
    assert sorditud == ["klinger17.05.1803.pdf", "zzz.pdf", "klinger.fr.pdf", "kinger.pdf"]


def test_osaline_kuupaev_perioodi_alguses(bitstreams):
    """1813.pdf (ainult aasta) tuleb enne 07.03.1813.pdf-i."""
    sorditud = [b["name"] for b in mapping.sordi_bitstreamid(bitstreams)]
    assert sorditud.index("1813.pdf") < sorditud.index("07.03.1813.pdf")


def test_sortimine_ei_kaota_ega_lisa_faile(bitstreams):
    assert len(mapping.sordi_bitstreamid(bitstreams)) == 65


# --- DC → VUTT ---

def test_pealkiri_ja_aasta(item):
    v = mapping.dc_vuttiks(item)
    assert v["title"] == "65 kirja Karl Morgensternile, \tSt. Petersburg"
    assert v["year"] == "1812"


def test_year_display_tuleb_coverage_temporalist(item):
    assert mapping.dc_vuttiks(item)["year_display"] == "31. dets.1812 - 9. jaan.1823; 7 k. s.d."


def test_creators_on_paljas_tekst_ilma_q_koodita(item):
    """Automaatne prosopograafia-sidumine tekitas duplikaat-ID-d (#240)."""
    loojad = mapping.dc_vuttiks(item)["creators"]
    assert loojad == [{"label": "Klinger, Friedrich Maximilian von"}]


def test_keel_kaardistub_iso_koodiks(item):
    assert mapping.dc_vuttiks(item)["languages"] == ["deu"]


def test_tundmatu_keel_jaetakse_valja_mitte_ei_arvata():
    v = mapping.dc_vuttiks({"metadata": {"dc.language": [{"value": "Volapük"}]}})
    assert v["languages"] == []


def test_ester_id_parsitakse_urlist(item):
    assert mapping.dc_vuttiks(item)["ester_id"] == "b1812728"


def test_archive_ref_tur_vaikimisi(item):
    assert mapping.dc_vuttiks(item)["archive_refs"] == [
        {"archive_id": "TÜR", "reference": "F 3,Mrg CCCXLII,kd.8,l.246-362"}
    ]


def test_external_url_on_handle(item):
    assert mapping.dc_vuttiks(item)["external_url"] == "http://hdl.handle.net/10062/7822"


def test_subject_ei_lahe_tagidesse(item):
    assert "tags" not in mapping.dc_vuttiks(item)


# --- mitmeväärtuselisus ---

def test_mitu_autorit_koik_sailivad():
    v = mapping.dc_vuttiks({"metadata": {"dc.contributor.author": [
        {"value": "Klinger, F. M. von"}, {"value": "Morgenstern, Karl"}]}})
    assert [c["label"] for c in v["creators"]] == ["Klinger, F. M. von", "Morgenstern, Karl"]


def test_mitu_keelt_koik_tuntud_sailivad():
    v = mapping.dc_vuttiks({"metadata": {"dc.language": [
        {"value": "German"}, {"value": "Latin"}, {"value": "Volapük"}]}})
    assert v["languages"] == ["deu", "lat"]


def test_mitu_identifier_otherit_annab_mitu_archive_refi():
    v = mapping.dc_vuttiks({"metadata": {"dc.identifier.other": [
        {"value": "F 3, kd.8"}, {"value": "F 4, kd.9"}]}})
    assert [r["reference"] for r in v["archive_refs"]] == ["F 3, kd.8", "F 4, kd.9"]


def test_description_uri_ainult_ester_loeb():
    v = mapping.dc_vuttiks({"metadata": {"dc.description.uri": [
        {"value": "https://example.org/muu"},
        {"value": "http://tartu.ester.ee/record=b9999999~S1*est"}]}})
    assert v["ester_id"] == "b9999999"


def test_pealkiri_eelistab_et_keelt():
    v = mapping.dc_vuttiks({"metadata": {"dc.title": [
        {"value": "Ohne Sprache", "language": None},
        {"value": "Eestikeelne", "language": "et"}]}})
    assert v["title"] == "Eestikeelne"
