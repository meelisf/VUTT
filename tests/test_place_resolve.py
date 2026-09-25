"""Sünni-/surmakoht → kohtade register → päritolu (#427, ADR 0052).

Register on ajalooline, P131 tänapäevane: ahelas võidab esimene leid —
registrikoht annab `parent_key`, grupi ankur ainult `group`. Nimevaste
Q-koodita kirjega ja grupita koht EI lähe registrisse, vaid ülevaatusse.
Päritolu täidetakse ainult sünnikohast ja ainult tühjana.
"""
import json

import pytest

from server.prosopography import auto_enrich_runner as runner
from server.prosopography import place_resolve as pr
from server.prosopography import places_ops as po
from server.prosopography.auto_enrich import apply_place_plans, new_review

PLACES = {
    "Riga": {"id": "Q1773", "labels": {"de": "Riga", "et": "Riia"}, "group": "liivimaa",
             "parent_key": None},
    "Rootsi": {"id": "Q34", "labels": {"et": "Rootsi"}, "group": "rootsi", "parent_key": None},
    "Wettin": {"id": None, "labels": {"de": "Wettin"}, "group": "kesk-saksamaa",
               "parent_key": None, "historical_names": []},
    "Frankfurt": {"id": "Q1794", "labels": {"de": "Frankfurt"}, "group": "kesk-saksamaa",
                  "parent_key": None},
}
GROUPS = {
    "liivimaa": {"labels": {"et": "Liivimaa"}},
    "rootsi": {"labels": {"et": "Rootsi"}},
    "svealand": {"labels": {"et": "Svealand"}, "parent": "rootsi",
                 "wikidata_anchors": ["Q106915"]},
    "pohja-saksamaa": {"labels": {"et": "Põhja-Saksamaa"}, "wikidata_anchors": ["Q1055"]},
    "kesk-saksamaa": {"labels": {"et": "Kesk-Saksamaa"}},
}


def wd(labels, parents=(), type_=None):
    return {"labels": labels, "type": type_, "coordinates": {"lat": 1.0, "lon": 2.0},
            "parents": [{"q": q, "label_en": q, "label_sv": q} for q in parents]}


WD = {
    # Strängnäs → vald → Södermanlandi län (ankur svealand) → Rootsi (registris)
    "Q106909": wd({"de": "Strängnäs", "sv": "Strängnäs"}, ["Q501532"], "city"),
    "Q501532": wd({"en": "Strängnäs Municipality"}, ["Q106915"]),
    "Q106915": wd({"en": "Södermanland County"}, ["Q34"]),
    # Riia eeslinn: ülemüksus on registris
    "Q900": wd({"de": "Mühlgraben"}, ["Q1773"]),
    # Sama tase: registrikoht JA ankur — registrikoht võidab
    "Q901": wd({"de": "Grenzort"}, ["Q106915", "Q1773"]),
    "Q1055": wd({"de": "Hamburg"}, ["Q183"]),
    "Q183": wd({"en": "Germany"}),
    "Q3806": wd({"de": "Tübingen"}, ["Q183"]),
    "Q694558": wd({"de": "Wettin"}, ["Q183"]),
    "Q2000": wd({"de": "Frankfurt"}, ["Q1055"]),
}


@pytest.fixture
def register(tmp_path, monkeypatch):
    places_file, groups_file = tmp_path / "places.json", tmp_path / "origin_groups.json"
    places_file.write_text(json.dumps(PLACES), encoding="utf-8")
    groups_file.write_text(json.dumps(GROUPS), encoding="utf-8")
    monkeypatch.setattr(po, "PLACES_FILE", str(places_file))
    monkeypatch.setattr(po, "ORIGIN_GROUPS_FILE", str(groups_file))
    monkeypatch.setattr(pr, "PLACES_FILE", str(places_file))
    commits = []

    def fake_git(path, data, username, message=None, indent=2):
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        commits.append(message)

    monkeypatch.setattr(pr, "save_config_with_git", fake_git)
    calls = []

    def fetch(q):
        calls.append(q)
        return WD.get(q)

    monkeypatch.setattr(po, "fetch_place_wikidata", fetch)
    po._load_places_cache(force_reload=True)
    po._load_origin_groups(force_reload=True)
    yield {"file": places_file, "commits": commits, "calls": calls,
           "read": lambda: json.loads(places_file.read_text(encoding="utf-8"))}
    # Moodulitaseme vahemälu ei tohi tmp-registrit järgmistele testidele jätta.
    po._places_cache = None
    po._groups_cache = None


