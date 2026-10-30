"""Testid ei puuduta päris `data/`-t ega `state/`-i (#690 samm 0).

Teed loeb `server.config` impordi hetkel keskkonnast, seepärast seatakse
muutujad siin, mooduli tasemel — juur-conftest laaditakse enne `tests/` ja
`mcp/tests/` conftest'e ja enne ükski neist `server`-it impordib. Test, mis
oma teed ise ei asenda, kirjutab nüüd sessiooni tmp-kausta, mitte arendaja
`data/`-sse (varem tegi seda ~85 testi, üks ka `git init`-iga).

Valvur võrdleb päris kaustu sessiooni alguses ja lõpus: kui midagi siiski
otse `data/`-sse või `state/`-i kirjutab (nt kõvakodeeritud suhteline tee),
kukub jooksutus.
"""
import os
import shutil
import tempfile

_JUUR = os.path.dirname(os.path.abspath(__file__))
_PARIS = [os.path.join(_JUUR, "data"), os.path.join(_JUUR, "state")]

_SESSIOON = tempfile.mkdtemp(prefix="vutt-test-")
os.environ["VUTT_DATA_DIR"] = os.path.join(_SESSIOON, "data")
os.environ["VUTT_STATE_DIR"] = os.path.join(_SESSIOON, "state")
os.makedirs(os.path.join(os.environ["VUTT_DATA_DIR"], "config"))
os.makedirs(os.environ["VUTT_STATE_DIR"])


def _seis():
    """Failide (tee → mtime, suurus) hetktõmmis; giti indeks on sees, objektid mitte."""
    seis = {}
    for juur in _PARIS:
        for kaust, alamad, failid in os.walk(juur):
            if ".git" in alamad:
                alamad.remove(".git")
                failid = failid + [os.path.join(".git", "index")]
            for nimi in failid:
                tee = os.path.join(kaust, nimi)
                try:
                    st = os.stat(tee)
                except OSError:
                    continue
                seis[tee] = (st.st_mtime_ns, st.st_size)
    return seis


_ALGUS = {}


def pytest_sessionstart(session):
    _ALGUS.update(_seis())


def pytest_sessionfinish(session, exitstatus):
    lopp = _seis()
    muutunud = sorted(t for t in set(_ALGUS) | set(lopp) if _ALGUS.get(t) != lopp.get(t))
    shutil.rmtree(_SESSIOON, ignore_errors=True)
    if muutunud:
        rida = "\n  ".join(os.path.relpath(t, _JUUR) for t in muutunud[:20])
        session.config.pluginmanager.get_plugin("terminalreporter").write_line(
            f"\nTestid muutsid päris data/ või state/ faile ({len(muutunud)}):\n  {rida}",
            red=True,
        )
        session.exitstatus = 1
