"""Testid kommentaaride git-ajaloo arvutusele (päris ajutine git-repo)."""
import json
import os
import sys
from pathlib import Path

import pytest
from git import Repo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server.git_ops as git_ops
import server.comment_history_ops as cho


def _page_json(comments):
    return json.dumps({"comments": comments}, ensure_ascii=False, indent=2)


def _c(cid, text, author="u", created="2026-01-01T00:00:00", replies=None):
    return {"id": cid, "text": text, "author": author,
            "created_at": created, "replies": replies or []}


@pytest.fixture
def repo(tmp_path, monkeypatch):
    """Git-repo, kus pg1.json comments muutub mitme commiti jooksul."""
    r = Repo.init(str(tmp_path))
    with r.config_writer() as cw:
        cw.set_value("user", "name", "t").set_value("user", "email", "t@t")
    folder = tmp_path / "1690-w1"
    folder.mkdir()
    jp = folder / "pg1.json"
    rel = os.path.relpath(str(jp), str(tmp_path))

    def commit(comments, msg):
        jp.write_text(_page_json(comments), encoding="utf-8")
        r.index.add([rel])
        r.index.commit(msg)

    # c1: tekst muutub A → B → C; c2 kustutatakse; c3 lisandub hiljem
    commit([_c("c1", "A"), _c("c2", "X", replies=[{"id": "r1", "text": "vastus"}])], "v1")
    commit([_c("c1", "B"), _c("c2", "X2", replies=[{"id": "r1", "text": "vastus"}])], "v2")
    commit([_c("c1", "C")], "v3 (c2 kustutatud)")
    commit([_c("c1", "C"), _c("c3", "uus")], "v4")

    monkeypatch.setattr(git_ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(git_ops, "get_or_init_repo", lambda: r)
    return {"repo": r, "rel": rel, "folder": folder}


def test_versions_only_historical_differing(repo):
    current = [_c("c1", "C"), _c("c3", "uus")]
    res = cho.build_comment_history(repo["rel"], current)
    texts = [v["text"] for v in res["versions"].get("c1", [])]
    assert texts == ["B", "A"]
    assert "c3" not in res["versions"]


def test_deleted_keeps_last_state_before_deletion(repo):
    current = [_c("c1", "C"), _c("c3", "uus")]
    res = cho.build_comment_history(repo["rel"], current)
    deleted_ids = {d["id"]: d for d in res["deleted"]}
    assert "c2" in deleted_ids
    assert deleted_ids["c2"]["text"] == "X2"
    assert deleted_ids["c2"]["replies"] == [{"id": "r1", "text": "vastus"}]


def test_dedup_consecutive_identical(repo, monkeypatch):
    current = [_c("c1", "A")]
    res = cho.build_comment_history(repo["rel"], current)
    texts = [v["text"] for v in res["versions"].get("c1", [])]
    assert texts == ["C", "B"]


def test_truncated_flag(repo):
    res = cho.build_comment_history(repo["rel"], [_c("c1", "C")], max_count=2)
    assert res["truncated"] is True
    res2 = cho.build_comment_history(repo["rel"], [_c("c1", "C")], max_count=100)
    assert res2["truncated"] is False


def test_malformed_json_commit_does_not_crash(repo, monkeypatch):
    real = cho.get_file_at_commit
    calls = {"n": 0}

    def flaky(rel, h):
        calls["n"] += 1
        if calls["n"] == 1:
            return "{ broken json"
        return real(rel, h)

    monkeypatch.setattr(cho, "get_file_at_commit", flaky)
    res = cho.build_comment_history(repo["rel"], [_c("c1", "C")])
    assert isinstance(res["versions"], dict)
    assert any(v["text"] in ("B", "A") for v in res["versions"].get("c1", []))


def test_extract_comments_meta_content_wrapper():
    content = json.dumps({"meta_content": {"comments": [_c("c1", "Z")]}})
    assert cho.find_comment_in_content(content, "c1")["text"] == "Z"


def test_extract_comments_invalid_json_returns_none():
    assert cho.find_comment_in_content("{ not json", "c1") is None


def test_apply_restore_version_overwrites_text_keeps_replies():
    current = [_c("c1", "uus", replies=[{"id": "r9", "text": "praegune vastus"}])]
    new, err = cho.apply_comment_restore(current, _c("c1", "vana"), "version")
    assert err is None
    assert new[0]["text"] == "vana"
    assert new[0]["replies"] == [{"id": "r9", "text": "praegune vastus"}]


def test_apply_restore_version_missing_id_errors():
    new, err = cho.apply_comment_restore([_c("c1", "x")], _c("cX", "y"), "version")
    assert new is None and err[0] == 404


def test_apply_restore_deleted_appends():
    new, err = cho.apply_comment_restore([_c("c1", "x")], _c("c2", "tagasi"), "deleted")
    assert err is None
    assert [c["id"] for c in new] == ["c1", "c2"]


def test_apply_restore_deleted_conflict():
    new, err = cho.apply_comment_restore([_c("c1", "x")], _c("c1", "y"), "deleted")
    assert new is None and err[0] == 409
