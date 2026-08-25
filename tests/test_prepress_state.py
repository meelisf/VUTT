"""Prepress-oleku samaaegne muutmine ja apply-CAS."""
import json
import os
import threading

import pytest

from server.upload import state as upload_state
from server.upload import prepress_plan as pp


@pytest.fixture
def upload(tmp_path, monkeypatch):
    """Loob päris state.json ajutisse UPLOADS_DIR-i."""
    monkeypatch.setattr(upload_state, "UPLOADS_DIR", str(tmp_path), raising=False)
    monkeypatch.setattr(
        upload_state, "upload_dir", lambda uid: os.path.join(str(tmp_path), uid)
    )
    uid = "abc123"
    os.makedirs(os.path.join(str(tmp_path), uid))
    upload_state.write_state(uid, {"id": uid, "status": "awaiting_split", "files": []})
    return uid


def _read(upload, key):
    with open(upload_state.state_path(upload), encoding="utf-8") as f:
        return json.load(f).get(key)


def test_init_prepress_loob_vaikeplaani(upload):
    plan = upload_state.init_prepress(upload, 3)
    assert all(p["mode"] == "nosplit" for p in plan["pages"])
    assert len(plan["pages"]) == 3
    assert _read(upload, "prepress")["default_split_x"] == 0.5


def test_init_prepress_on_idempotentne(upload):
    upload_state.init_prepress(upload, 3)
    upload_state.mutate_prepress(upload, lambda p: p.update(default_split_x=0.42))
    again = upload_state.init_prepress(upload, 3)
    assert again["default_split_x"] == 0.42   # ei lähtesta olemasolevat


def test_mutate_prepress_ilma_plaanita_tagastab_none(upload):
    assert upload_state.mutate_prepress(upload, lambda p: None) is None


def test_eelvaate_edenemine_ei_kaota_samal_ajal_salvestatud_custom_plaani(upload):
    """KRIITILINE: preview-lõim ja plaani POST kirjutavad sama state.json-i.
    Kumbki ei tohi teise välju üle kirjutada."""
    upload_state.init_prepress(upload, 3)

    def set_custom(plan):
        plan["pages"][1].update(mode="custom", split_x=0.459)

    def bump_progress(plan):
        plan["preview_status"] = "rendering"
        plan["preview_done"] = plan.get("preview_done", 0) + 1

    barrier = threading.Barrier(2)
    errors = []

    def worker(fn, times):
        try:
            barrier.wait()
            for _ in range(times):
                upload_state.mutate_prepress(upload, fn)
        except Exception as e:  # pragma: no cover
            errors.append(e)

    t1 = threading.Thread(target=worker, args=(set_custom, 20))
    t2 = threading.Thread(target=worker, args=(bump_progress, 20))
    t1.start(); t2.start(); t1.join(); t2.join()

    assert errors == []
    final = _read(upload, "prepress")
    assert final["pages"][1]["mode"] == "custom"       # plaan alles
    assert final["pages"][1]["split_x"] == 0.459
    assert final["preview_done"] == 20                  # edenemine alles
    assert pp.effective_split_x(final, 2) == 0.459


def test_try_begin_applying_esimene_saab_loa(upload):
    assert upload_state.try_begin_applying(upload) is True
    assert _read(upload, "status") == "applying"


def test_try_begin_applying_teine_kutse_ei_saa(upload):
    """Topeltklikk, retry või brauseri refresh ei tohi käivitada teist
    paralleelset 300 DPI renderdust."""
    assert upload_state.try_begin_applying(upload) is True
    assert upload_state.try_begin_applying(upload) is False


def test_try_begin_applying_valest_staatusest_ei_saa(upload):
    upload_state.set_upload_state(upload, status="processing")
    assert upload_state.try_begin_applying(upload) is False


def test_try_begin_applying_on_voistlusekindel(upload):
    """20 lõime, täpselt üks võidab."""
    results = []
    barrier = threading.Barrier(20)

    def attempt():
        barrier.wait()
        results.append(upload_state.try_begin_applying(upload))

    threads = [threading.Thread(target=attempt) for _ in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert results.count(True) == 1


def test_try_begin_applying_lubab_uuesti_proovida_parast_viga(upload):
    """Ebaõnnestunud edastuse järel peab saama uuesti proovida: lähtefail on
    endiselt VUTT-i poolel (koristus käib alles impordil), seega kordus on
    ohutu. Ilma selleta jääb upload igaveseks error-olekusse lukku."""
    upload_state.set_upload_state(upload, status="error", error_message="ENOENT")
    assert upload_state.try_begin_applying(upload) is True
    assert _read(upload, "status") == "applying"


def test_try_begin_applying_ei_luba_juba_tootlemisel_olevat(upload):
    """Kui OCR juba töötleb, ei tohi teist partiid peale saata."""
    upload_state.set_upload_state(upload, status="processing")
    assert upload_state.try_begin_applying(upload) is False
