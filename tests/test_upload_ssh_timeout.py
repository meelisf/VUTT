"""
Regressioonitest: poll_and_sync_thumbs / get_or_create_ssh ei tohi blokeerida
sünkroonselt minuteid, kui OCR-server on kättesaamatu.

Taust (2026-06-13 outage): admin_upload_status (async def) kutsus
poll_and_sync_thumbs otse event-loopil; paramiko.Transport((host, 22)) tegi
TCP-connecti ilma timeoutita (~130 s, kui host maas) → kogu uvicorn event-loop
külmus → KÕIK API-päringud rippusid ("Loading bookshelf" igavesti).

Parandus: get_or_create_ssh kasutab socket.create_connection(timeout=...) →
surnud host annab vea sekunditega, mitte minutitega.
"""
import sys
import types
import pytest


@pytest.fixture
def fake_paramiko(monkeypatch):
    """Asenda paramiko mooduliga, mis jälgib, kuidas Transport luuakse."""
    created = {}

    class FakeTransport:
        def __init__(self, sock_or_addr):
            created['arg'] = sock_or_addr
        def set_keepalive(self, n): pass
        def connect(self): pass
        def auth_publickey(self, user, key): pass
        def is_active(self): return True
        def close(self): pass

    fake = types.ModuleType('paramiko')
    fake.Transport = FakeTransport
    monkeypatch.setitem(sys.modules, 'paramiko', fake)
    return created


def test_get_or_create_ssh_kasutab_piiratud_connect_timeouti(fake_paramiko, monkeypatch):
    from server import upload_ops
    from server.upload import ocr_client

    # Tühjenda cache, et test looks uue ühenduse
    upload_ops._ssh_connections.clear()
    monkeypatch.setattr(upload_ops, '_load_ssh_key', lambda: object())

    calls = {}

    def spy_create_connection(addr, timeout=None, *a, **kw):
        calls['addr'] = addr
        calls['timeout'] = timeout
        # Ära tee päris võrguühendust
        return types.SimpleNamespace(close=lambda: None)

    # socket.create_connection jookseb nüüd ocr_client-moodulis (get_or_create_ssh
    # kolis sinna); patchi seal, kus kõne päriselt toimub.
    monkeypatch.setattr(ocr_client.socket, 'create_connection', spy_create_connection)

    upload_ops.get_or_create_ssh('test-upload')

    # Transport peab saama socketi (mitte (host, port) tuple) — st socket
    # loodi create_connection'iga, kus timeout on bounded
    assert calls.get('addr') == (upload_ops.OCR_SERVER_HOST, 22)
    assert calls.get('timeout') is not None, "connect ilma timeoutita → minutite-pikkune blokk surnud hostil"
    assert 0 < calls['timeout'] <= 30, f"connect-timeout peab olema lühike, oli {calls['timeout']}"

    upload_ops._ssh_connections.clear()
