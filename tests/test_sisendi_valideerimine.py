"""Kliendisisendi valideerimine git-teedel, rikastusel ja MCP-esitusel."""
import json
import os

import pytest
from git import Repo

from tests.test_prosopography_side_writes import _configure_crud, _person, _saving_mock


@pytest.mark.parametrize("ref, ok", [
    ("a" * 40, True), ("abc1234", True), ("abc1234^", True), ("ABC1234", True),
    ("HEAD", False), ("HEAD~1", False), ("abc12", False), ("--all", False),
    ("abc1234:muu/fail.txt", False), ("abc1234^^", False), (None, False), (123, False),
])
def test_commiti_viide_on_ainult_rasi(ref, ok):
    from server.git_ops import is_valid_commit_ref
    assert is_valid_commit_ref(ref) is ok


@pytest.fixture
def kaks_teost(tmp_path, monkeypatch):
    """Üks commit muudab kahte teost; diff peab jääma küsitud faili piiresse."""
    import server.git_ops as git_ops
    data = tmp_path / "data"
    for d in ("avalik", "piiratud"):
        (data / d).mkdir(parents=True)
    r = Repo.init(str(data))
    with r.config_writer() as cw:
        cw.set_value("user", "name", "t").set_value("user", "email", "t@t")
    (data / "avalik/1.txt").write_text("a", encoding="utf-8")
    (data / "piiratud/1.txt").write_text("s", encoding="utf-8")
    r.index.add(["avalik/1.txt", "piiratud/1.txt"]); r.index.commit("v1")
    (data / "avalik/1.txt").write_text("a2", encoding="utf-8")
    (data / "piiratud/1.txt").write_text("SALAJANE", encoding="utf-8")
    r.index.add(["avalik/1.txt", "piiratud/1.txt"]); r.index.commit("v2")
    monkeypatch.setattr(git_ops, "get_or_init_repo", lambda: r)
    return r


def test_diff_jaab_kusitud_tee_piiresse(kaks_teost):
    from server.git_ops import get_commit_diff
    sha = kaks_teost.head.commit.hexsha
    assert "a2" in get_commit_diff(sha, filepaths="avalik/1.txt")["diff"]
    # Pathspec-maagia ei tohi valikut laiendada teistele failidele.
    res = get_commit_diff(sha, filepaths=":(exclude)x/avalik/1.txt")
    assert "SALAJANE" not in (res or {}).get("diff", "")


def test_revisjoniavaldis_lukatakse_tagasi(kaks_teost):
    from server.git_ops import get_commit_diff, get_file_at_commit
    assert get_commit_diff("HEAD", filepaths="avalik/1.txt") is None
    assert get_file_at_commit("piiratud/1.txt", "HEAD~1") is None
    sha = kaks_teost.head.commit.hexsha
    assert get_file_at_commit("avalik/1.txt", sha) == "a2"
    assert get_file_at_commit("avalik/1.txt", f"{sha}^") == "a"


@pytest.mark.parametrize("field", ["id", "merged_into", "record_status", "created_by",
                                   "auth_token", "id.x"])
def test_rikastus_ei_puutu_kaardi_identiteeti(monkeypatch, tmp_path, field):
    crud, path = _configure_crud(monkeypatch, tmp_path, _person())
    save = _saving_mock(path)
    monkeypatch.setattr(crud.state, "save_with_git", save)
    with pytest.raises(ValueError, match="enrich_forbidden_field"):
        crud.apply_enrichment("vutt:Pabc123", {field: "vutt:Pmuu999"}, "editor")
    assert save.call_count == 0


def test_rikastuse_nimemuutus_jouab_teostesse(monkeypatch, tmp_path):
    crud, path = _configure_crud(monkeypatch, tmp_path, _person())
    monkeypatch.setattr(crud.state, "save_with_git", _saving_mock(path))
    monkeypatch.setattr(crud, "fill_person_labels_from_registry", lambda p: None)
    calls = []
    monkeypatch.setattr(crud, "_propagate_name_to_works", lambda *a: calls.append(a))
    crud.apply_enrichment("vutt:Pabc123", {"name.label": "Uus Nimi"}, "editor")
    assert calls == [("vutt:Pabc123", "Uus Nimi", "editor")]
    crud.apply_enrichment("vutt:Pabc123", {"name.label": "Uus Nimi"}, "editor")
    assert len(calls) == 1


def test_osade_esitus_koodita_ei_vasta_teose_kohta(tmp_path, monkeypatch):
    from server import work_part_proposals as wpp
    monkeypatch.setattr(wpp, "DB_PATH", str(tmp_path / "wpp.sqlite3"))
    d = tmp_path / "slug-w1"; d.mkdir()
    (d / "_metadata.json").write_text(json.dumps({"id": "w1"}), encoding="utf-8")
    # Vale kood + vale versioon: vastus on koodi viga, mitte `stale_pages`.
    with pytest.raises(wpp.ProposalError, match="invalid_or_expired_handoff"):
        wpp.submit("vale", "w1", str(d), "vana", [{"kind": "letter"}])


def test_isiku_esitus_koodita_ei_vasta_lehtede_kohta(tmp_path, monkeypatch):
    from server.prosopography import enrichment_proposals as ep
    monkeypatch.setattr(ep, "DB_PATH", str(tmp_path / "ep.sqlite3"))
    # Kuju- ja registrikontroll ei loe korpust; siin on oluline ainult järjekord.
    monkeypatch.setattr(ep, "_validate_item", lambda item: None)
    monkeypatch.setattr(ep, "_check_registry_entries", lambda items: None)
    monkeypatch.setattr(ep, "_check_vutt_pages",
                        lambda items: pytest.fail("lehti loeti enne koodi kontrolli"))
    with pytest.raises(ep.ProposalError, match="invalid_or_expired_handoff"):
        ep.submit("vale", "vutt:Pabc", "2026-01-01", [{"kind": "occupation"}])
