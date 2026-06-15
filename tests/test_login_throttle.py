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
    """Tühjenda konto-throttle hoidla iga testi eel ja järel."""
    with rl._account_lock:
        rl._account_failures.clear()
    yield
    with rl._account_lock:
        rl._account_failures.clear()


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
