"""Pildiserveri ligipääsu kontroll päris GET/HEAD päringute kaudu."""

import hashlib
import hmac
import http.client
import json
import threading
import time
import builtins

import pytest
from PIL import Image

from server import image_server
from server import access_ops
from server import utils


@pytest.fixture
def image_http(tmp_path, monkeypatch):
    works = {}
    monkeypatch.setattr(image_server, 'DIRECTORY', str(tmp_path))
    monkeypatch.setattr(image_server, 'IMAGE_TOKEN_SECRET', 'http-test-secret')
    monkeypatch.setattr(utils, 'BASE_DIR', str(tmp_path))
    monkeypatch.setattr(utils, 'WORK_ID_CACHE', {})
    monkeypatch.setattr(access_ops, 'get_cached_collections', lambda: {
        'private': {'visibility': 'restricted'},
    })

    for slug, work_id, collections, shareable in (
        ('public-slug', 'pub123', [], False),
        ('private-slug', 'priv123', ['private'], False),
        ('shared-slug', 'share123', ['private'], True),
    ):
        folder = tmp_path / slug
        folder.mkdir()
        Image.new('RGB', (16, 24), 'white').save(folder / 'page.jpg')
        (folder / '_metadata.json').write_text(json.dumps({
            'id': work_id, 'slug': slug, 'collections': collections,
            'shareable': shareable,
        }), encoding='utf-8')
        works[slug] = works[work_id] = str(folder)
        utils.WORK_ID_CACHE[work_id] = str(folder)

    server = image_server.SafeThreadingHTTPServer(('127.0.0.1', 0), image_server.ImageRequestHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    def request(method, path, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=5)
        connection.request(method, path, headers=headers or {})
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        connection.close()
        return result

    yield request, works, tmp_path
    server.shutdown()
    server.server_close()
    thread.join(timeout=5)


def _signed(work_id, *, offset=3600):
    exp = int(time.time()) + offset
    sig = hmac.new(b'http-test-secret', f'image:{work_id}:{exp}'.encode(), hashlib.sha256).hexdigest()
    return f'?exp={exp}&sig={sig}'


@pytest.mark.parametrize('method', ['GET', 'HEAD'])
@pytest.mark.parametrize('suffix', ['/page.jpg', '/_thumb', '/_og', '/_thumbs/_thumb_page.jpg'])
def test_public_and_shared_images_are_accessible(image_http, method, suffix):
    request, _, _ = image_http
    for alias, cache in (('public-slug', 'public, max-age=0, must-revalidate'),
                         ('shared-slug', 'no-store')):
        status, headers, body = request(method, f'/{alias}{suffix}')
        assert status == 200
        assert headers['Cache-Control'] == cache
        assert headers['Content-Type'] == 'image/jpeg'
        assert (bool(body) if method == 'GET' else not body)


@pytest.mark.parametrize('method', ['GET', 'HEAD'])
@pytest.mark.parametrize('suffix', ['/page.jpg', '/_thumb', '/_og', '/_thumbs/_thumb_page.jpg'])
def test_private_images_require_canonical_work_token(image_http, method, suffix):
    request, _, _ = image_http
    path = f'/private-slug{suffix}'
    for query in ('', _signed('private-slug'), _signed('pub123'),
                  _signed('priv123', offset=-1)):
        status, headers, _ = request(method, path + query)
        assert status == 403
        assert headers['Cache-Control'] == 'no-store'
    status, headers, body = request(method, path + _signed('priv123'))
    assert status == 200
    assert headers['Cache-Control'] == 'no-store'
    assert (bool(body) if method == 'GET' else not body)


@pytest.mark.parametrize('method', ['GET', 'HEAD'])
def test_missing_or_malformed_metadata_denied_even_with_token(image_http, method):
    request, _, root = image_http
    folder = root / 'public-slug'
    metadata = folder / '_metadata.json'
    for value in (None, '[]', '{bad json', '{"id": 123}',
                  '{"id": "pub123", "collections": "private"}'):
        if value is None:
            metadata.unlink(missing_ok=True)
        else:
            metadata.write_text(value, encoding='utf-8')
        for path in ('/page.jpg', '/_thumb', '/_og', '/_thumbs/_thumb_page.jpg'):
            status, headers, _ = request(method, '/pub123' + path + _signed('pub123'))
            assert status == 403
            assert headers['Cache-Control'] == 'no-store'

    metadata.unlink(missing_ok=True)
    metadata.symlink_to(root / 'shared-slug' / '_metadata.json')
    status, headers, _ = request(method, '/pub123/page.jpg')
    assert status == 403
    assert headers['Cache-Control'] == 'no-store'


def test_unreadable_metadata_is_denied(image_http, monkeypatch):
    request, _, root = image_http
    original_open = builtins.open
    metadata = str(root / 'public-slug' / '_metadata.json')

    def unreadable(path, *args, **kwargs):
        if str(path) == metadata:
            raise OSError('unreadable')
        return original_open(path, *args, **kwargs)

    monkeypatch.setattr(builtins, 'open', unreadable)
    status, headers, _ = request('GET', '/pub123/page.jpg')
    assert status == 403
    assert headers['Cache-Control'] == 'no-store'


@pytest.mark.parametrize('method', ['GET', 'HEAD'])
def test_internal_paths_and_cross_work_symlinks_denied(image_http, method):
    request, _, root = image_http
    public = root / 'public-slug'
    private = root / 'private-slug'
    (root / 'config').mkdir()
    (root / 'config' / 'secret.jpg').write_bytes(b'private configuration')
    (root / '._originals').mkdir()
    (root / '._originals' / 'secret.jpg').write_bytes(b'original')
    (public / 'other.jpg').symlink_to(private / 'page.jpg')
    (public / '_thumbs').symlink_to(private, target_is_directory=True)
    for path in ('/config/secret.jpg', '/._originals/secret.jpg',
                 '/public-slug/_metadata.jpg', '/public-slug/.hidden.jpg',
                 '/.git/secret.jpg', '/_originals/secret.jpg',
                 '/public-slug/../private-slug/page.jpg',
                 '/public-slug/%2e%2e/private-slug/page.jpg',
                 '/public-slug/page%00.jpg',
                 '/public-slug/other.jpg', '/public-slug/_thumb',
                 '/public-slug/_og', '/public-slug/_thumbs/_thumb_page.jpg',
                 '/public-slug/_thumbs/_cover_v2_page.jpg'):
        status, headers, _ = request(method, path)
        assert status in (403, 404), path
        assert headers['Cache-Control'] == 'no-store', path


def test_public_image_rechecks_rights_after_metadata_change(image_http):
    request, _, root = image_http
    path = '/public-slug/page.jpg'
    status, headers, _ = request('GET', path)
    assert status == 200
    assert headers['Cache-Control'] == 'public, max-age=0, must-revalidate'
    (root / 'public-slug' / '_metadata.json').write_text(json.dumps({
        'id': 'pub123', 'collections': ['private'], 'shareable': False,
    }), encoding='utf-8')
    status, headers, _ = request('GET', path)
    assert status == 403
    assert headers['Cache-Control'] == 'no-store'


def test_conditional_request_still_checks_access(image_http):
    request, _, root = image_http
    path = '/public-slug/page.jpg'
    status, headers, _ = request('GET', path)
    assert status == 200
    for method in ('GET', 'HEAD'):
        status, cached_headers, body = request(
            method, path, {'If-Modified-Since': headers['Last-Modified']})
        assert status == 304
        assert cached_headers['Cache-Control'] == 'public, max-age=0, must-revalidate'
        assert not body
    (root / 'public-slug' / '_metadata.json').write_text(json.dumps({
        'id': 'pub123', 'collections': ['private'], 'shareable': False,
    }), encoding='utf-8')
    status, cached_headers, _ = request(
        'GET', path, {'If-Modified-Since': headers['Last-Modified']})
    assert status == 403
    assert cached_headers['Cache-Control'] == 'no-store'


@pytest.mark.parametrize('extension', ['png', 'jpeg'])
def test_page_thumbnails_keep_existing_source_formats(image_http, extension):
    request, _, root = image_http
    Image.new('RGB', (16, 24), 'white').save(root / 'public-slug' / f'other.{extension}')
    status, headers, body = request(
        'GET', f'/public-slug/_thumbs/_thumb_other.{extension}')
    assert status == 200
    assert headers['Content-Type'] == 'image/jpeg'
    assert body.startswith(b'\xff\xd8')


@pytest.mark.parametrize('method', ['GET', 'HEAD'])
def test_existing_internal_and_cached_cover_files_cannot_bypass_access(image_http, method):
    request, _, root = image_http
    private = root / 'private-slug'
    # Kõigepealt tekivad päris cache-failid õiguspärase päringu kaudu.
    for suffix in ('/_thumb', '/_og', '/_thumbs/_thumb_page.jpg'):
        assert request('GET', '/priv123' + suffix + _signed('priv123'))[0] == 200
    for cached in (private / '_thumbs').iterdir():
        status, headers, _ = request(method, '/priv123/_thumbs/' + cached.name)
        assert status == 403
        assert headers['Cache-Control'] == 'no-store'

    original = root / '._originals' / 'priv123'
    original.mkdir(parents=True)
    (original / 'page.jpg').write_bytes((private / 'page.jpg').read_bytes())
    for query in ('', _signed('priv123')):
        status, headers, _ = request(method, '/._originals/priv123/page.jpg' + query)
        assert status == 403
        assert headers['Cache-Control'] == 'no-store'


@pytest.mark.parametrize('method', ['GET', 'HEAD'])
def test_internal_work_alias_cannot_bypass_directory_restriction(image_http, method):
    request, _, root = image_http
    internal = root / 'config'
    internal.mkdir()
    (internal / '_metadata.json').write_text(json.dumps({
        'id': 'internal123', 'slug': 'innocent-alias', 'collections': [],
    }), encoding='utf-8')
    (internal / 'page.jpg').write_bytes(b'internal image')
    for alias in ('config', 'internal123', 'innocent-alias'):
        status, headers, _ = request(method, f'/{alias}/page.jpg')
        assert status == 403
        assert headers['Cache-Control'] == 'no-store'
