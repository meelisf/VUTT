"""Regressioonitestid save_and_transfer_to_ocr refaktoringule (issue #17).

Refaktoreering (docs/koodi_ulevaade_2026-06-24_gemini_soovitused.md Leid 2):
save_and_transfer_to_ocr (~239 rida) → eraldatud mooduli-taseme funktsioonid
(_prepare_image_upload, _prepare_pdf_upload, _sftp_transfer_image,
_sftp_transfer_pdf, _count_pdf_pages) + ühised helperid (_set_upload_state,
_init_upload_progress, _sftp_progress_cb, _ensure_remote_dirs,
_close_sftp_and_unlink).

Need testid lukustavad refaktoringu käitumise (käitumismuudatuseta):
- dispatch: pilt/PDF/tundmatu → õige haru
- pdfinfo vead (_count_pdf_pages): vigane PDF / puuduv pdfinfo / timeout / puuduv 'Pages:'
- _prepare_*: õiged remote teed + lehekülgede arv
- _sftp_transfer_*: state 'processing'/'error' üleminekud SFTP mock'iga
- _set_upload_state: thread-turvaline state uuendus + idempotentsus
- _ensure_remote_dirs: loob puuduvad, ei puutu olemasolevaid
- PNG/TIFF → JPEG konverteerimine pildi harus
"""
import io
import json
import os
import subprocess
import sys
from pathlib import Path
from unittest.mock import ANY, MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import upload_ops
from server.upload import state as upload_state


# =========================================================
# FIXTURE'id
# =========================================================

@pytest.fixture
def uploads_dir(tmp_path, monkeypatch):
    """Suuna UPLOADS_DIR tmp_path/uploads alla + tühjenda upload_progress."""
    d = tmp_path / "uploads"
    d.mkdir()
    monkeypatch.setattr(upload_ops, "UPLOADS_DIR", str(d))
    # state.json I/O loeb UPLOADS_DIR-i upload/state-moodulist (kanooniline omanik).
    monkeypatch.setattr(upload_state, "UPLOADS_DIR", str(d))
    upload_ops.upload_progress.clear()
    yield d
    upload_ops.upload_progress.clear()


@pytest.fixture
def make_state(uploads_dir):
    """Loob state.json antud upload_id jaoks. Tagastab (upload_id, state)."""
    def _make(upload_id="abc123", slug="test-teos-abc123", **overrides):
        upload_dir = uploads_dir / upload_id
        upload_dir.mkdir()
        (upload_dir / "thumbs").mkdir()
        state = {
            "id": upload_id,
            "status": "pending",
            "meta": {"title": "T", "year": "1700", "slug": slug},
            "remote_staging_path": f"AUTO-OCR/print/{upload_id}",
            "remote_work_path": f"AUTO-OCR/print/{upload_id}/{slug}",
            "expected_pages": None,
        }
        state.update(overrides)
        (upload_dir / "state.json").write_text(
            json.dumps(state, ensure_ascii=False), encoding="utf-8")
        return upload_id, state
    return _make


@pytest.fixture
def fake_file(tmp_path):
    """Loob tõelise ajutise faili. Tagastab path stringi."""
    def _make(name="upload.bin", content=b"data"):
        p = tmp_path / name
        p.write_bytes(content)
        return str(p)
    return _make


@pytest.fixture
def capture_threads(monkeypatch):
    """Asendab threading.Thread klassiga, mis salvestab kutsed aga ei käivita.
    Tagastab listi FakeThread objekte (.target, .args, .name)."""
    started = []

    class FakeThread:
        def __init__(self, target, args=(), kwargs=None, daemon=False, name=None):
            self.target = target
            self.args = args
            self.kwargs = kwargs or {}
            self.daemon = daemon
            self.name = name
            started.append(self)

        def start(self):
            pass

    monkeypatch.setattr(upload_ops.threading, "Thread", FakeThread)
    return started


def _read_state(uploads_dir, upload_id):
    """Abi: loe state.json testi järgi."""
    return json.loads((uploads_dir / upload_id / "state.json").read_text(encoding="utf-8"))


def _fake_sftp():
    """Mock SFTPClient. Vaikimisi stat() -> FileNotFoundError ('kaustu pole')."""
    sftp = MagicMock()
    sftp.stat.side_effect = FileNotFoundError
    return sftp


