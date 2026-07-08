import server.entity_labels_ops as elo


def _sample_person():
    return {
        "birth": {"place": {"id": "Q3846", "label": "Minden"}},
        "death": {"place": {"id": "Q1770", "label": "Tallinn",
                             "labels": {"et": "Tallinn", "en": "Tallinn"}}},
        "origin": {"place": "Minden", "place_id": "Q3846", "place_labels": None},
        "statuses": [{"id": "Q152182", "label": "Literaat"}],
        "confessions": [{"id": "Q75809", "label": "luterlane"}],
        "occupations": [
            {"label": "linnapea", "id": "Q30185",
             "institution": "Tallinn", "institution_id": "Q1770"},
            {"label": "syndic", "id": "Q1339249",
             "labels": {"et": "Sündik", "en": "syndic"}},
        ],
        "education": [{"institution": "University of Rostock",
                       "institution_id": "Q159895"}],
        "tags": [{"id": "Q42", "label": "märksõna"}],
        "relations": [{"type": "Q100", "type_labels": None}, {"type": "father"}],
    }


def test_collect_entity_qcodes_covers_all_slots():
    q = elo.collect_entity_qcodes(_sample_person())
    assert {"Q3846", "Q1770", "Q152182", "Q75809", "Q30185",
            "Q1339249", "Q159895", "Q42", "Q100"} <= q
    # plain (non-Q) relation type is ignored
    assert "father" not in q


def test_fill_entity_labels_fills_gaps_and_counts():
    person = _sample_person()
    registry = {
        "Q30185": {"et": "linnapea", "en": "mayor"},
        "Q159895": {"et": "Rostocki Ülikool", "en": "University of Rostock"},
        "Q3846": {"et": "Minden", "en": "Minden"},
    }
    changed = elo.fill_entity_labels(person, registry)
    assert person["occupations"][0]["labels"] == {"et": "linnapea", "en": "mayor"}
    assert person["education"][0]["institution_labels"] == {
        "et": "Rostocki Ülikool", "en": "University of Rostock"}
    assert person["origin"]["place_labels"] == {"et": "Minden", "en": "Minden"}
    # birth.place also carries Q3846 and gets filled too (4th slot, in
    # addition to the 3 asserted above): occupations[0], education[0],
    # origin, birth.place.
    assert person["birth"]["place"]["labels"] == {"et": "Minden", "en": "Minden"}
    assert changed == 4


def test_fill_entity_labels_preserves_existing_language():
    person = {"occupations": [{"id": "Q1339249",
                               "labels": {"et": "Sündik", "en": "syndic"}}]}
    registry = {"Q1339249": {"et": "sündik", "de": "Syndikus"}}
    changed = elo.fill_entity_labels(person, registry)
    # existing et/en preserved; de added from registry
    assert person["occupations"][0]["labels"] == {
        "et": "Sündik", "en": "syndic", "de": "Syndikus"}
    assert changed == 1


def test_fill_entity_labels_idempotent():
    person = _sample_person()
    registry = {"Q30185": {"et": "linnapea", "en": "mayor"}}
    elo.fill_entity_labels(person, registry)
    assert elo.fill_entity_labels(person, registry) == 0
