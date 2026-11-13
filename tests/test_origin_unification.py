from copy import deepcopy
from server.prosopography.origin_unification import plan_origin_unification

PLACES = {
    'Riga': {'id': 'Q1773', 'parent_key': 'Livland', 'labels': {'et': 'Riia'}},
    'Livland': {'id': 'Q1757', 'labels': {'et': 'Liivimaa'}},
    'Tonder': {'id': 'Q3223979', 'labels': {'en': 'Tønder'}},
}


def card(origin='Livland', qid='Q1773'):
    return {'origin': {'place': origin, 'coordinates': {'lat': 1, 'lon': 2}},
            'birth': {'date': '1645-01-01', 'precision': 'year', 'notes': 'Source',
                      'place': {'id': qid, 'label': 'Riia'}}}


def test_consolidation_keeps_source_metadata_and_does_not_mutate_input():
    original = card()
    before = deepcopy(original)
    plan = plan_origin_unification(original, PLACES)
    assert plan['key'] == 'Riga'
    assert plan['changes']['origin']['coordinates'] is None
    assert plan['changes']['birth'] == {**before['birth'], 'place': None}
    assert original == before


def test_existing_finer_origin_is_not_replaced_by_region():
    assert plan_origin_unification(card('Riga', 'Q1757'), PLACES)['key'] == 'Riga'


def test_equal_places_are_consolidated():
    assert plan_origin_unification(card('Riga'), PLACES)['action'] == 'update'


def test_unrelated_or_unknown_places_require_review():
    assert plan_origin_unification(card('Tonder'), PLACES)['reason'] == 'conflicting_places'
    assert plan_origin_unification(card(None, 'Q99999999'), PLACES)['reason'] == 'unregistered_birthplace'
    assert plan_origin_unification(card(None, None), PLACES)['reason'] == 'unlinked_birthplace'
