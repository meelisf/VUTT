"""Upload-viisardi metaandmete säilimine: aastaväli ja välised viited.

Kaks varem katki läinud asja:
  1. Samm 1 aastalahtrisse kirjutatud vahemik ("1634-1653") kadus impordil
     (`int()` viskas ValueError'i → teos sai aastaks 0).
  2. `external_url` / `ester_id` kadusid samm 4 PATCH-il vaikides (200 OK,
     aga allow-list neid ei tundnud).
"""
import os
import tempfile

import pytest

import server.upload_ops as upload_ops
import server.upload.state as upload_state
from server.utils import derive_year_fields


@pytest.fixture
def staging(monkeypatch):
    """Isoleeritud uploads/ kaust — ei puutu päris state'i."""
    tmp = tempfile.mkdtemp()
    monkeypatch.setattr(upload_ops, 'UPLOADS_DIR', tmp)
    monkeypatch.setattr(upload_state, 'UPLOADS_DIR', tmp)
    return tmp


# --- 1. aastaväli -----------------------------------------------------------

@pytest.mark.parametrize("raw,expected", [
    ('', (None, None)),
    ('1653', (1653, None)),
    (1653, (1653, None)),
    ('1634-1653', (1643, '1634-1653')),
    ('1634–1653', (1643, '1634–1653')),
    ('ca. 1650', (1650, 'ca. 1650')),
    ('17. saj', (1650, '17. saj')),
    ('teadmata', (None, 'teadmata')),
])
def test_derive_year_fields(raw, expected):
    assert derive_year_fields(raw) == expected


def test_derive_year_fields_saastab_olemasoleva_kuva():
    """Kui `year_display` on juba käsitsi paigas, ei tuletata seda uuesti."""
    assert derive_year_fields(1643, 'anno MDCXLIII') == (1643, 'anno MDCXLIII')


def test_derive_year_fields_kuva_ilma_kasutatava_aastata():
    """Kuva olemas, number puudub → number tuletatakse kuvast."""
    assert derive_year_fields('', '1634-1653') == (1643, '1634-1653')


# --- 2. PATCH allow-list ----------------------------------------------------

def test_update_upload_meta_sailitab_valised_viited(staging):
    state = upload_ops.create_upload(
        {'title': 'Test', 'year': '1634-1653', 'slug': 'test'}, 'mf'
    )
    uid = state['id']

    assert upload_ops.update_upload_meta(uid, {
        'external_url': 'https://dspace.ut.ee/handle/1',
        'ester_id': '1234567',
    })

    meta = upload_ops.get_upload(uid)['meta']
    assert meta['external_url'] == 'https://dspace.ut.ee/handle/1'
    assert meta['ester_id'] == '1234567'


def test_update_upload_meta_ei_lase_labi_tundmatut_valja(staging):
    state = upload_ops.create_upload({'title': 'T', 'year': '1650', 'slug': 't'}, 'mf')
    uid = state['id']
    upload_ops.update_upload_meta(uid, {'slug': 'kaaperdatud', 'suvaline': 1})
    meta = upload_ops.get_upload(uid)['meta']
    assert meta['slug'].startswith('t-')
    assert 'suvaline' not in meta
