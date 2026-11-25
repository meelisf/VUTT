"""Aluse vahetuse konksud asenduses ja lõpetamine (PR 2, ADR 0089 p 6)."""
import io
import json
import os
import shutil
from pathlib import Path

import pytest
from fastapi import HTTPException
from PIL import Image

from server import exemplar_images as ei, promote, replace_marker, upload_ops, work_exemplars as we
from server.upload import replace_recovery
from test_asendus_taaste import _edukas_asendus_seadistus, _state
from test_replace_work_content import _KirjutavSftp

STEM = "vana-teos_pg_001"


def _jpeg() -> bytes:
    b = io.BytesIO()
    Image.new("RGB", (8, 8), (7, 7, 7)).save(b, "JPEG")
    return b.getvalue()


def _kirjuta_state(upload_id, s):
    (Path(upload_ops.UPLOADS_DIR) / upload_id / "state.json").write_text(json.dumps(s), encoding="utf-8")


class _JpgSftp(_KirjutavSftp):
    """Uus leht kehtiva JPEG-iga (vana leht peab saama eksemplaripildiks)."""

    def get(self, remote, local):
        self.get_calls.append((remote, local))
        if local.endswith(".txt"):
            Path(local).write_text("uus tekst", encoding="utf-8")
        else:
            Image.new("RGB", (8, 8), (1, 1, 1)).save(local, "JPEG")


