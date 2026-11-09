# tests/test_work_exemplars_locked.py
"""ADR 0079: impordi avaldamine kirjutab eksemplari URL-i `work_lock`-i seest
(`update_exemplar(..., locked=True)`) ja nõuab commit'i (`require_commit=True`)."""
import json
import os
import threading

import pytest

from server import admin_page_ops, metadata_ops
from server import work_exemplars as we
from server.git_ops import uncommitted_paths

URL = "https://hdl.handle.net/10062/1"


def _url(env):
    with open(env["meta_path"], encoding="utf-8") as f:
        return json.load(f)["exemplars"][0].get("url")


def test_update_locked_ei_jaa_ummikusse(exemplar_work):
    env = exemplar_work
    wd = env["work_dir"]

    def run():
        with admin_page_ops.work_lock(os.path.basename(wd), wd):
            we.update_exemplar(wd, env["eid"], {"url": URL}, "test", locked=True)

    t = threading.Thread(target=run, daemon=True)
    t.start()
    t.join(timeout=5)
    assert not t.is_alive()
    assert _url(env) == URL


def test_require_commit_viskab_kui_commit_ebaonnestub(exemplar_work, monkeypatch):
    env = exemplar_work
    monkeypatch.setattr(metadata_ops, "save_with_git", lambda *a, **k: {"success": False, "error": "x"})
    with pytest.raises(we.ExemplarError) as e:
        we.update_exemplar(env["work_dir"], env["eid"], {"url": URL}, "test", require_commit=True)
    assert e.value.status == 500


def test_kordus_commitib_rippuva_kirjutuse(exemplar_work):
    env = exemplar_work
    with open(env["meta_path"], encoding="utf-8") as f:
        meta = json.load(f)
    meta["exemplars"][0]["url"] = URL
    with open(env["meta_path"], "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    assert uncommitted_paths([env["meta_path"]])

    wd = env["work_dir"]
    with admin_page_ops.work_lock(os.path.basename(wd), wd):
        we.update_exemplar(wd, env["eid"], {"url": URL}, "test", locked=True, require_commit=True)
    assert uncommitted_paths([env["meta_path"]]) == []
