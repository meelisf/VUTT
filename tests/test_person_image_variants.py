"""Isikupildi suurusvariandid (#424): laisk genereerimine, korduskasutus, invalideerimine."""
import io
import json
import os

import pytest
from PIL import Image


def _jpeg(width, height, exif_orientation=None):
    img = Image.new("RGB", (width, height), (200, 30, 30))
    buf = io.BytesIO()
    if exif_orientation is not None:
        exif = Image.Exif()
        exif[0x0112] = exif_orientation
        img.save(buf, format="JPEG", exif=exif.tobytes())
    else:
        img.save(buf, format="JPEG")
    return buf.getvalue()


@pytest.fixture
def crud(monkeypatch, tmp_path):
    from server.prosopography import ops, person_crud

    prosopo_dir = tmp_path / "prosopography"
    images_dir = prosopo_dir / "images"
    prosopo_dir.mkdir()
    path = prosopo_dir / "abc123.json"
    path.write_text(json.dumps({
        "id": "vutt:Pabc123", "name": {"label": "Test Isik"}, "image_url": None,
        "updated_at": "2026-01-01T00:00:00+00:00",
    }), encoding="utf-8")

    def save(filepath, content, *_a, **_kw):
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(content)
        return {"success": True, "commit_hash": "test"}

    # Patch fassaadil (nagu conftest `prosopo_env`): otse `state`-i patchimine
    # jätab `sync_from_facade` taastuse vahele ja lekib järgmistesse testidesse.
    monkeypatch.setattr(ops, "PROSOPOGRAPHY_DIR", str(prosopo_dir))
    monkeypatch.setattr(ops, "PROSOPOGRAPHY_IMAGES_DIR", str(images_dir))
    monkeypatch.setattr(ops, "save_with_git", save)
    monkeypatch.setattr(ops, "get_person", lambda _pid: json.loads(path.read_text()))
    monkeypatch.setattr(person_crud, "_indices", lambda: type("I", (), {
        "_update_index_entry": staticmethod(lambda _p: None),
        "_update_aliases_entry": staticmethod(lambda _p: None),
    })())
    return person_crud


PID = "vutt:Pabc123"


def test_variant_vahendab_laiuse_ja_sailitab_kuvasuhte(crud):
    crud.upload_person_image(PID, _jpeg(2000, 2400), "image/jpeg", "editor")
    path = crud.get_person_image_variant(PID, 320)
    assert path != crud.get_person_image_path(PID)
    with Image.open(path) as img:
        assert img.size == (320, 384)
        assert img.format == "JPEG"


def test_korduspaaring_ei_genereeri_uuesti(crud, monkeypatch):
    from server.prosopography import image_variants

    crud.upload_person_image(PID, _jpeg(1000, 1000), "image/jpeg", "editor")
    first = crud.get_person_image_variant(PID, 160)

    def keelatud(*_a, **_kw):
        pytest.fail("variant genereeriti uuesti")
    monkeypatch.setattr(image_variants, "_render_variant", keelatud)
    assert crud.get_person_image_variant(PID, 160) == first


def test_vaikest_pilti_ei_venitata(crud):
    crud.upload_person_image(PID, _jpeg(200, 300), "image/jpeg", "editor")
    # Lähtepilt on soovitud laiusest kitsam — serveeritakse originaal.
    assert crud.get_person_image_variant(PID, 640) == crud.get_person_image_path(PID)


def test_exif_poore_rakendub(crud):
    # Orientation 6 = 90° pööre: salvestatud 1000×500 kuvatakse 500×1000.
    crud.upload_person_image(PID, _jpeg(1000, 500, exif_orientation=6), "image/jpeg", "editor")
    with Image.open(crud.get_person_image_variant(PID, 160)) as img:
        assert img.size == (160, 320)


def test_asendamine_ja_kustutamine_eemaldavad_variandid(crud):
    crud.upload_person_image(PID, _jpeg(1000, 1000), "image/jpeg", "editor")
    old_variant = crud.get_person_image_variant(PID, 320)
    assert os.path.exists(old_variant)

    crud.upload_person_image(PID, _jpeg(1000, 2000), "image/jpeg", "editor")
    assert not os.path.exists(old_variant)
    with Image.open(crud.get_person_image_variant(PID, 320)) as img:
        assert img.size == (320, 640)

    new_variant = crud.get_person_image_variant(PID, 320)
    crud.delete_person_image(PID, "editor")
    assert not os.path.exists(new_variant)
    assert crud.get_person_image_variant(PID, 320) is None


def test_lubamatu_laius_viskab(crud):
    crud.upload_person_image(PID, _jpeg(1000, 1000), "image/jpeg", "editor")
    with pytest.raises(ValueError):
        crud.get_person_image_variant(PID, 333)


def test_vigane_lahtepilt_annab_originaali(crud):
    crud.upload_person_image(PID, b"pole pilt", "image/jpeg", "editor")
    assert crud.get_person_image_variant(PID, 160) == crud.get_person_image_path(PID)


def test_image_url_kannab_versiooni(crud):
    first = crud.upload_person_image(PID, _jpeg(100, 100), "image/jpeg", "editor")["image_url"]
    assert "?v=" in first
    second = crud.upload_person_image(PID, _jpeg(100, 100), "image/jpeg", "editor")["image_url"]
    assert second != first


# --- Endpoint -------------------------------------------------------------

@pytest.fixture
def client(crud):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from server.prosopography import router as prosopography

    app = FastAPI()
    app.include_router(prosopography.router, prefix="/prosopography")
    return TestClient(app)


def test_endpoint_ei_ole_async():
    # Variandi esimene genereerimine on PIL-töö — sündmussilmus ei tohi seda teha (ADR 0002).
    import asyncio
    from server.prosopography import router as prosopography
    assert not asyncio.iscoroutinefunction(prosopography.prosopography_get_image)


def test_endpoint_serveerib_varianti_ja_versiooni_vahemalu(crud, client):
    url = crud.upload_person_image(PID, _jpeg(1000, 1000), "image/jpeg", "editor")["image_url"]
    path = url.removeprefix("/api/files")

    r = client.get(f"{path}&w=160")
    assert r.status_code == 200
    with Image.open(io.BytesIO(r.content)) as img:
        assert img.size == (160, 160)
    assert "immutable" in r.headers["cache-control"]

    r = client.get(f"/prosopography/{PID}/image")
    assert r.status_code == 200
    with Image.open(io.BytesIO(r.content)) as img:
        assert img.size == (1000, 1000)
    assert r.headers["cache-control"] == "no-cache"


def test_endpoint_lubamatu_laius_on_400(crud, client):
    crud.upload_person_image(PID, _jpeg(1000, 1000), "image/jpeg", "editor")
    assert client.get(f"/prosopography/{PID}/image", params={"w": 333}).status_code == 400
    assert client.get("/prosopography/vutt:Pmuu999/image", params={"w": 160}).status_code == 404
