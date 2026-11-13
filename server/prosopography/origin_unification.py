"""Offline, conservative consolidation of legacy birthplace/origin links.

Only exact Q-code matches and registered parent chains establish containment.
Conflicts and unregistered places require a person's editor; no network lookup
or inference from a matching name is performed here.
"""
import copy


def _within(key, parent, places):
    seen = set()
    while key and key not in seen:
        if key == parent:
            return True
        seen.add(key)
        key = (places.get(key) or {}).get('parent_key')
    return False


def plan_origin_unification(card, places):
    birth = card.get('birth') or {}
    place = birth.get('place') or {}
    qid = place.get('id')
    if not qid:
        return {'action': 'review' if place.get('label') else 'unchanged', 'reason': 'unlinked_birthplace'}
    birth_key = next((key for key, entry in places.items() if entry.get('id') == qid), None)
    if not birth_key:
        return {'action': 'review', 'reason': 'unregistered_birthplace'}
    origin = card.get('origin') or {}
    origin_key = origin.get('place')
    if not origin_key or _within(birth_key, origin_key, places):
        key = birth_key
    elif _within(origin_key, birth_key, places):
        key = origin_key
    else:
        return {'action': 'review', 'reason': 'conflicting_places'}
    entry = places[key]
    new_origin = {**copy.deepcopy(origin), 'place': key,
                  'place_id': entry.get('id'), 'place_labels': copy.deepcopy(entry.get('labels'))}
    if key != origin_key:
        new_origin['coordinates'] = None
        new_origin['geonames_id'] = None
    new_birth = {**copy.deepcopy(birth), 'place': None}
    return {'action': 'update', 'key': key, 'changes': {'origin': new_origin, 'birth': new_birth}}