def _seadista(tmp_path, monkeypatch, *, n_images=1, page_map=None, origins=None, lisa_meta=None):
    upload_id, work_id, slug, work_dir, data_dir, repo = _edukas_asendus_seadistus(tmp_path, monkeypatch)
    # Metaandmete/manifesti commit'id (save_with_git, native `git commit` cwd=BASE_DIR) samasse repoosse.
    import server.git_ops as git_ops
    from server import config
    monkeypatch.setattr(git_ops, "BASE_DIR", str(data_dir))
    monkeypatch.setattr(config, "BASE_DIR", str(data_dir))
    monkeypatch.setattr(upload_ops, "_sftp_open",
                        lambda _u: _JpgSftp(["uus-teos_pg_001.jpg", "uus-teos_pg_001.txt"]))
    Image.new("RGB", (8, 8), (9, 9, 9)).save(str(work_dir / f"{STEM}.jpg"), "JPEG")
    meta = json.loads((work_dir / "_metadata.json").read_text(encoding="utf-8"))
    meta["exemplars"] = [{"id": "tttttt", "holder": "TÜR", "text_witness": True},
                         {"id": "nnnnnn", "holder": "TÜR"}]
    meta.update(lisa_meta or {})
    (work_dir / "_metadata.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    repo.git.add("-A", "--", slug)
    repo.index.commit("Eksemplarid")
    m = ei.add_uploads(str(work_dir), "nnnnnn", [(_jpeg(), {"kind": "photo"}) for _ in range(n_images)], "t")
    ids = [i["id"] for i in m["images"]]
    s = _state(upload_id)
    s["replace_work_id"] = work_id
    s["meta"]["work_sets"] = ["k1"]
    s["prepress"] = {"page_map": page_map if page_map is not None else {str(n): [n] for n in range(1, n_images + 1)}}
    s["promote"] = {"exemplar_id": "nnnnnn", "holder": "TÜR", "shelfmark": None,
                    "source_images": [{"page": n, "image_id": iid} for n, iid in enumerate(ids, 1)],
                    "origins": origins or {STEM: "tttttt"}, "unknown_target": None,
                    "confirmed_edited": {}, "requested_by": "adm", "at": "2026-11-26T00:00:00+00:00"}
    _kirjuta_state(upload_id, s)
    return dict(upload_id=upload_id, work_id=work_id, slug=slug, work_dir=work_dir, data_dir=data_dir,
                repo=repo, ids=ids)


def _asenda(t):
    return upload_ops.replace_work_content(t["upload_id"], t["work_id"], {}, "admin", background_tasks=None)


def _meta(t):
    return json.loads((t["work_dir"] / "_metadata.json").read_text(encoding="utf-8"))


def _images(t, eid):
    return ei.read_manifest(str(t["work_dir"]), eid)["images"]


def test_vanad_lehed_paritolu_eksemplari_alla(tmp_path, monkeypatch):
    t = _seadista(tmp_path, monkeypatch)
    _asenda(t)
    imgs = _images(t, "tttttt")
    assert len(imgs) == 1
    src = imgs[0]["source"]
    assert src["kind"] == "former_pages" and src["stem"] == STEM and src["page"] == 1
    assert src["upload_id"] == t["upload_id"]
    assert replace_marker.read_marker(t["slug"]) is None


def test_tunnistaja_vahetub_taepselt_uks(tmp_path, monkeypatch):
    t = _seadista(tmp_path, monkeypatch)
    _asenda(t)
    ex = {x["id"]: x for x in _meta(t)["exemplars"]}
    assert ex["nnnnnn"].get("text_witness") is True and not ex["tttttt"].get("text_witness")
    assert not ex["nnnnnn"].get("needs_review")


def test_valja_jaetud_lahtepilt_jaab(tmp_path, monkeypatch):
    t = _seadista(tmp_path, monkeypatch, n_images=2, page_map={"1": [1], "2": []})
    _asenda(t)
    assert [i["id"] for i in _images(t, "nnnnnn")] == [t["ids"][1]]


def test_metaandmed_ja_tookollektsioonid_muutumata(tmp_path, monkeypatch):
    kutsed = []
    from server import work_sets_ops
    monkeypatch.setattr(work_sets_ops, "add_work_to_sets", lambda *a, **k: kutsed.append(a))
    t = _seadista(tmp_path, monkeypatch)
    _asenda(t)
    assert _meta(t)["title"] == "Vana" and kutsed == []


def test_toimetatud_leht_ocr_ajal_409_enne_muutusi(tmp_path, monkeypatch):
    t = _seadista(tmp_path, monkeypatch)
    (t["work_dir"] / f"{STEM}.json").write_text(json.dumps({"status": "Töös"}), encoding="utf-8")
    with pytest.raises(HTTPException) as e:
        _asenda(t)
    assert e.value.status_code == 409 and e.value.detail["code"] == "edited_pages_changed"
    assert (t["work_dir"] / f"{STEM}.txt").read_text(encoding="utf-8") == "vana tekst"
    assert replace_marker.read_marker(t["slug"]) is None


def test_valitud_siht_kustutati_ocr_ajal_409(tmp_path, monkeypatch):
    t = _seadista(tmp_path, monkeypatch, origins={STEM: "xxxxxx"})
    with pytest.raises(HTTPException) as e:
        _asenda(t)
    assert e.value.status_code == 409 and e.value.detail["code"] == "target_missing"
    assert replace_marker.read_marker(t["slug"]) is None


def test_salvestamatu_vana_leht_ocr_ajal_409(tmp_path, monkeypatch):
    t = _seadista(tmp_path, monkeypatch)
    Image.new("RGB", (12001, 4)).save(str(t["work_dir"] / f"{STEM}.jpg"), "JPEG")
    with pytest.raises(HTTPException) as e:
        _asenda(t)
    assert e.value.detail["code"] == "old_page_unstorable"


def test_lopetamise_kordus_ei_dubleeri(tmp_path, monkeypatch):
    t = _seadista(tmp_path, monkeypatch)
    real = ei.remove_images_internal
    kord = {"n": 0}

    def katkine(*a, **k):
        kord["n"] += 1
        if kord["n"] <= 2:          # põhivoog + kohene taaste kukuvad
            raise ei.ExemplarImagesError("ketas", 500)
        return real(*a, **k)

    monkeypatch.setattr(ei, "remove_images_internal", katkine)
    with pytest.raises(HTTPException):
        _asenda(t)
    m = replace_marker.read_marker(t["slug"])
    assert m and m["progress"]["phase"] == "replaced"
    assert replace_recovery.recover(t["upload_id"], t["slug"]) == "replaced"
    assert len(_images(t, "tttttt")) == 1
    assert _images(t, "nnnnnn") == []


def test_tunnistaja_commit_torge_jatab_margi(tmp_path, monkeypatch):
    t = _seadista(tmp_path, monkeypatch)
    monkeypatch.setattr(we, "_bulk", lambda *a, **k: (_ for _ in ()).throw(we.ExemplarError("commit", 500)))
    with pytest.raises(HTTPException):
        _asenda(t)
    assert replace_marker.read_marker(t["slug"])["progress"]["phase"] == "replaced"


def test_paritolu_nullimise_torge_jatab_margi(tmp_path, monkeypatch):
    t = _seadista(tmp_path, monkeypatch)
    monkeypatch.setattr(we, "reset_page_origins", lambda *a, **k: False)
    with pytest.raises(HTTPException):
        _asenda(t)
    assert replace_marker.read_marker(t["slug"]) is not None


def test_pisipildid_ja_eri_laiendid(tmp_path, monkeypatch):
    t = _seadista(tmp_path, monkeypatch)
    wd = t["work_dir"]
    Image.new("RGB", (8, 8)).save(str(wd / "vana-teos_pg_002.PNG"), "PNG")
    (wd / "vana-teos_pg_002.txt").write_text("teine", encoding="utf-8")
    Image.new("RGB", (4, 4)).save(str(wd / "_thumb_vana-teos_pg_001.jpg"), "JPEG")
    s = _state(t["upload_id"])
    s["promote"]["origins"]["vana-teos_pg_002"] = "tttttt"
    _kirjuta_state(t["upload_id"], s)
    _asenda(t)
    stems = sorted(i["source"]["stem"] for i in _images(t, "tttttt"))
    assert stems == [STEM, "vana-teos_pg_002"]


def test_lopetamine_ainult_margist(tmp_path, monkeypatch):
    """Üleslaadimise kaust kadus pärast commit'i → lõpetamine teose järgi märgist."""
    t = _seadista(tmp_path, monkeypatch)
    kord = {"n": 0}
    real = ei.add_internal

    def katkine(*a, **k):
        kord["n"] += 1
        if kord["n"] <= 2:
            raise ei.ExemplarImagesError("ketas", 500)
        return real(*a, **k)

    monkeypatch.setattr(ei, "add_internal", katkine)
    with pytest.raises(HTTPException):
        _asenda(t)
    shutil.rmtree(Path(upload_ops.UPLOADS_DIR) / t["upload_id"])
    assert replace_recovery.finish_for_work(str(t["work_dir"]), t["upload_id"]) == "replaced"
    assert len(_images(t, "tttttt")) == 1


def test_finish_aegunud_upload_id_409(tmp_path, monkeypatch):
    t = _seadista(tmp_path, monkeypatch)
    replace_marker.write_marker(t["slug"], "teine", {"phase": "replacing"})
    assert replace_recovery.finish_for_work(str(t["work_dir"]), t["upload_id"]) == "stale"
    assert replace_marker.read_marker(t["slug"])["upload_id"] == "teine"


def test_finish_tagastab_restored_eraldi(tmp_path, monkeypatch):
    t = _seadista(tmp_path, monkeypatch)
    trash = tmp_path / "t"
    trash.mkdir()
    replace_marker.write_marker(t["slug"], t["upload_id"], {
        "phase": "replacing", "old_head": t["repo"].head.commit.hexsha, "trash_dir": str(trash),
        "old_files": [], "new_files": []})
    assert replace_recovery.finish_for_work(str(t["work_dir"]), t["upload_id"]) == "restored"


def test_confirm_parast_409_ja_kordus_onnestub(tmp_path, monkeypatch):
    t = _seadista(tmp_path, monkeypatch)
    (t["work_dir"] / f"{STEM}.json").write_text(json.dumps({"status": "Töös"}), encoding="utf-8")
    with pytest.raises(HTTPException) as e:
        _asenda(t)
    pv = e.value.detail["detail"]
    promote.confirm(t["upload_id"], unknown_target=None, confirmed_edited=pv["edited"])
    _asenda(t)
    assert len(_images(t, "tttttt")) == 1


def test_eksemplari_kustutus_vahetuse_ajal_409(tmp_path, monkeypatch):
    t = _seadista(tmp_path, monkeypatch)
    replace_marker.write_marker(t["slug"], t["upload_id"], {"phase": "replacing"})
    monkeypatch.setattr(replace_marker, "BASE_DIR", str(t["data_dir"]))
    with pytest.raises(replace_marker.WorkReplacingError):
        we.delete_exemplar(str(t["work_dir"]), "tttttt", "adm")


def test_tagasivahetus(tmp_path, monkeypatch):
    """A → B, siis B → A: teine vahetus kasutab esimese `former_pages` pilte."""
    t = _seadista(tmp_path, monkeypatch)
    _asenda(t)
    t_ids = [i["id"] for i in _images(t, "tttttt")]
    uus = "upl777"
    shutil.copytree(Path(upload_ops.UPLOADS_DIR) / t["upload_id"], Path(upload_ops.UPLOADS_DIR) / uus)
    s = _state(uus)
    s.update({"id": uus, "status": "reviewing"})
    s.pop("replace_progress", None)
    pages = promote.page_list(str(t["work_dir"]))
    s["promote"].update({"exemplar_id": "tttttt",
                         "source_images": [{"page": 1, "image_id": t_ids[0]}],
                         "origins": {p["stem"]: "nnnnnn" for p in pages}})
    _kirjuta_state(uus, s)
    upload_ops.replace_work_content(uus, t["work_id"], {}, "admin", background_tasks=None)
    ex = {x["id"]: x for x in _meta(t)["exemplars"]}
    assert ex["tttttt"].get("text_witness") is True
    assert [i["source"]["kind"] for i in _images(t, "nnnnnn")] == ["former_pages"]


def test_exemplars_vastus_kannab_replace_pending(tmp_path, monkeypatch):
    from server.routers import work_exemplars as r
    t = _seadista(tmp_path, monkeypatch)
    replace_marker.write_marker(t["slug"], t["upload_id"], {"phase": "replaced"})
    view = r._exemplars_view(t["work_id"], str(t["work_dir"]), _meta(t), None)
    assert view["replace_pending"] == {"upload_id": t["upload_id"], "phase": "replaced"}


def test_uploads_loend_naitab_orvu_margi(tmp_path, monkeypatch):
    t = _seadista(tmp_path, monkeypatch)
    replace_marker.write_marker("muu-teos", "kadunud1", {"phase": "replaced"})
    orvud = [u for u in upload_ops.list_uploads() if u.get("orphan")]
    assert [(u["id"], u["slug"]) for u in orvud] == [("kadunud1", "muu-teos")]


def test_tuhistus_votab_teose_luku(client, login, tmp_path, monkeypatch):
    t = _seadista(tmp_path, monkeypatch)
    from server.routers import upload as r
    lukud = []
    import server.admin_page_ops as apo
    real = apo.work_lock

    def jalgiv(work_id, work_dir):
        lukud.append(os.path.basename(work_dir))
        return real(work_id, work_dir)

    monkeypatch.setattr(apo, "work_lock", jalgiv)
    monkeypatch.setattr(upload_ops, "BASE_DIR", str(t["data_dir"]))
    import server.utils as utils
    monkeypatch.setattr(utils, "find_directory_by_id", lambda wid: str(t["work_dir"]) if wid == t["work_id"] else None)
    replace_marker.write_marker(t["slug"], t["upload_id"], {"phase": "replacing"})
    token = login("admin", "adminpass")
    res = client.delete(f"/admin/upload/{t['upload_id']}", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 409
    assert t["slug"] in lukud


def test_confirm_kontrollib_teose_kirjutusoigust(tmp_path, monkeypatch):
    """ADR 0031: admini roll üksi ei anna kirjutusõigust — confirm kontrollib sihtteost."""
    from server.routers import work_exemplars as r
    t = _seadista(tmp_path, monkeypatch)
    nähtud = []

    def keela(work_id, user):
        nähtud.append(work_id)
        raise HTTPException(status_code=403, detail="ei")

    monkeypatch.setattr(r, "_writable", keela)
    kutsutud = []
    monkeypatch.setattr(promote, "confirm", lambda *a, **k: kutsutud.append(a))
    with pytest.raises(HTTPException) as e:
        r.promote_confirm(t["upload_id"], {"unknown_target": None, "confirmed_edited": {}}, {"role": "admin"})
    assert e.value.status_code == 403 and nähtud == [t["work_id"]] and kutsutud == []
