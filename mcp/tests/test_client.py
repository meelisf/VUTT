"""HTTP-kihi testid — httpx MockTransport, päris võrku ei puututa."""
import httpx
import pytest

from vutt_mcp.client import VuttClient
from vutt_mcp.config import Settings
from vutt_mcp.errors import (
    VuttConfigError,
    VuttError,
    VuttNotFound,
    VuttTemporaryError,
)

SETTINGS = Settings(base_url="https://example.test", meili_key="k")


def _client(handler) -> VuttClient:
    return VuttClient(SETTINGS, transport=httpx.MockTransport(handler))


def test_meili_search_saadab_bearer_ja_oige_tee():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers.get("authorization")
        return httpx.Response(200, json={"hits": []})

    _client(handler).meili_search({"q": "x"})
    assert seen["url"] == "https://example.test/meili/indexes/teosed/search"
    assert seen["auth"] == "Bearer k"


def test_api_get_kasutab_api_files_prefiksit():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        return httpx.Response(200, json={"ok": True})

    _client(handler).api_get("/prosopography", params={"q": "Luden"})
    assert seen["url"].startswith("https://example.test/api/files/prosopography")
    assert "q=Luden" in seen["url"]


def test_5xx_proovitakse_uuesti_uks_kord():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(503)
        return httpx.Response(200, json={"hits": []})

    assert _client(handler).meili_search({"q": "x"}) == {"hits": []}
    assert calls["n"] == 2


def test_429_proovitakse_uuesti_ja_retry_after_loetakse():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(429, headers={"Retry-After": "0"})
        return httpx.Response(200, json={"ok": True})

    assert _client(handler).api_get("/prosopography") == {"ok": True}
    assert calls["n"] == 2


def test_timeout_proovitakse_uuesti():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] == 1:
            raise httpx.ReadTimeout("aegus", request=request)
        return httpx.Response(200, json={"ok": True})

    assert _client(handler).api_get("/x") == {"ok": True}
    assert calls["n"] == 2


def test_400_ei_proovita_uuesti():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        return httpx.Response(400, json={"message": "vale filter"})

    with pytest.raises(VuttError):
        _client(handler).meili_search({"q": "x"})
    assert calls["n"] == 1


def test_404_annab_VuttNotFound():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"detail": "puudub"})

    with pytest.raises(VuttNotFound):
        _client(handler).api_get("/prosopography/puudub")


def test_kordusekatse_ammendumisel_ajutine_viga():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503)

    with pytest.raises(VuttTemporaryError):
        _client(handler).meili_search({"q": "x"})


def test_401_on_fataalne_konfiviga():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"code": "invalid_api_key"})

    with pytest.raises(VuttConfigError):
        _client(handler).meili_search({"q": "x"})


def test_load_settings_ilma_votmeta_kukub(monkeypatch):
    from vutt_mcp.config import load_settings

    monkeypatch.delenv("VUTT_MEILI_SEARCH_KEY", raising=False)
    with pytest.raises(VuttConfigError):
        load_settings()


def test_load_settings_vaikimisi_base_url(monkeypatch):
    from vutt_mcp.config import DEFAULT_BASE_URL, load_settings

    monkeypatch.setenv("VUTT_MEILI_SEARCH_KEY", "abc")
    monkeypatch.delenv("VUTT_BASE_URL", raising=False)
    assert load_settings().base_url == DEFAULT_BASE_URL
