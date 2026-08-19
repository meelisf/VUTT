import json

from library_fixtures import make_pdf

from vutt_mcp.library.pages import (
    detect_from_text,
    from_pdf_labels,
    from_sidecar,
    resolve_mapping,
)


def test_pagelabels_rooma_ja_araabia(tmp_path):
    pdf = make_pdf(tmp_path / "a.pdf", ["a", "b", "c"],
                   labels=[(0, "r", None), (2, "D", 1)])
    m = from_pdf_labels(pdf, 3)
    assert m.labels == ["i", "ii", "1"]
    assert m.source == "pagelabels"


def test_pagelabelsita_pdf_annab_none(tmp_path):
    pdf = make_pdf(tmp_path / "a.pdf", ["a", "b"])
    assert from_pdf_labels(pdf, 2) is None


def test_tuvastus_leiab_pusiva_nihke():
    # PDF-lehed 0..8; trükitud number jaluses, nihe +3 (PDF 4 → lk 1).
    # Nummerdatud lehti on MIN_JADA (5) — lühem jada jääb teadlikult uskumata.
    lehed = ["tiitel", "tyhi", "sisukord", "eessona"] + [
        f"sisu sisu sisu\n\n{n}" for n in range(1, 6)
    ]
    m = detect_from_text(lehed)
    assert m is not None
    assert m.labels[4:] == ["1", "2", "3", "4", "5"]
    assert m.labels[:4] == [None, None, None, None]
    assert m.source == "detected"
    assert 0 < m.confidence <= 1


def test_tuvastus_ei_leia_midagi():
    assert detect_from_text(["ainult teksti", "ilma numbriteta"]) is None


def test_sidecar_vahemikega(tmp_path):
    sc = tmp_path / "A.override.json"
    sc.write_text(json.dumps({"ranges": [
        {"pdf_from": 1, "pdf_to": 2, "style": "roman", "printed_from": "i"},
        {"pdf_from": 3, "pdf_to": 3, "printed": None},
        {"pdf_from": 4, "pdf_to": 5, "style": "arabic", "printed_from": "225"},
    ]}))
    m = from_sidecar(sc, 5)
    assert m.labels == ["i", "ii", None, "225", "226"]
    assert m.source == "sidecar"


def test_sidecar_voidab_pagelabelsi(tmp_path):
    pdf = make_pdf(tmp_path / "a.pdf", ["a", "b"], labels=[(0, "D", 1)])
    sc = tmp_path / "A.override.json"
    sc.write_text(json.dumps({"ranges": [
        {"pdf_from": 1, "pdf_to": 2, "style": "arabic", "printed_from": "50"},
    ]}))
    m = resolve_mapping(pdf, ["a", "b"], sc)
    assert m.labels == ["50", "51"]
    assert m.source == "sidecar"


def test_tuvastamata_annab_none_allika(tmp_path):
    pdf = make_pdf(tmp_path / "a.pdf", ["ilma numbriteta", "samuti"])
    m = resolve_mapping(pdf, ["ilma numbriteta", "samuti"], None)
    assert m.source == "none"
    assert m.labels == [None, None]


def test_liiga_luhike_jada_jaetakse_uskumata():
    """Alla MIN_JADA järjestikuse numbri = juhus, mitte numeratsioon."""
    lehed = ["tiitel", "tyhi"] + [f"sisu\n\n{n}" for n in range(1, 4)]
    assert detect_from_text(lehed) is None