class _ImportSftp:
    """Minimaalne SFTP fake import_as_work testi jaoks."""

    def listdir(self, _path):
        return ["test-teos_pg_001.jpg", "test-teos_pg_001.txt"]

    def get(self, remote, local):
        if remote.endswith(".jpg"):
            Path(local).write_bytes(b"jpg")
        elif remote.endswith(".txt"):
            Path(local).write_text("OCR tekst", encoding="utf-8")
        else:
            raise FileNotFoundError(remote)

    def close(self):
        pass


# =========================================================
# import_as_work
# =========================================================


def test_import_as_work_reports_git_commit_failure(make_state, tmp_path, monkeypatch):
    """Import peab õnnestuma, aga vastuses nähtavalt märkima ebaõnnestunud Git-commiti."""
    import server.git_ops as git_ops
    import server.meilisearch_ops as meili_ops
    import server.prosopography.indices as prosopo_indices
    import server.prosopography.person_crud as person_crud

    data_dir = tmp_path / "data"
    data_dir.mkdir()
    monkeypatch.setattr(upload_ops, "BASE_DIR", str(data_dir))
    monkeypatch.setattr(git_ops, "commit_new_work_to_git", lambda *a, **kw: False)
    monkeypatch.setattr(upload_ops, "_sftp_open", lambda upload_id: _ImportSftp())
    monkeypatch.setattr(upload_ops, "_ssh_rm_rf", lambda *a, **kw: None)
    monkeypatch.setattr(upload_ops, "close_ssh", lambda *a, **kw: None)
    monkeypatch.setattr(meili_ops, "sync_work_to_meilisearch", lambda slug: True)
    monkeypatch.setattr(person_crud, "ensure_prosopo_stubs", lambda metadata, username=None: {})
    monkeypatch.setattr(prosopo_indices, "update_person_to_works", lambda *a, **kw: None)
    monkeypatch.setattr(prosopo_indices, "update_work_collections", lambda *a, **kw: None)

    upload_id, _state = make_state(
        upload_id="imp123",
        slug="test-teos",
        status="reviewing",
        files=[{"page": 1, "has_ocr": True, "deleted": False}],
        meta={"title": "Test teos", "year": "1700", "slug": "test-teos", "work_id": "wid123"},
    )

    result = upload_ops.import_as_work(upload_id, username="admin")

    assert result["work_id"] == "wid123"
    assert result["slug"] == "test-teos"
    assert result["git_committed"] is False
    assert "warning" in result


# =========================================================
# _count_pdf_pages (eraldatud pdfinfo loogika)
# =========================================================

def _pdfinfo_result(stdout="", returncode=0, stderr=""):
    r = MagicMock()
    r.stdout = stdout
    r.stderr = stderr
    r.returncode = returncode
    return r


class TestCountPdfPages:
    def test_loeb_lehekylgede_arvu(self, fake_file, monkeypatch):
        path = fake_file("doc.pdf", b"%PDF-1.4")
        monkeypatch.setattr(subprocess, "run",
                            lambda *a, **k: _pdfinfo_result("Pages: 42\n"))
        assert upload_ops._count_pdf_pages(path) == 42

    def test_vigane_pdf_kustutab_tmp(self, fake_file, monkeypatch):
        path = fake_file("bad.pdf", b"not a pdf")
        monkeypatch.setattr(subprocess, "run",
                            lambda *a, **k: _pdfinfo_result("Pages: 1", returncode=1, stderr="err"))
        with pytest.raises(ValueError, match="Vigane PDF"):
            upload_ops._count_pdf_pages(path)
        assert not os.path.exists(path), "vigase PDF-i tmp_path peab kustutatama"

    def test_pages_valjundist_puudub(self, fake_file, monkeypatch):
        path = fake_file("nopages.pdf", b"%PDF")
        monkeypatch.setattr(subprocess, "run",
                            lambda *a, **k: _pdfinfo_result("Title: Foo\n"))
        with pytest.raises(ValueError, match="ei õnnestunud tuvastada"):
            upload_ops._count_pdf_pages(path)
        # Käitumine säilitatud (refaktooring eelne): tmp_path EI kustutata
        # selles harus — vaid returncode!=0 haru kustutab.
        assert os.path.exists(path)

    def test_pdfinfo_puudub(self, fake_file, monkeypatch):
        path = fake_file("doc.pdf", b"%PDF")

        def raise_fnf(*a, **k):
            raise FileNotFoundError(2, "No such file", "pdfinfo")

        monkeypatch.setattr(subprocess, "run", raise_fnf)
        with pytest.raises(ValueError, match="pdfinfo pole paigaldatud"):
            upload_ops._count_pdf_pages(path)

    def test_pdfinfo_timeout(self, fake_file, monkeypatch):
        path = fake_file("doc.pdf", b"%PDF")

        def raise_timeout(*a, **k):
            raise subprocess.TimeoutExpired(cmd="pdfinfo", timeout=30)

        monkeypatch.setattr(subprocess, "run", raise_timeout)
        with pytest.raises(ValueError, match="liiga kaua"):
            upload_ops._count_pdf_pages(path)


