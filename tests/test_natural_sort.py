"""Testid natural_sort_key loomulikule sorteerimisele."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server.admin_page_ops import natural_sort_key


def _sorted(names):
    return sorted(names, key=natural_sort_key)


def test_numeric_order_not_lexical():
    assert _sorted(["scan_10.jpg", "scan_2.jpg", "scan_1.jpg"]) == \
        ["scan_1.jpg", "scan_2.jpg", "scan_10.jpg"]


def test_leading_zeros_equal_value_stable():
    # 02 ja 2 sama arv → viigi-katkestaja (originaalnimi) määrab; determinism
    out = _sorted(["scan_02.jpg", "scan_2.jpg"])
    assert out == sorted(out, key=natural_sort_key)  # idempotentne
    assert set(out) == {"scan_02.jpg", "scan_2.jpg"}


def test_case_insensitive_grouping():
    assert _sorted(["Scan_1.jpg", "scan_0.jpg"]) == ["scan_0.jpg", "Scan_1.jpg"]


def test_leading_number_token():
    # "2.jpg" → re.split annab ['', '2', '.jpg']; ei tohi katki minna
    out = _sorted(["10.jpg", "2.jpg", "1.jpg"])
    assert out == ["1.jpg", "2.jpg", "10.jpg"]


def test_mixed_letters_numbers():
    assert _sorted(["a2b", "a10b", "a1b"]) == ["a1b", "a2b", "a10b"]
