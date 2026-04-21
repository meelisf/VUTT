# tests/test_match_aa_duplicates.py
"""Testid: extract_name_variants ja apply_aa_to_person."""
import sys
from pathlib import Path
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scripts.match_aa_duplicates import extract_name_variants, apply_aa_to_person


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


# ── apply_aa_to_person testid ─────────────────────────────────────────────

def test_apply_biography_only_if_empty():
    person = {"id": "vutt:Pt1", "name": {"label": "Test"}, "biography": ""}
    result = apply_aa_to_person(person, {"biography": "Sündis 1610..."})
    assert result["biography"] == "Sündis 1610..."


def test_apply_biography_not_overwritten():
    person = {"id": "vutt:Pt1", "name": {"label": "Test"}, "biography": "Olemasolev bio"}
    result = apply_aa_to_person(person, {"biography": "Uus bio"})
    assert result["biography"] == "Olemasolev bio"


def test_apply_birth_date():
    person = {"id": "vutt:Pt1", "name": {"label": "Test"}}
    result = apply_aa_to_person(person, {"birth.date": "1610-03-15", "birth.precision": "day"})
    assert result["birth"]["date"] == "1610-03-15"
    assert result["birth"]["precision"] == "day"
    assert result["birth"]["is_circa"] is False


def test_apply_birth_year_precision():
    person = {"id": "vutt:Pt1", "name": {"label": "Test"}}
    result = apply_aa_to_person(person, {"birth.date": "1610", "birth.precision": "year"})
    assert result["birth"]["date"] == "1610-01-01"
    assert result["birth"]["precision"] == "year"


def test_apply_education_dedup():
    person = {
        "id": "vutt:Pt1",
        "name": {"label": "Test"},
        "education": [
            {"institution": "Academia Gustaviana", "type": "imm.",
             "date_from": {"date": "1632-05-10", "precision": "day"}}
        ],
    }
    auto_filled = {
        "_aa_education": [
            {"institution": "Academia Gustaviana", "edu_type": "imm.",
             "date_from": {"date": "1632-05-10", "precision": "day"}, "source": "album_academicum"},
            {"institution": "Universität Rostock", "edu_type": "imm.",
             "date_from": {"date": "1628-01-01", "precision": "year"}, "source": "album_academicum"},
        ]
    }
    result = apply_aa_to_person(person, auto_filled)
    insts = [e["institution"] for e in result["education"]]
    assert len(insts) == 2
    assert "Academia Gustaviana" in insts
    assert "Universität Rostock" in insts


def test_apply_education_type_key():
    person = {"id": "vutt:Pt1", "name": {"label": "Test"}, "education": []}
    auto_filled = {
        "_aa_education": [
            {"institution": "Academia Gustaviana", "edu_type": "imm.",
             "date_from": {"date": "1632-05-10", "precision": "day"}, "source": "album_academicum"}
        ]
    }
    result = apply_aa_to_person(person, auto_filled)
    edu = result["education"][0]
    assert edu.get("type") == "imm."
    assert "edu_type" not in edu


def test_apply_origin_skipped():
    # _aa_origin jäetakse vahele (saksakeelne tekst ei sobi places.json-ga)
    person = {"id": "vutt:Pt1", "name": {"label": "Test"}, "origin": {"place": None}}
    result = apply_aa_to_person(person, {"_aa_origin": "Liivimaa"})
    assert result["origin"]["place"] is None


def test_apply_origin_not_overwritten():
    existing = {"label": "Eestimaa", "id": None, "source": None, "labels": {}}
    person = {"id": "vutt:Pt1", "name": {"label": "Test"}, "origin": {"place": existing}}
    result = apply_aa_to_person(person, {"_aa_origin": "Liivimaa"})
    assert result["origin"]["place"]["label"] == "Eestimaa"


def test_apply_name_aliases():
    person = {"id": "vutt:Pt1", "name": {"label": "Andreas Limasius", "aliases": []}}
    result = apply_aa_to_person(person, {"name.aliases": ["Limacius", "Limazius"]})
    assert result["name"]["aliases"] == ["Limacius", "Limazius"]


def test_apply_name_aliases_overwrites_existing():
    # Nimevariandid kirjutatakse üle — AA on kanooniline allikas (sama loogika kui UI-s)
    person = {"id": "vutt:Pt1", "name": {"label": "Andreas Limasius", "aliases": ["OldAlias"]}}
    result = apply_aa_to_person(person, {"name.aliases": ["Limacius", "Limazius"]})
    assert result["name"]["aliases"] == ["Limacius", "Limazius"]
    assert "OldAlias" not in result["name"]["aliases"]


def test_apply_does_not_mutate_input():
    person = {"id": "vutt:Pt1", "name": {"label": "Test"}, "biography": ""}
    apply_aa_to_person(person, {"biography": "Uus bio"})
    assert person["biography"] == ""
