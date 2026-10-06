"""Pealkirja tõlge, originaal ja tekkeviis (ADR 0064, #551)."""
from server.meili_doc import TITLE_TEXT_FIELDS
from server.meili_settings import SEARCHABLE_ATTRIBUTES
from server.metadata_ops import ALLOWED_METADATA_FIELDS, normalize_title_fields


def test_valjad_on_lubatud_ja_otsitavad():
    for field in TITLE_TEXT_FIELDS:
        assert field in ALLOWED_METADATA_FIELDS
        assert field in SEARCHABLE_ATTRIBUTES
    assert "title_devised" in ALLOWED_METADATA_FIELDS


def test_tuhi_vaartus_eemaldab_votme():
    """Vorm saadab tühja välja `null`-ina — teosele ei teki `null`-võtmeid."""
    meta = {"title": "T", "title_en": None, "title_original": "  ", "title_devised": False}
    normalize_title_fields(meta)
    assert meta == {"title": "T"}


def test_vaartus_trimmitakse_ja_lipp_jaab():
    meta = {"title": "T", "title_en": " Minutes ", "title_devised": True}
    normalize_title_fields(meta)
    assert meta == {"title": "T", "title_en": "Minutes", "title_devised": True}


def test_lipp_ainult_true_kujul():
    """Ainult tõeväärtus `true` kehtib; „true"-string ega 1 ei ole koostatud pealkiri."""
    for value in ("true", 1, None):
        meta = {"title": "T", "title_devised": value}
        normalize_title_fields(meta)
        assert "title_devised" not in meta


def test_vormi_korduv_salvestus_on_no_op():
    """Tõlketa teose korduv salvestus ei muuda metaandmeid (ADR 0012)."""
    from server.save_diff import metadata_unchanged

    previous = {"title": "T", "year": 1632}
    meta = dict(previous)
    meta.update({"title_en": None, "title_original": None, "title_devised": False})
    normalize_title_fields(meta)
    assert metadata_unchanged(previous, meta)
