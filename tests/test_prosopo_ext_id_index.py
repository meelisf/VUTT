"""Väliste identifikaatorite pöördindeks: scheme:id → vutt:P... (#180).

Enne: _find_by_external_id skannis kuni ~2348 isikufaili IGA välise ID kohta
(puuduv ID = täisskann ~0,134 s). Ühe metaandmete salvestusega, kus on mitu uut
seotud isikut, korrutus.
"""
import json
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def _write_person(prosopo_dir: Path, nanoid: str, identifiers: list, **extra) -> dict:
    person = {
        "id": f"vutt:P{nanoid}",
        "name": {"label": f"Isik {nanoid}"},
        "identifiers": identifiers,
        **extra,
    }
    (prosopo_dir / f"{nanoid}.json").write_text(
        json.dumps(person, ensure_ascii=False), encoding="utf-8"
    )
    return person


@pytest.fixture
def prosopo_dir(tmp_path, monkeypatch):
    """Isoleeritud prosopograafia kaust + puhas indeksi-olek."""
    d = tmp_path / "prosopography"
    d.mkdir()
    from server.prosopography import ext_id_index
    with patch("server.prosopography.ops.PROSOPOGRAPHY_DIR", str(d)):
        ext_id_index.invalidate()
        yield d
    ext_id_index.invalidate()


def test_leiab_isiku_valise_id_jargi(prosopo_dir):
    from server.prosopography import ext_id_index
    _write_person(prosopo_dir, "aaa", [{"scheme": "wikidata", "id": "Q42"}])

    assert ext_id_index.find_person_id("wikidata", "Q42") == "vutt:Paaa"


def test_puuduv_id_tagastab_none(prosopo_dir):
    from server.prosopography import ext_id_index
    _write_person(prosopo_dir, "aaa", [{"scheme": "wikidata", "id": "Q42"}])

    assert ext_id_index.find_person_id("wikidata", "Q999") is None
    assert ext_id_index.find_person_id("gnd", "Q42") is None  # skeem loeb


def test_skaneerib_kausta_ainult_uks_kord(prosopo_dir):
    """Kordusotsing ei tohi kausta uuesti skannida — see ongi #180 iva."""
    from server.prosopography import ext_id_index
    for i in range(5):
        _write_person(prosopo_dir, f"p{i}", [{"scheme": "wikidata", "id": f"Q{i}"}])

    with patch.object(ext_id_index, "_scan_dir", wraps=ext_id_index._scan_dir) as spy:
        ext_id_index.find_person_id("wikidata", "Q1")
        ext_id_index.find_person_id("wikidata", "Q2")
        ext_id_index.find_person_id("wikidata", "puudub-1")
        ext_id_index.find_person_id("wikidata", "puudub-2")
        assert spy.call_count == 1


def test_tombstone_ja_merged_kirjeid_ei_indekseerita(prosopo_dir):
    from server.prosopography import ext_id_index
    _write_person(prosopo_dir, "dead", [{"scheme": "wikidata", "id": "Q1"}],
                  record_status="tombstone")
    _write_person(prosopo_dir, "merged", [{"scheme": "wikidata", "id": "Q2"}],
                  merged_into="vutt:Palive")
    _write_person(prosopo_dir, "alive", [{"scheme": "wikidata", "id": "Q3"}])

    assert ext_id_index.find_person_id("wikidata", "Q1") is None
    assert ext_id_index.find_person_id("wikidata", "Q2") is None
    assert ext_id_index.find_person_id("wikidata", "Q3") == "vutt:Palive"


def test_duplikaat_id_on_deterministlik_ja_logitakse(prosopo_dir, caplog):
    """Kaks kaarti sama välise ID-ga: vali determinstlikult (glob-järjekord ei ole
    stabiilne) ja logi, et duplikaat oleks leitav."""
    from server.prosopography import ext_id_index
    _write_person(prosopo_dir, "bbb", [{"scheme": "wikidata", "id": "Q42"}])
    _write_person(prosopo_dir, "aaa", [{"scheme": "wikidata", "id": "Q42"}])

    with caplog.at_level("WARNING"):
        first = ext_id_index.find_person_id("wikidata", "Q42")
    ext_id_index.invalidate()
    second = ext_id_index.find_person_id("wikidata", "Q42")

    assert first == second, "duplikaadi lahendus peab olema deterministlik"
    assert any("Q42" in r.message for r in caplog.records)


