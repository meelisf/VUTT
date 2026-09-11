"""Autoriteetne konfiguratsioon commititakse `data/` gitti (#346).

`data/` git ongi taastamise mehhanism. Kollektsioonid, arhiivid, kohad ja
päritolugrupid on admini otsused — neil on autor ja põhjus, seega peab igal
kirjutusteel olema commit. Tuletatud read-modelid ja välised cache'id gitti
EI kuulu (ADR 0007) ja neid see nõue ei puuduta.
"""
import json
import os
import re
import sys
from pathlib import Path

import pytest
from git import Repo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server.git_ops as git_ops


@pytest.fixture
def repo(tmp_path, monkeypatch):
    r = Repo.init(str(tmp_path))
    with r.config_writer() as cw:
        cw.set_value("user", "name", "t").set_value("user", "email", "t@t")
    (tmp_path / "algus.txt").write_text("x", encoding="utf-8")
    r.index.add(["algus.txt"])
    r.index.commit("init")
    monkeypatch.setattr(git_ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(git_ops, "get_or_init_repo", lambda: r)
    return {"repo": r, "tmp": tmp_path}


def test_save_config_with_git_kirjutab_ja_commitib(repo):
    path = repo["tmp"] / "config" / "collections.json"
    before = len(list(repo["repo"].iter_commits()))

    tulemus = git_ops.save_config_with_git(
        str(path), {"collections": [{"id": "klingeriana"}]}, "admin",
        message="Kollektsioon: lisa klingeriana",
    )

    assert tulemus["success"] is True
    assert json.loads(path.read_text(encoding="utf-8")) == {"collections": [{"id": "klingeriana"}]}
    assert len(list(repo["repo"].iter_commits())) == before + 1
    viimane = next(repo["repo"].iter_commits())
    assert viimane.message.strip() == "Kollektsioon: lisa klingeriana"
    assert viimane.author.name == "admin"


def test_save_config_with_git_sama_sisu_on_noop(repo):
    path = repo["tmp"] / "config" / "places.json"
    git_ops.save_config_with_git(str(path), {"tartu": {"label": "Tartu"}}, "admin")
    before = len(list(repo["repo"].iter_commits()))

    tulemus = git_ops.save_config_with_git(str(path), {"tartu": {"label": "Tartu"}}, "admin")

    assert tulemus.get("is_noop") is True
    assert len(list(repo["repo"].iter_commits())) == before


def test_save_config_with_git_kirjutab_faili_ka_commiti_ebaonnestudes(repo, monkeypatch):
    """Git-viga ei tohi admini muudatust kaotada — fail on kettal, viga logis."""
    path = repo["tmp"] / "config" / "archives.json"
    paris_run = git_ops.subprocess.run

    def kukkuv(args, *a, **kw):
        if len(args) > 1 and args[1] in ("add", "commit"):
            raise RuntimeError("git katki")
        return paris_run(args, *a, **kw)

    monkeypatch.setattr(git_ops.subprocess, "run", kukkuv)
    tulemus = git_ops.save_config_with_git(str(path), {"ra": {"name": "RA"}}, "admin")

    assert tulemus["success"] is False
    assert json.loads(path.read_text(encoding="utf-8")) == {"ra": {"name": "RA"}}


def test_save_config_with_git_vormindab_nagu_atomic_write_json(repo):
    """Sama vorming kui seni — muidu oleks esimene commit tervikfaili diff."""
    from server.utils import atomic_write_json

    data = {"b": {"label": "Tänav ü"}, "a": [1, 2]}
    ootus = repo["tmp"] / "ootus.json"
    atomic_write_json(str(ootus), data)

    tulemus = repo["tmp"] / "config" / "origin_groups.json"
    git_ops.save_config_with_git(str(tulemus), data, "admin")

    assert tulemus.read_text(encoding="utf-8") == ootus.read_text(encoding="utf-8")


# ── Valvur: ükski kirjutustee ei tohi neid faile commitita kirjutada ─────────

JÄLGITAVAD = ["COLLECTIONS_FILE", "ARCHIVES_FILE", "PLACES_FILE", "ORIGIN_GROUPS_FILE"]


def test_jalgitavat_konfi_ei_kirjutata_atomic_write_jsoniga():
    juur = Path(__file__).resolve().parents[1] / "server"
    muster = re.compile(r"atomic_write_json[(,]\s*(?:[\w.]+\.)?(" + "|".join(JÄLGITAVAD) + r")\b")
    leiud = []
    for path in juur.rglob("*.py"):
        for nr, rida in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            m = muster.search(rida)
            if m:
                leiud.append(f"{os.path.relpath(path, juur.parent)}:{nr} → {m.group(1)}")
    assert not leiud, (
        "Autoriteetset konfi tuleb kirjutada save_config_with_git kaudu (#346):\n"
        + "\n".join(leiud)
    )


def test_put_place_commitib_muudatuse(repo, monkeypatch):
    """Läbiv kontroll: admini kohamuudatus jõuab päris commitiks."""
    import server.prosopography.places_ops as places_ops

    places_file = repo["tmp"] / "config" / "places.json"
    places_file.parent.mkdir(parents=True, exist_ok=True)
    places_file.write_text(json.dumps({"tartu": {"labels": {"et": "Tartu"}}}), encoding="utf-8")
    monkeypatch.setattr(places_ops, "PLACES_FILE", str(places_file))

    places_ops.put_place("riga", {"labels": {"et": "Riia"}, "type": "city"}, username="meelis")

    viimane = next(repo["repo"].iter_commits())
    assert viimane.author.name == "meelis"
    assert "riga" in viimane.message
    salvestatud = json.loads(places_file.read_text(encoding="utf-8"))
    assert salvestatud["riga"]["labels"]["et"] == "Riia"
    assert "tartu" in salvestatud, "olemasolev koht ei tohi kaduda"


def test_save_config_with_git_kirjutab_ka_ilma_repota(tmp_path, monkeypatch):
    """Puuduv või katkine `data/` repo ei tohi admini muudatust kaotada (ADR 0040)."""
    from git.exc import NoSuchPathError

    monkeypatch.setattr(git_ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(git_ops, "get_or_init_repo",
                        lambda: (_ for _ in ()).throw(NoSuchPathError(str(tmp_path / "puudub"))))

    path = tmp_path / "config" / "collections.json"
    tulemus = git_ops.save_config_with_git(str(path), {"a": {"name": "A"}}, "admin")

    assert tulemus["success"] is False
    assert json.loads(path.read_text(encoding="utf-8")) == {"a": {"name": "A"}}
