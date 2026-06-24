"""
Testid konto-põhise login-throttle jaoks (credential-stuffing kaitse).

IP-põhine rate-limit ei kaitse, kui ründaja kasutab paljusid IP-sid ühe konto vastu.
Konto-põhine loendur lukustab kasutajanime ajutiselt liiga paljude ebaõnnestunud
katsete järel — sõltumatult IP-st.
"""
import time
import pytest

import server.rate_limit as rl


@pytest.fixture(autouse=True)
def _clean_store():
    """Tühjenda konto- ja IP-throttle hoidlad iga testi eel ja järel."""
    with rl._account_lock:
        rl._account_failures.clear()
    with rl._rate_limit_lock:
        rl._rate_limit_store.clear()
    yield
    with rl._account_lock:
        rl._account_failures.clear()
    with rl._rate_limit_lock:
        rl._rate_limit_store.clear()


def test_below_threshold_not_locked():
    for _ in range(rl.ACCOUNT_LOCKOUT_THRESHOLD - 1):
        rl.record_login_failure("mari")
    locked, retry = rl.check_account_lockout("mari")
    assert locked is False
    assert retry == 0


def test_at_threshold_locked():
    for _ in range(rl.ACCOUNT_LOCKOUT_THRESHOLD):
        rl.record_login_failure("mari")
    locked, retry = rl.check_account_lockout("mari")
    assert locked is True
    assert retry > 0


def test_success_clears_failures():
    for _ in range(rl.ACCOUNT_LOCKOUT_THRESHOLD):
        rl.record_login_failure("mari")
    assert rl.check_account_lockout("mari")[0] is True
    rl.clear_login_failures("mari")
    assert rl.check_account_lockout("mari")[0] is False


def test_lockout_independent_per_username():
    for _ in range(rl.ACCOUNT_LOCKOUT_THRESHOLD):
        rl.record_login_failure("mari")
    assert rl.check_account_lockout("mari")[0] is True
    # Teine kasutaja ei tohi olla mõjutatud
    assert rl.check_account_lockout("jaan")[0] is False


def test_window_expiry_unlocks():
    """Pärast akna möödumist aeguvad ebaõnnestumised ja lukk avaneb."""
    old = time.time() - rl.ACCOUNT_LOCKOUT_WINDOW - 1
    with rl._account_lock:
        rl._account_failures["mari"] = [old] * rl.ACCOUNT_LOCKOUT_THRESHOLD
    locked, retry = rl.check_account_lockout("mari")
    assert locked is False
    assert retry == 0


def test_unknown_username_also_throttled():
    """Olematu kasutajanimi peab samuti lukustuma — väldib enumeratsiooni lockout'i kaudu."""
    for _ in range(rl.ACCOUNT_LOCKOUT_THRESHOLD):
        rl.record_login_failure("olematu_kasutaja_xyz")
    assert rl.check_account_lockout("olematu_kasutaja_xyz")[0] is True


# ------------------------------------------------------------------
# IP-põhine rate-limit (check_rate_limit)
# ------------------------------------------------------------------
# RATE_LIMITS['/login'] = (5, 60) — kasutame seda testides fikseeritud konfiguna.
_LOGIN_MAX, _LOGIN_WINDOW = rl.RATE_LIMITS['/login']


def test_rate_limit_unknown_endpoint_always_allowed():
    """Tundmatu endpoint (pole RATE_LIMITS-is) ei piirrita."""
    allowed, retry = rl.check_rate_limit("1.2.3.4", "/tundmatu-endpoint")
    assert allowed is True
    assert retry == 0


def test_rate_limit_below_limit_allows():
    """Limiidi all olevad päringud lubatakse ja loendur täitub."""
    for _ in range(_LOGIN_MAX - 1):
        allowed, retry = rl.check_rate_limit("1.2.3.4", "/login")
        assert allowed is True
        assert retry == 0


def test_rate_limit_at_limit_blocks():
    """Pärast limiidi täitumist järgmist päringut ei lubata ja retry > 0."""
    for _ in range(_LOGIN_MAX):
        assert rl.check_rate_limit("1.2.3.4", "/login")[0] is True
    allowed, retry = rl.check_rate_limit("1.2.3.4", "/login")
    assert allowed is False
    assert retry > 0


def test_rate_limit_window_expiry_allows_again(monkeypatch):
    """Pärast akna möödumist aeguvad päringud ja limiit lähtestub."""
    for _ in range(_LOGIN_MAX):
        rl.check_rate_limit("1.2.3.4", "/login")
    assert rl.check_rate_limit("1.2.3.4", "/login")[0] is False

    # Liiguta aega aknast kaugemale
    base = time.time()
    monkeypatch.setattr(rl.time, "time", lambda: base + _LOGIN_WINDOW + 1)
    allowed, retry = rl.check_rate_limit("1.2.3.4", "/login")
    assert allowed is True
    assert retry == 0


def test_rate_limit_isolated_per_ip_and_endpoint():
    """Ühe IP/endpointi limiit ei mõjuta teist IP-d ega teist endpointi."""
    for _ in range(_LOGIN_MAX):
        rl.check_rate_limit("1.1.1.1", "/login")
    assert rl.check_rate_limit("1.1.1.1", "/login")[0] is False
    # Teine IP — endiselt lubatud
    assert rl.check_rate_limit("2.2.2.2", "/login")[0] is True
    # Sama IP, teine endpoint — endiselt lubatud
    assert rl.check_rate_limit("1.1.1.1", "/register")[0] is True
