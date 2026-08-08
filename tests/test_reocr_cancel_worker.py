"""Üleslaadimislõime peatamine enne kaugkoristust (#217).

Koostööline lipp üksi ei piisa: lipu seadmine ei tähenda, et lõim on lõpetanud.
Kui koristus algab enne lõime väljumist, kirjutab pooleliolev sftp.put() pildid
tagasi kataloogi, mille just eemaldasime.
"""
import threading
import time

import pytest

from server import reocr_ops


@pytest.fixture(autouse=True)
def puhas(monkeypatch):
    monkeypatch.setattr(reocr_ops, "_cancel_events", {})
    monkeypatch.setattr(reocr_ops, "_upload_threads", {})


def test_quiesce_ootab_loime_lopetamiseni():
    laetud = []
    ev = threading.Event()
    reocr_ops._cancel_events["j1"] = ev

    def upload():
        for i in range(100):
            if ev.is_set():
                return
            laetud.append(i)
            time.sleep(0.01)

    t = threading.Thread(target=upload)
    reocr_ops._upload_threads["j1"] = t
    t.start()
    time.sleep(0.05)

    assert reocr_ops._quiesce_upload("j1", timeout=5.0) is True
    assert not t.is_alive(), "lõim peab olema lõpetanud ENNE tagastamist"
    enne = len(laetud)
    time.sleep(0.05)
    assert len(laetud) == enne, "lõim ei tohi pärast quiesce'i midagi juurde teha"


def test_quiesce_annab_false_kui_loim_ei_peatu():
    """Ajalõpp: koristust EI TOHI alustada, kui kirjutaja on veel elus."""
    ev = threading.Event()
    reocr_ops._cancel_events["j1"] = ev
    stop = threading.Event()

    t = threading.Thread(target=lambda: stop.wait(10), daemon=True)
    reocr_ops._upload_threads["j1"] = t
    t.start()

    assert reocr_ops._quiesce_upload("j1", timeout=0.2) is False
    stop.set()


def test_quiesce_tundmatu_too_on_ohutu():
    """Lõim võis juba lõppeda — see ei ole viga."""
    assert reocr_ops._quiesce_upload("puudub", timeout=0.1) is True


def test_quiesce_seab_lipu_ka_siis_kui_loimi_pole():
    """Lipp peab olema seatud enne kui lõim jõuab käivituda."""
    assert reocr_ops._quiesce_upload("j2", timeout=0.1) is True
    assert reocr_ops._cancel_event("j2").is_set()


def test_forget_koristab_abistruktuurid():
    reocr_ops._cancel_event("j3").set()
    reocr_ops._upload_threads["j3"] = threading.Thread(target=lambda: None)
    reocr_ops._forget_cancel_state("j3")
    assert "j3" not in reocr_ops._cancel_events
    assert "j3" not in reocr_ops._upload_threads
