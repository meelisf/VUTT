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
