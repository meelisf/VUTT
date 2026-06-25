"""
Testid server/work_meta.py ühistele metadata-lugemise helperitele (Faas 0).

Kaetud käitumine:
- load_work_metadata: tagastab dict olemasoleva teose korral; None puuduva/
  tundmatu work_id või korrumpeerunud JSON-i korral
- read_work_meta_direct_sync: tagastab dict (mitte None) ka puuduva faili
  korral — /get-work-metadata eeldab tühja vormi uuele teosele
- read_work_meta_direct_sync: fallback original_path-ile, kui work_id ei leitu

Need on refaktoreeringu Faas 0 tõstmised main.py-st; tagavad, et public/SEO,
collections, download, shareable ja viewer-token saavad ühest kohast metadatat.
"""
import json
import os
import pytest


@pytest.fixture
def work_dir(backend_env, tmp_path):
    """Loob testteose kataloogi + _metadata.json + uuendab work_id cache."""
    from server.utils import build_work_id_cache, WORK_ID_CACHE

    # Loome teose kataloogi BASE_DIR-i alla (conftest seab BASE_DIR = tmp/... vms)
    from server import main as main_mod
    base_dir = main_mod.BASE_DIR
    work_id = "meta-test-001"
    folder_name = "test-work-folder"
    folder = os.path.join(base_dir, folder_name)
    os.makedirs(folder, exist_ok=True)
    meta = {
        "id": work_id,
        "title": "Testteos meta jaoks",
        "year": "1690",
        "creators": [],
    }
    with open(os.path.join(folder, "_metadata.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False)

    build_work_id_cache()
    yield {"work_id": work_id, "folder": folder, "meta": meta}
    # cleanup
    import shutil
    shutil.rmtree(folder, ignore_errors=True)


# ---------------------------------------------------------------------------
# load_work_metadata
# ---------------------------------------------------------------------------

def test_load_work_metadata_returns_dict_for_existing(work_dir):
    from server.work_meta import load_work_metadata
    result = load_work_metadata(work_dir["work_id"])
    assert result is not None
    assert result["title"] == "Testteos meta jaoks"
    assert result["id"] == work_dir["work_id"]


def test_load_work_metadata_returns_none_for_unknown_id(work_dir):
    from server.work_meta import load_work_metadata
    assert load_work_metadata("olematu-id-99999") is None


def test_load_work_metadata_returns_none_when_no_meta_file(backend_env, tmp_path):
    """Kataloog eksisteerib (work_id cache-s), aga _metadata.json puudub → None."""
    from server.utils import build_work_id_cache
    from server import main as main_mod
    from server.work_meta import load_work_metadata

    work_id = "no-meta-002"
    folder = os.path.join(main_mod.BASE_DIR, "no-meta-folder")
    os.makedirs(folder, exist_ok=True)
    # NB: loome .txt faili, et build_work_id_cache tuvastaks kataloogi teosena,
    # aga _metadata.json jätab tegemata.
    with open(os.path.join(folder, "pg_001.txt"), "w") as f:
        f.write("mingi tekst")
    # Sünteetiline cache kirje (work_id → folder), sest metadata puudub
    from server.utils import WORK_ID_CACHE
    WORK_ID_CACHE[work_id] = folder
    try:
        assert load_work_metadata(work_id) is None
    finally:
        import shutil
        shutil.rmtree(folder, ignore_errors=True)


# ---------------------------------------------------------------------------
# read_work_meta_direct_sync
# ---------------------------------------------------------------------------

def test_read_work_meta_direct_sync_returns_dict_for_existing(work_dir):
    from server.work_meta import read_work_meta_direct_sync
    result = read_work_meta_direct_sync(work_dir["work_id"], "")
    assert result["title"] == "Testteos meta jaoks"


def test_read_work_meta_direct_sync_returns_empty_dict_when_missing(work_dir):
    """Puuduva _metadata.json korral tagastab {}, mitte None.

    Erinevus load_work_metadata-st: /get-work-metadata endpoint eeldab tühja
    dict'i, et frontend saaks avada vormi uuele teosele, millel metafail veel puudub.
    """
    from server.work_meta import read_work_meta_direct_sync
    from server import main as main_mod
    from server.utils import WORK_ID_CACHE

    work_id = "direct-sync-empty-003"
    folder = os.path.join(main_mod.BASE_DIR, "empty-meta-folder")
    os.makedirs(folder, exist_ok=True)
    WORK_ID_CACHE[work_id] = folder
    try:
        result = read_work_meta_direct_sync(work_id, "")
        assert result == {}
        assert result is not None
    finally:
        import shutil
        shutil.rmtree(folder, ignore_errors=True)


def test_read_work_meta_direct_sync_falls_back_to_original_path(work_dir):
    """Kui work_id ei leita cache-st, kasutatakse original_path-i (basename)."""
    from server.work_meta import read_work_meta_direct_sync
    # Olematu work_id, aga original_path osutab olemasolevale kataloogile
    original_path = os.path.join(os.path.dirname(work_dir["folder"]), "test-work-folder")
    result = read_work_meta_direct_sync("tundmatu-id", original_path)
    assert result["title"] == "Testteos meta jaoks"


def test_read_work_meta_direct_sync_returns_empty_for_corrupt_json(backend_env, tmp_path):
    """Korrumpeerunud JSON → {} (mitte erind)."""
    from server import main as main_mod
    from server.work_meta import read_work_meta_direct_sync
    from server.utils import WORK_ID_CACHE

    work_id = "corrupt-004"
    folder = os.path.join(main_mod.BASE_DIR, "corrupt-folder")
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, "_metadata.json"), "w") as f:
        f.write("{ see pole json :::")
    WORK_ID_CACHE[work_id] = folder
    try:
        assert read_work_meta_direct_sync(work_id, "") == {}
    finally:
        import shutil
        shutil.rmtree(folder, ignore_errors=True)
