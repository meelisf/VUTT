import pytest
from library_fixtures import FakeZoteroAPI, kirje, kollektsioon, manus

from vutt_mcp.library.zotero import ZoteroError, iter_documents

KOGUD = [kollektsioon("K1", "VUTT kirjandus")]
VANEM = kirje("ITEM0001", title="Album academicum", date="1984-05",
              place="Tartu", publisher="Eesti Raamat",
              creators=[{"creatorType": "editor", "firstName": "Arvo",
                         "lastName": "Tering"}])


def _tee_fail(tmp_path, att_key, nimi="f.pdf"):
    kaust = tmp_path / "storage" / att_key
    kaust.mkdir(parents=True, exist_ok=True)
    (kaust / nimi).write_bytes(b"%PDF-1.4")
    return tmp_path / "storage"


def test_imporditud_fail_leitakse_storagest(tmp_path):
    storage = _tee_fail(tmp_path, "ATT00001")
    items = {"K1": [VANEM, manus("ATT00001", "ITEM0001", filename="f.pdf")]}
    with FakeZoteroAPI(collections=KOGUD, items=items) as base:
        docs = iter_documents(base, storage, ["K1"])
    assert len(docs) == 1
    d = docs[0]
    assert d.doc_id == "ATT00001"
    assert d.parent_key == "ITEM0001"
    assert d.file_missing is False
    assert d.bib.title == "Album academicum"
    assert d.bib.year == "1984"
    assert d.bib.creators == [["Arvo Tering", "editor"]]
    assert d.bib.publisher == "Eesti Raamat"


def test_lingitud_absoluutne_tee(tmp_path):
    fail = tmp_path / "kettal.pdf"
    fail.write_bytes(b"%PDF-1.4")
    items = {"K1": [VANEM, manus("ATT00001", "ITEM0001",
                                 link_mode="linked_file", path=str(fail))]}
    with FakeZoteroAPI(collections=KOGUD, items=items) as base:
        docs = iter_documents(base, tmp_path / "storage", ["K1"])
    assert docs[0].path == fail and docs[0].file_missing is False


def test_katkine_link_margitakse_puuduvaks(tmp_path):
    items = {"K1": [VANEM, manus("ATT00001", "ITEM0001",
                                 link_mode="linked_file", path="/pole/olemas.pdf")]}
    with FakeZoteroAPI(collections=KOGUD, items=items) as base:
        docs = iter_documents(base, tmp_path / "storage", ["K1"])
    assert docs[0].file_missing is True


def test_attachments_prefiks_kukub(tmp_path):
    items = {"K1": [VANEM, manus("ATT00001", "ITEM0001", link_mode="linked_file",
                                 path="attachments:alam/f.pdf")]}
    with FakeZoteroAPI(collections=KOGUD, items=items) as base:
        with pytest.raises(ZoteroError, match="baasikataloogi"):
            iter_documents(base, tmp_path / "storage", ["K1"])


def test_linked_url_ja_mitte_pdf_jaetakse_vahele(tmp_path):
    items = {"K1": [
        VANEM,
        manus("ATT00001", "ITEM0001", link_mode="linked_url", path="http://x"),
        manus("ATT00002", "ITEM0001", content_type="text/html", filename="a.html"),
    ]}
    with FakeZoteroAPI(collections=KOGUD, items=items) as base:
        assert iter_documents(base, tmp_path / "storage", ["K1"]) == []


def test_prugikasti_margitud_jaetakse_valja(tmp_path):
    storage = _tee_fail(tmp_path, "ATT00001")
    _tee_fail(tmp_path, "ATT00002")
    items = {"K1": [
        VANEM,
        manus("ATT00001", "ITEM0001", filename="f.pdf"),
        manus("ATT00002", "ITEM0001", filename="f.pdf", deleted=True),
    ]}
    with FakeZoteroAPI(collections=KOGUD, items=items) as base:
        docs = iter_documents(base, storage, ["K1"])
    assert [d.doc_id for d in docs] == ["ATT00001"]


def test_uks_vanem_kaks_manust(tmp_path):
    storage = _tee_fail(tmp_path, "ATT00001")
    _tee_fail(tmp_path, "ATT00002")
    items = {"K1": [VANEM,
                    manus("ATT00001", "ITEM0001", filename="f.pdf"),
                    manus("ATT00002", "ITEM0001", filename="f.pdf")]}
    with FakeZoteroAPI(collections=KOGUD, items=items) as base:
        docs = iter_documents(base, storage, ["K1"])
    assert sorted(d.doc_id for d in docs) == ["ATT00001", "ATT00002"]
    assert {d.bib.title for d in docs} == {"Album academicum"}


def test_duplikaat_kahes_kollektsioonis_loetakse_uks_kord(tmp_path):
    storage = _tee_fail(tmp_path, "ATT00001")
    m = manus("ATT00001", "ITEM0001", filename="f.pdf")
    items = {"K1": [VANEM, m], "K2": [VANEM, m]}
    kogud = KOGUD + [kollektsioon("K2", "Alam")]
    with FakeZoteroAPI(collections=kogud, items=items) as base:
        assert len(iter_documents(base, storage, ["K1", "K2"])) == 1


def test_uhe_nimega_looja(tmp_path):
    """Zotero lubab asutust ühe väljana: {"name": "Tartu Ülikool"}."""
    storage = _tee_fail(tmp_path, "ATT00001")
    vanem = kirje("ITEM0002", title="Aruanne", date="1932",
                  creators=[{"creatorType": "author", "name": "Tartu Ülikool"}])
    items = {"K1": [vanem, manus("ATT00001", "ITEM0002", filename="f.pdf")]}
    with FakeZoteroAPI(collections=KOGUD, items=items) as base:
        docs = iter_documents(base, storage, ["K1"])
    assert docs[0].bib.creators == [["Tartu Ülikool", "author"]]
