"""Testid topeltlehe lõikamise loogikale."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server.admin_page_ops import split_text_at_pb


def test_split_at_pb_present():
    left, right = split_text_at_pb("Vasak tekst.\n<pb/>\nParem tekst.")
    assert left == "Vasak tekst."
    assert right == "Parem tekst."


def test_split_at_pb_absent():
    left, right = split_text_at_pb("Ainult tekst.")
    assert left == "Ainult tekst."
    assert right == "Ainult tekst."


def test_split_at_pb_empty():
    left, right = split_text_at_pb("")
    assert left == ""
    assert right == ""


def test_split_at_pb_multiple_uses_first():
    left, right = split_text_at_pb("A<pb/>B<pb/>C")
    assert left == "A"
    assert right == "B<pb/>C"


def test_split_at_pb_trims_whitespace():
    left, right = split_text_at_pb("  Vasak  \n<pb/>\n  Parem  ")
    assert left == "Vasak"
    assert right == "Parem"
