"""Test: work_lock serialiseerib paralleelsed sama-teose operatsioonid."""
import sys
import threading
import time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server.admin_page_ops import work_lock


def test_work_lock_serializes_same_work(tmp_path):
    folder = tmp_path / "w"
    folder.mkdir()
    order = []

    def worker(tag):
        with work_lock("w1", str(folder)):
            order.append(f"{tag}-start")
            time.sleep(0.05)
            order.append(f"{tag}-end")

    t1 = threading.Thread(target=worker, args=("A",))
    t2 = threading.Thread(target=worker, args=("B",))
    t1.start(); t2.start(); t1.join(); t2.join()

    # Kumbki lõik on jagamatu: start kohe end (mitte A-start, B-start, ...)
    assert order in (
        ["A-start", "A-end", "B-start", "B-end"],
        ["B-start", "B-end", "A-start", "A-end"],
    )


def test_work_lock_different_works_dont_block(tmp_path):
    f1 = tmp_path / "w1"; f1.mkdir()
    f2 = tmp_path / "w2"; f2.mkdir()
    with work_lock("w1", str(f1)):
        # Teine teos ei tohi blokeeruda
        with work_lock("w2", str(f2)):
            assert True
