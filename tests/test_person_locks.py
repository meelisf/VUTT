"""Testid per-isiku lukkudele (security_review Leid K — lost-update kaitse)."""
import json
import sys
import threading
from pathlib import Path

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

    pid = f"vutt:P{nanoid}"
    N = 20
    barrier = threading.Barrier(N)

    def worker(i):
        barrier.wait()  # sünkroniseeri start → maksimeeri võistlus
        ops.bulk_update_occupation({"id": f"Q{i}", "label": f"amet{i}"}, "add", [pid])

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(N)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    data = json.loads((tmp_path / f"{nanoid}.json").read_text(encoding="utf-8"))
    ids = {o["id"] for o in data["occupations"]}
    assert len(ids) == N, f"Oodati {N} ametit, sai {len(ids)} — lost update!"
