"""
Testid prügikasti operatsioonidele (server/trash_ops.py).

trash_ops.py-l polnud varem ühtegi testi. Kaetud:
- guard/edge-case'iteed (puuduvad kaustad, puuduvad failid) — ilma gita;
- restore_deleted_work täisvoog päris (ajutises) git-repos;
- restore_deleted_page täisvoog päris git-repos;
- list_deleted_works ristviitab õigesti git logiga.
"""
import os
import sys
from pathlib import Path

import pytest
from git import Repo, Actor

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server.trash_ops as trash_ops
import server.git_ops as git_ops


# =========================================================
# Guard / edge-case testid (ilma gita)
# =========================================================

def test_list_deleted_works_empty_when_no_trash(monkeypatch):
    """TRASH_DIR puudumisel tagastab tühi list, mitte vea."""
    monkeypatch.setattr(trash_ops, "TRASH_DIR", "/ei/ole/olemas/trash_xyz")
    assert trash_ops.list_deleted_works() == []


def test_list_deleted_pages_empty_when_no_pages(monkeypatch, tmp_path):
    """pages alamkausta pole → tühi list."""
    monkeypatch.setattr(trash_ops, "TRASH_DIR", str(tmp_path / "._trash"))
    assert trash_ops.list_deleted_pages("w1", "1690-w1") == []


def test_restore_deleted_work_missing_in_trash(monkeypatch, tmp_path):
    """Prügikastis puuduv work_id → ok:False."""
    monkeypatch.setattr(trash_ops, "TRASH_DIR", str(tmp_path / "._trash"))
    res = trash_ops.restore_deleted_work("puudub_id")
    assert res["ok"] is False
    assert "Prügikastis ei leitud" in res["error"]


def test_restore_deleted_page_missing_img(monkeypatch, tmp_path):
    """Kustutatud pilti pole prügikastis → ok:False (enne git otsingut)."""
    trash_root = tmp_path / "._trash"
    (trash_root / "w1" / "pages").mkdir(parents=True)
    monkeypatch.setattr(trash_ops, "TRASH_DIR", str(trash_root))
    monkeypatch.setattr(trash_ops, "BASE_DIR", str(tmp_path / "data"))
    res = trash_ops.restore_deleted_page("w1", "1690-w1", "pg1.jpg")
    assert res["ok"] is False
    assert "Kustutatud faili ei leitud" in res["error"]


def test_restore_deleted_page_missing_work_dir(monkeypatch, tmp_path):
    """Pilt on prügikastis, aga teose kausta pole → ok:False."""
    trash_root = tmp_path / "._trash"
    pages = trash_root / "w1" / "pages"
    pages.mkdir(parents=True)
    (pages / "pg1.jpg").write_bytes(b"x")
    data_dir = tmp_path / "data"  # teadlikult ei loo 1690-w1 all
    monkeypatch.setattr(trash_ops, "TRASH_DIR", str(trash_root))
    monkeypatch.setattr(trash_ops, "BASE_DIR", str(data_dir))
    res = trash_ops.restore_deleted_page("w1", "1690-w1", "pg1.jpg")
    assert res["ok"] is False
    assert "Teose kataloog ei leitud" in res["error"]


# =========================================================
# Täisvood päris (ajutises) git-repos
# =========================================================

