"""Osade isikud teose otsingus (ADR 0072, #637).

`part_persons_text` kannab kõigi osade isikute nimesid + nimevariante IGAS
lehedokumendis: dashboard otsib teose esimese lehe dokumendist, seega lehepõhine
väli ei leiaks hilisema kirja korrespondenti.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server.meili_doc import build_work_documents

PEOPLE = {
    "vutt:Psalem1": {"primary_name": "Joachim Salemann", "aliases": ["Joachimus Saleman"]},
}


def _work(tmp_path: Path, meta: dict, n_pages: int = 3) -> Path:
    work_dir = tmp_path / "kirjad-w1"
    work_dir.mkdir()
    (work_dir / "_metadata.json").write_text(json.dumps({"id": "w1", **meta}), encoding="utf-8")
    for i in range(1, n_pages + 1):
        (work_dir / f"p{i}.jpg").write_bytes(b"\xff\xd8jpeg")
        (work_dir / f"p{i}.txt").write_text("tekst", encoding="utf-8")
        (work_dir / f"p{i}.json").write_text(json.dumps({"sequence": i}), encoding="utf-8")
    return work_dir


def _docs(work_dir: Path, people=PEOPLE):
    _, docs = build_work_documents(str(work_dir), work_dir.name, {}, people, {}, {})
    return docs


def test_osade_isikud_ja_nimevariandid_igal_lehel(tmp_path):
    work_dir = _work(tmp_path, {"title": "Kirjad", "parts": [
        {"id": "a1", "kind": "letter", "pages": ["p3"], "creators": [
            {"id": "vutt:Psalem1", "name": "Joachim Salemann", "role": "auctor"},
            {"id": "vutt:Pfisch1", "name": "Johann Fischer", "role": "addressee"},
        ]},
    ]})
    docs = _docs(work_dir)
    assert len(docs) == 3
    for d in docs:
        # Ka lehtedel 1–2, mis kirja ei kuulu — dashboard vaatab esimest lehte.
        assert "Joachim Salemann" in d["part_persons_text"]
        assert "Joachimus Saleman" in d["part_persons_text"]   # nimevariant
        assert "Johann Fischer" in d["part_persons_text"]


def test_osade_isikud_ei_ole_teose_isikud(tmp_path):
    work_dir = _work(tmp_path, {"title": "Kirjad", "parts": [
        {"id": "a1", "kind": "letter", "pages": ["p1"], "creators": [
            {"id": "vutt:Psalem1", "name": "Joachim Salemann", "role": "auctor"},
        ]},
    ]})
    d = _docs(work_dir)[0]
    assert d["creators"] == []
    assert d["authors_text"] == []
    assert d["author_names"] == []


def test_kordused_eemaldatud_ja_eszett_normaliseeritud(tmp_path):
    work_dir = _work(tmp_path, {"title": "Kirjad", "parts": [
        {"id": f"a{i}", "kind": "letter", "pages": [f"p{i}"], "creators": [
            {"id": "vutt:Pgross", "name": "Hans Groß", "role": "auctor"},
        ]} for i in (1, 2)
    ]})
    d = _docs(work_dir, people={})[0]
    assert d["part_persons_text"] == ["Hans Gross"]


def test_osadeta_teosel_tuhi_valja_olemas(tmp_path):
    # attributesToSearchOn nõuab, et väli oleks igas dokumendis.
    d = _docs(_work(tmp_path, {"title": "Disputatio"}))[0]
    assert d["part_persons_text"] == []


def test_nimeta_isik_ja_vigane_osa_ei_kuku(tmp_path):
    work_dir = _work(tmp_path, {"title": "Kirjad", "parts": [
        "vigane",
        {"id": "a1", "kind": "letter", "pages": ["p1"], "creators": [
            {"id": "vutt:Psalem1", "role": "auctor"},            # nimi puudub → register
            {"name": "", "role": "addressee"},
            "vigane",
        ]},
    ]})
    d = _docs(work_dir)[0]
    assert d["part_persons_text"] == ["Joachimus Saleman"]
