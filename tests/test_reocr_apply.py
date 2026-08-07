"""Batch re-OCR tulemuste rakendamine (.ocr → .txt) päris ajutises git-repos."""
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server.git_ops as git_ops
from git import Repo


@pytest.fixture
def work(tmp_path, monkeypatch):
    """Ajutine git-repo ühe teosekaustaga; pg1-l on juba tekst, pg2-l ei ole."""
    r = Repo.init(str(tmp_path))
    with r.config_writer() as cw:
        cw.set_value("user", "name", "t").set_value("user", "email", "t@t")
    folder = tmp_path / "1690-w1"
    folder.mkdir()
    (folder / "pg1.txt").write_text("vana tekst", encoding="utf-8")
    r.index.add([os.path.relpath(str(folder / "pg1.txt"), str(tmp_path))])
    r.index.commit("init")
    monkeypatch.setattr(git_ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(git_ops, "get_or_init_repo", lambda: r)
    return {"repo": r, "folder": folder}


def test_apply_kirjutab_txt_ja_kustutab_ocr(work):
    from server.reocr_apply import apply_ocr_results
    folder = work["folder"]
    (folder / "pg2.ocr").write_text("uus tekst", encoding="utf-8")

    result = apply_ocr_results(str(folder), ["pg2.jpg"], "admin")

    assert result["applied"] == ["pg2.jpg"]
    assert result["failed"] == []
    assert result["git_committed"] is True
    assert (folder / "pg2.txt").read_text(encoding="utf-8") == "uus tekst"
    assert not (folder / "pg2.ocr").exists()


def test_apply_kirjutab_olemasoleva_teksti_ule(work):
    from server.reocr_apply import apply_ocr_results
    folder = work["folder"]
    (folder / "pg1.ocr").write_text("OCR-i uus versioon", encoding="utf-8")

    apply_ocr_results(str(folder), ["pg1.jpg"], "admin")

    assert (folder / "pg1.txt").read_text(encoding="utf-8") == "OCR-i uus versioon"


def test_apply_normaliseerib_marginaalia(work):
    from server.reocr_apply import apply_ocr_results
    folder = work["folder"]
    # Ristuv <i><m> — normalize_marginalia_tags teeb <m> välimiseks tägiks
    (folder / "pg2.ocr").write_text("<i><m>Ratio 4.</m></i>", encoding="utf-8")

    apply_ocr_results(str(folder), ["pg2.jpg"], "admin")

    assert (folder / "pg2.txt").read_text(encoding="utf-8") == "<m><i>Ratio 4.</i></m>"


def test_apply_mitu_lehte_uks_commit(work):
    from server.reocr_apply import apply_ocr_results
    folder = work["folder"]
    for n in ("pg2", "pg3", "pg4"):
        (folder / f"{n}.ocr").write_text(f"tekst {n}", encoding="utf-8")
    before = len(list(work["repo"].iter_commits()))

    result = apply_ocr_results(str(folder), ["pg2.jpg", "pg3.jpg", "pg4.jpg"], "admin")

    assert len(result["applied"]) == 3
    assert len(list(work["repo"].iter_commits())) == before + 1  # ÜKS commit
    assert (folder / "pg4.txt").read_text(encoding="utf-8") == "tekst pg4"


def test_apply_puuduv_ocr_ei_katkesta_ulejaanuid(work):
    from server.reocr_apply import apply_ocr_results
    folder = work["folder"]
    (folder / "pg2.ocr").write_text("olemas", encoding="utf-8")

    result = apply_ocr_results(str(folder), ["pg2.jpg", "puudub.jpg"], "admin")

    assert result["applied"] == ["pg2.jpg"]
    assert result["failed"] == [{"filename": "puudub.jpg", "error": ".ocr fail puudub"}]
    assert (folder / "pg2.txt").exists()


def test_apply_tuhi_tulemus_ei_commiti(work):
    from server.reocr_apply import apply_ocr_results
    before = len(list(work["repo"].iter_commits()))

    result = apply_ocr_results(str(work["folder"]), ["puudub.jpg"], "admin")

    assert result["applied"] == []
    assert result["git_committed"] is False
    assert len(list(work["repo"].iter_commits())) == before


def test_discard_kustutab_ainult_ocr(work):
    from server.reocr_apply import discard_ocr_results
    folder = work["folder"]
    (folder / "pg1.ocr").write_text("ootel", encoding="utf-8")

    result = discard_ocr_results(str(folder), ["pg1.jpg", "puudub.jpg"])

    assert result["discarded"] == ["pg1.jpg"]
    assert result["failed"] == [{"filename": "puudub.jpg", "error": ".ocr fail puudub"}]
    assert not (folder / "pg1.ocr").exists()
    assert (folder / "pg1.txt").read_text(encoding="utf-8") == "vana tekst"  # puutumata
