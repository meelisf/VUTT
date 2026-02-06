"""
HTTP abifunktsioonid request/response käsitluseks.

Kasutatakse file_server.py ja pending_edits_handlers.py poolt,
et vähendada korduvat boilerplate koodi.
"""
import json

from .cors import send_cors_headers
from .auth import require_token


def send_json_response(handler, status_code, data):
    """Saadab JSON-vastuse koos CORS päistega."""
    handler.send_response(status_code)
    handler.send_header('Content-type', 'application/json')
    send_cors_headers(handler)
    handler.end_headers()
    handler.wfile.write(json.dumps(data, ensure_ascii=False).encode('utf-8'))


def read_request_data(handler):
    """Loeb ja parsib POST body JSON-ina."""
    content_length = int(handler.headers['Content-Length'])
    post_data = handler.rfile.read(content_length)
    return json.loads(post_data)


def require_auth(handler, data, min_role='editor'):
    """Kontrollib autentimist ja tagastab kasutaja või saadab 401 vastuse.

    Returns:
        user dict kui autentimine õnnestus, None kui ebaõnnestus (vastus juba saadetud)
    """
    user, auth_error = require_token(data, min_role=min_role)
    if auth_error:
        send_json_response(handler, 401, auth_error)
        return None
    return user
