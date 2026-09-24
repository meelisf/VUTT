"""Automaatrikastuse puhas loogika (spekk §4.3)."""
from server.prosopography import auto_enrich as ae


def src(scheme, **remote):
    return {"scheme": scheme, "id": "x", "remote": remote}


def test_uhe_allika_valjad_kaardiradadeks():
    agg = ae.aggregate([src("wikidata", **{
        "gender": "M", "birth.date": "1592-01-01", "birth.precision": "year",
        "birth.place": {"id": "Q1", "label": "Greifswald"},
        "_occupations": [{"id": "Q2", "label": "jurist"}],
        "confession": {"id": "Q3", "label": "luterlane"},
        "name.aliases": ["Laurentius Ludenius"], "name.label": "ignoreeritakse"})])
    f = agg["fields"]
    assert f["gender"] == "M"
    assert f["birth"] == {"date": "1592-01-01", "precision": "year"}
    assert f["birth.place"] == {"id": "Q1", "label": "Greifswald", "labels": None, "source": "wikidata"}
    assert f["occupations"] == [{"id": "Q2", "label": "jurist"}]
    assert f["confessions"] == [{"id": "Q3", "label": "luterlane"}]
    assert f["name.aliases"] == ["Laurentius Ludenius"]
    assert "name.label" not in f and agg["conflicts"] == []


def test_allikatevaheline_vastuolu_jaab_taitmata():
    agg = ae.aggregate([
        src("wikidata", **{"birth.date": "1592-01-01", "birth.precision": "year"}),
        src("gnd", **{"birth.date": "1593-01-01", "birth.precision": "year"})])
    assert "birth" not in agg["fields"]
    assert agg["conflicts"] == [{"field": "birth.date", "compatible": False, "values": [
        {"scheme": "wikidata", "value": "1592-01-01"}, {"scheme": "gnd", "value": "1593-01-01"}]}]


def test_kokkusobiv_kuupaev_votab_tapsema():
    agg = ae.aggregate([
        src("gnd", **{"birth.date": "1592-01-01", "birth.precision": "year"}),
        src("wikidata", **{"birth.date": "1592-02-10", "birth.precision": "day"})])
    assert agg["fields"]["birth"] == {"date": "1592-02-10", "precision": "day"}
    assert agg["conflicts"][0]["compatible"] is True


def test_sama_vaartus_kahest_allikast_ei_ole_vastuolu():
    agg = ae.aggregate([src("wikidata", gender="M"), src("gnd", gender="M")])
    assert agg["fields"]["gender"] == "M" and agg["conflicts"] == []


def test_kohad_vorreldakse_id_jargi():
    agg = ae.aggregate([
        src("wikidata", **{"death.place": {"id": "Q9", "label": "Dorpat"}}),
        src("gnd", **{"death.place": {"id": "Q9", "label": "Tartu"}})])
    assert agg["fields"]["death.place"]["id"] == "Q9" and agg["conflicts"] == []


def test_ametid_uhendatakse():
    agg = ae.aggregate([
        src("wikidata", _occupations=[{"id": "Q2", "label": "jurist"}]),
        src("gnd", _occupation_label="Professor")])
    assert agg["fields"]["occupations"] == [{"id": "Q2", "label": "jurist"}, {"label": "Professor"}]


def test_seotud_id_d_ja_nende_vastuolu():
    agg = ae.aggregate([src("viaf", _linked_wikidata="Q1", _linked_gnd="5"),
                        src("wikidata", _linked_gnd="6")])
    assert agg["linked"] == {"wikidata": "Q1"}
    assert {c["field"] for c in agg["conflicts"]} == {"identifiers.gnd"}


def test_apply_taidab_ainult_tuhja():
    card = {"gender": "F", "birth": {"date": None}, "occupations": [],
            "name": {"label": "X", "aliases": ["A"]}}
    agg = {"fields": {"gender": "M", "birth": {"date": "1592-01-01", "precision": "year"},
                      "occupations": [{"label": "jurist"}], "name.aliases": ["a", "B"]},
           "conflicts": [], "linked": {}}
    applied = ae.apply_to_card(card, agg)
    assert card["gender"] == "F"
    assert card["birth"]["date"] == "1592-01-01" and card["birth"]["precision"] == "year"
    assert card["occupations"] == [{"label": "jurist"}]
    assert card["name"]["aliases"] == ["A", "B"]  # ühend, NFC+casefold dedup
    assert set(applied) == {"birth.date", "occupations", "name.aliases"}


def test_new_review():
    r = ae.new_review(created_via="picker", context={"work_id": "w", "role": "auctor"},
                      has_enrichable_ids=True, possible_duplicate=True)
    assert r == {"state": "pending", "reasons": ["enrich_pending", "possible_duplicate"],
                 "context": {"work_id": "w", "role": "auctor"}, "created_via": "picker",
                 "auto_filled": [], "source_conflicts": [], "failed_sources": [],
                 "done_by": None, "done_at": None}
    assert ae.new_review(created_via="form", context=None, has_enrichable_ids=False,
                         possible_duplicate=False)["reasons"] == ["no_source"]


def _pending(*extra):
    return ae.new_review(created_via="picker", context=None, has_enrichable_ids=True,
                         possible_duplicate="possible_duplicate" in extra)


def test_finish_review_tabel():
    kw = dict(conflicts=[], possible_duplicate=False)
    r = ae.finish_review(_pending(), ids_left=True, answered=["wikidata"], failed=[], applied=["gender"], **kw)
    assert r["reasons"] == ["auto_enriched"] and r["auto_filled"] == ["gender"]
    r = ae.finish_review(_pending(), ids_left=True, answered=["wikidata"], failed=["gnd"], applied=["gender"], **kw)
    assert r["reasons"] == ["auto_enriched", "enrich_failed"] and r["failed_sources"] == ["gnd"]
    r = ae.finish_review(_pending(), ids_left=True, answered=["wikidata"], failed=[], applied=[], **kw)
    assert r["reasons"] == ["nothing_to_fill"]
    r = ae.finish_review(_pending(), ids_left=True, answered=["wikidata"], failed=["gnd"], applied=[], **kw)
    assert r["reasons"] == ["nothing_to_fill", "enrich_failed"]
    r = ae.finish_review(_pending(), ids_left=True, answered=[], failed=["gnd"], applied=[], **kw)
    assert r["reasons"] == ["enrich_failed"]
    r = ae.finish_review(_pending(), ids_left=False, answered=[], failed=[], applied=[], **kw)
    assert r["reasons"] == []


def test_finish_review_sailitab_muud_pohjused_ja_lisab_duplikaadi():
    r = ae.finish_review(_pending("possible_duplicate"), ids_left=True, answered=["wikidata"],
                         failed=[], applied=[], conflicts=[{"field": "x"}], possible_duplicate=True)
    assert r["reasons"] == ["possible_duplicate", "nothing_to_fill"]
    assert r["source_conflicts"] == [{"field": "x"}]
