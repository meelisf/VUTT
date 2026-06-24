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


# =========================================================
# Edge case'id (issue #19)
# =========================================================

def test_kolm_aastat_votab_esimene_ja_viimane():
    # Mitmest aastast võetakse esimene ja viimane (vahemik)
    assert parse_year_range(None, "1670, 1680, 1690") == (1670, 1690)


def test_ca_ilma_punktita():
    # "ca 1750" (ilma punktita) → samuti approx ±10
    assert parse_year_range(None, "ca 1750") == (1740, 1760)


def test_ca_suurtahetundlik():
    # "CA. 1750" suurtähtedega → approx (regex IGNORECASE)
    assert parse_year_range(None, "CA. 1750") == (1740, 1760)


def test_circa_ei_ole_approx():
    # "circa" EI kattu approx-mustriga (\bca\b ei taba 'circa' sees) → tavaline üksik aasta.
    # Regressioonikaits: keegi ei "paranda" seda approx-iks.
    assert parse_year_range(None, "circa 1750") == (1750, 1750)


def test_approx_display_peab_numbrilist_aastat():
    # year_display domineerib year parametri üle ka approx-korral
    assert parse_year_range(1800, "ca. 1750") == (1740, 1760)


def test_üksik_aasta_display_peab_numbrilist():
    # display üksik aasta alistab year-i
    assert parse_year_range(1900, "1670") == (1670, 1670)


def test_display_int_coerceitakse_str_ks():
    # year_display mittestring (nt int) → str()-ks, töötleb samamoodi
    assert parse_year_range(None, 1750) == (1750, 1750)


def test_display_falsy_int_kaotab():
    # year_display=0 on väär → langeb läbi year-i (None → None)
    assert parse_year_range(None, 0) is None


def test_müra_üks_aasta():
    # Loendamata tekst ümber aasta → ekstraheerib 4-kohalise aasta
    assert parse_year_range(None, "trükitud 1670. aastal") == (1670, 1670)


def test_bool_year_coerceitakse_int_ks():
    # int(True) == 1 — dokumenteerib kooseerimise (bool on int alamtüüp)
    assert parse_year_range(True, None) == (1, 1)


# --- Lukustatud varjatud käitumised (potentsiaalsed vead, flagitud PR-is) ---
# Need testid fikseerivad PRAEGUSE käitumise regressioonikaitsena. Kui neid
# parandada (vt all), tuleb ka vastav test uuendada.

def test_peatatud_reverse_vahemik_on_sortimata():
    """Tagurpidi vahemik "1690-1670" annab (1690, 1670) — year_start > year_end.

    POTENTSIAALNE VIGA: _YEAR4_RE.findall tagastab [1690, 1670] ja kood võtab
    (years[0], years[-1]) sortimata. See võib jätta year_start > year_end,
    mis rikkub aastavahemiku filtrite loogikat. Reaalses andmes ebatõenäoline
    (sisend on harva tagurpidi), aga väärt follow-up-i.
    """
    assert parse_year_range(None, "1690-1670") == (1690, 1670)


def test_peatatud_sajandite_vahemik_tagastab_none():
    """"Sajandite vahemik "17.-19. saj" tagastab None.

    POTENTSIAALNE VIGA: _CENTURY_RE (ankerdatud ^) tabab ainult esimest sajandit
    ja eeldab kohe 'saj' järel; "17.-19. saj" ei klapi, _YEAR4_RE ei leia
    4-kohalisi (19 on 2-kohaline) → kogu display langeb läbi → tulem None.
    Tulemuseks year_start=year_end=0 (rippub kutsujast), mis rikkub filtrit.
    Väärt follow-up-i, kui selliseid teoseid serveris esineb.
    """
    assert parse_year_range(None, "17.-19. saj") is None
