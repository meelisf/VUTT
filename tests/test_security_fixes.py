"""
Testid kolme turvalisusparanduse jaoks:
1. /meta/work/ rate limit
2. build_sitemap_xml kasutab dict snapshot'i (thread safety)
3. CSP unsafe-inline on eemaldatud nginx konfiguratsioonist
"""
import pytest


# ---------------------------------------------------------------------------
# 1. /meta/work/ rate limit
# ---------------------------------------------------------------------------

def test_meta_work_rate_limited_after_threshold(backend_env, monkeypatch):
    """/meta/work/ tagastab 429 kui IP ületab rate limiti."""
    rate_limit = pytest.importorskip("server.rate_limit")
    # Kasuta madalat piirmäära testimiseks
    monkeypatch.setattr(rate_limit, "RATE_LIMITS", {"/meta/work": (3, 60)})

    client = backend_env["client"]
    # Esimesed 3 päringut lubatud
    for _ in range(3):
        r = client.get("/meta/work/some-id", headers={"X-Real-IP": "1.2.3.4"})
        assert r.status_code != 429, f"Esimesed päringud ei tohi olla blokeeritud, saadi {r.status_code}"
    # 4. päring peab olema blokeeritud
    r = client.get("/meta/work/some-id", headers={"X-Real-IP": "1.2.3.4"})
    assert r.status_code == 429


def test_meta_work_rate_limit_per_ip(backend_env, monkeypatch):
    """Eri IP-d ei jaga rate limiti."""
    rate_limit = pytest.importorskip("server.rate_limit")
    monkeypatch.setattr(rate_limit, "RATE_LIMITS", {"/meta/work": (1, 60)})

    client = backend_env["client"]
    # IP A ammendab limiidi
    client.get("/meta/work/x", headers={"X-Real-IP": "10.0.0.1"})
    r_a = client.get("/meta/work/x", headers={"X-Real-IP": "10.0.0.1"})
    assert r_a.status_code == 429

    # IP B on endiselt lubatud
    r_b = client.get("/meta/work/x", headers={"X-Real-IP": "10.0.0.2"})
    assert r_b.status_code != 429


def test_meta_work_rate_limit_returns_retry_after(backend_env, monkeypatch):
    """429 vastus sisaldab Retry-After päist."""
    rate_limit = pytest.importorskip("server.rate_limit")
    monkeypatch.setattr(rate_limit, "RATE_LIMITS", {"/meta/work": (1, 60)})

    client = backend_env["client"]
    client.get("/meta/work/x", headers={"X-Real-IP": "5.5.5.5"})
    r = client.get("/meta/work/x", headers={"X-Real-IP": "5.5.5.5"})

    assert r.status_code == 429
    assert "retry-after" in {k.lower() for k in r.headers}


# ---------------------------------------------------------------------------
# 2. build_sitemap_xml kasutab dict snapshot'i
# ---------------------------------------------------------------------------

def test_sitemap_uses_snapshot_not_live_cache(monkeypatch):
    """sitemap_xml endpoint kasutab dict snapshot'i, mitte otseviita WORK_ID_CACHE-le."""
    import importlib
    import server.main as main_mod
    import server.utils as utils_mod

    captured_args = []

    original = main_mod.build_sitemap_xml

    def capturing_build(cache, *args, **kwargs):
        captured_args.append(cache)
        return original(cache, *args, **kwargs)

    monkeypatch.setattr(main_mod, "build_sitemap_xml", capturing_build)
    monkeypatch.setattr(main_mod, "_sitemap_cache", {"xml": None, "expires": 0.0})

    original_cache = utils_mod.WORK_ID_CACHE
    monkeypatch.setattr(utils_mod, "WORK_ID_CACHE", {"w1": "/data/w1", "w2": "/data/w2"})

    import asyncio
    asyncio.run(main_mod.sitemap_xml())

    assert captured_args, "build_sitemap_xml ei kutsutud"
    passed_cache = captured_args[0]
    # Peab olema eraldi objekt, mitte sama viide
    assert passed_cache is not utils_mod.WORK_ID_CACHE, (
        "sitemap_xml peaks andma build_sitemap_xml-le snapshot'i, mitte otseviita"
    )


