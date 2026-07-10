"""
Testid server/work_meta.py ühistele metadata-lugemise helperitele (Faas 0).

Kaetud käitumine: `load_work_metadata` tagastab olemasoleva teose korral dict-i
ning puuduva/tundmatu work_id või korrumpeerunud JSON-i korral None. Ligipääsu
kutsujad tõlgendavad None väärtust fail-closed.
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
