"""Privaatse kogu alamkogu on privaatne (#617, `server/collection_tree.py`).

Enne pärimist arvestas teose `is_public` ainult otseste kogude `visibility`-t:
privaatse vanema alla visibility-väljata alamkogu teosed olid avalikud.
"""
import json

import pytest

from server.collection_tree import (
    collection_chain,
    collection_descendants,
    is_collection_public,
    is_work_public_in,
)

KOGUD = {
    "priv": {"visibility": "restricted"},
    "priv-laps": {"parent": "priv"},                      # visibility puudub
    "priv-lapselaps": {"parent": "priv-laps", "visibility": "public"},
    "avalik": {"visibility": "public"},
    "avalik-laps": {"parent": "avalik"},
    "tsykkel-a": {"parent": "tsykkel-b"},
    "tsykkel-b": {"parent": "tsykkel-a"},
}


def test_alamkogu_parib_privaatsuse():
    assert is_collection_public("priv-laps", KOGUD) is False
    # Enda „public" määrang ei kaalu privaatset esivanemat üles.
    assert is_collection_public("priv-lapselaps", KOGUD) is False


def test_avaliku_vanema_alamkogu_on_avalik():
    assert is_collection_public("avalik-laps", KOGUD) is True
    assert is_collection_public("tundmatu", KOGUD) is True


def test_tsykkel_ei_jaa_kinni():
    assert collection_chain("tsykkel-a", KOGUD) == ["tsykkel-a", "tsykkel-b"]
    assert is_collection_public("tsykkel-a", KOGUD) is True


def test_teose_tasandil_public_wins():
    assert is_work_public_in([], KOGUD) is True
    assert is_work_public_in(["priv-laps"], KOGUD) is False
    assert is_work_public_in(["priv-laps", "avalik-laps"], KOGUD) is True


def test_jarglased():
    assert collection_descendants("priv", KOGUD) == {"priv", "priv-laps", "priv-lapselaps"}


@pytest.fixture
def ao_kogud(monkeypatch):
    import server.access_ops as ao
    monkeypatch.setattr(ao, "get_cached_collections", lambda: KOGUD)
    return ao


def test_is_work_public_parib(ao_kogud):
    assert ao_kogud.is_work_public({"collections": ["priv-laps"]}) is False


def test_vanema_lugemisoigus_katab_alamkogu(ao_kogud):
    meta = {"collections": ["priv-lapselaps"]}
    lugeja = {"role": "contributor", "allowed_collections": ["priv"]}
    voonas = {"role": "contributor", "allowed_collections": ["avalik"]}
    assert ao_kogud.can_read_work(meta, lugeja) is True
    assert ao_kogud.can_read_work(meta, voonas) is False
    assert ao_kogud.can_read_work(meta, None) is False


def test_otsingus_nahtavus_kordab_hierarhia_filtrit(ao_kogud):
    from server.work_sets_access import is_search_visible
    meta = {"collections": ["priv-laps"]}
    assert is_search_visible(meta, {"role": "editor", "allowed_collections": ["priv"]}) is True
    assert is_search_visible(meta, {"role": "editor", "allowed_collections": []}) is False


def test_meili_doc_is_public_parib():
    import inspect
    import server.meili_doc as md
    # Lehedokumendi is_public tuleb ühisest abilisest, mitte oma koopiast.
    assert md.is_work_public_in is is_work_public_in
    assert 'is_public": is_work_public_in(' in inspect.getsource(md)


class _Sync:
    def submit(self, fn, *a, **kw):
        fn(*a, **kw)


def test_vanema_nahtavuse_muutus_uuendab_alamkogu_teosed(tmp_path, monkeypatch):
    import urllib.request
    import server.meilisearch_ops as ops

    for slug, wid, cols in (("a", "w-laps", ["priv-laps"]), ("b", "w-voonas", ["avalik"])):
        d = tmp_path / slug
        d.mkdir()
        (d / "_metadata.json").write_text(json.dumps({"id": wid, "collections": cols}))
        (d / "p_001.jpg").touch()

    monkeypatch.setattr(ops, "MEILI_URL", "http://localhost:7700")
    monkeypatch.setattr(ops, "MEILI_KEY", "test-master-key")
    monkeypatch.setattr(ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(ops, "load_collections", lambda: KOGUD)
    monkeypatch.setattr(ops, "_meilisearch_executor", _Sync())
    kirjad = {}
    monkeypatch.setattr(ops, "_update_letters_is_public", kirjad.update)

    saadetud = []

    class _Vastus:
        def read(self): return json.dumps({"taskUid": 1}).encode()
        def __enter__(self): return self
        def __exit__(self, *a): pass

    def fake_urlopen(req, timeout=None):
        saadetud.extend(json.loads(req.data))
        return _Vastus()

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    ops.update_collection_is_public_async("priv", False)

    assert saadetud == [{"id": "w-laps-1", "work_id": "w-laps", "is_public": False}]
    assert kirjad == {"w-laps": False}


def test_oiguse_maaramine_lubatud_privaatse_vanema_alamkogule(backend_env, monkeypatch):
    auth = backend_env["auth"]
    monkeypatch.setattr(auth, "get_cached_collections", lambda: KOGUD)
    admin = {"username": "admin", "role": "admin"}
    ok, sonum, _ = auth.apply_collection_rights_delta(
        [{"username": "contrib", "collection_id": "priv-lapselaps", "field": "allowed", "action": "add"}],
        admin)
    assert ok, sonum
    ok, _, _ = auth.apply_collection_rights_delta(
        [{"username": "contrib", "collection_id": "avalik-laps", "field": "allowed", "action": "add"}],
        admin)
    assert not ok
