"""Testid prosopograafia git-versioonihalduse jaoks."""
import sys
from pathlib import Path
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


# Teekonstantide invariandid elavad nüüd tests/test_prosopography_paths.py-s —
# üks koht, nagu teedki (#221). Siit eemaldati kaks testi: juure asukoha oma
# (dubleeriv) ja `images` peab olema STATE_DIR all (lukustas 2026-05-25
# lahknemise, mille see töö kaotab).


def test_delete_file_from_git(tmp_path):
    """delete_file_from_git kustutab faili gitist ja teeb commit."""
    import git
    from unittest.mock import patch, MagicMock

    # Loo mini git repo
    repo = git.Repo.init(str(tmp_path))
    test_file = tmp_path / "test.json"
    test_file.write_text('{"id": "test"}', encoding="utf-8")
    repo.index.add(["test.json"])
    repo.index.commit("init", author=git.Actor("test", "t@t.com"), committer=git.Actor("test", "t@t.com"))

    with patch("server.git_ops.get_or_init_repo", return_value=repo), \
         patch("server.git_ops.BASE_DIR", str(tmp_path)):
        from server.git_ops import delete_file_from_git
        result = delete_file_from_git(str(test_file), "Kustutamine: test.json", "testuser")

    assert result is True
    assert not test_file.exists()
    assert "Kustutamine: test.json" in repo.head.commit.message


def test_get_recent_commits_includes_prosopo(tmp_path):
    """get_recent_commits peab tagastama prosopo commitid."""
    import git
    from unittest.mock import patch
    from server import git_ops

    repo = git.Repo.init(str(tmp_path))
    prosopo_dir = tmp_path / "config" / "prosopography"
    prosopo_dir.mkdir(parents=True)
    person_file = prosopo_dir / "abc123.json"
    person_file.write_text('{"id": "vutt:Pabc123", "name": {"label": "Test Isik"}}', encoding="utf-8")
    repo.index.add(["config/prosopography/abc123.json"])
    repo.index.commit(
        "Prosopo loomine: Test Isik [vutt:Pabc123]",
        author=git.Actor("testuser", "t@t.com"),
        committer=git.Actor("testuser", "t@t.com"),
    )

    with patch.object(git_ops, "get_or_init_repo", return_value=repo), \
         patch.object(git_ops, "BASE_DIR", str(tmp_path)):
        result = git_ops.get_recent_commits(limit=10)

    commits = result["commits"]
    assert len(commits) == 1
    c = commits[0]
    assert c["change_type"] == "person"
    assert c["person_id"] == "vutt:Pabc123"
    assert c["person_name"] == "Test Isik"
    assert c["work_id"] is None


def test_parse_person_name_from_message():
    """_parse_person_name_from_message parsib nime commit-sõnumist."""
    from server.git_ops import _parse_person_name_from_message
    assert _parse_person_name_from_message("Prosopo muudatus: Hans Ludenius [vutt:Pabc]") == "Hans Ludenius"
    assert _parse_person_name_from_message("Prosopo loomine: Johann [vutt:Pxyz]") == "Johann"
    assert _parse_person_name_from_message("Prosopo liitmine: A → B") == "A → B"
    assert _parse_person_name_from_message("Prosopo migratsioon: 2218 isikut") == "2218 isikut"


def test_compute_person_diff_basic():
    """compute_person_diff leiab muutunud väljad."""
    from server.prosopography.ops import compute_person_diff
    before = {"name": {"label": "Hans"}, "imm_year": 1640, "biography": None, "updated_at": "2024-01-01"}
    after  = {"name": {"label": "Hans Ludenius"}, "imm_year": 1642, "biography": None, "updated_at": "2024-06-01"}
    changes = compute_person_diff(before, after)
    fields = {c["field"] for c in changes}
    assert "name" in fields
    assert "imm_year" in fields
    assert "updated_at" not in fields  # tehniline väli, ignoreerida
    assert "biography" not in fields   # väärtus ei muutunud (mõlemad None)


def test_compute_person_diff_new_field():
    """compute_person_diff tuvastab uue välja lisamise."""
    from server.prosopography.ops import compute_person_diff
    before = {"name": {"label": "Hans"}}
    after  = {"name": {"label": "Hans"}, "notes": "Uus märge"}
    changes = compute_person_diff(before, after)
    assert any(c["field"] == "notes" and c["old"] is None and c["new"] == "Uus märge" for c in changes)


def test_create_person_calls_save_with_git(prosopo_env, monkeypatch):
    """create_person() peab kutsuma save_with_git()."""
    from unittest.mock import MagicMock
    from server.prosopography import ops, state

    mock_save = MagicMock(return_value={"success": True, "commit_hash": "abc12345"})
    monkeypatch.setattr(state, "save_with_git", mock_save)

    person = ops.create_person({"name": "Test Isik"}, "testuser")

    assert mock_save.called
    call_args = mock_save.call_args
    # message can be positional arg[3] or keyword arg
    msg = call_args.kwargs.get("message", "")
    if not msg and len(call_args.args) > 3:
        msg = call_args.args[3]
    assert "Prosopo loomine:" in msg
    assert person["created_by"] == "testuser"


