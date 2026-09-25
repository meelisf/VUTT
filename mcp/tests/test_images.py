import base64

import httpx
import pytest
from mcp.server.mcpserver.exceptions import ToolError

from vutt_mcp.client import VuttClient
from vutt_mcp.config import Settings
from vutt_mcp.errors import VuttError, VuttNotFound, VuttTemporaryError
from vutt_mcp.server import build_server

# One transparent PNG pixel; verifies binary preservation through MCP serialization.
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=')


async def test_image_returned_as_mcp_content():
    requests = []

    def handler(request):
        requests.append(request)
        if request.method == 'POST':
            import json
            body = json.loads(request.content)
            assert body['attributesToRetrieve'] == ['lehekylje_pilt']
            assert 'lehekylje_number >= 2' in str(body)
            return httpx.Response(200, json={'hits': [{'lehekylje_pilt': 'teos/üks #2.png'}]})
        assert request.url.path == '/api/images/teos/üks #2.png'
        assert 'authorization' not in request.headers
        return httpx.Response(200, content=PNG, headers={'content-type': 'image/png'})

    client = VuttClient(Settings('https://x.test', 'secret'), httpx.MockTransport(handler))
    result = await build_server(client, 'https://x.test').call_tool('get_page_image', {'work_id': 'abc', 'page': 2})
    assert not result.is_error
    assert result.structured_content is None
    assert result.content[0].text.endswith('/work/abc/2')
    picture = result.content[1]
    assert picture.type == 'image'
    assert picture.mime_type == 'image/png'
    assert base64.b64decode(picture.data) == PNG
    assert len(requests) == 2


@pytest.mark.parametrize('page,hits,message', [(0, [], 'vähemalt 1'), (1, [], 'ei leitud'), (1, [{}], 'pilditee')])
async def test_missing_image(page, hits, message):
    class Client:
        def meili_search(self, body):
            assert page > 0
            return {'hits': hits}
    with pytest.raises(ToolError, match=message):
        await build_server(Client(), 'https://x.test').call_tool('get_page_image', {'work_id': 'abc', 'page': page})


@pytest.mark.parametrize('status,mime,content,error', [
    (404, 'text/plain', b'missing', VuttNotFound),
    (403, 'text/plain', b'forbidden', VuttError),
    (503, 'text/plain', b'down', VuttTemporaryError),
    (200, 'text/html', b'<html/>', VuttError),
    (200, 'image/png', b'', VuttError),
])
def test_image_http_errors(status, mime, content, error, monkeypatch):
    monkeypatch.setattr(VuttClient, '_sleep_for_retry', lambda *args: None)
    client = VuttClient(Settings('https://x.test', 'secret'), httpx.MockTransport(
        lambda request: httpx.Response(status, content=content, headers={'content-type': mime})))
    with pytest.raises(error):
        client.image_get('work/page.png')


@pytest.mark.parametrize('path', ['../secret', 'work/../../secret', 'work\\page.png', 'https://other.test/image'])
def test_invalid_image_path(path):
    def handler(request):
        pytest.fail('Invalid paths must not make HTTP requests')
    client = VuttClient(Settings('https://x.test', 'secret'), httpx.MockTransport(handler))
    with pytest.raises(VuttError):
        client.image_get(path)
