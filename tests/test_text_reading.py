# tests/test_text_reading.py
import json
import os


def _make_work(tmp_path):
    d = tmp_path / "w"
    d.mkdir()
    return d


def test_enumerate_orders_by_sequence(tmp_path):
    from server.meili_doc import enumerate_page_images
    d = _make_work(tmp_path)
    # Kaks pilti, sequence tagurpidi failinime suhtes
    (d / "b.jpg").write_bytes(b"x")
    (d / "b.json").write_text(json.dumps({"sequence": 1}), encoding="utf-8")
    (d / "a.jpg").write_bytes(b"x")
    (d / "a.json").write_text(json.dumps({"sequence": 2}), encoding="utf-8")
    (d / "_thumb_a.jpg").write_bytes(b"x")  # peab välja jääma
    result = enumerate_page_images(str(d))
    assert result == ["b.jpg", "a.jpg"]


def test_read_work_page_texts_txt_authoritative(tmp_path):
    from server.text_reading import read_work_page_texts
    d = _make_work(tmp_path)
    (d / "a.jpg").write_bytes(b"x")
    (d / "a.json").write_text(json.dumps({"sequence": 1, "text_content": "JSON"}), encoding="utf-8")
    (d / "a.txt").write_text("TXT tekst", encoding="utf-8")
    (d / "b.jpg").write_bytes(b"x")
    (d / "b.json").write_text(json.dumps({"sequence": 2, "text_content": "ainult JSON"}), encoding="utf-8")
    pages = read_work_page_texts(str(d))
    assert pages == [(1, "TXT tekst"), (2, "ainult JSON")]


def test_page_num_uses_sequence_not_position(tmp_path):
    """data-page = päris sequence (nt fooliod 5,6), mitte 1,2 järjekorra-positsioon."""
    from server.text_reading import read_work_page_texts
    d = _make_work(tmp_path)
    (d / "a.jpg").write_bytes(b"x")
    (d / "a.json").write_text(json.dumps({"sequence": 5, "text_content": "A"}), encoding="utf-8")
    (d / "a.txt").write_text("esimene", encoding="utf-8")
    (d / "b.jpg").write_bytes(b"x")
    (d / "b.json").write_text(json.dumps({"sequence": 6, "text_content": "B"}), encoding="utf-8")
    (d / "b.txt").write_text("teine", encoding="utf-8")
    pages = read_work_page_texts(str(d))
    assert pages == [(5, "esimene"), (6, "teine")]


def test_page_num_falls_back_to_position(tmp_path):
    """Sequence puudub → page_num = idx+1."""
    from server.text_reading import read_work_page_texts
    d = _make_work(tmp_path)
    (d / "a.jpg").write_bytes(b"x")
    (d / "a.txt").write_text("tekst", encoding="utf-8")
    pages = read_work_page_texts(str(d))
    assert pages == [(1, "tekst")]


def test_work_latest_mtime_tracks_page_edit(tmp_path):
    from server.text_reading import work_latest_mtime
    d = _make_work(tmp_path)
    (d / "_metadata.json").write_text("{}", encoding="utf-8")
    (d / "a.jpg").write_bytes(b"x")
    txt = d / "a.txt"
    txt.write_text("v1", encoding="utf-8")
    k1 = work_latest_mtime(str(d))
    os.utime(str(txt), (k1 + 10, k1 + 10))  # simuleeri hilisemat muudatust
    k2 = work_latest_mtime(str(d))
    assert k2 > k1
