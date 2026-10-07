"""Kirjaindeksi live-sünk (#526, ADR 0065).

Võlts-Meili: iga päring peab olema tabelis — tundmatu päring = pytest.fail,
muidu neelaks lai except selle vaikselt (vaakum-mock).
"""
import json

import pytest

import server.meilisearch_ops as ops


class FakeMeili:
    def __init__(self):
        self.calls = []            # (meetod, tee, keha)
        self.task_status = {}      # task_uid -> 'succeeded' | 'failed'
        self.routes = {}           # (meetod, tee) -> keha-funktsioon või vastus
        self._next_task = 1

    def task(self, status="succeeded"):
        uid = self._next_task
        self._next_task += 1
        self.task_status[uid] = status
        return {"taskUid": uid}

    def urlopen(self, req, timeout=None):
        method = req.get_method()
        path = req.full_url.replace("http://meili", "")
        body = json.loads(req.data) if req.data else None
        if method == "GET" and path.startswith("/tasks/"):
            uid = int(path.rsplit("/", 1)[1])
            return _Resp({"status": self.task_status[uid]})
        self.calls.append((method, path, body))
        if (method, path) not in self.routes:
            pytest.fail(f"Ootamatu Meili päring: {method} {path}")
        handler = self.routes[(method, path)]
        return _Resp(handler(body) if callable(handler) else handler)

    def calls_to(self, method, path):
        return [b for m, p, b in self.calls if m == method and p == path]


class _Resp:
    def __init__(self, data):
        self._raw = json.dumps(data).encode()

    def read(self):
        return self._raw

    def __enter__(self):
        return self

    def __exit__(self, *a):
        pass


DOCS = "/indexes/kirjad/documents"
# Primaarvõti selgesõnaliselt: dokumendis on `id` JA `part_id` → Meili ei oska ise valida.
UPSERT = "/indexes/kirjad/documents?primaryKey=id"
DELETE = "/indexes/kirjad/documents/delete"


@pytest.fixture
def meili(monkeypatch):
    fake = FakeMeili()
    monkeypatch.setattr(ops, "MEILI_URL", "http://meili")
    monkeypatch.setattr(ops, "MEILI_KEY", "master")
    import urllib.request
    monkeypatch.setattr(urllib.request, "urlopen", fake.urlopen)
    return fake


def test_upsert_siis_aegunute_kustutus(meili):
    meili.routes[("POST", UPSERT)] = lambda b: meili.task()
    meili.routes[("POST", DELETE)] = lambda b: meili.task()

    assert ops.sync_letters("w1", [{"id": "w1__a", "work_id": "w1"}]) is True

    assert [(m, p) for m, p, _ in meili.calls] == [("POST", UPSERT), ("POST", DELETE)]
    assert meili.calls_to("POST", DELETE)[0] == {"filter": 'work_id = "w1" AND NOT id IN ["w1__a"]'}


def test_upserti_torge_kustutust_ei_tee(meili):
    meili.routes[("POST", UPSERT)] = lambda b: meili.task("failed")

    assert ops.sync_letters("w1", [{"id": "w1__a"}]) is False
    assert meili.calls_to("POST", DELETE) == []


def test_kustutuse_torge_on_ebaonnestunud_sunk(meili):
    meili.routes[("POST", UPSERT)] = lambda b: meili.task()
    meili.routes[("POST", DELETE)] = lambda b: meili.task("failed")

    assert ops.sync_letters("w1", [{"id": "w1__a"}]) is False


def test_kirjadeta_teos_ainult_kustutus(meili):
    meili.routes[("POST", DELETE)] = lambda b: meili.task()

    assert ops.sync_letters("w1", []) is True
    assert meili.calls_to("POST", DELETE) == [{"filter": 'work_id = "w1"'}]
    assert meili.calls_to("POST", UPSERT) == []


def _work(tmp_path, parts, pages=2):
    work_dir = tmp_path / "slug-w1"
    work_dir.mkdir()
    (work_dir / "_metadata.json").write_text(json.dumps({"id": "w1", "title": "T", "parts": parts}))
    for n in range(1, pages + 1):
        (work_dir / f"a-{n:03d}.jpg").touch()
        (work_dir / f"a-{n:03d}.txt").write_text(f"tekst {n}")
    return work_dir


