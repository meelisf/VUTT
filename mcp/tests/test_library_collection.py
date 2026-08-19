import pytest
from library_fixtures import FakeZoteroAPI, kollektsioon

from vutt_mcp.library.zotero import ZoteroError, collection_tree, resolve_collection

PUU = [
    kollektsioon("KEY00001", "VUTT kirjandus"),
    kollektsioon("KEY00002", "Teatmeteosed", parent="KEY00001"),
    kollektsioon("KEY00003", "Matriklid", parent="KEY00002"),
    kollektsioon("KEY00004", "Muu kogu"),
]
ALAMAD = {"KEY00001": ["KEY00002"], "KEY00002": ["KEY00003"]}


def test_nimi_lahendatakse_keyks():
    with FakeZoteroAPI(collections=PUU, subcollections=ALAMAD) as base:
        assert resolve_collection(base, "VUTT kirjandus") == ("KEY00001",
                                                             "VUTT kirjandus")


def test_key_toimib_otse():
    with FakeZoteroAPI(collections=PUU, subcollections=ALAMAD) as base:
        assert resolve_collection(base, "KEY00003") == ("KEY00003", "Matriklid")


def test_puuduv_kollektsioon_kukub():
    with FakeZoteroAPI(collections=PUU) as base:
        with pytest.raises(ZoteroError, match="ei leidnud kollektsiooni"):
            resolve_collection(base, "Olematu")


def test_duplikaat_nimi_kukub_ja_loetleb():
    kogud = [
        kollektsioon("KEY00001", "17. saj"),
        kollektsioon("KEY00002", "Alam"),
        kollektsioon("KEY00003", "17. saj", parent="KEY00002"),
    ]
    with FakeZoteroAPI(collections=kogud) as base:
        with pytest.raises(ZoteroError) as exc:
            resolve_collection(base, "17. saj")
    sonum = str(exc.value)
    assert "KEY00001" in sonum and "KEY00003" in sonum


def test_alamkollektsioonid_rekursiivselt():
    with FakeZoteroAPI(collections=PUU, subcollections=ALAMAD) as base:
        puu = collection_tree(base, "KEY00001")
    assert [k for k, _ in puu] == ["KEY00001", "KEY00002", "KEY00003"]
    assert puu[2][1] == "Matriklid"


def test_lehtkollektsioonil_ainult_ta_ise():
    with FakeZoteroAPI(collections=PUU, subcollections=ALAMAD) as base:
        assert collection_tree(base, "KEY00004") == [("KEY00004", "Muu kogu")]
