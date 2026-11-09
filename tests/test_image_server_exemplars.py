"""Pildiserver: eksemplari pildid (ADR 0079 p 2). Sama teose ja õiguse kontroll
mis lehepildil; lähtefaile, staging'ut ega manifesti ei serveerita."""

import hashlib
import hmac
import http.client
import json
import threading
import time
import urllib.parse

import pytest
from PIL import Image

from server import access_ops, image_server, utils

EID = "a1b2c3"
IMG = "x1y2z3"


@pytest.fixture
def http_get(tmp_path, monkeypatch):
    monkeypatch.setattr(image_server, 'DIRECTORY', str(tmp_path))
    monkeypatch.setattr(image_server, 'IMAGE_TOKEN_SECRET', 'ex-secret')
    monkeypatch.setattr(utils, 'BASE_DIR', str(tmp_path))
    monkeypatch.setattr(utils, 'WORK_ID_CACHE', {})
    monkeypatch.setattr(access_ops, 'get_cached_collections', lambda: {
        'private': {'visibility': 'restricted'}})

    for slug, work_id, collections in (('1640-liefflä-ab12cd', 'pub123', []),
                                       ('private-slug', 'priv123', ['private'])):
        folder = tmp_path / slug
        ex = folder / '_exemplars' / EID
        (ex / '_imports' / 'q1q1q1').mkdir(parents=True)
        Image.new('RGB', (16, 24), 'white').save(ex / f'{IMG}.jpg')
        Image.new('RGB', (16, 24), 'white').save(ex / f'{IMG}.orig.png')
        Image.new('RGB', (16, 24), 'white').save(ex / '_imports' / 'q1q1q1' / f'{IMG}.jpg')
        (ex / 'images.json').write_text('{}', encoding='utf-8')
        (folder / '_metadata.json').write_text(json.dumps(
            {'id': work_id, 'collections': collections}), encoding='utf-8')
        utils.WORK_ID_CACHE[work_id] = str(folder)

    server = image_server.SafeThreadingHTTPServer(('127.0.0.1', 0), image_server.ImageRequestHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    def get(path):
        conn = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=5)
        conn.request('GET', urllib.parse.quote(path, safe='/?&='))
        resp = conn.getresponse()
        out = resp.status, resp.read()
        conn.close()
        return out

    yield get, tmp_path
    server.shutdown()
    server.server_close()
    thread.join(timeout=5)


def _signed(work_id):
    exp = int(time.time()) + 3600
    sig = hmac.new(b'ex-secret', f'image:{work_id}:{exp}'.encode(), hashlib.sha256).hexdigest()
    return f'?exp={exp}&sig={sig}'


def test_eksemplaripilt_serveeritakse(http_get):
    get, _ = http_get
    status, body = get(f'/pub123/_exemplars/{EID}/{IMG}.jpg')
    assert status == 200 and body[:3] == b'\xff\xd8\xff'


def test_eksemplari_pisipilt_luuakse(http_get):
    get, root = http_get
    status, _ = get(f'/pub123/_exemplars/{EID}/_thumbs/_thumb_{IMG}.jpg')
    assert status == 200
    assert (root / '1640-liefflä-ab12cd' / '_exemplars' / EID / '_thumbs' / f'_thumb_{IMG}.jpg').exists()


def test_eksemplaripilt_taptahtedega_kaustas(http_get):
    get, _ = http_get
    assert get(f'/1640-liefflä-ab12cd/_exemplars/{EID}/{IMG}.jpg')[0] == 200


@pytest.mark.parametrize('suffix', [f'/_exemplars/{EID}/{IMG}.jpg',
                                    f'/_exemplars/{EID}/_thumbs/_thumb_{IMG}.jpg'])
def test_mitteavalik_ilma_tokenita_403(http_get, suffix):
    get, _ = http_get
    assert get(f'/private-slug{suffix}')[0] == 403
    assert get(f'/private-slug{suffix}{_signed("pub123")}')[0] == 403


@pytest.mark.parametrize('suffix', [f'/_exemplars/{EID}/{IMG}.jpg',
                                    f'/_exemplars/{EID}/_thumbs/_thumb_{IMG}.jpg'])
def test_mitteavalik_tokeniga_200(http_get, suffix):
    get, _ = http_get
    assert get(f'/private-slug{suffix}{_signed("priv123")}')[0] == 200


@pytest.mark.parametrize('path', [f'/_exemplars/{EID}/{IMG}.orig.png',
                                  f'/_exemplars/{EID}/_imports/q1q1q1/{IMG}.jpg',
                                  f'/_exemplars/{EID}/images.json',
                                  f'/_exemplars/{EID}/_imports/{IMG}.jpg',
                                  f'/_exemplars/{EID}/_thumbs/_thumb_{IMG}.orig.png'])
def test_originaali_ja_importi_ei_serveerita(http_get, path):
    get, _ = http_get
    assert get(f'/pub123{path}')[0] == 403


@pytest.mark.parametrize('path', ['/_exemplars/../x.jpg', '/_exemplars/ABC123/x1y2z3.jpg',
                                  f'/_exemplars/{EID}/ABC123.jpg', f'/_exemplars/{EID}/x1y2z3a.jpg',
                                  f'/_exemplars/a1b2c3d/{IMG}.jpg', f'/_exemplars/{EID}/{IMG}.png'])
def test_vigane_id_403(http_get, path):
    get, _ = http_get
    assert get(f'/pub123{path}')[0] == 403


def test_kaanepilt_ei_naita_eksemplaripilti(http_get):
    get, _ = http_get
    assert get('/pub123/_thumb')[0] == 404
