"""Aluse vahetuse eelvaade (PR 2, ADR 0089 p 6): sõrmejäljed, päritolu, toimetatud lehed."""
import io
import json

import pytest
from PIL import Image

from server import exemplar_images, promote


def _jpeg(w=8, h=8) -> bytes:
    b = io.BytesIO()
    Image.new("RGB", (w, h), (9, 9, 9)).save(b, "JPEG")
    return b.getvalue()


@pytest.fixture
def teos(exemplar_work):
    """Kolm lehte; eksemplarid: tunnistaja T (leht 1), erand E (leht 2), uus alus N (pildiga);
    leht 3 teadmata päritoluga."""
    from PIL import Image as I
    wd = exemplar_work["work_dir"]
    for n in (2, 3):
        stem = f"1640-test-w1-00{n}"
        I.new("RGB", (8, 8)).save(f"{wd}/{stem}.jpg", "JPEG")
        open(f"{wd}/{stem}.txt", "w", encoding="utf-8").write(f"tekst {n}")
        open(f"{wd}/{stem}.json", "w", encoding="utf-8").write(json.dumps({"status": "Toores"}))
    meta = json.load(open(exemplar_work["meta_path"], encoding="utf-8"))
    meta["exemplars"] = [
        {"id": "tttttt", "holder": "TÜR", "text_witness": True},
        {"id": "eeeeee", "holder": "TÜR", "pages": ["1640-test-w1-002"]},
        {"id": "nnnnnn", "holder": "TÜR"},
    ]
    meta["exemplar_unknown_pages"] = ["1640-test-w1-003"]
    json.dump(meta, open(exemplar_work["meta_path"], "w", encoding="utf-8"), ensure_ascii=False)
    exemplar_images.add_uploads(wd, "nnnnnn", [(_jpeg(), {"kind": "photo"})], "t")
    return exemplar_work


def test_sormejalg_muutub_kommentaariga(teos):
    wd = teos["work_dir"]
    stem = "1640-test-w1-001"
    enne = promote.page_fingerprint(wd, stem)
    j = json.load(open(f"{wd}/{stem}.json"))
    j["comments"] = [{"id": "c1", "text": "?"}]
    json.dump(j, open(f"{wd}/{stem}.json", "w"))
    assert promote.page_fingerprint(wd, stem) != enne


def test_toores_leht_ei_ole_toimetatud():
    assert promote.is_edited({"status": "Toores", "page_tags": [], "comments": [], "text_annotations": []}) is False
    assert promote.is_edited({"status": "Töös", "page_tags": [], "comments": [], "text_annotations": []}) is True


def test_toores_leht_markusonaga_on_toimetatud(teos):
    wd = teos["work_dir"]
    stem = "1640-test-w1-001"
    json.dump({"meta_content": {"status": "Toores", "tags": ["Q5"]}}, open(f"{wd}/{stem}.json", "w"))
    pv = promote.preview(wd, "nnnnnn")
    assert stem in pv["edited"]


def test_eelvaade_paritolu(teos):
    pv = promote.preview(teos["work_dir"], "nnnnnn")
    org = {p["stem"]: p["origin"] for p in pv["pages"]}
    assert org == {"1640-test-w1-001": "tttttt", "1640-test-w1-002": "eeeeee", "1640-test-w1-003": None}
    assert pv["unknown"] == ["1640-test-w1-003"]
    assert pv["images"] == 1 and pv["witness"] == "tttttt"
    assert [p["page"] for p in pv["pages"]] == [1, 2, 3]


def test_eelvaade_tunnistajale_409(teos):
    with pytest.raises(promote.PromoteError) as e:
        promote.preview(teos["work_dir"], "tttttt")
    assert e.value.status == 409 and e.value.code == "is_witness"


def test_eelvaade_piltideta_409(teos):
    with pytest.raises(promote.PromoteError) as e:
        promote.preview(teos["work_dir"], "eeeeee")
    assert e.value.status == 409 and e.value.code == "no_images"


def test_eelvaade_naitab_salvestamatut_vana_lehte(teos):
    wd = teos["work_dir"]
    Image.new("RGB", (12001, 4)).save(f"{wd}/1640-test-w1-003.jpg", "JPEG")
    pv = promote.preview(wd, "nnnnnn")
    assert [u["stem"] for u in pv["unstorable"]] == ["1640-test-w1-003"]


def test_eelvaate_otspunkt(client, login, teos, monkeypatch):
    from server.routers import work_exemplars as r
    monkeypatch.setattr(r, "find_directory_by_id", lambda wid: teos["work_dir"] if wid == "w1" else None)
    monkeypatch.setattr(r, "load_work_metadata_by_id",
                        lambda wid: json.load(open(teos["meta_path"], encoding="utf-8")) if wid == "w1" else None)
    token = login("admin", "adminpass")
    res = client.get("/admin/work/w1/exemplars/nnnnnn/promote/preview", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200, res.text
    assert res.json()["witness"] == "tttttt"
