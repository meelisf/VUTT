import pytest

from vutt_mcp.library.config import LibrarySettings
from vutt_mcp.library.format import format_citation, format_page_ref
from vutt_mcp.library.query import DocRow
from vutt_mcp.library.schema import connect, create_schema
from vutt_mcp.library.tools import register_library_tools

DOC = DocRow(doc_id="A", title="Album academicum", year="1984",
             creators=[["Arvo Tering", "editor"]], page_count=529,
             page_mapping_source="pagelabels", file_missing=False)


def test_viide_sisaldab_autorit_aastat_pealkirja():
    v = format_citation(DOC)
    assert "Tering" in v and "1984" in v and "Album academicum" in v


def test_lehe_viide_naitab_molemat():
    assert format_page_ref("217", 223) == "lk 217 (PDF 223)"


def test_teadmata_trukitud_number_ei_oleta():
    tulem = format_page_ref(None, 223)
    assert "PDF 223" in tulem
    assert "lk 217" not in tulem
    assert "teadmata" in tulem.lower()


class FakeMcp:
    def __init__(self):
        self.tools = []

    def tool(self, **kwargs):
        assert kwargs.get("structured_output") is False

        def deco(fn):
            self.tools.append(fn.__name__)
            return fn
        return deco


def test_tooriistu_ei_registreerita_ilma_indeksita(tmp_path):
    s = LibrarySettings(db_path=tmp_path / "pole.db", collection="X",
                        zotero_dir=tmp_path)
    mcp = FakeMcp()
    assert register_library_tools(mcp, s) is False
    assert mcp.tools == []


def test_tooriistad_registreeritakse_kui_indeks_olemas(tmp_path):
    db = tmp_path / "l.db"
    create_schema(connect(db))
    s = LibrarySettings(db_path=db, collection="X", zotero_dir=tmp_path)
    mcp = FakeMcp()
    assert register_library_tools(mcp, s) is True
    assert sorted(mcp.tools) == [
        "get_literature_pages", "list_literature", "search_literature"]
