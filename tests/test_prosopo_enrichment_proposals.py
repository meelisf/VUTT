"""Agendi ettepaneku üleandmine ei muuda isikukaarti ega registrit."""
import os
import json
import pytest

from server.prosopography import enrichment_proposals as proposals, registries


@pytest.fixture(autouse=True)
def proposal_db(tmp_path, monkeypatch):
    monkeypatch.setattr(proposals, "DB_PATH", str(tmp_path / "proposals.sqlite3"))


def _item(**extra):
    item = {
        "kind": "occupation", "match_status": "matched",
        "raw_occupation": "Prof. theol.",
        "occupation_key": "theology-professor",
        "institution_key": "academia-gustaviana",
        "evidence": [{"source_kind": "vutt_page", "work_id": "w1",
                      "page": 12, "printed_page": "24", "quote": "Prof. theol."}],
    }
    item.update(extra)
    return item


def _headers(token):
    return {"Authorization": f"Bearer {token}"}


def test_isikukood_lubab_mitu_esitust_ja_isikukaart_jaab_puutumata(client, login, prosopo_env):
    """#492: kood kehtib tööpäeva, lubab ulatuse piires mitu esitust kuni laeni."""
    before = prosopo_env.write("abc", occupations=[])
    token = login("editor", "editorpass")
    handoff = client.post("/prosopography/enrichment-handoff/vutt:Pabc",
                          headers=_headers(token))
    assert handoff.status_code == 200
    assert handoff.json()["scope"] == "person" and handoff.json()["max_uses"] > 1
    code = handoff.json()["code"]
    body = {"code": code, "person_id": "vutt:Pabc",
            "base_updated_at": before["updated_at"], "items": [_item()]}
    submitted = client.post("/prosopography/enrichment-proposals/submit", json=body)
    assert submitted.status_code == 200
    assert submitted.json()["status"] == "pending"
    assert client.post("/prosopography/enrichment-proposals/submit", json=body).status_code == 200
    pending = client.get("/prosopography/enrichment-proposals/vutt:Pabc",
                         headers=_headers(token))
    assert pending.status_code == 200 and len(pending.json()) == 2
    assert pending.json()[0]["items"][0]["occupation_key"] == "theology-professor"
    assert pending.json()[0]["items"][0]["review_error"] == "unknown_occupation_key"
    assert prosopo_env.read("abc") == before


def test_isikukood_ei_kehti_teisele_isikule(client, login, prosopo_env):
    prosopo_env.write("abc")
    other = prosopo_env.write("oth")
    token = login("editor", "editorpass")
    code = client.post("/prosopography/enrichment-handoff/vutt:Pabc", headers=_headers(token)).json()["code"]
    assert client.post("/prosopography/enrichment-proposals/submit", json={
        "code": code, "person_id": "vutt:Poth", "base_updated_at": other["updated_at"],
        "items": [_item()]}).status_code == 400


def test_uldkood_kehtib_koigile_isikutele_ja_kasutuste_lagi(client, login, prosopo_env, monkeypatch):
    a = prosopo_env.write("abc")
    b = prosopo_env.write("oth")
    token = login("editor", "editorpass")
    assert client.post("/prosopography/enrichment-handoff").status_code == 401
    handoff = client.post("/prosopography/enrichment-handoff", headers=_headers(token))
    assert handoff.status_code == 200 and handoff.json()["scope"] == "any"
    code = handoff.json()["code"]
    for card in (a, b):
        assert client.post("/prosopography/enrichment-proposals/submit", json={
            "code": code, "person_id": card["id"], "base_updated_at": card["updated_at"],
            "items": [_item()]}).status_code == 200
    monkeypatch.setattr(proposals, "ANY_MAX_USES", 2)
    code2 = client.post("/prosopography/enrichment-handoff", headers=_headers(token)).json()["code"]
    body = {"code": code2, "person_id": a["id"], "base_updated_at": a["updated_at"], "items": [_item()]}
    assert client.post("/prosopography/enrichment-proposals/submit", json=body).status_code == 200
    assert client.post("/prosopography/enrichment-proposals/submit", json=body).status_code == 200
    third = client.post("/prosopography/enrichment-proposals/submit", json=body)
    assert third.status_code == 400 and third.json()["detail"] == "handoff_used_up"


