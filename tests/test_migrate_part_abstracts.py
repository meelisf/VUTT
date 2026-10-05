"""Osade notes → abstract_et + toimetaja notes (ADR 0063)."""
import importlib.util
import os

_spec = importlib.util.spec_from_file_location(
    "migrate_part_abstracts", os.path.join(os.path.dirname(__file__), "..", "scripts", "migrate_part_abstracts.py"))
m = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(m)


def test_sisu_marker_jagab_toimetaja_ja_avaliku_osa():
    notes, abstract = m.split_notes("Indeks F114 · liik „kiri\" · lehed 405–409; aadress 404. Sisu: Stade asjad.")
    assert notes == "Indeks F114 · liik „kiri\" · lehed 405–409; aadress 404."
    assert abstract == "Stade asjad."


def test_markerita_on_kogu_tekst_kokkuvote():
    parts, n = m.migrate_parts([{"id": "a", "notes": "Matusejutlus 2Kr 4:10."}])
    assert n == 1 and parts[0] == {"id": "a", "abstract_et": "Matusejutlus 2Kr 4:10."}


def test_kordus_ei_muuda_ja_tuhi_jaab():
    done = {"id": "a", "notes": "Indeks F1", "abstract_et": "Sisu juba olemas."}
    parts, n = m.migrate_parts([done, {"id": "b"}])
    assert n == 0 and parts == [done, {"id": "b"}]
