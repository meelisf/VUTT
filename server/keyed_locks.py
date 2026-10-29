"""Võtmepõhine lukuregister (#675 C): sama võti → sama lukk.

Ühine skelett lehe-, ettepaneku-, isiku-, teose- ja upload-lukkudele. Klass
annab ainult „võti → lukk" kaardistuse; lukkude JÄRJEKORRA reeglid elavad
kasutajamoodulites ja ADR-ides (nt ADR 0048, 0053).

Kaks eluiga:
- püsiv (vaikimisi): lukk jääb registrisse, kuni `remove()` ta eemaldab;
- `weak=True`: lukk elab ainult nii kaua, kui keegi teda hoiab või ootab
  (palju lühiealisi võtmeid, nt lehed). Kutsuja PEAB lukuobjekti hoidma kogu
  kasutuse vältel — `with locks.get(k):` teeb seda ise.

Protsessi-lokaalne (uvicorn single-worker); mitme workeri korral vaja
protsessideülest lukku.
"""
import threading
import weakref


class _WeakLock:
    """`threading.Lock` ei toeta nõrka viidet; ümbris toetab ja käitub nagu lukk."""
    __slots__ = ("_lock", "__weakref__")

    def __init__(self, lock):
        self._lock = lock

    def acquire(self, blocking: bool = True, timeout: float = -1) -> bool:
        return self._lock.acquire(blocking, timeout)

    def release(self) -> None:
        self._lock.release()

    def locked(self) -> bool:
        return self._lock.locked()

    def __enter__(self):
        self._lock.acquire()
        return self

    def __exit__(self, *exc) -> None:
        self._lock.release()


class KeyedLocks:
    def __init__(self, factory=threading.Lock, weak: bool = False):
        self._factory = factory
        self._weak = weak
        self._guard = threading.Lock()
        self._locks = weakref.WeakValueDictionary() if weak else {}

    def get(self, key):
        """Tagastab (ja vajadusel loob) võtme luku."""
        with self._guard:
            lock = self._locks.get(key)
            if lock is None:
                lock = _WeakLock(self._factory()) if self._weak else self._factory()
                self._locks[key] = lock
            return lock

    def remove(self, key) -> None:
        """Unustab võtme luku (nt pärast upload'i staging-kausta kustutamist)."""
        with self._guard:
            self._locks.pop(key, None)