def test_ettepanek_on_kasutaja_oma_mitte_seansi(client, login, prosopo_env):
    """#492: uus sisselogimine ei peida ootel ettepanekut; teine kasutaja ei näe."""
    prosopo_env.write("abc")
    assert client.post("/prosopography/enrichment-handoff/vutt:Pabc").status_code == 401
    contrib = login("contrib", "contribpass")
    assert client.post("/prosopography/enrichment-handoff/vutt:Pabc",
                       headers=_headers(contrib)).status_code == 401
    token1 = login("editor", "editorpass")
    token2 = login("editor", "editorpass")
    other_user = login("admin", "adminpass")
    code = client.post("/prosopography/enrichment-handoff/vutt:Pabc",
                       headers=_headers(token1)).json()["code"]
    client.post("/prosopography/enrichment-proposals/submit", json={
        "code": code, "person_id": "vutt:Pabc",
        "base_updated_at": "2026-01-01T00:00:00+00:00", "items": [_item()],
    })
    for token, expected in ((token1, 1), (token2, 1), (other_user, 0)):
        got = client.get("/prosopography/enrichment-proposals/vutt:Pabc", headers=_headers(token))
        assert len(got.json()) == expected


@pytest.mark.parametrize("change", [
    {"person_id": "vutt:Pother"},
    {"base_updated_at": "old"},
    {"items": [_item(review={"state": "done"})]},
    {"items": [_item(identifiers=[{"scheme": "gnd", "id": "1"}])]},
    {"items": [_item(evidence=[])]},
    {"items": [_item(date_from={"date": "1640", "precision": "millennium"})]},
    {"items": [_item(date_from={"date": "sometime", "precision": "year"})]},
    {"items": [_item(date_from={"date": "1640-13-01", "precision": "day"})]},
    {"items": [_item(evidence=[{"source_kind": "vutt_page", "work_id": "w1"}])]},
])
def test_vigane_ettepanek_ei_kuluta_koodi(client, login, prosopo_env, change):
    prosopo_env.write("abc")
    token = login("editor", "editorpass")
    code = client.post("/prosopography/enrichment-handoff/vutt:Pabc",
                       headers=_headers(token)).json()["code"]
    body = {"code": code, "person_id": "vutt:Pabc",
            "base_updated_at": "2026-01-01T00:00:00+00:00", "items": [_item()]}
    body.update(change)
    assert client.post("/prosopography/enrichment-proposals/submit", json=body).status_code == 400
    body = {"code": code, "person_id": "vutt:Pabc",
            "base_updated_at": "2026-01-01T00:00:00+00:00", "items": [_item()]}
    assert client.post("/prosopography/enrichment-proposals/submit", json=body).status_code == 200


def test_aegunud_kood_keeldub(client, login, prosopo_env, monkeypatch):
    prosopo_env.write("abc")
    token = login("editor", "editorpass")
    monkeypatch.setattr(proposals.time, "time", lambda: 1000)
    code = client.post("/prosopography/enrichment-handoff/vutt:Pabc",
                       headers=_headers(token)).json()["code"]
    monkeypatch.setattr(proposals.time, "time", lambda: 1000 + proposals.CODE_TTL + 1)
    response = client.post("/prosopography/enrichment-proposals/submit", json={
        "code": code, "person_id": "vutt:Pabc",
        "base_updated_at": "2026-01-01T00:00:00+00:00", "items": [_item()],
    })
    assert response.status_code == 400


def test_ajutine_andmebaas_on_ainult_serveri_kasutajale(tmp_path):
    proposals.issue_handoff("vutt:Pabc", "editor", "session", "t")
    assert os.stat(proposals.DB_PATH).st_mode & 0o077 == 0


def test_vigane_isiku_id_ja_suur_sisu_keelatakse(client, login, prosopo_env):
    prosopo_env.write("abc")
    token = login("editor", "editorpass")
    assert client.post("/prosopography/enrichment-handoff/%2E%2E",
                       headers=_headers(token)).status_code == 400
    code = client.post("/prosopography/enrichment-handoff/vutt:Pabc",
                       headers=_headers(token)).json()["code"]
    body = {"code": code, "person_id": "vutt:Pabc",
            "base_updated_at": "2026-01-01T00:00:00+00:00", "items": [_item()]}
    body["items"][0]["raw_occupation"] = "x" * proposals.MAX_BODY_BYTES
    assert client.post("/prosopography/enrichment-proposals/submit",
                       json=body).status_code == 413


