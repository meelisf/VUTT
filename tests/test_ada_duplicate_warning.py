"""Duplikaadi hoiatus: sama handle juba imporditud. HOIATUS, mitte blokeering."""
import pytest

from server.ada import client as ada_client


def test_external_url_on_filtreeritav():
    """Ilma selleta ei saa Meilist handle'i järgi küsida."""
    from server.meili_settings import FILTERABLE_ATTRIBUTES
    assert "external_url" in FILTERABLE_ATTRIBUTES


def test_external_url_on_ka_runtime_nouetes():
    """FILTERABLE_ATTRIBUTES üksi ei jõustu käivas instantsis ilma reindeksita —
    _ensure_filterable_attributes() loeb RUNTIME_REQUIRED_FILTERABLE-t
    (meilisearch_ops.py), mitte täisnimekirja. Ilma selleta jääb hoiatus
    tootmises vaikselt tööle hakkamata."""
    from server.meili_settings import RUNTIME_REQUIRED_FILTERABLE
    assert "external_url" in RUNTIME_REQUIRED_FILTERABLE


def _peis(login):
    return {"Authorization": "Bearer {}".format(login("admin", "adminpass"))}


def _fake_lookup(monkeypatch):
    monkeypatch.setattr(ada_client, "lookup", lambda h: {
        "handle": h, "item_uuid": "u",
        "meta": {"title": "T", "external_url": "http://hdl.handle.net/10062/7822"},
        "failid": [], "kogu_baite": 0, "vahele_jaetud": [],
    })


def test_lookup_hoiatab_kui_handle_juba_olemas(client, login, monkeypatch):
    from server.routers import upload as upload_router
    _fake_lookup(monkeypatch)
    monkeypatch.setattr(upload_router, "otsi_teos_external_url_jargi",
                        lambda url: {"work_id": "abc123", "title": "Juba olemas"})
    r = client.post("/admin/ada/lookup", json={"handle": "10062/7822"},
                    headers=_peis(login))
    assert r.status_code == 200  # HOIATUS, mitte viga
    assert r.json()["ada"]["olemasolev"]["work_id"] == "abc123"


def test_hoiatus_puudub_kui_teost_ei_ole(client, login, monkeypatch):
    from server.routers import upload as upload_router
    _fake_lookup(monkeypatch)
    monkeypatch.setattr(upload_router, "otsi_teos_external_url_jargi", lambda url: None)
    r = client.post("/admin/ada/lookup", json={"handle": "10062/7822"},
                    headers=_peis(login))
    assert "olemasolev" not in r.json()["ada"]


def test_lookup_onnestub_kui_meili_kukub_labi_terve_tee(client, login, monkeypatch):
    """Otsast otsani: kui `_meili_search` viskab (Meili maas/aeglane), peab
    `/admin/ada/lookup` ikkagi 200 ja metaandmed tagastama, lihtsalt ilma
    `olemasolev`-i võtmeta. Duplikaadikontroll on mugavus, mitte eeldus."""
    from server import meilisearch_ops
    _fake_lookup(monkeypatch)

    def kukub(body, timeout=30):
        raise RuntimeError("Meilisearch on maas")

    monkeypatch.setattr(meilisearch_ops, "_meili_search", kukub)
    r = client.post("/admin/ada/lookup", json={"handle": "10062/7822"},
                    headers=_peis(login))
    assert r.status_code == 200, r.text
    assert "olemasolev" not in r.json()["ada"]


def test_otsi_teos_neelab_meili_erandi(monkeypatch):
    """otsi_teos_external_url_jargi ise peab Meili vea neelama ja None
    tagastama — see on koht, kus tegelik veakindlus elab."""
    from server.routers.upload import otsi_teos_external_url_jargi
    from server import meilisearch_ops

    def kukub(body, timeout=30):
        raise RuntimeError("Meilisearch on maas")

    monkeypatch.setattr(meilisearch_ops, "_meili_search", kukub)
    assert otsi_teos_external_url_jargi("http://hdl.handle.net/10062/7822") is None


def test_otsi_teos_tyhja_url_puhul_ei_kysi_meililt(monkeypatch):
    """Tühi external_url (levinud olukord, kui ADA-s väli puudub) ei tohi
    tekitada tühja/vigast filtrit.

    MÄRKUS: funktsiooni sees on laiaulatuslik `except Exception`, mis
    neelaks ka mock'i `AssertionError`-i — see muudaks testi vaikivalt
    tähenduseta. Seepärast loeme kutsumist väljaspool try/except-ahelat,
    booleaniga, mitte erandiga.
    """
    from server.routers.upload import otsi_teos_external_url_jargi

    kutsutud = []

    def loe_kutset(*a, **k):
        kutsutud.append(True)
        return {"hits": []}

    from server import meilisearch_ops
    monkeypatch.setattr(meilisearch_ops, "_meili_search", loe_kutset)
    assert otsi_teos_external_url_jargi("") is None
    assert kutsutud == [], "tühja URL-iga ei tohi Meilit kutsuda"
