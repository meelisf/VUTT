"""Lehe tähistus otsingutekstis ja Meili lehedokumendis (ADR 0070, #630)."""
import json
import os

import pytest

from server.meili_doc import _clean_search_text, clean_text_for_search

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "page_marks_cases.json")
with open(FIXTURE, encoding="utf-8") as f:
    CASES = json.load(f)


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_otsingutekst_fikstuurid(case):
    assert clean_text_for_search(case["text"]) == case["search"]


def test_signatuur_ei_kleepu_siirdeviida_kulge():
    # 04na2fu4 lk 3: varem `EhrwürA ij`
    assert clean_text_for_search("1. Cor. 1.\nEhrwür⸗\n<sig>A ij</sig>") == "1. Cor. 1. Ehrwür"


def test_orv_ei_pyhi_lehte():
    assert clean_text_for_search("algus <sig>A ij\nülejäänud lehekülg") == "algus A ij ülejäänud lehekülg"


def test_ann_tekst_eemaldab_tahistuse():
    assert clean_text_for_search("<ann3>sõna</ann3>\n<sig>B</sig>", keep_ann=True) == "<ann3>sõna</ann3>"


def test_tahistus_marginaalia_sees():
    main, marg = _clean_search_text("põhi\n<m><fw>246</fw> nota</m>")
    assert main == "põhi"
    assert marg == "nota"


def _sync(tmp_path, monkeypatch, pages):
    """Sama muster mis tests/test_meilisearch_sync_snapshot.py `synced` fixture:
    fiksiivne teos, välised sõltuvused mockitud, dokumendid kinni püütud.
    (tests/ ei ole pakett; pytest paneb testikausta sys.path-i, seega import otse.)"""
    import test_meilisearch_sync_snapshot as snap
    import server.meilisearch_ops as ops
    work_dir = tmp_path / snap.SLUG
    work_dir.mkdir()
    snap._write_metadata(work_dir)
    for i, txt in enumerate(pages, start=1):
        snap._write_page(work_dir, f"{snap.SLUG}-{snap.WORK_ID}-{i:03d}", txt=txt,
                         sequence=i * 100, status="Toores")
    monkeypatch.setattr(ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(ops, "ARCHIVES_FILE", str(tmp_path / "_archives.json"))
    (tmp_path / "_archives.json").write_text(json.dumps(snap.ARCHIVES), encoding="utf-8")
    monkeypatch.setattr(ops, "load_collections", lambda: snap.COLLECTIONS)
    monkeypatch.setattr(ops, "load_people_aliases", lambda: snap.PEOPLE)
    monkeypatch.setattr(ops, "load_labels_store", lambda: snap.LABELS)
    captured = {}

    def fake_send(documents, wait=True):
        captured["docs"] = documents
        return True

    monkeypatch.setattr(ops, "send_to_meilisearch", fake_send)
    monkeypatch.setattr(ops, "_delete_extra_pages", lambda *a: True)
    monkeypatch.setattr(ops, "sync_letters", lambda *a: True)
    assert ops.sync_work_to_meilisearch(snap.SLUG) is True
    return captured["docs"]


def test_lehedokument_kannab_page_marks(tmp_path, monkeypatch):
    docs = _sync(tmp_path, monkeypatch, ["tekst\n<rh>Vorrede</rh>\n<catch>habe</catch>", "puhas"])
    assert docs[0]["page_marks"] == [
        {"kind": "rh", "text": "Vorrede", "seg": 0},
        {"kind": "catch", "text": "habe", "seg": 0},
    ]
    assert docs[0]["lehekylje_tekst"] == "tekst"
    assert docs[1]["page_marks"] == []   # alati olemas, ka tühjana
