"""Migratsiooni kuivkäivitus: klassifikatsioon, lipud, aruande järjekord.

Kuivkäivitus EI KIRJUTA kaartidele midagi — see on kogu passi A ohutuse alus.
"""
import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))

from migrate_biography_language_fields import (  # noqa: E402
    build_mapping, format_report, load_persons,
)
from server.prosopo_biography_fields import AA_RAW, BIOGRAPHY_ET, text_hash  # noqa: E402

AA_TEKST = (
    "Immatrikuleerimise kuupäev: 20. September 1634\n"
    "154. Lünaeus, Emundus, Smål., * 1604, † 1693. AG: Dep. 18. 9. 1634."
)
PROOSA_TEKST = (
    "Emundus Lünaeus oli Smålandist pärit üliõpilane, kes jõudis Tartusse "
    "kolmekümneaastase sõja keskel ja jäi siia mitmeks aastaks õppima."
)


def _person(pid, nimi, bio):
    return {"id": pid, "name": {"label": nimi}, "biography": bio}


def test_kaardistus_katab_koik_taidetud_kirjed():
    persons = [
        _person("vutt:Pa", "Lünaeus", AA_TEKST),
        _person("vutt:Pb", "Ludenius", PROOSA_TEKST),
        _person("vutt:Pc", "Tühi", None),
        _person("vutt:Pd", "Tühik", "   \n "),
    ]
    mapping = build_mapping(persons)
    ids = [e["id"] for e in mapping["entries"]]
    assert ids == ["vutt:Pa", "vutt:Pb"] or sorted(ids) == ["vutt:Pa", "vutt:Pb"]
    sihid = {e["id"]: e["target"] for e in mapping["entries"]}
    assert sihid["vutt:Pa"] == AA_RAW
    assert sihid["vutt:Pb"] == BIOGRAPHY_ET


def test_kirje_kannab_rasi_ja_eelvaadet():
    mapping = build_mapping([_person("vutt:Pa", "Lünaeus", AA_TEKST)])
    kirje = mapping["entries"][0]
    assert kirje["source_hash"] == text_hash(AA_TEKST)
    assert kirje["length"] == len(AA_TEKST)
    assert kirje["preview"] == AA_TEKST[:200]
    assert kirje["name"] == "Lünaeus"


def test_lipuga_read_on_aruande_alguses():
    kahtlane = _person("vutt:Px", "Kahtlane", "**paks** " + AA_TEKST)
    puhas = _person("vutt:Py", "Puhas", AA_TEKST)
    mapping = build_mapping([puhas, kahtlane])
    aruanne = format_report(mapping)
    assert aruanne.index("vutt:Px") < aruanne.index("vutt:Py")


def test_load_persons_jatab_pildikausta_vahele(tmp_path):
    (tmp_path / "images").mkdir()
    (tmp_path / "images" / "ei_ole.json").write_text("{}", encoding="utf-8")
    (tmp_path / "abc.json").write_text(
        json.dumps({"id": "vutt:Pabc", "biography": PROOSA_TEKST}), encoding="utf-8")
    (tmp_path / "katki.json").write_text("{ see ei ole json", encoding="utf-8")
    persons = load_persons(str(tmp_path))
    assert [p["id"] for p in persons] == ["vutt:Pabc"]
