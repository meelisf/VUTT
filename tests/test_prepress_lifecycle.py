"""Prepress-artefaktide elutsükkel: mis kaob millal."""
import pytest

from server.upload import prepress
from server.upload import state as upload_state


@pytest.fixture
def upload(tmp_path, monkeypatch):
    uid = "u1"
    base = tmp_path / uid
    (base / "preview").mkdir(parents=True)
    (base / "preview" / "pg_0001.jpg").write_bytes(b"x")
    (base / "source.pdf").write_bytes(b"%PDF")
    (base / "thumbs").mkdir()
    (base / "thumbs" / "001.jpg").write_bytes(b"x")
    monkeypatch.setattr(upload_state, "upload_dir", lambda i: str(base))
    monkeypatch.setattr(prepress.upload_state, "upload_dir", lambda i: str(base))
    return uid, base


def test_koristus_kustutab_preview_ja_source(upload):
    uid, base = upload
    prepress.cleanup_prepress_artifacts(uid)
    assert not (base / "preview").exists()
    assert not (base / "source.pdf").exists()


def test_koristus_ei_puutu_thumbs_kausta(upload):
    """thumbs/ on OCR-järgse ülevaatuse oma — sellest sõltub samm 4."""
    uid, base = upload
    prepress.cleanup_prepress_artifacts(uid)
    assert (base / "thumbs" / "001.jpg").exists()


def test_koristus_on_idempotentne(upload):
    uid, _ = upload
    prepress.cleanup_prepress_artifacts(uid)
    prepress.cleanup_prepress_artifacts(uid)   # ei tohi visata


@pytest.fixture
def prepress_upload(tmp_path, monkeypatch):
    """Poolitamise ootel upload, plaan viie lehega. Ilma päris failideta."""
    uid = "u2"
    base = tmp_path / uid
    base.mkdir(parents=True)
    monkeypatch.setattr(upload_state, "upload_dir", lambda i: str(base))
    monkeypatch.setattr(prepress.upload_state, "upload_dir", lambda i: str(base))
    upload_state.write_state(uid, {
        "id": uid, "status": "awaiting_split",
        "meta": {"slug": "kirik-abc"},
    })
    upload_state.init_prepress(uid, 5)
    return uid


def test_apply_tohib_alata_renderduse_ajalt(prepress_upload):
    """500-lehelisel tööl ei tohi „Edasi" olla ~5 min surnud."""
    uid = prepress_upload
    upload_state.set_upload_state(uid, status="prepping")
    assert upload_state.try_begin_applying(uid) is True
    assert upload_state.read_state(uid)["status"] == "applying"


def test_apply_seab_katkestuslipu_sama_luku_all(prepress_upload):
    uid = prepress_upload
    upload_state.set_upload_state(uid, status="prepping")
    upload_state.try_begin_applying(uid)
    assert upload_state.read_state(uid)["prepress"]["preview_cancel"] is True


def test_renderdaja_valjub_lipu_peale(prepress_upload, monkeypatch):
    """Lippu kontrollitakse IGA lehe alguses, mitte partii lõpus."""
    uid = prepress_upload
    renderdatud = []

    class _Source:
        def page_count(self):
            return 5

        def render_preview(self, n, dst):
            renderdatud.append(n)
            open(dst, "wb").close()
            if n == 2:
                upload_state.mutate_prepress(uid, lambda p: p.update(preview_cancel=True))

    monkeypatch.setattr(prepress.page_source, "open_page_source", lambda p: _Source())
    monkeypatch.setattr(prepress, "source_path", lambda i: "/ei/loe")

    prepress._render_previews(uid)

    assert renderdatud == [1, 2]                     # 3. lehte ei alustatud
    plan = upload_state.read_state(uid)["prepress"]
    assert plan["preview_status"] == "cancelled"


def test_katkestatud_renderdaja_ei_kirjuta_apply_staatust_ule(prepress_upload, monkeypatch):
    """Renderdaja EI TOHI applying'ut awaiting_split'iks tagasi lükata."""
    uid = prepress_upload

    class _Source:
        def page_count(self):
            return 2

        def render_preview(self, n, dst):
            open(dst, "wb").close()
            upload_state.set_upload_state(uid, status="applying")
            upload_state.mutate_prepress(uid, lambda p: p.update(preview_cancel=True))

    monkeypatch.setattr(prepress.page_source, "open_page_source", lambda p: _Source())
    monkeypatch.setattr(prepress, "source_path", lambda i: "/ei/loe")

    prepress._render_previews(uid)

    assert upload_state.read_state(uid)["status"] == "applying"


def test_start_nullib_katkestuslipu(prepress_upload, monkeypatch):
    """Ilma selleta läheb taaskäivitatud eelvaade kohe cancelled'iks."""
    uid = prepress_upload
    upload_state.mutate_prepress(uid, lambda p: p.update(
        preview_cancel=True, preview_status="cancelled"))
    monkeypatch.setattr(prepress.threading, "Thread",
                        lambda target, **kw: type("T", (), {"start": lambda s: None})())

    prepress.start_preview(uid)

    plan = upload_state.read_state(uid)["prepress"]
    assert plan["preview_cancel"] is False
    assert plan["preview_status"] == "rendering"
