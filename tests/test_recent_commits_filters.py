"""Testid `get_recent_commits` kasutaja- ja kollektsioonifiltrile.

Kaks vaadet, mis varem puudusid:
- kasutaja kaupa ajalugu, mis EI lõpe skanniakna serval (vana commit peab
  leitama ka siis, kui uuemaid teiste commite on üle akna);
- kollektsiooni kaupa filtreerimine, kus valitud kollektsioon kaasab
  alamkollektsioonid ja isikukaardid jäävad välja.
"""
import json
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

# Kollektsioonipuu: `alam` on `yla` laps, `muu-col` on eraldi juur.
COLLECTIONS = {
    "yla": {"name": "Ülemine", "parent": None},
    "alam": {"name": "Alumine", "parent": "yla"},
    "muu-col": {"name": "Muu", "parent": None},
}


def _actor(name):
    import git
    return git.Actor(name, f"{name}@test.local")


def _commit(repo, paths, message, author):
    repo.index.add(paths)
    repo.index.commit(message, author=_actor(author), committer=_actor(author))


def _add_work(repo, base, folder, work_id, collections, author="vana", message=None):
    """Loob teose kausta (_metadata.json + üks leht) ja commitib selle."""
    work_dir = base / folder
    work_dir.mkdir(parents=True, exist_ok=True)
    (work_dir / "_metadata.json").write_text(
        json.dumps({
            "id": work_id,
            "slug": folder,
            "title": f"Teos {work_id}",
            "year": 1650,
            "collections": collections,
        }),
        encoding="utf-8",
    )
    (work_dir / "1.txt").write_text("tekst", encoding="utf-8")
    _commit(
        repo,
        [f"{folder}/_metadata.json", f"{folder}/1.txt"],
        message or f"Muudatus: {folder}",
        author,
    )


def _add_person(repo, base, nanoid="abc123", author="muu"):
    prosopo_dir = base / "config" / "prosopography"
    prosopo_dir.mkdir(parents=True, exist_ok=True)
    (prosopo_dir / f"{nanoid}.json").write_text(
        json.dumps({"id": f"vutt:P{nanoid}", "name": {"label": "Test Isik"}}),
        encoding="utf-8",
    )
    _commit(
        repo,
        [f"config/prosopography/{nanoid}.json"],
        "Prosopo muudatus: Test Isik [vutt:P{}]".format(nanoid),
        author,
    )


def _pad(repo, count, author="muu"):
    """Lisab `count` puutumata puuga commiti — lükkab vanemad commitid aknast välja."""
    for i in range(count):
        repo.index.commit(
            f"Täide {i}",
            author=_actor(author),
            committer=_actor(author),
        )


