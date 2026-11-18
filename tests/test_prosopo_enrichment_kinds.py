"""#834: isikuettepaneku uued realiigid — sünd, surm, päritolu, sugu, elulugu."""
import pytest

from server.prosopo_biography_fields import text_hash
from server.prosopography import enrichment_proposals as proposals
# Fixture'id (autouse: ajutine ettepanekute baas, korpuses teos w1 50 lk) jagatud.
from tests.test_prosopo_enrichment_proposals import (  # noqa: F401
    _headers, _kood, korpuse_teos, proposal_db, registrid)

@pytest.fixture(autouse=True)
def allika_teos(monkeypatch):
    """„Allikad" kirje teose kontroll (person_sources) näeb sama korpust: ainult w1."""
    from server.prosopography import person_sources
    monkeypatch.setattr(person_sources, "_load_meta", lambda work_id: {} if work_id == "w1" else None)


OK_EVIDENCE = [{"source_kind": "vutt_page", "work_id": "w1", "page": 3}]
LINK = "([VUTT, *Oratio*, 3](https://vutt.utlib.ut.ee/work/w1/3))"


def _bio(text=f"Professor {LINK}.", **extra):
    item = {"kind": "biography", "lang": "et", "base_hash": text_hash(""), "text": text}
    item.update(extra)
    return item


@pytest.mark.parametrize("item", [
    {"kind": "birth", "date": {"date": "1755", "precision": "year"}, "evidence": OK_EVIDENCE},
    {"kind": "death", "date": {"date": "1807-03-02", "precision": "day"}, "place_key": "tartu",
     "evidence": OK_EVIDENCE},
    {"kind": "origin", "place_key": "tartu", "evidence": OK_EVIDENCE},
    {"kind": "gender", "value": "M", "evidence": OK_EVIDENCE},
    _bio(sources_add=[{"text": "Levitski 1902: Биографический словарь I, lk 106."},
                      {"work_id": "w1", "page": 3}]),
    _bio(text="Suhteline viide ([VUTT](/work/w1/7))."),
])
def test_kehtiv_rida(item, registrid):
    proposals._validate_item(item)


@pytest.mark.parametrize("item,kood", [
    ({"kind": "birth", "date": {"date": "1755"}, "evidence": []}, "evidence_required"),
    ({"kind": "birth", "date": {"date": "1755"}, "evidence": OK_EVIDENCE, "place_key": "tartu"},
     "invalid_item"),
    ({"kind": "birth", "date": {"date": "17x5"}, "evidence": OK_EVIDENCE}, "invalid_date"),
    ({"kind": "origin", "place_key": "atlantis", "evidence": OK_EVIDENCE}, "unknown_place_key"),
    ({"kind": "death", "date": {"date": "1807"}, "place_key": "atlantis", "evidence": OK_EVIDENCE},
     "unknown_place_key"),
    ({"kind": "gender", "value": "X", "evidence": OK_EVIDENCE}, "invalid_gender"),
    (_bio(lang="de"), "invalid_lang"),
    (_bio(text="ilma viiteta"), "citation_required"),
    (_bio(text=f"<b>x</b> {LINK}"), "html_not_allowed"),
    (_bio(lang="en", text=f"Хорн {LINK}"), "cyrillic_not_allowed"),
    (_bio(text="x" * 40_001 + f" {LINK}"), "biography_too_long"),
    (_bio(base_hash=None), "invalid_base_hash"),
    (_bio(sources_add=[{"source_kind": "literature", "source_id": "ABC", "locator": "lk 1"}]),
     "literature_not_resolved"),
    (_bio(sources_add=[{"text": "x"}] * 11), "too_many_sources"),
    ({"kind": "origin", "place_key": "tartu", "evidence": OK_EVIDENCE,
      "match_status": "matched"}, "invalid_item"),
])
def test_vigane_rida(item, kood, registrid):
    with pytest.raises(proposals.ProposalError, match=kood):
        proposals._validate_item(item)


def test_eluloo_lingid():
    from server.prosopography.enrichment_kinds import biography_links
    tekst = f"a {LINK} b ([x](/work/AbC_9/12)) c (https://example.org/work/w2/1)"
    assert biography_links(tekst) == [
        {"source_kind": "vutt_page", "work_id": "w1", "page": 3},
        {"source_kind": "vutt_page", "work_id": "AbC_9", "page": 12},
    ]


