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
