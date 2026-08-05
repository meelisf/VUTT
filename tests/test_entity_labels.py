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


def test_fill_person_labels_from_registry_uses_labels_json(monkeypatch):
    import server.entity_labels_ops as elo
    monkeypatch.setattr(elo, "load_entity_labels",
                        lambda: {"Q30185": {"et": "linnapea", "en": "mayor"}})
    person = {"occupations": [{"id": "Q30185", "label": "linnapea"}]}
    assert elo.fill_person_labels_from_registry(person) == 1
    assert person["occupations"][0]["labels"]["en"] == "mayor"


# --- heal_stubs: pseudo-tõlgete parandamine ------------------------------

def test_heal_stubs_replaces_english_copy_in_et_slot():
    """et == en (EntityPicker kirjutas ingliskeelse silti) → registri tõlge võidab."""
    person = {"occupations": [{"id": "Q107555801", "label": "Professor of medicine",
                               "labels": {"et": "Professor of medicine",
                                          "en": "professor of medicine",
                                          "de": "Medizinprofessor"}}]}
    registry = {"Q107555801": {"et": "meditsiiniprofessor",
                               "en": "professor of medicine",
                               "de": "Medizinprofessor"}}
    changed = elo.fill_entity_labels(person, registry, heal_stubs=True)
    assert person["occupations"][0]["labels"]["et"] == "meditsiiniprofessor"
    assert changed == 1


def test_heal_stubs_off_by_default():
    person = {"occupations": [{"id": "Q107555801",
                               "labels": {"et": "Professor of medicine",
                                          "en": "professor of medicine"}}]}
    registry = {"Q107555801": {"et": "meditsiiniprofessor", "en": "professor of medicine"}}
    assert elo.fill_entity_labels(person, registry) == 0
    assert person["occupations"][0]["labels"]["et"] == "Professor of medicine"


def test_heal_stubs_preserves_curated_translation():
    """Päris eestikeelne (mitte teise keele koopia) tõlge jääb puutumata."""
    person = {"statuses": [{"id": "Q39631",
                            "labels": {"et": "Arst", "en": "physician"}}]}
    registry = {"Q39631": {"et": "arst", "en": "physician"}}
    changed = elo.fill_entity_labels(person, registry, heal_stubs=True)
    assert person["statuses"][0]["labels"]["et"] == "Arst"
    assert changed == 0


def test_heal_stubs_idempotent():
    person = {"occupations": [{"id": "Q1", "labels": {"et": "X", "en": "X"}}]}
    registry = {"Q1": {"et": "iks", "en": "X"}}
    assert elo.fill_entity_labels(person, registry, heal_stubs=True) == 1
    assert elo.fill_entity_labels(person, registry, heal_stubs=True) == 0


def test_sync_prosopography_inline_labels_writes_and_commits(tmp_path, monkeypatch):
    import json as _json
    card = tmp_path / "abc123.json"
    card.write_text(_json.dumps({
        "id": "vutt:abc123",
        "occupations": [{"id": "Q107555801",
                         "labels": {"et": "Professor of medicine",
                                    "en": "professor of medicine"},
                         "institution_id": "Q28966944"}],
    }, ensure_ascii=False), encoding="utf-8")
    untouched = tmp_path / "def456.json"
    untouched.write_text(_json.dumps({"id": "vutt:def456", "occupations": []}), encoding="utf-8")

    saved = {}

    def fake_save(path, content, username, message=None, additional_files=None):
        saved["path"] = path
        saved["username"] = username
        saved["message"] = message
        saved["extra"] = additional_files or []
        with open(path, "w", encoding="utf-8") as f:
            f.write(content)

    monkeypatch.setattr("server.config.PROSOPOGRAPHY_DIR", str(tmp_path), raising=False)
    monkeypatch.setattr("server.git_ops.save_with_git", fake_save, raising=False)
    # Ükski test ei tohi Wikidatasse minna
    monkeypatch.setattr(elo, "_fetch_wikidata_labels", lambda q: {})

    result = elo.sync_prosopography_inline_labels(
        registry={"Q107555801": {"et": "meditsiiniprofessor", "en": "professor of medicine"},
                  "Q28966944": {"et": "Academia Gustaviana", "en": "Academia Gustaviana"}},
        username="meelis",
    )

    assert result == {"files": 1, "slots": 2, "fetched": 0}
    assert saved["path"] == str(card)
    assert saved["username"] == "meelis"
    assert saved["extra"] == []
    written = _json.loads(card.read_text(encoding="utf-8"))
    assert written["occupations"][0]["labels"]["et"] == "meditsiiniprofessor"
    assert written["occupations"][0]["institution_labels"]["et"] == "Academia Gustaviana"
    # muutumatu kaart jääb puutumata
    assert _json.loads(untouched.read_text(encoding="utf-8")) == {"id": "vutt:def456", "occupations": []}


