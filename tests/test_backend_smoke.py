import importlib
import json
import unittest.mock


def test_login_and_verify_token_roundtrip(client, login):
    token = login("admin", "adminpass")

    response = client.post("/verify-token", json={"token": token})

    assert response.status_code == 200
    assert response.json() == {
        "status": "success",
        "user": {
            "username": "admin",
            "name": "Admin User",
            "role": "admin",
        },
        "valid": True,
    }


def test_user_chars_roundtrip_with_bearer_token(client, login, backend_env):
    token = login("editor", "editorpass")
    headers = {"Authorization": f"Bearer {token}"}

    save_response = client.post("/user-chars", headers=headers, json={"characters": ["þ", "æ"]})
    fetch_response = client.get("/user-chars", headers=headers)

    assert save_response.status_code == 200
    assert save_response.json() == {"status": "success"}
    assert fetch_response.status_code == 200
    assert fetch_response.json() == {
        "status": "success",
        "characters": ["þ", "æ"],
        "is_custom": True,
    }

    saved_file = backend_env["user_chars_dir"] / "editor.json"
    assert json.loads(saved_file.read_text(encoding="utf-8")) == {"characters": ["þ", "æ"]}


def test_invite_set_password_consumes_token_once(client, backend_env):
    # Kolmas argument on created_by (kutsuva admini nimi), mitte uue kasutaja roll.
    # Kõik invite-kasutajad saavad alati "editor" rolli (hardcoded create_user_from_invite).
    invite = backend_env["registration"].create_invite_token(
        "new.user@example.test",
        "New User",
        "admin",
    )

    first_response = client.post(
        "/invite/set-password",
        json={"token": invite["token"], "password": "secret123"},
    )
    second_response = client.post(
        "/invite/set-password",
        json={"token": invite["token"], "password": "another-secret"},
    )

    assert first_response.status_code == 200
    assert first_response.json() == {
        "status": "success",
        "username": "newuser",
    }
    assert second_response.status_code == 400
    assert second_response.json()["detail"] == "Token on juba kasutatud"

    users = json.loads(backend_env["users_file"].read_text(encoding="utf-8"))
    assert "newuser" in users
    assert users["newuser"]["role"] == "editor"
    assert users["newuser"]["email"] == "new.user@example.test"


def test_admin_collection_update_writes_json(client, login, backend_env):
    token = login("admin", "adminpass")
    headers = {"Authorization": f"Bearer {token}"}

    response = client.put(
        "/admin/collections/sample",
        headers=headers,
        json={
            "description": {"et": "Luhikirjeldus", "en": "Short description"},
            "description_long": {"et": "Pikem kirjeldus", "en": "Longer description"},
            "color": "#123456",
        },
    )

    assert response.status_code == 200
    assert response.json() == {"status": "success"}

    collections = json.loads(backend_env["collections_file"].read_text(encoding="utf-8"))
    assert collections["sample"]["description"] == {
        "et": "Luhikirjeldus",
        "en": "Short description",
    }
    assert collections["sample"]["description_long"] == {
        "et": "Pikem kirjeldus",
        "en": "Longer description",
    }
    assert collections["sample"]["color"] == "#123456"


def test_admin_upload_status_returns_staged_state(client, login, make_upload):
    _, state = make_upload(
        "upl123",
        status="pending",
        expected_pages=3,
        files=[
            {
                "page": 1,
                "filename": "001.jpg",
                "has_ocr": False,
                "deleted": False,
            }
        ],
    )
    token = login("admin", "adminpass")

    response = client.get(
        f"/admin/upload/{state['id']}/status",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "status": "pending",
        "expected_pages": 3,
        "files": state["files"],
        "ready": 0,
        "total": 0,
        "progress": {},
        "error": None,
    }


def test_admin_upload_thumb_serves_file_with_legacy_query_token(client, login, make_upload):
    upload_dir, state = make_upload("upl456")
    thumb_path = upload_dir / "thumbs" / "001.jpg"
    thumb_bytes = b"fake-jpeg-bytes"
    thumb_path.write_bytes(thumb_bytes)
    token = login("admin", "adminpass")

    response = client.get(f"/admin/upload/{state['id']}/thumb/1?token={token}")

    assert response.status_code == 200
    assert response.headers["content-type"] == "image/jpeg"
    assert response.content == thumb_bytes


from pathlib import Path