@pytest.fixture
def esita(client, login, prosopo_env, registrid):
    """Esitab ettepaneku HTTP kaudu; tagastab vastuse."""
    card = prosopo_env.write("abc")
    token = login("superadmin", "superpass")

    def run(items):
        body = {"code": _kood(client, token), "person_id": "vutt:Pabc",
                "base_updated_at": card["updated_at"], "items": items}
        return client.post("/prosopography/enrichment-proposals/submit", json=body)
    run.token = token
    return run


def test_kaks_sama_liigi_rida_lukatakse_tagasi(esita):
    birth = {"kind": "birth", "date": {"date": "1755"}, "evidence": OK_EVIDENCE}
    r = esita([birth, dict(birth)])
    assert r.status_code == 400 and "duplicate_kind" in r.text
    # Eri keele elulood on eri liigid
    assert esita([_bio(), _bio(lang="en", text=f"Professor {LINK}.")]).status_code == 200


def test_eluloo_link_vale_lehele(esita):
    r = esita([_bio(text="x ([V](/work/w1/999))")])
    assert r.status_code == 400 and "page_out_of_range" in r.text


def test_allika_teos_kontrollitakse_esitusel(esita):
    r = esita([_bio(sources_add=[{"work_id": "w2", "page": 1}])])
    assert r.status_code == 400 and "unknown_work" in r.text


def test_pikk_elulugu_mahub(esita):
    pikk = ("Lõik pikast eluloost. " * 2800)[:39_000] + f" {LINK}"
    assert esita([_bio(text=pikk), _bio(lang="en", text=pikk)]).status_code == 200


# ── Ülesanne 2: olek ülevaatusel ja kinnitus ─────────────────────────────

from tests.test_prosopo_enrichment_proposals import _submit_for_review  # noqa: E402

EV_B = {"source_kind": "vutt_page", "work_id": "w1", "page": 9}
BIRTH = {"kind": "birth", "date": {"date": "1755", "precision": "year"}, "evidence": OK_EVIDENCE}


@pytest.fixture
def kohad(registrid, monkeypatch):
    """Koharegister ka päritolu rikastajale (places_ops loeb oma vahemälust)."""
    import json as _json
    from server.prosopography import places_ops
    config, _ = registrid
    (config / "places.json").write_text(_json.dumps({
        "tartu": {"id": "Q13972", "labels": {"et": "Tartu", "en": "Tartu"}},
        "riia": {"id": "Q1773", "labels": {"et": "Riia", "en": "Riga"}}}))
    monkeypatch.setattr(places_ops, "PLACES_FILE", str(config / "places.json"))
    places_ops._load_places_cache(force_reload=True)
    yield config
    places_ops._load_places_cache(force_reload=True)


def _ylevaatus(client, login, prosopo_env, items, **card):
    card = prosopo_env.write("abc", occupations=[], education=[], **card)
    token = login("superadmin", "superpass")
    proposal_id = _submit_for_review(client, token, card, items)
    rows = client.get(f"/prosopography/enrichment-proposals/{card['id']}",
                      headers=_headers(token)).json()[0]["items"]

    def kinnita(selected):
        return client.post(f"/prosopography/enrichment-proposals/{card['id']}/apply",
                           headers=_headers(token),
                           json={"proposal_id": proposal_id, "selected": selected})
    return rows, kinnita


def test_sund_tuhjale_kaardile_applicable_ja_kinnitus_kirjutab_toendi(client, login, prosopo_env, kohad):
    rows, kinnita = _ylevaatus(client, login, prosopo_env, [BIRTH])
    assert rows[0]["review_state"]["state"] == "applicable"
    assert kinnita([0]).status_code == 200
    birth = prosopo_env.read("abc")["birth"]
    assert birth["date"] == "1755" and birth["precision"] == "year"
    assert birth["evidence"] == OK_EVIDENCE


def test_sama_sund_already_present_lisab_ainult_toendi(client, login, prosopo_env, kohad):
    item = {**BIRTH, "evidence": OK_EVIDENCE + [EV_B], "date": {"date": "1755", "is_circa": True}}
    rows, kinnita = _ylevaatus(client, login, prosopo_env, [item], birth={
        "date": "1755", "precision": "year", "is_circa": False, "evidence": OK_EVIDENCE})
    assert rows[0]["review_state"]["state"] == "already_present"
    assert kinnita([0]).status_code == 200
    birth = prosopo_env.read("abc")["birth"]
    assert birth["evidence"] == OK_EVIDENCE + [EV_B]
    assert birth["is_circa"] is True  # tühja (false) koha täitmine


