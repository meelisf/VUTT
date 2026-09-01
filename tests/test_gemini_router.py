"""Gemini-tee rollivärav ja pakkujate endpoint. Ligipääsu kiht 1 ja 3."""


def test_admin_ei_saa_gemini_teed_kasutada(client, login, tmp_path, monkeypatch):
    """admin PEAB saama 403 — Gemini on superadmin-only (vähemalt esialgu)."""
    import server.routers.reocr as reocr_router
    work_dir = tmp_path / "data" / "w1"
    work_dir.mkdir(parents=True)
    (work_dir / "pg1.jpg").write_bytes(b"\xff\xd8\xff")
    monkeypatch.setattr(reocr_router, "find_directory_by_id",
                        lambda wid: str(work_dir) if wid == "wid" else None)
    monkeypatch.setattr(reocr_router, "get_active_reocr_count", lambda: 0)
    alustatud = []
    monkeypatch.setattr(reocr_router, "start_reocr_job",
                        lambda *a, **kw: alustatud.append(kw) or "j1")

    token = login("admin", "adminpass")
    r = client.post("/admin/work/wid/reocr-page",
                    json={"page_filename": "pg1.jpg", "provider": "gemini"},
                    headers={"Authorization": f"Bearer {token}"})

    assert r.status_code == 403
    assert alustatud == []


def test_superadmin_saab_gemini_teed_kasutada(client, login, tmp_path, monkeypatch):
    import server.routers.reocr as reocr_router
    work_dir = tmp_path / "data" / "w1"
    work_dir.mkdir(parents=True)
    (work_dir / "pg1.jpg").write_bytes(b"\xff\xd8\xff")
    monkeypatch.setattr(reocr_router, "find_directory_by_id",
                        lambda wid: str(work_dir) if wid == "wid" else None)
    monkeypatch.setattr(reocr_router, "get_active_reocr_count", lambda: 0)
    monkeypatch.setattr(reocr_router.shutil, "copy2", lambda *a, **kw: None)
    # GEMINI_API_KEY on testikeskkonnas alati tühi (.env ei kanna päris võtit) —
    # ilma selleta annaks _resolve_provider õigesti 503, mitte 200. `gemini_enabled`
    # on reocr.py-sse seotud impordihetkel (top-level import), seega patchime
    # nime router-moodulis, mitte `server.config`-us (vt sama muster
    # test_gemini_provider_routing.py::ops fixture'is).
    monkeypatch.setattr(reocr_router, "gemini_enabled", lambda: True)
    nähtud = {}
    def fake_start(*a, **kw):
        nähtud.update(kw)
        return "j1"
    monkeypatch.setattr(reocr_router, "start_reocr_job", fake_start)

    token = login("superadmin", "superpass")
    r = client.post("/admin/work/wid/reocr-page",
                    json={"page_filename": "pg1.jpg", "provider": "gemini"},
                    headers={"Authorization": f"Bearer {token}"})

    assert r.status_code == 200
    assert nähtud["provider"] == "gemini"


def test_admin_saab_loss_teed_endiselt_kasutada(client, login, tmp_path, monkeypatch):
    """Regressioon: pakkuja lisamine EI TOHI tõsta LOSS-tee läve."""
    import server.routers.reocr as reocr_router
    work_dir = tmp_path / "data" / "w1"
    work_dir.mkdir(parents=True)
    (work_dir / "pg1.jpg").write_bytes(b"\xff\xd8\xff")
    monkeypatch.setattr(reocr_router, "find_directory_by_id",
                        lambda wid: str(work_dir) if wid == "wid" else None)
    monkeypatch.setattr(reocr_router, "get_active_reocr_count", lambda: 0)
    monkeypatch.setattr(reocr_router.shutil, "copy2", lambda *a, **kw: None)
    monkeypatch.setattr(reocr_router, "start_reocr_job", lambda *a, **kw: "j1")

    token = login("admin", "adminpass")
    r = client.post("/admin/work/wid/reocr-page",
                    json={"page_filename": "pg1.jpg"},
                    headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200


def test_batch_gemini_noiab_superadmini(client, login, tmp_path, monkeypatch):
    """403 üksi ei tõesta, et batch't ei alustatud — kontrolli ka, et start_reocr_batch
    jäi kutsumata (test-hügieeni nõue, vt task-5-brief punkt 4)."""
    import server.routers.reocr as reocr_router
    work_dir = tmp_path / "data" / "w1"
    work_dir.mkdir(parents=True)
    (work_dir / "pg1.jpg").write_bytes(b"\xff\xd8\xff")
    monkeypatch.setattr(reocr_router, "find_directory_by_id",
                        lambda wid: str(work_dir) if wid == "wid" else None)
    monkeypatch.setattr(reocr_router, "get_active_batch_for_work", lambda wid: None)
    alustatud = []
    monkeypatch.setattr(reocr_router, "start_reocr_batch",
                        lambda *a, **kw: alustatud.append(kw) or "b1")

    token = login("admin", "adminpass")
    r = client.post("/admin/work/wid/reocr-batch",
                    json={"page_filenames": ["pg1.jpg"], "provider": "gemini"},
                    headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403
    assert alustatud == []


def test_tundmatu_pakkuja_on_400(client, login, tmp_path, monkeypatch):
    import server.routers.reocr as reocr_router
    work_dir = tmp_path / "data" / "w1"
    work_dir.mkdir(parents=True)
    monkeypatch.setattr(reocr_router, "find_directory_by_id",
                        lambda wid: str(work_dir) if wid == "wid" else None)
    monkeypatch.setattr(reocr_router, "get_active_reocr_count", lambda: 0)

    token = login("superadmin", "superpass")
    r = client.post("/admin/work/wid/reocr-page",
                    json={"page_filename": "pg1.jpg", "provider": "openai"},
                    headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 400


def test_providers_endpoint_ei_lekita_votit(client, login, monkeypatch):
    """Ligipääsu kiht 3: võti ei tohi jõuda ühessegi vastusesse."""
    import server.config as cfg
    monkeypatch.setattr(cfg, "GEMINI_API_KEY", "SALAJANE-VOTI-123")
    monkeypatch.setattr(cfg, "gemini_enabled", lambda: True)

    token = login("superadmin", "superpass")
    r = client.get("/admin/ocr/providers",
                   headers={"Authorization": f"Bearer {token}"})

    assert r.status_code == 200
    assert "SALAJANE-VOTI-123" not in r.text
    assert r.json()["gemini"]["enabled"] is True
    assert r.json()["gemini"]["model"]


def test_providers_endpoint_nouab_superadmini(client, login):
    token = login("admin", "adminpass")
    r = client.get("/admin/ocr/providers",
                   headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401
