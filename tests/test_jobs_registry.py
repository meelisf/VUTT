"""#675 B: ühine taustatööde register (`server/jobs.py`)."""
import threading
import time

from server import jobs


def _oota(reg, key, timeout=5.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        st = reg.get_status(key)
        if st.get("state") != "running":
            return st
        time.sleep(0.01)
    raise AssertionError("töö ei lõppenud")


def test_lopetatud_olek_aegub(monkeypatch):
    reg = jobs.JobRegistry("t")
    assert reg.start("w", "x", lambda progress: {"ok": 1}, total=1, username="u")
    assert _oota(reg, "w")["result"] == {"ok": 1}
    monkeypatch.setattr(jobs, "KEEP_FINISHED_S", -1)
    assert reg.get_status("w") == {"state": "idle"}


def test_eri_registrid_ei_valista_teineteist():
    a, b = jobs.JobRegistry("a"), jobs.JobRegistry("b")
    lase = threading.Event()
    try:
        assert a.start("w", "x", lambda progress: lase.wait(5) and {})
        assert b.start("w", "y", lambda progress: {})
        assert a.start("w", "x", lambda progress: {}) is False
    finally:
        lase.set()
        _oota(a, "w")


def test_extra_valjad_algolekus_ja_ootamatu_erind():
    reg = jobs.JobRegistry("t", expected_errors=(KeyError,))

    def viska(progress):
        raise TypeError("ootamatu")

    assert reg.start("w", "x", viska, proposal_id="p1")
    st = _oota(reg, "w")
    assert st["state"] == "error" and st["error"] == "ootamatu"
    assert st["proposal_id"] == "p1" and st["kind"] == "x"
