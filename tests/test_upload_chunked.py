"""Jätkatav (tükeldatud) üleslaadimine (#235, ADR 0047).

160 MB ühe päringuna: katkemine aeglasel liinil (28 min / 85 MB pealt) tähendas
nullist alustamist. Tükkidena maksab katkemine ühe tüki, ja lehe värskendamise
järel jätkub sama fail serveri teadaolevast baidist.

Tõde on KETAS (`source.part` suurus), mitte olekufaili number.
"""
import json
import os

import pytest

from server.upload import chunked
from server.upload import state as upload_state


@pytest.fixture
def upload(tmp_path, monkeypatch):
    monkeypatch.setattr(upload_state, "UPLOADS_DIR", str(tmp_path))
    uid = "up1"
    os.makedirs(tmp_path / uid)
    (tmp_path / uid / "state.json").write_text(json.dumps({"id": uid, "status": "pending"}))
    lopetatud = []
    monkeypatch.setattr(chunked, "_finalize", lambda u, path: lopetatud.append(
        (u, open(path, "rb").read())) or 7)
    return {"id": uid, "dir": tmp_path / uid, "lopetatud": lopetatud}


FP = "a" * 64


def _lisa(u, offset, data, total=10, fp=FP):
    return chunked.append_chunk(u["id"], offset=offset, total=total, fingerprint=fp,
                                name="x.pdf", data=data)


def test_tukid_jarjest_ja_lopetamine(upload):
    assert _lisa(upload, 0, b"01234") == {"received": 5, "total": 10, "complete": False}
    r = _lisa(upload, 5, b"56789")

    assert r == {"received": 10, "total": 10, "complete": True, "expected_pages": 7}
    assert upload["lopetatud"] == [("up1", b"0123456789")]
    # Pärast lõpetamist ei ole pooleliolevat faili ega kirjet.
    assert not (upload["dir"] / "source.part").exists()
    assert "partial_upload" not in upload_state.read_state("up1")


def test_jatkamispunkt_tuleb_kettalt(upload):
    _lisa(upload, 0, b"0123")
    p = chunked.get_partial("up1")
    assert p["received"] == 4 and p["total"] == 10 and p["fingerprint"] == FP and p["name"] == "x.pdf"


def test_vale_nihe_annab_serveri_tegeliku_seisu(upload):
    _lisa(upload, 0, b"0123")
    with pytest.raises(chunked.ChunkConflict) as e:
        _lisa(upload, 6, b"67")
    assert e.value.received == 4
    # Kordus (sama tükk teist korda, nt kadunud vastuse järel) ei kirjuta topelt.
    with pytest.raises(chunked.ChunkConflict) as e:
        _lisa(upload, 0 + 2, b"23")
    assert e.value.received == 4
    assert (upload["dir"] / "source.part").read_bytes() == b"0123"


def test_teine_fail_ei_jatka_poolikut(upload):
    _lisa(upload, 0, b"0123")
    with pytest.raises(chunked.ChunkConflict) as e:
        _lisa(upload, 4, b"4567", fp="b" * 64)
    assert e.value.reason == "mismatch"


def test_nihe_null_alustab_otsast(upload):
    _lisa(upload, 0, b"0123")
    _lisa(upload, 0, b"ab", total=5, fp="b" * 64)
    assert (upload["dir"] / "source.part").read_bytes() == b"ab"
    assert chunked.get_partial("up1")["total"] == 5


def test_vastu_ei_voeta_parast_faili_salvestamist(upload):
    upload_state.set_upload_state("up1", status="awaiting_split")
    with pytest.raises(chunked.ChunkConflict) as e:
        _lisa(upload, 0, b"01")
    assert e.value.reason == "status"


def test_kogusuuruse_ja_tuki_lagi(upload, monkeypatch):
    monkeypatch.setattr(chunked, "UPLOAD_MAX_BYTES", 8)
    with pytest.raises(ValueError):
        _lisa(upload, 0, b"01", total=9)
    with pytest.raises(ValueError):
        _lisa(upload, 0, b"0123456", total=4)  # tükk üle kogusuuruse


def test_vigane_fail_lopetamisel_koristab(upload, monkeypatch):
    def katki(u, path):
        os.unlink(path)  # store_pdf kustutab vigase faili ise
        raise ValueError("Toetamata failivorming")
    monkeypatch.setattr(chunked, "_finalize", katki)
    with pytest.raises(ValueError):
        _lisa(upload, 0, b"0123456789")
    assert "partial_upload" not in upload_state.read_state("up1")
    assert chunked.get_partial("up1")["received"] == 0


def test_puuduv_upload(upload):
    with pytest.raises(KeyError):
        chunked.append_chunk("puudub", offset=0, total=2, fingerprint=FP, name="x", data=b"01")


