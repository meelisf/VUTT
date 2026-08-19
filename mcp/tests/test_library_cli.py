from library_fixtures import FakeZoteroAPI, kirje, kollektsioon, make_pdf, manus

from vutt_mcp.library.cli import main

KOGUD = [kollektsioon("K1", "VUTT kirjandus")]
VANEM = kirje("ITEM0001", title="Teos", date="1984",
              creators=[{"creatorType": "editor", "firstName": "Arvo",
                         "lastName": "Tering"}])


def _kogu(tmp_path, monkeypatch, base):
    kaust = tmp_path / "storage" / "ATT00001"
    kaust.mkdir(parents=True, exist_ok=True)
    make_pdf(kaust / "f.pdf", ["Ludenius", "teine"])
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("VUTT_LIBRARY_DB", str(tmp_path / "library.db"))
    monkeypatch.setenv("VUTT_LIBRARY_ZOTERO_DIR", str(tmp_path))
    monkeypatch.setenv("VUTT_LIBRARY_ZOTERO_API", base)


def test_index_kaib_ja_teatab(tmp_path, capsys, monkeypatch):
    items = {"K1": [VANEM, manus("ATT00001", "ITEM0001", filename="f.pdf")]}
    with FakeZoteroAPI(collections=KOGUD, items=items) as base:
        _kogu(tmp_path, monkeypatch, base)
        assert main(["index"]) == 0
    valjund = capsys.readouterr().out
    assert "1 uus" in valjund
    assert "VUTT kirjandus" in valjund
    assert (tmp_path / "library.db").exists()


def test_status_naitab_kogu(tmp_path, capsys, monkeypatch):
    items = {"K1": [VANEM, manus("ATT00001", "ITEM0001", filename="f.pdf")]}
    with FakeZoteroAPI(collections=KOGUD, items=items) as base:
        _kogu(tmp_path, monkeypatch, base)
        main(["index"])
        assert main(["status"]) == 0
    assert "1 teost" in capsys.readouterr().out


def test_status_ilma_indeksita(tmp_path, capsys, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("VUTT_LIBRARY_DB", str(tmp_path / "pole.db"))
    assert main(["status"]) == 1
    assert "ei ole" in capsys.readouterr().out


def test_kattesaamatu_zotero_annab_juhise(tmp_path, capsys, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("VUTT_LIBRARY_DB", str(tmp_path / "l.db"))
    monkeypatch.setenv("VUTT_LIBRARY_ZOTERO_API", "http://127.0.0.1:1/api/users/0")
    assert main(["index"]) == 1
    assert "Zotero" in capsys.readouterr().err


def test_full_lipp_ehitab_uuesti(tmp_path, capsys, monkeypatch):
    items = {"K1": [VANEM, manus("ATT00001", "ITEM0001", filename="f.pdf")]}
    with FakeZoteroAPI(collections=KOGUD, items=items) as base:
        _kogu(tmp_path, monkeypatch, base)
        main(["index"])
        capsys.readouterr()
        assert main(["index", "--full"]) == 0
    assert "1 uus" in capsys.readouterr().out
