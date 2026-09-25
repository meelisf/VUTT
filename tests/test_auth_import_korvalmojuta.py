"""#412 p5: `server.auth` import ei käivita lõimi ega loe kasutajafaili.

Pildiserver (`vutt-images`, #388) ei mounti `state/`-i, aga impordib `auth`-i
paketi `server/__init__.py` kaudu. Impordiaegne `load_users()` logis seal iga
käivituse peale „Kasutajate fail puudub" ja sessioonipuhastuse lõim jooksis
tühjalt. Need käivitab nüüd `start_background()` FastAPI lifespanis.
"""
import subprocess
import sys
import textwrap
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]


def test_pildiserveri_import_ei_loe_kasutajaid_ega_kaivita_puhastust():
    kood = textwrap.dedent("""
        import threading
        import server.image_server  # noqa: F401
        from server import auth
        print("LOIMED:", sorted(t.name for t in threading.enumerate()))
        # Ainult tõeväärtus — cache sisu on paroolihashid.
        print("CACHE_TYHI:", auth._users_cache is None)
    """)
    tulemus = subprocess.run(
        [sys.executable, "-c", kood], cwd=REPO,
        capture_output=True, text=True, timeout=60,
    )
    assert tulemus.returncode == 0, tulemus.stderr
    assert "Kasutajate fail puudub" not in tulemus.stdout
    assert "Kasutajate cache laetud" not in tulemus.stdout
    assert "CACHE_TYHI: True" in tulemus.stdout
    assert "session-cleanup" not in tulemus.stdout


def test_start_background_kaivitab_puhastuse_uks_kord(monkeypatch):
    from server import auth

    alustatud = []

    class FakeThread:
        def __init__(self, target, daemon, name):
            self.name = name

        def start(self):
            alustatud.append(self.name)

    monkeypatch.setattr(auth.threading, "Thread", FakeThread)
    monkeypatch.setattr(auth, "_cleanup_thread", None)
    auth.start_background()
    auth.start_background()
    assert alustatud == ["session-cleanup"]
