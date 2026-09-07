"""Taotleja huvipakkuvad kollektsioonid registreerimisvormil (#321).

Väli on **soov, mitte volitus**: see eeltäidab admini kinnitusekraanil
kirjutamisulatuse valiku, aga ei anna ise ühtki õigust. Ulatuse otsustab
admin (ADR 0031) — server ei tohi seda kunagi taotleja väljalt üle võtta.
"""
import pytest

COLLECTIONS = {
    "ag": {"name": {"et": "Academia Gustaviana", "en": "Academia Gustaviana"}},
    "agc": {"name": {"et": "Academia Gustavo-Carolina", "en": "Academia Gustavo-Carolina"}},
    "matused": {"name": {"et": "Matusetrükised", "en": "Funeral prints"}},
    "rootsi": {"name": {"et": "Rootsi aja ülikool", "en": "Swedish era"}, "type": "virtual_group"},
}


@pytest.fixture
def collections(backend_env, monkeypatch):
    monkeypatch.setattr(backend_env["registration"], "get_cached_collections", lambda: COLLECTIONS)
    return COLLECTIONS


def _register(client, **extra):
    body = {"name": "New User", "email": "new@example.test",
            "motivation": "Huvitab vara-uusaeg", "gdpr_consent": True}
    body.update(extra)
    res = client.post("/register", json=body)
    assert res.status_code == 200, res.text
    return res.json()


def _pending(client, login):
    headers = {"Authorization": f"Bearer {login('admin', 'adminpass')}"}
    return client.post("/admin/registrations", headers=headers).json()["registrations"][0]


def test_huvi_salvestub_ja_joudab_adminini(client, login, collections):
    _register(client, interest_collections=["ag", "agc"])
    assert _pending(client, login)["interest_collections"] == ["ag", "agc"]


def test_tundmatu_id_visatakse_ara(client, login, collections):
    _register(client, interest_collections=["ag", "pole-olemas"])
    assert _pending(client, login)["interest_collections"] == ["ag"]


def test_virtuaalgrupp_ei_kolba(client, login, collections):
    """Virtuaalgruppi ei saa kirjutamisulatuseks määrata (ADR 0031), seega ei
    ole tal mõtet ka väljal, mis ulatust eeltäidab."""
    _register(client, interest_collections=["rootsi"])
    assert _pending(client, login)["interest_collections"] == []


def test_vigane_sisend_ei_kukuta_taotlust(client, login, collections):
    _register(client, interest_collections="ag")
    assert _pending(client, login)["interest_collections"] == []


def test_puuduv_vali_annab_tuhja_loendi(client, login, collections):
    """Vana klient ei saada välja üldse — taotlus peab ikka tekkima."""
    _register(client)
    assert _pending(client, login)["interest_collections"] == []


def test_huvi_ei_anna_kirjutamisulatust(client, login, collections):
    """KESKNE INVARIANT: kinnitamisel loeb ainult admini saadetud ulatus.

    Kui taotleja soov jõuaks serveris otse `edit_collections`-i, määraks
    taotleja ise oma kirjutamisõiguse.
    """
    _register(client, interest_collections=["ag", "agc"])
    headers = {"Authorization": f"Bearer {login('admin', 'adminpass')}"}
    reg_id = _pending(client, login)["id"]

    res = client.post("/admin/registrations/approve",
                      json={"registration_id": reg_id, "role": "contributor",
                            "edit_collections": []},
                      headers=headers)
    assert res.status_code == 200, res.text
    assert res.json()["edit_collections"] == []


def test_soovi_arv_on_piiratud(client, login, collections, monkeypatch):
    """Piir on SOOVIL, mitte õigusel (#321). Vorm hoiab seda ka ise, aga vorm
    ei ole turvapiir — server lõikab liigse maha."""
    from server import registration

    monkeypatch.setattr(registration, "MAX_INTEREST_COLLECTIONS", 2)
    # Kolm KEHTIVAT kogu (+ virtuaalgrupp ja tundmatu id, mis kukuvad juba enne
    # piiri) — muidu ei eristaks test piiri sanitiseerimisest.
    _register(client, interest_collections=["ag", "agc", "matused", "rootsi", "pole-olemas"])
    assert _pending(client, login)["interest_collections"] == ["ag", "agc"]


def test_vaikepiir_on_kolm(client, login, collections):
    _register(client, interest_collections=["ag", "agc", "matused"])
    from server.registration import MAX_INTEREST_COLLECTIONS

    assert MAX_INTEREST_COLLECTIONS == 3
    assert _pending(client, login)["interest_collections"] == ["ag", "agc", "matused"]


def test_admini_ulatust_piir_ei_puuduta(client, login, collections):
    """Admin tohib anda rohkem kui MAX_INTEREST_COLLECTIONS kogu."""
    _register(client, interest_collections=["ag"])
    headers = {"Authorization": f"Bearer {login('admin', 'adminpass')}"}
    reg_id = _pending(client, login)["id"]

    res = client.post("/admin/registrations/approve",
                      json={"registration_id": reg_id, "role": "contributor",
                            "edit_collections": ["ag", "agc"]},
                      headers=headers)
    assert res.status_code == 200, res.text
    assert res.json()["edit_collections"] == ["ag", "agc"]
