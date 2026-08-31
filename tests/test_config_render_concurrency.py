"""`RENDER_SEMAPHORE(1)` on PROTSESSI-lokaalne.

Pärast ADR 0028 läbivad KÕIK upload'id rasterduse, seega mitme workeri
käivitamine tähendaks mitut samaaegset 300 DPI renderdust ilma ühegi
piiranguta. Hoiatus on odavam kui aasta pärast juhtumi uurimine.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import config


def _puhas(monkeypatch):
    for nimi in ("WEB_CONCURRENCY", "UVICORN_WORKERS", "GUNICORN_WORKERS"):
        monkeypatch.delenv(nimi, raising=False)


def test_uks_worker_ei_hoiata(monkeypatch):
    _puhas(monkeypatch)
    assert config.check_render_concurrency() is None


def test_selgesonaline_uks_ei_hoiata(monkeypatch):
    _puhas(monkeypatch)
    monkeypatch.setenv("WEB_CONCURRENCY", "1")
    assert config.check_render_concurrency() is None


def test_mitu_workerit_hoiatab(monkeypatch):
    _puhas(monkeypatch)
    monkeypatch.setenv("WEB_CONCURRENCY", "4")
    hoiatus = config.check_render_concurrency()
    assert hoiatus and "RENDER_SEMAPHORE" in hoiatus


def test_uvicorn_workers_hoiatab_samuti(monkeypatch):
    _puhas(monkeypatch)
    monkeypatch.setenv("UVICORN_WORKERS", "2")
    assert config.check_render_concurrency() is not None


def test_vigane_vaartus_ei_kukuta_kaivitust(monkeypatch):
    """Stardikontroll ei tohi ise viga visata."""
    _puhas(monkeypatch)
    monkeypatch.setenv("WEB_CONCURRENCY", "palju")
    assert config.check_render_concurrency() is None
