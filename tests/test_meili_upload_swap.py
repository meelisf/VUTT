# tests/test_meili_upload_swap.py
"""Seed-üleslaadimine ehitab indeksi kõrvale ja vahetab alles valmis kujul.

2026-11-01 kukkus vana skript pärast `delete_index`-it 5 s ootepiiri peale ja
tootmise `teosed` jäi tühjaks. Valvur: iga viga enne vahetust jätab elava
indeksi puutumata.
"""
import importlib.util
import os
from types import SimpleNamespace

import pytest

_PATH = os.path.join(os.path.dirname(__file__), "..", "scripts", "2-1_upload_to_meili.py")
_spec = importlib.util.spec_from_file_location("seed_upload", _PATH)
seed = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(seed)


class FakeClient:
    """Mälus Meili: indeksid nimega, taskid kohe lõpetatud (või ebaõnnestunud)."""

    def __init__(self, live=None, fail_task_types=()):
        self.indexes = {} if live is None else {"teosed": dict(live)}
        self.fail = set(fail_task_types)
        self.tasks = {}
        self.log = []

    def _task(self, kind, ok=True):
        uid = len(self.tasks) + 1
        ok = ok and kind not in self.fail
        self.tasks[uid] = SimpleNamespace(status="succeeded" if ok else "failed", type=kind,
                                          error=None if ok else {"message": "x"})
        self.log.append((kind, ok))
        return SimpleNamespace(task_uid=uid)

    def wait_for_task(self, uid, timeout_in_ms=0, interval_in_ms=0):
        return self.tasks[uid]

    def delete_index(self, name):
        existed = self.indexes.pop(name, None) is not None
        return self._task("indexDeletion", existed)

    def create_index(self, name, opts):
        self.indexes.setdefault(name, {})
        return self._task("indexCreation")

    def get_index(self, name):
        if name not in self.indexes:
            raise seed.meilisearch.errors.MeilisearchApiError("not found", SimpleNamespace(
                status_code=404, text='{"message":"x","code":"index_not_found","type":"x","link":"x"}'))
        return name

    def swap_indexes(self, params):
        a, b = params[0]["indexes"]
        self.indexes[a], self.indexes[b] = self.indexes[b], self.indexes[a]
        return self._task("indexSwap")

    def index(self, name):
        client = self

        class Idx:
            def update_settings(self, settings):
                return client._task("settingsUpdate")

            def add_documents(self, docs, primary_key=None):
                info = client._task("documentAdditionOrUpdate")
                if client.tasks[info.task_uid].status == "succeeded":
                    client.indexes[name].update({d["id"]: d for d in docs})
                return info

            def get_stats(self):
                return SimpleNamespace(number_of_documents=len(client.indexes[name]))
        return Idx()


DOCS = [{"id": f"d{i}"} for i in range(7)]


def test_vahetus_valmis_kujul_ja_vana_koristatud():
    c = FakeClient(live={"vana": {"id": "vana"}})
    assert seed.rebuild_index(c, "teosed", {}, DOCS, chunk_size=3) == 7
    assert set(c.indexes["teosed"]) == {d["id"] for d in DOCS}
    assert "teosed__uus" not in c.indexes


@pytest.mark.parametrize("kind", ["settingsUpdate", "documentAdditionOrUpdate", "indexCreation"])
def test_viga_enne_vahetust_jatab_elava_puutumata(kind):
    c = FakeClient(live={"vana": {"id": "vana"}}, fail_task_types={kind})
    with pytest.raises(RuntimeError):
        seed.rebuild_index(c, "teosed", {}, DOCS, chunk_size=3)
    assert c.indexes["teosed"] == {"vana": {"id": "vana"}}
    assert ("indexSwap", True) not in c.log


def test_vale_arv_ei_vaheta():
    c = FakeClient(live={"vana": {"id": "vana"}})
    with pytest.raises(RuntimeError, match="oodati"):
        seed.rebuild_index(_Lossy(c), "teosed", {}, DOCS, chunk_size=3)
    assert c.indexes["teosed"] == {"vana": {"id": "vana"}}


class _Lossy:
    """Meili, mis neelab ühe paki vaikselt (task õnnestub, dokumente pole)."""

    def __init__(self, inner):
        self.inner = inner
        self.dropped = False

    def __getattr__(self, attr):
        return getattr(self.inner, attr)

    def index(self, name):
        idx = self.inner.index(name)
        outer = self

        class Idx:
            update_settings = idx.update_settings
            get_stats = idx.get_stats

            def add_documents(self, docs, primary_key=None):
                if not outer.dropped:
                    outer.dropped = True
                    return outer.inner._task("documentAdditionOrUpdate")
                return idx.add_documents(docs, primary_key)
        return Idx()


def test_esmane_paigaldus_ilma_elava_indeksita():
    c = FakeClient()
    assert seed.rebuild_index(c, "teosed", {}, DOCS) == 7
    assert len(c.indexes["teosed"]) == 7 and "teosed__uus" not in c.indexes
