"""Võtmepõhine taustatööde register (#675 B).

Ühine skelett teose taustatöödele (`page_ops_jobs`, `page_text_proposal_jobs`):
võtme kohta korraga üks töö (teine start → False → 409), edenemine olekus,
lõpetatud töö olek jääb `KEEP_FINISHED_S` sekundiks pollimiseks alles.

Olek elab PROTSESSI mälus (üks uvicorn-worker, sama eeldus mis
`RENDER_SEMAPHORE`-il). Serveri restart keset tööd → olek „idle"; kutsuja
peab oskama kettalt näha, mis jõudis valmis.

Iga register on eraldi instants: eri registrite tööd sama võtme peal EI
välista teineteist (välistus on kutsuja lukkude asi).
"""
import threading
import time

from .config import get_logger

logger = get_logger(__name__)

KEEP_FINISHED_S = 600     # lõpetatud töö olek jääb pollimiseks alles


class JobRegistry:
    def __init__(self, name: str, expected_errors: tuple = (ValueError, RuntimeError)):
        # `expected_errors` on kasutajale mõeldud sõnumid — neid ei logita traceback'iga.
        self.name = name
        self.expected_errors = expected_errors
        self._lock = threading.Lock()
        self._jobs: dict = {}     # võti → olek

    def _set(self, key: str, **fields) -> None:
        with self._lock:
            self._jobs.setdefault(key, {}).update(fields)

    def get_status(self, key: str) -> dict:
        with self._lock:
            job = dict(self._jobs.get(key) or {})
        if not job:
            return {"state": "idle"}
        if job.get("state") != "running" and time.time() - job.get("finished_at", 0) > KEEP_FINISHED_S:
            return {"state": "idle"}
        return job

    def start(self, key: str, kind: str, fn, *, total: int = 0, username: str = "",
              on_error=None, **extra) -> bool:
        """Käivitab töö lõimes. False = selle võtme töö juba käib.

        fn(progress) tagastab `result`; progress(done, total). Erindi korral
        lisatakse olekusse `on_error(e)` väljad. `extra` läheb algolekusse.
        """
        with self._lock:
            if (self._jobs.get(key) or {}).get("state") == "running":
                return False
            self._jobs[key] = {"state": "running", "kind": kind, "done": 0, "total": total,
                               "username": username, "started_at": time.time(), **extra}

        def run():
            try:
                result = fn(lambda d, t: self._set(key, done=d, total=t))
                self._set(key, state="done", result=result, finished_at=time.time())
            except Exception as e:
                if not isinstance(e, self.expected_errors):
                    logger.exception(f"{self.name}/{kind} töö {key} kukkus")
                fields = on_error(e) if on_error else {}
                self._set(key, state="error", error=str(e), finished_at=time.time(), **fields)

        threading.Thread(target=run, daemon=True, name=f"{kind}-{key}").start()
        return True

    def _reset_for_tests(self) -> None:
        with self._lock:
            self._jobs.clear()
