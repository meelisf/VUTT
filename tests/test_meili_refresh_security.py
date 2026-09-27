"""Otsingutokeni uuendamine järgib sama sessioonikontrolli kui muu API."""
from datetime import datetime, timedelta


def test_refresh_rejects_expired_session_before_cleanup(client, backend_env, monkeypatch):
    from server import meilisearch_ops
    auth = backend_env['auth']
    token = auth.create_session({'username': 'editor', 'role': 'editor', 'allowed_collections': []})
    with auth._sessions_lock:
        auth.sessions[token]['created_at'] = (datetime.now() - timedelta(hours=25)).isoformat()
    calls = []
    monkeypatch.setattr(meilisearch_ops, 'generate_meili_token', lambda **kw: calls.append(kw) or 'signed')
    response = client.post('/api/meili-token/refresh', headers={'Authorization': f'Bearer {token}'})
    assert response.status_code == 401
    assert calls == []


def test_refresh_uses_session_rights(client, backend_env, monkeypatch):
    from server import meilisearch_ops
    auth = backend_env['auth']
    user = {'username': 'editor', 'role': 'editor', 'allowed_collections': ['session-collection']}
    token = auth.create_session(user)
    calls = []
    monkeypatch.setattr(meilisearch_ops, 'generate_meili_token', lambda **kw: calls.append(kw) or 'signed')
    response = client.post('/api/meili-token/refresh', headers={'Authorization': f'Bearer {token}'})
    assert response.status_code == 200
    assert calls[0]['user'] == user


def test_refresh_rejects_revoked_session(client, backend_env, monkeypatch):
    from server import meilisearch_ops
    auth = backend_env['auth']
    token = auth.create_session({'username': 'editor', 'role': 'editor'})
    auth.delete_user_sessions('editor')
    calls = []
    monkeypatch.setattr(meilisearch_ops, 'generate_meili_token', lambda **kw: calls.append(kw) or 'signed')
    response = client.post('/api/meili-token/refresh', headers={'Authorization': f'Bearer {token}'})
    assert response.status_code == 401
    assert calls == []