def test_sync_prosopography_inline_labels_noop_without_changes(tmp_path, monkeypatch):
    import json as _json
    (tmp_path / "abc.json").write_text(_json.dumps(
        {"occupations": [{"id": "Q1", "labels": {"et": "iks", "en": "X"}}]}), encoding="utf-8")

    def boom(*a, **kw):
        raise AssertionError("muutusteta sünk ei tohi commitida")

    monkeypatch.setattr("server.config.PROSOPOGRAPHY_DIR", str(tmp_path), raising=False)
    monkeypatch.setattr("server.git_ops.save_with_git", boom, raising=False)
    monkeypatch.setattr(elo, "_fetch_wikidata_labels", lambda q: {})

    assert elo.sync_prosopography_inline_labels(
        registry={"Q1": {"et": "iks", "en": "X"}}) == {"files": 0, "slots": 0, "fetched": 0}


# --- heal_stubs: mida EI TOHI puutuda (päris andmete regressioonid) -------

def test_heal_stubs_never_touches_place_labels():
    """Ajalooline kohanimi (Reval, Elbing) EI tohi Wikidata moodsaks muutuda."""
    person = {
        "origin": {"place": "Reval", "place_id": "Q1770",
                   "place_labels": {"et": "Tallinn", "en": "Tallinn",
                                    "de": "Reval", "la": "Revalia", "sv": "Reval"}},
        "birth": {"place": {"id": "Q104712",
                            "labels": {"et": "Elbing", "en": "Elbląg",
                                       "de": "Elbląg", "sv": "Elbing"}}},
    }
    registry = {
        "Q1770": {"et": "Tallinn", "en": "Tallinn", "de": "Tallinn", "la": "Revalia"},
        "Q104712": {"et": "Elbląg", "en": "Elbląg", "de": "Elbląg"},
    }
    changed = elo.fill_entity_labels(person, registry, heal_stubs=True)
    assert person["origin"]["place_labels"]["de"] == "Reval"
    assert person["origin"]["place_labels"]["sv"] == "Reval"
    assert person["birth"]["place"]["labels"]["et"] == "Elbing"
    assert changed == 0


def test_heal_stubs_ignores_non_english_coincidence():
    """sv == de kokkulangevus ei ole pseudo-tõlge — ei paranda."""
    person = {"occupations": [{"id": "Q1",
                               "labels": {"et": "kroonik", "en": "chronicler",
                                          "de": "Chronist", "sv": "Chronist"}}]}
    registry = {"Q1": {"et": "kroonik", "en": "chronicler", "de": "Chronist", "sv": "krönikör"}}
    changed = elo.fill_entity_labels(person, registry, heal_stubs=True)
    assert person["occupations"][0]["labels"]["sv"] == "Chronist"
    assert changed == 0


def test_heal_stubs_needs_inline_english():
    """Ilma inline `en`-ita pole võrdlusalust — ei muuda midagi."""
    person = {"occupations": [{"id": "Q1", "labels": {"et": "Professor of medicine"}}]}
    registry = {"Q1": {"et": "meditsiiniprofessor", "en": "professor of medicine"}}
    elo.fill_entity_labels(person, registry, heal_stubs=True)
    # gap-fill lisab en, aga et jääb (pole tõestust, et see on koopia)
    assert person["occupations"][0]["labels"]["et"] == "Professor of medicine"


