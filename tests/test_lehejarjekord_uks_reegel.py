"""Lehejärjekord on ÜKS reegel (N19-07): indekseerija, teose haldus ja git-ajalugu ei lahkne."""
import json

from server import admin_page_ops, git_ops, meili_doc


def _leht(folder, stem, seq=None):
    (folder / f"{stem}.jpg").write_bytes(b"x")
    body = {} if seq is None else {"sequence": seq}
    (folder / f"{stem}.json").write_text(json.dumps(body))


def test_osalise_sequencega_teos_sama_jarjekord_koigis_teedes(tmp_path):
    # b on nummerdamata → lõppu (indekseerija reegel, seed/live pariteet).
    _leht(tmp_path, "a", 100)
    _leht(tmp_path, "b")
    _leht(tmp_path, "c", 300)
    _leht(tmp_path, "d", 50)
    oodatud = ["d.jpg", "a.jpg", "c.jpg", "b.jpg"]
    assert meili_doc.enumerate_page_images(str(tmp_path)) == oodatud
    assert admin_page_ops.get_sorted_images(str(tmp_path)) == oodatud
    assert git_ops._build_images_list(str(tmp_path)) == oodatud


def test_sequence_null_ja_meta_content(tmp_path):
    (tmp_path / "x.json").write_text(json.dumps({"sequence": 0}))
    (tmp_path / "y.json").write_text(json.dumps({"meta_content": {"sequence": 7}}))
    (tmp_path / "z.json").write_text("{katki")
    assert meili_doc.page_sequence(str(tmp_path / "x.json")) == 0
    assert meili_doc.page_sequence(str(tmp_path / "y.json")) == 7
    assert meili_doc.page_sequence(str(tmp_path / "z.json")) is None
    assert meili_doc.page_sequence(str(tmp_path / "puudub.json")) is None
