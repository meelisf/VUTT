"""normalize_ocr_jobs — puhas OCR-tööde normaliseerija."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server.ocr_jobs_normalize import normalize_ocr_jobs


def _title_of(work_id):
    return {"wid": "Teose Pealkiri"}.get(work_id, work_id or "")


def test_normalize_upload_reviewing():
    uploads = [{
        "id": "u1", "status": "reviewing",
        "meta": {"title": "Uus teos", "slug": "uus-teos-x", "work_id": "wx"},
        "expected_pages": 12, "created_at": "2026-07-01T10:00:00",
        "files": [{"has_ocr": True, "deleted": False}, {"has_ocr": False, "deleted": False}],
    }]
    out = normalize_ocr_jobs(uploads, [], [], _title_of)
    e = out[0]
    assert e["type"] == "upload"
    assert e["title"] == "Uus teos"
    assert e["status_key"] == "review"
    assert e["progress"] == {"ready": 1, "total": 12}
    assert e["link"] == "/upload?resumeUpload=u1"
    assert e["started_at"] > 0


def test_normalize_upload_import_error():
    uploads = [{"id": "u2", "status": "error", "error_message": "import ebaõnnestus",
                "meta": {"title": "X", "slug": "x", "work_id": "wx"},
                "expected_pages": None, "created_at": "2026-07-01T10:00:00", "files": []}]
    e = normalize_ocr_jobs(uploads, [], [], _title_of)[0]
    assert e["status_key"] == "error"
    assert e["error"] == "import ebaõnnestus"
    assert e["link"] == "/upload?resumeUpload=u2"


def test_normalize_reocr_single_done_links_page():
    singles = [{"job_id": "s1", "work_id": "wid", "slug": "w1", "page_number": 42,
                "status": "done", "slow": False, "started_at": 100.0, "error": None}]
    e = normalize_ocr_jobs([], singles, [], _title_of)[0]
    assert e["type"] == "reocr"
    assert e["title"] == "Teose Pealkiri"
    assert e["status_key"] == "ready"
    assert e["link"] == "/work/wid/42"
    assert e["page_number"] == 42


def test_normalize_reocr_single_no_page_links_work():
    singles = [{"job_id": "s2", "work_id": "wid", "slug": "w1", "page_number": None,
                "status": "done", "slow": False, "started_at": 100.0, "error": None}]
    e = normalize_ocr_jobs([], singles, [], _title_of)[0]
    assert e["link"] == "/work/wid"


def test_normalize_reocr_batch():
    batches = [{"job_id": "b1", "work_id": "wid", "slug": "w1", "status": "processing",
                "slow": True, "started_at": 50.0, "ready": 3, "total": 8}]
    e = normalize_ocr_jobs([], [], batches, _title_of)[0]
    assert e["type"] == "batch"
    assert e["status_key"] == "processing"
    assert e["slow"] is True
    assert e["progress"] == {"ready": 3, "total": 8}
    assert e["link"] == "/work/wid"


def test_normalize_missing_fields_and_sort():
    # started_at=None ei tohi sort'i crash'ida; title puudub → slug
    uploads = [{"id": "u3", "status": "processing",
                "meta": {"title": "", "slug": "slug-only", "work_id": None},
                "expected_pages": None, "created_at": "vigane-kuupäev", "files": []}]
    singles = [{"job_id": "s3", "work_id": "wid", "slug": "w1", "page_number": 1,
                "status": "processing", "slow": False, "started_at": None, "error": None}]
    out = normalize_ocr_jobs(uploads, singles, [], _title_of)
    assert len(out) == 2
    u = next(x for x in out if x["id"] == "u3")
    assert u["title"] == "slug-only"          # tühi title → slug
    assert u["started_at"] == 0.0             # vigane created_at → 0.0
    assert u["link"] == "/upload?resumeUpload=u3"


def test_normalize_sorted_desc():
    singles = [
        {"job_id": "a", "work_id": "wid", "slug": "w", "page_number": 1, "status": "done", "slow": False, "started_at": 10.0, "error": None},
        {"job_id": "b", "work_id": "wid", "slug": "w", "page_number": 2, "status": "done", "slow": False, "started_at": 30.0, "error": None},
        {"job_id": "c", "work_id": "wid", "slug": "w", "page_number": 3, "status": "done", "slow": False, "started_at": 20.0, "error": None},
    ]
    ids = [e["id"] for e in normalize_ocr_jobs([], singles, [], _title_of)]
    assert ids == ["b", "c", "a"]  # started_at DESC


def test_title_reader_reads_metadata(tmp_path, monkeypatch):
    import json
    import server.routers.ocr_jobs as oj
    work = tmp_path / "w1"
    work.mkdir()
    (work / "_metadata.json").write_text(json.dumps({"title": "Loetud Pealkiri"}), encoding="utf-8")
    monkeypatch.setattr(oj, "find_directory_by_id", lambda wid: str(work) if wid == "wid" else None)
    reader = oj._make_title_reader()
    assert reader("wid") == "Loetud Pealkiri"
    assert reader("puudub") == ""     # ei leidu → tühi (normaliseerija fallback slug'ile)
    # cache: teine kutse ei ava faili uuesti (sama tulemus)
    assert reader("wid") == "Loetud Pealkiri"


def test_normalize_includes_username():
    singles = [{"job_id": "s1", "work_id": "wid", "slug": "w1", "page_number": 1,
                "status": "processing", "slow": False, "started_at": 100.0,
                "error": None, "username": "mari"}]
    batches = [{"job_id": "b1", "work_id": "wid", "slug": "w1", "status": "processing",
                "slow": False, "started_at": 90.0, "ready": 0, "total": 2, "username": "jaan"}]
    uploads = [{"id": "u1", "status": "processing",
                "meta": {"title": "T", "slug": "t", "work_id": "wx"},
                "expected_pages": 3, "created_at": "2026-07-01T10:00:00", "files": []}]
    by_id = {e["id"]: e for e in normalize_ocr_jobs(uploads, singles, batches, _title_of)}
    assert by_id["s1"]["username"] == "mari"
    assert by_id["b1"]["username"] == "jaan"
    assert by_id["u1"]["username"] == ""   # upload ei salvesta kasutajanime


def test_normalize_upload_ada_fetching_is_uploading_not_error():
    """ada_fetching (server-poolne allalaadimine) EI ole viga — see peab
    kuvama nagu tavaline 'uploading', mitte punase veana Review-lehel."""
    uploads = [{"id": "u4", "status": "ada_fetching",
                "meta": {"title": "ADA teos", "slug": "ada-teos-x", "work_id": "wx"},
                "expected_pages": None, "created_at": "2026-07-01T10:00:00", "files": []}]
    e = normalize_ocr_jobs(uploads, [], [], _title_of)[0]
    assert e["status_key"] == "uploading"
    assert e["error"] is None


def test_normalize_upload_ada_error_reads_ada_error_message():
    """ADA-tõmbaja kirjutab vea `ada_error`-isse, mitte `error_message`-isse
    (vt server/upload/thumbs.py sama fallback)."""
    uploads = [{"id": "u5", "status": "ada_error", "ada_error": "ADA server ei vasta",
                "meta": {"title": "ADA teos", "slug": "ada-teos-x", "work_id": "wx"},
                "expected_pages": None, "created_at": "2026-07-01T10:00:00", "files": []}]
    e = normalize_ocr_jobs(uploads, [], [], _title_of)[0]
    assert e["status_key"] == "error"
    assert e["error"] == "ADA server ei vasta"


def test_normalize_upload_error_message_eelistab_error_message_valja():
    """Kui mõlemad on olemas, eelistatakse error_message (nagu thumbs.py-s)."""
    uploads = [{"id": "u6", "status": "error", "error_message": "tavaline viga",
                "ada_error": "seda ei tohiks näha",
                "meta": {"title": "X", "slug": "x", "work_id": "wx"},
                "expected_pages": None, "created_at": "2026-07-01T10:00:00", "files": []}]
    e = normalize_ocr_jobs(uploads, [], [], _title_of)[0]
    assert e["error"] == "tavaline viga"


def test_normalize_queue_ahead_across_all_active():
    # Aktiivsed single+batch erineva started_at-iga → ühtne järjekord üle tüüpide.
    # (float started_at, et vältida ISO/TZ-sõltuvust; done pole aktiivne → 0)
    singles = [{"job_id": "s1", "work_id": "wid", "slug": "w", "page_number": 1,
                "status": "processing", "slow": False, "started_at": 30.0, "error": None},
               {"job_id": "s2", "work_id": "wid", "slug": "w", "page_number": 2,
                "status": "done", "slow": False, "started_at": 10.0, "error": None}]  # done → mitte-aktiivne
    batches = [{"job_id": "b1", "work_id": "wid", "slug": "w", "status": "processing",
                "slow": False, "started_at": 25.0, "ready": 0, "total": 1}]
    by_id = {e["id"]: e for e in normalize_ocr_jobs([], singles, batches, _title_of)}
    # Aktiivsed started_at järgi: b1(25) < s1(30); done s2 pole aktiivne
    assert by_id["b1"]["queue_ahead"] == 0
    assert by_id["s1"]["queue_ahead"] == 1
    assert by_id["s2"]["queue_ahead"] == 0   # mitte-aktiivne → 0
