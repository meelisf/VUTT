"""ADA lookup endpoint: rollikontroll, vigade kuju, blokeeriv I/O threadpoolis.

Fixture-muster on sama nagu `tests/test_admin_role_endpoints.py`-s: `client` +
`login` fixture'id, token Authorization-päises.

MÄRKUS: `lookup` normaliseerib sisendi ISE (vt `server/ada/client.py`) ja
viskab `AdaViga` prügi peal ENNE ühtki võrgukutset. Seepärast endpoint EI
eelfiltreeri handle'it `normaliseeri_handle`-ga — see lükkaks tagasi ka
UUID- ja `/items/{uuid}`-kuju, mida `lookup` tahtlikult toetab.
"""
import pytest

from server.ada import client as ada_client


def _peis(login, kasutaja="admin", parool="adminpass"):
    return {"Authorization": "Bearer {}".format(login(kasutaja, parool))}


def test_lookup_nouab_admini(client, login):
    """editor < admin — endpoint on /admin/ all ja nõuab require_role('admin')."""
    r = client.post("/admin/ada/lookup", json={"handle": "10062/7822"},
                    headers=_peis(login, "editor", "editorpass"))
    assert r.status_code in (401, 403)


def test_lookup_tagastab_ada_ploki(client, login, monkeypatch):
    monkeypatch.setattr(ada_client, "lookup", lambda h: {
        "handle": h, "item_uuid": "u", "meta": {"title": "T"},
        "failid": [{"name": "a.pdf", "bitstream_uuid": "b", "size_bytes": 5, "tapsus": 0}],
        "kogu_baite": 5, "vahele_jaetud": [],
    })
    r = client.post("/admin/ada/lookup", json={"handle": "hdl:10062/7822"},
                    headers=_peis(login))
    assert r.status_code == 200, r.text
    assert r.json()["ada"]["handle"] == "hdl:10062/7822"


def test_lookup_viga_tuleb_400_ga_ja_kasutaja_sonumiga(client, login, monkeypatch):
    def kukub(h):
        raise ada_client.AdaViga("Sellist kirjet ADA-s ei ole.")

    monkeypatch.setattr(ada_client, "lookup", kukub)
    r = client.post("/admin/ada/lookup", json={"handle": "10062/9999999"},
                    headers=_peis(login))
    assert r.status_code == 400
    assert r.json()["detail"] == "Sellist kirjet ADA-s ei ole."


def test_vigane_sisend_ei_joua_vorku(client, login, monkeypatch):
    """Prügi peab andma 400 ILMA ADA-t puudutamata.

    Parandus brief'i suhtes: endpoint EI eelfiltreeri `normaliseeri_handle`-ga
    (see lükkaks tagasi ka UUID/items-URL kuju), vaid kutsub `lookup`-i otse —
    `lookup` normaliseerib ise ja viskab `AdaViga` prügi peal ENNE võrku
    minekut. Seda testime siin `requests.get`-i monkeypatchides: kui see
    kutsutakse, on tegemist reaalse veaga.
    """
    def ei_tohi_kutsuda(*a, **k):
        raise AssertionError("ADA-t ei tohi puudutada vigase sisendi korral")

    monkeypatch.setattr(ada_client.requests, "get", ei_tohi_kutsuda)
    r = client.post("/admin/ada/lookup", json={"handle": "mingi jama"},
                    headers=_peis(login))
    assert r.status_code == 400
