# tests/test_archives_registry.py
"""Hoidjate register: nimekujude ainulaadsus ja aliase lahendus (ADR 0076 täiendus
2026-11-02) ning ümbernimetamise skript (`scripts/rename_archive_keys.py`)."""
import importlib.util
import os

import pytest

from server.archives_registry import clean_aliases, find_conflict, form_key, resolve_holder

REG = {
    "Tallinn RR": {"name": "Rahvusraamatukogu", "aliases": ["Tallinn ERR", "RR"]},
    "Tartu TÜR": {"name": "Tartu Ülikooli Raamatukogu", "aliases": ["Tartu ÜR"]},
}


def _script():
    path = os.path.join(os.path.dirname(__file__), "..", "scripts", "rename_archive_keys.py")
    spec = importlib.util.spec_from_file_location("rename_archive_keys", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_form_key_uhtlustab_tuhikud_ja_tahesuuruse():
    assert form_key("  tallinn   ERR ") == form_key("Tallinn ERR")


@pytest.mark.parametrize("form, key", [
    ("Tallinn RR", "Tallinn RR"), ("tallinn err", "Tallinn RR"), ("RR", "Tallinn RR"),
    ("Tartu  ÜR", "Tartu TÜR"), ("KB", None), ("", None), (None, None),
])
def test_resolve_holder(form, key):
    assert resolve_holder(REG, form) == key


def test_clean_aliases():
    assert clean_aliases([" a  b ", "A B", "", "c"]) == ["a b", "c"]
    assert clean_aliases(None) == []
    for bad in ("x", [1], ["x" * 200]):
        with pytest.raises(ValueError):
            clean_aliases(bad)


def test_find_conflict():
    assert find_conflict(REG, "Tallinn RR", ["Tallinn ERR"]) is None       # kirje ise ei ole konflikt
    assert find_conflict(REG, "X", ["tartu ür"]) == ("tartu ür", "Tartu TÜR")
    assert find_conflict(REG, "rr", []) == ("rr", "Tallinn RR")
    assert find_conflict(REG, "X", ["x"]) == ("x", "X")                    # alias = oma võti


def test_skript_nimetab_umber_ja_lisab_aliased():
    mod = _script()
    current = {"TÜR": {"name": "TÜR", "url": "https://u"}, "KB": {"name": "Kungliga biblioteket"},
               "Muu": {"name": "Tundmatu"}}
    reg, renames, warnings = mod.build_registry(current)
    assert renames["TÜR"] == "Tartu TÜR" and renames["KB"] == "Stockholm KB"
    assert reg["Tartu TÜR"]["url"] == "https://u"
    assert {"TÜR", "Tartu ÜR"} <= set(reg["Tartu TÜR"]["aliases"])
    # Mitmetähenduslik kuju ei ole kellegi alias
    assert resolve_holder(reg, "KB") is None and resolve_holder(reg, "RA") is None
    assert "TÜR" not in reg and reg["Muu"] == {"name": "Tundmatu"}
    assert any("Muu" in w for w in warnings)
    # Korduskäivitus: midagi ei muutu
    again, renames2, _ = mod.build_registry(reg)
    assert again == reg and renames2 == {}


def test_skript_registri_kujud_on_ainulaadsed():
    """REGISTRY ise ei tohi anda sama kuju kahele hoidjale (build_registry viskaks)."""
    mod = _script()
    reg, _, _ = mod.build_registry({})
    assert len(reg) == len(mod.REGISTRY)
    assert set(mod.UNVERIFIED) <= set(reg)


def test_skript_ettepaneku_read():
    mod = _script()
    rows = [{"fields": {"holder": "UAH"}, "base": {"holder": "UAH"}}, {"fields": {"shelfmark": "x"}}]
    assert mod.rename_rows(rows, {"UAH": "Herrnhut UA"}) == 2
    assert rows[0] == {"fields": {"holder": "Herrnhut UA"}, "base": {"holder": "Herrnhut UA"}}


@pytest.mark.parametrize("old, shelf, out", [
    ("TLÜAR baltika", "I-3390b", "Baltika kogu, I-3390b"),
    ("TLÜAR baltika", "Baltika BA08/143", "Baltika BA08/143"),     # juba olemas
    ("TLÜAR baltika", None, "Baltika kogu"),
    ("UAH", "R 1", "R 1"),
])
def test_skript_kogu_nimi_kohaviita(old, shelf, out):
    assert _script().prefixed_shelfmark(old, shelf) == out


def test_skript_eksemplar_ja_ootel_rida():
    mod = _script()
    ren = {"TLÜAR baltika": "Tallinn TLÜAR"}
    x = mod.rename_exemplar({"id": "a", "holder": "TLÜAR baltika", "shelfmark": "III-140"}, ren)
    assert x == {"id": "a", "holder": "Tallinn TLÜAR", "shelfmark": "Baltika kogu, III-140"}
    rows = [{"op": "create", "status": "pending", "fields": {"holder": "TLÜAR baltika", "shelfmark": "I-1"}},
            {"op": "create", "status": "accepted", "fields": {"holder": "TLÜAR baltika", "shelfmark": "I-2"}}]
    mod.rename_rows(rows, ren)
    assert rows[0]["fields"] == {"holder": "Tallinn TLÜAR", "shelfmark": "Baltika kogu, I-1"}
    assert rows[1]["fields"] == {"holder": "Tallinn TLÜAR", "shelfmark": "I-2"}   # ajalugu jääb
