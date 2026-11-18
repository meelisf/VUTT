"""#834: isikuettepaneku uued realiigid — sünd, surm, päritolu, sugu, elulugu."""
import pytest

from server.prosopo_biography_fields import text_hash
from server.prosopography import enrichment_proposals as proposals
# Fixture'id (autouse: ajutine ettepanekute baas, korpuses teos w1 50 lk) jagatud.
from tests.test_prosopo_enrichment_proposals import (  # noqa: F401
    _headers, _kood, korpuse_teos, proposal_db, registrid)

OK_EVIDENCE = [{"source_kind": "vutt_page", "work_id": "w1", "page": 3}]
LINK = "([VUTT, *Oratio*, 3](https://vutt.utlib.ut.ee/work/w1/3))"


def _bio(text=f"Professor {LINK}.", **extra):
    item = {"kind": "biography", "lang": "et", "base_hash": text_hash(""), "text": text}
    item.update(extra)
    return item


@pytest.mark.parametrize("item", [
    {"kind": "birth", "date": {"date": "1755", "precision": "year"}, "evidence": OK_EVIDENCE},
    {"kind": "death", "date": {"date": "1807-03-02", "precision": "day"}, "place_key": "tartu",
     "evidence": OK_EVIDENCE},
    {"kind": "origin", "place_key": "tartu", "evidence": OK_EVIDENCE},
    {"kind": "gender", "value": "M", "evidence": OK_EVIDENCE},
    _bio(sources_add=[{"text": "Levitski 1902: Биографический словарь I, lk 106."},
                      {"work_id": "w1", "page": 3}]),
    _bio(text="Suhteline viide ([VUTT](/work/w1/7))."),
])
def test_kehtiv_rida(item, registrid):
    proposals._validate_item(item)


@pytest.mark.parametrize("item,kood", [
    ({"kind": "birth", "date": {"date": "1755"}, "evidence": []}, "evidence_required"),
    ({"kind": "birth", "date": {"date": "1755"}, "evidence": OK_EVIDENCE, "place_key": "tartu"},
     "invalid_item"),
    ({"kind": "birth", "date": {"date": "17x5"}, "evidence": OK_EVIDENCE}, "invalid_date"),
    ({"kind": "origin", "place_key": "atlantis", "evidence": OK_EVIDENCE}, "unknown_place_key"),
    ({"kind": "death", "date": {"date": "1807"}, "place_key": "atlantis", "evidence": OK_EVIDENCE},
     "unknown_place_key"),
    ({"kind": "gender", "value": "X", "evidence": OK_EVIDENCE}, "invalid_gender"),
    (_bio(lang="de"), "invalid_lang"),
    (_bio(text="ilma viiteta"), "citation_required"),
    (_bio(text=f"<b>x</b> {LINK}"), "html_not_allowed"),
    (_bio(lang="en", text=f"Хорн {LINK}"), "cyrillic_not_allowed"),
    (_bio(text="x" * 40_001 + f" {LINK}"), "biography_too_long"),
    (_bio(base_hash=None), "invalid_base_hash"),
    (_bio(sources_add=[{"source_kind": "literature", "source_id": "ABC", "locator": "lk 1"}]),
     "literature_not_resolved"),
    (_bio(sources_add=[{"text": "x"}] * 11), "too_many_sources"),
    ({"kind": "origin", "place_key": "tartu", "evidence": OK_EVIDENCE,
      "match_status": "matched"}, "invalid_item"),
])
def test_vigane_rida(item, kood, registrid):
    with pytest.raises(proposals.ProposalError, match=kood):
        proposals._validate_item(item)


def test_eluloo_lingid():
    from server.prosopography.enrichment_kinds import biography_links
    tekst = f"a {LINK} b ([x](/work/AbC_9/12)) c (https://example.org/work/w2/1)"
    assert biography_links(tekst) == [
        {"source_kind": "vutt_page", "work_id": "w1", "page": 3},
        {"source_kind": "vutt_page", "work_id": "AbC_9", "page": 12},
    ]


@pytest.fixture
def esita(client, login, prosopo_env, registrid):
    """Esitab ettepaneku HTTP kaudu; tagastab vastuse."""
    card = prosopo_env.write("abc")
    token = login("superadmin", "superpass")

    def run(items):
        body = {"code": _kood(client, token), "person_id": "vutt:Pabc",
                "base_updated_at": card["updated_at"], "items": items}
        return client.post("/prosopography/enrichment-proposals/submit", json=body)
    run.token = token
    return run


def test_kaks_sama_liigi_rida_lukatakse_tagasi(esita):
    birth = {"kind": "birth", "date": {"date": "1755"}, "evidence": OK_EVIDENCE}
    r = esita([birth, dict(birth)])
    assert r.status_code == 400 and "duplicate_kind" in r.text
    # Eri keele elulood on eri liigid
    assert esita([_bio(), _bio(lang="en", text=f"Professor {LINK}.")]).status_code == 200


def test_eluloo_link_vale_lehele(esita):
    r = esita([_bio(text="x ([V](/work/w1/999))")])
    assert r.status_code == 400 and "page_out_of_range" in r.text


def test_pikk_elulugu_mahub(esita):
    pikk = ("Lõik pikast eluloost. " * 2800)[:39_000] + f" {LINK}"
    assert esita([_bio(text=pikk), _bio(lang="en", text=pikk)]).status_code == 200