# --- Endpoint --------------------------------------------------------------

def test_endpoint_tukk_ja_jatkamispunkt(client, login, backend_env, monkeypatch):
    import server.routers.upload as upload_router
    monkeypatch.setattr(upload_router, "UPLOAD_ENABLED", True, raising=False)
    token = login("admin", "adminpass")
    h = {"Authorization": f"Bearer {token}"}
    uid = client.post("/admin/upload/create", json={"title": "T", "year": "1650"},
                      headers=h).json()["upload"]["id"]
    monkeypatch.setattr(chunked, "_finalize", lambda u, path: 3)

    r = client.post(f"/admin/upload/{uid}/chunk", content=b"01234", headers={
        **h, "X-Upload-Offset": "0", "X-Upload-Total": "8",
        "X-Upload-Fingerprint": FP, "X-Filename": "x.pdf"})
    assert r.status_code == 200, r.text
    assert r.json()["received"] == 5

    g = client.get(f"/admin/upload/{uid}/chunk", headers=h).json()
    assert g["received"] == 5 and g["fingerprint"] == FP

    r = client.post(f"/admin/upload/{uid}/chunk", content=b"9", headers={
        **h, "X-Upload-Offset": "7", "X-Upload-Total": "8",
        "X-Upload-Fingerprint": FP, "X-Filename": "x.pdf"})
    assert r.status_code == 409
    assert r.json()["received"] == 5

    r = client.post(f"/admin/upload/{uid}/chunk", content=b"567", headers={
        **h, "X-Upload-Offset": "5", "X-Upload-Total": "8",
        "X-Upload-Fingerprint": FP, "X-Filename": "x.pdf"})
    assert r.json() == {"status": "accepted", "received": 8, "total": 8,
                        "complete": True, "expected_pages": 3}


def test_endpoint_nouab_admini(client, login, backend_env):
    token = login("editor", "editorpass")
    r = client.get("/admin/upload/abc/chunk", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401


def test_lopetamise_ajal_ei_voeta_uut_faili_vastu(upload, monkeypatch):
    """Viimane tükk annab faili edasi luku väljas; sel ajal ei tohi nihkega 0
    päring (teine vahekaart) loetavat faili tühjendada."""
    vahepeal = {}

    def aeglane(u, path):
        with pytest.raises(chunked.ChunkConflict) as e:
            _lisa(upload, 0, b"xx")
        vahepeal["reason"] = e.value.reason
        vahepeal["sisu"] = open(path, "rb").read()
        return 1
    monkeypatch.setattr(chunked, "_finalize", aeglane)

    _lisa(upload, 0, b"0123456789")

    assert vahepeal == {"reason": "status", "sisu": b"0123456789"}


@pytest.mark.skipif(__import__("shutil").which("pdfinfo") is None, reason="pdfinfo puudub")
def test_paris_pdf_tukkidena_jouab_poolitamise_sammu(client, login, backend_env, monkeypatch):
    """Otsast lõpuni ilma `_finalize` matkimata: 3-leheline PDF tükkidena →
    `store_pdf` → `awaiting_split`, `source.pdf` kettal, `.part` ja kirje kadunud."""
    import io
    from PIL import Image
    import server.routers.upload as upload_router
    monkeypatch.setattr(upload_router, "UPLOAD_ENABLED", True, raising=False)
    monkeypatch.setattr(chunked, "CHUNK_MAX_BYTES", 1000)

    buf = io.BytesIO()
    lehed = [Image.new("RGB", (200, 300), c) for c in ("white", "gray", "black")]
    lehed[0].save(buf, "PDF", save_all=True, append_images=lehed[1:])
    pdf = buf.getvalue()

    h = {"Authorization": f"Bearer {login('admin', 'adminpass')}"}
    uid = client.post("/admin/upload/create", json={"title": "T", "year": "1650"},
                      headers=h).json()["upload"]["id"]
    offset, vastus = 0, None
    while offset < len(pdf):
        tukk = pdf[offset:offset + 1000]
        vastus = client.post(f"/admin/upload/{uid}/chunk", content=tukk, headers={
            **h, "X-Upload-Offset": str(offset), "X-Upload-Total": str(len(pdf)),
            "X-Upload-Fingerprint": FP, "X-Filename": "raamat.pdf"})
        assert vastus.status_code == 200, vastus.text
        offset += len(tukk)

    assert vastus.json()["complete"] is True and vastus.json()["expected_pages"] == 3
    s = upload_state.read_state(uid)
    assert s["status"] == "awaiting_split" and "partial_upload" not in s
    kaust = backend_env["uploads_dir"] / uid
    assert (kaust / "source.pdf").read_bytes() == pdf
    assert not (kaust / "source.part").exists()
