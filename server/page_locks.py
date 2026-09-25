"""Lehepõhine lukk: lehe `.txt`/`.json` lugemine–muutmine–kirjutamine on üks toiming (#416).

`save_with_git`-i `_git_write_lock` järjestab ainult kirjutused, mitte nende
ees olevat lugemist: kaks kommentaarivastust lugesid sama algseisu ja teine
kirjutus pühkis esimese vastuse. Kõik lehe JSON-i tervikuna ümber kirjutavad
teed (`/save`, `/git-restore`, kommentaarivastus, kommentaari taaste,
annotatsiooni taaste märkmena) võtavad selle luku ENNE lugemist.

Luku võti on lehe tüvi: `pg1.txt` ja `pg1.json` on sama lukk.
Lukkude järjekord: `page_lock` → `_git_write_lock` (save_with_git sees).
Vastupidist järjekorda ei tohi tekkida.

Lukk on protsessi-lokaalne (uvicorn single-worker). Mitme workeri korral on
vaja protsessideülest lukku — sama piirang nagu `RENDER_SEMAPHORE`-il.
"""
import os
import threading
import weakref
from contextlib import contextmanager


class _Lukk:
    """`threading.Lock` ei toeta nõrka viidet; ümbris toetab."""
    __slots__ = ("lock", "__weakref__")

    def __init__(self):
        self.lock = threading.Lock()


_guard = threading.Lock()
# Nõrgad viited: lukk elab ainult nii kaua, kui keegi teda hoiab või ootab.
_locks: "weakref.WeakValueDictionary[str, _Lukk]" = weakref.WeakValueDictionary()


def _key(path: str) -> str:
    return os.path.realpath(os.path.splitext(path)[0])


def _get(path: str) -> _Lukk:
    key = _key(path)
    with _guard:
        lukk = _locks.get(key)
        if lukk is None:
            lukk = _Lukk()
            _locks[key] = lukk
        return lukk


@contextmanager
def page_lock(path: str):
    """Hoia lehe lukku (tee võib olla lehe `.txt` või `.json`)."""
    lukk = _get(path)
    with lukk.lock:
        yield


def page_lock_acquire_nowait(path: str) -> bool:
    """Testide abi: kas lukk on praegu vaba (võtab ja vabastab kohe)."""
    lukk = _get(path)
    if lukk.lock.acquire(blocking=False):
        lukk.lock.release()
        return True
    return False
