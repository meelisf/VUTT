"""Testide seadistus.

Lepingu-test impordib `server`-it (server.meili_settings, server.meili_doc).
See on lubatud AINULT testides — `vutt_mcp` ise ei tohi `server`-it importida,
sest pipx paigaldab paketi isoleeritud venv-i, kus repo `server/` puudub.

Repo juur lisatakse sys.path'i selgesõnaliselt, et `mcp/tests/` oleks
käivitatav ka üksinda (`pytest mcp/tests/`), mitte ainult koos `tests/`-iga.
"""
import os
import sys

import pytest

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)


@pytest.fixture(autouse=True)
def _isoleeri_kirjanduskogu(monkeypatch, tmp_path):
    """Testid ei tohi sõltuda sellest, kas jooksutajal on päris kirjanduskogu.

    `build_server` registreerib kirjanduskogu tööriistad, kui indeksifail on
    olemas — ilma selle väravata muutuks tööriistade nimestik masinati.
    Kogu vajav test seab muutuja ise üle.
    """
    monkeypatch.setenv("VUTT_LIBRARY_DB", str(tmp_path / "kogu-puudub.db"))
