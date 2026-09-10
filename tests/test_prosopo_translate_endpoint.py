"""Tõlke-endpoint: roll, valideerimine, rate-limit kasutaja järgi.

Rate-limit EI TOHI olla IP-põhine: ülikooli pöördproksi tõttu jõuavad eri
kliendid serverini sama IP-ga (vt `config.py` kommentaar) — IP-võti tähendaks
ühist eelarvet kõigile toimetajatele.
"""
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


@pytest.fixture
def editor_token(login):
    return login("editor", "editorpass")


@pytest.fixture
def contributor_token(login):
    return login("contrib", "contribpass")


def _keha(**extra):
    return {"source_lang": "et", "target_lang": "en", "text": "Elulugu.", **extra}


def test_contributor_ei_paase_ligi(client, contributor_token):
    resp = client.post("/prosopography/translate", json=_keha(),
                       headers={"Authorization": f"Bearer {contributor_token}"})
    assert resp.status_code == 401


def test_editor_saab_tolke(client, editor_token):
    with patch("server.prosopography.router.translate",
               return_value=("English biography.", {"total_tokens": 320})):
        resp = client.post("/prosopography/translate", json=_keha(),
                           headers={"Authorization": f"Bearer {editor_token}"})
    assert resp.status_code == 200
    assert resp.json()["text"] == "English biography."


def test_samad_keeled_annavad_400(client, editor_token):
    resp = client.post("/prosopography/translate", json=_keha(target_lang="et"),
                       headers={"Authorization": f"Bearer {editor_token}"})
    assert resp.status_code == 400


def test_pakkuja_viga_annab_502_ilma_sisemise_infota(client, editor_token):
    from server.text_translate import TranslateError
    with patch("server.prosopography.router.translate",
               side_effect=TranslateError("Tõlkepäring ebaõnnestus: HTTP 500 INTERNAL")):
        resp = client.post("/prosopography/translate", json=_keha(),
                           headers={"Authorization": f"Bearer {editor_token}"})
    assert resp.status_code == 502
    assert "Tõlkepäring ebaõnnestus" in resp.json()["detail"]


def test_rate_limit_kaib_kasutajanime_mitte_ip_jargi(client, editor_token):
    nahtud = []

    def _fake(key, endpoint):
        nahtud.append((key, endpoint))
        return False, 42

    with patch("server.prosopography.router.check_rate_limit", side_effect=_fake):
        resp = client.post("/prosopography/translate", json=_keha(),
                           headers={"Authorization": f"Bearer {editor_token}"})
    assert resp.status_code == 429
    assert resp.headers["Retry-After"] == "42"
    key, endpoint = nahtud[0]
    assert endpoint == "/prosopography/translate"
    assert "." not in key          # kasutajanimi, mitte IP-aadress


def test_rate_limit_kirje_on_konfiguratsioonis():
    # Ilma kirjeta laseb `check_rate_limit` tundmatu endpointi PIIRANGUTA läbi
    # (`rate_limit.py:112`) — see test on selle vaikse augu valvur.
    from server.config import RATE_LIMITS
    assert RATE_LIMITS["/prosopography/translate"] == (60, 3600)
