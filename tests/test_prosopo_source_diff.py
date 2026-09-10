"""`source-diff` otsib ajaloost ANKRU RÄSIGA commiti, mitte vanemat.

Kui commiti ei leidu (ajalugu kärbitud 50 commiti peale, kaart taastatud), on
vastus aus `found: false` — mitte vale diff.
"""
import json
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.prosopo_biography_fields import BIOGRAPHY_EN, BIOGRAPHY_ET, SRC_EN, text_hash  # noqa: E402

VANA_ET = "Vana eestikeelne tekst."
UUS_ET = "Uus eestikeelne tekst."


@pytest.fixture
def editor_token(login):
    return login("editor", "editorpass")


@pytest.fixture
def contributor_token(login):
    return login("contrib", "contribpass")


def _ajalugu(*args, **kwargs):
    return [
        {"hash": "cccccccc", "full_hash": "cccccccc11", "date": "2026-09-09T00:00:00"},
        {"hash": "bbbbbbbb", "full_hash": "bbbbbbbb11", "date": "2026-09-05T00:00:00"},
        {"hash": "aaaaaaaa", "full_hash": "aaaaaaaa11", "date": "2026-09-01T00:00:00"},
    ]


def _commit_sisu(rel_path, commit):
    tekstid = {"cccccccc11": UUS_ET, "bbbbbbbb11": VANA_ET, "aaaaaaaa11": "Veel vanem."}
    return json.dumps({"id": "vutt:Pabc", BIOGRAPHY_ET: tekstid[commit]})


def test_leiab_ankru_rasiga_commiti(client, editor_token):
    person = {"id": "vutt:Pabc", BIOGRAPHY_ET: UUS_ET, BIOGRAPHY_EN: "English.",
              SRC_EN: {"hash": text_hash(VANA_ET), "at": "2026-09-05T00:00:00+00:00"}}
    with patch("server.prosopography.router.get_person", return_value=person), \
         patch("server.prosopography.router.get_file_git_history", side_effect=_ajalugu), \
         patch("server.prosopography.router.get_file_at_commit", side_effect=_commit_sisu):
        resp = client.get("/prosopography/vutt%3APabc/source-diff",
                          params={"field": BIOGRAPHY_EN},
                          headers={"Authorization": f"Bearer {editor_token}"})
    keha = resp.json()
    assert resp.status_code == 200
    assert keha["found"] is True
    assert keha["text"] == VANA_ET
    assert keha["commit"] == "bbbbbbbb"


def test_ei_leia_annab_ausa_vastuse(client, editor_token):
    person = {"id": "vutt:Pabc", BIOGRAPHY_ET: UUS_ET, BIOGRAPHY_EN: "English.",
              SRC_EN: {"hash": "deadbeefcafe", "at": "2026-01-01T00:00:00+00:00"}}
    with patch("server.prosopography.router.get_person", return_value=person), \
         patch("server.prosopography.router.get_file_git_history", side_effect=_ajalugu), \
         patch("server.prosopography.router.get_file_at_commit", side_effect=_commit_sisu):
        resp = client.get("/prosopography/vutt%3APabc/source-diff",
                          params={"field": BIOGRAPHY_EN},
                          headers={"Authorization": f"Bearer {editor_token}"})
    assert resp.json() == {"found": False, "commit": None, "date": None, "text": None}


def test_ankruta_vali_annab_found_false(client, editor_token):
    person = {"id": "vutt:Pabc", BIOGRAPHY_EN: "English.", SRC_EN: None}
    with patch("server.prosopography.router.get_person", return_value=person):
        resp = client.get("/prosopography/vutt%3APabc/source-diff",
                          params={"field": BIOGRAPHY_EN},
                          headers={"Authorization": f"Bearer {editor_token}"})
    assert resp.json()["found"] is False


def test_tundmatu_vali_annab_400(client, editor_token):
    resp = client.get("/prosopography/vutt%3APabc/source-diff",
                      params={"field": "notes"},
                      headers={"Authorization": f"Bearer {editor_token}"})
    assert resp.status_code == 400


def test_contributor_ei_paase_ligi(client, contributor_token):
    resp = client.get("/prosopography/vutt%3APabc/source-diff",
                      params={"field": BIOGRAPHY_EN},
                      headers={"Authorization": f"Bearer {contributor_token}"})
    assert resp.status_code == 401
