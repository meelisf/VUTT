from pathlib import Path

from vutt_mcp.library.config import (
    library_available,
    load_library_settings,
)


def test_vaikimisi_teed():
    s = load_library_settings({"HOME": "/home/keegi"})
    assert s.db_path == Path("/home/keegi/.local/share/vutt-library/library.db")
    assert s.collection == "VUTT kirjandus"
    assert s.zotero_dir == Path("/home/keegi/.zotero/Zotero")
    assert s.api_base == "http://127.0.0.1:23119/api/users/0"


def test_env_kirjutab_ule():
    s = load_library_settings(
        {
            "HOME": "/home/keegi",
            "VUTT_LIBRARY_DB": "/mujal/l.db",
            "VUTT_LIBRARY_COLLECTION": "Muu kogu",
            "VUTT_LIBRARY_ZOTERO_DIR": "/mujal/Zotero",
            "VUTT_LIBRARY_ZOTERO_API": "http://127.0.0.1:9999/api/users/0",
        }
    )
    assert s.db_path == Path("/mujal/l.db")
    assert s.collection == "Muu kogu"
    assert s.zotero_dir == Path("/mujal/Zotero")
    assert s.api_base == "http://127.0.0.1:9999/api/users/0"


def test_aktiveerimine_soltub_indeksifailist(tmp_path):
    db = tmp_path / "library.db"
    s = load_library_settings({"HOME": str(tmp_path), "VUTT_LIBRARY_DB": str(db)})
    assert library_available(s) is False
    db.write_bytes(b"")
    assert library_available(s) is True
