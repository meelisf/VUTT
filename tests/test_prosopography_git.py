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
