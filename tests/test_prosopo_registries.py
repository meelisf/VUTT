"""#462/#471: registri püsivõti, Q-kood ja kontrollitud koht."""
import json

import pytest

from server.prosopography import registries


@pytest.fixture
def files(tmp_path, monkeypatch):
    monkeypatch.setattr(registries, "DATA_CONFIG_DIR", str(tmp_path))
    monkeypatch.setattr(registries, "PLACES_FILE", str(tmp_path / "places.json"))
    (tmp_path / "places.json").write_text(json.dumps({"tartu": {"id": "Q13972"}}))
    saved = []

    def write(path, data, username, message=None):
        saved.append((path, username, message))
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(data, handle)
        return {"success": True}

    monkeypatch.setattr(registries, "save_config_with_git", write)
    return tmp_path, saved


def test_asutus_ja_amet_ilma_q_koodita(files):
    path, saved = files
    institution = registries.put("institution", "academia-gustaviana", {
        "id": None, "labels": {"et": "Academia Gustavo-Carolina"},
        "variants": ["AGC", "agc"], "type": "university", "place_key": "tartu",
    }, "toimetaja")
    occupation = registries.put("occupation", "professor", {
        "labels": {"et": "professor"}, "variants": ["Prof."],
    }, "toimetaja")
    assert institution["place_key"] == "tartu"
    assert institution["variants"] == ["AGC"]
    assert occupation["id"] is None
    assert registries.load("institution")["academia-gustaviana"] == institution
    assert all(item[1] == "toimetaja" for item in saved)
    assert all(item[0].startswith(str(path)) for item in saved)


def test_q_kood_ainult_yhel_kirjel_ja_koht_peab_olema_registris(files):
    registries.put("occupation", "pastor", {
        "id": "Q152002", "labels": {"et": "pastor"}}, "admin")
    with pytest.raises(registries.RegistryError, match="duplicate_id"):
        registries.put("occupation", "vaimulik", {
            "id": "Q152002", "labels": {"et": "vaimulik"}}, "admin")
    with pytest.raises(registries.RegistryError, match="unknown_place_key"):
        registries.put("institution", "agc", {
            "labels": {"et": "AGC"}, "type": "university", "place_key": "unknown",
        }, "admin")


def test_tundmatud_valjad_ei_joua_autoriteetsesse_faili(files):
    with pytest.raises(registries.RegistryError, match="unknown_fields"):
        registries.put("occupation", "pastor", {
            "labels": {"et": "pastor"}, "person_id": "vutt:Pfoo",
        }, "admin")


def test_isikufakt_sailitab_toorsildi_ja_kooskolastab_q_koodi(files):
    registries.put("occupation", "pastor", {
        "id": "Q152002", "labels": {"et": "pastor"}, "variants": ["Pfarrer"]}, "admin")
    registries.put("institution", "agc", {
        "labels": {"et": "Academia Gustavo-Carolina"}, "variants": ["AGC"],
        "type": "university", "place_key": "tartu"}, "admin")
    original = {"occupations": [{"label": "Pfarrer", "id": "Qwrong", "occupation_key": "pastor",
                                 "institution": "AGC", "institution_id": "Qwrong", "institution_key": "agc"}],
                "education": [{"institution": "AGC", "institution_key": "agc"}]}
    result = registries.normalize_person_facts(original)
    assert result["occupations"][0]["label"] == "Pfarrer"
    assert result["occupations"][0]["institution"] == "AGC"
    assert result["occupations"][0]["id"] == "Q152002"
    assert "institution_id" not in result["occupations"][0]
    assert original["occupations"][0]["id"] == "Qwrong"


def test_territoorium_ja_asutus_ei_ole_sama_link(files):
    with pytest.raises(registries.RegistryError, match="institution_and_place_are_exclusive"):
        registries.normalize_person_facts({"occupations": [
            {"label": "superintendent", "institution_key": "agc", "place_key": "tartu"}]})
    result = registries.normalize_person_facts({"occupations": [
        {"label": "superintendent", "institution": "Liivimaa", "institution_id": "Q183464",
         "place_key": "tartu"}]})
    assert result["occupations"][0]["institution"] == "Liivimaa"
    assert "institution_id" not in result["occupations"][0]


def test_registri_kinnitamine_nouab_admini(client, login, files):
    body = {"id": None, "labels": {"et": "Academia Gustavo-Carolina"},
            "variants": ["AGC"], "type": "university", "place_key": "tartu"}
    url = "/prosopography/registries/institution/academia-gustaviana"
    editor = login("editor", "editorpass")
    denied = client.put(url, json=body, headers={"Authorization": f"Bearer {editor}"})
    assert denied.status_code == 401
    admin = login("admin", "adminpass")
    saved = client.put(url, json=body, headers={"Authorization": f"Bearer {admin}"})
    assert saved.status_code == 200
    assert client.get("/prosopography/registries/institution").json()["academia-gustaviana"] == saved.json()