# ── Lahendus ja registri kirjutus ─────────────────────────────────────────

def test_registris_olev_q_kood_ei_tee_paringut_ega_kirjutust(register):
    assert pr.ensure_register_place("Q1773") == {"action": "exists", "key": "Riga"}
    assert register["calls"] == [] and register["commits"] == []


def test_ankur_annab_grupi_enne_kõrgemat_registrikohta(register):
    """Södermanlandi län (ankur) on ahelas enne Rootsit (registris) → svealand, mitte rootsi."""
    plan = pr.ensure_register_place("Q106909")
    assert plan["action"] == "create" and plan["key"] == "Strängnäs"
    e = register["read"]()["Strängnäs"]
    assert (e["id"], e["group"], e["parent_key"], e["type"]) == ("Q106909", "svealand", None, "city")
    assert e["coordinates"] == {"lat": 1.0, "lon": 2.0}
    assert len(register["commits"]) == 1


def test_registris_ulemuksus_annab_parent_key_mitte_gruppi(register):
    pr.ensure_register_place("Q900")
    e = register["read"]()["Mühlgraben"]
    assert (e["parent_key"], e["group"]) == ("Riga", None)
    assert po._walk_to_group("Mühlgraben", register["read"]()) == "liivimaa"


def test_samal_tasemel_voidab_registrikoht_ankrut(register):
    pr.ensure_register_place("Q901")
    assert register["read"]()["Grenzort"]["parent_key"] == "Riga"


def test_koht_ise_voib_olla_ankur(register):
    pr.ensure_register_place("Q1055")
    assert register["read"]()["Hamburg"]["group"] == "pohja-saksamaa"


def test_grupita_koht_ei_lahe_registrisse(register):
    assert pr.ensure_register_place("Q3806") == {"action": "needs_group"}
    assert "Tübingen" not in register["read"]() and register["commits"] == []


def test_nimevaste_q_koodita_kirjega_on_ettepanek(register):
    """Registris on Wettin ilma Q-koodita — uut kirjet ei looda (duplikaat)."""
    assert pr.ensure_register_place("Q694558") == {"action": "name_match", "key": "Wettin"}
    assert register["commits"] == []


def test_sama_voti_teise_q_koodiga_saab_q_koodiga_votme(register):
    plan = pr.ensure_register_place("Q2000")
    assert plan["key"] == "Frankfurt (Q2000)"
    assert register["read"]()["Frankfurt"]["id"] == "Q1794"


def test_wikidata_toorge_ei_kirjuta(register, monkeypatch):
    monkeypatch.setattr(po, "fetch_place_wikidata", lambda q: None)
    assert pr.ensure_register_place("Q106909") == {"action": "error"}
    assert register["commits"] == []


def test_vahepeal_lisatud_koht_loetakse_luku_all_uuesti(register, monkeypatch):
    """Teine tee lisab sama Q-koodi päringu ajal → uut kirjet ei tehta."""
    def fetch(q):
        if q == "Q106909":
            p = register["read"]()
            p["Strängnäs (käsitsi)"] = {"id": "Q106909", "group": "svealand", "parent_key": None}
            register["file"].write_text(json.dumps(p), encoding="utf-8")
        return WD.get(q)

    monkeypatch.setattr(po, "fetch_place_wikidata", fetch)
    assert pr.ensure_register_place("Q106909") == {"action": "exists", "key": "Strängnäs (käsitsi)"}
    assert register["commits"] == []


def test_vigane_q_kood(register):
    assert pr.ensure_register_place("Tartu") == {"action": "error"}
    assert register["calls"] == []


# ── Kaardi rakendus (puhas) ───────────────────────────────────────────────

def test_plaan_ei_kehti_kui_kaardi_koht_vahepeal_muutus():
    card = {"birth": {"place": {"id": "Q2", "label": "Teine"}}, "origin": {}}
    applied, reasons, _ = apply_place_plans(
        card, {"birth": ("Q1", {"action": "exists", "key": "X"})},
        lambda o: pytest.fail("päritolu ei tohi täita"))
    assert applied == [] and reasons == [] and card["origin"] == {}


# ── Täitmine olemasolevale kaardile ───────────────────────────────────────

def test_tuhi_paritolu_taidetakse_sunnikohast(prosopo_env, register):
    prosopo_env.write("aaa", birth={"place": {"id": "Q1773", "label": "Riia"}},
                      origin={"city": None, "region": None})
    runner.run_place_fill("vutt:Paaa")
    k = prosopo_env.read("aaa")
    assert (k["origin"]["place"], k["origin"]["place_id"]) == ("Riga", "Q1773")
    assert k["origin"]["place_labels"] == PLACES["Riga"]["labels"]
    assert k["review"]["state"] == "pending"
    assert k["review"]["reasons"] == ["origin_from_birth"]
    assert k["review"]["created_via"] == "place_backfill"
    assert k["review"]["auto_filled"] == ["origin.place"]