@pytest.fixture
def work_env(monkeypatch, tmp_path, meili):
    monkeypatch.setattr(ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(ops, "load_collections", lambda: {})
    monkeypatch.setattr(ops, "load_people_aliases", lambda: {})
    monkeypatch.setattr(ops, "load_labels_store", lambda: {})
    monkeypatch.setattr(ops, "_delete_extra_pages", lambda work_id, n: True)
    monkeypatch.setattr(ops, "send_to_meilisearch", lambda docs: True)
    return tmp_path


def test_teose_sunk_kirjutab_kirjad(work_env, meili):
    _work(work_env, [{"id": "p1", "kind": "letter", "pages": ["a-002"]}])
    meili.routes[("POST", UPSERT)] = lambda b: meili.task()
    meili.routes[("POST", DELETE)] = lambda b: meili.task()

    assert ops.sync_work_to_meilisearch("slug-w1") is True
    sent = meili.calls_to("POST", UPSERT)[0]
    assert [d["id"] for d in sent] == ["w1__p1"]
    assert sent[0]["letter_text"] == "tekst 2"


def test_kirjade_torge_teeb_teose_sungi_ebaonnestunuks(work_env, meili):
    _work(work_env, [{"id": "p1", "kind": "letter", "pages": ["a-002"]}])
    meili.routes[("POST", UPSERT)] = lambda b: meili.task("failed")

    assert ops.sync_work_to_meilisearch("slug-w1") is False


def test_liik_letter_muuks_kustutab_kirja(work_env, meili):
    _work(work_env, [{"id": "p1", "kind": "poem", "pages": ["a-002"]}])
    meili.routes[("POST", DELETE)] = lambda b: meili.task()

    assert ops.sync_work_to_meilisearch("slug-w1") is True
    assert meili.calls_to("POST", DELETE) == [{"filter": 'work_id = "w1"'}]


def test_viimane_leht_kustutatud_kirjad_kustutatakse_enne_valjumist(work_env, meili):
    _work(work_env, [{"id": "p1", "kind": "letter", "pages": ["a-001"]}], pages=0)
    meili.routes[("POST", DELETE)] = lambda b: meili.task()

    assert ops.sync_work_to_meilisearch("slug-w1") is False
    assert meili.calls_to("POST", DELETE) == [{"filter": 'work_id = "w1"'}]


def test_loetamatu_meta_ei_puuduta_kirju(work_env, meili, monkeypatch):
    work_dir = _work(work_env, [])
    monkeypatch.setattr(ops, "_read_work_meta", lambda path: None)

    assert ops.sync_work_to_meilisearch(work_dir.name) is False
    assert meili.calls == []


def test_teose_kustutus_kustutab_ka_kirjad(meili):
    meili.routes[("POST", "/indexes/teosed/documents/delete")] = lambda b: meili.task()
    meili.routes[("POST", DELETE)] = lambda b: meili.task()

    assert ops.delete_work_from_meilisearch("w1") is True
    assert meili.calls_to("POST", DELETE) == [{"filter": 'work_id = "w1"'}]


def test_nahtavus_uuendab_ka_aegunud_kirju(meili):
    """Sihtmärk on indeksis olevad kirjad, mitte _metadata.json osad: kustutusvea
    tõttu alles jäänud vana kiri ei tohi jääda avalikuks."""
    meili.routes[("POST", "/indexes/kirjad/documents/fetch")] = {
        "results": [{"id": "w1__a"}, {"id": "w1__vana"}], "total": 2,
    }
    meili.routes[("PUT", DOCS)] = lambda b: meili.task()

    ops._update_letters_is_public({"w1": False})

    assert meili.calls_to("POST", "/indexes/kirjad/documents/fetch")[0]["filter"] == 'work_id = "w1"'
    assert meili.calls_to("PUT", DOCS) == [[
        {"id": "w1__a", "is_public": False},
        {"id": "w1__vana", "is_public": False},
    ]]


def test_kirjade_indeksi_seaded(meili):
    from server.meili_settings import (
        LETTERS_FILTERABLE_ATTRIBUTES, LETTERS_SEARCHABLE_ATTRIBUTES, LETTERS_SORTABLE_ATTRIBUTES,
    )
    meili.routes[("PATCH", "/indexes/kirjad/settings")] = lambda b: meili.task()

    ops._ensure_letters_index()

    body = meili.calls_to("PATCH", "/indexes/kirjad/settings")[0]
    assert body["searchableAttributes"] == LETTERS_SEARCHABLE_ATTRIBUTES
    assert body["filterableAttributes"] == LETTERS_FILTERABLE_ATTRIBUTES
    assert body["sortableAttributes"] == LETTERS_SORTABLE_ATTRIBUTES
