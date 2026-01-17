"""
CORS (Cross-Origin Resource Sharing) funktsioonid.
Piirab päringuid ainult lubatud domeenidele.
"""
from .config import ALLOWED_ORIGINS


def get_cors_origin(handler):
    """
    Tagastab lubatud CORS päritolu või None.
    Kontrollib Origin päist lubatud nimekirja vastu.
    """
    origin = handler.headers.get('Origin')
    if origin and origin in ALLOWED_ORIGINS:
        return origin
    return None


def send_cors_headers(handler):
    """
    Lisab CORS päised vastusele.
    Kui Origin on lubatud, lisab selle; muidu ei lisa midagi.
    """
    origin = get_cors_origin(handler)
    if origin:
        handler.send_header('Access-Control-Allow-Origin', origin)
        handler.send_header('Access-Control-Allow-Credentials', 'true')
