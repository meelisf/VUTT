"""#455: /save liidab kliendi baasseisu vastu (ADR 0054)."""
import json

import pytest
from git import Repo

from server.routers import editing


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
    txt = folder / "pg1.txt"
    jp = folder / "pg1.json"
    txt.write_text("vana tekst", encoding="utf-8")
    jp.write_text(json.dumps({
        "status": "Toores", "sequence": 7, "work_id": "work1",
        "comments": [{"id": "c1", "text": "küsimus", "author": "u", "replies": []}],
    }, indent=2), encoding="utf-8")
    r.index.add(["1690-w1/pg1.txt", "1690-w1/pg1.json", "1690-w1/_metadata.json"])
    r.index.commit("v1")

    monkeypatch.setattr(git_ops, "BASE_DIR", str(data_dir))
    monkeypatch.setattr(git_ops, "get_or_init_repo", lambda: r)
    monkeypatch.setattr(editing, "BASE_DIR", str(data_dir))
    monkeypatch.setattr(editing, "sync_work_to_meilisearch_async", lambda *a, **k: None)
    monkeypatch.setattr(editing, "update_page_person_mentions", lambda *a, **k: None)
    return {"txt": txt, "jp": jp}


BASE = {
    "text_content": "vana tekst", "status": "Toores", "page_tags": [],
    "comments": [{"id": "c1", "text": "küsimus", "author": "u", "replies": []}],
    "text_annotations": [],
}


def _lisa_vastus_kettale(leht):
    """Keegi teine vastas vahepeal (nagu /page-comments/reply)."""
    j = json.loads(leht["jp"].read_text(encoding="utf-8"))
    j["comments"][0]["replies"] = [{"id": "r1", "text": "vastus"}]
    leht["jp"].write_text(json.dumps(j, indent=2), encoding="utf-8")


def _save(client, login, *, text, base=None, status="Toores", comments=None):
    token = login("editor", "editorpass")
    body = {
        "original_path": "1690-w1", "file_name": "pg1.txt", "text_content": text,
        "meta_content": {
            "status": status, "work_id": "work1", "page_tags": [], "text_annotations": [],
            "comments": comments if comments is not None else BASE["comments"],
            "updated_at": "2026-09-26T10:00:00",
        },
    }
    if base is not None:
        body["base"] = base
    return client.post("/save", json=body, headers={"Authorization": f"Bearer {token}"})


def _ketas(leht):
    return leht["txt"].read_text(encoding="utf-8"), json.loads(leht["jp"].read_text(encoding="utf-8"))


def test_tuupjuht_tekst_ja_vahepealne_vastus_liidetakse(client, login, leht):
    _lisa_vastus_kettale(leht)
    r = _save(client, login, text="uus tekst", base=BASE)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["merged"] is True
    assert body["page"]["comments"][0]["replies"] == [{"id": "r1", "text": "vastus"}]
    txt, j = _ketas(leht)
    assert txt == "uus tekst"
    assert j["comments"][0]["replies"] == [{"id": "r1", "text": "vastus"}]
    assert j["sequence"] == 7                      # serveripoolne väli säilib


def test_sama_valja_muutus_on_409_ja_ketas_puutumata(client, login, leht):
    leht["txt"].write_text("teise inimese tekst", encoding="utf-8")
    r = _save(client, login, text="minu tekst", base=BASE)
    assert r.status_code == 409, r.text
    body = r.json()["detail"]
    assert body["conflict"] is True and body["fields"] == ["text"]
    assert body["current"]["text_content"] == "teise inimese tekst"
    assert body["text_chunks"] == [{"kind": "conflict", "base": "vana tekst",
                                    "mine": "minu tekst", "theirs": "teise inimese tekst"}]
    assert _ketas(leht)[0] == "teise inimese tekst"


def test_keegi_ei_muutnud_merged_puudub(client, login, leht):
    r = _save(client, login, text="uus tekst", base=BASE)
    assert r.status_code == 200, r.text
    assert "merged" not in r.json()
    assert _ketas(leht)[0] == "uus tekst"


def test_base_puudub_senine_kaitumine(client, login, leht):
    """Vana vahemälus bundle: base-i ei saadeta → kirjutatakse nagu varem."""
    _lisa_vastus_kettale(leht)
    r = _save(client, login, text="uus tekst")
    assert r.status_code == 200, r.text
    assert _ketas(leht)[1]["comments"][0]["replies"] == []


def test_normaliseerimata_baastekst_ei_tee_valekonflikti(client, login, leht):
    """Klient hoiab baasina SAADETUD teksti; server salvestas selle NFC-kujul."""
    import unicodedata
    nfd = unicodedata.normalize("NFD", "Käsi")
    r1 = _save(client, login, text=nfd, base=BASE)
    assert r1.status_code == 200, r1.text
    base2 = {**BASE, "text_content": nfd}
    r2 = _save(client, login, text=nfd + " ja jalg", base=base2)
    assert r2.status_code == 200, r2.text
    assert _ketas(leht)[0] == unicodedata.normalize("NFC", "Käsi ja jalg")


def test_aegunud_baas_ja_puutumata_vali_voetakse_kettalt(client, login, leht):
    """Aegunud Meili: kettal on uuem staatus, klient seda ei muutnud → jääb alles."""
    j = json.loads(leht["jp"].read_text(encoding="utf-8"))
    j["status"] = "Parandatud"
    leht["jp"].write_text(json.dumps(j, indent=2), encoding="utf-8")
    r = _save(client, login, text="uus tekst", base=BASE, status="Toores")
    assert r.status_code == 200, r.text
    assert r.json()["merged"] is True
    assert _ketas(leht)[1]["status"] == "Parandatud"


MITMEREALINE = "rida üks\nrida kaks\nrida kolm\nrida neli\n"


def test_eri_ridade_parandused_liidetakse_kettale(client, login, leht):
    """#612: kaks toimetajat, eri read → mõlemad parandused alles, 409 ei tule."""
    leht["txt"].write_text(MITMEREALINE.replace("rida neli", "rida NELI"), encoding="utf-8")
    base = {**BASE, "text_content": MITMEREALINE}
    r = _save(client, login, text=MITMEREALINE.replace("rida üks", "rida ÜKS"), base=base)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["merged"] is True
    assert body["page"]["text_content"] == "rida ÜKS\nrida kaks\nrida kolm\nrida NELI\n"
    assert _ketas(leht)[0] == "rida ÜKS\nrida kaks\nrida kolm\nrida NELI\n"


def test_sama_rea_konflikt_annab_tukid(client, login, leht):
    leht["txt"].write_text(MITMEREALINE.replace("rida kolm", "rida 3"), encoding="utf-8")
    base = {**BASE, "text_content": MITMEREALINE}
    r = _save(client, login, text=MITMEREALINE.replace("rida kolm", "rida III"), base=base)
    assert r.status_code == 409, r.text
    tükid = r.json()["detail"]["text_chunks"]
    assert [t for t in tükid if t["kind"] == "conflict"] == [
        {"kind": "conflict", "base": "rida kolm\n", "mine": "rida III\n", "theirs": "rida 3\n"}]
    # Kes viimati muutis (dialoogi jaoks): fixture'i commit „v1" autor „t".
    assert r.json()["detail"]["theirs_last"]["author"] == "t"
    assert _ketas(leht)[0] == MITMEREALINE.replace("rida kolm", "rida 3")