def test_erinev_sund_on_conflict_ja_kinnitus_asendab(client, login, prosopo_env, kohad):
    rows, kinnita = _ylevaatus(client, login, prosopo_env, [BIRTH], birth={
        "date": "1754", "precision": "year", "evidence": [EV_B], "notes": "märkus"})
    state = rows[0]["review_state"]
    assert state["state"] == "conflict" and state["current"]["date"] == "1754"
    assert kinnita([0]).status_code == 200
    birth = prosopo_env.read("abc")["birth"]
    assert birth["date"] == "1755" and birth["evidence"] == OK_EVIDENCE
    assert birth["notes"] == "märkus"  # muu väli jääb


def test_surm_kohaga_ja_paritolu(client, login, prosopo_env, kohad):
    items = [{"kind": "death", "date": {"date": "1807-03-02", "precision": "day"},
              "place_key": "tartu", "evidence": OK_EVIDENCE},
             {"kind": "origin", "place_key": "riia", "evidence": OK_EVIDENCE},
             {"kind": "gender", "value": "M", "evidence": OK_EVIDENCE}]
    rows, kinnita = _ylevaatus(client, login, prosopo_env, items)
    assert [r["review_state"]["state"] for r in rows] == ["applicable"] * 3
    assert kinnita([0, 1, 2]).status_code == 200
    saved = prosopo_env.read("abc")
    assert saved["death"]["place"]["id"] == "Q13972" and saved["death"]["evidence"] == OK_EVIDENCE
    assert saved["origin"]["place"] == "riia" and saved["origin"]["place_id"] == "Q1773"
    assert saved["origin"]["evidence"] == OK_EVIDENCE
    assert saved["gender"] == "M"


def test_paritolu_conflict_ja_sama(client, login, prosopo_env, kohad):
    item = {"kind": "origin", "place_key": "riia", "evidence": OK_EVIDENCE}
    rows, _ = _ylevaatus(client, login, prosopo_env, [item], origin={"place": "tartu"})
    assert rows[0]["review_state"]["state"] == "conflict"
    assert rows[0]["review_state"]["current"] == "tartu"
    rows, _ = _ylevaatus(client, login, prosopo_env, [item], origin={"place": "riia"})
    assert rows[0]["review_state"]["state"] == "already_present"


def test_elulugu_replace_ja_stale(client, login, prosopo_env, kohad):
    item = _bio(text=f"Uus elulugu {LINK}.", base_hash=text_hash("Vana."))
    rows, kinnita = _ylevaatus(client, login, prosopo_env, [item], biography_et="Vana.")
    assert rows[0]["review_state"]["state"] == "replace"
    assert rows[0]["review_state"]["current"] == "Vana."
    # Toimetaja muudab vahepeal teksti käsitsi → rida vananeb
    card = prosopo_env.read("abc")
    prosopo_env.write("abc", **{**{k: v for k, v in card.items() if k != "id"},
                                "biography_et": "Vahepeal parandatud."})
    response = kinnita([0])
    assert response.status_code == 400 and "stale_biography" in response.text
    assert prosopo_env.read("abc")["biography_et"] == "Vahepeal parandatud."


def test_eluloo_kinnitus_ei_kirjuta_ankrut_ja_lisab_allikad_duplikaatideta(client, login, prosopo_env, kohad):
    anchor = {"hash": "abcdefabcdef", "at": "2026-01-01T00:00:00+00:00"}
    item = _bio(sources_add=[{"text": "A"}, {"text": "B"}, {"work_id": "w1", "page": 3}])
    rows, kinnita = _ylevaatus(client, login, prosopo_env, [item], biography_en="English.",
                               biography_en_src=anchor,
                               sources=[{"text": "A"}, {"work_id": "w1", "page": 3}])
    assert rows[0]["review_state"]["state"] == "applicable"
    response = kinnita([0])
    assert response.status_code == 200, response.text
    saved = prosopo_env.read("abc")
    assert saved["biography_et"] == item["text"]
    assert saved["biography_en_src"] == anchor
    assert saved["sources"] == [{"text": "A"}, {"work_id": "w1", "page": 3}, {"text": "B"}]


