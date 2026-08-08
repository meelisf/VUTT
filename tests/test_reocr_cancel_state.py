"""Katkestamise olekumasin: aktiivne → cancelling → cancelled (#217).

Terminalüleminekud peavad olema vastastikku välistavad — vastasel juhul võib
poller märkida töö `done`-ks samal ajal kui DELETE märgib `cancelled`.
"""
import threading

import pytest

from server import reocr_ops, reocr_state


@pytest.fixture(autouse=True)
def puhas_register(monkeypatch):
    monkeypatch.setattr(reocr_ops, "_reocr_jobs", {})
    monkeypatch.setattr(reocr_ops, "_reocr_batch_jobs", {})
    monkeypatch.setattr(reocr_ops, "_persist_active_jobs", lambda: None)


def test_aktiivne_too_laheb_cancelling_olekusse():
    reocr_ops._reocr_jobs["j1"] = {"status": "processing"}
    assert reocr_ops._try_begin_cancel("j1") == "single"
    assert reocr_ops._reocr_jobs["j1"]["status"] == "cancelling"


def test_batch_register_leitakse_sama_endpointiga():
    reocr_ops._reocr_batch_jobs["b1"] = {"status": "uploading"}
    assert reocr_ops._try_begin_cancel("b1") == "batch"
    assert reocr_ops._reocr_batch_jobs["b1"]["status"] == "cancelling"


def test_aeglane_too_on_katkestatav():
    """`slow` on LIPP, mitte staatus — aeglase töö staatus on endiselt
    `processing` (vt _mark_slow_if_stale). Ta peab olema katkestatav."""
    reocr_ops._reocr_jobs["j1"] = {"status": "processing", "slow": True}
    assert reocr_ops._try_begin_cancel("j1") == "single"


@pytest.mark.parametrize("status", ["done", "error", "cancelling", "cancelled"])
def test_terminal_ja_juba_katkestatav_too_ei_alga_uuesti(status):
    reocr_ops._reocr_jobs["j1"] = {"status": status}
    assert reocr_ops._try_begin_cancel("j1") is None
    assert reocr_ops._reocr_jobs["j1"]["status"] == status


def test_tundmatu_id_annab_none():
    assert reocr_ops._try_begin_cancel("puudub") is None


def test_sama_id_moelmas_registris_on_invariandi_rikkumine():
    """job_id nimeruum on registrite vahel globaalne (sama generate_nanoid)."""
    reocr_ops._reocr_jobs["x"] = {"status": "processing"}
    reocr_ops._reocr_batch_jobs["x"] = {"status": "processing"}
    with pytest.raises(RuntimeError):
        reocr_ops._try_begin_cancel("x")


def test_ainult_uks_loim_voidab_CAS_i():
    """20 lõime üritavad korraga katkestada — täpselt üks saab loa."""
    reocr_ops._reocr_jobs["j1"] = {"status": "processing"}
    voitjad = []
    lukk = threading.Lock()

    def proovi():
        r = reocr_ops._try_begin_cancel("j1")
        if r:
            with lukk:
                voitjad.append(r)

    threads = [threading.Thread(target=proovi) for _ in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(voitjad) == 1


def test_katkestamine_ja_done_ei_saa_moelmad_voita():
    """Poller tahab `done`, DELETE tahab `cancelling` — täpselt üks võidab."""
    reocr_ops._reocr_jobs["j1"] = {"status": "processing"}
    tulemused = []
    start = threading.Barrier(2)

    def katkesta():
        start.wait()
        tulemused.append(("cancel", bool(reocr_ops._try_begin_cancel("j1"))))

    def lopeta():
        start.wait()
        with reocr_ops._reocr_jobs_lock:
            job = reocr_ops._reocr_jobs.get("j1")
            ok = bool(job) and job.get("status") == "processing"
            if ok:
                job["status"] = "done"
        tulemused.append(("done", ok))

    t1, t2 = threading.Thread(target=katkesta), threading.Thread(target=lopeta)
    t1.start(); t2.start(); t1.join(); t2.join()

    lopp = reocr_ops._reocr_jobs["j1"]["status"]
    assert lopp in ("cancelling", "done")
    edukad = [nimi for nimi, ok in tulemused if ok]
    assert len(edukad) == 1, "täpselt üks terminalüleminek peab õnnestuma"


# --- püsivus ---

def test_cancelling_too_persisteeritakse(tmp_path, monkeypatch):
    """KRIITILINE: kui `cancelling` ei jõua reocr_active.json-i, ei leia
    stardi-taaste pooleli jäänud katkestamist üles ja teos jääb lukku."""
    fail = tmp_path / "reocr_active.json"
    monkeypatch.setattr(reocr_state, "REOCR_ACTIVE_FILE", str(fail))

    reocr_state.persist_active_jobs({
        "b1": {"status": "cancelling", "slug": "s"},
        "b2": {"status": "processing", "slug": "s"},
        "b3": {"status": "done", "slug": "s"},
    })

    import json
    salvestatud = json.loads(fail.read_text(encoding="utf-8"))
    assert set(salvestatud) == {"b1", "b2"}, "cancelling ja processing jäävad, done mitte"
