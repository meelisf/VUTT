"""Gemini seadete lugemine ja `enabled` semantika (ADR 0021: üks nimi ühe seade kohta)."""
import importlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

NIMED = ("GEMINI_API_KEY", "GEMINI_OCR_MODEL", "GEMINI_MAX_INFLIGHT_REQUESTS",
         "GEMINI_THINKING_LEVEL", "GEMINI_MAX_RETRIES", "GEMINI_REQUEST_TIMEOUT",
         "GEMINI_MAX_REQUEST_BYTES", "GEMINI_MAX_PROMPT_BYTES", "GEMINI_MAX_FEW_SHOT")


def _reload(monkeypatch, tmp_path, env):
    for n in NIMED:
        monkeypatch.delenv(n, raising=False)
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    (tmp_path / ".env").write_text("", encoding="utf-8")
    monkeypatch.setenv("VUTT_DOTENV_DIR", str(tmp_path))
    import server.config as cfg
    return importlib.reload(cfg)


def test_vaikevaartused(monkeypatch, tmp_path):
    cfg = _reload(monkeypatch, tmp_path, {})
    assert cfg.GEMINI_API_KEY == ""
    assert cfg.GEMINI_OCR_MODEL == "gemini-3.8-flash"
    assert cfg.GEMINI_THINKING_LEVEL == "low"
    assert cfg.GEMINI_MAX_INFLIGHT_REQUESTS == 4
    assert cfg.GEMINI_MAX_RETRIES == 3
    assert cfg.GEMINI_REQUEST_TIMEOUT == 120
    assert cfg.GEMINI_MAX_REQUEST_BYTES == 15 * 1024 * 1024
    assert cfg.GEMINI_MAX_PROMPT_BYTES == 8192
    assert cfg.GEMINI_MAX_FEW_SHOT == 3


def test_puuduv_voti_tahendab_valja_lulitatud(monkeypatch, tmp_path):
    """Puuduv võti on KEHTIV seisund, mitte konfiguratsiooniviga."""
    cfg = _reload(monkeypatch, tmp_path, {})
    assert cfg.gemini_enabled() is False


def test_voti_lulitab_sisse(monkeypatch, tmp_path):
    cfg = _reload(monkeypatch, tmp_path, {"GEMINI_API_KEY": "abc"})
    assert cfg.gemini_enabled() is True


def test_temperature_nime_ei_ole(monkeypatch, tmp_path):
    """3.x-il deprecated — surnud env-nime ei looda (ADR 0021)."""
    cfg = _reload(monkeypatch, tmp_path, {})
    assert not hasattr(cfg, "GEMINI_TEMPERATURE")


def test_check_production_secrets_ei_noua_gemini_votit(monkeypatch, tmp_path):
    """Gemini on valikuline funktsioon — puuduv võti ei tohi käivitust peatada."""
    cfg = _reload(monkeypatch, tmp_path, {
        "VUTT_ENV": "production",
        "MEILI_MASTER_KEY": "paris-voti",
        "IMAGE_TOKEN_SECRET": "paris-saladus",
    })
    probleemid = cfg.check_production_secrets(exit_on_fail=False)
    assert probleemid == []
    assert not any("GEMINI" in p for p in probleemid)


def test_env_example_loetleb_koik_nimed():
    juur = Path(__file__).resolve().parents[1]
    tekst = (juur / ".env.example").read_text(encoding="utf-8")
    for n in NIMED:
        assert n in tekst, "{} puudub .env.example-ist".format(n)


def test_docker_compose_annab_nimed_konteinerisse():
    """Compose loetleb muutujad NIMELISELT — ainult .env ei jõua konteinerisse."""
    juur = Path(__file__).resolve().parents[1]
    tekst = (juur / "docker-compose.yml").read_text(encoding="utf-8")
    for n in NIMED:
        assert n in tekst, "{} puudub docker-compose.yml-ist".format(n)
