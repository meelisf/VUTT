"""#420: salvestus skannib teose isikumainimisi ainult isikutägide muutusel;
lehenumbreid nihutavad teed värskendavad mainimisi ise."""
import json

import pytest
from git import Repo

from server.routers import editing

ISIK_A = {"id": "vutt:Paaa", "label": "Isik A", "entity_type": "person"}
ISIK_B = {"id": "vutt:Pbbb", "label": "Isik B", "entity_type": "person"}
TEEMA = {"id": "Q42", "label": "Teema", "entity_type": "topic"}


@pytest.fixture
def leht(tmp_path, monkeypatch):
    import server.git_ops as git_ops

    data_dir = tmp_path / "data"
    folder = data_dir / "1690-w1"
    folder.mkdir(parents=True)
    r = Repo.init(str(data_dir))
    with r.config_writer() as cw:
        cw.set_value("user", "name", "t").set_value("user", "email", "t@t")
    (folder / "_metadata.json").write_text(json.dumps({"id": "work1", "collections": []}), encoding="utf-8")
    (folder / "pg1.txt").write_text("vana tekst", encoding="utf-8")
    (folder / "pg1.json").write_text(json.dumps({
        "status": "Toores", "sequence": 100, "work_id": "work1", "page_tags": [ISIK_A],
    }, indent=2), encoding="utf-8")
    r.index.add(["1690-w1/pg1.txt", "1690-w1/pg1.json", "1690-w1/_metadata.json"])
    r.index.commit("v1")

    monkeypatch.setattr(git_ops, "BASE_DIR", str(data_dir))
    monkeypatch.setattr(git_ops, "get_or_init_repo", lambda: r)
    monkeypatch.setattr(editing, "BASE_DIR", str(data_dir))
    monkeypatch.setattr(editing, "sync_work_to_meilisearch_async", lambda *a, **k: None)
    monkeypatch.setattr(editing, "enrich_entity_labels_async_qcodes", lambda *a, **k: None)
    kutsed = []
    monkeypatch.setattr(editing, "update_page_person_mentions", lambda wid, wdir: kutsed.append(wid))
    return kutsed


def _save(client, login, *, text, page_tags):
    token = login("editor", "editorpass")
    return client.post("/save", headers={"Authorization": f"Bearer {token}"}, json={
        "original_path": "1690-w1", "file_name": "pg1.txt", "text_content": text,
        "meta_content": {
            "status": "Toores", "work_id": "work1", "page_tags": page_tags,
            "comments": [], "text_annotations": [],
        },
    })


def test_tekstimuudatus_ei_kaivita_skanni(client, login, leht):
    r = _save(client, login, text="uus tekst", page_tags=[ISIK_A])
    assert r.status_code == 200 and r.json()["changed"] is True
    assert leht == []


def test_mitte_isiku_tagi_muutus_ei_kaivita_skanni(client, login, leht):
    r = _save(client, login, text="vana tekst", page_tags=[ISIK_A, TEEMA])
    assert r.json()["changed"] is True
    assert leht == []


def test_isikutagi_lisamine_kaivitab_skanni(client, login, leht):
    _save(client, login, text="vana tekst", page_tags=[ISIK_A, ISIK_B])
    assert leht == ["work1"]


def test_isikutagi_eemaldamine_kaivitab_skanni(client, login, leht):
    _save(client, login, text="vana tekst", page_tags=[])
    assert leht == ["work1"]


def test_kiire_salvestuste_jada_ei_skanni_iga_kord(client, login, leht):
    for i in range(5):
        _save(client, login, text=f"tekst {i}", page_tags=[ISIK_A])
    assert leht == []


# --- Lehenumbreid nihutavad teed ---

@pytest.fixture
def ptw(tmp_path, monkeypatch):
    import server.prosopography.ops as prosopo_ops

    fail = tmp_path / "person_to_works.json"
    fail.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(prosopo_ops, "PERSON_TO_WORKS_FILE", str(fail))
    return lambda: json.loads(fail.read_text(encoding="utf-8"))


