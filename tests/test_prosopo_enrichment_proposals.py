"""Agendi ettepaneku üleandmine ei muuda isikukaarti ega registrit."""
import os
import json
import pytest

from server.prosopography import enrichment_proposals as proposals, registries


@pytest.fixture(autouse=True)
def proposal_db(tmp_path, monkeypatch):
    monkeypatch.setattr(proposals, "DB_PATH", str(tmp_path / "proposals.sqlite3"))


@pytest.fixture(autouse=True)
def korpuse_teos(monkeypatch):
    """Korpuses on üks teos `w1` 50 leheküljega; muu work_id puudub."""
    import server.utils
    import server.work_parts
    monkeypatch.setattr(server.utils, "find_directory_by_id",
                        lambda work_id: "/data/w1" if work_id == "w1" else None)
    monkeypatch.setattr(server.work_parts, "page_stems",
                        lambda work_dir: [f"p{n:03d}" for n in range(50)])


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
    token = login("superadmin", "superpass")
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
    assert pending.json()[0]["items"][0]["review_state"] == {"state": "blocked", "reason": "unknown_occupation_key"}
    assert prosopo_env.read("abc") == before


def test_isikukood_ei_kehti_teisele_isikule(client, login, prosopo_env):
    prosopo_env.write("abc")
    other = prosopo_env.write("oth")
    token = login("superadmin", "superpass")
    code = client.post("/prosopography/enrichment-handoff/vutt:Pabc", headers=_headers(token)).json()["code"]
    assert client.post("/prosopography/enrichment-proposals/submit", json={
        "code": code, "person_id": "vutt:Poth", "base_updated_at": other["updated_at"],
        "items": [_item()]}).status_code == 400


def test_uldkood_kehtib_koigile_isikutele_ja_kasutuste_lagi(client, login, prosopo_env, monkeypatch):
    a = prosopo_env.write("abc")
    b = prosopo_env.write("oth")
    token = login("superadmin", "superpass")
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
    token1 = login("superadmin", "superpass")
    token2 = login("superadmin", "superpass")
    code = client.post("/prosopography/enrichment-handoff/vutt:Pabc",
                       headers=_headers(token1)).json()["code"]
    client.post("/prosopography/enrichment-proposals/submit", json={
        "code": code, "person_id": "vutt:Pabc",
        "base_updated_at": "2026-01-01T00:00:00+00:00", "items": [_item()],
    })
    for token in (token1, token2):
        got = client.get("/prosopography/enrichment-proposals/vutt:Pabc", headers=_headers(token))
        assert len(got.json()) == 1
    # Teine kasutaja ei näe (HTTP kaudu jõuab loeteluni ainult superadmin).
    assert proposals.list_pending("vutt:Pabc", "admin") == []


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
    token = login("superadmin", "superpass")
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
    token = login("superadmin", "superpass")
    monkeypatch.setattr(proposals.time, "time", lambda: 1000)
    code = client.post("/prosopography/enrichment-handoff/vutt:Pabc",
                       headers=_headers(token)).json()["code"]
    monkeypatch.setattr(proposals.time, "time", lambda: 1000 + proposals.CODE_TTL + 1)
    response = client.post("/prosopography/enrichment-proposals/submit", json={
        "code": code, "person_id": "vutt:Pabc",
        "base_updated_at": "2026-01-01T00:00:00+00:00", "items": [_item()],
    })
    assert response.status_code == 400


def test_ajutine_andmebaas_on_varundusele_loetav(tmp_path):
    # Backend kirjutab root'ina, varundus loeb teise kasutajana — 0600 fail
    # katkestas öise varunduse (#131). Kaitse on `state/` kataloogi 700-s.
    old_umask = os.umask(0o022)
    try:
        proposals.issue_handoff("vutt:Pabc", "editor", "session", "t")
    finally:
        os.umask(old_umask)
    mode = os.stat(proposals.DB_PATH).st_mode
    assert mode & 0o044 == 0o044
    assert mode & 0o022 == 0


def test_vigane_isiku_id_ja_suur_sisu_keelatakse(client, login, prosopo_env):
    prosopo_env.write("abc")
    token = login("superadmin", "superpass")
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


