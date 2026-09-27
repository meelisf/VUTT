"""S27-06: OCR-serveri SSH ühendus kontrollib hostivõtit known_hosts-i vastu.
Puuduv või erinev võti → ühendust ei kasutata ega autendita (fail closed)."""
import types

import paramiko
import pytest

from server.upload import ocr_client

HOST = "172.17.120.146"


@pytest.fixture(scope="module")
def keys():
    return paramiko.RSAKey.generate(1024), paramiko.RSAKey.generate(1024)


def _known_hosts(tmp_path, host, key):
    hk = paramiko.HostKeys()
    if key is not None:
        hk.add(host, key.get_name(), key)
    path = tmp_path / "known_hosts"
    hk.save(str(path))
    return str(path)


class FakeTransport:
    def __init__(self, server_key):
        self.server_key, self.auth = server_key, []
        self.closed = False
    def get_remote_server_key(self):
        return self.server_key
    def auth_publickey(self, user, key):
        self.auth.append(user)
    def close(self):
        self.closed = True


def test_klappiv_voti_lubatakse(tmp_path, keys):
    good, _ = keys
    ocr_client.verify_host_key(FakeTransport(good), HOST, _known_hosts(tmp_path, HOST, good))


def test_erinev_voti_keeldutakse(tmp_path, keys):
    good, evil = keys
    with pytest.raises(ocr_client.HostKeyError, match="erineb"):
        ocr_client.verify_host_key(FakeTransport(evil), HOST, _known_hosts(tmp_path, HOST, good))


def test_puuduv_kirje_ja_fail_keeldutakse(tmp_path, keys):
    good, _ = keys
    with pytest.raises(ocr_client.HostKeyError, match="pole usaldatud"):
        ocr_client.verify_host_key(FakeTransport(good), HOST, _known_hosts(tmp_path, "10.0.0.9", good))
    with pytest.raises(ocr_client.HostKeyError, match="pole usaldatud"):
        ocr_client.verify_host_key(FakeTransport(good), HOST, str(tmp_path / "puudub"))


def test_ühendus_ei_autendi_ega_jää_alles_vale_võtmega(tmp_path, keys, monkeypatch):
    good, evil = keys
    fake = FakeTransport(evil)
    monkeypatch.setattr(paramiko, "Transport", lambda sock: types.SimpleNamespace(
        set_keepalive=lambda n: None, connect=lambda: None,
        get_remote_server_key=fake.get_remote_server_key, auth_publickey=fake.auth_publickey,
        close=fake.close, is_active=lambda: True))
    monkeypatch.setattr(ocr_client.socket, "create_connection", lambda addr, timeout=None: object())
    monkeypatch.setattr(ocr_client, "OCR_KNOWN_HOSTS", _known_hosts(tmp_path, HOST, good))
    ocr_client.ssh_connections.clear()
    with pytest.raises(ocr_client.HostKeyError):
        ocr_client.get_or_create_ssh("u1", host=HOST, load_key_func=lambda: object())
    assert fake.auth == [] and fake.closed is True
    assert "u1" not in ocr_client.ssh_connections
