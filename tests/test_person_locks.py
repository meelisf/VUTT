"""Testid per-isiku lukkudele (security_review Leid K — lost-update kaitse)."""
import json
import sys
import threading
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def test_person_lock_shared_per_id():
    """Sama person_id → sama Lock; erinev id → erinev Lock."""
    from server.prosopography.locks import person_lock
    assert person_lock("vutt:Pshared") is person_lock("vutt:Pshared")
    assert person_lock("vutt:Pa") is not person_lock("vutt:Pb")


def test_person_lock_provides_mutual_exclusion():
    """Lukk serialiseerib kriitilise lõigu — mitte-atomaarne inkrement ei kaota loendamisi."""
    from server.prosopography.locks import person_lock
    pid = "vutt:Pmutex"
    counter = {"v": 0}

    def worker():
        for _ in range(2000):
            with person_lock(pid):
                v = counter["v"]
                counter["v"] = v + 1

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert counter["v"] == 8 * 2000


def test_bulk_update_occupation_no_lost_update(tmp_path, monkeypatch):
    """Paralleelsed bulk_update_occupation samale isikule ei kaota ühtegi ametit (lukk hoiab RMW)."""
    from server.prosopography import ops

    nanoid = "abc123"
    person = {"id": f"vutt:P{nanoid}", "name": {"label": "Test"}, "occupations": []}
    (tmp_path / f"{nanoid}.json").write_text(json.dumps(person), encoding="utf-8")

    # Suuna failitee tmp-kausta ja muuda index-uuendus no-op'iks
    monkeypatch.setattr(ops, "PROSOPOGRAPHY_DIR", str(tmp_path))
    monkeypatch.setattr(ops, "_update_index_entry", lambda p: None)
    monkeypatch.setattr(
        ops, "save_with_git",
        lambda path, content, *_args, **_kwargs: Path(path).write_text(content, encoding="utf-8"),
    )

    pid = f"vutt:P{nanoid}"
    N = 20
    barrier = threading.Barrier(N)

    def worker(i):
        barrier.wait()  # sünkroniseeri start → maksimeeri võistlus
        ops.bulk_update_occupation(
            {"id": f"Q{i}", "label": f"amet{i}"}, "add", [pid], username=f"user{i}"
        )

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(N)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    data = json.loads((tmp_path / f"{nanoid}.json").read_text(encoding="utf-8"))
    ids = {o["id"] for o in data["occupations"]}
    assert len(ids) == N, f"Oodati {N} ametit, sai {len(ids)} — lost update!"


def test_bulk_occupation_updates_version_and_makes_open_form_stale(tmp_path, monkeypatch):
    """Bulk-muudatus peab vana vormi timestampi aegunuks tegema ja git commiti looma."""
    from server.prosopography import ops

    pid = "vutt:Pabc123"
    old_timestamp = "2026-01-01T00:00:00+00:00"
    person_path = tmp_path / "abc123.json"
    person_path.write_text(json.dumps({
        "id": pid,
        "name": {"label": "Test"},
        "occupations": [],
        "updated_at": old_timestamp,
        "updated_by": "old-user",
    }), encoding="utf-8")
    save_calls = []

    def fake_save(path, content, username, message=None, **_kwargs):
        save_calls.append({"path": path, "username": username, "message": message})
        Path(path).write_text(content, encoding="utf-8")
        return {"success": True, "commit_hash": "abc123"}

    monkeypatch.setattr(ops, "PROSOPOGRAPHY_DIR", str(tmp_path))
    monkeypatch.setattr(ops, "_update_index_entry", lambda _person: None)
    monkeypatch.setattr(ops, "_update_aliases_entry", lambda _person: None)
    monkeypatch.setattr(ops, "save_with_git", fake_save)

    result = ops.bulk_update_occupation(
        {"id": "Q123", "label": "professor"}, "add", [pid], username="bulk-user"
    )

    saved = json.loads(person_path.read_text(encoding="utf-8"))
    assert result["updated"] == 1
    assert saved["updated_at"] != old_timestamp
    assert saved["updated_by"] == "bulk-user"
    assert save_calls[0]["username"] == "bulk-user"
    assert "ametite massmuudatus" in save_calls[0]["message"]

    with pytest.raises(ValueError, match="^conflict:"):
        ops.update_person(pid, {
            "updated_at": old_timestamp,
            "name": {"label": "Vana avatud vorm"},
            "occupations": [],
        }, username="editor")

    # Stale save ei tohi bulk-muudatust üle kirjutada.
    after_conflict = json.loads(person_path.read_text(encoding="utf-8"))
    assert after_conflict["occupations"] == [{"id": "Q123", "label": "professor"}]


def test_update_person_endpoint_reports_missing_updated_at_as_400(client, login, monkeypatch):
    import server.prosopography.router as router

    def reject_missing(*_args, **_kwargs):
        raise ValueError("updated_at_required")

    monkeypatch.setattr(router, "get_person", lambda _person_id: {"relations": []})
    monkeypatch.setattr(router, "update_person", reject_missing)
    token = login("editor", "editorpass")
    response = client.put(
        "/prosopography/vutt%3APabc123",
        json={"name": {"label": "Test"}},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "updated_at on kohustuslik"


@pytest.mark.parametrize("missing_value", [None, ""])
def test_update_person_requires_nonempty_updated_at(tmp_path, monkeypatch, missing_value):
    from server.prosopography import ops

    pid = "vutt:Pabc123"
    person_path = tmp_path / "abc123.json"
    person_path.write_text(json.dumps({
        "id": pid,
        "name": {"label": "Test"},
        "updated_at": "2026-01-01T00:00:00+00:00",
    }), encoding="utf-8")
    monkeypatch.setattr(ops, "PROSOPOGRAPHY_DIR", str(tmp_path))

    payload = {"name": {"label": "Ülekirjutus"}}
    if missing_value is not None:
        payload["updated_at"] = missing_value
    with pytest.raises(ValueError, match="^updated_at_required$"):
        ops.update_person(pid, payload, username="editor")

    assert json.loads(person_path.read_text(encoding="utf-8"))["name"]["label"] == "Test"