def _teos(tmp_path):
    """Kolm lehte; isik A on lehel c."""
    data_dir = tmp_path / "data"
    folder = data_dir / "1690-w1"
    folder.mkdir(parents=True)
    (folder / "_metadata.json").write_text(json.dumps({"id": "work1"}), encoding="utf-8")
    for i, base in enumerate(("a", "b", "c"), start=1):
        (folder / f"{base}.jpg").write_bytes(b"\xff\xd8\xff")
        (folder / f"{base}.txt").write_text("", encoding="utf-8")
        (folder / f"{base}.json").write_text(json.dumps({
            "sequence": i * 100, "page_tags": [ISIK_A] if base == "c" else [],
        }), encoding="utf-8")
    r = Repo.init(str(data_dir))
    with r.config_writer() as cw:
        cw.set_value("user", "name", "t").set_value("user", "email", "t@t")
    r.index.add([f"1690-w1/{f.name}" for f in folder.iterdir()])
    r.index.commit("v1")
    return data_dir, folder, r


def test_umberjarjestus_uuendab_lehenumbrid(client, login, tmp_path, monkeypatch, ptw):
    import server.admin_page_ops as admin_page_ops
    from server.routers import pages

    data_dir, folder, repo = _teos(tmp_path)
    monkeypatch.setattr(admin_page_ops, "BASE_DIR", str(data_dir))
    monkeypatch.setattr(admin_page_ops, "get_or_init_repo", lambda: repo)
    monkeypatch.setattr(pages, "find_directory_by_id", lambda wid: str(folder))
    monkeypatch.setattr(pages, "sync_work_to_meilisearch", lambda *a, **k: None)

    token = login("admin", "adminpass")
    r = client.post("/admin/work/work1/reorder-pages", headers={"Authorization": f"Bearer {token}"},
                    json={"order": ["c.jpg", "a.jpg", "b.jpg"]})

    assert r.status_code == 200, r.text
    assert ptw()["vutt:Paaa"] == [{"work_id": "work1", "role": "mentioned", "pages": [1]}]


def test_uksiku_lehe_kustutamine_uuendab_lehenumbrid(client, login, tmp_path, monkeypatch, ptw):
    from server.routers import pages

    data_dir, folder, _repo = _teos(tmp_path)
    monkeypatch.setattr(pages, "BASE_DIR", str(data_dir))
    monkeypatch.setattr(pages, "find_directory_by_id", lambda wid: str(folder))
    monkeypatch.setattr(pages, "sync_work_to_meilisearch", lambda *a, **k: None)

    def kustuta_gitist(folder_name, base, msg, username):
        (folder / f"{base}.txt").unlink()
        (folder / f"{base}.json").unlink()
    monkeypatch.setattr(pages, "delete_page_from_git", kustuta_gitist)

    token = login("admin", "adminpass")
    r = client.delete("/admin/work/work1/page/1", headers={"Authorization": f"Bearer {token}"})

    assert r.status_code == 200, r.text
    assert ptw()["vutt:Paaa"] == [{"work_id": "work1", "role": "mentioned", "pages": [2]}]


def test_poolitus_varskendab_mainimisi(tmp_path, monkeypatch):
    import server.admin_page_ops as admin_page_ops

    _data_dir, folder, _repo = _teos(tmp_path)
    monkeypatch.setattr(admin_page_ops, "find_directory_by_id", lambda wid: str(folder))
    monkeypatch.setattr(admin_page_ops, "_split_page_locked", lambda *a, **k: None)
    monkeypatch.setattr(admin_page_ops, "sync_work_to_meilisearch", lambda *a, **k: None)
    kutsed = []
    monkeypatch.setattr(admin_page_ops, "refresh_work_mentions", lambda wdir, wid=None: kutsed.append(wid))

    admin_page_ops.split_page("work1", 1, 0.5, "admin")

    assert kutsed == ["work1"]


def test_refresh_loeb_work_id_metaandmetest_ja_ei_viska(tmp_path, monkeypatch, ptw):
    from server.prosopography import relations

    _data_dir, folder, _repo = _teos(tmp_path)
    relations.refresh_work_mentions(str(folder))
    assert ptw()["vutt:Paaa"] == [{"work_id": "work1", "role": "mentioned", "pages": [3]}]

    def katki(*a, **k):
        raise OSError("ketas täis")
    monkeypatch.setattr(relations, "update_page_person_mentions", katki)
    relations.refresh_work_mentions(str(folder))  # ei viska: lehetoiming on juba tehtud
