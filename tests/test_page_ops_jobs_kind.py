"""Teose taustatööde register kannab töö liiki; teose kohta üks töö sõltumata liigist."""
import threading
import time

import pytest

from server import page_ops_jobs as jobs


@pytest.fixture(autouse=True)
def _puhas():
    jobs._reset_for_tests()
    yield
    jobs._reset_for_tests()


def _oota(work_id, timeout=5.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        st = jobs.get_status(work_id)
        if st.get("state") != "running":
            return st
        time.sleep(0.01)
    raise AssertionError("töö ei lõppenud")


def test_status_kannab_liiki():
    assert jobs.start_job("w", "add_pdf", 3, "u", lambda progress: {"x": 1})
    st = _oota("w")
    assert st["state"] == "done"
    assert st["kind"] == "add_pdf"
    assert st["result"] == {"x": 1}


@pytest.mark.parametrize("esimene,teine", [("page_ops", "add_pdf"), ("add_pdf", "page_ops")])
def test_teise_liigi_too_annab_false(esimene, teine):
    vabasta = threading.Event()
    assert jobs.start_job("w", esimene, 1, "u", lambda progress: vabasta.wait(5) and {})
    try:
        assert jobs.start_job("w", teine, 1, "u", lambda progress: {}) is False
        assert jobs.get_status("w")["kind"] == esimene
    finally:
        vabasta.set()
        _oota("w")


def test_on_error_lisavaljad():
    def viska(progress):
        raise ValueError("ankur kadus")

    assert jobs.start_job("w", "add_pdf", 1, "u", viska,
                          on_error=lambda e: {"code": "anchor_missing"})
    st = _oota("w")
    assert st["state"] == "error"
    assert st["error"] == "ankur kadus"
    assert st["code"] == "anchor_missing"
    assert st["kind"] == "add_pdf"


def test_progress_uuendab_olekut():
    nahtud = []

    def fn(progress):
        progress(2, 5)
        nahtud.append(dict(jobs.get_status("w")))
        return {}

    jobs.start_job("w", "add_pdf", 5, "u", fn)
    _oota("w")
    assert nahtud[0]["done"] == 2 and nahtud[0]["total"] == 5
