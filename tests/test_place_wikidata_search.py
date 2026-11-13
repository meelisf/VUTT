"""Interactive place lookup: geographic filtering, batching and upstream pacing."""
import io
import urllib.error
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import HTTPException
from server.prosopography import place_wikidata_http as http, places_ops as po, router


def claim(value):
    return {"rank": "normal", "mainsnak": {"snaktype": "value", "datavalue": {"value": value}}}


@pytest.fixture
def transport(monkeypatch):
    clock = [100.0]
    monkeypatch.setattr(http, '_cache', {})
    monkeypatch.setattr(http, '_next_request', 0)
    monkeypatch.setattr(http, '_cooldown', 0)
    monkeypatch.setattr(http.time, 'monotonic', lambda: clock[0])
    monkeypatch.setattr(http.time, 'sleep', lambda seconds: clock.__setitem__(0, clock[0] + seconds))
    calls = []

    def open_url(req, timeout):
        calls.append(req.full_url)
        return io.BytesIO(b'{"entities": {}}')

    monkeypatch.setattr(http.urllib.request, 'urlopen', open_url)
    return clock, calls


def test_cache_coalesces_requests_and_does_not_expose_mutable_cache(transport):
    _, calls = transport
    with ThreadPoolExecutor(4) as pool:
        values = list(pool.map(lambda _: http.get_json('https://www.wikidata.org/example'), range(4)))
    assert len(calls) == 1
    values[0]['entities']['Q1'] = 'changed'
    assert http.get_json('https://www.wikidata.org/example') == {'entities': {}}


def test_pacing_and_expiration(transport):
    clock, calls = transport
    http.get_json('https://www.wikidata.org/one', ttl=2)
    http.get_json('https://www.wikidata.org/two', ttl=2)
    assert clock[0] == 101
    clock[0] = 103
    http.get_json('https://www.wikidata.org/one', ttl=2)
    assert len(calls) == 3


def test_retry_after_stops_further_network_requests(transport, monkeypatch):
    clock, calls = transport

    def limited(req, timeout):
        calls.append(req.full_url)
        raise urllib.error.HTTPError(req.full_url, 429, 'limited', {'Retry-After': '12'}, None)

    monkeypatch.setattr(http.urllib.request, 'urlopen', limited)
    with pytest.raises(http.WikidataBusy) as error:
        http.get_json('https://www.wikidata.org/one')
    assert error.value.retry_after == 12
    clock[0] += 2
    with pytest.raises(http.WikidataBusy) as error:
        http.get_json('https://www.wikidata.org/two')
    assert error.value.retry_after == 10
    assert len(calls) == 1


def test_maxlag_is_an_error_not_empty_search(transport, monkeypatch):
    monkeypatch.setattr(http.urllib.request, 'urlopen', lambda *a, **kw: io.BytesIO(b'{"error":{"code":"maxlag"}}'))
    with pytest.raises(http.WikidataBusy):
        http.get_json('https://www.wikidata.org/search')


def test_search_filters_people_and_fetches_claims_in_one_batch(monkeypatch):
    calls = []
    entities = {
        'Q3223979': {'labels': {'en': {'value': 'Tønder'}}, 'descriptions': {'en': {'value': 'town in Denmark'}},
                     'aliases': {'de': [{'value': 'Tondern'}]}, 'claims': {'P31': [claim({'id': 'Q515'})]}},
        'Q123': {'claims': {'P31': [claim({'id': 'Q5'})], 'P131': [claim({'id': 'Q1773'})]}},
    }

    def api(**params):
        calls.append(params)
        if params['action'] == 'wbsearchentities':
            return {'search': [{'id': 'Q3223979'}, {'id': 'Q123'}]}
        return {'entities': entities}

    monkeypatch.setattr(po, '_wd_api', api)
    assert po.search_places_wikidata('Tondern', 'de') == [{
        'q': 'Q3223979', 'label': 'Tønder', 'description': 'town in Denmark', 'aliases': ['Tondern']}]
    assert len(calls) == 2
    assert calls[1]['ids'] == 'Q3223979|Q123'


def test_upstream_error_is_http_429_with_retry_after(monkeypatch):
    monkeypatch.setattr(router, '_check_wikidata_rate_limit', lambda request: None)

    def busy(*args, **kwargs):
        raise http.WikidataBusy(12)

    monkeypatch.setattr(router, 'search_places_wikidata', busy)
    with pytest.raises(HTTPException) as error:
        router.places_wikidata_search(None, q='Tønder')
    assert error.value.status_code == 429
    assert error.value.headers['Retry-After'] == '12'


def test_cannot_create_duplicate_qid_or_overwrite_name_collision(monkeypatch):
    places = {'Tonder': {'id': 'Q3223979', 'labels': {'en': 'Tønder'}}}
    monkeypatch.setattr(po, '_load_places_cache', lambda **kwargs: places)
    monkeypatch.setattr(po, 'save_config_with_git', lambda *args, **kwargs: pytest.fail('Must not write'))
    with pytest.raises(ValueError, match='juba registris'):
        po.put_place('Tønder', {'id': 'Q3223979', '_create_only': True})
    with pytest.raises(ValueError, match='juba registris'):
        po.put_place('Tonder', {'id': 'Q123', '_create_only': True})
    assert places['Tonder']['id'] == 'Q3223979'
