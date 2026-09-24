"""Teose halduse ootel pöörded ja poolitused ühe pakina (#431 etapp 3, ADR 0050).

Leping: valideerimine ENNE ühegi faili puudutamist; lehe sees pööre → poolitus
(joon pööratud laiuses); poolitus kasutab värsket lehenumbrit; Meili üks kord.
"""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture
def work(tmp_path, monkeypatch):
    """Kolm lehte: 200×100 (lapiti), jadad 100/150/200 — keskmine on varem
    poolitatud lehe parem pool, seega vahe on alla 50."""
    from PIL import Image
    import server.admin_page_ops as aps

    wid = "w1"
    folder = tmp_path / "1690-test"
    folder.mkdir()
    names = []
    for i, seq in enumerate((100, 150, 200), start=1):
        base = f"1690-test-w1-pg{i:03d}"
        Image.new("RGB", (200, 100), (i * 40, 90, 60)).save(folder / f"{base}.jpg", "JPEG", quality=95)
        (folder / f"{base}.txt").write_text(f"V{i}<pb/>P{i}", encoding="utf-8")
        (folder / f"{base}.json").write_text(json.dumps({"sequence": seq, "status": "Toores"}), encoding="utf-8")
        names.append(f"{base}.jpg")
    (folder / "_metadata.json").write_text(json.dumps({"id": wid}), encoding="utf-8")

    syncs = []
    monkeypatch.setattr(aps, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(aps, "find_directory_by_id", lambda w: str(folder) if w == wid else None)
    monkeypatch.setattr(aps, "save_with_git", lambda *a, **kw: {"success": True})
    monkeypatch.setattr(aps, "delete_page_from_git", lambda *a, **kw: True)
    # Poolitus teeb ühe commiti (#431); fail-ops tehakse siin käsitsi nagu git teeks.
    def _commit(adds, removes, *a, **kw):
        import os as _os
        for p, c in adds:
            open(p, "w", encoding="utf-8").write(c)
        for p in removes:
            if _os.path.exists(p):
                _os.remove(p)
        return {"success": True}
    monkeypatch.setattr(aps, "commit_add_and_remove", _commit)
    monkeypatch.setattr(aps, "sync_work_to_meilisearch", lambda f: syncs.append(f))
    monkeypatch.setattr("server.image_server.generate_thumbnail", lambda *a, **kw: None, raising=False)
    return {"folder": folder, "names": names, "syncs": syncs, "aps": aps}


def _sizes(work):
    from PIL import Image
    aps = work["aps"]
    out = []
    for fn in aps.get_sorted_images(str(work["folder"])):
        with Image.open(work["folder"] / fn) as im:
            out.append(im.size)
    return out


def test_poolitab_mitu_lehte_ja_hoiab_jarjekorra(work):
    aps = work["aps"]
    n = work["names"]
    r = aps.apply_page_ops("w1", [
        {"filename": n[2], "split_x": 0.5},
        {"filename": n[0], "split_x": 0.5},
    ], "admin")
    assert r["split"] == 2 and r["new_page_count"] == 5
    assert _sizes(work) == [(100, 100), (100, 100), (200, 100), (100, 100), (100, 100)]
    # Tekstid järjekorras: V1 P1 | 2. leht | V3 P3
    texts = [(work["folder"] / (fn[:-4] + ".txt")).read_text(encoding="utf-8")
             for fn in aps.get_sorted_images(str(work["folder"]))]
    assert texts[0] == "V1" and texts[1] == "P1" and texts[3] == "V3" and texts[4] == "P3"
    assert work["syncs"] == ["1690-test"], "Meili sünk täpselt üks kord"


def test_parem_pool_ei_porka_jargmise_lehega(work):
    """Leht 1 (jada 100) + järgmine 150: pime +50 annaks kaks lehte jadaga 150."""
    aps = work["aps"]
    aps.apply_page_ops("w1", [{"filename": work["names"][0], "split_x": 0.5}], "admin")
    seqs = [aps.get_page_sequence(str(work["folder"] / (fn[:-4] + ".json")))
            for fn in aps.get_sorted_images(str(work["folder"]))]
    assert seqs == sorted(set(seqs)), f"jadad peavad olema unikaalsed ja kasvavad: {seqs}"


def test_poore_enne_poolitust(work):
    """90° järel on leht 100×200; pool = 50 laiune, mitte 100."""
    aps = work["aps"]
    aps.apply_page_ops("w1", [{"filename": work["names"][0], "rotate": 90, "split_x": 0.5}], "admin")
    assert _sizes(work)[:2] == [(50, 200), (50, 200)]


def test_ainult_poore_ei_sunki_meilit(work):
    aps = work["aps"]
    r = aps.apply_page_ops("w1", [{"filename": work["names"][1], "rotate": 180}], "admin")
    assert r["rotated"] == 1 and r["split"] == 0
    assert work["syncs"] == []


def test_puuduv_leht_lukkab_tagasi_ENNE_muutmist(work):
    aps = work["aps"]
    with pytest.raises(ValueError, match="muutus vahepeal"):
        aps.apply_page_ops("w1", [
            {"filename": work["names"][0], "split_x": 0.5},
            {"filename": "pole-olemas.jpg", "rotate": 90},
        ], "admin")
    assert len(aps.get_sorted_images(str(work["folder"]))) == 3


@pytest.mark.parametrize("ops", [
    "ei ole list",
    [{"filename": "../x.jpg", "rotate": 90}],
    [{"filename": "a.jpg", "rotate": 45}],
    [{"filename": "a.jpg", "rotate": True}],
    [{"filename": "a.jpg", "split_x": 0.99}],
    [{"filename": "a.jpg", "rotate": 90}, {"filename": "a.jpg", "split_x": 0.5}],
])
def test_vigane_sisend(work, ops):
    with pytest.raises(ValueError):
        work["aps"].apply_page_ops("w1", ops, "admin")


def test_tyhjad_kirjed_on_no_op(work):
    r = work["aps"].apply_page_ops("w1", [{"filename": work["names"][0], "rotate": 0, "split_x": None}], "admin")
    assert r["changed"] is False


# --- Endpoint ---

def test_endpoint_nouab_admini(backend_env, login):
    token = login("editor", "editorpass")
    r = backend_env["client"].post("/admin/work/w1/page-ops", json={"ops": []},
                                   headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401


def test_endpoint_kontroll_ja_start(backend_env, login, monkeypatch):
    from server.routers import pages as pages_router
    from server import page_ops_jobs
    page_ops_jobs._reset_for_tests()
    h = {"Authorization": f"Bearer {login('admin', 'adminpass')}"}
    c = backend_env["client"]

    def _viska(*a, **kw):
        raise ValueError("muutus vahepeal")

    monkeypatch.setattr(pages_router, "precheck_page_ops", _viska)
    assert c.post("/admin/work/w1/page-ops", json={"ops": []}, headers=h).status_code == 400
    monkeypatch.setattr(pages_router, "precheck_page_ops", lambda *a, **kw: {"found": False})
    assert c.post("/admin/work/w1/page-ops", json={"ops": []}, headers=h).status_code == 404

    started = []
    monkeypatch.setattr(pages_router, "precheck_page_ops", lambda *a, **kw: {"total": 3})
    monkeypatch.setattr(page_ops_jobs, "start", lambda *a, **kw: started.append(a) or True)
    r = c.post("/admin/work/w1/page-ops", json={"ops": []}, headers=h)
    assert r.status_code == 200 and r.json() == {"status": "started", "total": 3}
    monkeypatch.setattr(page_ops_jobs, "start", lambda *a, **kw: False)
    assert c.post("/admin/work/w1/page-ops", json={"ops": []}, headers=h).status_code == 409


def test_olekuendpoint(backend_env, login):
    from server import page_ops_jobs
    page_ops_jobs._reset_for_tests()
    h = {"Authorization": f"Bearer {login('admin', 'adminpass')}"}
    r = backend_env["client"].get("/admin/work/w1/page-ops/status", headers=h)
    assert r.status_code == 200 and r.json() == {"state": "idle"}
    h2 = {"Authorization": f"Bearer {login('editor', 'editorpass')}"}
    assert backend_env["client"].get("/admin/work/w1/page-ops/status", headers=h2).status_code == 401


# --- Taustatöö (#431): edenemine pollitav, üks töö teose kohta ---

def _oota(job_state, work_id="w1", timeout=5):
    import time
    from server import page_ops_jobs
    t0 = time.time()
    while time.time() - t0 < timeout:
        st = page_ops_jobs.get_status(work_id)
        if st["state"] == job_state:
            return st
        time.sleep(0.02)
    raise AssertionError(f"olek ei jõudnud {job_state}-i: {page_ops_jobs.get_status(work_id)}")


def test_taustatoo_edenemine_ja_tulemus(monkeypatch):
    import threading
    from server import page_ops_jobs
    page_ops_jobs._reset_for_tests()
    lase = threading.Event()

    def fake(work_id, ops, username, progress=None):
        progress(0, 2)
        progress(1, 2)
        lase.wait(2)
        progress(2, 2)
        return {"success": True, "rotated": 0, "split": 2}

    monkeypatch.setattr(page_ops_jobs, "apply_page_ops", fake)
    assert page_ops_jobs.start("w1", [], "admin", 2) is True
    assert page_ops_jobs.start("w1", [], "admin", 2) is False, "teine töö samale teosele → 409"
    st = _oota("running")
    assert st["total"] == 2
    lase.set()
    st = _oota("done")
    assert st["done"] == 2 and st["result"]["split"] == 2


def test_taustatoo_viga_jouab_olekusse(monkeypatch):
    from server import page_ops_jobs
    page_ops_jobs._reset_for_tests()

    def fake(*a, **kw):
        raise RuntimeError("Katkes: tehtud 1 pööret ja 0 poolitust 3 lehest. Viga: x")

    monkeypatch.setattr(page_ops_jobs, "apply_page_ops", fake)
    page_ops_jobs.start("w1", [], "admin", 3)
    st = _oota("error")
    assert "Katkes" in st["error"]
    # Pärast viga võib uue töö käivitada.
    monkeypatch.setattr(page_ops_jobs, "apply_page_ops", lambda *a, **kw: {"split": 0})
    assert page_ops_jobs.start("w1", [], "admin", 1) is True


def test_apply_page_ops_raporteerib_edenemist(work):
    samm = []
    work["aps"].apply_page_ops("w1", [
        {"filename": work["names"][0], "split_x": 0.5},
        {"filename": work["names"][2], "rotate": 90},
    ], "admin", progress=lambda d, t: samm.append((d, t)))
    assert samm == [(0, 2), (1, 2), (2, 2)]


def test_precheck(work):
    aps = work["aps"]
    assert aps.precheck_page_ops("w1", [{"filename": work["names"][0], "rotate": 90}]) == {"total": 1}
    assert aps.precheck_page_ops("pole", []) == {"found": False}
    with pytest.raises(ValueError):
        aps.precheck_page_ops("w1", [{"filename": "x.jpg", "rotate": 90}])
