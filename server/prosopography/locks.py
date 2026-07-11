"""Per-isiku lukud — serialiseerib ühe isikufaili read-modify-write tsükli (security_review Leid K).

Sama person_id → sama Lock objekt, JAGATUD ops.py ja reciprocal_ops.py vahel. Väldib
lost-update't, kui mitu kirjutajat (nt taustal jooksev sync_reciprocals + update_person,
või bulk + edit) loevad-muudavad-kirjutavad sama faili paralleelselt. Uvicorn on küll
single-worker, AGA BackgroundTasks ja daemon-thread'id jooksevad samas protsessis.

Lukud on püsivad (ei puhastata) — ~2200 isikut → ~2200 Lock objekti, tühine.
Tavaline kirjutaja haarab korraga ainult ühe isikuluku. Isiku- ja kohaliitmine võivad
haarata mitu isikulukku, kuid need operatsioonid serialiseerib enne seda ühine
``merge_operation_lock``; nii ei saa kaks liitmist tekitada ristlukustust.
"""
import threading
from typing import Dict

_registry_guard = threading.Lock()
_person_locks: Dict[str, threading.Lock] = {}
merge_operation_lock = threading.Lock()


def person_lock(person_id: str) -> threading.Lock:
    """Tagastab (ja vajadusel loob) person_id jaoks püsiva Lock objekti."""
    with _registry_guard:
        lock = _person_locks.get(person_id)
        if lock is None:
            lock = threading.Lock()
            _person_locks[person_id] = lock
        return lock