def test_mitu_liiki_uks_kinnitus_uks_commit(client, login, prosopo_env, kohad, monkeypatch):
    from server.prosopography import state
    calls = []
    real = state.save_with_git
    monkeypatch.setattr(state, "save_with_git", lambda *a, **k: calls.append(a) or real(*a, **k))
    items = [BIRTH, {"kind": "origin", "place_key": "tartu", "evidence": OK_EVIDENCE}, _bio()]
    rows, kinnita = _ylevaatus(client, login, prosopo_env, items)
    calls.clear()
    assert kinnita([0, 1, 2]).status_code == 200
    assert len(calls) == 1


def test_kadunud_koht_blocked(client, login, prosopo_env, kohad):
    import json as _json
    from server.prosopography import places_ops
    item = {"kind": "origin", "place_key": "riia", "evidence": OK_EVIDENCE}
    card = prosopo_env.write("abc", occupations=[], education=[])
    token = login("superadmin", "superpass")
    _submit_for_review(client, token, card, [item])
    (kohad / "places.json").write_text(_json.dumps({"tartu": {"id": "Q13972"}}))
    places_ops._load_places_cache(force_reload=True)
    rows = client.get(f"/prosopography/enrichment-proposals/{card['id']}",
                      headers=_headers(token)).json()[0]["items"]
    assert rows[0]["review_state"] == {"state": "blocked", "reason": "unknown_place_key"}


# ── Ülesanne 3: kaart säilitab skalaarvälja tõendi ───────────────────────

def test_update_person_sailitab_skalaartoendi(prosopo_env, kohad):
    from server.prosopography.person_crud import get_person, update_person
    card = prosopo_env.write("abc")
    update_person("vutt:Pabc", {
        "updated_at": card["updated_at"],
        "birth": {"date": "1755", "precision": "year", "evidence": OK_EVIDENCE},
        "death": {"date": "1807", "precision": "year", "evidence": [EV_B]},
        "origin": {"place": "tartu", "evidence": OK_EVIDENCE},
    }, "t")
    saved = get_person("vutt:Pabc")
    assert saved["birth"]["evidence"] == OK_EVIDENCE
    assert saved["death"]["evidence"] == [EV_B]
    assert saved["origin"]["evidence"] == OK_EVIDENCE and saved["origin"]["place_id"] == "Q13972"


def test_paritolu_kinnitus_ei_loo_birth_place_seost(client, login, prosopo_env, kohad):
    old_place = {"id": "Q1", "label": "Riga"}
    item = {"kind": "origin", "place_key": "tartu", "evidence": OK_EVIDENCE}
    rows, kinnita = _ylevaatus(client, login, prosopo_env, [item],
                               birth={"date": "1755", "precision": "year", "place": old_place})
    assert kinnita([0]).status_code == 200
    saved = prosopo_env.read("abc")
    assert saved["origin"]["place"] == "tartu"
    assert saved["birth"]["place"] == old_place


# ── 2. osa: nimevariant, nimi, staatus, konfessioon, tegutsemisaeg, seos, ID ──

@pytest.fixture
def sonastik(tmp_path, monkeypatch):
    import json as _json
    from server.prosopography import enrichment_kinds
    path = tmp_path / "vocabularies.json"
    path.write_text(_json.dumps({
        "seisused": [{"id": "Q134737", "label": {"et": "aadlik", "en": "noble"}}],
        "konfessioonid": [{"id": "Q75809", "label": {"et": "luterlane", "en": "Lutheran"}}],
    }))
    monkeypatch.setattr(enrichment_kinds, "VOCABULARIES_FILE", str(path))
    return path


@pytest.mark.parametrize("item", [
    {"kind": "alias", "value": "Joh. Hornius", "evidence": OK_EVIDENCE},
    {"kind": "name", "label": "Gripenhielm", "type": "ennobled", "from": 1650, "evidence": OK_EVIDENCE},
    {"kind": "status", "id": "Q134737", "evidence": OK_EVIDENCE},
    {"kind": "confession", "id": "Q75809", "evidence": OK_EVIDENCE},
    {"kind": "floruit", "year_from": 1640, "year_to": 1660, "evidence": OK_EVIDENCE},
    {"kind": "floruit", "year_to": 1660, "evidence": OK_EVIDENCE},
    {"kind": "relation", "name": "Isik B", "type": "õpetaja", "type_id": "Q1", "target_id": "vutt:Pbbb",
     "evidence": OK_EVIDENCE},
    {"kind": "relation", "name": "Tundmatu", "type": "vend", "evidence": OK_EVIDENCE},
    {"kind": "identifier", "scheme": "wikidata", "id": "q123", "evidence": OK_EVIDENCE},
])
def test_osa2_kehtiv_rida(item, registrid, sonastik):
    proposals._validate_item(item)


