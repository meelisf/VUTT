"""parse_year_range — aastavahemiku tuletamine year + year_display paarist.

Peegelloogika frontendis: src/utils/yearDisplayUtils.ts parseYearDisplayRange
"""
from server.utils import parse_year_range


def test_exact_year():
    assert parse_year_range(1750, None) == (1750, 1750)


def test_ca_year_pm10():
    assert parse_year_range(1750, "ca. 1750") == (1740, 1760)


def test_range_endash():
    assert parse_year_range(None, "1670–1690") == (1670, 1690)


def test_range_hyphen():
    assert parse_year_range(None, "1686-1696") == (1686, 1696)


def test_century():
    assert parse_year_range(None, "19. saj") == (1801, 1900)


def test_century_long_form():
    assert parse_year_range(None, "19. sajand") == (1801, 1900)


def test_century_no_dot():
    assert parse_year_range(None, "19 saj") == (1801, 1900)


def test_century_whitespace_case():
    assert parse_year_range(None, "  17. Saj  ") == (1601, 1700)


def test_century_single_digit():
    assert parse_year_range(None, "9. saj") == (801, 900)


def test_century_beats_numeric_year():
    assert parse_year_range(1850, "19. saj") == (1801, 1900)


def test_year_before_saj_is_not_century():
    # "1750 saj" EI ole sajandimuster (4-kohaline aasta, mitte sajandinumber)
    assert parse_year_range(None, "1750 saj") == (1750, 1750)


def test_empty_returns_none():
    assert parse_year_range(None, None) is None
    assert parse_year_range(0, "") is None


def test_year_as_string():
    assert parse_year_range("1750", None) == (1750, 1750)


def test_garbage_year():
    assert parse_year_range("pole aasta", None) is None


def test_float_year_truncated():
    # JSON-numbrid võivad olla floatid; käitumine on dokumenteeritult trunkeeriv
    assert parse_year_range(1750.0, None) == (1750, 1750)


def test_whitespace_only_display_falls_through_to_year():
    assert parse_year_range(1700, "   ") == (1700, 1700)
