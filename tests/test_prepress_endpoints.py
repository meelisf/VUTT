"""Prepress-endpointid: rollikontroll, valideerimine, idempotentsus."""
import json

import pytest


@pytest.fixture
def client_admin(backend_env, login):
    """TestClient + admin-päised + poolitamise ootel upload.

    backend_env ei loo uploadi ise, seega teeme siin: state.json staatuses
    awaiting_split, kohatäite source.pdf ja kolme lehega vaikeplaan.
    """
    from server.upload import state as upload_state

    client = backend_env["client"]
    token = login("admin", "adminpass")
    headers = {"Authorization": "Bearer {}".format(token)}

    upload_id = "prep123"
    upload_dir = backend_env["uploads_dir"] / upload_id
    (upload_dir / "thumbs").mkdir(parents=True)
    (upload_dir / "source.pdf").write_bytes(b"%PDF-1.4\n")
    (upload_dir / "state.json").write_text(json.dumps({
        "id": upload_id,
        "status": "awaiting_split",
        "meta": {"title": "Test", "year": "1690", "slug": "test-upload"},
        "created_at": "2026-08-07T12:00:00",
        "expected_pages": 3,
        "files": [],
        "remote_staging_path": "AUTO-OCR/print/{}".format(upload_id),
        "remote_work_path": "AUTO-OCR/print/{}/test-upload".format(upload_id),
    }, ensure_ascii=False), encoding="utf-8")
    upload_state.init_prepress(upload_id, 3)

    return client, headers, upload_id


def test_koik_prepress_teed_on_admin_all(client_admin):
    """nginx proksib /api/files/ kaudu KÕIK backend-teed avalikult."""
    from server.routers import upload as upload_router
    prepress_routes = [
        r.path for r in upload_router.router.routes if "prepress" in r.path
        or "/preview/" in r.path
    ]
    assert prepress_routes, "prepress-endpointe ei leitud"
    assert all(p.startswith("/admin/") for p in prepress_routes)


def test_prepress_noual_admin_rolli(client_admin, login):
    """Editor ei tohi prepress-teid näha."""
    client, _headers, upload_id = client_admin
    editor = {"Authorization": "Bearer {}".format(login("editor", "editorpass"))}
    resp = client.get("/admin/upload/{}/prepress".format(upload_id), headers=editor)
    assert resp.status_code in (401, 403)


def test_apply_teine_kutse_annab_409(client_admin, monkeypatch):
    """Topeltklikk, retry või brauseri refresh ei tohi käivitada teist tööd."""
    from server.upload import store_source

    client, headers, upload_id = client_admin
    # Päris SFTP-lõime testis ei taha — CAS-i käitumine on see, mida mõõdame.
    monkeypatch.setattr(store_source, "transfer_stored_source", lambda uid: None)

    first = client.post(
        "/admin/upload/{}/prepress/apply".format(upload_id), headers=headers
    )
    assert first.status_code == 200
    second = client.post(
        "/admin/upload/{}/prepress/apply".format(upload_id), headers=headers
    )
    assert second.status_code == 409
    assert "status" in second.json()


def test_plaani_salvestamine_ei_luba_vigast_mode_i(client_admin):
    client, headers, upload_id = client_admin
    resp = client.post(
        "/admin/upload/{}/prepress".format(upload_id),
        json={"enabled": True, "default_split_x": 0.5,
              "pages": [{"n": 1, "mode": "kustuta_koik"}]},
        headers=headers,
    )
    assert resp.status_code == 400


def test_plaani_salvestamine_ei_luba_vigast_split_x_i(client_admin):
    client, headers, upload_id = client_admin
    resp = client.post(
        "/admin/upload/{}/prepress".format(upload_id),
        json={"enabled": True, "default_split_x": 1.5, "pages": []},
        headers=headers,
    )
    assert resp.status_code == 400


def test_plaani_salvestamine_uuendab_ainult_plaani_valju(client_admin):
    client, headers, upload_id = client_admin
    resp = client.post(
        "/admin/upload/{}/prepress".format(upload_id),
        json={"enabled": True, "default_split_x": 0.48, "pages": [
            {"n": 1, "mode": "custom", "split_x": 0.46},
            {"n": 2, "mode": "nosplit"},
            {"n": 3, "mode": "default", "excluded": True},
        ]},
        headers=headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["output_page_count"] == 3   # lk1 → 2, lk2 → 1, lk3 välja
    assert body["trivial"] is False

    data = client.get(
        "/admin/upload/{}/prepress".format(upload_id), headers=headers
    ).json()
    assert data["pages"][0]["split_x"] == 0.46
    assert data["pages"][2]["excluded"] is True
    assert data["status"] == "awaiting_split"   # ülemise taseme välju ei puudutatud


def test_opt_in_ilma_startita_ei_renderda_midagi(client_admin, tmp_path):
    """KÕIGE OLULISEM INVARIANT: kuni /prepress/start pole kutsutud, ei tohi
    tekkida ühtki eelvaate faili. Kogu prepress on opt-in."""
    import os
    from server.upload import prepress

    client, headers, upload_id = client_admin
    client.get("/admin/upload/{}/prepress".format(upload_id), headers=headers)
    client.get("/admin/upload/{}/prepress".format(upload_id), headers=headers)
    assert not os.path.isdir(prepress.preview_dir(upload_id))


def test_start_kaivitab_eelvaate(client_admin, monkeypatch):
    started = []
    from server.upload import prepress
    monkeypatch.setattr(prepress, "start_preview", lambda uid: started.append(uid))

    client, headers, upload_id = client_admin
    resp = client.post(
        "/admin/upload/{}/prepress/start".format(upload_id), headers=headers
    )
    assert resp.status_code == 200
    assert started == [upload_id]


def test_get_prepress_annab_kokkuvotte(client_admin):
    client, headers, upload_id = client_admin
    data = client.get(
        "/admin/upload/{}/prepress".format(upload_id), headers=headers
    ).json()
    assert set(["enabled", "default_split_x", "preview_status", "preview_done",
                "pages", "page_count", "output_page_count", "trivial"]) <= set(data)
