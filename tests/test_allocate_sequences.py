"""Testid allocate_sequences järjekorranumbrite jaotusele."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server.admin_page_ops import allocate_sequences


def _is_strictly_increasing(xs):
    return all(a < b for a, b in zip(xs, xs[1:]))


def test_insert_middle_fits_gap():
    # Lehed seq 100, 200; lisa 3 lehte pärast 1. lehte (after=1)
    r = allocate_sequences([100, 200], after_page_num=1, n=3)
    assert r["renumber"] is None
    assert len(r["new_seqs"]) == 3
    assert _is_strictly_increasing(r["new_seqs"])
    assert all(100 < s < 200 for s in r["new_seqs"])


def test_insert_at_end():
    r = allocate_sequences([100, 200], after_page_num=-1, n=2)
    assert r["renumber"] is None
    assert r["new_seqs"] == [300, 400]


def test_insert_at_beginning_fits():
    r = allocate_sequences([100, 200], after_page_num=0, n=2)
    assert r["renumber"] is None
    assert _is_strictly_increasing(r["new_seqs"])
    assert all(0 < s < 100 for s in r["new_seqs"])


def test_empty_work():
    r = allocate_sequences([], after_page_num=-1, n=3)
    assert r["renumber"] in (None, [])
    assert r["new_seqs"] == [100, 200, 300]


def test_gap_too_small_triggers_renumber():
    # Lehed seq 100, 101 (vahe 1); lisa 5 lehte vahele (after=1)
    r = allocate_sequences([100, 101], after_page_num=1, n=5)
    assert r["renumber"] is not None
    assert len(r["renumber"]) == 2          # 2 olemasolevat lehte
    assert len(r["new_seqs"]) == 5
    # Ühendatud järjestus: [olemasolev0, 5 uut, olemasolev1] → kõik kasvavad
    merged = [r["renumber"][0]] + r["new_seqs"] + [r["renumber"][1]]
    assert _is_strictly_increasing(merged)
    assert merged == [100, 200, 300, 400, 500, 600, 700]


def test_large_batch_renumber():
    r = allocate_sequences([100, 200], after_page_num=1, n=200)
    assert r["renumber"] is not None
    merged = [r["renumber"][0]] + r["new_seqs"] + [r["renumber"][1]]
    assert _is_strictly_increasing(merged)
    assert len(merged) == 202
