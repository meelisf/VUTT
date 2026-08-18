"""Identifikaatori vormingu ühtlustamise migratsioon (issue #240).

Normaliseerimine kirjutus- ja lugemisteel tegi vormingu käitumiselt tähtsusetuks;
see skript teeb ka SALVESTATUD kuju ühtlaseks. AA jäetakse teadlikult puutumata —
see on staatiline baas, kust midagi juurde ei tule.
"""
import importlib.util
import json
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def _load_script():
    spec = importlib.util.spec_from_file_location(
        "migrate_ext_id_format",
        PROJECT_ROOT / "scripts" / "migrate_ext_id_format.py",
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _run(tmp_path, identifiers, apply=True):
    mod = _load_script()
    prosopo_dir = tmp_path / "prosopography"
    prosopo_dir.mkdir(exist_ok=True)
    (prosopo_dir / "aaa.json").write_text(
        json.dumps({"id": "vutt:Paaa", "name": {"label": "X"}, "identifiers": identifiers}),
        encoding="utf-8",
    )
    stats = mod.migrate(str(prosopo_dir), apply=apply)
    data = json.loads((prosopo_dir / "aaa.json").read_text(encoding="utf-8"))
    return data["identifiers"], stats


@pytest.mark.parametrize("scheme,raw,expected", [
    ("gnd", "GND:1029967695", "1029967695"),
    ("viaf", "VIAF:316024504", "316024504"),
    ("wikidata", "q42", "Q42"),
])
def test_dynaamiliste_baaside_id_ühtlustatakse(tmp_path, scheme, raw, expected):
    idents, _ = _run(tmp_path, [{"scheme": scheme, "id": raw}])
    assert idents == [{"scheme": scheme, "id": expected}]


def test_aa_jäetakse_puutumata(tmp_path):
    """AA on staatiline baas — 1603 kaardi ümberkirjutamine ei osta midagi."""
    idents, stats = _run(tmp_path, [{"scheme": "album_academicum", "id": "AA:341"}])
    assert idents == [{"scheme": "album_academicum", "id": "AA:341"}]
    assert stats["files_changed"] == 0


def test_normaliseerimisel_tekkiv_dublikaat_koondatakse(tmp_path):
    idents, _ = _run(tmp_path, [
        {"scheme": "gnd", "id": "GND:123", "checked_at": "2026-01-01"},
        {"scheme": "gnd", "id": "123"},
    ])
    assert idents == [{"scheme": "gnd", "id": "123", "checked_at": "2026-01-01"}]


def test_juba_kanooniline_kirje_ei_lähe_arvesse(tmp_path):
    _, stats = _run(tmp_path, [{"scheme": "gnd", "id": "1029967695"}])
    assert stats["files_changed"] == 0


def test_dry_run_ei_kirjuta(tmp_path):
    idents, stats = _run(tmp_path, [{"scheme": "gnd", "id": "GND:123"}], apply=False)
    assert idents == [{"scheme": "gnd", "id": "GND:123"}]
    assert stats["files_changed"] == 1
