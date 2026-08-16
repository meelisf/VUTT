"""Keskkonnamuutujate nimede leping (ADR 0021).

Taust: sama Meili otsinguvõti kandis nelja nime (`MEILI_SEARCH_KEY`,
`VITE_MEILI_SEARCH_API_KEY`, `MEILI_SEARCH_API_KEY`, `MEILI_API_KEY`) ja
master-võti veel kahte. `config.py` vaikne fallback-ahel sidus need kokku nii,
et vale nimi ei andnud kunagi veateadet — halvimal juhul omistati otsinguvõti
master-võtme pesasse. Üks nimi ühe seade kohta; legacy nimi peatab käivituse.
"""
import importlib
import os
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

CANONICAL = ("MEILI_URL", "MEILI_MASTER_KEY", "MEILI_SEARCH_KEY",
             "MEILI_SEARCH_KEY_UID", "IMAGE_TOKEN_SECRET")

LEGACY = ("MEILISEARCH_URL", "MEILISEARCH_MASTER_KEY", "MEILI_SEARCH_API_KEY",
          "MEILI_API_KEY", "VITE_MEILI_SEARCH_API_KEY")


def _reload_config(monkeypatch, env: dict, dotenv_text=None, tmp_path=None):
    """Laeb server.config uuesti antud keskkonnaga.

    `.env` faili lugemine suunatakse tmp_path'i, et arendaja päris `.env`
    testi tulemust ei mõjutaks.
    """
    for name in CANONICAL + LEGACY:
        monkeypatch.delenv(name, raising=False)
    for k, v in env.items():
        monkeypatch.setenv(k, v)

    if dotenv_text is not None:
        (tmp_path / ".env").write_text(dotenv_text, encoding="utf-8")
        monkeypatch.setenv("VUTT_DOTENV_DIR", str(tmp_path))
    else:
        monkeypatch.setenv("VUTT_DOTENV_DIR", str(tmp_path or PROJECT_ROOT / "nonexistent"))

    sys.modules.pop("server.config", None)
    return importlib.import_module("server.config")


def test_kanoonilised_nimed_loetakse(monkeypatch, tmp_path):
    cfg = _reload_config(monkeypatch, {
        "MEILI_URL": "http://meili:7700",
        "MEILI_MASTER_KEY": "master",
        "MEILI_SEARCH_KEY": "search",
        "MEILI_SEARCH_KEY_UID": "uid",
    }, tmp_path=tmp_path)

    assert cfg.MEILI_URL == "http://meili:7700"
    assert cfg.MEILI_KEY == "master"
    assert cfg.MEILI_SEARCH_KEY == "search"
    assert cfg.MEILI_SEARCH_KEY_UID == "uid"


def test_dotenv_taidab_augu_kui_susteemimuutuja_puudub(monkeypatch, tmp_path):
    cfg = _reload_config(
        monkeypatch,
        {"MEILI_MASTER_KEY": "susteemist"},
        dotenv_text='MEILI_URL="http://failist:7700"\nMEILI_SEARCH_KEY=failist-search\n',
        tmp_path=tmp_path,
    )

    assert cfg.MEILI_URL == "http://failist:7700"
    assert cfg.MEILI_SEARCH_KEY == "failist-search"
    assert cfg.MEILI_KEY == "susteemist"


def test_susteemimuutuja_on_dotenvist_ulimuslik(monkeypatch, tmp_path):
    cfg = _reload_config(
        monkeypatch,
        {"MEILI_URL": "http://susteemist:7700"},
        dotenv_text="MEILI_URL=http://failist:7700\n",
        tmp_path=tmp_path,
    )

    assert cfg.MEILI_URL == "http://susteemist:7700"


def test_url_vaikevaartus_kui_kuskil_pole(monkeypatch, tmp_path):
    cfg = _reload_config(monkeypatch, {}, tmp_path=tmp_path)

    assert cfg.MEILI_URL == "http://127.0.0.1:7700"


@pytest.mark.parametrize("legacy", LEGACY)
def test_legacy_nimi_keskkonnas_peatab_kaivituse(monkeypatch, tmp_path, legacy):
    """Vaikne fallback oli juurpõhjus — legacy nimi peab andma vali vea."""
    with pytest.raises(SystemExit) as exc:
        _reload_config(monkeypatch, {legacy: "ükskõik"}, tmp_path=tmp_path)

    assert legacy in str(exc.value)


@pytest.mark.parametrize("legacy", LEGACY)
def test_legacy_nimi_dotenvis_peatab_kaivituse(monkeypatch, tmp_path, legacy):
    with pytest.raises(SystemExit) as exc:
        _reload_config(monkeypatch, {}, dotenv_text=f"{legacy}=ükskõik\n",
                       tmp_path=tmp_path)

    assert legacy in str(exc.value)


def test_veateade_nimetab_kanoonilise_asenduse(monkeypatch, tmp_path):
    with pytest.raises(SystemExit) as exc:
        _reload_config(monkeypatch, {"MEILISEARCH_URL": "http://x:7700"},
                       tmp_path=tmp_path)

    assert "MEILI_URL" in str(exc.value)


def test_surnud_nimi_margitakse_eemaldatavaks(monkeypatch, tmp_path):
    with pytest.raises(SystemExit) as exc:
        _reload_config(monkeypatch, {"VITE_MEILI_SEARCH_API_KEY": "x"},
                       tmp_path=tmp_path)

    assert "eemalda" in str(exc.value).lower()


# ---- repo-ülene leping: legacy nimesid ei tohi kuskil enam olla ----

_SCAN_DIRS = ("server", "src", "scripts", "mcp", ".github")
_SCAN_FILES = ("docker-compose.yml", "vite.config.ts", ".env.example")
# Nendes failides on legacy nimed lubatud: nad DOKUMENTEERIVAD migratsiooni.
_ALLOWED = {
    "server/config.py",            # _LEGACY_ENV_NAMES kaart
    "tests/test_env_names.py",
    "docs/decisions/0021-uks-nimi-uhe-saladuse-kohta.md",
}


def _iter_repo_files():
    for d in _SCAN_DIRS:
        root = PROJECT_ROOT / d
        if not root.is_dir():
            continue
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            if any(part in {"node_modules", "__pycache__", "archive", "dist"}
                   for part in path.parts):
                continue
            if path.suffix not in {".py", ".ts", ".tsx", ".yml", ".yaml", ".sh", ".md"}:
                continue
            yield path
    for f in _SCAN_FILES:
        path = PROJECT_ROOT / f
        if path.is_file():
            yield path


@pytest.mark.parametrize("legacy", LEGACY)
def test_legacy_nime_ei_esine_repos(legacy):
    hits = []
    for path in _iter_repo_files():
        rel = str(path.relative_to(PROJECT_ROOT))
        if rel in _ALLOWED:
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        if legacy in text:
            hits.append(rel)

    assert not hits, f"{legacy} esineb veel: {hits}"