def test_uue_isiku_lisamine_uuendab_indeksit_ilma_taisskannita(prosopo_dir):
    from server.prosopography import ext_id_index
    _write_person(prosopo_dir, "aaa", [{"scheme": "wikidata", "id": "Q1"}])
    ext_id_index.find_person_id("wikidata", "Q1")  # ehita indeks

    uus = _write_person(prosopo_dir, "bbb", [{"scheme": "gnd", "id": "118540238"}])
    with patch.object(ext_id_index, "_scan_dir", wraps=ext_id_index._scan_dir) as spy:
        ext_id_index.update_for_person(uus)
        assert ext_id_index.find_person_id("gnd", "118540238") == "vutt:Pbbb"
        assert spy.call_count == 0


def test_identifikaatori_eemaldamine_kaob_indeksist(prosopo_dir):
    from server.prosopography import ext_id_index
    person = _write_person(prosopo_dir, "aaa", [
        {"scheme": "wikidata", "id": "Q1"},
        {"scheme": "gnd", "id": "G1"},
    ])
    assert ext_id_index.find_person_id("gnd", "G1") == "vutt:Paaa"

    person["identifiers"] = [{"scheme": "wikidata", "id": "Q1"}]
    ext_id_index.update_for_person(person)

    assert ext_id_index.find_person_id("gnd", "G1") is None
    assert ext_id_index.find_person_id("wikidata", "Q1") == "vutt:Paaa"


def test_kustutamine_eemaldab_koik_isiku_kirjed(prosopo_dir):
    from server.prosopography import ext_id_index
    _write_person(prosopo_dir, "aaa", [
        {"scheme": "wikidata", "id": "Q1"}, {"scheme": "viaf", "id": "V1"},
    ])
    assert ext_id_index.find_person_id("wikidata", "Q1") == "vutt:Paaa"

    ext_id_index.remove_person("vutt:Paaa")

    assert ext_id_index.find_person_id("wikidata", "Q1") is None
    assert ext_id_index.find_person_id("viaf", "V1") is None


def test_merge_suunab_valise_id_sihtisikule(prosopo_dir):
    """Merge'i järel peab lähte-isiku väline ID viitama sihtisikule."""
    from server.prosopography import ext_id_index
    _write_person(prosopo_dir, "src", [{"scheme": "wikidata", "id": "Q1"}])
    target = _write_person(prosopo_dir, "dst", [])
    assert ext_id_index.find_person_id("wikidata", "Q1") == "vutt:Psrc"

    # merge: allikas muutub tombstone'iks, siht saab identifikaatori
    ext_id_index.remove_person("vutt:Psrc")
    target["identifiers"] = [{"scheme": "wikidata", "id": "Q1"}]
    ext_id_index.update_for_person(target)

    assert ext_id_index.find_person_id("wikidata", "Q1") == "vutt:Pdst"


def test_taastub_taiskannist_parast_invalideerimist(prosopo_dir):
    """Restart / rebuild: indeksit ei pea kettal hoidma, see taastub kaustast."""
    from server.prosopography import ext_id_index
    _write_person(prosopo_dir, "aaa", [{"scheme": "wikidata", "id": "Q1"}])
    ext_id_index.find_person_id("wikidata", "Q1")

    _write_person(prosopo_dir, "bbb", [{"scheme": "wikidata", "id": "Q2"}])
    ext_id_index.invalidate()  # nagu protsessi restart

    assert ext_id_index.find_person_id("wikidata", "Q2") == "vutt:Pbbb"
    assert ext_id_index.find_person_id("wikidata", "Q1") == "vutt:Paaa"


