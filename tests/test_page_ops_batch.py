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


def test_endpoint_vead(backend_env, login, monkeypatch):
    from server.routers import pages as pages_router
    h = {"Authorization": f"Bearer {login('admin', 'adminpass')}"}

    def _viska(exc):
        def f(*a, **kw):
            raise exc
        return f

    monkeypatch.setattr(pages_router, "apply_page_ops", _viska(ValueError("muutus vahepeal")))
    assert backend_env["client"].post("/admin/work/w1/page-ops", json={"ops": []}, headers=h).status_code == 400
    monkeypatch.setattr(pages_router, "apply_page_ops", _viska(RuntimeError("Katkes: tehtud 1")))
    r = backend_env["client"].post("/admin/work/w1/page-ops", json={"ops": []}, headers=h)
    assert r.status_code == 500 and "Katkes" in r.json()["detail"]
    monkeypatch.setattr(pages_router, "apply_page_ops", lambda *a, **kw: {"found": False})
    assert backend_env["client"].post("/admin/work/w1/page-ops", json={"ops": []}, headers=h).status_code == 404
