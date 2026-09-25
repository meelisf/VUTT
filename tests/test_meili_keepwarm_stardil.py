"""Keep-warm peab indekseerimisraja soojendama kohe stardil, mitte 2 h pärast.

Restardi järel on Meili külm: esimene kirjutus kestis 85 s (upload'i import
38 lk, 2026-09-25), sest `_keepwarm_loop` alustas intervalli loendust
käivitushetkest ja esimene soojendav sünk oleks tulnud alles 7200 s pärast.
"""
import pytest

from server import meilisearch_ops


class _Peatus(Exception):
    pass


def test_esimene_ring_teeb_soojendava_sungi(tmp_path, monkeypatch):
    teos = tmp_path / "teos-abc"
    teos.mkdir()
    (teos / "_metadata.json").write_text("{}")

    sunkitud = []
    monkeypatch.setattr(meilisearch_ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(meilisearch_ops, "_warm_dashboard_searches", lambda: None)
    monkeypatch.setattr(meilisearch_ops, "sync_work_to_meilisearch", sunkitud.append)

    def peata(_):
        raise _Peatus

    monkeypatch.setattr(meilisearch_ops.time, "sleep", peata)

    with pytest.raises(_Peatus):
        meilisearch_ops._keepwarm_loop()

    assert sunkitud == ["teos-abc"]
