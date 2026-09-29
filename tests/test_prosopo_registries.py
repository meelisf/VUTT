"""#462/#471: registri püsivõti, Q-kood ja kontrollitud koht."""
import json

import pytest

from server.prosopography import registries


@pytest.fixture
def files(tmp_path, monkeypatch):
    monkeypatch.setattr(registries, "DATA_CONFIG_DIR", str(tmp_path))
    monkeypatch.setattr(registries, "PLACES_FILE", str(tmp_path / "places.json"))
    (tmp_path / "places.json").write_text(json.dumps({"tartu": {"id": "Q13972"}, "parnu": {"id": "Q173633"}}))
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


def test_asutuse_koht_perioodi_kaupa(files):
    """AGC: Tartu 1690–1699, Pärnu 1699–1710 — koht sõltub hariduskirje aastast."""
    agc = registries.put("institution", "academia-gustavo-carolina", {
        "labels": {"et": "Academia Gustavo-Carolina"}, "type": "university", "place_key": "tartu",
        "place_periods": [{"place_key": "tartu", "to": 1699}, {"place_key": "parnu", "from": 1699, "to": 1710}],
    }, "admin")
    assert agc["place_periods"] == [{"place_key": "tartu", "to": 1699}, {"place_key": "parnu", "from": 1699, "to": 1710}]
    no_periods = registries.put("institution", "gymn", {"labels": {"et": "G"}, "type": "school"}, "admin")
    assert "place_periods" not in no_periods


@pytest.mark.parametrize("periods, code", [
    ([{"place_key": "unknown"}], "unknown_place_key"),
    ([{"place_key": "tartu", "from": 1700, "to": 1690}], "invalid_place_periods"),
    ([{"place_key": "tartu", "from": "1690"}], "invalid_place_periods"),
    ([{"place_key": "tartu", "extra": 1}], "invalid_place_periods"),
    ("tartu", "invalid_place_periods"),
])
def test_vigane_perioodikoht(files, periods, code):
    with pytest.raises(registries.RegistryError, match=code):
        registries.put("institution", "x", {"labels": {"et": "X"}, "type": "school", "place_periods": periods}, "admin")


def test_perioodikoht_ainult_asutusel(files):
    with pytest.raises(registries.RegistryError, match="unknown_fields"):
        registries.put("occupation", "x", {"labels": {"et": "X"}, "place_periods": []}, "admin")


def test_ensure_loob_puuduva_kirje(files):
    tmp, saved = files
    entry, created = registries.ensure("occupation", "valipreester", {
        "id": "Q1368286", "labels": {"et": "välipreester", "en": "military chaplain"},
        "variants": ["Feldprediger"]}, "super")
    assert created is True and entry["labels"]["et"] == "välipreester"
    assert registries.load("occupation")["valipreester"]["id"] == "Q1368286"
    assert len(saved) == 1


def test_ensure_sama_q_kood_seob_ilma_kirjutamata(files):
    tmp, saved = files
    registries.put("occupation", "kaplan", {"id": "Q208762", "labels": {"et": "kaplan"}}, "a")
    entry, created = registries.ensure("occupation", "kaplan", {
        "id": "Q208762", "labels": {"et": "Kaplan (muu nimi)"}}, "super")
    assert created is False and entry["labels"] == {"et": "kaplan"}
    assert len(saved) == 1          # ainult put


@pytest.mark.parametrize("olemas, uus", [
    ({"id": "Q1", "labels": {"et": "kaplan"}}, {"id": "Q2", "labels": {"et": "kaplan"}}),
    ({"id": "Q1", "labels": {"et": "kaplan"}}, {"labels": {"et": "kaplan"}}),
    ({"labels": {"et": "kaplan"}}, {"labels": {"et": "välipreester"}}),
])
def test_ensure_erinev_kirje_samal_votmel_on_konflikt(files, olemas, uus):
    tmp, saved = files
    registries.put("occupation", "kaplan", olemas, "a")
    with pytest.raises(registries.RegistryError, match="registry_conflict"):
        registries.ensure("occupation", "kaplan", uus, "super")
    assert len(saved) == 1


def test_ensure_q_koodita_kirjed_vorreldakse_nime_jargi_tostutundetult(files):
    registries.put("occupation", "kaplan", {"labels": {"et": "Kaplan"}}, "a")
    entry, created = registries.ensure("occupation", "kaplan", {"labels": {"et": "kaplan "}}, "s")
    assert created is False


def test_ensure_q_kood_teisel_votmel_on_duplikaat(files):
    registries.put("occupation", "kaplan", {"id": "Q208762", "labels": {"et": "kaplan"}}, "a")
    with pytest.raises(registries.RegistryError, match="duplicate_id"):
        registries.ensure("occupation", "valipreester", {"id": "Q208762", "labels": {"et": "x"}}, "s")


