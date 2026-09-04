"""OCR-serveri .err märgendi lugemine kõigis neljas kohas (#250).

Enne: ebaõnnestunud leht ei jätnud failisüsteemi ühtki jälge → VUTT ootas
12 h absoluuttaimerini. Nüüd kirjutab OCR-server lehe kõrvale .err märgendi
ja iga lugemistee peab selle veaks tõlkima.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server.reocr_ops as reocr_ops
from server import reocr_recovery
from server.upload import thumbs as upload_thumbs
from server.upload import import_work


class _ErrSFTP:
    """SFTP-mock, kus .txt puudub aga .err on olemas."""

    def __init__(self, err_content=b"RuntimeError: CUDA out of memory", tree=None):
        self.err_content = err_content
        self.tree = tree or {}
        self.removed = []
        self.rmdired = []
        self.closed = False

    def stat(self, path):
        if path.endswith(".err"):
            return None
        raise FileNotFoundError(path)

    def listdir(self, path):
        if path not in self.tree:
            raise FileNotFoundError(path)
        return list(self.tree[path])

    def getfo(self, path, buf):
        if not path.endswith(".err"):
            raise FileNotFoundError(path)
        buf.write(self.err_content)

    def remove(self, path):
        self.removed.append(path)
        kaust, _, nimi = path.rpartition("/")
        if kaust in self.tree and nimi in self.tree[kaust]:
            self.tree[kaust].remove(nimi)

    def rmdir(self, path):
        self.rmdired.append(path)

    def close(self):
        self.closed = True


@pytest.fixture(autouse=True)
def _clean_jobs():
    with reocr_ops._reocr_jobs_lock:
        reocr_ops._reocr_jobs.clear()
    with reocr_ops._reocr_batch_jobs_lock:
        reocr_ops._reocr_batch_jobs.clear()
    yield
    with reocr_ops._reocr_jobs_lock:
        reocr_ops._reocr_jobs.clear()
    with reocr_ops._reocr_batch_jobs_lock:
        reocr_ops._reocr_batch_jobs.clear()


# =========================================================
# 1. Üksiku lehe re-OCR poll
# =========================================================

def _single_job(**overrides):
    job = {
        "status": "processing",
        "text": None,
        "error": None,
        "slug": "1690-w1",
        "page_filename": "1690-w1-abc-001.txt",
        "remote_staging": "AUTO-OCR/print/j1/staging",
        "remote_work": "AUTO-OCR/print/j1/work",
        "remote_img": "AUTO-OCR/print/j1/work/img.jpg",
        "remote_txt": "AUTO-OCR/print/j1/work/out.txt",
    }
    job.update(overrides)
    return job


def test_uksik_poll_err_margend_annab_vea(monkeypatch):
    """.err → töö läheb error-i sekunditega, mitte 12 h pärast."""
    sftp = _ErrSFTP()
    monkeypatch.setattr(reocr_ops, "_sftp_open", lambda jid: sftp)
    monkeypatch.setattr(reocr_ops, "close_ssh", lambda jid: None)
    logitud = []
    monkeypatch.setattr(reocr_ops, "_append_to_log", lambda job, jid: logitud.append(job))
    reocr_ops._reocr_jobs["j1"] = _single_job()

    res = reocr_ops.poll_reocr_job("j1")

    assert res["status"] == "error"
    assert "CUDA out of memory" in res["error"]
    assert reocr_ops._reocr_jobs["j1"]["status"] == "error"
    assert logitud and logitud[0]["status"] == "error"


def test_uksik_poll_err_koristab_kaugfailid(monkeypatch):
    """Lahendatud leht ei tohi kaugserverisse jääda."""
    sftp = _ErrSFTP()
    monkeypatch.setattr(reocr_ops, "_sftp_open", lambda jid: sftp)
    monkeypatch.setattr(reocr_ops, "close_ssh", lambda jid: None)
    monkeypatch.setattr(reocr_ops, "_append_to_log", lambda job, jid: None)
    reocr_ops._reocr_jobs["j1"] = _single_job()

    reocr_ops.poll_reocr_job("j1")

    assert any(p.endswith("out.err") for p in sftp.removed)
    assert any(p.endswith("img.jpg") for p in sftp.removed)


def test_uksik_poll_ilma_txt_ja_err_ita_jaab_processingusse(monkeypatch):
    """Regressioon: tavaline ootamine ei tohi veaks muutuda."""
    class _Tyhi(_ErrSFTP):
        def stat(self, path):
            raise FileNotFoundError(path)

    monkeypatch.setattr(reocr_ops, "_sftp_open", lambda jid: _Tyhi())
    reocr_ops._reocr_jobs["j1"] = _single_job()

    assert reocr_ops.poll_reocr_job("j1")["status"] == "processing"


# =========================================================
# 2. Batch-poll
# =========================================================

def _batch_job():
    return {
        "status": "processing",
        "slug": "1690-w1",
        "work_id": "w1",
        "remote_work": "AUTO-OCR/print/b1/1690-w1",
        "remote_staging": "AUTO-OCR/print/b1",
        "last_progress_at": 100.0,
        "pages": [
            {"page_filename": "1690-w1-abc-001.jpg", "page_number": 1,
             "remote_img_name": "1690-w1_pg_001.jpg", "remote_txt_name": "1690-w1_pg_001.txt",
             "status": "processing", "error": None},
        ],
    }


def test_batch_poll_err_margend_annab_lehe_vea(monkeypatch):
    sftp = _ErrSFTP()
    monkeypatch.setattr(reocr_ops, "_sftp_open", lambda jid: sftp)
    monkeypatch.setattr(reocr_ops, "close_ssh", lambda jid: None)
    monkeypatch.setattr(reocr_ops, "_write_ocr_file",
                        lambda *a, **kw: pytest.fail("vigast lehte ei tohi kirjutada"))
    reocr_ops._reocr_batch_jobs["b1"] = _batch_job()

    reocr_ops._poll_batch_job("b1")

    entry = reocr_ops._reocr_batch_jobs["b1"]["pages"][0]
    assert entry["status"] == "error"
    assert "CUDA out of memory" in entry["error"]
    # Vigane leht on EDENEMINE — muidu lööb stall-indikaator valehäire
    assert reocr_ops._reocr_batch_jobs["b1"]["last_progress_at"] > 100.0
    assert any(p.endswith("1690-w1_pg_001.err") for p in sftp.removed)
    assert any(p.endswith("1690-w1_pg_001.jpg") for p in sftp.removed)


# =========================================================
# 3. Orbude taaste
# =========================================================

def test_taaste_loeb_err_lehe_lahendatuks(monkeypatch, tmp_path):
    """Ilma selleta jääb .err leht igavesti `unresolved` → mapping ei kustu."""
    base = "/srv/AUTO-OCR/print"
    work_dir = f"{base}/b9/1690-w1"
    sftp = _ErrSFTP(tree={work_dir: ["1690-w1_pg_001.err", "1690-w1_pg_001.jpg"]})
    mapping = {"slug": "1690-w1", "work_id": "w1",
               "pages": {"1690-w1_pg_001.txt": {"page_filename": "1690-w1-abc-001.jpg",
                                                "page_number": 1}}}
    logitud = []
    monkeypatch.setattr(reocr_recovery.reocr_ops, "_append_to_log",
                        lambda job, jid: logitud.append(job))
    eemaldatud = []
    monkeypatch.setattr(reocr_recovery.reocr_state, "remove_batch_mapping",
                        lambda jid: eemaldatud.append(jid))
    monkeypatch.setattr(reocr_recovery.reocr_ops, "_drop_backups", lambda jid: None)

    reocr_recovery._recover_batch(sftp, base, "b9", mapping, [], [])

    assert logitud and logitud[0]["status"] == "error"
    assert "CUDA out of memory" in (logitud[0].get("error") or "")
    assert any(p.endswith(".err") for p in sftp.removed)
    assert eemaldatud == ["b9"], "kõik lehed lahendatud → mapping kustub"


# =========================================================
# 4. Upload'i thumbs-poll
# =========================================================

def test_upload_poll_loeb_err_lehe_lahendatuks(tmp_path, monkeypatch):
    """ready + failed = expected → upload jõuab `done`-i, mitte ei jää igavesti rippu."""
    uploads = tmp_path / "uploads"
    (uploads / "u1" / "thumbs").mkdir(parents=True)
    monkeypatch.setattr(upload_thumbs.upload_state, "UPLOADS_DIR", str(uploads))
    upload_thumbs.upload_state.write_state("u1", {
        "id": "u1", "status": "processing", "expected_pages": 2,
        "meta": {"slug": "1690-w1"},
        "remote_staging_path": "AUTO-OCR/print/u1",
        "remote_work_path": "AUTO-OCR/print/u1/1690-w1",
        "files": [],
    })
    work = "/srv/AUTO-OCR/print/u1/1690-w1"
    sftp = _ErrSFTP(tree={work: ["1690-w1_pg_001.jpg", "1690-w1_pg_001.txt",
                                 "1690-w1_pg_002.jpg", "1690-w1_pg_002.err"]})

    res = upload_thumbs.poll_and_sync_thumbs(
        "u1", ocr_server_path="/srv", sftp_open_func=lambda uid: sftp,
    )

    assert res["failed"] == [2]
    assert res["status"] == "done", "vigane leht ei tohi upload'i igavesti rippu jätta"
    lehed = {f["page"]: f for f in res["files"]}
    assert lehed[2]["has_ocr"] is False
    assert "CUDA out of memory" in lehed[2]["ocr_error"]


# =========================================================
# 5. Impordi veateade
# =========================================================

def test_import_nimetab_ebaonnestunud_lehed():
    """`TXT puudub` on eksitav, kui OCR päriselt kukkus — kasutaja peab teadma, mida teha."""
    importable = [{"page": 1}, {"page": 2}]
    remote = ["1690-w1_pg_001.jpg", "1690-w1_pg_001.txt",
              "1690-w1_pg_002.jpg", "1690-w1_pg_002.err"]

    with pytest.raises(ValueError, match="OCR ebaõnnestus lehtedel 2"):
        import_work.validate_remote_ocr_files(
            importable, remote, lambda b: int(b.rsplit("_pg_", 1)[1]))


# --- Impordi värav: frontend ja backend peavad olema ühel meelel (#294) ---

def test_poll_kirje_kannab_importable_lippu():
    """Frontend EI TOHI `.err` kategooriaid ise tõlgendada.

    `readyCount` luges ainult `has_ocr` lehti, seega ühelehelisel teosel, mille
    ainus leht sattus kordusloopi, jäi impordinupp KEELATUKS — kuigi backend
    oleks lehe vastu võtnud (ADR 0025: mudeli viga = leht on lahendatud).
    Sõnavara („mudel on imporditav") tohib elada AINULT `ocr_err.py`-s; poll
    annab frontendile valmis otsuse, mitte tooraine.
    """
    from server.upload import thumbs

    assert thumbs.on_importable({"has_ocr": True}) is True
    assert thumbs.on_importable(
        {"has_ocr": False, "ocr_error": "mudel: KordusLoop: periood 1, 780 kordust"}
    ) is True


def test_pildi_viga_ei_ole_importable():
    """`pilt` = skaneeringut ei saa avada → lehte EI SAA käsitsi transkribeerida."""
    from server.upload import thumbs

    assert thumbs.on_importable(
        {"has_ocr": False, "ocr_error": "pilt: UnidentifiedImageError: cannot identify"}
    ) is False


def test_ilma_ocrita_ja_ilma_veata_ei_ole_importable():
    """Leht, mis on veel töös — ei valmis ega lõplikult ebaõnnestunud."""
    from server.upload import thumbs

    assert thumbs.on_importable({"has_ocr": False}) is False
    assert thumbs.on_importable({"has_ocr": False, "ocr_error": ""}) is False
