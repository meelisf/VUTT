"""Re-OCR routeri turvaregressioonid."""


def test_admin_reocr_page_rejects_path_traversal(client, login, tmp_path, monkeypatch):
    """Üksik-lehe re-OCR peab aktsepteerima ainult bare failinime."""
    import server.routers.reocr as reocr_router

    work_dir = tmp_path / "data" / "work"
    work_dir.mkdir(parents=True)
    secret_dir = tmp_path / "secret"
    secret_dir.mkdir()
    (secret_dir / "users.json").write_text('{"secret": true}', encoding="utf-8")

    monkeypatch.setattr(reocr_router, "find_directory_by_id", lambda work_id: str(work_dir) if work_id == "wid" else None)
    monkeypatch.setattr(reocr_router, "get_active_reocr_count", lambda: 0)
    monkeypatch.setattr(reocr_router.shutil, "copy2", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(reocr_router, "start_reocr_job", lambda *_args, **_kwargs: "job1")

    token = login("admin", "adminpass")
    response = client.post(
        "/admin/work/wid/reocr-page",
        json={"page_filename": "../../secret/users.json"},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Vigane failinimi"


def _apply_setup(tmp_path, monkeypatch):
    """Ühine seadistus: teosekaust olemas, find_directory_by_id suunab sinna."""
    import server.routers.reocr as reocr_router
    work_dir = tmp_path / "data" / "1690-w1"
    work_dir.mkdir(parents=True)
    monkeypatch.setattr(
        reocr_router, "find_directory_by_id",
        lambda work_id: str(work_dir) if work_id == "wid" else None,
    )
    return reocr_router, work_dir


def test_reocr_apply_rejects_path_traversal(client, login, tmp_path, monkeypatch):
    """Hulgi-rakendus peab aktsepteerima ainult bare failinimesid."""
    reocr_router, _ = _apply_setup(tmp_path, monkeypatch)
    called = []
    monkeypatch.setattr(reocr_router, "apply_ocr_results", lambda *a, **kw: called.append(a))

    token = login("admin", "adminpass")
    response = client.post(
        "/admin/work/wid/reocr-apply",
        json={"page_filenames": ["ok.jpg", "../../state/users.json"]},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 400
    assert called == []  # midagi ei rakendatud


def test_reocr_apply_rejects_empty_list(client, login, tmp_path, monkeypatch):
    _apply_setup(tmp_path, monkeypatch)
    token = login("admin", "adminpass")
    response = client.post(
        "/admin/work/wid/reocr-apply",
        json={"page_filenames": []},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 400


def test_reocr_apply_unknown_work_404(client, login, tmp_path, monkeypatch):
    _apply_setup(tmp_path, monkeypatch)
    token = login("admin", "adminpass")
    response = client.post(
        "/admin/work/puudub/reocr-apply",
        json={"page_filenames": ["a.jpg"]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 404


def test_reocr_apply_sunkib_meili_uks_kord(client, login, tmp_path, monkeypatch):
    """Õnnestunud rakendus → täpselt üks Meili sünk teose kohta, mitte lehe kohta."""
    reocr_router, work_dir = _apply_setup(tmp_path, monkeypatch)
    monkeypatch.setattr(
        reocr_router, "apply_ocr_results",
        lambda path, filenames, username: {
            "applied": list(filenames), "failed": [],
            "commit_hash": "abc12345", "git_committed": True,
        },
    )
    synced = []
    monkeypatch.setattr(reocr_router, "sync_work_to_meilisearch_async", lambda slug: synced.append(slug))

    token = login("admin", "adminpass")
    response = client.post(
        "/admin/work/wid/reocr-apply",
        json={"page_filenames": ["a.jpg", "b.jpg", "c.jpg"]},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert response.json()["applied"] == ["a.jpg", "b.jpg", "c.jpg"]
    assert synced == ["1690-w1"]  # ÜKS sünk, slug (kaustanimi)


def test_reocr_apply_ilma_rakendatuta_ei_sungi(client, login, tmp_path, monkeypatch):
    reocr_router, _ = _apply_setup(tmp_path, monkeypatch)
    monkeypatch.setattr(
        reocr_router, "apply_ocr_results",
        lambda path, filenames, username: {
            "applied": [], "failed": [{"filename": "a.jpg", "error": ".ocr fail puudub"}],
            "commit_hash": "", "git_committed": False,
        },
    )
    synced = []
    monkeypatch.setattr(reocr_router, "sync_work_to_meilisearch_async", lambda slug: synced.append(slug))

    token = login("admin", "adminpass")
    response = client.post(
        "/admin/work/wid/reocr-apply",
        json={"page_filenames": ["a.jpg"]},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert synced == []


def test_reocr_discard_kutsub_discard_ops(client, login, tmp_path, monkeypatch):
    reocr_router, _ = _apply_setup(tmp_path, monkeypatch)
    monkeypatch.setattr(
        reocr_router, "discard_ocr_results",
        lambda path, filenames: {"discarded": list(filenames), "failed": []},
    )
    token = login("admin", "adminpass")
    response = client.post(
        "/admin/work/wid/reocr-discard",
        json={"page_filenames": ["a.jpg", "b.jpg"]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    assert response.json()["discarded"] == ["a.jpg", "b.jpg"]


def test_reocr_discard_rejects_path_traversal(client, login, tmp_path, monkeypatch):
    reocr_router, _ = _apply_setup(tmp_path, monkeypatch)
    called = []
    monkeypatch.setattr(reocr_router, "discard_ocr_results", lambda *a: called.append(a))
    token = login("admin", "adminpass")
    response = client.post(
        "/admin/work/wid/reocr-discard",
        json={"page_filenames": ["../../state/users.json"]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 400
    assert called == []


def test_reocr_apply_noab_admin_rolli(client, login, tmp_path, monkeypatch):
    """Editor ei pääse ligi. NB: get_user tõstab ebapiisava rolli korral 401
    (mitte 403) — projekti konventsioon, vt test_admin_role_endpoints.py."""
    _apply_setup(tmp_path, monkeypatch)
    token = login("editor", "editorpass")
    response = client.post(
        "/admin/work/wid/reocr-apply",
        json={"page_filenames": ["a.jpg"]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 401