def test_update_person_calls_save_with_git(prosopo_env, monkeypatch):
    """update_person() peab kutsuma save_with_git()."""
    from unittest.mock import MagicMock
    from server.prosopography import ops, state

    prosopo_env.write("abc123", name={"label": "Test"}, updated_at="2024-01-01T00:00:00+00:00")
    mock_save = MagicMock(return_value={"success": True, "commit_hash": "abc12345"})
    monkeypatch.setattr(state, "save_with_git", mock_save)

    result = ops.update_person("vutt:Pabc123", {"updated_at": "2024-01-01T00:00:00+00:00", "name": {"label": "Test muudetud"}}, "testuser")

    assert mock_save.called
    msg = mock_save.call_args.kwargs.get("message", "")
    assert "Prosopo muudatus:" in msg
    assert result["updated_by"] == "testuser"


def test_delete_person_calls_delete_file_from_git(prosopo_env, monkeypatch):
    """delete_person() peab kutsuma delete_file_from_git()."""
    from unittest.mock import MagicMock
    from server.prosopography import ops, state

    prosopo_env.write("abc123", name={"label": "Kustutav Isik"})
    mock_delete = MagicMock(return_value=True)
    monkeypatch.setattr(state, "delete_file_from_git", mock_delete)

    result = ops.delete_person("vutt:Pabc123", "testuser")

    assert mock_delete.called
    call_args = mock_delete.call_args
    assert "Prosopo kustutamine:" in call_args.args[1]
    assert result["deleted"] == "vutt:Pabc123"


def test_merge_person_commits_source_and_target(prosopo_env, monkeypatch):
    """merge_person() peab commitama source (tombstone) + target ühes commit-is."""
    import json
    from unittest.mock import MagicMock
    from server.prosopography import ops, state

    source = {"id": "vutt:Psrc", "name": {"label": "Allikas"}, "record_status": "draft",
               "updated_at": "2024-01-01T00:00:00+00:00", "relations": [], "identifiers": [],
               "import_batch_ids": [], "statuses": [], "occupations": [], "education": [],
               "sources": [], "confessions": [], "birth": None, "death": None,
               "origin": {}, "gender": None, "biography": None, "notes": None, "image_url": None}
    # Targeti viide source'ile katab source/target kaartide relation-loop'is
    # vahelejätmise: neid ei tohi tavalise Lock-iga teist korda lukustada.
    target = {"id": "vutt:Ptgt", "name": {"label": "Sihtmärk"}, "record_status": "draft",
               "updated_at": "2024-01-01T00:00:00+00:00",
               "relations": [{"target_id": "vutt:Psrc", "type": "kolleeg"}], "identifiers": [],
               "import_batch_ids": [], "statuses": [], "occupations": [], "education": [],
               "sources": [], "confessions": [], "birth": None, "death": None,
               "origin": {}, "gender": None, "biography": None, "notes": None, "image_url": None}

    (prosopo_env.dir / "src.json").write_text(json.dumps(source), encoding="utf-8")
    (prosopo_env.dir / "tgt.json").write_text(json.dumps(target), encoding="utf-8")

    mock_save = MagicMock(return_value={"success": True, "commit_hash": "abc"})
    monkeypatch.setattr(state, "save_with_git", mock_save)

    ops.merge_person("vutt:Psrc", "vutt:Ptgt", "testuser")

    # Prosopo liitmine commit must have been called
    prosopo_calls = [c for c in mock_save.call_args_list
                     if "Prosopo liitmine:" in (c.kwargs.get("message", "") or "")]
    assert len(prosopo_calls) >= 1
    # Source (tombstone) must be primary file
    call_args = prosopo_calls[0]
    primary_path = call_args.args[0] if call_args.args else call_args.kwargs.get("filepath", "")
    assert "src.json" in primary_path


def test_person_history_uses_correct_relative_path():
    """person_history endpoint kutsub get_file_git_history õige suhtelise teega."""
    from unittest.mock import patch
    import asyncio

    mock_history = [{"hash": "abc12345", "full_hash": "abc12345full", "author": "testuser",
                     "date": "2024-01-01T00:00:00", "formatted_date": "01.01.2024 00:00",
                     "message": "Prosopo muudatus: Hans [vutt:Pabc]", "is_original": False}]

    with patch("server.prosopography.router.get_file_git_history", return_value=mock_history) as mock_git:
        from server.prosopography import router as prosopo_router
        import importlib; importlib.reload(prosopo_router)
        with patch("server.prosopography.router.get_file_git_history", return_value=mock_history) as mock_git2:
            result = prosopo_router.person_history("vutt:Pabc123", user={"username": "t", "role": "editor"})

    assert result["status"] == "ok"
    called_path = mock_git2.call_args.args[0]
    assert called_path == "config/prosopography/abc123.json"


def test_compute_person_diff_used_in_diff_endpoint():
    """person_diff endpoint integreerib compute_person_diff tulemuse."""
    from unittest.mock import patch
    import asyncio, json as _json

    before = {"name": {"label": "Hans"}, "imm_year": 1640, "updated_at": "2024-01-01"}
    after  = {"name": {"label": "Hans Uus"}, "imm_year": 1641, "updated_at": "2024-06-01"}

    mock_commit = type("C", (), {"parents": [type("P", (), {"hexsha": "prevhash"})()]})()

    with patch("server.prosopography.router.get_file_at_commit", side_effect=[
               _json.dumps(after), _json.dumps(before)
           ]), \
         patch("server.prosopography.router.get_or_init_repo") as mock_repo:
        mock_repo.return_value.commit.return_value = mock_commit
        from server.prosopography import router as prosopo_router
        result = prosopo_router.person_diff("vutt:Pabc123", commit="abc12345",
                                            user={"username": "t", "role": "editor"})

    assert result["status"] == "ok"
    fields = {c["field"] for c in result["changes"]}
    assert "name" in fields or "imm_year" in fields