def test_olemasolevat_paritolu_ei_kirjutata_ule(prosopo_env, register):
    prosopo_env.write("aaa", birth={"place": {"id": "Q1773", "label": "Riia"}},
                      origin={"place": "Rootsi", "place_id": "Q34"})
    assert runner.run_place_fill("vutt:Paaa") is None
    k = prosopo_env.read("aaa")
    assert k["origin"]["place"] == "Rootsi" and "review" not in k


def test_surmakoht_ei_taida_paritolu_aga_laheb_registrisse(prosopo_env, register):
    prosopo_env.write("aaa", death={"place": {"id": "Q106909", "label": "Strängnäs"}}, origin={})
    assert runner.run_place_fill("vutt:Paaa") is None
    assert "Strängnäs" in register["read"]()
    assert prosopo_env.read("aaa")["origin"] == {}


def test_grupita_koht_laheb_ulevaatusse(prosopo_env, register):
    prosopo_env.write("aaa", birth={"place": {"id": "Q3806", "label": "Tübingen"}}, origin={})
    runner.run_place_fill("vutt:Paaa")
    k = prosopo_env.read("aaa")
    assert k["origin"] == {}
    assert k["review"]["reasons"] == ["place_needs_group"]
    assert k["review"]["place_proposals"] == [
        {"field": "birth.place", "qid": "Q3806", "kind": "needs_group"}]


def test_kordus_on_no_op(prosopo_env, register):
    prosopo_env.write("aaa", birth={"place": {"id": "Q3806", "label": "Tübingen"}}, origin={})
    runner.run_place_fill("vutt:Paaa")
    assert runner.run_place_fill("vutt:Paaa") is None
    assert len(prosopo_env.read("aaa")["review"]["place_proposals"]) == 1


def test_kinnitatud_ulevaatust_ei_avata(prosopo_env, register):
    done = {**new_review(created_via="form", context=None, has_enrichable_ids=False,
                         possible_duplicate=False), "state": "done", "reasons": []}
    prosopo_env.write("aaa", birth={"place": {"id": "Q1773", "label": "Riia"}}, origin={},
                      review=done)
    runner.run_place_fill("vutt:Paaa")
    k = prosopo_env.read("aaa")
    assert k["origin"]["place"] == "Riga"
    assert k["review"] == done


# ── Automaatrikastus ──────────────────────────────────────────────────────

def test_rikastuse_sunnikoht_taidab_ka_paritolu(prosopo_env, register, monkeypatch):
    pending = new_review(created_via="picker", context=None, has_enrichable_ids=True,
                         possible_duplicate=False)
    prosopo_env.write("aaa", identifiers=[{"scheme": "wikidata", "id": "Q5"}],
                      birth={"date": None}, origin={}, review=pending)
    monkeypatch.setattr(runner, "fetch_remote", lambda s, i: {
        "birth.place": {"id": "Q106909", "label": "Strängnäs"}})
    runner.run_auto_enrichment("vutt:Paaa")
    k = prosopo_env.read("aaa")
    assert k["birth"]["place"]["id"] == "Q106909"
    assert k["origin"]["place"] == "Strängnäs"
    assert k["review"]["reasons"] == ["auto_enriched", "origin_from_birth"]
    assert set(k["review"]["auto_filled"]) == {"birth.place", "origin.place"}


def test_koha_toorge_ei_katkesta_rikastust(prosopo_env, register, monkeypatch):
    pending = new_review(created_via="picker", context=None, has_enrichable_ids=True,
                         possible_duplicate=False)
    prosopo_env.write("aaa", identifiers=[{"scheme": "wikidata", "id": "Q5"}],
                      gender=None, birth={"place": {"id": "Q106909", "label": "S"}},
                      origin={}, review=pending)
    monkeypatch.setattr(runner, "fetch_remote", lambda s, i: {"gender": "F"})

    def boom(q):
        raise RuntimeError("võrk maas")

    monkeypatch.setattr(po, "fetch_place_wikidata", boom)
    runner.run_auto_enrichment("vutt:Paaa")
    k = prosopo_env.read("aaa")
    assert k["gender"] == "F" and k["origin"] == {}
    assert k["review"]["reasons"] == ["auto_enriched"]
