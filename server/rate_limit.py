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

# Konto-põhine ebaõnnestunud login-katsete ajalugu: {username: [timestamp, ...]}
# Kaitseb credential-stuffingu eest: IP-limiit ei aita, kui ründaja kasutab
# paljusid IP-sid ühe konto vastu. Loendur on IP-st sõltumatu.
_account_failures = {}
_account_lock = threading.Lock()

ACCOUNT_LOCKOUT_THRESHOLD = 10   # mitu ebaõnnestumist akna jooksul lukustab konto
ACCOUNT_LOCKOUT_WINDOW = 900     # libisev aken sekundites (15 min)

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

            # Puhasta ka konto-throttle aegunud kirjed
            with _account_lock:
                for username in list(_account_failures.keys()):
                    valid = [ts for ts in _account_failures[username]
                             if now - ts < ACCOUNT_LOCKOUT_WINDOW]
                    if valid:
                        _account_failures[username] = valid
                    else:
                        del _account_failures[username]

            if total_removed > 0:
                print(f"Rate limit puhastus: eemaldatud {total_removed} IP kirjet")
        except Exception as e:
            print(f"Rate limit puhastuse viga: {e}")


# Käivita puhastuse taustalõim
_cleanup_thread = threading.Thread(target=_cleanup_rate_limit_store, daemon=True)
_cleanup_thread.start()


def get_client_ip(request):
    """Tagastab kliendi IP aadressi FastAPI Request objektist.
    Usaldab X-Real-IP päist (nginx seab selle) ja X-Forwarded-For (esimene IP).
    Fallback: request.client.host (otseühendus)."""
    # Nginx seab X-Real-IP päringu tegeliku allika IP-le
    ip = request.headers.get('X-Real-IP')
    if ip and ip.strip():
        return ip.strip()
    # Alternatiiv: X-Forwarded-For (esimene IP, proxyde ahela algus)
    forwarded = request.headers.get('X-Forwarded-For')
    if forwarded:
        return forwarded.split(',')[0].strip()
    # Otseühenduse IP — FastAPI Request API
    if request.client:
        return request.client.host
    return '0.0.0.0'


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


def check_account_lockout(username):
    """
    Kontrollib, kas konto on liiga paljude ebaõnnestunud login-katsete tõttu lukus.
    IP-st sõltumatu — kaitse credential-stuffingu vastu (palju IP-sid, üks konto).
    Tagastab (locked, retry_after_seconds).
    """
    now = time.time()
    with _account_lock:
        timestamps = _account_failures.get(username)
        if not timestamps:
            return False, 0
        # Hoia ainult akna sees olevad ebaõnnestumised
        valid = [ts for ts in timestamps if now - ts < ACCOUNT_LOCKOUT_WINDOW]
        if valid:
            _account_failures[username] = valid
        else:
            del _account_failures[username]
            return False, 0

        if len(valid) >= ACCOUNT_LOCKOUT_THRESHOLD:
            oldest = min(valid)
            retry_after = int(ACCOUNT_LOCKOUT_WINDOW - (now - oldest)) + 1
            return True, retry_after
        return False, 0


def record_login_failure(username):
    """Registreerib ühe ebaõnnestunud login-katse kasutajanime kohta."""
    now = time.time()
    with _account_lock:
        bucket = _account_failures.setdefault(username, [])
        # Prune aknast välja jäänud kirjed, et list ei kasvaks lõpmatult
        bucket[:] = [ts for ts in bucket if now - ts < ACCOUNT_LOCKOUT_WINDOW]
        bucket.append(now)


def clear_login_failures(username):
    """Tühjendab konto ebaõnnestumiste loenduri (kutsutakse eduka login'i järel)."""
    with _account_lock:
        _account_failures.pop(username, None)


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
