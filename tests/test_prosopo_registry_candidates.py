"""Ameti- ja asutusregistri kandidaatotsingu serverileping."""
import json

import pytest

from server.prosopography import registry_candidates


@pytest.fixture
def registries(tmp_path, monkeypatch):
    monkeypatch.setattr(registry_candidates, "DATA_CONFIG_DIR", str(tmp_path))
    (tmp_path / "occupations.json").write_text(json.dumps({
        "pastor": {"id": "Q152002", "labels": {"et": "pastor"},
                   "variants": ["Pfarrer"]},
        "clergyman": {"id": "Q2259532", "labels": {"et": "vaimulik"},
                       "variants": ["Pfarrer"]},
        "theologian": {"id": None, "labels": {"et": "teoloog"},
                       "variants": ["Theologe"]},
    }), encoding="utf-8")
    (tmp_path / "institutions.json").write_text(json.dumps({
        "agc": {"id": None, "labels": {"et": "Academia Gustavo-Carolina"},
                "variants": ["AGC"], "type": "university", "place_key": "tartu"},
        "abo_academy": {"id": "Q123", "labels": {"et": "Åbo akadeemia"},
                "variants": ["Åbo"], "type": "university", "place_key": None},
    }), encoding="utf-8")


def test_puuduv_register_ei_tahenda_uut_kirjet(client, tmp_path, monkeypatch):
    monkeypatch.setattr(registry_candidates, "DATA_CONFIG_DIR", str(tmp_path))
    result = client.get("/prosopography/enrichment-registry-search",
                        params={"kind": "occupation", "q": "Pfarrer"})
    assert result.status_code == 200
    assert result.json()["registry_available"] is False
    assert result.json()["results"] == []


def test_ajalooline_variant_ja_q_kood_leiavad_kandidaadid(client, registries):
    result = client.get("/prosopography/enrichment-registry-search",
                        params={"kind": "occupation", "q": "Pfarrer"})
    assert result.status_code == 200
    assert result.json()["ambiguous"] is True
    assert {row["key"] for row in result.json()["results"]} == {"pastor", "clergyman"}
    assert all(row["match_kind"] == "variant" for row in result.json()["results"])
    partial = client.get("/prosopography/enrichment-registry-search",
                         params={"kind": "occupation", "q": "Pfar"}).json()
    assert partial["ambiguous"] is True
    assert all(row["match_kind"] == "partial" for row in partial["results"])
    qid = client.get("/prosopography/enrichment-registry-search",
                     params={"kind": "occupation", "q": "Q152002"}).json()
    assert qid["results"][0]["key"] == "pastor"
    assert qid["results"][0]["match_kind"] == "qid"


def test_q_koodita_asutus_ja_koht_sailivad(client, registries):
    result = client.get("/prosopography/enrichment-registry-search",
                        params={"kind": "institution", "q": "AGC"}).json()
    assert result["ambiguous"] is False
    assert result["results"][0] == {
        "key": "agc", "id": None, "labels": {"et": "Academia Gustavo-Carolina"},
        "match_kind": "key", "matched_text": "agc", "matched_variant": "AGC",
        "type": "university", "place_key": "tartu",
    }
    accent = client.get("/prosopography/enrichment-registry-search",
                        params={"kind": "institution", "q": "Abo"}).json()
    assert accent["results"][0]["match_kind"] == "accent_variant"


def test_pikk_paring_ja_vigane_register_keelatakse(client, registries, tmp_path):
    assert client.get("/prosopography/enrichment-registry-search",
                      params={"kind": "occupation", "q": "x" * 121}).status_code == 400
    assert client.get("/prosopography/enrichment-registry-search",
                      params={"kind": "place", "q": "Tartu"}).status_code == 400
    (tmp_path / "occupations.json").write_text("{broken", encoding="utf-8")
    assert client.get("/prosopography/enrichment-registry-search",
                      params={"kind": "occupation", "q": "pastor"}).status_code == 503
