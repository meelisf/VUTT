"""Kolm puutepunkti, mille vahelejätmine annab vaikse vea."""
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.prosopography.git_history import _DIFF_IGNORED_FIELDS, compute_person_diff  # noqa: E402
from server.prosopo_biography_fields import AA_RAW, BIOGRAPHY_EN, BIOGRAPHY_ET, SRC_EN, SRC_ET  # noqa: E402


def test_ankrud_ei_tekita_ajaloos_mura():
    assert SRC_ET in _DIFF_IGNORED_FIELDS
    assert SRC_EN in _DIFF_IGNORED_FIELDS
    muutused = compute_person_diff(
        {SRC_EN: None, BIOGRAPHY_EN: "sama"},
        {SRC_EN: {"hash": "abc", "at": "x"}, BIOGRAPHY_EN: "sama"})
    assert muutused == []


def test_keeleväljad_ilmuvad_ajalukku_ilma_lisakoodita():
    muutused = compute_person_diff({BIOGRAPHY_ET: "vana"}, {BIOGRAPHY_ET: "uus"})
    assert [m["field"] for m in muutused] == [BIOGRAPHY_ET]


def test_aa_rikastus_kirjutab_aa_raw_valja(monkeypatch):
    # `_fetch_aa` (enrichment.py:650) loeb korpuse `_load_aa()` kaudu ja otsib
    # kirje `entry_number` järgi — testime kaardistust võltsitud korpusega.
    from server.prosopography import enrichment
    monkeypatch.setattr(enrichment, "_load_aa", lambda: [{
        "entry_number": 154,
        "person": {"name": {"full": "Lünaeus, Emundus"}},
        "raw_text": "154. Lünaeus, Emundus.",
    }])
    tulem = enrichment._fetch_aa("AA:154")
    assert tulem[AA_RAW] == "154. Lünaeus, Emundus."
    assert "biography" not in tulem


def test_seo_kirjeldus_votab_eluloo_mitte_aa_kirje():
    from server.metadata_handler import _person_biography_text
    assert _person_biography_text({AA_RAW: "154. AA", BIOGRAPHY_ET: "Elulugu."}) == "Elulugu."
    # ET puudub → EN; AA ei ole KUNAGI eluloo varuvariant.
    assert _person_biography_text({AA_RAW: "154. AA", BIOGRAPHY_EN: "Life."}) == "Life."
    assert _person_biography_text({AA_RAW: "154. AA"}) == ""