def _submit_for_review(client, token, card, items):
    headers = _headers(token)
    code = client.post(f'/prosopography/enrichment-handoff/{card["id"]}',
                       headers=headers).json()["code"]
    result = client.post('/prosopography/enrichment-proposals/submit', json={
        'code': code, 'person_id': card['id'], 'base_updated_at': card['updated_at'],
        'items': items,
    })
    assert result.status_code == 200
    return result.json()['proposal_id']


def test_valitud_kirjed_salvestatakse_koos_toenditega(client, login, prosopo_env):
    card = prosopo_env.write('abc', occupations=[], education=[])
    token = login('editor', 'editorpass')
    items = [
        _item(occupation_key=None, institution_key=None),
        {"kind": "education", "match_status": "matched", "raw_institution": "Academia Gustaviana",
         "date_from": {"date": "1640", "precision": "year"},
         "evidence": [{"source_kind": "literature", "source_id": "book1", "locator": "lk 4"}]},
    ]
    proposal_id = _submit_for_review(client, token, card, items)
    response = client.post(f'/prosopography/enrichment-proposals/{card["id"]}/apply',
                           headers=_headers(token), json={"proposal_id": proposal_id, "selected": [1]})
    assert response.status_code == 200, response.text
    saved = prosopo_env.read('abc')
    assert saved['occupations'] == []
    assert saved['education'][0]['institution'] == 'Academia Gustaviana'
    assert saved['education'][0]['evidence'] == items[1]['evidence']
    pending = client.get(f'/prosopography/enrichment-proposals/{card["id"]}',
                         headers=_headers(token)).json()
    assert len(pending) == 1
    assert len(pending[0]['items']) == 1
    assert pending[0]['base_updated_at'] == saved['updated_at']
    assert client.post(f'/prosopography/enrichment-proposals/{card["id"]}/apply',
                       headers=_headers(token), json={"proposal_id": proposal_id, "selected": [0]}).status_code == 200
    assert client.post(f'/prosopography/enrichment-proposals/{card["id"]}/apply',
                       headers=_headers(token), json={"proposal_id": proposal_id, "selected": [0]}).status_code == 400


def test_kinnitamine_keeldub_puuduvast_registrist_ja_vananenud_kaardist(client, login, prosopo_env):
    card = prosopo_env.write('abc', occupations=[])
    token = login('editor', 'editorpass')
    proposal_id = _submit_for_review(client, token, card, [_item()])
    url = f'/prosopography/enrichment-proposals/{card["id"]}/apply'
    result = client.post(url, headers=_headers(token),
                         json={"proposal_id": proposal_id, "selected": [0]})
    assert result.status_code == 400
    assert result.json()['detail'] == 'unknown_occupation_key'
    assert prosopo_env.read('abc') == card
    card2 = prosopo_env.write('abc', occupations=[], updated_at='2026-02-01T00:00:00+00:00')
    result = client.post(url, headers=_headers(token),
                         json={"proposal_id": proposal_id, "selected": [0]})
    assert result.status_code == 400  # registriseos on enne versioonikontrolli
    assert prosopo_env.read('abc') == card2


def test_kinnitamine_nouab_sama_kasutajat_ja_varsket_versiooni(client, login, prosopo_env):
    card = prosopo_env.write('abc', occupations=[])
    token1 = login('editor', 'editorpass')
    other_user = login('admin', 'adminpass')
    proposal_id = _submit_for_review(client, token1, card, [_item(occupation_key=None, institution_key=None)])
    url = f'/prosopography/enrichment-proposals/{card["id"]}/apply'
    assert client.post(url, headers=_headers(other_user),
                       json={"proposal_id": proposal_id, "selected": [0]}).status_code == 400
    changed = prosopo_env.write('abc', occupations=[], updated_at='2026-02-01T00:00:00+00:00')
    token2 = login('editor', 'editorpass')              # uus seanss, sama kasutaja
    result = client.post(url, headers=_headers(token2),
                         json={"proposal_id": proposal_id, "selected": [0]})
    assert result.status_code == 409
    assert result.json()['detail'] == 'stale_person'
    assert prosopo_env.read('abc') == changed