# =========================================================
# _prepare_image_upload / _prepare_pdf_upload
# =========================================================

class TestPrepareUpload:
    def test_image_upload_teid(self):
        state = {
            "meta": {"slug": "minu-teos-xyz"},
            "remote_staging_path": "AUTO-OCR/print/abc123",
            "remote_work_path": "AUTO-OCR/print/abc123/minu-teos-xyz",
        }
        pages, dirs, tmp, dst, img_name = upload_ops._prepare_image_upload(state)
        base = upload_ops.OCR_SERVER_PATH
        assert pages == 1
        assert dirs == (f"{base}/AUTO-OCR/print/abc123",
                        f"{base}/AUTO-OCR/print/abc123/minu-teos-xyz")
        assert img_name == "minu-teos-xyz_pg_001.jpg"
        assert tmp == f"{base}/AUTO-OCR/print/abc123/minu-teos-xyz/minu-teos-xyz_pg_001.jpg.tmp"
        assert dst == f"{base}/AUTO-OCR/print/abc123/minu-teos-xyz/minu-teos-xyz_pg_001.jpg"

    def test_pdf_upload_teid(self, monkeypatch):
        monkeypatch.setattr(upload_ops, "_count_pdf_pages", lambda p: 7)
        state = {
            "meta": {"slug": "pdf-teos-123"},
            "remote_staging_path": "AUTO-OCR/print/abc123",
        }
        pages, dirs, tmp, dst = upload_ops._prepare_pdf_upload(state, "/tmp/f.pdf")
        base = upload_ops.OCR_SERVER_PATH
        assert pages == 7
        assert dirs == (f"{base}/AUTO-OCR/print/abc123",)
        assert tmp == f"{base}/AUTO-OCR/print/abc123/pdf-teos-123.pdf.tmp"
        assert dst == f"{base}/AUTO-OCR/print/abc123/pdf-teos-123.pdf"


# =========================================================
# _set_upload_state / _ensure_remote_dirs
# =========================================================

class TestHelpers:
    def test_set_upload_state_uuendab_staatus(self, make_state):
        upload_id, _ = make_state()
        upload_ops._set_upload_state(upload_id, status='uploading', expected_pages=3)
        s = upload_ops._read_state(upload_id)
        assert s['status'] == 'uploading'
        assert s['expected_pages'] == 3

    def test_set_upload_state_idempotentne_kui_state_puudub(self, uploads_dir):
        # state.json puudub → _set_upload_state ei tohi visata
        upload_ops._set_upload_state("olematu", status='processing')

    def test_write_state_kirjutab_atomaarse_jsoni(self, uploads_dir):
        upload_id = "abc123"
        (uploads_dir / upload_id).mkdir()
        upload_ops._write_state(upload_id, {"id": upload_id, "status": "pending"})

        path = uploads_dir / upload_id / "state.json"
        assert json.loads(path.read_text(encoding="utf-8"))["status"] == "pending"
        assert not list((uploads_dir / upload_id).glob(".tmp_*.json"))
        assert oct(path.stat().st_mode & 0o777) == "0o644"

    def test_ensure_remote_dirs_loob_puuduvad(self):
        sftp = MagicMock()
        sftp.stat.side_effect = FileNotFoundError  # kõik "puuduvad"
        upload_ops._ensure_remote_dirs(sftp, ["/a", "/b"])
        assert sftp.mkdir.call_count == 2

    def test_ensure_remote_dirs_ei_puutu_olemasolevaid(self):
        sftp = MagicMock()
        sftp.stat.return_value = None  # kõik "olemas"
        upload_ops._ensure_remote_dirs(sftp, ["/a", "/b"])
        sftp.mkdir.assert_not_called()


