# tests/test_exemplar_pairs_sync.py
"""Eksemplari pildipaarid ja lehetoimingud (ADR 0079 p 3 täiendus 2026-11-10)."""
import io
import os
import threading

import pytest
from PIL import Image

from server import exemplar_images as ei

STEM = "1640-test-w1-001"


def _jpeg(color=(10, 20, 30)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (40, 30), color).save(buf, "JPEG")
    return buf.getvalue()


def _commits(env) -> int:
    return len(list(env["repo"].iter_commits()))


def _set_pages(env, pages):
    """Kirjuta paarid otse manifesti (möödudes sihtlehe kontrollist)."""
    m = ei.read_manifest(env["work_dir"], env["eid"])
    for img, page in zip(m["images"], pages):
        if page:
            img["page"] = page
        else:
            img.pop("page", None)
    m["revision"] += 1
    with ei.exemplar_locks(env["work_dir"]):
        ei.write_manifest_locked(env["work_dir"], env["eid"], m, "t", "test")


@pytest.fixture
def env(exemplar_work):
    """exemplar_work + 2 pilti: pilt 0 → olemasolev tüvi, pilt 1 → rippuv."""
    files = [(_jpeg((i, i, i)), {"kind": "photo", "ref": "foto"}) for i in range(2)]
    ei.add_uploads(exemplar_work["work_dir"], exemplar_work["eid"], files, "meelisf")
    _set_pages(exemplar_work, [STEM, "kadunud-tyvi"])
    return exemplar_work


def test_koristus_eemaldab_ainult_rippuva(env):
    rev = ei.read_manifest(env["work_dir"], env["eid"])["revision"]
    assert ei.prune_dangling_pairs(env["work_dir"]) == 1
    m = ei.read_manifest(env["work_dir"], env["eid"])
    assert m["images"][0]["page"] == STEM and "page" not in m["images"][1]
    assert m["revision"] == rev + 1


def test_koristus_on_idempotentne_ja_ei_commiti_tuhjalt(env):
    ei.prune_dangling_pairs(env["work_dir"])
    n = _commits(env)
    assert ei.prune_dangling_pairs(env["work_dir"]) == 0 and _commits(env) == n


def test_koristus_ilma_eksemplaride_kaustata(exemplar_work):
    assert ei.prune_dangling_pairs(exemplar_work["work_dir"]) == 0


def test_koristus_ei_vota_work_locki(env):
    # Review Focus 3: kutsuja hoiab work_lock-i → ei tohi rippuma jääda
    from server.admin_page_ops import work_lock
    done = threading.Event()
    with work_lock(os.path.basename(env["work_dir"]), env["work_dir"]):
        t = threading.Thread(target=lambda: (ei.prune_dangling_pairs(env["work_dir"]), done.set()),
                             daemon=True)
        t.start()
        t.join(5)
    assert done.is_set()


def test_refresh_tagastab_arvu(env, monkeypatch):
    from server.prosopography import relations
    from server import work_parts, work_exemplars
    monkeypatch.setattr(work_parts, "sync_work_parts", lambda *a, **k: None)
    monkeypatch.setattr(work_exemplars, "sync_work_exemplars", lambda *a, **k: None)
    monkeypatch.setattr(relations, "update_page_person_mentions", lambda *a, **k: None)
    assert relations.refresh_work_mentions(env["work_dir"], "w1") == {"pairs_removed": 1}


def test_refresh_tagastab_arvu_ja_viga_ei_levi(env, monkeypatch):
    from server.prosopography import relations
    from server import client_errors
    recorded = []
    monkeypatch.setattr(client_errors, "record_server_error", lambda src, exc, **k: recorded.append(src))
    monkeypatch.setattr(ei, "prune_dangling_pairs",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("x")))
    assert relations.refresh_work_mentions(env["work_dir"], "w1") == {"pairs_removed": 0}
    assert recorded == ["server:thread"]


# ── Lehestiku asendus (ADR 0079 p 3 täiendus, punkt 5) ───────────────────────

def test_clear_all_pairs_eemaldab_ka_kehtiva(env):
    # pilt 0 → kehtiv paar, pilt 1 → rippuv: mõlemad eemaldatakse
    assert ei.clear_all_pairs(env["work_dir"], "meelisf") == 2
    m = ei.read_manifest(env["work_dir"], env["eid"])
    assert all("page" not in img for img in m["images"])


def test_asendus_katkeb_kui_paaride_eemaldus_ebaonnestub(tmp_path, monkeypatch):
    from fastapi import HTTPException
    import server.git_ops as git_ops
    from server import upload_ops
    from tests.test_replace_work_content import _FakeRepo, _ListSftp, _setup_replace_files

    upload_id, work_id, _slug, work_dir, data_dir = _setup_replace_files(tmp_path, monkeypatch)
    monkeypatch.setattr(upload_ops, "_sftp_open",
                        lambda _u: _ListSftp(["uus-teos_pg_001.jpg", "uus-teos_pg_001.txt"]))
    monkeypatch.setattr(git_ops, "get_or_init_repo", lambda: _FakeRepo())
    monkeypatch.setattr(ei, "clear_all_pairs",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("lukk")))
    def files():
        return sorted(f for f in os.listdir(work_dir) if f != ".vutt-lock")   # lukufail
    before = files()

    with pytest.raises(HTTPException) as exc:
        upload_ops.replace_work_content(upload_id, work_id, {}, "admin", background_tasks=None)

    assert exc.value.status_code == 500
    assert "pildipaaride eemaldamine ebaõnnestus" in exc.value.detail
    assert files() == before
    assert (work_dir / "vana-teos_pg_001.jpg").read_bytes() == b"vana jpg"
    assert not list((data_dir / "._trash").glob("**/*.jpg"))
