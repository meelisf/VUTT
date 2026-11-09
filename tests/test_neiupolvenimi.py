"""Neiupõlvenimi (`name.maiden_name`): otsitav tuletatult, liitmisel tühja täitmine.

Väli kannab ainult perekonnanime. Otsingusse (person_aliases.json → isikuotsing
ja Meili `authors_text`) läheb ta kahe kujuna, kaardi `aliases`-isse mitte.
"""
import json

import pytest

from server.prosopography import merge_ops
from server.prosopography.indices import card_search_names
from test_person_aliases_writers import _prosopo_env


def test_neiupolvenimi_tuletab_kaks_otsingukuju():
    nimed = card_search_names({
        "label": "Rosine Elisabeth Fischer", "first_name": "Rosine Elisabeth",
        "maiden_name": "Marckthaler", "aliases": ["Rosina Elisabeth Fischer"],
    })
    assert nimed == ["Rosine Elisabeth Fischer", "Rosina Elisabeth Fischer",
                     "Marckthaler", "Rosine Elisabeth Marckthaler"]


def test_ilma_eesnimeta_ainult_paljas_neiupolvenimi():
    assert card_search_names({"label": "Anna", "maiden_name": " Dobbin "}) == ["Anna", "Dobbin"]


def test_ilma_neiupolvenimeta_kordused_kaovad():
    assert card_search_names({"label": "A", "aliases": ["A", "B", ""], "maiden_name": None}) == ["A", "B"]


def test_rebuild_kirjutab_neiupolvenime_aliaste_faili(tmp_path, monkeypatch):
    prosopo_ops, prosopo_dir, aliases_file = _prosopo_env(tmp_path, monkeypatch)
    (prosopo_dir / "aaa.json").write_text(json.dumps({
        "id": "vutt:Paaa",
        "name": {"label": "Rosine Fischer", "first_name": "Rosine",
                 "maiden_name": "Marckthaler", "aliases": []},
    }), encoding="utf-8")

    prosopo_ops.rebuild_indices()

    kirje = json.loads(aliases_file.read_text(encoding="utf-8"))["vutt:Paaa"]
    assert "Rosine Marckthaler" in kirje["aliases"]
    # Kaart ise ei muutu: tuletatud kujud ei lähe toimetaja variantide sekka.
    assert json.loads((prosopo_dir / "aaa.json").read_text())["name"]["aliases"] == []


@pytest.fixture
def env(prosopo_env, monkeypatch):
    monkeypatch.setattr(merge_ops, "_rebind_work_parts", lambda *a, **k: None)
    return prosopo_env


def test_liitmine_taidab_tuhja_neiupolvenime(env):
    env.write("src", name={"label": "R. F.", "aliases": [], "maiden_name": "Marckthaler"})
    env.write("tgt", name={"label": "Rosine Fischer", "aliases": [], "maiden_name": None})

    merge_ops.merge_person("vutt:Psrc", "vutt:Ptgt", "admin")

    assert env.read("tgt")["name"]["maiden_name"] == "Marckthaler"


def test_liitmine_jatab_sihi_neiupolvenime(env):
    env.write("src", name={"label": "R. F.", "aliases": [], "maiden_name": "Markthaler"})
    env.write("tgt", name={"label": "Rosine Fischer", "aliases": [], "maiden_name": "Marckthaler"})

    merge_ops.merge_person("vutt:Psrc", "vutt:Ptgt", "admin")

    assert env.read("tgt")["name"]["maiden_name"] == "Marckthaler"
