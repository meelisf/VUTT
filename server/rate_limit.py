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

# Puhastuse intervall (sekundites)
RATE_LIMIT_CLEANUP_INTERVAL = 600  # 10 minutit


def _cleanup_rate_limit_store():
    """Taustalõim, mis puhastab tühjad IP kirjed perioodiliselt."""
    while True:
        time.sleep(RATE_LIMIT_CLEANUP_INTERVAL)
        try:
            now = time.time()
            total_removed = 0

            with _rate_limit_lock:
                for endpoint in list(_rate_limit_store.keys()):
                    ips_to_remove = []

                    for ip, timestamps in _rate_limit_store[endpoint].items():
                        # Leia suurim window selle endpointi jaoks
                        _, window_seconds = RATE_LIMITS.get(endpoint, (0, 3600))

                        # Filtreeri aegunud timestamps
                        valid_timestamps = [ts for ts in timestamps if now - ts < window_seconds]

                        if not valid_timestamps:
                            # Tühi list - eemalda IP
                            ips_to_remove.append(ip)
                        else:
                            # Uuenda ainult kehtivate timestamp'idega
                            _rate_limit_store[endpoint][ip] = valid_timestamps

                    # Eemalda tühjad IP-d
                    for ip in ips_to_remove:
                        del _rate_limit_store[endpoint][ip]
                        total_removed += 1

                    # Eemalda tühi endpoint
                    if not _rate_limit_store[endpoint]:
                        del _rate_limit_store[endpoint]

            if total_removed > 0:
                print(f"Rate limit puhastus: eemaldatud {total_removed} IP kirjet")
        except Exception as e:
            print(f"Rate limit puhastuse viga: {e}")


# Käivita puhastuse taustalõim
_cleanup_thread = threading.Thread(target=_cleanup_rate_limit_store, daemon=True)
_cleanup_thread.start()


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
