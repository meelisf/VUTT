# tests/test_match_aa_duplicates.py
"""Testid: extract_name_variants ja apply_aa_to_person."""
import sys
from pathlib import Path
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scripts.match_aa_duplicates import extract_name_variants


def test_full_word_in_parens():
    result = extract_name_variants("Limacius (Limasius), Andreas")
    tokens = set(result)
    assert "limacius" in tokens
    assert "limasius" in tokens
    assert "andreas" in tokens


def test_embedded_letter():
    result = extract_name_variants("Wag(e)ner, Heinrich Christian")
    tokens = set(result)
    assert "wagner" in tokens
    assert "wagener" in tokens
    assert "heinrich" in tokens
    assert "christian" in tokens


def test_multiple_embedded():
    result = extract_name_variants("Bus(sch)man(nus)")
    tokens = set(result)
    assert "busman" in tokens
    assert "busschmannus" in tokens


def test_complex_combined():
    result = extract_name_variants("Mahlsted(h) (Mahlstede), Arnoldus")
    tokens = set(result)
    assert "mahlsted" in tokens
    assert "mahlstedh" in tokens
    assert "mahlstede" in tokens
    assert "arnoldus" in tokens


def test_short_tokens_excluded():
    result = extract_name_variants("Wag(e)ner")
    tokens = set(result)
    assert "e" not in tokens


def test_no_parens():
    result = extract_name_variants("Johannes Limasius")
    tokens = set(result)
    assert "johannes" in tokens
    assert "limasius" in tokens
