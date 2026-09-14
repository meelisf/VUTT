"""Töökollektsiooni õigused (#354).

Kaks lugemispredikaati EI OLE samad: `can_read_work` lubab `shareable`-teost
(lingiga avatav), tenant-tokeni filter (`meilisearch_ops.py`) mitte.
Otsingufiltrisse minev ID-loend peab kasutama OTSINGUS-NÄHTAVUSE predikaati,
muidu näitab kogu arv teost, mille sirvimine jääb tühjaks.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server.work_sets_access as acc

AVALIK = {"id": "w1", "collections": ["academia-gustaviana"]}
PIIRATUD = {"id": "w2", "collections": ["vennastekoguduse-materjalid"]}
JAGATAV = {"id": "w3", "collections": ["vennastekoguduse-materjalid"], "shareable": True}

WS = {"id": "ws_1", "visibility": "members", "status": "active",
      "access": {"mari": "manager", "juri": "viewer"}, "works": ["w1", "w2", "w3"]}


def _meta(monkeypatch):
    monkeypatch.setattr(acc, "load_work_metadata_by_id",
                        lambda wid: {"w1": AVALIK, "w2": PIIRATUD, "w3": JAGATAV}[wid])
    # `is_work_public` loeb collections.json-i vahemälust; anname testile
    # selgesõnalise nähtavuse, et tulemus ei sõltuks tootmiskonfiguratsioonist.
    monkeypatch.setattr(acc, "is_work_public",
                        lambda meta: "academia-gustaviana" in (meta.get("collections") or []))


def test_jagatav_piiratud_teos_ei_lahe_otsingunimekirja(monkeypatch):
    _meta(monkeypatch)
    kasutaja = {"username": "juri", "role": "contributor", "allowed_collections": []}
    assert acc.search_visible_work_ids(WS, kasutaja) == ["w1"]


def test_lubatud_kogu_teos_on_nahtav(monkeypatch):
    _meta(monkeypatch)
    kasutaja = {"username": "juri", "role": "contributor",
                "allowed_collections": ["vennastekoguduse-materjalid"]}
    assert acc.search_visible_work_ids(WS, kasutaja) == ["w1", "w2", "w3"]


def test_vaataja_ei_halda_haldur_haldab():
    assert acc.can_view_set(WS, {"username": "juri", "role": "contributor"})
    assert not acc.can_manage_set(WS, {"username": "juri", "role": "contributor"})
    assert acc.can_manage_set(WS, {"username": "mari", "role": "contributor"})


def test_admin_naeb_ja_haldab_koiki():
    admin = {"username": "x", "role": "admin"}
    assert acc.can_view_set(WS, admin) and acc.can_manage_set(WS, admin)


def test_avalikku_kogu_naeb_autentimata():
    avalik = dict(WS, visibility="public")
    assert acc.can_view_set(avalik, None)
    assert not acc.can_view_set(WS, None)
