import importlib
import json
import unittest.mock


def test_login_and_verify_token_roundtrip(client, login):
    token = login("admin", "adminpass")

    response = client.post("/verify-token", json={"token": token})

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["valid"] is True
    assert data["user"]["username"] == "admin"
    assert data["user"]["role"] == "admin"
    assert "allowed_collections" in data["user"]


def test_user_chars_roundtrip_with_bearer_token(client, login, backend_env):
    token = login("editor", "editorpass")
    headers = {"Authorization": f"Bearer {token}"}

    save_response = client.post("/user-chars", headers=headers, json={"characters": ["þ", "æ"]})
    fetch_response = client.get("/user-chars", headers=headers)

    assert save_response.status_code == 200
    assert save_response.json()["status"] == "success"
    assert fetch_response.status_code == 200
    assert fetch_response.json() == {
        "status": "success",
        "characters": ["þ", "æ"],
        "is_custom": True,
    }

    saved_file = backend_env["user_settings_dir"] / "editor.json"
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
        json={"token": invite["token"], "password": "secret123456"},
    )
    second_response = client.post(
        "/invite/set-password",
        json={"token": invite["token"], "password": "another-secret456"},
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

    # rebuild_indices kasutab mooduli-tasandi BASE_DIR importi (ops.py)
    monkeypatch.setattr(prosopo_ops, "BASE_DIR", str(data_dir))

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


# ============================================================
# has_annotations regressioonitestid
# ============================================================

def _make_page_doc(page_tags=None, comments=None, text_annotations=None):
    """Abifunktsioon minimaalne Meilisearch dokument testimiseks."""
    return {
        "has_annotations": bool(
            (page_tags or []) or (comments or []) or (text_annotations or [])
        ),
        "comments": comments or [],
        "page_tags_object": page_tags or [],
        "text_annotations": text_annotations or [],
    }


def test_has_annotations_true_when_comments():
    """has_annotations peab olema True kui on kommentaarid."""
    doc = _make_page_doc(comments=[{"id": "c1", "text": "Huvitav", "author": "a", "created_at": "2026-01-01"}])
    assert doc["has_annotations"] is True


def test_has_annotations_true_when_page_tags():
    """has_annotations peab olema True kui on page_tags."""
    doc = _make_page_doc(page_tags=[{"label": "Teoloogia", "id": "Q34178"}])
    assert doc["has_annotations"] is True


def test_has_annotations_false_when_both_empty():
    """has_annotations peab olema False kui pole kommentaare ega tage ega text_annotations."""
    doc = _make_page_doc()
    assert doc["has_annotations"] is False


# ============================================================
# text_annotations Meilisearch indekseerimise testid
# ============================================================

def test_build_text_annotations_text_joined():
    """build_text_annotations_text peab liitma kõigi annotatsioonide kommentaarid."""
    from server.meilisearch_ops import build_text_annotations_text
    anns = [
        {"id": 1, "comment": "Viide Cicero kirjale", "author": "u", "created_at": "2026-01-01"},
        {"id": 2, "comment": "Kreekakeelne tsitaat", "author": "u", "created_at": "2026-01-01"},
    ]
    result = build_text_annotations_text(anns)
    assert result is not None
    assert "Viide Cicero kirjale" in result
    assert "Kreekakeelne tsitaat" in result


def test_build_text_annotations_text_empty():
    """Tühi massiiv → None (väli jäetakse dokumendist välja)."""
    from server.meilisearch_ops import build_text_annotations_text
    assert build_text_annotations_text([]) is None


def test_has_annotations_true_when_text_annotations():
    """has_annotations peab olema True kui on text_annotations."""
    doc = _make_page_doc(text_annotations=[
        {"id": 1, "comment": "Huvitav koht", "author": "u", "created_at": "2026-01-01"}
    ])
    assert doc["has_annotations"] is True


def test_public_meili_token_endpoint(client, backend_env):
    """GET /api/meili-token tagastab tokeni ilma authita."""
    response = client.get("/api/meili-token")
    assert response.status_code == 200
    data = response.json()
    assert "token" in data
    # Token on tühi string kui MEILI_SEARCH_KEY pole seadistatud (test env)
    assert isinstance(data["token"], str)


def test_collection_visibility_update(client, login, backend_env):
    """Admin saab kollektsiooni visibility muuta."""
    token = login("admin", "adminpass")
    headers = {"Authorization": f"Bearer {token}"}

    response = client.put(
        "/admin/collections/sample",
        headers=headers,
        json={"visibility": "restricted"},
    )
    assert response.status_code == 200
    assert response.json()["status"] == "success"

    import json
    updated = json.loads(backend_env["collections_file"].read_text())
    assert updated["sample"]["visibility"] == "restricted"


def test_login_returns_meili_token(client, backend_env):
    """Login vastus sisaldab meili_token välja."""
    response = client.post("/login", json={"username": "admin", "password": "adminpass"})
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert "meili_token" in data
    # meili_token on None või string (tühi string lubatud test envs)
    assert data["meili_token"] is None or isinstance(data["meili_token"], str)


def test_create_upload_type_print(backend_env):
    """Trükis (Q1261026): remote path sisaldab 'print/'."""
    upload_ops = backend_env["upload_ops"]
    state = upload_ops.create_upload({
        "title": "Test teos",
        "year": "1680",
        "slug": "test-teos",
        "type": {"id": "Q1261026", "label": "trükis", "source": "wikidata"},
    })
    assert "material_type" not in state["meta"]
    assert "AUTO-OCR/print/" in state["remote_staging_path"]


def test_create_upload_type_hand(backend_env):
    """Käsikiri (Q87167): remote path sisaldab 'hand/'."""
    upload_ops = backend_env["upload_ops"]
    state = upload_ops.create_upload({
        "title": "Käsikirjaline materjal",
        "year": "",
        "slug": "kasikiri-test",
        "type": {"id": "Q87167", "label": "käsikiri", "source": "wikidata"},
    })
    assert "material_type" not in state["meta"]
    assert "AUTO-OCR/hand/" in state["remote_staging_path"]
    assert "AUTO-OCR/hand/" in state["remote_work_path"]


def test_create_upload_type_default(backend_env):
    """Kui type puudub, kasutatakse 'print' vaikeväärtust."""
    upload_ops = backend_env["upload_ops"]
    state = upload_ops.create_upload({
        "title": "Ilma tüübita teos",
        "year": "1700",
        "slug": "ilma-tyybita",
    })
    assert "material_type" not in state["meta"]
    assert "AUTO-OCR/print/" in state["remote_staging_path"]


# ---------------------------------------------------------------------------
# Arhiivide register CRUD
# ---------------------------------------------------------------------------

def test_create_archive_writes_file(client, login, backend_env):
    token = login("admin", "adminpass")
    headers = {"Authorization": f"Bearer {token}"}

    response = client.post(
        "/config/archives",
        headers=headers,
        json={"id": "EKM", "name": "Eesti Kirjandusmuuseum", "url": "https://www.kirmus.ee"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert data["id"] == "EKM"
    archives = json.loads(backend_env["archives_file"].read_text(encoding="utf-8"))
    assert archives["EKM"]["name"] == "Eesti Kirjandusmuuseum"
    assert archives["EKM"]["url"] == "https://www.kirmus.ee"


def test_create_archive_duplicate_returns_409(client, login, backend_env):
    token = login("admin", "adminpass")
    headers = {"Authorization": f"Bearer {token}"}

    response = client.post(
        "/config/archives",
        headers=headers,
        json={"id": "RA", "name": "Teine RA"},
    )

    assert response.status_code == 409
    assert "RA" in response.json()["detail"]


def test_update_archive_writes_file(client, login, backend_env):
    token = login("admin", "adminpass")
    headers = {"Authorization": f"Bearer {token}"}

    response = client.put(
        "/config/archives/RA",
        headers=headers,
        json={"name": "Uus nimi", "url": "https://uus.ee"},
    )

    assert response.status_code == 200
    archives = json.loads(backend_env["archives_file"].read_text(encoding="utf-8"))
    assert archives["RA"]["name"] == "Uus nimi"
    assert archives["RA"]["url"] == "https://uus.ee"


def test_update_archive_not_found_returns_404(client, login, backend_env):
    token = login("admin", "adminpass")
    headers = {"Authorization": f"Bearer {token}"}

    response = client.put(
        "/config/archives/NOTEXIST",
        headers=headers,
        json={"name": "Test"},
    )

    assert response.status_code == 404


def test_delete_archive_removes_from_file(client, login, backend_env, monkeypatch):
    import server.main as main_mod
    monkeypatch.setattr(main_mod, "_find_works_with_archive", lambda _: [])
    token = login("admin", "adminpass")
    headers = {"Authorization": f"Bearer {token}"}

    response = client.delete("/config/archives/RA", headers=headers)

    assert response.status_code == 200
    archives = json.loads(backend_env["archives_file"].read_text(encoding="utf-8"))
    assert "RA" not in archives


def test_delete_archive_in_use_returns_409(client, login, backend_env, monkeypatch):
    import server.main as main_mod
    monkeypatch.setattr(
        main_mod, "_find_works_with_archive",
        lambda _: [("/data/teos1/_metadata.json", {"title": "Teos 1"})]
    )
    token = login("admin", "adminpass")
    headers = {"Authorization": f"Bearer {token}"}

    response = client.delete("/config/archives/RA", headers=headers)

    assert response.status_code == 409
    assert "Teos 1" in response.json()["detail"]


def test_delete_archive_force_removes_despite_usage(client, login, backend_env, monkeypatch):
    import server.main as main_mod
    monkeypatch.setattr(
        main_mod, "_find_works_with_archive",
        lambda _: [("/data/teos1/_metadata.json", {"title": "Teos 1"})]
    )
    token = login("admin", "adminpass")
    headers = {"Authorization": f"Bearer {token}"}

    response = client.delete("/config/archives/RA?force=true", headers=headers)

    assert response.status_code == 200
    archives = json.loads(backend_env["archives_file"].read_text(encoding="utf-8"))
    assert "RA" not in archives


def test_delete_archive_requires_admin(client, login, backend_env):
    token = login("editor", "editorpass")
    headers = {"Authorization": f"Bearer {token}"}

    response = client.delete("/config/archives/RA", headers=headers)

    # Süsteem tagastab 401 ka ebapiisavate õiguste korral (require_token → get_user → 401)
    assert response.status_code in (401, 403)


def test_page_base_name_new_convention():
    """Slug juba sisaldab work_id'd → seda ei lisata uuesti."""
    from server.upload_ops import _page_base_name
    assert _page_base_name("adam-koljo-kiri-pcdm0f", "pcdm0f", 1) == "adam-koljo-kiri-pcdm0f-001"


def test_page_base_name_old_convention():
    """Vana kaust ilma work_id'ta → work_id lisatakse failinimme."""
    from server.upload_ops import _page_base_name
    assert _page_base_name("kirjad", "ab12cd", 7) == "kirjad-ab12cd-007"


def test_create_upload_appends_work_id(backend_env):
    """create_upload genereerib work_id ja küpsetab selle slug'i."""
    upload_ops = backend_env["upload_ops"]
    state = upload_ops.create_upload({
        "title": "Adam Koljo kiri",
        "year": "",
        "slug": "adam-koljo-kiri",
    })
    meta = state["meta"]
    work_id = meta["work_id"]
    assert len(work_id) == 6
    assert meta["slug"] == f"adam-koljo-kiri-{work_id}"
    assert meta["slug"].endswith(f"-{work_id}")