@pytest.fixture
def trash_repo(tmp_path, monkeypatch):
    """Ajutine git-repo + monkeypatchitud trash_ops sõltuvused.

    Repo juur == BASE_DIR == tmp_path (sama muster nagu tests/test_delete_pages_git.py),
    et git working-dir ja failide asukoht klappiks. Peegeldab tegelikku kustutamisvoogu:
    JPG-d liigutatakse prügikasti ENNE git rm-i (vt git_ops.delete_work_from_git docstring).
    """
    repo = Repo.init(str(tmp_path))
    with repo.config_writer() as cw:
        cw.set_value("user", "name", "test").set_value("user", "email", "t@t")

    trash_root = tmp_path / "._trash"

    # sync_work_to_meilisearch ei tohi päris Meilisearchi puutuda
    monkeypatch.setattr(trash_ops, "sync_work_to_meilisearch", lambda slug: True)
    monkeypatch.setattr(trash_ops, "get_or_init_repo", lambda: repo)
    monkeypatch.setattr(git_ops, "get_or_init_repo", lambda: repo)
    monkeypatch.setattr(git_ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(trash_ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(trash_ops, "TRASH_DIR", str(trash_root))

    return {"repo": repo, "tmp": tmp_path, "base_dir": tmp_path, "trash_root": trash_root}


def test_restore_deleted_work_full_flow(trash_repo):
    """Kustutatud teos taastub: git checkout taastab txt/json/metadata,
    JPG-d liiguvad prügikastist tagasi, tehakse taastamise commit."""
    repo = trash_repo["repo"]
    base_dir = trash_repo["base_dir"]
    trash_root = trash_repo["trash_root"]
    work_id = "abc123xyz"
    folder = "1690-w1"
    folder_path = base_dir / folder

    # 1. Loo teose failid
    folder_path.mkdir()
    (folder_path / "pg1.txt").write_text("sisu", encoding="utf-8")
    (folder_path / "pg1.json").write_text("{}", encoding="utf-8")
    (folder_path / "_metadata.json").write_text('{"id": "abc123xyz"}', encoding="utf-8")
    (folder_path / "pg1.jpg").write_bytes(b"\xff\xd8jpeg")
    repo.index.add([
        f"{folder}/pg1.txt", f"{folder}/pg1.json",
        f"{folder}/_metadata.json",
    ])
    repo.index.commit("init")

    # 2. Liiguta JPG prügikasti (nagu päris vool)
    trash_work = trash_root / work_id
    trash_work.mkdir(parents=True)
    import shutil
    shutil.move(str(folder_path / "pg1.jpg"), str(trash_work / "pg1.jpg"))

    # 3. git rm + kustutamise commit (peegeldab delete_work_from_git formaati)
    repo.git.rm(f"{folder}/pg1.txt", f"{folder}/pg1.json", f"{folder}/_metadata.json")
    actor = Actor("kustutaja", "k@vutt.local")
    repo.index.commit(f"Kustuta teos: Minu Teos [{work_id}]", author=actor, committer=actor)
    # Tühjaks jäänud kaust eemaldatakse (git ei jälgi tühje kaustu)
    if folder_path.exists() and not any(folder_path.iterdir()):
        folder_path.rmdir()

    # 4. Taasta
    res = trash_ops.restore_deleted_work(work_id, username="taastaja")

    # 5. Kontrolli
    assert res["ok"] is True
    assert res["folder_name"] == folder
    assert res["title"] == "Minu Teos"
    assert (folder_path / "pg1.txt").exists()
    assert (folder_path / "pg1.json").exists()
    assert (folder_path / "_metadata.json").exists()
    # JPG liigutatud prügikastist tagasi
    assert (folder_path / "pg1.jpg").exists()
    assert not (trash_work / "pg1.jpg").exists()
    # Prügikasti kaust koristatud
    assert not trash_work.exists()
    # Cache uuendatud
    assert trash_ops.WORK_ID_CACHE[work_id] == str(folder_path)
    # Taastamise commit olemas
    log = repo.git.log("--oneline")
    assert "Taasta teos: Minu Teos" in log


def test_restore_deleted_work_git_commit_missing(trash_repo):
    """Prügikastis on kaust, aga gitis puudub kustutamise commit → ok:False."""
    trash_root = trash_repo["trash_root"]
    work_id = "no_commit_id"
    (trash_root / work_id).mkdir(parents=True)
    (trash_root / work_id / "pg1.jpg").write_bytes(b"\xff\xd8")

    res = trash_ops.restore_deleted_work(work_id)
    assert res["ok"] is False
    assert "Git kustutamise commiti ei leitud" in res["error"]


def test_restore_deleted_page_full_flow(trash_repo):
    """Kustutatud leht taastub: git checkout taastab txt/json, JPG tagasi, commit."""
    repo = trash_repo["repo"]
    base_dir = trash_repo["base_dir"]
    trash_root = trash_repo["trash_root"]
    work_id = "page_w1"
    folder = "1690-w1"
    folder_path = base_dir / folder

    # 1. Loo teos kahe lehega (pg2 jääb puutumata, et kaust püsiks)
    folder_path.mkdir()
    for pn in ("pg1", "pg2"):
        (folder_path / f"{pn}.txt").write_text(f"{pn}-sisu", encoding="utf-8")
        (folder_path / f"{pn}.json").write_text("{}", encoding="utf-8")
        (folder_path / f"{pn}.jpg").write_bytes(b"\xff\xd8jpg")
    repo.index.add([
        f"{folder}/pg1.txt", f"{folder}/pg1.json",
        f"{folder}/pg2.txt", f"{folder}/pg2.json",
    ])
    repo.index.commit("init")

    # 2. Liiguta pg1 pilt prügikasti pages alla
    trash_pages = trash_root / work_id / "pages"
    trash_pages.mkdir(parents=True)
    import shutil
    shutil.move(str(folder_path / "pg1.jpg"), str(trash_pages / "pg1.jpg"))

    # 3. git rm pg1 + kustutamise commit (sõnum sisaldab folder/base, nagu trash otsib)
    repo.git.rm(f"{folder}/pg1.txt", f"{folder}/pg1.json")
    actor = Actor("kustutaja", "k@vutt.local")
    repo.index.commit(f"Kustuta leht: {folder}/pg1 [{work_id}]", author=actor, committer=actor)

    # 4. Taasta
    res = trash_ops.restore_deleted_page(work_id, folder, "pg1.jpg", username="taastaja")

    # 5. Kontrolli
    assert res["ok"] is True
    assert (folder_path / "pg1.txt").exists()
    assert (folder_path / "pg1.json").exists()
    assert (folder_path / "pg1.jpg").exists()  # tagasi prügikastist
    # pg2 puutumata
    assert (folder_path / "pg2.txt").exists()
    assert (folder_path / "pg2.jpg").exists()
    assert not (trash_pages / "pg1.jpg").exists()
    log = repo.git.log("--oneline")
    assert "Taasta leht:" in log


def test_list_deleted_works_ristviitab_gitiga(trash_repo):
    """list_deleted_works leiab prügikastis teose ja ristviitab kustutamise commidiga."""
    repo = trash_repo["repo"]
    base_dir = trash_repo["base_dir"]
    trash_root = trash_repo["trash_root"]
    work_id = "list_w1"
    folder = "1690-w1"
    folder_path = base_dir / folder

    folder_path.mkdir()
    (folder_path / "pg1.txt").write_text("x", encoding="utf-8")
    repo.index.add([f"{folder}/pg1.txt"])
    repo.index.commit("init")

    trash_work = trash_root / work_id
    trash_work.mkdir(parents=True)
    (trash_work / "pg1.jpg").write_bytes(b"\xff\xd8")
    (trash_work / "pg2.jpg").write_bytes(b"\xff\xd8")

    repo.git.rm(f"{folder}/pg1.txt")
    actor = Actor("kustutaja", "k@vutt.local")
    repo.index.commit(f"Kustuta teos: List Teos [{work_id}]", author=actor, committer=actor)

    works = trash_ops.list_deleted_works()
    assert len(works) == 1
    item = works[0]
    assert item["work_id"] == work_id
    assert item["title"] == "List Teos"
    assert item["jpg_count"] == 2
    assert item["commit_hash"] is not None
    assert item["deleted_by"] == "kustutaja"
