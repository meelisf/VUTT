"""Testide seadistus.

Lepingu-test impordib `server`-it (server.meili_settings, server.meili_doc).
See on lubatud AINULT testides — `vutt_mcp` ise ei tohi `server`-it importida,
sest pipx paigaldab paketi isoleeritud venv-i, kus repo `server/` puudub.

Repo juur lisatakse sys.path'i selgesõnaliselt, et `mcp/tests/` oleks
käivitatav ka üksinda (`pytest mcp/tests/`), mitte ainult koos `tests/`-iga.
"""
import os
import sys

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _REPO_ROOT not in sys.path:
    sys.path.insert(0, _REPO_ROOT)
