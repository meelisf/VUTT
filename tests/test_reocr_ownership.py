"""Re-OCR tulemuse omand: kes kirjutas, see kustutab (#217).

Plaanitud lehtede nimekiri EI OLE omandi tõend — katkestatud töö ei pruukinud
jõuda kõiki plaanitud lehti puutuda.
"""
import os

import pytest

from server import reocr_ops


@pytest.fixture
def work_dir(tmp_path, monkeypatch):
    """Teose kaust + eraldatud varukoopiate juur."""
    slug = "1650-test-abc123"
    d = tmp_path / slug
    d.mkdir()
    monkeypatch.setattr(reocr_ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(reocr_ops, "REOCR_BACKUPS_DIR", str(tmp_path / "backups"))
    monkeypatch.setattr(
        reocr_ops.reocr_state, "BACKUP_TARGETS_DIR", str(tmp_path / "targets")
    )
    return slug, d


def test_kirjutamine_loob_ocr_faili(work_dir):
    slug, d = work_dir
    path = reocr_ops._write_ocr_file(slug, "001.jpg", "tekst", "job1")
    assert os.path.basename(path) == "001.ocr"
    assert open(path, encoding="utf-8").read() == "tekst"


def test_olemasolev_ocr_varundatakse_enne_ylekirjutamist(work_dir):
    """Vana ootel tulemus ei tohi jäljetult kaduda."""
    slug, d = work_dir
    (d / "017.ocr").write_text("VANA ootel tulemus", encoding="utf-8")

    reocr_ops._write_ocr_file(slug, "017.jpg", "UUS tulemus", "job1")

    assert (d / "017.ocr").read_text(encoding="utf-8") == "UUS tulemus"
    backup = os.path.join(reocr_ops._backup_dir("job1"), "017.ocr")
    assert open(backup, encoding="utf-8").read() == "VANA ootel tulemus"


def test_varundust_ei_tehta_kui_faili_polnud(work_dir):
    slug, d = work_dir
    reocr_ops._write_ocr_file(slug, "002.jpg", "tekst", "job1")
    assert not os.path.exists(os.path.join(reocr_ops._backup_dir("job1"), "002.ocr"))


def test_ainult_esimene_ylekirjutus_varundatakse(work_dir):
    """Sama töö kordusjooks EI TOHI varukoopiat oma tulemusega üle kirjutada."""
    slug, d = work_dir
    (d / "017.ocr").write_text("ALGNE", encoding="utf-8")

    reocr_ops._write_ocr_file(slug, "017.jpg", "esimene", "job1")
    reocr_ops._write_ocr_file(slug, "017.jpg", "teine", "job1")

    backup = os.path.join(reocr_ops._backup_dir("job1"), "017.ocr")
    assert open(backup, encoding="utf-8").read() == "ALGNE"


def test_taastamine_toob_vana_sisu_tagasi(work_dir):
    slug, d = work_dir
    (d / "017.ocr").write_text("VANA", encoding="utf-8")
    reocr_ops._write_ocr_file(slug, "017.jpg", "UUS", "job1")

    restored = reocr_ops._restore_backups("job1")

    assert restored == 1
    assert (d / "017.ocr").read_text(encoding="utf-8") == "VANA"
    assert not os.path.isdir(reocr_ops._backup_dir("job1"))


def test_varukoopiate_kustutamine_ei_puutu_teose_faile(work_dir):
    slug, d = work_dir
    (d / "017.ocr").write_text("VANA", encoding="utf-8")
    reocr_ops._write_ocr_file(slug, "017.jpg", "UUS", "job1")

    reocr_ops._drop_backups("job1")

    assert (d / "017.ocr").read_text(encoding="utf-8") == "UUS"
    assert not os.path.isdir(reocr_ops._backup_dir("job1"))


def test_varukoopia_tee_on_state_all_mitte_teose_kaustas(work_dir):
    """data/.gitignore ignoreerib *.ocr, aga mitte *.ocr.bak.* — varukoopia
    teose kaustas ilmuks git status'isse."""
    slug, d = work_dir
    assert "backups" in reocr_ops._backup_dir("job1")
    assert slug not in reocr_ops._backup_dir("job1")


def test_taastamine_ilma_varukoopiateta_on_ohutu(work_dir):
    assert reocr_ops._restore_backups("puudub") == 0


# --- produced_pages: mida see töö PÄRISELT tootis ---

def test_produced_pages_taidetakse_kirjutamise_hetkel():
    """Loend peab kasvama siis, kui .ocr PÄRISELT kirjutatakse — mitte tööd
    käivitades. Plaanitud ≠ toodetud."""
    job = {"produced_pages": []}

    reocr_ops._record_produced(job, "017.jpg")
    reocr_ops._record_produced(job, "018.jpg")
    reocr_ops._record_produced(job, "017.jpg")   # kordus ei tohi duplitseerida

    assert job["produced_pages"] == ["017", "018"]


def test_uus_too_algab_tuhja_produced_pages_iga():
    job = {}
    reocr_ops._record_produced(job, "001.jpg")
    assert job["produced_pages"] == ["001"]
