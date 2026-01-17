"""
Rate limiting funktsioonid.
Kaitseb brute force ja spam rünnakute eest.
"""
import json
import time
import threading
from .config import RATE_LIMITS

# IP-põhine päringute ajalugu: {endpoint: {ip: [timestamp1, timestamp2, ...]}}
_rate_limit_store = {}
_rate_limit_lock = threading.Lock()


def get_client_ip(handler):
    """Tagastab kliendi IP aadressi, arvestades X-Real-IP ja X-Forwarded-For päiseid."""
    # Nginx saadab X-Real-IP päise
    ip = handler.headers.get('X-Real-IP')
    if ip:
        return ip
    # Fallback: X-Forwarded-For (esimene IP)
    forwarded = handler.headers.get('X-Forwarded-For')
    if forwarded:
        return forwarded.split(',')[0].strip()
    # Viimane võimalus: otseühenduse IP
    return handler.client_address[0]


def check_rate_limit(ip, endpoint):
    """
    Kontrollib, kas IP on ületanud rate limiti antud endpointile.
    Tagastab (allowed, retry_after_seconds).
    """
    if endpoint not in RATE_LIMITS:
        return True, 0

    max_requests, window_seconds = RATE_LIMITS[endpoint]
    now = time.time()

    with _rate_limit_lock:
        if endpoint not in _rate_limit_store:
            _rate_limit_store[endpoint] = {}

        if ip not in _rate_limit_store[endpoint]:
            _rate_limit_store[endpoint][ip] = []

        # Eemalda aegunud kirjed
        _rate_limit_store[endpoint][ip] = [
            ts for ts in _rate_limit_store[endpoint][ip]
            if now - ts < window_seconds
        ]

        requests = _rate_limit_store[endpoint][ip]

        if len(requests) >= max_requests:
            # Arvuta, millal saab uuesti proovida
            oldest = min(requests) if requests else now
            retry_after = int(window_seconds - (now - oldest)) + 1
            return False, retry_after

        # Lisa uus päring
        _rate_limit_store[endpoint][ip].append(now)
        return True, 0


def rate_limit_response(handler, retry_after, send_cors_headers_func):
    """Saadab rate limit vastuse (HTTP 429)."""
    handler.send_response(429)
    handler.send_header('Content-type', 'application/json')
    send_cors_headers_func(handler)
    handler.send_header('Retry-After', str(retry_after))
    handler.end_headers()
    response = {
        "status": "error",
        "message": f"Liiga palju päringuid. Proovi uuesti {retry_after} sekundi pärast.",
        "retry_after": retry_after
    }
    handler.wfile.write(json.dumps(response).encode('utf-8'))
