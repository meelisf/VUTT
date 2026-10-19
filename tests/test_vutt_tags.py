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


# ── Märgenduse struktuurikontroll (#641): agendi ettepanek ei tohi lisada vigu ──

from server.vutt_tags import ann_tokens, has_ann_token, markup_errors, new_markup_errors


def test_tundmatu_ja_paarita():
    e = markup_errors("<x>a</x> <i>b")
    assert e[("unknown", "x")] == 2 and e[("unclosed", "i")] == 1


def test_ristuvad_paarid():
    # Arvud jäävad samaks, struktuur läheb katki — arvude võrdlus seda ei näeks.
    assert new_markup_errors("<i>x</i>", "</i>x<i>")
    assert any(k[0] == "crossing" for k in markup_errors("<i>a<b>b</i>c</b>"))


def test_m_reavahetusega():
    assert ("m_newline", "m") in markup_errors("<m>a\nb</m>")


def test_vana_viga_ei_blokeeri():
    base = "a < b </i> vana"
    assert new_markup_errors(base, base.replace("vana", "uus")) == []


def test_pb_ja_annN():
    assert not markup_errors("a<pb/>b <ann3>c</ann3>")
    assert ann_tokens("x<ann1>a</ann1> <ann12>b</ann12>") == ["<ann1>", "</ann1>", "<ann12>", "</ann12>"]
    assert has_ann_token("üks</ann1> kaks") and not has_ann_token("annab")