@pytest.fixture
def repo_env(tmp_path, monkeypatch):
    """Ajutine git-repo + puhas work-info cache + testkollektsioonid."""
    import git
    from server import git_ops
    from server import cache as cache_mod

    repo = git.Repo.init(str(tmp_path))
    git_ops._work_info_cache.clear()
    monkeypatch.setattr(git_ops, "get_or_init_repo", lambda: repo)
    monkeypatch.setattr(git_ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(cache_mod, "get_cached_collections", lambda: COLLECTIONS)
    yield repo, tmp_path, git_ops
    git_ops._work_info_cache.clear()


def test_user_history_reaches_beyond_scan_window(repo_env):
    """Kasutaja vana commit leitakse ka siis, kui uuemaid teiste omi on üle akna.

    Vana tee võttis HEADist (skip+limit)*3+50 commiti ja filtreeris autori
    järgi alles Pythonis — harva kirjutav kasutaja paistis „muudatusi pole".
    """
    repo, base, git_ops = repo_env
    _add_work(repo, base, "vana-teos", "wOld", ["alam"], author="vana")
    _pad(repo, 100)          # aken limit=5 juures on 65 commitit

    res = git_ops.get_recent_commits(username="vana", limit=5)

    # Üks commit puudutab nii _metadata.json-i kui lehte → kaks kirjet
    assert {c["work_id"] for c in res["commits"]} == {"wOld"}
    assert {c["author"] for c in res["commits"]} == {"vana"}


def test_user_filter_does_not_match_name_prefix(repo_env):
    """`--author` on regex — „mart" ei tohi tuua „martin" commite."""
    repo, base, git_ops = repo_env
    _add_work(repo, base, "mardi-teos", "wMart", ["alam"], author="mart")
    _add_work(repo, base, "martini-teos", "wMartin", ["alam"], author="martin")

    res = git_ops.get_recent_commits(username="mart", limit=10)

    assert {c["author"] for c in res["commits"]} == {"mart"}
    assert {c["work_id"] for c in res["commits"]} == {"wMart"}


def test_collection_filter_includes_subcollections(repo_env):
    """Ülemise kollektsiooni valik toob kaasa alamkollektsiooni teosed."""
    repo, base, git_ops = repo_env
    _add_work(repo, base, "alam-teos", "wAlam", ["alam"])
    _add_work(repo, base, "muu-teos", "wMuu", ["muu-col"])

    ylalt = git_ops.get_recent_commits(collection="yla", limit=10)
    mujalt = git_ops.get_recent_commits(collection="muu-col", limit=10)

    assert {c["work_id"] for c in ylalt["commits"]} == {"wAlam"}
    assert {c["work_id"] for c in mujalt["commits"]} == {"wMuu"}


def test_collection_filter_excludes_persons(repo_env):
    """Isikukaart ei kuulu kollektsiooni — filtriga peidus, filtrita nähtav."""
    repo, base, git_ops = repo_env
    _add_work(repo, base, "alam-teos", "wAlam", ["alam"])
    _add_person(repo, base)

    filtriga = git_ops.get_recent_commits(collection="yla", limit=10)
    filtrita = git_ops.get_recent_commits(limit=10)

    assert all(c["change_type"] != "person" for c in filtriga["commits"])
    assert any(c["change_type"] == "person" for c in filtrita["commits"])


def test_collection_filter_reaches_beyond_scan_window(repo_env):
    """Sama akna-probleem kollektsiooni teljel: väike kollektsioon peab leiduma."""
    repo, base, git_ops = repo_env
    _add_work(repo, base, "haruldane", "wRare", ["muu-col"])
    _add_work(repo, base, "sage", "wCommon", ["alam"])
    _pad(repo, 100)

    res = git_ops.get_recent_commits(collection="muu-col", limit=5)

    assert {c["work_id"] for c in res["commits"]} == {"wRare"}


def test_combined_user_and_collection_filter(repo_env):
    """Mõlemad filtrid koos kitsendavad, mitte ei tühista teineteist."""
    repo, base, git_ops = repo_env
    _add_work(repo, base, "a-teos", "wA", ["alam"], author="anne")
    _add_work(repo, base, "b-teos", "wB", ["muu-col"], author="anne")
    _add_work(repo, base, "c-teos", "wC", ["alam"], author="peeter")

    res = git_ops.get_recent_commits(username="anne", collection="yla", limit=10)

    assert {c["work_id"] for c in res["commits"]} == {"wA"}


def test_no_filters_unchanged(repo_env):
    """Filtriteta käitumine jääb samaks: kõik teosed ja isikud nimekirjas."""
    repo, base, git_ops = repo_env
    _add_work(repo, base, "alam-teos", "wAlam", ["alam"], author="anne")
    _add_work(repo, base, "muu-teos", "wMuu", ["muu-col"], author="peeter")
    _add_person(repo, base)

    res = git_ops.get_recent_commits(limit=20)

    assert {c["work_id"] for c in res["commits"] if c["work_id"]} == {"wAlam", "wMuu"}
    assert any(c["change_type"] == "person" for c in res["commits"])


def test_metadata_save_invalidates_work_info_cache(repo_env):
    """Kollektsiooni vahetus peab kohe mõjuma — cache ei tohi jääda vanaks.

    `_work_info_cache` kannab nüüd ka `collections`-i, seega aegunud kirje
    näitaks teost vales kollektsioonis (varem ainult vana pealkirjaga).
    """
    import json as _json
    repo, base, git_ops = repo_env
    _add_work(repo, base, "rändur", "wMove", ["alam"])
    assert {c["work_id"] for c in git_ops.get_recent_commits(collection="yla", limit=10)["commits"]} == {"wMove"}

    meta_path = base / "rändur" / "_metadata.json"
    meta = _json.loads(meta_path.read_text(encoding="utf-8"))
    meta["collections"] = ["muu-col"]
    git_ops.save_with_git(str(meta_path), _json.dumps(meta), "anne", "Kollektsiooni vahetus")

    assert git_ops.get_recent_commits(collection="yla", limit=10)["commits"] == []
    assert {c["work_id"] for c in git_ops.get_recent_commits(collection="muu-col", limit=10)["commits"]} == {"wMove"}
