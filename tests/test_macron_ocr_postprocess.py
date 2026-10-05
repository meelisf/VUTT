"""ADR 0062 samm b: OCR-väljundi järeltöötlus tilde → makron (#533).

Kuni uue trükimudelini kirjutab OCR tildet; iga tee, mis OCR-teksti VUTT-i
toob (upload'i import, teose asendus, re-OCR .ocr staging, üksiktöö tekst,
.ocr rakendamine), peab läbima sama teisenduse ja keelevalvuri.
"""
import json

import pytest

from server import reocr_ops
from server.macron import convert_ocr_text, work_languages
from server.upload.import_work import normalize_txt_file

LADINA = "cũ nõ Camm̃erherr"
LADINA_MAKRON = "cū nō Camm̄erherr"


def _teos(kaust, languages):
    kaust.mkdir(exist_ok=True)
    (kaust / "_metadata.json").write_text(
        json.dumps({"languages": languages}), encoding="utf-8")
    return kaust


@pytest.mark.parametrize("languages, oodatud", [
    (["lat"], LADINA_MAKRON),
    ([], LADINA_MAKRON),
    (["lat", "est"], LADINA),        # valvur: eesti õ on täht
    (["spa"], LADINA),
    (None, LADINA),                  # keel teadmata → ei riskita
])
def test_convert_ocr_text_valvur(languages, oodatud):
    assert convert_ocr_text(LADINA, languages) == oodatud


def test_work_languages(tmp_path):
    assert work_languages(str(tmp_path)) is None           # metaandmed puuduvad
    (tmp_path / "_metadata.json").write_text("{katki", encoding="utf-8")
    assert work_languages(str(tmp_path)) is None
    _teos(tmp_path, ["lat", "grc"])
    assert work_languages(str(tmp_path)) == ["lat", "grc"]
    (tmp_path / "_metadata.json").write_text("{}", encoding="utf-8")
    assert work_languages(str(tmp_path)) == []


def test_import_teisendab_ja_normaliseerib_marginaalia(tmp_path):
    txt = tmp_path / "lk.txt"
    txt.write_text("<i><m>cũ</m></i>", encoding="utf-8")
    normalize_txt_file(str(txt), ["lat"])
    assert txt.read_text(encoding="utf-8") == "<m><i>cū</i></m>"


def test_import_eesti_teos_jaab_puutumata(tmp_path):
    txt = tmp_path / "lk.txt"
    txt.write_text("sõna cũ", encoding="utf-8")
    normalize_txt_file(str(txt), ["est"])
    assert txt.read_text(encoding="utf-8") == "sõna cũ"


@pytest.fixture
def reocr_baas(tmp_path, monkeypatch):
    monkeypatch.setattr(reocr_ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(reocr_ops, "REOCR_BACKUPS_DIR", str(tmp_path / "backups"))
    return tmp_path


def test_ocr_staging_teisendab_teose_keele_jargi(reocr_baas):
    _teos(reocr_baas / "1650-lat", ["lat"])
    _teos(reocr_baas / "1850-est", ["est"])

    reocr_ops._write_ocr_file("1650-lat", "001.jpg", LADINA, "j1")
    reocr_ops._write_ocr_file("1850-est", "001.jpg", LADINA, "j2")

    assert (reocr_baas / "1650-lat" / "001.ocr").read_text(encoding="utf-8") == LADINA_MAKRON
    assert (reocr_baas / "1850-est" / "001.ocr").read_text(encoding="utf-8") == LADINA


def test_apply_teisendab_vana_ocr_staging(tmp_path, monkeypatch):
    """Enne järeltöötlust kirjutatud .ocr ei tohi rakendamisel tildet lehele viia."""
    from git import Repo
    import server.git_ops as git_ops
    from server.reocr_apply import apply_ocr_results

    r = Repo.init(str(tmp_path))
    with r.config_writer() as cw:
        cw.set_value("user", "name", "t").set_value("user", "email", "t@t")
    teos = _teos(tmp_path / "1650-lat", ["lat"])
    (teos / "pg1.ocr").write_text(LADINA, encoding="utf-8")
    monkeypatch.setattr(git_ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(git_ops, "get_or_init_repo", lambda: r)

    apply_ocr_results(str(teos), ["pg1.jpg"], "admin")

    assert (teos / "pg1.txt").read_text(encoding="utf-8") == LADINA_MAKRON
