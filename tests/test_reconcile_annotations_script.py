"""`scripts/reconcile_annotations.py` — korpuse-ülene lepitus (ADR 0041).

Skript jookseb tootmises KONTEINERIS ja kirjutab `data/` git'i. Testid katavad
otsustusloogika (mida ta leiab, mida kirjutab, mida ei puutu) ilma git'ita.
"""
import importlib.util
import json
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "reconcile_annotations.py"


@pytest.fixture(scope="module")
def skript():
    spec = importlib.util.spec_from_file_location("reconcile_annotations", SCRIPT)
    moodul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(moodul)
    return moodul


def _leht(work_dir: Path, stem, txt, annotations, wrapper=False, comments=None):
    (work_dir / f"{stem}.txt").write_text(txt, encoding="utf-8")
    meta = {"status": "Töös", "comments": comments or [],
            "text_annotations": annotations}
    (work_dir / f"{stem}.json").write_text(
        json.dumps({"meta_content": meta} if wrapper else meta, ensure_ascii=False),
        encoding="utf-8",
    )


def _ann(ann_id, comment="kahtlane"):
    return {"id": ann_id, "comment": comment, "author": "Külli",
            "created_at": "2026-06-17T13:43:22.585Z"}


@pytest.fixture
def korpus(tmp_path):
    """Neli lehte: terve, ankruta kirje, kirjeta ankur, wrapper-kujuga."""
    work = tmp_path / "1662-teos"
    work.mkdir()
    _leht(work, "p1", "A.o <ann2>1662</ann2>", [_ann(2)])                    # terve
    _leht(work, "p2", "ilma ankruta", [_ann(1, "vale aasta")])               # orb kirje
    _leht(work, "p3", "Brief von <ann7>Kuusalu</ann7>", [])                  # orb ankur
    _leht(work, "p4", "ilma ankruta", [_ann(3, "wrapper")], wrapper=True)
    # Mitte-lehed: ei tohi skaneeringusse sattuda
    (work / "_metadata.json").write_text('{"id": "x"}', encoding="utf-8")
    (work / "_notes.txt").write_text("märkmed", encoding="utf-8")
    return tmp_path, work


def test_iter_pages_jatab_alakriipsuga_failid_valja(skript, korpus):
    root, _ = korpus
    lehed = [Path(t).stem for _, t, _ in skript.iter_pages(str(root))]
    assert sorted(lehed) == ["p1", "p2", "p3", "p4"]


def test_terve_leht_ei_satu_leidudesse(skript, korpus):
    _, work = korpus
    assert skript.scan_page(str(work / "p1.txt"), str(work / "p1.json")) is None


def test_orb_kirje_leitakse_ja_muutub_kommentaariks(skript, korpus):
    _, work = korpus
    a = skript.scan_page(str(work / "p2.txt"), str(work / "p2.json"))
    assert a["kirjeid_kommentaariks"] == 1
    assert a["uusi_kommentaare"] == 1
    assert a["text_changed"] is False, "teksti ei tohi puutuda"
    assert "vale aasta" in a["page_json"]["comments"][0]["text"]


def test_orb_ankur_leitakse_ja_eemaldatakse(skript, korpus):
    _, work = korpus
    a = skript.scan_page(str(work / "p3.txt"), str(work / "p3.json"))
    assert a["text_changed"] is True
    assert a["text"] == "Brief von Kuusalu"


def test_wrapper_kuju_sailib(skript, korpus):
    """Vana `meta_content` wrapper ei tohi lepitusel lamedaks muutuda."""
    _, work = korpus
    a = skript.scan_page(str(work / "p4.txt"), str(work / "p4.json"))
    assert "meta_content" in a["page_json"]
    assert a["page_json"]["meta_content"]["text_annotations"] == []


def test_katkine_json_annab_vea_mitte_erindi(skript, tmp_path):
    work = tmp_path / "w"
    work.mkdir()
    (work / "p.txt").write_text("tekst", encoding="utf-8")
    (work / "p.json").write_text("{katki", encoding="utf-8")
    a = skript.scan_page(str(work / "p.txt"), str(work / "p.json"))
    assert "error" in a


def test_kuivkaivitus_ei_kirjuta_midagi(skript, korpus, monkeypatch, capsys):
    root, work = korpus
    enne = {p.name: p.read_bytes() for p in work.iterdir()}
    monkeypatch.setattr(skript, "_data_root", lambda: str(root))
    monkeypatch.setattr("sys.argv", ["reconcile_annotations.py"])

    assert skript.main() == 0

    assert {p.name: p.read_bytes() for p in work.iterdir()} == enne
    assert "Kuivkäivitus" in capsys.readouterr().out


def test_apply_kirjutab_ja_on_idempotentne(skript, korpus, monkeypatch, capsys):
    root, work = korpus
    monkeypatch.setattr(skript, "_data_root", lambda: str(root))
    monkeypatch.setattr("sys.argv", ["reconcile_annotations.py", "--apply"])

    assert skript.main() == 0
    assert (work / "p3.txt").read_text(encoding="utf-8") == "Brief von Kuusalu"
    assert json.loads((work / "p2.json").read_text())["text_annotations"] == []
    assert json.loads((work / "p1.json").read_text())["text_annotations"] == [_ann(2)], \
        "terve lehe JSON peab jääma puutumata"

    capsys.readouterr()
    assert skript.main() == 0
    assert "Kõik ankrud ja kirjed klapivad" in capsys.readouterr().out


def test_apply_ilma_commitita_ei_kutsu_git(skript, korpus, monkeypatch):
    root, _ = korpus
    monkeypatch.setattr(skript, "_data_root", lambda: str(root))
    kutsutud = []
    monkeypatch.setattr(skript, "_git_commit",
                        lambda *a: kutsutud.append(a) or True)
    monkeypatch.setattr("sys.argv", ["reconcile_annotations.py", "--apply"])

    skript.main()

    assert kutsutud == []


def test_commit_laval_ainult_muudetud_failid(skript, korpus, monkeypatch):
    """`git add -A` korjaks kaasa tuletatud indeksid (ADR 0007)."""
    root, _ = korpus
    monkeypatch.setattr(skript, "_data_root", lambda: str(root))
    salvestatud = {}

    def _fake_commit(data_root, paths, pages):
        salvestatud["paths"] = paths
        salvestatud["pages"] = pages
        return True

    monkeypatch.setattr(skript, "_git_commit", _fake_commit)
    monkeypatch.setattr("sys.argv",
                        ["reconcile_annotations.py", "--apply", "--commit"])

    assert skript.main() == 0

    assert salvestatud["pages"] == 3, "p1 on terve — ei lähe arvesse"
    nimed = sorted(Path(p).name for p in salvestatud["paths"])
    assert nimed == ["p2.json", "p3.json", "p3.txt", "p4.json"]
    assert all(not Path(p).is_absolute() for p in salvestatud["paths"]), \
        "teed peavad olema data/ suhtes, muidu git add ei leia neid"
