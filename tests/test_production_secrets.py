"""
Testid tootmise saladuste startup-kontrollile (Leid 1).

Kaetud käitumine:
- dev keskkonnas (VUTT_ENV != production) kontrolli ei tehta
- production + vaikimisi saladus → probleem / sys.exit
- production + puuduv saladus → probleem
- production + korralikud saladused → ok
"""
import pytest

import server.config as cfg


def _setup(monkeypatch, env, meili_key, image_secret):
    monkeypatch.setenv("VUTT_ENV", env)
    monkeypatch.setattr(cfg, "MEILI_KEY", meili_key)
    monkeypatch.setattr(cfg, "IMAGE_TOKEN_SECRET", image_secret)


def test_dev_env_skips_check(monkeypatch):
    _setup(monkeypatch, "dev", "vutt_master_key", "dev-image-secret-change-in-production")
    assert cfg.check_production_secrets(exit_on_fail=False) == []


def test_production_default_meili_key_flagged(monkeypatch):
    _setup(monkeypatch, "production", "vutt_master_key", "a-real-strong-secret")
    problems = cfg.check_production_secrets(exit_on_fail=False)
    assert any("MEILISEARCH master key" in p for p in problems)
    assert len(problems) == 1


def test_production_default_image_secret_flagged(monkeypatch):
    _setup(monkeypatch, "production", "a-real-strong-meili-key", "dev-image-secret-change-in-production")
    problems = cfg.check_production_secrets(exit_on_fail=False)
    assert any("IMAGE_TOKEN_SECRET" in p for p in problems)


def test_production_missing_secret_flagged(monkeypatch):
    _setup(monkeypatch, "production", "", "a-real-strong-secret")
    problems = cfg.check_production_secrets(exit_on_fail=False)
    assert any("puudub" in p for p in problems)


def test_production_good_secrets_pass(monkeypatch):
    _setup(monkeypatch, "production", "a-real-strong-meili-key", "a-real-strong-image-secret")
    assert cfg.check_production_secrets(exit_on_fail=False) == []


def test_production_default_secret_exits(monkeypatch):
    _setup(monkeypatch, "production", "vutt_master_key", "dev-image-secret-change-in-production")
    with pytest.raises(SystemExit):
        cfg.check_production_secrets(exit_on_fail=True)


def test_env_value_is_case_insensitive(monkeypatch):
    _setup(monkeypatch, "PRODUCTION", "vutt_master_key", "ok-secret")
    problems = cfg.check_production_secrets(exit_on_fail=False)
    assert len(problems) == 1
