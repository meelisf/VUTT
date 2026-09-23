"""Eemaldatud tekst-annotatsioon lehe märkmena tagasi (#375 punkt 4, minimaalne).

Teksti ei puututa ja midagi ei eemaldata: märkus lisandub lehe märkmeks sama
kujuga, mille annab ADR 0041 lepitus ankru kaotanud kirjele. Ankru uuesti
valimist ei ole — toimetaja seob märkme vajadusel käsitsi.
"""
import json

import pytest

from server.annotation_ops import ORPHAN_COMMENT_PREFIX, restore_annotation_as_comment

REC = {"id": 3, "comment": "vana märkus", "author": "toimetaja", "created_at": "2026-09-01T10:00:00"}


def _vanem(*recs):
    return json.dumps({"text_annotations": list(recs), "comments": []})


def test_lisab_markme_ja_ei_puutu_muud():
    praegu = {"text_annotations": [{"id": 5, "comment": "alles"}], "comments": [{"id": "c", "text": "x"}],
              "page_tags": ["Q1"]}

    uus, kommentaar = restore_annotation_as_comment(praegu, _vanem(REC), 3)

    assert kommentaar["text"] == f"{ORPHAN_COMMENT_PREFIX}: vana märkus"
    assert kommentaar["author"] == "toimetaja"
    assert kommentaar["created_at"] == "2026-09-01T10:00:00"
    assert uus["comments"] == [{"id": "c", "text": "x"}, kommentaar]
    assert uus["text_annotations"] == praegu["text_annotations"]
    assert uus["page_tags"] == ["Q1"]
    assert praegu["comments"] == [{"id": "c", "text": "x"}]  # sisendit ei muudeta


def test_vana_wrapper_kuju():
    praegu = {"meta_content": {"comments": [], "text_annotations": []}, "page_number": 1}
    vanem = json.dumps({"meta_content": {"text_annotations": [REC]}})
    uus, _ = restore_annotation_as_comment(praegu, vanem, 3)
    assert len(uus["meta_content"]["comments"]) == 1 and uus["page_number"] == 1


@pytest.mark.parametrize("vanem,kood", [
    (None, 404), ("{katki", 404), (_vanem({"id": 9, "comment": "muu"}), 404),
    (_vanem({"id": 3, "comment": "  "}), 400),
])
def test_puuduv_voi_tuhi_kirje(vanem, kood):
    with pytest.raises(LookupError if kood == 404 else ValueError):
        restore_annotation_as_comment({"comments": []}, vanem, 3)


def test_markus_on_lehel_alles():
    with pytest.raises(FileExistsError):
        restore_annotation_as_comment({"text_annotations": [{"id": 3, "comment": "vana märkus"}]},
                                      _vanem(REC), 3)


def test_juba_taastatud():
    uus, _ = restore_annotation_as_comment({"comments": []}, _vanem(REC), 3)
    with pytest.raises(FileExistsError):
        restore_annotation_as_comment(uus, _vanem(REC), 3)


# --- Endpoint --------------------------------------------------------------

@pytest.fixture
def repo(backend_env, tmp_path, monkeypatch):
    """v1: märkusega leht. v2: märkus eemaldatud (tekst puutumata)."""
    import os
    from git import Repo
    import server.git_ops as git_ops
    import server.routers.editing as editing

    data_dir = tmp_path / "data"
    folder = data_dir / "1690-w1"
    folder.mkdir(parents=True)
    r = Repo.init(str(data_dir))
    with r.config_writer() as cw:
        cw.set_value("user", "name", "t").set_value("user", "email", "t@t")
    (folder / "_metadata.json").write_text(json.dumps({"id": "work1", "collections": []}), encoding="utf-8")
    txt, jp = folder / "pg1.txt", folder / "pg1.json"
    rel = lambda p: os.path.relpath(str(p), str(data_dir))
    txt.write_text("tekst <ann3>siin</ann3>", encoding="utf-8")
    jp.write_text(json.dumps({"comments": [], "text_annotations": [REC]}), encoding="utf-8")
    r.index.add([rel(txt), rel(jp)]); r.index.commit("v1")
    txt.write_text("tekst siin", encoding="utf-8")
    jp.write_text(json.dumps({"comments": [], "text_annotations": []}), encoding="utf-8")
    r.index.add([rel(txt), rel(jp)]); r.index.commit("v2 märkus eemaldatud")

    monkeypatch.setattr(git_ops, "BASE_DIR", str(data_dir))
    monkeypatch.setattr(git_ops, "get_or_init_repo", lambda: r)
    monkeypatch.setattr(editing, "BASE_DIR", str(data_dir))
    monkeypatch.setattr(editing, "sync_work_to_meilisearch_async", lambda *a, **k: None)
    return {"repo": r, "v2": r.head.commit.hexsha, "txt": txt, "jp": jp}


def _post(client, token, commit_hash, ann_id=3):
    return client.post("/page-annotations/restore-as-comment", json={
        "original_path": "1690-w1", "file_name": "pg1.txt",
        "commit_hash": commit_hash, "annotation_id": ann_id,
    }, headers={"Authorization": f"Bearer {token}"})


def test_endpoint_taastab_markme_uhe_commitiga(client, login, repo):
    enne = len(list(repo["repo"].iter_commits()))
    r = _post(client, login("editor", "editorpass"), repo["v2"])

    assert r.status_code == 200, r.text
    body = r.json()
    [markus] = body["comments"]
    assert "vana märkus" in markus["text"] and body["git_committed"] is True
    assert json.loads(repo["jp"].read_text(encoding="utf-8"))["comments"] == body["comments"]
    assert repo["txt"].read_text(encoding="utf-8") == "tekst siin"  # tekst puutumata
    assert len(list(repo["repo"].iter_commits())) == enne + 1

    # Teist korda sama → 409, mitte topeltmärge.
    assert _post(client, login("editor", "editorpass"), repo["v2"]).status_code == 409


def test_endpoint_voras_commit_ja_puuduv_markus(client, login, repo):
    token = login("editor", "editorpass")
    assert _post(client, token, "0" * 40).status_code == 400
    assert _post(client, token, repo["v2"], ann_id=99).status_code == 404
