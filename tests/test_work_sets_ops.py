"""Töökollektsiooni salvestuskiht (#354).

Liikmesus on autoriteetne fail, mitte tuletatud read-model: iga muudatus
commititakse (ADR 0040) ja `revision` kaitseb samaaegse ülekirjutamise eest.
"""
import json
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server.work_sets_ops as ops


@pytest.fixture
def kaust(tmp_path, monkeypatch):
    monkeypatch.setattr(ops, "WORK_SETS_DIR", str(tmp_path / "work_sets"))
    monkeypatch.setattr(ops, "WORK_SET_MAX_MEMBERS", 3)
    kirjutised = []

    def fake_save(path, data, username, message=None):
        # Git-kutse on asendatud, aga fail PEAB tekkima: iga järgnev toiming
        # loeb ta uuesti kettalt (loe-muuda-salvesta). Mock, mis ei kirjuta,
        # muudaks testid mõttetuks.
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        kirjutised.append((path, data, username, message))
        return {"success": True}

    monkeypatch.setattr(ops, "save_config_with_git", fake_save)
    monkeypatch.setattr(ops, "delete_file_from_git", lambda path, msg, username: True)
    return {"tmp": tmp_path, "kirjutised": kirjutised}


def test_loomine_annab_id_ilma_looja_access_kirjeta(kaust):
    ws = ops.create_work_set({"et": "Fischer", "en": ""}, {"et": "", "en": ""}, "mari")
    assert ws["id"].startswith("ws_")
    # Looja EI saa automaatset access-kirjet: kogusid loovad admin+, kelle
    # haldusõigus tuleneb rollist (ADR 0043 p5). `created_by` jääb auditiinfoks.
    assert ws["access"] == {}
    assert ws["created_by"] == "mari"
    assert ws["revision"] == 1
    assert ws["visibility"] == "members" and ws["status"] == "active"
    assert ws["works"] == []


def test_vananenud_revision_ei_kirjuta_ule(kaust):
    ws = ops.create_work_set({"et": "Fischer", "en": ""}, {}, "mari")
    ops.mutate_members(ws["id"], ["a"], [], "mari", expected_revision=1)
    with pytest.raises(ops.WorkSetConflict):
        ops.mutate_members(ws["id"], ["b"], [], "mari", expected_revision=1)


def test_lisamine_on_idempotentne_ja_revision_kasvab(kaust):
    ws = ops.create_work_set({"et": "F", "en": ""}, {}, "mari")
    r1 = ops.mutate_members(ws["id"], ["a", "a"], [], "mari", expected_revision=1)
    assert r1["works"] == ["a"] and r1["revision"] == 2
    r2 = ops.mutate_members(ws["id"], ["a"], [], "mari", expected_revision=2)
    assert r2["works"] == ["a"] and r2["revision"] == 2, "muutusteta toiming on no-op"


def test_lae_uletamine_ei_lisa_osaliselt(kaust):
    ws = ops.create_work_set({"et": "F", "en": ""}, {}, "mari")
    ops.mutate_members(ws["id"], ["a", "b"], [], "mari", expected_revision=1)
    with pytest.raises(ops.WorkSetLimit):
        ops.mutate_members(ws["id"], ["c", "d"], [], "mari", expected_revision=2)
    assert ops.load_work_set(ws["id"])["works"] == ["a", "b"]


def test_tundmatu_liikme_eemaldamine_on_noop_mitte_viga(kaust):
    ws = ops.create_work_set({"et": "F", "en": ""}, {}, "mari")
    ops.mutate_members(ws["id"], ["a"], [], "mari", expected_revision=1)
    r = ops.mutate_members(ws["id"], [], ["kustutatud-teos"], "mari", expected_revision=2)
    assert r["works"] == ["a"]