def test_registrivoitmed_salvestuvad_ainult_olemasolevate_seostega(
        client, login, prosopo_env, tmp_path, monkeypatch):
    registry = tmp_path / 'config'
    registry.mkdir(exist_ok=True)
    (registry / 'occupations.json').write_text(json.dumps({'theology-professor': {'id': None}}))
    (registry / 'institutions.json').write_text(json.dumps({'academia-gustaviana': {'id': 'Q1'}}))
    monkeypatch.setattr(proposals, 'DATA_CONFIG_DIR', str(registry))
    monkeypatch.setattr(registries, 'DATA_CONFIG_DIR', str(registry))
    card = prosopo_env.write('abc', occupations=[])
    token = login('editor', 'editorpass')
    proposal_id = _submit_for_review(client, token, card, [_item()])
    response = client.post(f'/prosopography/enrichment-proposals/{card["id"]}/apply',
                           headers=_headers(token), json={"proposal_id": proposal_id, "selected": [0]})
    assert response.status_code == 200, response.text
    occupation = prosopo_env.read('abc')['occupations'][0]
    assert occupation['occupation_key'] == 'theology-professor'
    assert occupation['institution_key'] == 'academia-gustaviana'
    assert occupation['evidence'][0]['printed_page'] == '24'


def test_voltsitud_registrivariant_ei_joua_kinnitamiseni(
        client, login, prosopo_env, tmp_path, monkeypatch):
    registry = tmp_path / 'config'
    registry.mkdir(exist_ok=True)
    (registry / 'occupations.json').write_text(json.dumps({
        'professor': {'labels': {'et': 'professor'}, 'variants': ['Prof. theol.']},
    }))
    monkeypatch.setattr(proposals, 'DATA_CONFIG_DIR', str(registry))
    monkeypatch.setattr(registries, 'DATA_CONFIG_DIR', str(registry))
    card = prosopo_env.write('abc', occupations=[])
    token = login('editor', 'editorpass')
    proposal_id = _submit_for_review(client, token, card, [
        _item(occupation_key='professor', institution_key=None,
              occupation_variant='Võltsitud variant')])
    pending = client.get(f'/prosopography/enrichment-proposals/{card["id"]}',
                         headers=_headers(token)).json()
    assert pending[0]['items'][0]['review_error'] == 'unknown_occupation_variant'
    result = client.post(f'/prosopography/enrichment-proposals/{card["id"]}/apply',
                         headers=_headers(token), json={'proposal_id': proposal_id, 'selected': [0]})
    assert result.status_code == 400
    assert prosopo_env.read('abc') == card


def test_olemasoleva_kirje_toend_lisataks_molemal_liigil(client, login, prosopo_env, tmp_path, monkeypatch):
    registry = tmp_path / 'config'
    registry.mkdir(exist_ok=True)
    (registry / 'occupations.json').write_text(json.dumps({'professor': {'labels': {'et': 'professor'}}}))
    (registry / 'institutions.json').write_text(json.dumps({'agc': {'labels': {'et': 'Academia Gustavo-Carolina'}}}))
    monkeypatch.setattr(proposals, 'DATA_CONFIG_DIR', str(registry))
    monkeypatch.setattr(registries, 'DATA_CONFIG_DIR', str(registry))
    card = prosopo_env.write('abc', occupations=[{
        'label': 'Prof.', 'occupation_key': 'professor', 'institution_key': 'agc',
        'date_from': {'date': '1640', 'precision': 'year'},
        'evidence': [{'source_kind': 'literature', 'source_id': 'book0', 'locator': 'lk 1'}],
    }], education=[{
        'institution': 'AGC', 'institution_key': 'agc', 'type': 'immatriculation',
        'date_from': {'date': '1640', 'precision': 'year'},
        'evidence': [{'source_kind': 'literature', 'source_id': 'book0', 'locator': 'lk 2'}],
    }])
    token = login('editor', 'editorpass')
    items = [
        _item(raw_occupation='Professor', occupation_key='professor', institution_key='agc',
              match_status='already_present', existing_index=0,
              date_from={'date': '1640', 'precision': 'year'}),
        {'kind': 'education', 'match_status': 'already_present', 'existing_index': 0,
         'raw_institution': 'Academia Gustavo-Carolina', 'institution_key': 'agc',
         'edu_type': 'immatriculation', 'date_from': {'date': '1640', 'precision': 'year'},
         'evidence': [{'source_kind': 'literature', 'source_id': 'book1', 'locator': 'lk 4'}]},
    ]
    proposal_id = _submit_for_review(client, token, card, items)
    response = client.post(f'/prosopography/enrichment-proposals/{card["id"]}/apply',
                           headers=_headers(token), json={'proposal_id': proposal_id, 'selected': [0, 1]})
    assert response.status_code == 200, response.text
    saved = prosopo_env.read('abc')
    assert saved['occupations'][0]['label'] == 'Prof.'
    assert len(saved['occupations'][0]['evidence']) == 2
    assert saved['education'][0]['institution'] == 'AGC'
    assert len(saved['education'][0]['evidence']) == 2


