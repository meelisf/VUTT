import pytest
from library_fixtures import FakeZoteroAPI, kollektsioon

from vutt_mcp.library.zotero import ZoteroError, check_api, fetch_all


def test_fetch_all_jargib_pagineerimist():
    kogud = [kollektsioon(f"K{i:04d}", f"Kogu {i}") for i in range(120)]
    with FakeZoteroAPI(collections=kogud) as base:
        koik = fetch_all(base, "/collections", {"limit": 50})
    assert len(koik) == 120
    assert koik[0]["key"] == "K0000"
    assert koik[-1]["key"] == "K0119"


def test_valja_lulitatud_api_annab_juhise():
    with FakeZoteroAPI(collections=[], enabled=False) as base:
        with pytest.raises(ZoteroError, match="Local API"):
            check_api(base)


def test_kattesaamatu_zotero_annab_juhise():
    with pytest.raises(ZoteroError, match="ei vasta"):
        check_api("http://127.0.0.1:1/api/users/0")


def test_toimiv_api_labib():
    with FakeZoteroAPI(collections=[kollektsioon("K1", "Kogu")]) as base:
        check_api(base)  # ei tohi visata