def test_valitud_kirjed_salvestatakse_koos_toenditega(client, login, prosopo_env, registrid):
    config, _ = registrid
    (config / 'institutions.json').write_text(json.dumps({
        'academia-gustaviana': {'labels': {'et': 'Academia Gustaviana'}, 'type': 'university'}}))
    card = prosopo_env.write('abc', occupations=[], education=[])
    token = login('superadmin', 'superpass')
    items = [
        _item(occupation_key=None, institution_key=None),
        {"kind": "education", "match_status": "matched", "raw_institution": "Academia Gustaviana",
         "institution_key": "academia-gustaviana",
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
    # Võtmeta rida ei saa kinnitada: registriseose lahendab agent, mitte ülevaataja.
    blocked = client.post(f'/prosopography/enrichment-proposals/{card["id"]}/apply',
                          headers=_headers(token), json={"proposal_id": proposal_id, "selected": [0]})
    assert blocked.status_code == 400
    assert blocked.json()['detail'] == 'items[0]: registry_key_missing'


def test_kinnitamine_keeldub_puuduvast_registrist_ja_vananenud_kaardist(client, login, prosopo_env):
    card = prosopo_env.write('abc', occupations=[])
    token = login('superadmin', 'superpass')
    proposal_id = _submit_for_review(client, token, card, [_item()])
    url = f'/prosopography/enrichment-proposals/{card["id"]}/apply'
    result = client.post(url, headers=_headers(token),
                         json={"proposal_id": proposal_id, "selected": [0]})
    assert result.status_code == 400
    assert result.json()['detail'] == 'items[0]: unknown_occupation_key'
    assert prosopo_env.read('abc') == card
    card2 = prosopo_env.write('abc', occupations=[], updated_at='2026-02-01T00:00:00+00:00')
    result = client.post(url, headers=_headers(token),
                         json={"proposal_id": proposal_id, "selected": [0]})
    assert result.status_code == 400  # registriseos on enne versioonikontrolli
    assert prosopo_env.read('abc') == card2


def test_kinnitamine_nouab_sama_kasutajat_ja_varsket_versiooni(client, login, prosopo_env):
    card = prosopo_env.write('abc', occupations=[])
    token1 = login('superadmin', 'superpass')
    proposal_id = _submit_for_review(client, token1, card, [_item(occupation_key=None, institution_key=None)])
    url = f'/prosopography/enrichment-proposals/{card["id"]}/apply'
    with pytest.raises(proposals.ProposalError, match="proposal_not_found"):
        proposals.apply_selected(proposal_id, card["id"], "admin", "", [0])
    changed = prosopo_env.write('abc', occupations=[], updated_at='2026-02-01T00:00:00+00:00')
    token2 = login('superadmin', 'superpass')              # uus seanss, sama kasutaja
    result = client.post(url, headers=_headers(token2),
                         json={"proposal_id": proposal_id, "selected": [0]})
    # Kaardi muutus vahepeal ei ole enam vananemine (rea tasemel hindamine); rida
    # jääb blokeerituks oma põhjusel ja kaart muutmata.
    assert result.status_code == 400
    assert result.json()['detail'] == 'items[0]: registry_key_missing'
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
    token = login('superadmin', 'superpass')
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
    token = login('superadmin', 'superpass')
    proposal_id = _submit_for_review(client, token, card, [
        _item(occupation_key='professor', institution_key=None,
              occupation_variant='Võltsitud variant')])
    pending = client.get(f'/prosopography/enrichment-proposals/{card["id"]}',
                         headers=_headers(token)).json()
    assert pending[0]['items'][0]['review_state'] == {'state': 'blocked', 'reason': 'unknown_occupation_variant'}
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
    token = login('superadmin', 'superpass')
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
    token = login('superadmin', 'superpass')
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
    token = login('superadmin', 'superpass')
    base = {'kind': 'education', 'match_status': 'matched', 'raw_institution': 'Academia Gustavo-Carolina',
            'institution_key': 'agc', 'date_from': {'date': '1640', 'precision': 'year'},
            'evidence': [{'source_kind': 'literature', 'source_id': 'book1', 'locator': 'lk 4'}]}
    proposal_id = _submit_for_review(client, token, card, [{**base, 'edu_type': 'immatriculation'}])
    url = f'/prosopography/enrichment-proposals/{card["id"]}/apply'
    result = client.post(url, headers=_headers(token), json={'proposal_id': proposal_id, 'selected': [0]})
    assert result.status_code == 409
    assert result.json()['detail'] == 'items[0]: duplicate_entry'
    second = _submit_for_review(client, token, card, [{**base, 'edu_type': 'degree'}])
    result = client.post(url, headers=_headers(token), json={'proposal_id': second, 'selected': [0]})
    assert result.status_code == 200, result.text
    assert len(prosopo_env.read('abc')['education']) == 2


def test_kinnitamise_sisendil_on_mahupiir(client, login, prosopo_env):
    card = prosopo_env.write('abc', occupations=[])
    token = login('superadmin', 'superpass')
    result = client.post(f'/prosopography/enrichment-proposals/{card["id"]}/apply',
                         headers=_headers(token), content='x' * 128_001)
    assert result.status_code == 413
    assert prosopo_env.read('abc') == card


@pytest.mark.parametrize("item, expected", [
    (_item(note="x"), "items[0]: invalid_item: tundmatud võtmed ['note']"),
    (_item(evidence=[{"source_kind": "vutt_page", "work_id": "w1", "page": 1, "confidence": 1}]),
     "items[0]: invalid_evidence: tundmatud võtmed ['confidence']"),
    (_item(date_from={"date": "1650-13"}), "items[0]: invalid_date: date_from.date"),
    (_item(kind="role"), "items[0]: invalid_kind_or_match: kind peab olema"),
])
def test_valideerimisviga_nimetab_kirje_ja_valja(item, expected):
    """Paljas „invalid_item" jättis agendi variante pimesi proovima."""
    with pytest.raises(proposals.ProposalError) as exc:
        proposals.submit("c", "vutt:Pabc", "2026-01-01", [item])
    assert str(exc.value).startswith(expected)


@pytest.mark.parametrize("source, expected", [
    ({"source_kind": "external", "url": "https://example.org/x.pdf", "quote": "q"},
     "items[0]: invalid_evidence: tundmatud võtmed ['url']"),
    ({"source_kind": "external", "source_id": "Raamat", "quote": "q"},
     "items[0]: invalid_evidence_kind: source_kind on vutt_page või literature"),
    ({"source_kind": "vutt_page", "work_id": "puudub", "page": 1},
     "items[0]: unknown_work: work_id 'puudub'"),
    ({"source_kind": "vutt_page", "work_id": "w1", "page": 51},
     "items[0]: page_out_of_range: teoses w1 on 50 lehekülge"),
])
def test_toend_peab_olema_vuttis_kontrollitav(source, expected):
    """Veebiallikas ei ole tõend; korpuse viide osutab päris teosele ja lehele."""
    with pytest.raises(proposals.ProposalError) as exc:
        proposals.submit("c", "vutt:Pabc", "2026-01-01", [_item(evidence=[source])])
    assert str(exc.value).startswith(expected)


@pytest.fixture
def registrid(tmp_path, monkeypatch):
    config = tmp_path / "config"
    config.mkdir(exist_ok=True)
    (config / "occupations.json").write_text(json.dumps({
        "kaplan": {"id": "Q208762", "labels": {"et": "kaplan"}, "variants": []}}))
    (config / "institutions.json").write_text(json.dumps({}))
    (config / "places.json").write_text(json.dumps({"tartu": {"id": "Q13972"}}))
    monkeypatch.setattr(proposals, "DATA_CONFIG_DIR", str(config))
    monkeypatch.setattr(registries, "DATA_CONFIG_DIR", str(config))
    monkeypatch.setattr(registries, "PLACES_FILE", str(config / "places.json"))
    monkeypatch.setattr(proposals, "PLACES_FILE", str(config / "places.json"))
    saved = []

    def write(path, data, username, message=None):
        saved.append(path)
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(data, handle)
        return {"success": True}

    monkeypatch.setattr(registries, "save_config_with_git", write)
    return config, saved


def _uus_amet(**extra):
    item = {"kind": "occupation", "match_status": "new_registry_candidate",
            "raw_occupation": "Feldprediger",
            "occupation_entry": {"key": "valipreester", "id": "Q1368286",
                                 "labels": {"et": "välipreester", "en": "military chaplain"},
                                 "variants": ["Feldprediger"]},
            "evidence": [{"source_kind": "vutt_page", "work_id": "w1", "page": 3}]}
    item.update(extra)
    return item


def _esita(client, login, prosopo_env, items):
    card = prosopo_env.write("abc", occupations=[], education=[])
    token = login("superadmin", "superpass")
    code = client.post("/prosopography/enrichment-handoff/vutt:Pabc",
                       headers=_headers(token)).json()["code"]
    return client.post("/prosopography/enrichment-proposals/submit", json={
        "code": code, "person_id": "vutt:Pabc", "base_updated_at": card["updated_at"],
        "items": items}), token


def test_uus_registrikirje_talletatakse_ja_voti_taidetakse(client, login, prosopo_env, registrid):
    response, token = _esita(client, login, prosopo_env, [_uus_amet()])
    assert response.status_code == 200, response.text
    item = client.get("/prosopography/enrichment-proposals/vutt:Pabc",
                      headers=_headers(token)).json()[0]["items"][0]
    assert item["occupation_key"] == "valipreester"
    assert item["occupation_entry"]["key"] == "valipreester"
    assert "valipreester" not in registries.load("occupation")


@pytest.mark.parametrize("muudatus, viga", [
    ({"match_status": "matched"}, "registry_entry_requires_new_candidate"),
    ({"occupation_key": "muu"}, "registry_entry_key_mismatch"),
    ({"occupation_entry": {"key": "kaplan", "labels": {"et": "kaplan"}}}, "registry_key_exists: kaplan"),
    ({"occupation_entry": {"key": "uus", "id": "Q208762", "labels": {"et": "x"}}},
     "registry_id_exists: Q208762 on kirjel kaplan"),
    ({"occupation_entry": {"key": "Vale Võti", "labels": {"et": "x"}}}, "invalid_registry_entry"),
    ({"occupation_entry": {"key": "uus", "labels": {}}}, "invalid_registry_entry"),
    ({"kind": "education", "raw_institution": "AGC"}, "invalid_registry_entry"),
])
def test_vigane_registrikirje_lukatakse_esitusel_tagasi(
        client, login, prosopo_env, registrid, muudatus, viga):
    response, _ = _esita(client, login, prosopo_env, [_uus_amet(**muudatus)])
    assert response.status_code == 400
    assert viga in response.json()["detail"]
    assert response.json()["detail"].startswith("items[0]")


def test_asutusekirje_vajab_liiki(client, login, prosopo_env, registrid):
    item = {"kind": "education", "match_status": "new_registry_candidate",
            "raw_institution": "Academia Rostochiensis",
            "institution_entry": {"key": "rostocki-ulikool", "labels": {"et": "Rostocki ülikool"}},
            "evidence": [{"source_kind": "vutt_page", "work_id": "w1", "page": 3}]}
    response, _ = _esita(client, login, prosopo_env, [item])
    assert response.status_code == 400 and "invalid_type" in response.json()["detail"]


def test_sama_uus_voti_kahel_real_eri_sisuga(client, login, prosopo_env, registrid):
    teine = _uus_amet(occupation_entry={"key": "valipreester", "labels": {"et": "välipreester"}})
    response, _ = _esita(client, login, prosopo_env, [_uus_amet(), teine])
    assert response.status_code == 400
    assert response.json()["detail"].startswith("items[1]: registry_entry_mismatch")


def test_sama_uus_voti_kahel_real_sama_sisuga_lubatud(client, login, prosopo_env, registrid):
    response, _ = _esita(client, login, prosopo_env, [_uus_amet(), _uus_amet(date_from={"date": "1629"})])
    assert response.status_code == 200, response.text


def test_toend_lubab_citationi():
    proposals._validate_item(_item(evidence=[{
        "source_kind": "literature", "source_id": "DOC1", "locator": "lk 3",
        "citation": "Donecker 2012, An Itinerant Sheep"}]))


@pytest.mark.parametrize("method, path", [
    ("post", "/prosopography/enrichment-handoff"),
    ("post", "/prosopography/enrichment-handoff/vutt:Pabc"),
    ("get", "/prosopography/enrichment-proposals/vutt:Pabc"),
    ("post", "/prosopography/enrichment-proposals/vutt:Pabc/apply"),
])
@pytest.mark.parametrize("user, password", [("editor", "editorpass"), ("admin", "adminpass")])
def test_rikastuse_otspunktid_on_ainult_superadminile(client, login, prosopo_env, method, path, user, password):
    prosopo_env.write("abc")
    token = login(user, password)
    response = getattr(client, method)(path, headers=_headers(token),
                                       **({"json": {"proposal_id": "x", "selected": [0]}} if method == "post" else {}))
    assert response.status_code == 401   # selle projekti rollikaitse (deps.get_user)


def _loetelu(client, token):
    return client.get("/prosopography/enrichment-proposals/vutt:Pabc", headers=_headers(token)).json()


def test_review_state_kolm_olekut(client, login, prosopo_env, registrid):
    card = prosopo_env.write("abc", occupations=[
        {"label": "Feldprediger", "occupation_key": "kaplan", "id": "Q208762"}], education=[])
    token = login("superadmin", "superpass")
    code = client.post("/prosopography/enrichment-handoff/vutt:Pabc", headers=_headers(token)).json()["code"]
    ev = [{"source_kind": "vutt_page", "work_id": "w1", "page": 3}]
    items = [
        {"kind": "occupation", "match_status": "already_present", "raw_occupation": "Feldprediger",
         "occupation_key": "kaplan", "evidence": ev},
        _uus_amet(),
        {"kind": "occupation", "match_status": "ambiguous", "raw_occupation": "Pastor", "evidence": ev},
    ]
    assert client.post("/prosopography/enrichment-proposals/submit", json={
        "code": code, "person_id": "vutt:Pabc", "base_updated_at": card["updated_at"],
        "items": items}).status_code == 200
    rows = _loetelu(client, token)[0]["items"]
    assert rows[0]["review_state"] == {"state": "already_present"}
    assert rows[1]["review_state"] == {"state": "applicable"}
    assert rows[1]["registry_labels"]["occupation_key"] == "välipreester"
    assert rows[1]["registry_ids"]["occupation_key"] == "Q1368286"
    assert rows[2]["review_state"]["state"] == "blocked"
    assert rows[2]["review_state"]["reason"] == "ambiguous_match"


def test_vana_ettepanek_ilma_votmeta_on_blokeeritud(client, login, prosopo_env, registrid):
    """Enne muudatust talletatud rida: new_registry_candidate ilma võtme ja kirjeta."""
    prosopo_env.write("abc", occupations=[], education=[])
    token = login("superadmin", "superpass")
    with proposals._db() as db:
        db.execute("INSERT INTO proposal VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)",
                   ("old", "vutt:Pabc", "superadmin", "fp", "v", 1, 9999999999, json.dumps([
                       {"kind": "occupation", "match_status": "new_registry_candidate",
                        "raw_occupation": "Notarius", "evidence": [
                            {"source_kind": "vutt_page", "work_id": "w1", "page": 1}]}])))
    row = _loetelu(client, token)[0]["items"][0]
    assert row["review_state"] == {"state": "blocked", "reason": "registry_key_missing"}


def test_ambiguous_votmega_on_blokeeritud():
    with pytest.raises(proposals.ProposalError, match="ambiguous_match"):
        proposals._merge_row(_item(match_status="ambiguous"), [], [])


def test_juba_kaardil_leitakse_sisu_jargi_kui_indeks_nihkus(registrid):
    """Agent nägi kaplanit indeksil 1; toimetaja kustutas vahepeal indeksi 0."""
    occupations = [{"label": "Feldprediger", "occupation_key": "kaplan", "id": "Q208762"}]
    item = {"kind": "occupation", "match_status": "already_present", "existing_index": 1,
            "raw_occupation": "Feldprediger", "occupation_key": "kaplan",
            "evidence": [{"source_kind": "vutt_page", "work_id": "w1", "page": 7}]}
    assert proposals._merge_row(item, occupations, []) == "already_present"
    assert occupations[0]["evidence"] == item["evidence"]


def test_juba_kaardil_mitu_vastet_on_blokeeritud(registrid):
    occupations = [{"label": "a", "occupation_key": "kaplan"}, {"label": "b", "occupation_key": "kaplan"}]
    item = {"kind": "occupation", "match_status": "already_present", "raw_occupation": "a",
            "occupation_key": "kaplan", "evidence": [{"source_kind": "vutt_page", "work_id": "w1", "page": 7}]}
    with pytest.raises(proposals.ProposalError, match="unresolved_existing_entry"):
        proposals._merge_row(item, occupations, [])


def test_uus_fakt_mis_on_kaardil_on_duplikaat(registrid):
    occupations = [{"label": "Feldprediger", "occupation_key": "kaplan"}]
    item = {"kind": "occupation", "match_status": "matched", "raw_occupation": "Feldprediger",
            "occupation_key": "kaplan", "evidence": [{"source_kind": "vutt_page", "work_id": "w1", "page": 7}]}
    with pytest.raises(proposals.ProposalError, match="duplicate_entry"):
        proposals._merge_row(item, occupations, [])


def test_registrikonflikt_parast_esitust_blokeerib_rea(registrid):
    registries.put("occupation", "valipreester", {"id": "Q999", "labels": {"et": "muu"}}, "a")
    with pytest.raises(proposals.ProposalError, match="registry_conflict: valipreester"):
        proposals._merge_row({**_uus_amet(), "occupation_key": "valipreester"}, [], [])


def _esitatud(client, login, prosopo_env, items, **card):
    card = prosopo_env.write("abc", **{"occupations": [], "education": [], **card})
    token = login("superadmin", "superpass")
    code = client.post("/prosopography/enrichment-handoff/vutt:Pabc", headers=_headers(token)).json()["code"]
    submitted = client.post("/prosopography/enrichment-proposals/submit", json={
        "code": code, "person_id": "vutt:Pabc", "base_updated_at": card["updated_at"],
        "items": items})
    assert submitted.status_code == 200, submitted.text
    return token, _loetelu(client, token)[0]["proposal_id"]


def _apply(client, token, proposal_id, selected):
    return client.post("/prosopography/enrichment-proposals/vutt:Pabc/apply", headers=_headers(token),
                       json={"proposal_id": proposal_id, "selected": selected})


def test_kinnitus_loob_registrikirje_ja_fakti(client, login, prosopo_env, registrid):
    token, pid = _esitatud(client, login, prosopo_env, [_uus_amet()])
    response = _apply(client, token, pid, [0])
    assert response.status_code == 200, response.text
    assert registries.load("occupation")["valipreester"]["id"] == "Q1368286"
    saved = prosopo_env.read("abc")["occupations"][0]
    assert saved["occupation_key"] == "valipreester" and saved["label"] == "Feldprediger"
    assert _loetelu(client, token) == []


def test_kinnitus_seob_vahepeal_loodud_sama_kirjega(client, login, prosopo_env, registrid):
    token, pid = _esitatud(client, login, prosopo_env, [_uus_amet()])
    registries.put("occupation", "valipreester", {"id": "Q1368286", "labels": {"et": "välipreester"}}, "a")
    assert _apply(client, token, pid, [0]).status_code == 200


def test_eelkontrolli_kukkumine_ei_loo_registrikirjet(client, login, prosopo_env, registrid):
    config, saved = registrid
    dup = {"kind": "occupation", "match_status": "matched", "raw_occupation": "Feldprediger",
           "occupation_key": "kaplan", "evidence": [{"source_kind": "vutt_page", "work_id": "w1", "page": 2}]}
    token, pid = _esitatud(client, login, prosopo_env, [_uus_amet(), dup, dict(dup)])
    response = _apply(client, token, pid, [0, 1, 2])
    assert response.status_code == 409
    assert response.json()["detail"].startswith("items[2]: duplicate_entry")
    assert "valipreester" not in registries.load("occupation") and saved == []
    assert prosopo_env.read("abc")["occupations"] == []


def test_kaardi_kukkumine_tagastab_loodud_registrikirjed(client, login, prosopo_env, registrid, monkeypatch):
    token, pid = _esitatud(client, login, prosopo_env, [_uus_amet()])
    from server.prosopography import person_crud

    def kukub(*args, **kwargs):
        raise ValueError("conflict:uuem")
    monkeypatch.setattr(person_crud, "update_person", kukub)
    response = _apply(client, token, pid, [0])
    assert response.status_code == 409
    assert response.json()["detail"] == {"error": "stale_person",
                                         "created_registry_entries": ["valipreester"]}
    assert "valipreester" in registries.load("occupation")


def test_kaardi_muutus_vahepeal_ei_blokeeri_teisi_ridu(client, login, prosopo_env, registrid):
    ev = [{"source_kind": "vutt_page", "work_id": "w1", "page": 2}]
    items = [{"kind": "occupation", "match_status": "matched", "raw_occupation": "Kaplan",
              "occupation_key": "kaplan", "date_from": {"date": "1629"}, "evidence": ev}, _uus_amet()]
    token, pid = _esitatud(client, login, prosopo_env, items)
    prosopo_env.write("abc", occupations=[], education=[], notes="käsitsi muudetud",
                      updated_at="2026-03-01T00:00:00+00:00")
    assert _apply(client, token, pid, [0]).status_code == 200
    assert _apply(client, token, pid, [0]).status_code == 200       # endine rida 1 on nüüd 0
    assert len(prosopo_env.read("abc")["occupations"]) == 2


def test_tagasilukkamine_eemaldab_rea_ja_sulgeb_tuhja(client, login, prosopo_env, registrid):
    token, pid = _esitatud(client, login, prosopo_env, [_uus_amet(), _uus_amet(date_from={"date": "1630"})])
    url = "/prosopography/enrichment-proposals/vutt:Pabc/reject"
    first = client.post(url, headers=_headers(token), json={"proposal_id": pid, "selected": [1]})
    assert first.status_code == 200 and first.json()["remaining"] == 1
    assert client.post(url, headers=_headers(token), json={"proposal_id": pid, "selected": [0]}).json()["remaining"] == 0
    assert _loetelu(client, token) == []
    assert prosopo_env.read("abc")["occupations"] == [] and "valipreester" not in registries.load("occupation")


def test_tagasilukkamine_on_ainult_superadminile(client, login, prosopo_env):
    prosopo_env.write("abc")
    token = login("editor", "editorpass")
    assert client.post("/prosopography/enrichment-proposals/vutt:Pabc/reject", headers=_headers(token),
                       json={"proposal_id": "x", "selected": [0]}).status_code == 401


def test_apply_ei_voota_enam_parandusi(client, login, prosopo_env, registrid):
    token, pid = _esitatud(client, login, prosopo_env, [_uus_amet()])
    response = client.post("/prosopography/enrichment-proposals/vutt:Pabc/apply", headers=_headers(token),
                           json={"proposal_id": pid, "selected": [0], "corrections": {}})
    assert response.status_code == 400


def _teine_amet():
    return {"kind": "occupation", "match_status": "matched", "raw_occupation": "Kaplan",
            "occupation_key": "kaplan", "date_from": {"date": "1640"},
            "evidence": [{"source_kind": "vutt_page", "work_id": "w1", "page": 4}]}


def test_vananenud_vaade_ei_otsusta_vale_rida(client, login, prosopo_env, registrid):
    """Teine vaade (vana revision) saadab vana indeksi: server keeldub, mitte ei otsusta nihkunud rida."""
    token, pid = _esitatud(client, login, prosopo_env, [_uus_amet(), _teine_amet()])
    revision = _loetelu(client, token)[0]["revision"]
    base = "/prosopography/enrichment-proposals/vutt:Pabc"
    assert client.post(f"{base}/reject", headers=_headers(token),
                       json={"proposal_id": pid, "selected": [0], "revision": revision}).status_code == 200
    stale = client.post(f"{base}/apply", headers=_headers(token),
                        json={"proposal_id": pid, "selected": [0], "revision": revision})
    assert stale.status_code == 409 and stale.json()["detail"] == "stale_proposal"
    assert prosopo_env.read("abc")["occupations"] == []
    fresh = _loetelu(client, token)[0]["revision"]
    assert client.post(f"{base}/apply", headers=_headers(token),
                       json={"proposal_id": pid, "selected": [0], "revision": fresh}).status_code == 200


def test_samaaegne_sulgemine_ei_taasta_teise_otsuse_rida(prosopo_env, registrid, client, login):
    """Kinnitus luges payloadi enne, kui paralleelne tagasilükkamine rea B eemaldas:
    sulgemine eemaldab ridu SISU järgi värskest payloadist, B ei tule tagasi."""
    token, pid = _esitatud(client, login, prosopo_env, [_uus_amet(), _teine_amet()])
    with proposals._db() as db:
        vana = json.loads(db.execute("SELECT payload FROM proposal WHERE id=?", (pid,)).fetchone()[0])
    proposals.reject_selected(pid, "vutt:Pabc", "superadmin", [1])
    with proposals._db() as db:
        assert proposals._close_rows(db, pid, [vana[0]]) == 0
    assert _loetelu(client, token) == []


def test_sama_uus_fakt_teisel_real_on_loetelus_blokeeritud(client, login, prosopo_env, registrid):
    """Read hinnatakse järjest: teine sama fakt on duplikaat juba enne „Kinnita kõik"."""
    token, _ = _esitatud(client, login, prosopo_env, [_teine_amet(), _teine_amet()])
    rows = _loetelu(client, token)[0]["items"]
    assert rows[0]["review_state"] == {"state": "applicable"}
    assert rows[1]["review_state"] == {"state": "blocked", "reason": "duplicate_entry"}
