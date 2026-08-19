import json

import pytest
from library_fixtures import FakeZoteroAPI, kirje, kollektsioon, make_pdf, manus

from vutt_mcp.library.config import LibrarySettings
from vutt_mcp.library.indexer import IndexLock, IndexLocked, run_index
from vutt_mcp.library.schema import connect

KOGUD = [kollektsioon("K1", "VUTT kirjandus")]
VANEM = kirje("ITEM0001", title="Teos", date="1984",
              creators=[{"creatorType": "editor", "firstName": "Arvo",
                         "lastName": "Tering"}])


def _pdf(tmp_path, att_key, lehed, labels=None):
    kaust = tmp_path / "storage" / att_key
    kaust.mkdir(parents=True, exist_ok=True)
    make_pdf(kaust / "f.pdf", lehed, labels=labels)


def _settings(tmp_path, base):
    return LibrarySettings(db_path=tmp_path / "library.db",
                           collection="VUTT kirjandus", zotero_dir=tmp_path,
                           api_base=base)


def test_esimene_jooks_indekseerib(tmp_path):
    _pdf(tmp_path, "ATT00001", ["Ludenius", "teine"])
    items = {"K1": [VANEM, manus("ATT00001", "ITEM0001", filename="f.pdf")]}
    with FakeZoteroAPI(collections=KOGUD, items=items) as base:
        aruanne = run_index(_settings(tmp_path, base))
    assert aruanne.added == 1
    conn = connect(tmp_path / "library.db", read_only=True)
    assert conn.execute("SELECT COUNT(*) FROM pages").fetchone()[0] == 2
    assert conn.execute("SELECT title FROM documents").fetchone()[0] == "Teos"


def test_muutumatu_jaab_vahele(tmp_path):
    _pdf(tmp_path, "ATT00001", ["a", "b"])
    items = {"K1": [VANEM, manus("ATT00001", "ITEM0001", filename="f.pdf")]}
    with FakeZoteroAPI(collections=KOGUD, items=items) as base:
        s = _settings(tmp_path, base)
        run_index(s)
        teine = run_index(s)
    assert teine.skipped == 1 and teine.added == 0 and teine.updated == 0


def test_bibliokirje_muutus_uuendab_ilma_pdf_muutuseta(tmp_path):
    _pdf(tmp_path, "ATT00001", ["a", "b"])
    m = manus("ATT00001", "ITEM0001", filename="f.pdf")
    with FakeZoteroAPI(collections=KOGUD, items={"K1": [VANEM, m]}) as base:
        run_index(_settings(tmp_path, base))
    parandatud = kirje("ITEM0001", title="Parandatud", date="1984", creators=[])
    with FakeZoteroAPI(collections=KOGUD, items={"K1": [parandatud, m]}) as base:
        aruanne = run_index(_settings(tmp_path, base))
    assert aruanne.updated == 1
    conn = connect(tmp_path / "library.db", read_only=True)
    assert conn.execute("SELECT title FROM documents").fetchone()[0] == "Parandatud"


def test_sidecar_muutus_uuendab_numeratsiooni(tmp_path):
    _pdf(tmp_path, "ATT00001", ["a", "b"])
    items = {"K1": [VANEM, manus("ATT00001", "ITEM0001", filename="f.pdf")]}
    with FakeZoteroAPI(collections=KOGUD, items=items) as base:
        s = _settings(tmp_path, base)
        run_index(s)
        sc = s.db_path.parent / "sidecar" / "ATT00001.override.json"
        sc.parent.mkdir(parents=True, exist_ok=True)
        sc.write_text(json.dumps({"ranges": [
            {"pdf_from": 1, "pdf_to": 2, "style": "arabic",
             "printed_from": "100"}]}))
        aruanne = run_index(s)
    assert aruanne.updated == 1
    conn = connect(tmp_path / "library.db", read_only=True)
    sildid = [r[0] for r in conn.execute(
        "SELECT printed_page FROM pages ORDER BY pdf_page")]
    assert sildid == ["100", "101"]


def test_kollektsioonist_eemaldamine_kustutab_indeksist(tmp_path):
    _pdf(tmp_path, "ATT00001", ["a"])
    items = {"K1": [VANEM, manus("ATT00001", "ITEM0001", filename="f.pdf")]}
    with FakeZoteroAPI(collections=KOGUD, items=items) as base:
        run_index(_settings(tmp_path, base))
    with FakeZoteroAPI(collections=KOGUD, items={"K1": []}) as base:
        aruanne = run_index(_settings(tmp_path, base))
    assert aruanne.removed == 1
    conn = connect(tmp_path / "library.db", read_only=True)
    assert conn.execute("SELECT COUNT(*) FROM documents").fetchone()[0] == 0
    assert conn.execute("SELECT COUNT(*) FROM pages_fts").fetchone()[0] == 0


def test_kadunud_fail_sailitab_teksti(tmp_path):
    _pdf(tmp_path, "ATT00001", ["Ludenius"])
    items = {"K1": [VANEM, manus("ATT00001", "ITEM0001", filename="f.pdf")]}
    with FakeZoteroAPI(collections=KOGUD, items=items) as base:
        s = _settings(tmp_path, base)
        run_index(s)
        (tmp_path / "storage" / "ATT00001" / "f.pdf").unlink()
        aruanne = run_index(s)
    assert "ATT00001" in aruanne.broken_links
    conn = connect(tmp_path / "library.db", read_only=True)
    assert conn.execute("SELECT COUNT(*) FROM pages").fetchone()[0] == 1
    assert conn.execute("SELECT file_missing FROM documents").fetchone()[0] == 1


def test_alamkollektsioonid_indekseeritakse(tmp_path):
    _pdf(tmp_path, "ATT00001", ["ylem"])
    _pdf(tmp_path, "ATT00002", ["alam"])
    kogud = KOGUD + [kollektsioon("K2", "Alam", parent="K1")]
    items = {"K1": [VANEM, manus("ATT00001", "ITEM0001", filename="f.pdf")],
             "K2": [VANEM, manus("ATT00002", "ITEM0001", filename="f.pdf")]}
    with FakeZoteroAPI(collections=kogud, subcollections={"K1": ["K2"]},
                       items=items) as base:
        aruanne = run_index(_settings(tmp_path, base))
    assert aruanne.added == 2
    assert "Alam" in " ".join(aruanne.subcollections)


def test_lukk_valistab_teise_jooksu(tmp_path):
    with FakeZoteroAPI(collections=KOGUD, items={"K1": []}) as base:
        s = _settings(tmp_path, base)
        with IndexLock(s.db_path):
            with pytest.raises(IndexLocked):
                run_index(s)


def test_katkestatud_jooks_jatab_eelmise_indeksi_terveks(tmp_path, monkeypatch):
    _pdf(tmp_path, "ATT00001", ["esimene"])
    items = {"K1": [VANEM, manus("ATT00001", "ITEM0001", filename="f.pdf")]}
    with FakeZoteroAPI(collections=KOGUD, items=items) as base:
        s = _settings(tmp_path, base)
        run_index(s)

        import vutt_mcp.library.indexer as idx

        def kukub(*a, **kw):
            raise RuntimeError("katkestus")

        monkeypatch.setattr(idx, "extract_pages", kukub)
        (tmp_path / "storage" / "ATT00001" / "f.pdf").write_bytes(b"%PDF-1.4 uus")
        with pytest.raises(RuntimeError):
            run_index(s)
    conn = connect(tmp_path / "library.db", read_only=True)
    assert conn.execute("SELECT COUNT(*) FROM pages").fetchone()[0] == 1
