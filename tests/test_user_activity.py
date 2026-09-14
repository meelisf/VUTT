"""Kasutaja viimane muudatus git-logist (#318, spekk §1).

„Viimane muudatus" tähendab COMMIT'i, mitte viimast sisselogimist. Autor
seotakse ainult TÄPSE kasutajanime alusel: git `--author` on substring-otsing
ja lähendatud vaste annaks vale inimese aktiivsuse.
"""
from datetime import datetime, timedelta

import pytest

import server.git_ops as git_ops


@pytest.fixture(autouse=True)
def puhas_vahemalu():
    git_ops._reset_activity_cache()
    yield
    git_ops._reset_activity_cache()


def sea_log(monkeypatch, paarid, loendur=None):
    def _loe(repo):
        if loendur is not None:
            loendur.append(1)
        return list(paarid)
    monkeypatch.setattr(git_ops, "_read_author_dates", _loe)
    monkeypatch.setattr(git_ops, "get_or_init_repo", lambda: object())


def test_uusim_commit_autori_kohta(monkeypatch):
    # Git log on uuemast vanemani: esimene kirje autori kohta ongi viimane muudatus.
    sea_log(monkeypatch, [
        ("meelis", "2026-09-14T10:00:00+03:00"),
        ("annipolding", "2026-09-05T09:00:00+03:00"),
        ("meelis", "2026-09-01T10:00:00+03:00"),
    ])
    got = git_ops.get_user_activity(["meelis", "annipolding"])
    assert got == {"meelis": "2026-09-14T10:00:00+03:00",
                   "annipolding": "2026-09-05T09:00:00+03:00"}


def test_automaatne_ei_ole_kasutaja(monkeypatch):
    # Taustatee autor (save_config_with_git) ei ole kellegi aktiivsus.
    sea_log(monkeypatch, [("Automaatne", "2026-09-14T10:00:00+03:00")])
    assert git_ops.get_user_activity(["Automaatne", "meelis"]) == {}


def test_ainult_tapne_kasutajanimi(monkeypatch):
    sea_log(monkeypatch, [("meelis2", "2026-09-14T10:00:00+03:00")])
    # „meelis2" EI OLE „meelis" ja tundmatu autor ei jõua vastusesse.
    assert git_ops.get_user_activity(["meelis"]) == {}


def test_ttl_valtib_teist_git_labimist(monkeypatch):
    loendur = []
    sea_log(monkeypatch, [("meelis", "2026-09-14T10:00:00+03:00")], loendur)
    git_ops.get_user_activity(["meelis"])
    git_ops.get_user_activity(["meelis"])
    assert len(loendur) == 1

    # TTL möödas → uus läbimine.
    git_ops._activity_cache_at = datetime.now() - timedelta(
        seconds=git_ops.ACTIVITY_TTL_SECONDS + 1)
    git_ops.get_user_activity(["meelis"])
    assert len(loendur) == 2


def test_git_viga_ei_muutu_tyhjaks_kaardiks(monkeypatch):
    # Tühi kaart tähendaks „keegi ei ole midagi teinud" ja oleks katkisest
    # git-ist eristamatu. Viga peab tõusma kutsujani.
    def _kukub(repo):
        raise RuntimeError("git ei vasta")
    monkeypatch.setattr(git_ops, "_read_author_dates", _kukub)
    monkeypatch.setattr(git_ops, "get_or_init_repo", lambda: object())
    with pytest.raises(RuntimeError):
        git_ops.get_user_activity(["meelis"])
