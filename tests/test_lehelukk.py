"""#416: lehe JSON-i lugemine–muutmine–kirjutamine on üks toiming.

Kommentaarivastus, kommentaari taaste ja `/save` käivad sama lehe luku all.
Võistlus tehakse deterministlikuks barjääriga `save_with_git`-i ees: ilma
lukuta jõuavad mõlemad lõimed barjäärini (mõlemad on juba lugenud) ja teine
kirjutus pühib esimese. Lukuga ootab teine lõim lukul, barjäär aegub ja
kirjutused järjestuvad.
"""
import json
import os
import threading

import pytest
from git import Repo

from server import page_locks
from server.routers import editing, notifications

USER = {"username": "editor", "name": "Toimetaja", "role": "editor"}


@pytest.fixture
def leht(tmp_path, monkeypatch):
    import server.git_ops as git_ops

    data_dir = tmp_path / "data"
    folder = data_dir / "1690-w1"
    folder.mkdir(parents=True)
    r = Repo.init(str(data_dir))
    with r.config_writer() as cw:
        cw.set_value("user", "name", "t").set_value("user", "email", "t@t")

    txt = folder / "pg1.txt"
    jp = folder / "pg1.json"
    txt.write_text("lehe tekst", encoding="utf-8")
    (folder / "_metadata.json").write_text(
        json.dumps({"id": "work1", "collections": []}), encoding="utf-8"
    )
    c1 = {"id": "c1", "text": "küsimus", "author": "u", "author_username": "u",
          "created_at": "2026-01-01T00:00:00", "replies": []}
    c2 = {"id": "c2", "text": "kustutatav", "author": "u",
          "created_at": "2026-01-01T00:00:00", "replies": []}
    jp.write_text(json.dumps({"status": "Toores", "comments": [c1, c2]}, indent=2), encoding="utf-8")
    r.index.add(["1690-w1/pg1.txt", "1690-w1/pg1.json"])
    r.index.commit("v1")
    v1 = r.head.commit.hexsha
    jp.write_text(json.dumps({"status": "Toores", "comments": [c1]}, indent=2), encoding="utf-8")
    r.index.add(["1690-w1/pg1.json"])
    r.index.commit("v2 (c2 kustutatud)")

    monkeypatch.setattr(git_ops, "BASE_DIR", str(data_dir))
    monkeypatch.setattr(git_ops, "get_or_init_repo", lambda: r)
    monkeypatch.setattr(notifications, "BASE_DIR", str(data_dir))
    monkeypatch.setattr(editing, "BASE_DIR", str(data_dir))
    monkeypatch.setattr(notifications, "create_notification", lambda *a, **k: None)
    return {"repo": r, "txt": txt, "jp": jp, "v1": v1}


def _barjaar(monkeypatch, *moodulid, enne_kirjutust=None):
    """Asendab `save_with_git`-i: ootab teist kirjutajat (max 0,5 s), siis kirjutab."""
    import server.git_ops as git_ops

    barjaar = threading.Barrier(2, timeout=0.5)

    def aeglane(*a, **k):
        try:
            barjaar.wait()
        except threading.BrokenBarrierError:
            pass
        if enne_kirjutust:
            enne_kirjutust()
        return git_ops.save_with_git(*a, **k)

    for moodul in moodulid:
        monkeypatch.setattr(moodul, "save_with_git", aeglane)


def _jooksuta(*sihid):
    vead = []

    def kaitstud(f):
        try:
            f()
        except Exception as e:  # pragma: no cover - test raporteerib allpool
            vead.append(e)

    loimed = [threading.Thread(target=kaitstud, args=(f,)) for f in sihid]
    for t in loimed:
        t.start()
    for t in loimed:
        t.join(timeout=10)
    assert not vead, vead


def _vasta(tekst):
    return lambda: notifications._apply_reply_sync(
        "1690-w1", "pg1.txt", "c1", tekst, "w1", 1, USER)


def _kommentaarid(leht):
    return json.loads(leht["jp"].read_text(encoding="utf-8"))["comments"]


# ---------- lukk ise ----------