# ---------------------------------------------------------------------------
# 3. CSP unsafe-inline on nginx konfiguratsioonist eemaldatud
# ---------------------------------------------------------------------------

def test_csp_no_unsafe_inline_in_nginx_config():
    """Nginx konfiguratsioon ei tohi sisaldada script-src unsafe-inline."""
    import subprocess
    result = subprocess.run(
        ["ssh", "vutt", "grep -n 'unsafe-inline' /etc/nginx/sites-available/vutt"],
        capture_output=True, text=True, timeout=10,
    )
    import re
    problem_lines = []
    for line in result.stdout.splitlines():
        if "Content-Security-Policy" not in line:
            continue
        # Eraldame script-src direktiivi väärtuse (lõpeb ';' või stringilõpuga)
        m = re.search(r"script-src\s+([^;\"]+)", line)
        if m and "'unsafe-inline'" in m.group(1):
            problem_lines.append(line)
    assert not problem_lines, (
        f"Nginx CSP script-src sisaldab unsafe-inline:\n" + "\n".join(problem_lines)
    )


# ---------------------------------------------------------------------------
# 4. Prosopograafia path traversal kaitse (Leid F)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("bad_id", [
    "vutt:P../../../etc/passwd",
    "vutt:P/etc/passwd",
    "vutt:P..",
    "vutt:P../secret",
    "vutt:Pa/b",
    "vutt:P.",
])
def test_person_id_path_traversal_blocked(bad_id):
    """_id_to_path ja _person_image_path peavad tõstma ValueError path traversal'i korral."""
    from server.prosopography.ops import _id_to_path, _person_image_path
    with pytest.raises(ValueError):
        _id_to_path(bad_id)
    with pytest.raises(ValueError):
        _person_image_path(bad_id, ".jpg")


def test_person_id_valid_passes():
    """Korrektne nanoid läbib ja lahendub prosopograafia kausta."""
    import os
    from server.prosopography.ops import _id_to_path
    from server.config import PROSOPOGRAPHY_DIR
    path = _id_to_path("vutt:Pabc123")
    assert path == os.path.join(PROSOPOGRAPHY_DIR, "abc123.json")


def test_get_person_returns_none_for_malformed_id():
    """get_person / get_person_image_path tagastavad None (mitte erind) vigase ID korral."""
    from server.prosopography.ops import get_person, get_person_image_path
    assert get_person("vutt:P../../../etc/passwd") is None
    assert get_person_image_path("vutt:P../../../etc/passwd") is None


# ---------------------------------------------------------------------------
# 5. Upload slug / upload_id path traversal kaitse (Leid H)
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("evil_slug", [
    "../../../etc/passwd",
    "../escape",
    "/abs/path",
    "a/b/c",
])
def test_sanitize_slug_neutralizes_traversal(evil_slug):
    """sanitize_slug eemaldab kõik path-ohtlikud märgid (., /)."""
    from server.upload_ops import sanitize_slug
    result = sanitize_slug(evil_slug)
    assert ".." not in result
    assert "/" not in result
    assert "." not in result


def test_sanitize_slug_idempotent():
    """Juba korrektne slug ei muutu re-sanitiseerimisel."""
    from server.upload_ops import sanitize_slug
    valid = "tartu-akadeemia-1632"
    assert sanitize_slug(valid) == valid


@pytest.mark.parametrize("bad_id", [
    "../../../tmp/evil",
    "../escape",
    "a/b",
    "UPPER",
    "has space",
    "x" * 21,
])
def test_valid_upload_id_rejects_traversal(bad_id):
    """_valid_upload_id lükkab tagasi kõik mitte-nanoid stringid."""
    from server.upload_ops import _valid_upload_id
    assert _valid_upload_id(bad_id) is False


def test_valid_upload_id_accepts_nanoid():
    from server.upload_ops import _valid_upload_id
    assert _valid_upload_id("abc123def456") is True