def test_kausta_vahetus_ehitab_indeksi_umber(tmp_path):
    """Testid patchivad PROSOPOGRAPHY_DIR-i; indeks ei tohi kanduda üle kaustade."""
    from server.prosopography import ext_id_index
    a = tmp_path / "a"; a.mkdir()
    b = tmp_path / "b"; b.mkdir()
    _write_person(a, "aaa", [{"scheme": "wikidata", "id": "Q1"}])
    _write_person(b, "bbb", [{"scheme": "wikidata", "id": "Q1"}])

    ext_id_index.invalidate()
    with patch("server.prosopography.ops.PROSOPOGRAPHY_DIR", str(a)):
        assert ext_id_index.find_person_id("wikidata", "Q1") == "vutt:Paaa"
    with patch("server.prosopography.ops.PROSOPOGRAPHY_DIR", str(b)):
        assert ext_id_index.find_person_id("wikidata", "Q1") == "vutt:Pbbb"
    ext_id_index.invalidate()


def test_find_by_external_id_kasutab_indeksit(prosopo_dir):
    """_find_by_external_id peab andma sama vastuse mis enne, aga indeksi kaudu."""
    from server.prosopography import person_crud, ext_id_index
    _write_person(prosopo_dir, "aaa", [{"scheme": "wikidata", "id": "Q42"}])

    found = person_crud._find_by_external_id("wikidata", "Q42")
    assert found is not None and found["id"] == "vutt:Paaa"
    assert person_crud._find_by_external_id("wikidata", "Q999") is None

    # Teine kutse ei skanni kausta uuesti
    with patch.object(ext_id_index, "_scan_dir", wraps=ext_id_index._scan_dir) as spy:
        person_crud._find_by_external_id("wikidata", "Q42")
        assert spy.call_count == 0


def test_rebuild_from_ehitab_ilma_skannita(prosopo_dir):
    """rebuild_indices laeb kaardid niikuinii mällu — indeks tuleb sealt."""
    from server.prosopography import ext_id_index
    persons = [
        {"id": "vutt:Paaa", "identifiers": [{"scheme": "wikidata", "id": "Q1"}]},
        {"id": "vutt:Pbbb", "identifiers": [{"scheme": "gnd", "id": "G1"}],
         "record_status": "tombstone"},
    ]

    with patch.object(ext_id_index, "_scan_dir", wraps=ext_id_index._scan_dir) as spy:
        ext_id_index.rebuild_from(persons, str(prosopo_dir))
        assert ext_id_index.find_person_id("wikidata", "Q1") == "vutt:Paaa"
        assert ext_id_index.find_person_id("gnd", "G1") is None  # tombstone
        assert spy.call_count == 0


def test_indeks_ei_lange_kokku_kadunud_failiga(prosopo_dir):
    """Kui indeks viitab failile, mida enam pole (väline kustutus), tagasta None
    ja ära viska erindit."""
    from server.prosopography import person_crud, ext_id_index
    _write_person(prosopo_dir, "aaa", [{"scheme": "wikidata", "id": "Q42"}])
    assert person_crud._find_by_external_id("wikidata", "Q42") is not None

    (prosopo_dir / "aaa.json").unlink()

    assert person_crud._find_by_external_id("wikidata", "Q42") is None


# ─────────────────────────────────────────────────────────────
# Identifikaatori vorming ei tohi dublikaadikontrolli lõhkuda (#240)
# ─────────────────────────────────────────────────────────────

def test_prefiksiga_salvestatud_id_leitakse_paljale_kujule_otsides(prosopo_dir):
    """Andmetes on nii `GND:1029967695` kui `1029967695` — sama isik."""
    from server.prosopography import ext_id_index
    _write_person(prosopo_dir, "aaa", [{"scheme": "gnd", "id": "GND:1029967695"}])

    assert ext_id_index.find_person_id("gnd", "1029967695") == "vutt:Paaa"


def test_paljalt_salvestatud_id_leitakse_prefiksiga_otsides(prosopo_dir):
    from server.prosopography import ext_id_index
    _write_person(prosopo_dir, "bbb", [{"scheme": "viaf", "id": "316024504"}])

    assert ext_id_index.find_person_id("viaf", "VIAF:316024504") == "vutt:Pbbb"


def test_aa_prefiks_ja_tyhikud_ei_tekita_eri_votit(prosopo_dir):
    from server.prosopography import ext_id_index
    _write_person(prosopo_dir, "ccc", [{"scheme": "album_academicum", "id": " 243"}])

    assert ext_id_index.find_person_id("album_academicum", "AA:243") == "vutt:Pccc"
