"""Migratsiooni ülevaatus ei kinnita mitmetähenduslikku vastet ega muuda kaarti."""
import json
from pathlib import Path

from scripts.prosopo_registry_dry_run import report_rows, review_groups


def test_raw_ja_mitmetahenduslik_vaste_jaavad_ulevaatusse(tmp_path: Path):
    path = tmp_path / "person.json"
    original = {"id": "vutt:P1", "occupations": [
        {"label": "Pfarrer", "institution": "Liivimaa", "institution_id": "Q183464"}],
        "education": [{"institution": "AGC"}]}
    path.write_text(json.dumps(original), encoding="utf-8")
    occupations = {
        "pastor": {"id": "Q152002", "labels": {"et": "pastor"}, "variants": ["Pfarrer"]},
        "vaimulik": {"id": "Q2259532", "labels": {"et": "vaimulik"}, "variants": ["Pfarrer"]},
    }
    institutions = {"agc": {"labels": {"et": "Academia Gustavo-Carolina"}, "variants": ["AGC"]}}
    places = {"liivimaa": {"id": "Q183464"}}
    rows = report_rows(tmp_path, occupations, institutions, places)
    assert [(r["field"], r["raw"], r["match"], r["candidate"]) for r in rows] == [
        ("occupation", "Pfarrer", "ambiguous", ""),
        ("place", "Liivimaa", "place_qid", "liivimaa"),
        ("institution", "AGC", "name", "agc"),
    ]
    assert rows[0]["alternatives"] == "pastor | vaimulik"
    assert json.loads(path.read_text()) == original


def test_luhend_ja_taisnimi_koondatakse_sama_kandidaadi_alla():
    rows = [
        {"person_id": "vutt:P1", "field": "institution", "raw": "AGC", "legacy_id": "",
         "candidate": "agc", "alternatives": "", "match": "name"},
        {"person_id": "vutt:P2", "field": "institution", "raw": "Academia Gustavo-Carolina", "legacy_id": "",
         "candidate": "agc", "alternatives": "", "match": "name"},
    ]
    groups = review_groups(rows)
    assert len(groups) == 1
    assert groups[0]["raw_variants"] == "AGC | Academia Gustavo-Carolina"
    assert groups[0]["count"] == 2
    assert groups[0]["decision"] == ""


def test_q_koodita_uus_nimetus_saab_ainult_votme_ettepaneku():
    groups = review_groups([{
        "person_id": "vutt:P1", "field": "occupation", "raw": "Theologe",
        "legacy_id": "", "candidate": "", "alternatives": "", "match": "unmatched",
    }])
    assert groups[0]["suggested_new_key"] == "theologe"
    assert groups[0]["candidate"] == ""
    assert groups[0]["decision"] == ""
