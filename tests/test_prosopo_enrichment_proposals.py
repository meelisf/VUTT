"""Agendi ettepaneku üleandmine ei muuda isikukaarti ega registrit."""
import os
import json
import pytest

from server.prosopography import enrichment_proposals as proposals


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


def test_uleandmine_on_uhekordne_ja_isikukaart_jaab_puutumata(client, login, prosopo_env):
    before = prosopo_env.write("abc", occupations=[])
    token = login("editor", "editorpass")
    handoff = client.post("/prosopography/enrichment-handoff/vutt:Pabc",
                          headers=_headers(token))
    assert handoff.status_code == 200
    code = handoff.json()["code"]
    body = {"code": code, "person_id": "vutt:Pabc",
            "base_updated_at": before["updated_at"], "items": [_item()]}
    submitted = client.post("/prosopography/enrichment-proposals/submit", json=body)
    assert submitted.status_code == 200
    assert submitted.json()["status"] == "pending"
    assert client.post("/prosopography/enrichment-proposals/submit", json=body).status_code == 400
    pending = client.get("/prosopography/enrichment-proposals/vutt:Pabc",
                         headers=_headers(token))
    assert pending.status_code == 200
    assert pending.json()[0]["items"][0]["occupation_key"] == "theology-professor"
    assert pending.json()[0]["items"][0]["review_error"] == "unknown_occupation_key"
    assert prosopo_env.read("abc") == before


def test_uleandmine_nouab_editori_ja_pakkumine_on_sessioonipohine(client, login, prosopo_env):
    prosopo_env.write("abc")
    assert client.post("/prosopography/enrichment-handoff/vutt:Pabc").status_code == 401
    contrib = login("contrib", "contribpass")
    assert client.post("/prosopography/enrichment-handoff/vutt:Pabc",
                       headers=_headers(contrib)).status_code == 401
    token1 = login("editor", "editorpass")
    token2 = login("editor", "editorpass")
    code = client.post("/prosopography/enrichment-handoff/vutt:Pabc",
                       headers=_headers(token1)).json()["code"]
    client.post("/prosopography/enrichment-proposals/submit", json={
        "code": code, "person_id": "vutt:Pabc",
        "base_updated_at": "2026-01-01T00:00:00+00:00", "items": [_item()],
    })
    own = client.get("/prosopography/enrichment-proposals/vutt:Pabc",
                     headers=_headers(token1))
    other_session = client.get("/prosopography/enrichment-proposals/vutt:Pabc",
                               headers=_headers(token2))
    assert len(own.json()) == 1
    assert other_session.json() == []


@pytest.mark.parametrize("change", [
    {"person_id": "vutt:Pother"},
    {"base_updated_at": "old"},
    {"items": [_item(review={"state": "done"})]},
    {"items": [_item(identifiers=[{"scheme": "gnd", "id": "1"}])]},
    {"items": [_item(evidence=[])]},
    {"items": [_item(date_from={"date": "1640", "precision": "millennium"})]},
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


def test_kinnitamine_nouab_sama_sessiooni_ja_varsket_versiooni(client, login, prosopo_env):
    card = prosopo_env.write('abc', occupations=[])
    token1 = login('editor', 'editorpass')
    token2 = login('editor', 'editorpass')
    proposal_id = _submit_for_review(client, token1, card, [_item(occupation_key=None, institution_key=None)])
    url = f'/prosopography/enrichment-proposals/{card["id"]}/apply'
    assert client.post(url, headers=_headers(token2),
                       json={"proposal_id": proposal_id, "selected": [0]}).status_code == 400
    changed = prosopo_env.write('abc', occupations=[], updated_at='2026-02-01T00:00:00+00:00')
    result = client.post(url, headers=_headers(token1),
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


def test_olemasoleva_kirje_toend_lisataks_molemal_liigil(client, login, prosopo_env, tmp_path, monkeypatch):
    registry = tmp_path / 'config'
    registry.mkdir(exist_ok=True)
    (registry / 'occupations.json').write_text(json.dumps({'professor': {'labels': {'et': 'professor'}}}))
    (registry / 'institutions.json').write_text(json.dumps({'agc': {'labels': {'et': 'Academia Gustaviana'}}}))
    monkeypatch.setattr(proposals, 'DATA_CONFIG_DIR', str(registry))
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
         'raw_institution': 'Academia Gustaviana', 'institution_key': 'agc',
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


def test_sama_voti_ja_kattuv_aeg_on_duplikaat_aga_eri_opingusundmus_mitte(
        client, login, prosopo_env, tmp_path, monkeypatch):
    registry = tmp_path / 'config'
    registry.mkdir(exist_ok=True)
    (registry / 'institutions.json').write_text(json.dumps({'agc': {'labels': {'et': 'AGC'}}}))
    monkeypatch.setattr(proposals, 'DATA_CONFIG_DIR', str(registry))
    card = prosopo_env.write('abc', education=[{
        'institution': 'AGC', 'institution_key': 'agc', 'type': 'immatriculation',
        'date_from': {'date': '1640', 'precision': 'year'},
    }])
    token = login('editor', 'editorpass')
    base = {'kind': 'education', 'match_status': 'matched', 'raw_institution': 'Academia Gustaviana',
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