def test_olemasolevale_agc_reale_lisatakse_registriseos_ilma_sonastust_muutmata(
        client, login, prosopo_env, tmp_path, monkeypatch):
    registry = tmp_path / 'config'
    registry.mkdir(exist_ok=True)
    (registry / 'institutions.json').write_text(json.dumps({
        'academia-gustavo-carolina': {
            'id': 'Q138710754', 'labels': {'et': 'Academia Gustavo-Carolina'},
            'variants': ['AGC'], 'place_key': 'Dorpat',
        },
    }))
    monkeypatch.setattr(proposals, 'DATA_CONFIG_DIR', str(registry))
    monkeypatch.setattr(registries, 'DATA_CONFIG_DIR', str(registry))
    card = prosopo_env.write('abc', education=[
        {'institution': 'Academia Gustaviana', 'date_from': {'date': '1691', 'precision': 'year'}},
        {'institution': 'AGC'},
    ])
    token = login('editor', 'editorpass')
    evidence = [{'source_kind': 'literature', 'source_id': 'album_academicum',
                 'locator': 'NR 1254', 'quote': 'AGC: juris stud.'}]
    item = {'kind': 'education', 'match_status': 'already_present',
            'existing_index': 1, 'raw_institution': 'AGC',
            'institution_key': 'academia-gustavo-carolina',
            'institution_variant': 'AGC', 'evidence': evidence}
    proposal_id = _submit_for_review(client, token, card, [item])
    response = client.post(f'/prosopography/enrichment-proposals/{card["id"]}/apply',
                           headers=_headers(token), json={'proposal_id': proposal_id, 'selected': [0]})
    assert response.status_code == 200, response.text
    saved = prosopo_env.read('abc')['education']
    assert saved[0] == card['education'][0]
    assert saved[1] == {'institution': 'AGC', 'institution_key': 'academia-gustavo-carolina',
                        'institution_id': 'Q138710754', 'evidence': evidence}


def test_sama_voti_ja_kattuv_aeg_on_duplikaat_aga_eri_opingusundmus_mitte(
        client, login, prosopo_env, tmp_path, monkeypatch):
    registry = tmp_path / 'config'
    registry.mkdir(exist_ok=True)
    (registry / 'institutions.json').write_text(json.dumps({'agc': {'labels': {'et': 'AGC'}}}))
    monkeypatch.setattr(proposals, 'DATA_CONFIG_DIR', str(registry))
    monkeypatch.setattr(registries, 'DATA_CONFIG_DIR', str(registry))
    card = prosopo_env.write('abc', education=[{
        'institution': 'AGC', 'institution_key': 'agc', 'type': 'immatriculation',
        'date_from': {'date': '1640', 'precision': 'year'},
    }])
    token = login('editor', 'editorpass')
    base = {'kind': 'education', 'match_status': 'matched', 'raw_institution': 'Academia Gustavo-Carolina',
            'institution_key': 'agc', 'date_from': {'date': '1640', 'precision': 'year'},
            'evidence': [{'source_kind': 'literature', 'source_id': 'book1', 'locator': 'lk 4'}]}
    proposal_id = _submit_for_review(client, token, card, [{**base, 'edu_type': 'immatriculation'}])
    url = f'/prosopography/enrichment-proposals/{card["id"]}/apply'
    result = client.post(url, headers=_headers(token), json={'proposal_id': proposal_id, 'selected': [0]})
    assert result.status_code == 409
    assert result.json()['detail'] == 'duplicate_entry'
    second = _submit_for_review(client, token, card, [{**base, 'edu_type': 'degree'}])
    result = client.post(url, headers=_headers(token), json={'proposal_id': second, 'selected': [0]})
    assert result.status_code == 200, result.text
    assert len(prosopo_env.read('abc')['education']) == 2


