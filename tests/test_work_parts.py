# tests/test_work_parts.py
"""Teose osad (#464): valideerimine, toimingud, lehetoimingute sünk."""
import pytest

from server import work_parts as wp

STEMS = {"t-001", "t-002", "t-003", "t-004"}


def _p(**kw):
    base = {"id": "p1", "kind": "letter", "pages": ["t-001"], "creators": []}
    base.update(kw)
    return base


def test_kehtiv_osa_labib_ja_normaliseeritakse():
    out = wp.validate_parts([_p(title=" Kiri ", pages=["t-002", "t-001"])], STEMS)
    assert out[0]["title"] == "Kiri"
    assert out[0]["needs_review"] is False


@pytest.mark.parametrize("bad", [
    _p(kind="romaan"),
    _p(pages=["t-999"]),
    _p(pages=[]),                                         # tühi ainult needs_review'ga
    _p(creators=[{"id": "vutt:Pa", "name": "A", "role": "mentioned"}]),
    _p(kind="poem", place_to={"id": "Q1", "label": "X"}),  # place_to ainult kirjal
    _p(dating={"start": "1684-13-40"}),
])
def test_vigane_osa_400(bad):
    with pytest.raises(wp.PartError) as e:
        wp.validate_parts([bad], STEMS)
    assert e.value.status == 400


def test_tuhi_osa_lubatud_needs_reviewga():
    assert wp.validate_parts([_p(pages=[], needs_review=True)], STEMS)[0]["pages"] == []


def test_katkendlik_ja_jagatud_leht_lubatud():
    parts = [_p(id="a", pages=["t-001", "t-003"]), _p(id="b", pages=["t-003", "t-004"])]
    assert len(wp.validate_parts(parts, STEMS)) == 2


def test_id_unikaalne_ja_attached_to_reeglid():
    with pytest.raises(wp.PartError):
        wp.validate_parts([_p(id="a"), _p(id="a")], STEMS)
    with pytest.raises(wp.PartError):                     # viide olematule
        wp.validate_parts([_p(id="a", kind="attachment", attached_to="zz")], STEMS)
    with pytest.raises(wp.PartError):                     # lisa lisale
        wp.validate_parts([_p(id="a", kind="attachment", attached_to="b"),
                           _p(id="b", kind="attachment", attached_to=None)], STEMS)
    with pytest.raises(wp.PartError):                     # iseendale
        wp.validate_parts([_p(id="a", kind="attachment", attached_to="a")], STEMS)
    ok = wp.validate_parts([_p(id="a", kind="letter"), _p(id="b", kind="attachment", attached_to="a")], STEMS)
    assert ok[1]["attached_to"] == "a"


def test_new_part_ignoreerib_kliendi_id_ja_needs_review():
    p = wp.new_part({"id": "hack", "needs_review": True, "kind": "letter", "pages": ["t-001"]}, {"p1"})
    assert p["id"] not in ("hack", "p1") and p["needs_review"] is False
