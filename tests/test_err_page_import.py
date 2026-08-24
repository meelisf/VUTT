"""Ebaõnnestunud lehe peab saama VUTT-i importida (#250 järelparandus).

Tühi lehekülg on osa raamatust: kui OCR ei anna teksti (tühi leht, kordusloop),
ei tohi see lehte impordist välja jätta ega tervet importi blokeerida — kasutaja
kirjutab teksti Workspace'is käsitsi juurde. Enne: `has_ocr=False` leht kadus
vaikselt importable-filtrist ja lehed nihkusid.
"""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import ocr_err, upload_ops
from server.upload import import_work, state as upload_state


class _ImportSftp:
    """SFTP fake: leht 2 on .err-iga (teksti ei ole)."""

    def __init__(self, items):
        self.items = items
        self.get_calls = []

    def listdir(self, _path):
        return self.items

    def get(self, remote, local):
        self.get_calls.append(remote)
        if remote.endswith(".jpg"):
            Path(local).write_bytes(b"jpg")
        elif remote.endswith(".txt"):
            if Path(remote).name not in self.items:
                raise FileNotFoundError(remote)
            Path(local).write_text("OCR tekst", encoding="utf-8")
        else:
            raise FileNotFoundError(remote)

    def close(self):
        pass


def test_kategooria_parsimine():
    """Kategooria on ESIMENE väli — kasutaja otsus sõltub vea liigist."""
    assert ocr_err.parse_err("mudel: KordusLoop: periood 1") == ("mudel", "KordusLoop: periood 1")
    assert ocr_err.parse_err("pilt: UnidentifiedImageError: x") == ("pilt", "UnidentifiedImageError: x")
    # Vana märgend ilma kategooriata → tundmatu, EI ole imporditav (ettevaatlik suund)
    assert ocr_err.parse_err("UnidentifiedImageError: x") == ("", "UnidentifiedImageError: x")
    assert ocr_err.on_imporditav_tuhjana("mudel: X: y") is True
    assert ocr_err.on_imporditav_tuhjana("pilt: X: y") is False
    assert ocr_err.on_imporditav_tuhjana("kirjutus: X: y") is False
    assert ocr_err.on_imporditav_tuhjana("vana margend") is False


def test_validate_lubab_mudeli_vea_lehe():
    """Preflight ei tohi mudeli vea pärast tervet importi katkestada."""
    importable = [{"page": 1, "has_ocr": True},
                  {"page": 2, "has_ocr": False, "ocr_error": "mudel: KordusLoop: periood 1"}]
    remote = ["w_pg_001.jpg", "w_pg_001.txt", "w_pg_002.jpg", "w_pg_002.err"]

    jpg_map = import_work.validate_remote_ocr_files(
        importable, remote, lambda b: int(b.rsplit("_pg_", 1)[1]))

    assert jpg_map[2] == "w_pg_002.jpg", "vigane leht kuulub endiselt teosesse"


def test_validate_blokeerib_pildi_vea():
    """Katkist skaneeringut EI SAA käsitsi transkribeerida — tühjana import oleks vale."""
    importable = [{"page": 1, "has_ocr": True},
                  {"page": 2, "has_ocr": False, "ocr_error": "pilt: UnidentifiedImageError: x"}]
    remote = ["w_pg_001.jpg", "w_pg_001.txt", "w_pg_002.jpg", "w_pg_002.err"]

    with pytest.raises(ValueError, match="skaneering ei ole kasutatav"):
        import_work.validate_remote_ocr_files(
            importable, remote, lambda b: int(b.rsplit("_pg_", 1)[1]))


def test_validate_kaebab_endiselt_puuduva_txt_ule():
    """Regressioon: ilma .err-ita puuduv TXT on endiselt viga (leht on veel teel)."""
    with pytest.raises(ValueError, match="TXT puudub"):
        import_work.validate_remote_ocr_files(
            [{"page": 1, "has_ocr": True}], ["w_pg_001.jpg"],
            lambda b: int(b.rsplit("_pg_", 1)[1]))


def test_err_leht_imporditakse_tuhja_tekstiga(tmp_path, monkeypatch):
    """Leht jõuab teosesse, tekst on tühi, järjekord ei nihku."""
    import server.git_ops as git_ops
    import server.meilisearch_ops as meili_ops
    import server.prosopography.indices as prosopo_indices
    import server.prosopography.person_crud as person_crud

    uploads = tmp_path / "uploads"
    (uploads / "imp1" / "thumbs").mkdir(parents=True)
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    monkeypatch.setattr(upload_ops, "UPLOADS_DIR", str(uploads))
    monkeypatch.setattr(upload_state, "UPLOADS_DIR", str(uploads))
    monkeypatch.setattr(upload_ops, "BASE_DIR", str(data_dir))
    monkeypatch.setattr(git_ops, "commit_new_work_to_git", lambda *a, **kw: True)
    monkeypatch.setattr(meili_ops, "sync_work_to_meilisearch", lambda slug: True)
    monkeypatch.setattr(person_crud, "ensure_prosopo_stubs", lambda metadata, username=None: {})
    monkeypatch.setattr(prosopo_indices, "update_person_to_works", lambda *a, **kw: None)
    monkeypatch.setattr(prosopo_indices, "update_work_collections", lambda *a, **kw: None)
    monkeypatch.setattr(upload_ops, "_ssh_rm_rf", lambda *a, **kw: None)
    monkeypatch.setattr(upload_ops, "close_ssh", lambda *a, **kw: None)

    sftp = _ImportSftp(["test-teos_pg_001.jpg", "test-teos_pg_001.txt",
                        "test-teos_pg_002.jpg", "test-teos_pg_002.err",
                        "test-teos_pg_003.jpg", "test-teos_pg_003.txt"])
    monkeypatch.setattr(upload_ops, "_sftp_open", lambda uid: sftp)

    (uploads / "imp1" / "state.json").write_text(json.dumps({
        "id": "imp1", "status": "reviewing",
        "meta": {"title": "Test teos", "year": "1700", "slug": "test-teos", "work_id": "wid123"},
        "remote_staging_path": "AUTO-OCR/print/imp1",
        "remote_work_path": "AUTO-OCR/print/imp1/test-teos",
        "files": [
            {"page": 1, "has_ocr": True, "deleted": False},
            {"page": 2, "has_ocr": False, "deleted": False,
             "ocr_error": "mudel: KordusLoop: periood 1, 40 kordust",
             "ocr_error_kind": "mudel"},
            {"page": 3, "has_ocr": True, "deleted": False},
        ],
    }), encoding="utf-8")

    tulemus = upload_ops.import_as_work("imp1", username="admin")

    assert tulemus["slug"] == "test-teos"
    lehed = sorted(p.name for p in (data_dir / "test-teos").glob("*.txt"))
    assert len(lehed) == 3, "vigane leht ei tohi impordist välja kukkuda"
    # Lehe 2 tekst on TÜHI, mitte puudu — kasutaja täidab selle Workspace'is
    keskmine = [p for p in (data_dir / "test-teos").glob("*.txt") if "002" in p.name]
    assert keskmine and keskmine[0].read_text(encoding="utf-8") == ""
    # Skaneering on olemas — see ongi see, mida kasutaja käsitsi transkribeerib
    assert [p for p in (data_dir / "test-teos").glob("*.jpg") if "002" in p.name]
    assert not any(r.endswith("test-teos_pg_002.txt") for r in sftp.get_calls)