def test_check_ensure_ei_kirjuta(files):
    tmp, saved = files
    clean = registries.check_ensure("occupation", "notar", {"labels": {"et": "notar"}})
    assert clean["labels"] == {"et": "notar"} and saved == []
    assert "notar" not in registries.load("occupation")


def test_ensure_samaaegne_loomine_ei_kirjuta_ule(files):
    """Kaks lõime loovad sama võtme eri Q-koodiga: üks võidab, teine saab konflikti."""
    import threading
    tulemused = []

    def loo(qid):
        try:
            tulemused.append(registries.ensure("occupation", "kaplan",
                                               {"id": qid, "labels": {"et": "kaplan"}}, "s")[1])
        except registries.RegistryError as error:
            tulemused.append(str(error))

    loimed = [threading.Thread(target=loo, args=(q,)) for q in ("Q10", "Q20")]
    for t in loimed:
        t.start()
    for t in loimed:
        t.join()
    assert sorted(map(str, tulemused)) == ["True", "registry_conflict"]


def test_create_genereerib_votme_ja_eristab_samanimelise_asutuse(files):
    """Tartu gümnaasium 1630–1632 ei tohi saada kubermangugümnaasiumi võtit."""
    tmp, saved = files
    key1, old = registries.create("institution", {
        "id": "Q12376416", "labels": {"et": "Tartu Gümnaasium"}, "type": "gymnasium",
        "place_key": "tartu", "active_from": 1804, "active_to": 1890}, "admin")
    key2, new = registries.create("institution", {
        "id": "Q20641850", "labels": {"et": "Tartu gümnaasium"}, "type": "gymnasium",
        "place_key": "tartu", "active_from": 1630, "active_to": 1632}, "admin")
    key3, _ = registries.create("institution", {
        "labels": {"et": "Tartu gümnaasium"}, "type": "gymnasium", "active_from": 1630}, "admin")
    key4, _ = registries.create("institution", {"labels": {"et": "Tartu gümnaasium"}, "type": "school"}, "admin")
    assert (key1, key2, key3, key4) == ("tartu-gumnaasium", "tartu-gumnaasium-1630",
                                        "tartu-gumnaasium-1630-2", "tartu-gumnaasium-2")
    assert (new["active_from"], new["active_to"]) == (1630, 1632)
    assert set(registries.load("institution")) == {key1, key2, key3, key4}
    assert saved[-1][2] == f"Register institution: lisa {key4}"


def test_create_sama_q_kood_annab_olemasoleva_votme_ja_ei_kirjuta(files):
    tmp, saved = files
    key, _ = registries.create("occupation", {"id": "Q121594", "labels": {"et": "professor"}}, "admin")
    with pytest.raises(registries.DuplicateIdError) as error:
        registries.create("occupation", {"id": "Q121594", "labels": {"et": "õppejõud"}}, "admin")
    assert error.value.key == key and str(error.value) == "duplicate_id"
    assert len(saved) == 1


@pytest.mark.parametrize("years", [
    {"active_from": 1700, "active_to": 1690}, {"active_from": "1630"}, {"active_to": 99},
])
def test_vigane_tegutsemisaeg(files, years):
    with pytest.raises(registries.RegistryError, match="invalid_active_years"):
        registries.put("institution", "x", {"labels": {"et": "X"}, "type": "school", **years}, "admin")


def test_tegutsemisaeg_ainult_asutusel(files):
    with pytest.raises(registries.RegistryError, match="unknown_fields"):
        registries.create("occupation", {"labels": {"et": "X"}, "active_from": 1630}, "admin")


def test_votme_slug_diakriitikuteta_ja_varu(files):
    assert registries.generate_key({}, {"labels": {"et": "Åbo Akademi / Turu"}}) == "abo-akademi-turu"
    assert registries.generate_key({}, {"labels": {"et": "Õpetaja"}}) == "opetaja"
    assert registries.generate_key({}, {"labels": {"en": "—"}}) == "kirje"


def test_registrikirje_loomine_nouab_admini_ja_duplikaat_on_409(client, login, files):
    body = {"id": "Q20641850", "labels": {"et": "Tartu gümnaasium"}, "type": "gymnasium"}
    url = "/prosopography/registries/institution"
    editor = login("editor", "editorpass")
    assert client.post(url, json=body, headers={"Authorization": f"Bearer {editor}"}).status_code == 401
    admin = {"Authorization": f"Bearer {login('admin', 'adminpass')}"}
    created = client.post(url, json=body, headers=admin)
    assert created.status_code == 200
    assert created.json()["key"] == "tartu-gumnaasium"
    again = client.post(url, json={**body, "labels": {"et": "Muu"}}, headers=admin)
    assert again.status_code == 409
    assert again.json()["detail"] == {"code": "duplicate_id", "key": "tartu-gumnaasium"}