@pytest.mark.parametrize("item,kood", [
    ({"kind": "status", "id": "Q999", "evidence": OK_EVIDENCE}, "unknown_vocabulary_id"),
    ({"kind": "name", "label": "X", "type": "nickname", "evidence": OK_EVIDENCE}, "invalid_name_type"),
    ({"kind": "floruit", "evidence": OK_EVIDENCE}, "invalid_floruit"),
    ({"kind": "floruit", "year_from": 1700, "year_to": 1600, "evidence": OK_EVIDENCE}, "invalid_floruit"),
    ({"kind": "identifier", "scheme": "orcid", "id": "1", "evidence": OK_EVIDENCE}, "invalid_scheme"),
    ({"kind": "relation", "name": "B", "type": "vend", "target_id": "x", "evidence": OK_EVIDENCE},
     "invalid_person_id"),
    ({"kind": "alias", "value": "Хорн", "evidence": OK_EVIDENCE}, "cyrillic_not_allowed"),
    ({"kind": "alias", "value": "", "evidence": OK_EVIDENCE}, "invalid_text"),
    ({"kind": "alias", "value": "X", "evidence": []}, "evidence_required"),
])
def test_osa2_vigane_rida(item, kood, registrid, sonastik):
    with pytest.raises(proposals.ProposalError, match=kood):
        proposals._validate_item(item)


def test_sonastikuvaline_kood_loetleb_lubatud(registrid, sonastik):
    with pytest.raises(proposals.ProposalError, match="Q134737: aadlik"):
        proposals._validate_item({"kind": "status", "id": "Q1", "evidence": OK_EVIDENCE})


def test_sama_alias_kaks_korda_eri_aliased_lubatud(esita, sonastik):
    a = {"kind": "alias", "value": "Hornius", "evidence": OK_EVIDENCE}
    r = esita([a, {**a, "value": "hornius"}])
    assert r.status_code == 400 and "duplicate_kind" in r.text
    assert esita([a, {**a, "value": "Hornus"}]).status_code == 200


# ── 2. osa: olek ja kinnitus ─────────────────────────────────────────────

@pytest.fixture
def osa2(prosopo_env, kohad, sonastik, monkeypatch):
    """Vastastikune seos kirjutab B kaarti otse (reciprocal_ops): suuna testikausta."""
    from server.prosopography import reciprocal_ops, router
    monkeypatch.setattr(reciprocal_ops, "PROSOPOGRAPHY_DIR", str(prosopo_env.dir))

    def fake_save(path, content, username, message=None, **_):
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(content)
        return {"success": True}
    monkeypatch.setattr(reciprocal_ops, "save_with_git", fake_save)
    monkeypatch.setattr(router, "enrich_entity_labels_from_person_async", lambda person: None)
    return prosopo_env


def _rida(state, rows, i=0):
    return rows[i]["review_state"]["state"]


def test_osa2_loendiread_kinnituvad(client, login, osa2):
    items = [{"kind": "alias", "value": "Hornius", "evidence": OK_EVIDENCE},
             {"kind": "name", "label": "Hornensis", "type": "latinized", "from": 1780, "evidence": OK_EVIDENCE},
             {"kind": "status", "id": "Q134737", "evidence": OK_EVIDENCE},
             {"kind": "confession", "id": "Q75809", "evidence": OK_EVIDENCE},
             {"kind": "floruit", "year_from": 1780, "year_to": 1807, "evidence": OK_EVIDENCE},
             {"kind": "identifier", "scheme": "wikidata", "id": "q123", "evidence": OK_EVIDENCE}]
    rows, kinnita = _ylevaatus(client, login, osa2, items)
    assert [r["review_state"]["state"] for r in rows] == ["applicable"] * 6
    assert rows[2]["display_label"] == "aadlik"
    response = kinnita(list(range(6)))
    assert response.status_code == 200, response.text
    saved = osa2.read("abc")
    assert "Hornius" in saved["name"]["aliases"]
    assert {"label": "Hornensis", "type": "latinized"}.items() <= saved["name"]["names"][0].items()
    assert saved["statuses"] == [{"id": "Q134737", "label": "aadlik", "labels": {"et": "aadlik", "en": "noble"}}]
    assert saved["confessions"][0]["id"] == "Q75809"
    assert saved["floruit"]["year_from"] == 1780 and saved["floruit"]["evidence"] == OK_EVIDENCE
    assert {"scheme": "wikidata", "id": "Q123"}.items() <= saved["identifiers"][0].items()


