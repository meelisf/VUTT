"""ADR 0077 üleminekukiht: vana <cs> ei tule korpusesse tagasi."""
import json
import os
import shutil
import uuid
from datetime import datetime, timedelta, timezone

import pytest

import server.script_transition as st
from server.config import BASE_DIR
from server.script_migration import MANIFEST_PATH, text_hash


@pytest.fixture
def work(monkeypatch):
    """Ajutine teos BASE_DIR-is + manifest; koristab enda järelt."""
    slug = f"t0077-{uuid.uuid4().hex[:6]}"
    d = os.path.join(BASE_DIR, slug)
    os.makedirs(d)
    created = []

    def make(work_id, *, manuscript=False, entry=None):
        meta = {"id": work_id, "type": {"id": "Q87167" if manuscript else "Q1261026"}}
        with open(os.path.join(d, "_metadata.json"), "w", encoding="utf-8") as f:
            json.dump(meta, f)
        if entry is not None:
            os.makedirs(os.path.dirname(MANIFEST_PATH), exist_ok=True)
            with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
                json.dump({"version": 1, "works": {work_id: entry}}, f)
            created.append(MANIFEST_PATH)
        return slug

    yield make
    shutil.rmtree(d, ignore_errors=True)
    for p in created:
        if os.path.exists(p):
            os.remove(p)


DE = "vnd die Welt ist nicht mit dem Herrn"
LA = "Quod est in corpore et non sine Deo"


def test_ocr_cs_pohikiri_keelest(work):
    slug = work("w1")
    assert st.ocr_to_absolute(slug, f"{DE} <cs>Deus</cs>") == f"<f>{DE}</f> Deus"
    assert st.ocr_to_absolute(slug, f"{LA} <cs>Gott</cs>") == f"{LA} <f>Gott</f>"


def test_ocr_saksa_leht_mahitakse_ja_idempotentne(work):
    slug = work("w2")
    once = st.ocr_to_absolute(slug, f"{DE} Ge⸗\nwitter")
    assert once.startswith("<f>")
    assert st.ocr_to_absolute(slug, once) == once


def test_ocr_antiikvaleht_ei_maha_teisel_kutsel(work):
    slug = work("w3")
    # Terve leht <cs>-is, sisu ladina → põhikiri oli fraktuur, sisu antiikva → <f>-ita
    once = st.ocr_to_absolute(slug, f"<cs>{LA}</cs>")
    assert once == LA
    assert st.ocr_to_absolute(slug, once) == once


def test_ocr_kasikiri_muutumata(work):
    slug = work("w4", manuscript=True)
    assert st.ocr_to_absolute(slug, DE) == DE


def test_ocr_lipp_valjas_muutumata(work, monkeypatch):
    slug = work("w5")
    monkeypatch.setattr(st.config, "OCR_OUTPUT_RELATIVE_CS", False)
    assert st.ocr_to_absolute(slug, "a <cs>b</cs>") == "a <cs>b</cs>"


def test_sisend_cs_teisendatakse(work):
    slug = work("w6")
    assert st.incoming_to_absolute(slug, f"{LA} <cs>Gott</cs>") == f"{LA} <f>Gott</f>"
    assert st.incoming_to_absolute(slug, f"{LA} <f>Gott</f>") == f"{LA} <f>Gott</f>"


def test_taastamine_cs_versioon_teisendatakse(work):
    slug = work("w7")
    assert st.restored_to_absolute(slug, f"{LA} <cs>Gott</cs>", "deadbeef") == f"{LA} <f>Gott</f>"


def test_taastamine_margendamata_vana_fraktuur(work, monkeypatch):
    migrated = datetime(2026, 11, 3, tzinfo=timezone.utc)
    slug = work("w8", entry={"pages": {}, "migrated_at": migrated.isoformat()})
    monkeypatch.setattr(st, "_commit_time", lambda h: migrated - timedelta(days=1) if h == "vana" else migrated + timedelta(days=1))
    assert st.restored_to_absolute(slug, DE, "vana") == f"<f>{DE}</f>"
    assert st.restored_to_absolute(slug, DE, "uus") == DE  # migratsioonijärgne: inimese otsus


def test_vananenud_base(work):
    slug = work("w9", entry={"pages": {
        "p1.txt": {"in": text_hash("vana"), "out": text_hash("<f>vana</f>")}}})
    assert st.stale_premigration_base(slug, "p1.txt", "vana")
    assert not st.stale_premigration_base(slug, "p1.txt", "<f>vana</f>")
