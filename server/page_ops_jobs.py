"""Teose halduse ootel lehetoimingute taustatöö + edenemine (#431, ADR 0050).

Pakk-poolitus võib kesta minuteid; sünkroonne päring jäi kasutajale tummaks ja
suure paki korral jooksis brauseri/nginx-i 600 s piiri vastu (töö serveris
jätkus, aga UI näitas viga). Nüüd: POST käivitab lõime, klient pollib olekut.

Register on `server/jobs.py` (olek protsessi mälus). Serveri restart keset
tööd → olek „idle"; klient laeb siis nimekirja uuesti ja näeb, mis kettale
jõudis. Teose kohta korraga üks töö sõltumata liigist (`page_ops`, `add_pdf`)
— teine start saab 409.
"""
from .admin_page_ops import PageOpsPartialError, apply_page_ops
from .jobs import JobRegistry

_registry = JobRegistry("page_ops_jobs")
get_status = _registry.get_status
_reset_for_tests = _registry._reset_for_tests


def start_job(work_id: str, kind: str, total: int, username: str, fn, on_error=None) -> bool:
    """Käivitab teose taustatöö. False = selle teose MISTAHES liigi töö juba käib.

    Teose kohta on korraga üks töö sõltumata liigist (`page_ops`, `add_pdf`):
    mõlemad võtavad `work_lock`-i ja muudavad failinimede loendit. `kind` on
    olekus, et klient jälgiks ainult oma liiki tööd ja käsitleks lõppu õigesti —
    PDF-töö lõpp ei tohi tühjendada ootel lehetoimingute plaani.

    fn(progress) tagastab `result`; progress(done, total). Erindi korral
    lisatakse olekusse `on_error(e)` väljad.
    """
    return _registry.start(work_id, kind, fn, total=total, username=username, on_error=on_error)


def _page_ops_error_fields(e: Exception) -> dict:
    # `applied`/`transformed` ütlevad kliendile, mis plaanist maha võtta;
    # ValueError tuleb enne muutmist → midagi ei tehtud. Puuduv väli =
    # teadmata (ootamatu erind) → klient tühjendab plaani.
    if isinstance(e, PageOpsPartialError):
        return {"applied": e.applied, "transformed": e.transformed}
    if isinstance(e, ValueError):
        return {"applied": [], "transformed": []}
    return {}


def start(work_id: str, ops, username: str, total: int) -> bool:
    """Ootel lehetoimingute töö. False = selle teose töö juba käib."""
    return start_job(
        work_id, "page_ops", total, username,
        lambda progress: apply_page_ops(work_id, ops, username, progress=progress),
        on_error=_page_ops_error_fields,
    )