def test_osa2_juba_kaardil(client, login, osa2):
    items = [{"kind": "alias", "value": "hornius", "evidence": OK_EVIDENCE},
             {"kind": "status", "id": "Q134737", "evidence": OK_EVIDENCE},
             {"kind": "identifier", "scheme": "wikidata", "id": "Q123", "evidence": OK_EVIDENCE},
             {"kind": "floruit", "year_from": 1780, "evidence": OK_EVIDENCE}]
    rows, _ = _ylevaatus(client, login, osa2, items,
                         name={"label": "Isik abc", "aliases": ["Hornius"]},
                         statuses=[{"id": "Q134737", "label": "aadlik"}],
                         identifiers=[{"scheme": "wikidata", "id": "Q123", "checked_at": None}],
                         floruit={"year_from": 1781, "year_to": None})
    assert [r["review_state"]["state"] for r in rows] == ["already_present", "already_present",
                                                          "already_present", "conflict"]


def test_id_teisel_isikul_blocked(client, login, osa2):
    osa2.write("zzz", identifiers=[{"scheme": "gnd", "id": "118500", "checked_at": None}])
    item = {"kind": "identifier", "scheme": "gnd", "id": "118500", "evidence": OK_EVIDENCE}
    rows, kinnita = _ylevaatus(client, login, osa2, [item])
    assert rows[0]["review_state"] == {"state": "blocked", "reason": "duplicate_id: vutt:Pzzz"}


def test_sama_skeem_teine_id_on_conflict(client, login, osa2):
    item = {"kind": "identifier", "scheme": "wikidata", "id": "Q2", "evidence": OK_EVIDENCE}
    rows, kinnita = _ylevaatus(client, login, osa2, [item],
                               identifiers=[{"scheme": "wikidata", "id": "Q1", "checked_at": None}])
    assert rows[0]["review_state"]["state"] == "conflict"
    assert kinnita([0]).status_code == 200
    assert [i["id"] for i in osa2.read("abc")["identifiers"]] == ["Q2"]


def test_nimi_aliasena_ei_dubleeri(client, login, osa2):
    items = [{"kind": "name", "label": "Gripenhielm", "type": "ennobled", "evidence": OK_EVIDENCE}]
    rows, kinnita = _ylevaatus(client, login, osa2, items,
                               name={"label": "Isik abc", "aliases": ["Gripenhielm"]})
    assert kinnita([0]).status_code == 200
    name = osa2.read("abc")["name"]
    assert "Gripenhielm" not in name["aliases"]
    assert name["names"][0]["label"] == "Gripenhielm"


def test_seose_kinnitus_lisab_vastastikuse_rea(client, login, osa2):
    osa2.write("bbb", relations=[])
    item = {"kind": "relation", "name": "Isik bbb", "type": "õpetaja", "target_id": "vutt:Pbbb",
            "evidence": OK_EVIDENCE}
    rows, kinnita = _ylevaatus(client, login, osa2, [item])
    assert rows[0]["review_state"]["state"] == "applicable"
    assert kinnita([0]).status_code == 200
    assert osa2.read("abc")["relations"][0]["target_id"] == "vutt:Pbbb"
    back = osa2.read("bbb")["relations"]
    assert back and back[0]["target_id"] == "vutt:Pabc" and back[0]["reciprocal_auto"] is True


def test_seos_puuduvale_isikule_blocked(client, login, osa2):
    item = {"kind": "relation", "name": "X", "type": "vend", "target_id": "vutt:Pnone", "evidence": OK_EVIDENCE}
    rows, _ = _ylevaatus(client, login, osa2, [item])
    assert rows[0]["review_state"] == {"state": "blocked", "reason": "unknown_person"}