# =========================================================
# save_and_transfer_to_ocr dispatch
# =========================================================

class TestDispatch:
    def test_puuduv_state_tõstab_vea(self, uploads_dir, fake_file):
        path = fake_file()
        with pytest.raises(ValueError, match="ei leitud"):
            upload_ops.save_and_transfer_to_ocr("olematu", path)

    def test_tundmatu_tuup_kustutab_tmp(self, make_state, monkeypatch, fake_file):
        upload_id, _ = make_state()
        path = fake_file("mystery.dat", b"\x00\x01")
        monkeypatch.setattr(upload_ops, "_detect_file_type", lambda p: 'unknown')
        with pytest.raises(ValueError, match="Toetamata failivorming"):
            upload_ops.save_and_transfer_to_ocr(upload_id, path)
        assert not os.path.exists(path), "tundmatu tüüp peab tmp_path kustutama"

    def test_pilt_dispatch_käivitab_image_thread(self, make_state, monkeypatch,
                                                 fake_file, capture_threads, uploads_dir):
        upload_id, _ = make_state()
        path = fake_file("img.jpg", b"\xff\xd8\xff\xe0")
        monkeypatch.setattr(upload_ops, "_detect_file_type", lambda p: 'jpeg')
        monkeypatch.setattr(upload_ops, "_validate_upload_image", lambda p: (10, 10))

        pages = upload_ops.save_and_transfer_to_ocr(upload_id, path)

        assert pages == 1
        assert len(capture_threads) == 1
        t = capture_threads[0]
        assert t.target == upload_ops._sftp_transfer_image
        assert t.name == f"sftp-img-{upload_id}"
        # args: (upload_id, tmp_path, file_type, remote_dirs, remote_tmp, remote_dst, remote_img_name)
        assert t.args[0] == upload_id
        assert t.args[1] == path
        assert t.args[2] == 'jpeg'
        s = _read_state(uploads_dir, upload_id)
        assert s['status'] == 'uploading'
        assert s['expected_pages'] == 1
        # progress init
        assert upload_ops.upload_progress[upload_id]['bytes_total'] > 0
        assert upload_ops.upload_progress[upload_id]['error'] is None

    def test_liiga_suur_pilt_katkestab_enne_threadi(self, make_state, monkeypatch,
                                                     fake_file, capture_threads):
        upload_id, _ = make_state()
        path = fake_file("img.jpg", b"\xff\xd8\xff\xe0")
        monkeypatch.setattr(upload_ops, "_detect_file_type", lambda p: 'jpeg')
        monkeypatch.setattr(upload_ops, "_validate_upload_image", lambda p: (_ for _ in ()).throw(ValueError("Pilt on liiga suur")))

        with pytest.raises(ValueError, match="Pilt on liiga suur"):
            upload_ops.save_and_transfer_to_ocr(upload_id, path)

        assert not os.path.exists(path), "tagasilükatud pildi tmp_path kustutatakse"
        assert capture_threads == []

    def test_validate_upload_image_pikslipiir(self, monkeypatch, tmp_path):
        from PIL import Image
        path = tmp_path / "big.png"
        Image.new("RGB", (20, 20), (1, 2, 3)).save(path)
        monkeypatch.setattr(upload_ops, "UPLOAD_IMAGE_MAX_PIXELS", 300)

        with pytest.raises(ValueError, match="Pilt on liiga suur"):
            upload_ops._validate_upload_image(str(path))

    def test_validate_upload_image_vigane_magic(self, fake_file):
        path = fake_file("broken.jpg", b"\xff\xd8\xff\xe0vigane")

        with pytest.raises(ValueError, match="Vigane pildifail"):
            upload_ops._validate_upload_image(path)

    def test_pdf_dispatch_käivitab_pdf_thread(self, make_state, monkeypatch,
                                              fake_file, capture_threads, uploads_dir):
        upload_id, _ = make_state()
        path = fake_file("doc.pdf", b"%PDF-1.4")
        monkeypatch.setattr(upload_ops, "_detect_file_type", lambda p: 'pdf')
        monkeypatch.setattr(upload_ops, "_count_pdf_pages", lambda p: 15)

        pages = upload_ops.save_and_transfer_to_ocr(upload_id, path)

        assert pages == 15
        assert len(capture_threads) == 1
        t = capture_threads[0]
        assert t.target == upload_ops._sftp_transfer_pdf
        assert t.name == f"sftp-{upload_id}"
        # args: (upload_id, tmp_path, remote_dirs, remote_tmp, remote_dst, pages, file_size)
        assert t.args[0] == upload_id
        assert t.args[1] == path
        assert t.args[5] == 15  # pages
        assert t.args[6] == os.path.getsize(path)  # file_size
        s = _read_state(uploads_dir, upload_id)
        assert s['status'] == 'uploading'
        assert s['expected_pages'] == 15

    def test_png_dispatch_kasutab_image_haru(self, make_state, monkeypatch,
                                             fake_file, capture_threads):
        upload_id, _ = make_state()
        path = fake_file("img.png", b"\x89PNG\r\n\x1a\n")
        monkeypatch.setattr(upload_ops, "_detect_file_type", lambda p: 'png')
        monkeypatch.setattr(upload_ops, "_validate_upload_image", lambda p: (10, 10))

        pages = upload_ops.save_and_transfer_to_ocr(upload_id, path)

        assert pages == 1
        assert capture_threads[0].target == upload_ops._sftp_transfer_image
        assert capture_threads[0].args[2] == 'png'  # file_type edastatakse konverteerimiseks


