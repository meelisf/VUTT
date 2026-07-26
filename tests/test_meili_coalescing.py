"""Sama teose järjestikused Meili sünkroniseerimised koondatakse (#176)."""
import threading
import time

import pytest

from server import meilisearch_ops as mo


def _wait_until(predicate, timeout=5.0):
    """Ootab tingimuse täitumist; tagastab True kui täitus enne timeout'i."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return True
        time.sleep(0.005)
    return predicate()


@pytest.fixture
def sync_state(monkeypatch):
    """Nullib coalescing-oleku ja annab kontrollitava fake-sünki.

    Fake blokeerub `gate`-il, nii et test saab hoida sünki 'aktiivsena'.
    """
    mo._reset_sync_state_for_tests()

    state = {
        "calls": [],           # dir_name'id käivitamise järjekorras
        "started": threading.Semaphore(0),
        "gate": threading.Event(),
        "raise_on": set(),
    }
    lock = threading.Lock()

    def fake_sync(dir_name):
        with lock:
            state["calls"].append(dir_name)
        state["started"].release()
        state["gate"].wait(timeout=5)
        if dir_name in state["raise_on"]:
            raise RuntimeError("sünk kukkus")
        return True

    monkeypatch.setattr(mo, "sync_work_to_meilisearch", fake_sync)
    yield state
    state["gate"].set()
    _wait_until(lambda: mo.get_meilisearch_sync_status()["active"] == 0)
    mo._reset_sync_state_for_tests()


def test_ten_requests_produce_one_active_and_one_followup(sync_state):
    for _ in range(10):
        mo.sync_work_to_meilisearch_async("teos-a")

    assert sync_state["started"].acquire(timeout=5)
    # Aktiivse töö ajal ei tohi teist sama teose tööd käivituda
    time.sleep(0.05)
    assert sync_state["calls"] == ["teos-a"]

    sync_state["gate"].set()
    assert _wait_until(lambda: len(sync_state["calls"]) == 2)
    # Täpselt üks järeljooks, mitte üheksa
    time.sleep(0.05)
    assert sync_state["calls"] == ["teos-a", "teos-a"]


def test_followup_sees_latest_disk_state(monkeypatch):
    """Järeljooks loeb ketast uuesti — ta ei kanna endaga vana seisu kaasa."""
    mo._reset_sync_state_for_tests()
    disk = {"value": "vana"}
    seen = []
    started = threading.Semaphore(0)
    gate = threading.Event()

    def fake_sync(dir_name):
        seen.append(disk["value"])
        started.release()
        gate.wait(timeout=5)
        return True

    monkeypatch.setattr(mo, "sync_work_to_meilisearch", fake_sync)

    mo.sync_work_to_meilisearch_async("teos-a")
    assert started.acquire(timeout=5)

    # Kasutaja salvestab uuesti, kuni esimene sünk veel käib
    disk["value"] = "uus"
    mo.sync_work_to_meilisearch_async("teos-a")
    gate.set()

    assert _wait_until(lambda: len(seen) == 2)
    assert seen == ["vana", "uus"]
    mo._reset_sync_state_for_tests()


def test_different_works_are_not_blocked_by_each_other(sync_state):
    mo.sync_work_to_meilisearch_async("teos-a")
    mo.sync_work_to_meilisearch_async("teos-b")

    assert sync_state["started"].acquire(timeout=5)
    assert sync_state["started"].acquire(timeout=5)
    assert sorted(sync_state["calls"]) == ["teos-a", "teos-b"]
    assert mo.get_meilisearch_sync_status()["active"] == 2


def test_dirty_work_survives_failed_sync(sync_state):
    """Kui aktiivne sünk viskab vea, ei tohi vahepealne muudatus kaduda."""
    sync_state["raise_on"].add("teos-a")

    mo.sync_work_to_meilisearch_async("teos-a")
    assert sync_state["started"].acquire(timeout=5)
    mo.sync_work_to_meilisearch_async("teos-a")
    sync_state["gate"].set()

    assert _wait_until(lambda: len(sync_state["calls"]) == 2)


def test_status_exposes_coalescing_counters(sync_state):
    for _ in range(5):
        mo.sync_work_to_meilisearch_async("teos-a")
    assert sync_state["started"].acquire(timeout=5)

    status = mo.get_meilisearch_sync_status()
    assert status["requested"] == 5
    assert status["coalesced"] == 4
    assert status["active"] == 1
    assert status["dirty"] == 1


def test_work_leaves_active_set_when_done(sync_state):
    mo.sync_work_to_meilisearch_async("teos-a")
    assert sync_state["started"].acquire(timeout=5)
    sync_state["gate"].set()

    assert _wait_until(lambda: mo.get_meilisearch_sync_status()["active"] == 0)
    assert mo.get_meilisearch_sync_status()["dirty"] == 0
