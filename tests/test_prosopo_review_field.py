"""`review` on serveri väli (ADR 0048): klient ei saa seda ühestki teest muuta."""
import pytest

from server.prosopography import person_crud

REVIEW = {"state": "pending", "reasons": ["no_source"], "created_via": "picker"}


def test_update_person_ei_kirjuta_review_d(prosopo_env):
    k = prosopo_env.write("aaa", review=REVIEW)
    person_crud.update_person("vutt:Paaa", {
        "review": {"state": "done"}, "updated_at": k["updated_at"]}, "toimetaja")
    assert prosopo_env.read("aaa")["review"] == REVIEW


@pytest.mark.parametrize("keha", [{}, {"review": None}])
def test_vana_vorm_ilma_review_ta_jatab_margi_alles(prosopo_env, keha):
    k = prosopo_env.write("aaa", review=REVIEW)
    person_crud.update_person("vutt:Paaa", {**keha, "notes": "x",
                                             "updated_at": k["updated_at"]}, "u")
    assert prosopo_env.read("aaa")["review"] == REVIEW


@pytest.mark.parametrize("rada", ["review", "review.state", "review.reasons"])
def test_enrich_ei_kirjuta_review_d(prosopo_env, rada):
    prosopo_env.write("aaa", review=REVIEW)
    person_crud.apply_enrichment("vutt:Paaa", {rada: "done"}, "u")
    assert prosopo_env.read("aaa")["review"] == REVIEW


@pytest.mark.parametrize("rada", ["identifiers", "identifiers.0.id"])
def test_enrich_ei_muuda_identifiers_it(prosopo_env, rada):
    prosopo_env.write("aaa", identifiers=[{"scheme": "gnd", "id": "1"}])
    with pytest.raises(ValueError, match="identifiers_via_enrich"):
        person_crud.apply_enrichment("vutt:Paaa", {rada: []}, "u")
    assert prosopo_env.read("aaa")["identifiers"] == [{"scheme": "gnd", "id": "1"}]


def test_strip_server_fields():
    assert person_crud.strip_server_fields(
        {"review": 1, "review.state": 2, "reviewer": 3, "notes": 4}) == {"reviewer": 3, "notes": 4}
