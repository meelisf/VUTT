"""scripts/detect_greek.py teoste-skaneerimise testid."""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))


def _make_work(tmp_path, slug, meta, pages):
    """Loob ajutise teose kausta: _metadata.json + lehed."""
    d = tmp_path / slug
    d.mkdir()
    (d / "_metadata.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    for name, text in pages.items():
        (d / name).write_text(text, encoding="utf-8")
    return str(d)


def test_scan_work_tuvastab_kreekakeelse_lehe(tmp_path):
    from detect_greek import scan_work
    d = _make_work(
        tmp_path, "1648-1-test",
        {"work_id": "abc123", "languages": ["lat"]},
        {"lk-001.txt": "Disputatio theologica de anima rationali",
         "lk-002.txt": "α" * 60 + " Latina"},
    )
    result = scan_work(d)
    assert result["qualifies"] is True
    assert result["greek_pages"] == ["lk-002.txt"]
    assert result["work_id"] == "abc123"
    assert result["already_tagged"] is False


def test_scan_work_juba_margitud(tmp_path):
    from detect_greek import scan_work
    d = _make_work(
        tmp_path, "1648-2-test",
        {"work_id": "def456", "languages": ["lat", "grc"]},
        {"lk-001.txt": "α" * 60},
    )
    result = scan_work(d)
    assert result["qualifies"] is True
    assert result["already_tagged"] is True


def test_scan_work_ilma_kreekata(tmp_path):
    from detect_greek import scan_work
    d = _make_work(
        tmp_path, "1648-3-test",
        {"work_id": "ghi789", "languages": ["lat"]},
        {"lk-001.txt": "Disputatio theologica"},
    )
    result = scan_work(d)
    assert result["qualifies"] is False
    assert result["greek_pages"] == []


def test_scan_work_puuduv_metadata_annab_none(tmp_path):
    from detect_greek import scan_work
    d = tmp_path / "1648-4-test"
    d.mkdir()
    (d / "lk-001.txt").write_text("α" * 60, encoding="utf-8")
    assert scan_work(str(d)) is None


def test_scan_work_vigane_metadata_annab_none(tmp_path):
    from detect_greek import scan_work
    d = tmp_path / "1648-5-test"
    d.mkdir()
    (d / "_metadata.json").write_text("{katki", encoding="utf-8")
    assert scan_work(str(d)) is None


def test_scan_work_ei_loe_alakriipsuga_faile(tmp_path):
    from detect_greek import scan_work
    d = _make_work(
        tmp_path, "1648-6-test",
        {"work_id": "jkl000", "languages": []},
        {"lk-001.txt": "Disputatio"},
    )
    # _notes.txt EI ole leheküljetekst ja seda ei tohi arvestada
    (tmp_path / "1648-6-test" / "_notes.txt").write_text("α" * 60, encoding="utf-8")
    result = scan_work(d)
    assert result["qualifies"] is False


def test_apply_work_kirjutab_ja_on_idempotentne(tmp_path):
    from detect_greek import apply_work
    d = _make_work(
        tmp_path, "1648-7-test",
        {"work_id": "mno111", "languages": ["lat"]},
        {"lk-001.txt": "α" * 60},
    )
    meta_path = os.path.join(d, "_metadata.json")

    assert apply_work(d) is True
    written = json.loads(open(meta_path, encoding="utf-8").read())
    assert written["languages"] == ["lat", "grc"]
    assert written["work_id"] == "mno111"  # ülejäänud väljad puutumata

    # Teistkordne jooks ei muuda midagi
    assert apply_work(d) is False


def test_scan_work_koguosakaal_arvestab_ladinakeelseid_lehti(tmp_path):
    """work_ratio nimetajas peavad olema KA lehed, kus kreekat ei ole.

    Regressioon: varem jäeti kreekata lehed nimetajast välja (`if ratio:`
    valvur), mistõttu koguosakaal oli süstemaatiliselt ülepaisutatud —
    kahe lehega teos, kus üks on täisladina, näitas 100 %.
    """
    from detect_greek import scan_work
    d = _make_work(
        tmp_path, "1648-8-test",
        {"work_id": "pqr222", "languages": ["lat"]},
        {"lk-001.txt": "a" * 40, "lk-002.txt": "α" * 60},
    )
    result = scan_work(d)
    # 60 kreeka / (60 kreeka + 40 ladina) = 0,6
    assert abs(result["work_ratio"] - 0.6) < 1e-9


def _git(tmp_path, *args):
    import subprocess
    return subprocess.run(["git", *args], cwd=str(tmp_path), capture_output=True, text=True)


def test_git_commit_ei_haara_voraid_muudatusi(tmp_path):
    """Commit tohib sisaldada AINULT selle jooksu muudetud faile.

    Regressioon: `git add -A` haaraks kaasa ka jooksva backendi uuendatud
    tuletatud indeksid (data/config/*.json), mis on tootmises praktiliselt
    alati muutunud. Keelemuudatuse tagasipööre võtaks siis maha midagi muud.
    """
    from detect_greek import _git_commit

    _git(tmp_path, "init", "-q")
    _git(tmp_path, "config", "user.email", "t@t")
    _git(tmp_path, "config", "user.name", "t")
    (tmp_path / "config").mkdir()
    (tmp_path / "config" / "index.json").write_text("{}", encoding="utf-8")
    (tmp_path / "1648-a").mkdir()
    (tmp_path / "1648-a" / "_metadata.json").write_text('{"languages":["lat"]}', encoding="utf-8")
    _git(tmp_path, "add", "-A")
    _git(tmp_path, "commit", "-qm", "algseis")

    # Backend uuendab indeksit, meie skript uuendab metaandmeid
    (tmp_path / "config" / "index.json").write_text('{"muutus": 1}', encoding="utf-8")
    (tmp_path / "1648-a" / "_metadata.json").write_text('{"languages":["lat","grc"]}', encoding="utf-8")

    assert _git_commit(str(tmp_path), ["1648-a/_metadata.json"]) is True

    committed = _git(tmp_path, "show", "--name-only", "--format=", "HEAD").stdout.split()
    assert committed == ["1648-a/_metadata.json"]
    # Võõras muudatus peab jääma committimata
    assert "config/index.json" in _git(tmp_path, "status", "--short").stdout
