"""Osad kogu lehestiku asendusel (ADR 0089 p 5).

`sync_work_parts` jättis osadesse kõik tüved, mis esinevad ka uues lehestikus — asendusel
on need samad failinimed teise sisuga, nii et osad viitasid vaikselt valedele lehtedele.
Nüüd: osa `pages = []`, `needs_review`, vana seis serveriväljas `pages_before_replace`.
"""
import json
import os

from server import work_parts as wp
from test_work_parts import work  # noqa: F401  (fikstuur)


def _meta(work):
    return json.load(open(f"{work}/_metadata.json"))


def _kaks_osa(work):
    a = wp.create_part(work, {"kind": "letter", "pages": ["t-001", "t-002", "t-003"], "title": "A"}, "ed")
    b = wp.create_part(work, {"kind": "letter", "pages": ["t-004"], "title": "B"}, "ed")
    return a, b


OLD = {"t-001": 1, "t-002": 2, "t-003": 3, "t-004": 4}


def test_osad_nullitakse_ja_vihje_jaab(work):
    a, b = _kaks_osa(work)
    assert wp.reset_parts_for_replace(work, OLD, "admin") is True
    parts = {p["id"]: p for p in _meta(work)["parts"]}
    for pid, nums in ((a["id"], [1, 2, 3]), (b["id"], [4])):
        assert parts[pid]["pages"] == []
        assert parts[pid]["needs_review"] is True
        assert parts[pid]["pages_before_replace"]["page_numbers"] == nums
        assert parts[pid]["pages_before_replace"]["at"]
    assert parts[a["id"]]["title"] == "A"


def test_osadeta_teos_ei_muutu(work):
    path = f"{work}/_metadata.json"
    enne = open(path).read()
    assert wp.reset_parts_for_replace(work, OLD, "admin") is False
    assert open(path).read() == enne


def test_korduskaivitus_ei_kirjuta_vihjet_ule(work):
    a, _ = _kaks_osa(work)
    wp.reset_parts_for_replace(work, OLD, "admin")
    wp.reset_parts_for_replace(work, {}, "admin")       # taaste kordus: vanu numbreid enam pole
    p = next(p for p in _meta(work)["parts"] if p["id"] == a["id"])
    assert p["pages_before_replace"]["page_numbers"] == [1, 2, 3]


def test_lehtede_maaramine_kustutab_vihje(work):
    a, _ = _kaks_osa(work)
    wp.reset_parts_for_replace(work, OLD, "admin")
    p = next(p for p in _meta(work)["parts"] if p["id"] == a["id"])
    wp.update_part(work, a["id"], {**p, "pages": ["t-002"]}, "ed")
    p = next(p for p in _meta(work)["parts"] if p["id"] == a["id"])
    assert p["pages"] == ["t-002"]
    assert "pages_before_replace" not in p


def test_uuendus_ilma_lehtedeta_hoiab_vihje(work):
    a, _ = _kaks_osa(work)
    wp.reset_parts_for_replace(work, OLD, "admin")
    p = next(p for p in _meta(work)["parts"] if p["id"] == a["id"])
    wp.update_part(work, a["id"], {**{k: v for k, v in p.items() if k != "pages_before_replace"},
                                    "title": "Uus"}, "ed")
    p = next(p for p in _meta(work)["parts"] if p["id"] == a["id"])
    assert p["title"] == "Uus" and p["pages_before_replace"]["page_numbers"] == [1, 2, 3]


def test_klient_ei_saa_vihjet_kirjutada(work):
    fake = {"at": "x", "page_numbers": [99]}
    p = wp.create_part(work, {"kind": "letter", "pages": ["t-001"], "pages_before_replace": fake}, "ed")
    assert "pages_before_replace" not in p
    wp.reset_parts_for_replace(work, OLD, "admin")
    p2 = next(x for x in _meta(work)["parts"] if x["id"] == p["id"])
    wp.update_part(work, p["id"], {**p2, "pages_before_replace": fake}, "ed")
    p3 = next(x for x in _meta(work)["parts"] if x["id"] == p["id"])
    assert p3["pages_before_replace"]["page_numbers"] == [1]


def test_asendus_kutsub_osade_nullimist(tmp_path, monkeypatch):
    """Asenduse järel osad nullitud — refresh_work_mentions ei taasta vanu tüvesid."""
    from server import upload_ops
    from test_asendus_taaste import _edukas_asendus_seadistus
    upload_id, work_id, _slug, work_dir, _dd, _repo = _edukas_asendus_seadistus(tmp_path, monkeypatch)
    meta = json.loads((work_dir / "_metadata.json").read_text(encoding="utf-8"))
    meta["parts"] = [{"id": "p1", "kind": "letter", "pages": ["vana-teos_pg_001"], "creators": [],
                      "attached_to": None, "needs_review": False}]
    (work_dir / "_metadata.json").write_text(json.dumps(meta), encoding="utf-8")
    kutsed = []
    monkeypatch.setattr(wp, "reset_parts_for_replace", lambda d, old, u: kutsed.append((d, old)) or True)
    upload_ops.replace_work_content(upload_id, work_id, {}, "admin", background_tasks=None)
    assert kutsed and kutsed[0][1] == {"vana-teos_pg_001": 1}
