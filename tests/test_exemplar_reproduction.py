# tests/test_exemplar_reproduction.py
"""Eksemplari reproduktsioon (ADR 0076 §11): liik, originaal samas teoses, ahel ilma
ringita, originaali kustutus jätab koopia alles ja tõstab lipu; märkuse migratsioon."""
import pytest

from server import work_exemplars as we
from scripts import migrate_reproduction as mr

U = {"id": "u1", "holder": "Uppsala UB", "shelfmark": "Rar 10:252", "text_witness": True}


def test_valja_puhastus():
    assert we.clean_reproduction(None) is None and we.clean_reproduction({}) is None
    assert we.clean_reproduction({"kind": "paberkoopia", "of": " u1 "}) == {"kind": "paberkoopia", "of": "u1"}
    assert we.clean_reproduction({"kind": "mikrofilm", "of": ""}) == {"kind": "mikrofilm"}
    for bad in ({"kind": "xerox"}, {"of": "u1"}, {"kind": "koopia", "extra": 1}, "koopia"):
        with pytest.raises(we.ExemplarError):
            we.clean_reproduction(bad)


def test_normaliseerimine_ja_jarjekord():
    x = we.normalize_exemplar({"notes": "n", "reproduction": {"kind": "koopia"}, "holder": "Tartu TÜR", "id": "t1"})
    assert list(x) == ["id", "holder", "reproduction", "notes"]


def test_originaal_peab_olema_sama_teose_teine_eksemplar():
    t = {"id": "t1", "holder": "Tartu TÜR", "reproduction": {"kind": "paberkoopia", "of": "u1"}}
    out, _ = we.validate_exemplars([U, t], [])
    assert out[1]["reproduction"]["of"] == "u1"
    for of in ("t1", "puudub"):
        with pytest.raises(we.ExemplarError, match="teine eksemplar"):
            we.validate_exemplars([U, {**t, "reproduction": {"kind": "koopia", "of": of}}], [])


def test_ahel_lubatud_ring_mitte():
    m = {"id": "m1", "holder": "Tartu TÜR", "reproduction": {"kind": "mikrofilm", "of": "u1"}}
    p = {"id": "p1", "holder": "Tartu TÜR", "reproduction": {"kind": "paberkoopia", "of": "m1"}}
    we.validate_exemplars([U, m, p], [])
    a = {"id": "a", "holder": "X", "reproduction": {"kind": "koopia", "of": "b"}}
    b = {"id": "b", "holder": "Y", "reproduction": {"kind": "koopia", "of": "a"}}
    with pytest.raises(we.ExemplarError, match="ring"):
        we.validate_exemplars([a, b], [])


def test_originaali_kustutus_jatab_koopia():
    t = {"id": "t1", "holder": "Tartu TÜR", "reproduction": {"kind": "paberkoopia", "of": "u1"}}
    out = we.drop_reproduction_links([t], "u1")
    assert out == [{"id": "t1", "holder": "Tartu TÜR", "reproduction": {"kind": "paberkoopia"}, "needs_review": True}]
    assert we.drop_reproduction_links([t], "muu") == [t]


@pytest.mark.parametrize("notes, kind, rest", [
    ("Paberkoopia", "paberkoopia", None),
    ("koopia", "koopia", None),
    ("Koopia (Skarast)", "koopia", "Skarast"),
    ("Fotokoopia", "fotokoopia", None),
])
def test_migratsioon_teisendab(notes, kind, rest):
    new, line = mr.convert({"id": "a", "holder": "H", "notes": notes})
    assert line is None and new["reproduction"] == {"kind": kind} and new.get("notes") == rest


def test_migratsioon_jatab_muu_markuse():
    new, line = mr.convert({"id": "a", "holder": "H", "notes": "Koopia on loetamatu, vt originaal"})
    assert new is None and "märkus jääb" in line
    assert mr.convert({"id": "a", "holder": "H", "notes": "Kohalkasutus"}) == (None, None)
    assert mr.convert({"id": "a", "holder": "H", "notes": "Paberkoopia",
                       "reproduction": {"kind": "koopia"}}) == (None, None)