def test_sama_lehe_lukk_jarjestab_eri_lehe_oma_mitte(tmp_path):
    a = str(tmp_path / "t" / "pg1.json")
    hoitud = threading.Event()
    vabasta = threading.Event()

    def hoia():
        with page_locks.page_lock(a):
            hoitud.set()
            vabasta.wait(2)

    t = threading.Thread(target=hoia)
    t.start()
    hoitud.wait(2)
    # Sama lehe .txt ja .json on ÜKS lukk; teine leht on vaba.
    assert page_locks.page_lock_acquire_nowait(str(tmp_path / "t" / "pg1.txt")) is False
    assert page_locks.page_lock_acquire_nowait(str(tmp_path / "t" / "pg2.json")) is True
    vabasta.set()
    t.join(2)
    assert page_locks.page_lock_acquire_nowait(a) is True


# ---------- kommentaarivastus ----------

def test_kaks_samaaegset_vastust_jaavad_molemad_alles(leht, monkeypatch):
    _barjaar(monkeypatch, notifications)
    _jooksuta(_vasta("esimene"), _vasta("teine"))
    vastused = [v["text"] for v in _kommentaarid(leht)[0]["replies"]]
    assert sorted(vastused) == ["esimene", "teine"]


def test_vastus_ei_kirjuta_vahepealset_teksti_ule(leht, monkeypatch):
    """Vastus luges varem .txt-i ja kirjutas selle tagasi → vahepealne /save kadus."""
    def samaaegne_tekstisalvestus():
        leht["txt"].write_text("uus tekst", encoding="utf-8")

    _barjaar(monkeypatch, notifications, enne_kirjutust=samaaegne_tekstisalvestus)
    _vasta("vastus")()
    assert leht["txt"].read_text(encoding="utf-8") == "uus tekst"
    assert [v["text"] for v in _kommentaarid(leht)[0]["replies"]] == ["vastus"]


def test_vastus_teatab_ebaonnestunud_commitist(leht, monkeypatch):
    def katki(path, content, *a, **k):
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)
        return {"success": False, "error": "index.lock"}

    monkeypatch.setattr(notifications, "save_with_git", katki)
    tulemus = _vasta("vastus")()
    assert tulemus["git_committed"] is False
    assert tulemus["warning"]


# ---------- kommentaari taaste ----------

def test_taaste_ja_vastus_samaaegselt_jaavad_molemad_alles(leht, monkeypatch):
    _barjaar(monkeypatch, notifications, editing)

    def taasta():
        editing._restore_comment_sync(
            "1690-w1", "pg1.txt", "deleted", "c2", leht["v1"], USER)

    _jooksuta(_vasta("vastus"), taasta)
    kommentaarid = {c["id"]: c for c in _kommentaarid(leht)}
    assert set(kommentaarid) == {"c1", "c2"}
    assert [v["text"] for v in kommentaarid["c1"]["replies"]] == ["vastus"]


def test_taaste_ei_kirjuta_vahepealset_teksti_ule(leht, monkeypatch):
    def samaaegne_tekstisalvestus():
        leht["txt"].write_text("uus tekst", encoding="utf-8")

    _barjaar(monkeypatch, editing, enne_kirjutust=samaaegne_tekstisalvestus)
    editing._restore_comment_sync("1690-w1", "pg1.txt", "deleted", "c2", leht["v1"], USER)
    assert leht["txt"].read_text(encoding="utf-8") == "uus tekst"


# ---------- /save ----------

def test_save_ootab_lehe_lukku(leht, client, login):
    """/save ei tohi kirjutada, kui kommentaaritoiming hoiab sama lehe lukku."""
    token = login("editor", "editorpass")
    valmis = threading.Event()
    vastus = {}

    def salvesta():
        vastus["r"] = client.post(
            "/save",
            json={"original_path": "1690-w1", "file_name": "pg1.txt",
                  "text_content": "salvestatud tekst",
                  "meta_content": {"status": "Parandatud", "comments": []}},
            headers={"Authorization": f"Bearer {token}"},
        )
        valmis.set()

    with page_locks.page_lock(str(leht["jp"])):
        t = threading.Thread(target=salvesta)
        t.start()
        assert not valmis.wait(0.3), ("salvestus ei oodanud lehe lukku", vastus["r"].status_code, vastus["r"].text[:200])
        assert leht["txt"].read_text(encoding="utf-8") == "lehe tekst"
    t.join(10)
    assert vastus["r"].status_code == 200, vastus["r"].text
    assert leht["txt"].read_text(encoding="utf-8") == "salvestatud tekst"