def test_toimetaja_lahendab_mitmetahendusliku_vaste_registrivalikuga(
        client, login, prosopo_env, tmp_path, monkeypatch):
    registry = tmp_path / 'config'
    registry.mkdir(exist_ok=True)
    (registry / 'occupations.json').write_text(json.dumps({
        'pastor': {'id': 'Q1', 'variants': ['Pfarrer']},
        'clergyman': {'id': 'Q2', 'variants': ['Pfarrer']},
    }))
    monkeypatch.setattr(proposals, 'DATA_CONFIG_DIR', str(registry))
    monkeypatch.setattr(registries, 'DATA_CONFIG_DIR', str(registry))
    card = prosopo_env.write('abc', occupations=[])
    token = login('editor', 'editorpass')
    proposal_id = _submit_for_review(client, token, card, [{
        'kind': 'occupation', 'match_status': 'ambiguous', 'raw_occupation': 'Pfarrer',
        'evidence': [{'source_kind': 'literature', 'source_id': 'book1', 'locator': 'lk 4'}],
    }])
    url = f'/prosopography/enrichment-proposals/{card["id"]}/apply'
    base = {'proposal_id': proposal_id, 'selected': [0]}
    assert client.post(url, headers=_headers(token), json=base).status_code == 409
    assert client.post(url, headers=_headers(token), json={
        **base, 'corrections': {'0': {'review': {'state': 'done'}}},
    }).status_code == 400
    result = client.post(url, headers=_headers(token), json={
        **base, 'corrections': {'0': {'occupation_key': 'pastor',
                                     'occupation_variant': 'Pfarrer'}},
    })
    assert result.status_code == 200, result.text
    saved = prosopo_env.read('abc')['occupations'][0]
    assert saved['label'] == 'Pfarrer'
    assert saved['occupation_key'] == 'pastor'
    assert 'review' not in saved


def test_parandus_ei_voimalda_valitud_reast_valjuda(client, login, prosopo_env):
    card = prosopo_env.write('abc', occupations=[])
    token = login('editor', 'editorpass')
    proposal_id = _submit_for_review(client, token, card, [
        _item(occupation_key=None, institution_key=None),
        _item(occupation_key=None, institution_key=None, raw_occupation='Õpetaja'),
    ])
    result = client.post(f'/prosopography/enrichment-proposals/{card["id"]}/apply',
                         headers=_headers(token), json={
        'proposal_id': proposal_id, 'selected': [0],
        'corrections': {'1': {'occupation_key': 'pastor'}},
    })
    assert result.status_code == 400
    assert prosopo_env.read('abc') == card


def test_toimetaja_parandab_aja_ja_toendi_koos_kinnitamisega(client, login, prosopo_env):
    card = prosopo_env.write('abc', education=[])
    token = login('editor', 'editorpass')
    item = {'kind': 'education', 'match_status': 'matched', 'raw_institution': 'AGC',
            'date_from': {'date': '1640', 'precision': 'year'},
            'evidence': [{'source_kind': 'literature', 'source_id': 'book1', 'locator': 'lk 4'}]}
    proposal_id = _submit_for_review(client, token, card, [item])
    corrected = {**item['evidence'][0], 'locator': 'lk 14', 'quote': 'studiosus'}
    response = client.post(f'/prosopography/enrichment-proposals/{card["id"]}/apply',
                           headers=_headers(token), json={
        'proposal_id': proposal_id, 'selected': [0],
        'corrections': {'0': {'date_from': {'date': '1641-01-01', 'precision': 'year'},
                              'edu_type': 'immatriculation', 'evidence': [corrected]}},
    })
    assert response.status_code == 200, response.text
    saved = prosopo_env.read('abc')['education'][0]
    assert saved['date_from']['date'] == '1641-01-01'
    assert saved['type'] == 'immatriculation'
    assert saved['evidence'] == [corrected]


def test_vigane_toimetaja_kuupaev_ei_muuda_kaarti(client, login, prosopo_env):
    card = prosopo_env.write('abc', education=[])
    token = login('editor', 'editorpass')
    proposal_id = _submit_for_review(client, token, card, [{
        'kind': 'education', 'match_status': 'matched', 'raw_institution': 'AGC',
        'evidence': [{'source_kind': 'literature', 'source_id': 'book1', 'locator': 'lk 4'}],
    }])
    result = client.post(f'/prosopography/enrichment-proposals/{card["id"]}/apply',
                         headers=_headers(token), json={
        'proposal_id': proposal_id, 'selected': [0],
        'corrections': {'0': {'date_from': {'date': '1640-99-01', 'precision': 'day'}}},
    })
    assert result.status_code == 400
    assert prosopo_env.read('abc') == card


def test_kinnitamise_sisendil_on_mahupiir(client, login, prosopo_env):
    card = prosopo_env.write('abc', occupations=[])
    token = login('editor', 'editorpass')
    result = client.post(f'/prosopography/enrichment-proposals/{card["id"]}/apply',
                         headers=_headers(token), content='x' * 128_001)
    assert result.status_code == 413
    assert prosopo_env.read('abc') == card