def test_build_suggestions_uses_meili_for_page_tags(tmp_path, monkeypatch):
    """
    _build_suggestions() peab page_tags võtma Meilisearchist,
    mitte lehekülje .json failidest.
    """
    # Seadista ajutine data kaust ühe teosega
    work_dir = tmp_path / "teos1"
    work_dir.mkdir()
    (work_dir / "_metadata.json").write_text(
        json.dumps({
            "id": "abc123",
            "title": "Testeos",
            "tags": [{"label": "Jutlus", "id": "Q861911", "labels": {"et": "Jutlus"}}],
            "creators": [],
            "genre": None,
            "type": None,
            "location": None,
            "publisher": None,
        }),
        encoding="utf-8",
    )
    # Lehekülg millel on page_tag — EI tohi suggestions-i jõuda (failid ei loeta enam)
    (work_dir / "leht1.json").write_text(
        json.dumps({"page_tags": [{"label": "Vanatestament", "id": "Q1", "labels": {"et": "Vanatestament"}}]}),
        encoding="utf-8",
    )

    # Meilisearchi vastus: ainult "Teoloogia" page_tag
    fake_meili_response = json.dumps({
        "facetDistribution": {
            "page_tags_suggest_et": {
                "Teoloogia|||Q34178": 3,
                "Michael Dau|||vutt:Ptbc4f4": 2,
            }
        }
    }).encode()

    cache_mod = importlib.import_module("server.cache")
    config_mod = importlib.import_module("server.config")

    monkeypatch.setattr(config_mod, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(cache_mod, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(cache_mod, "MEILI_URL", "http://localhost:7700")
    monkeypatch.setattr(cache_mod, "MEILI_KEY", "testkey")
    monkeypatch.setattr(cache_mod, "INDEX_NAME", "teosed")

    mock_resp = unittest.mock.MagicMock()
    mock_resp.read.return_value = fake_meili_response
    mock_resp.__enter__ = lambda s: s
    mock_resp.__exit__ = unittest.mock.MagicMock(return_value=False)

    with unittest.mock.patch("urllib.request.urlopen", return_value=mock_resp):
        result = cache_mod._build_suggestions("et")

    tag_labels = [t["label"] for t in result["tags"]]

    # page_tags Meilisearchist peavad olema
    assert "Teoloogia" in tag_labels, f"Teoloogia peaks olema tags-is, sain: {tag_labels}"
    # Metadata-taseme tägid peavad olema
    assert "Jutlus" in tag_labels, f"Jutlus peaks olema tags-is, sain: {tag_labels}"
    # Lehekülje .json faili tag EI tohi olla (faili ei loeta enam)
    assert "Vanatestament" not in tag_labels, f"Vanatestament ei tohi olla tags-is (failid ei loeta), sain: {tag_labels}"
    # vutt:P isikud EI tohi soovitustes olla
    assert "Michael Dau" not in tag_labels, f"Michael Dau ei tohi olla tags-is (vutt:P filter), sain: {tag_labels}"


def test_update_page_person_mentions(tmp_path, monkeypatch):
    """
    update_page_person_mentions() loeb teose leheküljefailidest vutt:P tägid
    ja uuendab person_to_works.json 'mentioned' rolliga.
    Olemasolevad 'subject'/'creator' rollid jäävad puutumata.
    """
    import server.prosopography.ops as prosopo_ops

    work_id = "work123"
    work_dir = tmp_path / "teos1"
    work_dir.mkdir()

    # Leht 1: kaks isikut
    (work_dir / "leht1.json").write_text(json.dumps({
        "page_tags": [
            {"id": "vutt:Paaa", "label": "Isik A", "entity_type": "person"},
            {"id": "Q99999", "label": "Mitte-isik", "entity_type": "topic"},
        ]
    }), encoding="utf-8")

    # Leht 2: teine isik
    (work_dir / "leht2.json").write_text(json.dumps({
        "meta_content": {
            "page_tags": [
                {"id": "vutt:Pbbb", "label": "Isik B", "entity_type": "person"},
            ]
        }
    }), encoding="utf-8")

    # _metadata.json peab eksisteerima aga ei loe siin
    (work_dir / "_metadata.json").write_text(json.dumps({"id": work_id}), encoding="utf-8")

    # Eelnevad kirjed: Isik A on juba 'subject' rollis — see peab säilima
    ptw_file = tmp_path / "person_to_works.json"
    ptw_file.write_text(json.dumps({
        "vutt:Paaa": [{"work_id": work_id, "role": "subject"}],
        "vutt:Pccc": [{"work_id": "other_work", "role": "mentioned"}],
    }), encoding="utf-8")

    monkeypatch.setattr(prosopo_ops, "PERSON_TO_WORKS_FILE", str(ptw_file))

    prosopo_ops.update_page_person_mentions(work_id, str(work_dir))

    data = json.loads(ptw_file.read_text(encoding="utf-8"))

    # Isik A: peab olema nii 'subject' (vana) kui 'mentioned' (uus)
    roles_a = {e["role"] for e in data["vutt:Paaa"]}
    assert "subject" in roles_a, f"subject peab säilima: {data['vutt:Paaa']}"
    assert "mentioned" in roles_a, f"mentioned peab lisanduma: {data['vutt:Paaa']}"

    # Isik B: ainult 'mentioned'
    assert "vutt:Pbbb" in data
    assert data["vutt:Pbbb"] == [{"work_id": work_id, "role": "mentioned"}]

    # Q-kood ei tohi olla lisatud
    assert "Q99999" not in data

    # Teise teose kirje peab säilima
    assert data["vutt:Pccc"] == [{"work_id": "other_work", "role": "mentioned"}]


def test_rebuild_indices_includes_page_person_mentions(tmp_path, monkeypatch):
    """
    rebuild_indices() peab page_tags vutt:P isikuid lisama person_to_works
    rolliga 'mentioned'.
    """
    import server.prosopography.ops as prosopo_ops

    # Teoste kataloog
    data_dir = tmp_path / "data"
    data_dir.mkdir()

    # Teos1: leht kus on isik vutt:Pxxx
    teos1 = data_dir / "teos1"
    teos1.mkdir()
    (teos1 / "_metadata.json").write_text(json.dumps({
        "id": "workAAA",
        "creators": [],
        "tags": [],
        "publisher": None,
    }), encoding="utf-8")
    (teos1 / "leht1.json").write_text(json.dumps({
        "page_tags": [
            {"id": "vutt:Pxxx", "label": "Test Isik", "entity_type": "person"},
        ]
    }), encoding="utf-8")
    # Leht 2: sama isik kui leht1 — ei tohi duplikaate tekitada
    (teos1 / "leht2.json").write_text(json.dumps({
        "page_tags": [
            {"id": "vutt:Pxxx", "label": "Test Isik", "entity_type": "person"},
        ]
    }), encoding="utf-8")

    # Prosopograafia kaust (tühi — testis pole isikukaarte vaja)
    prosopo_dir = tmp_path / "prosopography"
    prosopo_dir.mkdir()

    ptw_file = tmp_path / "person_to_works.json"
    index_file = tmp_path / "prosopography_index.json"
    aliases_file = tmp_path / "person_aliases.json"

    monkeypatch.setattr(prosopo_ops, "PERSON_TO_WORKS_FILE", str(ptw_file))
    monkeypatch.setattr(prosopo_ops, "PROSOPOGRAPHY_INDEX_FILE", str(index_file))
    monkeypatch.setattr(prosopo_ops, "PERSON_ALIASES_FILE", str(aliases_file))
    monkeypatch.setattr(prosopo_ops, "PROSOPOGRAPHY_DIR", str(prosopo_dir))

    # rebuild_indices kasutab `from ..config import BASE_DIR` funktsiooni sees
    import server.config as config_mod
    monkeypatch.setattr(config_mod, "BASE_DIR", str(data_dir))

    prosopo_ops.rebuild_indices()

    data = json.loads(ptw_file.read_text(encoding="utf-8"))

    assert "vutt:Pxxx" in data, f"vutt:Pxxx peaks olema ptw-s, sain: {list(data.keys())}"
    roles = {e["role"] for e in data["vutt:Pxxx"]}
    assert "mentioned" in roles, f"'mentioned' roll peaks olema: {data['vutt:Pxxx']}"
    assert data["vutt:Pxxx"][0]["work_id"] == "workAAA"
    # Sama isik mitmel lehel — ainult üks 'mentioned' kirje teose kohta
    mentioned_entries = [e for e in data["vutt:Pxxx"] if e["role"] == "mentioned"]
    assert len(mentioned_entries) == 1, f"Peaks olema täpselt 1 'mentioned' kirje, sain: {mentioned_entries}"


def test_save_triggers_page_person_mentions_update(client, login, monkeypatch, tmp_path):
    """
    POST /save peab käivitama update_page_person_mentions background task-i
    kui meta_content sisaldab work_id välja.
    """
    import server.main as main_mod

    # Mock sõltuvused mis vajavad git/filesystem/meilisearch
    monkeypatch.setattr(main_mod, "save_with_git", lambda *a, **kw: {"commit_hash": "abc12345"})
    monkeypatch.setattr(main_mod, "sync_work_to_meilisearch_async", lambda *a: None)
    monkeypatch.setattr(main_mod, "BASE_DIR", str(tmp_path))

    calls = []
    # update_page_person_mentions imporditakse main.py-sse Task 4 implementatsioonis
    monkeypatch.setattr(main_mod, "update_page_person_mentions", lambda wid, wdir: calls.append((wid, wdir)))

    token = login("editor", "editorpass")
    response = client.post("/save", headers={"Authorization": f"Bearer {token}"}, json={
        "original_path": "teos1",
        "file_name": "leht1.txt",
        "text_content": "uus tekst",
        "meta_content": {"work_id": "workAAA", "page_tags": []},
    })

    assert response.status_code == 200
    assert len(calls) == 1, f"update_page_person_mentions peaks olema kutsutud 1 kord, sain: {calls}"
    assert calls[0][0] == "workAAA"
    assert "teos1" in calls[0][1]
