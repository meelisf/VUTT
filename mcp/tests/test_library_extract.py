import pytest
from library_fixtures import make_pdf

from vutt_mcp.library.extract import ExtractError, extract_pages, normalize_for_search


def test_ekstraheerib_lehekulgede_kaupa(tmp_path):
    pdf = make_pdf(tmp_path / "a.pdf", ["Esimene lehekulg.", "Teine lehekulg."])
    lehed = extract_pages(pdf)
    assert len(lehed) == 2
    assert "Esimene" in lehed[0]
    assert "Teine" in lehed[1]


def test_puuduv_fail_kukub(tmp_path):
    with pytest.raises(ExtractError):
        extract_pages(tmp_path / "pole.pdf")


def test_normaliseerimine_liidab_poolitatud_sona():
    toores = "disputa-\ntio de anima"
    assert "disputatio" in normalize_for_search(toores)


def test_normaliseerimine_uhtlustab_tyhikud():
    assert normalize_for_search("a   b\n\n c") == "a b c"


def test_normaliseerimine_ei_liida_paris_sidekriipsu():
    # Rea SEES olev sidekriips ei ole poolitus.
    assert "Gustavo-Carolina" in normalize_for_search("Academia Gustavo-Carolina")
