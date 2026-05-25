"""Testid prosopograafia git-versioonihalduse jaoks."""
import sys
from pathlib import Path
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def test_prosopography_dir_is_under_data_config():
    """PROSOPOGRAPHY_DIR peab olema DATA_CONFIG_DIR all."""
    from server.config import PROSOPOGRAPHY_DIR, DATA_CONFIG_DIR
    assert PROSOPOGRAPHY_DIR.startswith(DATA_CONFIG_DIR), (
        f"PROSOPOGRAPHY_DIR ({PROSOPOGRAPHY_DIR}) peab olema DATA_CONFIG_DIR ({DATA_CONFIG_DIR}) all"
    )


def test_prosopography_images_dir_is_under_state():
    """PROSOPOGRAPHY_IMAGES_DIR peab olema STATE_DIR all."""
    from server.config import PROSOPOGRAPHY_IMAGES_DIR, STATE_DIR
    assert PROSOPOGRAPHY_IMAGES_DIR.startswith(STATE_DIR), (
        f"PROSOPOGRAPHY_IMAGES_DIR ({PROSOPOGRAPHY_IMAGES_DIR}) peab olema STATE_DIR ({STATE_DIR}) all"
    )


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


def test_create_person_calls_save_with_git(tmp_path):
    """create_person() peab kutsuma save_with_git()."""
    import json
    from unittest.mock import patch, MagicMock

    mock_save = MagicMock(return_value={"success": True, "commit_hash": "abc12345"})

    with patch("server.prosopography.ops.PROSOPOGRAPHY_DIR", str(tmp_path)), \
         patch("server.prosopography.ops.save_with_git", mock_save), \
         patch("server.prosopography.ops._update_index_entry"), \
         patch("server.prosopography.ops._update_aliases_entry"):
        from server.prosopography import ops
        person = ops.create_person({"name": "Test Isik"}, "testuser")

    assert mock_save.called
    call_args = mock_save.call_args
    # message can be positional arg[3] or keyword arg
    msg = call_args.kwargs.get("message", "")
    if not msg and len(call_args.args) > 3:
        msg = call_args.args[3]
    assert "Prosopo loomine:" in msg
    assert person["created_by"] == "testuser"


def test_update_person_calls_save_with_git(tmp_path):
    """update_person() peab kutsuma save_with_git()."""
    import json
    from unittest.mock import patch, MagicMock

    person_data = {
        "id": "vutt:Pabc123",
        "name": {"label": "Test"},
        "updated_at": "2024-01-01T00:00:00+00:00",
        "record_status": "draft",
    }
    person_file = tmp_path / "abc123.json"
    person_file.write_text(json.dumps(person_data), encoding="utf-8")

    mock_save = MagicMock(return_value={"success": True, "commit_hash": "abc12345"})

    with patch("server.prosopography.ops.PROSOPOGRAPHY_DIR", str(tmp_path)), \
         patch("server.prosopography.ops.save_with_git", mock_save), \
         patch("server.prosopography.ops._update_index_entry"), \
         patch("server.prosopography.ops._update_aliases_entry"), \
         patch("server.prosopography.ops._propagate_name_to_works"):
        from server.prosopography import ops
        result = ops.update_person("vutt:Pabc123", {"updated_at": "2024-01-01T00:00:00+00:00", "name": {"label": "Test muudetud"}}, "testuser")

    assert mock_save.called
    msg = mock_save.call_args.kwargs.get("message", "")
    assert "Prosopo muudatus:" in msg
    assert result["updated_by"] == "testuser"


def test_delete_person_calls_delete_file_from_git(tmp_path):
    """delete_person() peab kutsuma delete_file_from_git()."""
    import json
    from unittest.mock import patch, MagicMock

    person_data = {
        "id": "vutt:Pabc123",
        "name": {"label": "Kustutav Isik"},
        "record_status": "draft",
        "updated_at": "2024-01-01T00:00:00+00:00",
    }
    person_file = tmp_path / "abc123.json"
    person_file.write_text(json.dumps(person_data), encoding="utf-8")

    mock_delete = MagicMock(return_value=True)

    with patch("server.prosopography.ops.PROSOPOGRAPHY_DIR", str(tmp_path)), \
         patch("server.prosopography.ops.delete_file_from_git", mock_delete), \
         patch("server.prosopography.ops._load_person_to_works", return_value={}), \
         patch("server.prosopography.ops._load_index", return_value={"entries": []}), \
         patch("server.prosopography.ops.atomic_write_json"), \
         patch("server.prosopography.ops._remove_aliases_entry"), \
         patch("server.prosopography.ops._glob.glob", return_value=[]):
        from server.prosopography import ops
        result = ops.delete_person("vutt:Pabc123", "testuser")

    assert mock_delete.called
    call_args = mock_delete.call_args
    assert "Prosopo kustutamine:" in call_args.args[1]
    assert result["deleted"] == "vutt:Pabc123"