# --- seose tüüp: Q-kood on type_id, mitte type ---------------------------

def test_collect_qcodes_reads_relation_type_id():
    """Seose Q-kood elab `type_id`-s; `type` on inimloetav string."""
    person = {"relations": [{"name": "X", "type": "nephew", "type_id": "Q15224724"}]}
    assert elo.collect_entity_qcodes(person) == {"Q15224724"}


def test_collect_qcodes_relation_legacy_qcode_in_type():
    """Vanad kirjed hoidsid Q-koodi `type` väljal — jääb toetatuks."""
    person = {"relations": [{"type": "Q100"}]}
    assert elo.collect_entity_qcodes(person) == {"Q100"}


def test_relation_type_labels_healed_from_registry():
    """`type_labels.et` == `en` (ingliskeelne koopia) → registri tõlge."""
    person = {"relations": [{"name": "Jakob Friedrich Below", "type": "nephew",
                             "type_id": "Q15224724",
                             "type_labels": {"et": "nephew", "en": "nephew",
                                             "de": "Neffe", "la": "nepos"}}]}
    registry = {"Q15224724": {"et": "vennapoeg", "en": "nephew",
                              "de": "Neffe", "la": "nepos"}}
    changed = elo.fill_entity_labels(person, registry, heal_stubs=True)
    assert person["relations"][0]["type_labels"]["et"] == "vennapoeg"
    assert changed == 1


def test_sync_fetches_qcodes_missing_from_registry(tmp_path, monkeypatch):
    """Kaardil olev, registrist puuduv Q-kood tuuakse Wikidatast."""
    import json as _json
    card = tmp_path / "abc.json"
    card.write_text(_json.dumps({
        "relations": [{"type": "nephew", "type_id": "Q15224724",
                       "type_labels": {"et": "nephew", "en": "nephew"}}],
    }, ensure_ascii=False), encoding="utf-8")

    asked = {}

    def fake_fetch(qcodes):
        asked["qcodes"] = set(qcodes)
        return {"Q15224724": {"et": "vennapoeg", "en": "nephew", "de": "Neffe", "la": "nepos"}}

    written = {}
    monkeypatch.setattr("server.config.PROSOPOGRAPHY_DIR", str(tmp_path), raising=False)
    monkeypatch.setattr(elo, "_fetch_wikidata_labels", fake_fetch)
    monkeypatch.setattr(elo, "load_entity_labels", lambda: {})
    monkeypatch.setattr(elo, "atomic_write_json", lambda path, data: written.update({"data": data}))
    monkeypatch.setattr("server.git_ops.save_with_git",
                        lambda path, content, username, message=None, additional_files=None:
                        open(path, "w", encoding="utf-8").write(content), raising=False)

    result = elo.sync_prosopography_inline_labels(registry={}, username="meelis")

    assert asked["qcodes"] == {"Q15224724"}
    assert written["data"]["Q15224724"]["et"] == "vennapoeg"
    assert result["fetched"] == 1
    assert result["files"] == 1
    assert _json.loads(card.read_text(encoding="utf-8"))["relations"][0]["type_labels"]["et"] == "vennapoeg"


def test_sync_skips_fetch_when_disabled(tmp_path, monkeypatch):
    import json as _json
    (tmp_path / "abc.json").write_text(_json.dumps({"relations": [{"type_id": "Q1"}]}), encoding="utf-8")

    def boom(_qcodes):
        raise AssertionError("fetch_missing=False ei tohi Wikidatasse minna")

    monkeypatch.setattr("server.config.PROSOPOGRAPHY_DIR", str(tmp_path), raising=False)
    monkeypatch.setattr(elo, "_fetch_wikidata_labels", boom)
    assert elo.sync_prosopography_inline_labels(
        registry={}, fetch_missing=False) == {"files": 0, "slots": 0, "fetched": 0}
