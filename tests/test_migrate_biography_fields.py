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
    apply_pass_a, apply_pass_b, build_mapping, format_report, load_persons,
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


def test_katkine_json_annab_nahtava_hoiatuse_ja_jalje(tmp_path, capsys):
    (tmp_path / "katki.json").write_text("{ see ei ole json", encoding="utf-8")
    skipped = []
    persons = load_persons(str(tmp_path), skipped=skipped)
    assert persons == []
    # Vahelejäetud failinimi peab olema jäljendatud, mitte lihtsalt kadunud.
    assert skipped == ["katki.json"]
    # Hoiatus peab olema nähtav (stderr), mitte vaikne — see on kuivkäivituse
    # tõenduse alus, kui operaator loeb ainult stdout'i aruannet.
    err = capsys.readouterr().err
    assert "katki.json" in err
    assert "JSONDecodeError" in err


def _mapping_for(persons):
    return build_mapping(persons)


def test_pass_a_kirjutab_uue_valja_ja_jatab_vana_alles():
    persons = [_person("vutt:Pb", "Ludenius", PROOSA_TEKST)]
    tulem = apply_pass_a(persons, _mapping_for(persons))
    assert tulem["error"] is None
    assert persons[0][BIOGRAPHY_ET] == PROOSA_TEKST
    assert persons[0]["biography"] == PROOSA_TEKST   # pass A EI eemalda
    assert len(tulem["written"]) == 1


def test_pass_a_peatub_kui_lahtetekst_on_muutunud():
    persons = [_person("vutt:Pb", "Ludenius", PROOSA_TEKST)]
    mapping = _mapping_for(persons)
    persons[0]["biography"] = PROOSA_TEKST + " (toimetaja lisas vahepeal lause)"
    tulem = apply_pass_a(persons, mapping)
    assert tulem["error"] is not None
    assert "vutt:Pb" in tulem["error"]
    assert BIOGRAPHY_ET not in persons[0]      # midagi ei kirjutatud
    assert tulem["written"] == []


def test_pass_a_peatub_kui_sihtvali_on_taidetud_teise_tekstiga():
    persons = [_person("vutt:Pb", "Ludenius", PROOSA_TEKST)]
    mapping = _mapping_for(persons)
    persons[0][BIOGRAPHY_ET] = "midagi muud, mille keegi käsitsi kirjutas"
    tulem = apply_pass_a(persons, mapping)
    assert tulem["error"] is not None
    assert persons[0][BIOGRAPHY_ET] == "midagi muud, mille keegi käsitsi kirjutas"


def test_pass_a_on_idempotentne():
    persons = [_person("vutt:Pb", "Ludenius", PROOSA_TEKST)]
    mapping = _mapping_for(persons)
    esimene = apply_pass_a(persons, mapping)
    teine = apply_pass_a(persons, mapping)
    assert esimene["error"] is None and teine["error"] is None
    assert teine["written"] == []
    assert teine["skipped"] == 1


def test_pass_a_austab_kasitsi_muudetud_sihtvalja_vastenduses():
    # Inimene parandas aruandes `target`-i: AA-marker keset proosat → elulugu.
    persons = [_person("vutt:Px", "Segane", AA_TEKST)]
    mapping = _mapping_for(persons)
    assert mapping["entries"][0]["target"] == AA_RAW
    mapping["entries"][0]["target"] = BIOGRAPHY_ET       # inimese otsus
    tulem = apply_pass_a(persons, mapping)
    assert tulem["error"] is None
    assert persons[0][BIOGRAPHY_ET] == AA_TEKST
    assert AA_RAW not in persons[0]


def test_pass_b_eemaldab_migreeritud_kaardilt():
    persons = [_person("vutt:Pb", "Ludenius", PROOSA_TEKST)]
    mapping = _mapping_for(persons)
    apply_pass_a(persons, mapping)
    tulem = apply_pass_b(persons, mapping)
    assert tulem["error"] is None
    assert "biography" not in persons[0]
    assert persons[0][BIOGRAPHY_ET] == PROOSA_TEKST


def test_pass_b_eemaldab_tuhja_valja_ka_vastenduses_puuduvalt_kaardilt():
    persons = [{"id": "vutt:Pc", "name": {"label": "Tühi"}, "biography": None}]
    tulem = apply_pass_b(persons, {"entries": []})
    assert tulem["error"] is None
    assert "biography" not in persons[0]
    assert len(tulem["written"]) == 1


def test_pass_b_ei_puuduta_migreerimata_taidetud_kirjet():
    persons = [_person("vutt:Pz", "Migreerimata", PROOSA_TEKST)]
    tulem = apply_pass_b(persons, {"entries": []})
    assert tulem["error"] is not None
    assert persons[0]["biography"] == PROOSA_TEKST


def test_pass_b_on_idempotentne():
    persons = [_person("vutt:Pb", "Ludenius", PROOSA_TEKST)]
    mapping = _mapping_for(persons)
    apply_pass_a(persons, mapping)
    apply_pass_b(persons, mapping)
    teine = apply_pass_b(persons, mapping)
    assert teine["error"] is None
    assert teine["written"] == []


def test_pass_b_lubab_vahepeal_toimetatud_sihtvalja():
    # Toimetaja parandas `biography_et`-d pärast passi A — see on OODATUD,
    # uus väli on autoriteet ja `biography` on lihtsalt jäänuk.
    persons = [_person("vutt:Pb", "Ludenius", PROOSA_TEKST)]
    mapping = _mapping_for(persons)
    apply_pass_a(persons, mapping)
    persons[0][BIOGRAPHY_ET] = PROOSA_TEKST + " Toimetaja täiendas."
    tulem = apply_pass_b(persons, mapping)
    assert tulem["error"] is None
    assert "biography" not in persons[0]
