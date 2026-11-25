"""Lehe põlvkond (ADR 0089 p 4): aegunud redaktor ei kirjuta asendatud lehte üle.

Uued lehed saavad asendusel samad tüved kui vanad. Vana lehe pealt avatud redaktori
salvestus liideti kolmesuunaliselt (ADR 0054) uue OCR-i peale. Asendus kirjutab iga
uue lehe JSON-i `content_generation`-i; redaktor saab selle Meili lehedokumendist ja
saadab `/save` payloadi tipptasemel. Erinev → 409 „laadi leht uuesti".
"""
import json

import pytest
from fastapi import HTTPException
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
    (folder / "pg1.txt").write_text("uus OCR", encoding="utf-8")
    (folder / "pg1.json").write_text(json.dumps({
        "status": "Toores", "sequence": 100, "work_id": "work1", "content_generation": "u2",
    }), encoding="utf-8")
    (folder / "pg2.txt").write_text("asendamata", encoding="utf-8")
    (folder / "pg2.json").write_text(json.dumps({"status": "Toores", "sequence": 200}), encoding="utf-8")
    r.index.add([f"1690-w1/{n}" for n in ("pg1.txt", "pg1.json", "pg2.txt", "pg2.json", "_metadata.json")])
    r.index.commit("v1")
    monkeypatch.setattr(git_ops, "BASE_DIR", str(data_dir))
    monkeypatch.setattr(git_ops, "get_or_init_repo", lambda: r)
    monkeypatch.setattr(editing, "BASE_DIR", str(data_dir))
    monkeypatch.setattr(editing, "sync_work_to_meilisearch_async", lambda *a, **k: None)
    monkeypatch.setattr(editing, "update_page_person_mentions", lambda *a, **k: None)
    return folder


_PUUDUB = object()


def _save(client, login, *, file="pg1.txt", text="minu muudatus", generation=_PUUDUB):
    token = login("editor", "editorpass")
    body = {
        "original_path": "1690-w1", "file_name": file, "text_content": text,
        "meta_content": {"status": "Töös", "work_id": "work1", "page_tags": [], "text_annotations": [],
                         "comments": [], "updated_at": "2026-11-25T10:00:00"},
    }
    if generation is not _PUUDUB:
        body["content_generation"] = generation
    return client.post("/save", json=body, headers={"Authorization": f"Bearer {token}"})


def test_aegunud_klient_saab_409(client, login, leht):
    r = _save(client, login, generation=None)   # laadis lehe enne asendust
    assert r.status_code == 409
    assert "laadi leht uuesti" in r.json()["detail"]
    assert (leht / "pg1.txt").read_text(encoding="utf-8") == "uus OCR"


def test_sama_polvkond_salvestub(client, login, leht):
    r = _save(client, login, generation="u2")
    assert r.status_code == 200
    assert (leht / "pg1.txt").read_text(encoding="utf-8") == "minu muudatus"


def test_asendamata_leht_salvestub_nagu_enne(client, login, leht):
    r = _save(client, login, file="pg2.txt", generation=None)
    assert r.status_code == 200


def test_vana_bundle_ilma_votmeta_nagu_enne(client, login, leht):
    """Vana JS-kimp ei saada võtit → võrdlust ei tehta."""
    assert _save(client, login, generation=_PUUDUB).status_code == 200


def test_klient_ei_saa_polvkonda_kustutada(client, login, leht):
    assert _save(client, login, generation="u2").status_code == 200
    assert json.loads((leht / "pg1.json").read_text(encoding="utf-8"))["content_generation"] == "u2"


def test_olemasolu_kontroll_luku_sees(leht):
    """Leht kadus enne luku võtmist (asendus) → 404 leheluku sees, mitte uue faili kirjutus."""
    txt = leht / "pgX.txt"
    with pytest.raises(HTTPException) as exc:
        editing._save_page_locked(str(txt), "tekst", {"status": "Töös"}, "u")
    assert exc.value.status_code == 404
    assert not txt.exists()


def test_meili_doc_kannab_polvkonda(leht):
    from server import meili_doc
    (leht / "pg1.jpg").write_bytes(b"x")
    (leht / "pg2.jpg").write_bytes(b"x")
    _, docs = meili_doc.build_work_documents(str(leht), leht.name, {}, {}, {}, {})
    gens = {d.get("lehekylje_pilt", "").split("/")[-1]: d.get("content_generation") for d in docs}
    assert gens.get("pg1.jpg") == "u2"
    assert gens.get("pg2.jpg") is None


def test_asendus_kirjutab_polvkonna(tmp_path, monkeypatch):
    from server import upload_ops
    from test_asendus_taaste import _edukas_asendus_seadistus
    upload_id, work_id, _slug, work_dir, _dd, _repo = _edukas_asendus_seadistus(tmp_path, monkeypatch)
    upload_ops.replace_work_content(upload_id, work_id, {}, "admin", background_tasks=None)
    jsons = [p for p in work_dir.glob("*.json") if p.name != "_metadata.json"]
    assert jsons and all(json.loads(p.read_text(encoding="utf-8"))["content_generation"] == upload_id
                         for p in jsons)
