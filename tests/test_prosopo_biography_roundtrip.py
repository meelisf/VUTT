"""Kolm välja + ankur peavad täisringi üle elama: PUT → fail → GET.

Üksiktestid katavad tükid; see katab lepingu. Tüüpiline auk, mille see püüab:
väli, mis kirjutusteel salvestub, aga lugemisteel filtreeritakse välja
(vrd #237 `SECRET_FIELDS`).
"""
import json
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.prosopography import person_crud  # noqa: E402
from server.prosopo_biography_fields import (  # noqa: E402
    AA_RAW, BIOGRAPHY_EN, BIOGRAPHY_ET, SRC_EN, text_hash,
)

PERSON_ID = "vutt:Pabc123"
UPDATED_AT = "2026-09-10T10:00:00+00:00"


@pytest.fixture
def editor_token(login):
    return login("editor", "editorpass")


@pytest.fixture
def uus_isik(tmp_path, monkeypatch):
    """Päris kaardifail ajutises kaustas; git asendub tavalise kirjutusega.

    Fikstuur on siin, mitte `conftest.py`-s: ainus tarbija on see fail ja
    jagatud conftesti laiendamine tähendaks kolmandat auth/FS-mustrit
    (`backend_env` ei seadista prosopograafia kausta).
    """
    prosopo_dir = tmp_path / "prosopography"
    prosopo_dir.mkdir()
    monkeypatch.setattr(person_crud.state, "PROSOPOGRAPHY_DIR", str(prosopo_dir))

    def _save(path, content, username, message=None, **kw):
        Path(path).write_text(content, encoding="utf-8")

    monkeypatch.setattr(person_crud.state, "save_with_git", _save)
    monkeypatch.setattr(person_crud, "sync_from_facade", lambda: None)
    monkeypatch.setattr(person_crud, "fill_person_labels_from_registry", lambda p: None)
    monkeypatch.setattr(person_crud, "_indices", lambda: type(
        "I", (), {"_update_index_entry": staticmethod(lambda p: None),
                  "_update_aliases_entry": staticmethod(lambda p: None)})())

    (prosopo_dir / "abc123.json").write_text(json.dumps({
        "id": PERSON_ID, "updated_at": UPDATED_AT,
        "name": {"label": "Test"},
    }), encoding="utf-8")
    return PERSON_ID, UPDATED_AT


def test_kolm_valja_ja_ankur_elavad_taisringi_ule(client, editor_token, uus_isik):
    person_id, updated_at = uus_isik
    auth = {"Authorization": f"Bearer {editor_token}"}

    resp = client.put(f"/prosopography/{person_id}", headers=auth, json={
        "updated_at": updated_at,
        BIOGRAPHY_ET: "Eestikeelne elulugu.",
        BIOGRAPHY_EN: "English biography.",
        AA_RAW: "154. Lünaeus, Emundus.",
        "_confirm_translation": [BIOGRAPHY_EN],
    })
    assert resp.status_code == 200, resp.text

    # Loe UUESTI API kaudu — mitte kirjutuse vastusest, vaid kettalt.
    loetud = client.get(f"/prosopography/{person_id}").json()
    assert loetud[BIOGRAPHY_ET] == "Eestikeelne elulugu."
    assert loetud[BIOGRAPHY_EN] == "English biography."
    assert loetud[AA_RAW] == "154. Lünaeus, Emundus."
    assert loetud[SRC_EN]["hash"] == text_hash("Eestikeelne elulugu.")
    # Ajutine võti EI tohi kaardile jõuda.
    assert "_confirm_translation" not in loetud
    # Pärandvälja ei ole enam.
    assert "biography" not in loetud
