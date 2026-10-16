"""Lehe tähistuse parser (ADR 0070, #630) ja märgenduse register (ADR 0071)."""
import json
import os

import pytest

from server.vutt_tags import (
    PAGE_MARK_KINDS, VUTT_TAG_REGISTRY, normalize_page_mark_structure,
    page_mark_entries, page_mark_spans, parse_page_marks, remove_page_marks,
)

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "page_marks_cases.json")
with open(FIXTURE, encoding="utf-8") as f:
    CASES = json.load(f)


def test_tahistuse_liigid_registrist():
    assert PAGE_MARK_KINDS == ("fw", "sig", "catch", "rh")
    nimed = [t.name for t in VUTT_TAG_REGISTRY]
    assert len(nimed) == len(set(nimed))


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_spans_fikstuurid(case):
    text = case["text"]
    got = [{"kind": p.kind, "inner": text[p.open_to:p.close_from]} for p in page_mark_spans(text)]
    assert got == case["spans"]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_entries_fikstuurid(case):
    assert page_mark_entries(case["text"]) == case["marks"]


def test_parser_tagastab_ka_kehtetud_ja_sisemised():
    pairs, orphans = parse_page_marks("<fw>12<pb/><sig>B</sig></fw> <rh>x")
    by_kind = {p.kind: p for p in pairs}
    assert by_kind["fw"].valid is False and by_kind["fw"].outer is True
    assert by_kind["sig"].valid is True and by_kind["sig"].outer is False
    assert len(orphans) == 1


def test_remove_page_marks_eemaldab_ainult_kehtivad_valimised():
    assert remove_page_marks("a<sig>B</sig>b") == "ab"
    assert remove_page_marks("<fw>12<pb/>13</fw>") == "<fw>12<pb/>13</fw>"


def test_struktuuri_normaliseerimine_idempotentne():
    for case in CASES:
        once = normalize_page_mark_structure(case["text"])
        assert normalize_page_mark_structure(once) == once
