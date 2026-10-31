"""`save_with_git(rollback_on_error=True)` (#701, ADR 0075): vea korral on failid
baithaaval algseisus ja indeksis pole neid staged olekus enne, kui git-lukk vabaneb."""
import subprocess
import sys
from pathlib import Path

import pytest
from git import Repo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server.git_ops as git_ops  # noqa: E402


@pytest.fixture
def repo(tmp_path, monkeypatch):
    r = Repo.init(str(tmp_path))
    with r.config_writer() as cw:
        cw.set_value("user", "name", "t").set_value("user", "email", "t@t")
    for rel, data in (("a/_metadata.json", b'{"x": 1}\n'), ("b/_metadata.json", b'{ "y":2 }')):
        p = tmp_path / rel
        p.parent.mkdir()
        p.write_bytes(data)
        r.index.add([rel])
    r.index.commit("init")
    monkeypatch.setattr(git_ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(git_ops, "get_or_init_repo", lambda: r)
    return r, tmp_path


def _fail_git(monkeypatch, verb):
    paris_run = git_ops.subprocess.run

    def kukkuv(args, *a, **kw):
        if len(args) > 1 and args[1] == verb:
            raise subprocess.CalledProcessError(1, args, stderr="katki")
        return paris_run(args, *a, **kw)

    monkeypatch.setattr(git_ops.subprocess, "run", kukkuv)


def test_commiti_viga_taastab_failid_baithaaval(repo, monkeypatch):
    r, tmp = repo
    a, b = str(tmp / "a/_metadata.json"), str(tmp / "b/_metadata.json")
    _fail_git(monkeypatch, "commit")
    res = git_ops.save_with_git(a, '{"x": 2}', "u", "m", [(b, '{"y": 3}')], rollback_on_error=True)
    assert res["success"] is False and res["rolled_back"] is True
    assert Path(a).read_bytes() == b'{"x": 1}\n'
    assert Path(b).read_bytes() == b'{ "y":2 }'
    assert r.git.diff("--cached", "--name-only") == ""


def test_teise_faili_kirjutusviga_taastab_esimese(repo, monkeypatch):
    r, tmp = repo
    a, b = str(tmp / "a/_metadata.json"), str(tmp / "b/_metadata.json")
    paris = git_ops.atomic_write_text
    kutsed = []

    def kukkuv(path, content):
        kutsed.append(path)
        if len(kutsed) == 2:
            raise OSError("ketas täis")
        return paris(path, content)

    monkeypatch.setattr(git_ops, "atomic_write_text", kukkuv)
    res = git_ops.save_with_git(a, '{"x": 2}', "u", "m", [(b, '{"y": 3}')], rollback_on_error=True)
    assert res["success"] is False and res["rolled_back"] is True
    assert Path(a).read_bytes() == b'{"x": 1}\n'
    assert Path(b).read_bytes() == b'{ "y":2 }'
    assert r.git.diff("--cached", "--name-only") == ""


def test_uus_fail_kustutatakse_tagasipooramisel(repo, monkeypatch):
    r, tmp = repo
    a = str(tmp / "a/_metadata.json")
    uus = tmp / "c" / "_metadata.json"
    uus.parent.mkdir()
    _fail_git(monkeypatch, "commit")
    res = git_ops.save_with_git(a, '{"x": 2}', "u", "m", [(str(uus), "{}")], rollback_on_error=True)
    assert res["rolled_back"] is True
    assert not uus.exists()
    assert r.git.diff("--cached", "--name-only") == ""


def test_vaikimisi_kaitumine_muutumatu(repo, monkeypatch):
    r, tmp = repo
    a = str(tmp / "a/_metadata.json")
    _fail_git(monkeypatch, "commit")
    res = git_ops.save_with_git(a, '{"x": 2}', "u", "m")
    assert res["success"] is False and "rolled_back" not in res
    assert Path(a).read_text() == '{"x": 2}'


def test_edukas_salvestus_rollback_lipuga_commitib(repo):
    r, tmp = repo
    a, b = str(tmp / "a/_metadata.json"), str(tmp / "b/_metadata.json")
    res = git_ops.save_with_git(a, '{"x": 2}', "u", "m", [(b, '{"y": 3}')], rollback_on_error=True)
    assert res["success"] is True
    assert set(r.git.show("--name-only", "--format=", "HEAD").split()) == {
        "a/_metadata.json", "b/_metadata.json"}