# =========================================================
# add_image_page (multi-image)
# =========================================================

class TestAddImagePage:
    def test_liiga_suur_multi_image_katkestab_enne_sftp(self, make_state, monkeypatch, fake_file):
        upload_id, _ = make_state(status='pending')
        path = fake_file("page.jpg", b"\xff\xd8\xff\xe0")
        monkeypatch.setattr(upload_ops, "_detect_file_type", lambda p: 'jpeg')
        monkeypatch.setattr(upload_ops, "_validate_upload_image", lambda p: (_ for _ in ()).throw(ValueError("Pilt on liiga suur")))
        sftp_open = MagicMock()
        monkeypatch.setattr(upload_ops, "_sftp_open", sftp_open)

        with pytest.raises(ValueError, match="Pilt on liiga suur"):
            upload_ops.add_image_page(upload_id, path, 1, 2)

        assert not os.path.exists(path)
        sftp_open.assert_not_called()


# =========================================================
# _sftp_transfer_image / _sftp_transfer_pdf (SFTP mock'iga)
# =========================================================

class TestSftpTransfer:
    def test_image_edu_staatus_processing(self, make_state, uploads_dir, monkeypatch, fake_file):
        upload_id, _ = make_state(status='uploading')
        path = fake_file("img.jpg", b"\xff\xd8")
        sftp = _fake_sftp()
        monkeypatch.setattr(upload_ops, "_sftp_open", lambda uid: sftp)
        monkeypatch.setattr(upload_ops, "_validate_upload_image", lambda p: (10, 10))

        upload_ops._sftp_transfer_image(
            upload_id, path, 'jpeg',
            remote_dirs=("/staging", "/work"),
            remote_tmp="/work/img.jpg.tmp",
            remote_dst="/work/img.jpg",
            remote_img_name="img.jpg",
        )

        sftp.put.assert_called_once_with(path, "/work/img.jpg.tmp", callback=ANY)
        sftp.rename.assert_called_once_with("/work/img.jpg.tmp", "/work/img.jpg")
        assert sftp.mkdir.call_count == 2  # staging + work
        sftp.close.assert_called_once()
        assert not os.path.exists(path), "tmp_path peab finally's kustutama"
        assert _read_state(uploads_dir, upload_id)['status'] == 'processing'

    def test_image_viga_staatus_error(self, make_state, uploads_dir, monkeypatch, fake_file):
        upload_id, _ = make_state(status='uploading')
        path = fake_file("img.jpg", b"\xff\xd8")
        # upload_progress lähtestatakse tavaliselt dispatcheris (_init_upload_progress)
        # enne threadi starti — simuleerime seda siin otsekutsumise korral.
        upload_ops._init_upload_progress(upload_id, path)
        sftp = _fake_sftp()
        sftp.put.side_effect = RuntimeError("ühendus katkes")
        monkeypatch.setattr(upload_ops, "_sftp_open", lambda uid: sftp)
        monkeypatch.setattr(upload_ops, "_validate_upload_image", lambda p: (10, 10))

        upload_ops._sftp_transfer_image(
            upload_id, path, 'jpeg',
            remote_dirs=("/staging", "/work"),
            remote_tmp="/work/img.jpg.tmp",
            remote_dst="/work/img.jpg",
            remote_img_name="img.jpg",
        )

        s = _read_state(uploads_dir, upload_id)
        assert s['status'] == 'error'
        assert "ühendus katkes" in s['error_message']
        assert not os.path.exists(path), "finally kustutab tmp_path ka vea korral"
        assert upload_ops.upload_progress[upload_id]['error'] == "ühendus katkes"

    def test_image_png_konverteerib_jpegiks(self, make_state, monkeypatch, fake_file):
        """PNG → JPEG konverteerimine: sftp.put saab .conv.jpg teed."""
        from PIL import Image
        upload_id, _ = make_state(status='uploading')
        buf = io.BytesIO()
        Image.new("RGB", (4, 4), (10, 20, 30)).save(buf, format="PNG")
        path = fake_file("img.png", buf.getvalue())

        sftp = _fake_sftp()
        captured = {}
        monkeypatch.setattr(upload_ops, "_sftp_open", lambda uid: sftp)

        def spy_put(src, dst, callback=None):
            captured['src'] = src
            captured['dst'] = dst
        sftp.put.side_effect = spy_put

        upload_ops._sftp_transfer_image(
            upload_id, path, 'png',
            remote_dirs=("/staging", "/work"),
            remote_tmp="/work/img.jpg.tmp",
            remote_dst="/work/img.jpg",
            remote_img_name="img.jpg",
        )

        # Konverteeritud fail läheb üles (mitte originaal PNG)
        assert captured['src'].endswith(".conv.jpg")
        assert captured['dst'] == "/work/img.jpg.tmp"
        assert not os.path.exists(path), "originaal tmp_path kustutatakse finally's"

    def test_pdf_edu_staatus_processing(self, make_state, uploads_dir, monkeypatch, fake_file):
        upload_id, _ = make_state(status='uploading')
        path = fake_file("doc.pdf", b"%PDF")
        sftp = _fake_sftp()
        monkeypatch.setattr(upload_ops, "_sftp_open", lambda uid: sftp)

        upload_ops._sftp_transfer_pdf(
            upload_id, path,
            remote_dirs=("/staging",),
            remote_tmp="/staging/doc.pdf.tmp",
            remote_dst="/staging/doc.pdf",
            pages=5, file_size=100,
        )

        sftp.put.assert_called_once_with(path, "/staging/doc.pdf.tmp", callback=ANY)
        sftp.rename.assert_called_once_with("/staging/doc.pdf.tmp", "/staging/doc.pdf")
        assert sftp.mkdir.call_count == 1  # ainult staging
        sftp.close.assert_called_once()
        assert not os.path.exists(path)
        assert _read_state(uploads_dir, upload_id)['status'] == 'processing'

    def test_pdf_viga_staatus_error(self, make_state, uploads_dir, monkeypatch, fake_file):
        upload_id, _ = make_state(status='uploading')
        path = fake_file("doc.pdf", b"%PDF")
        upload_ops._init_upload_progress(upload_id, path)
        sftp = _fake_sftp()
        sftp.rename.side_effect = OSError("IO viga")
        monkeypatch.setattr(upload_ops, "_sftp_open", lambda uid: sftp)

        upload_ops._sftp_transfer_pdf(
            upload_id, path,
            remote_dirs=("/staging",),
            remote_tmp="/staging/doc.pdf.tmp",
            remote_dst="/staging/doc.pdf",
            pages=5, file_size=100,
        )

        s = _read_state(uploads_dir, upload_id)
        assert s['status'] == 'error'
        assert "IO viga" in s['error_message']
        assert not os.path.exists(path)
