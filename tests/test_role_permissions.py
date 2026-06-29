"""Tuum-invariant: rolli-tasemed ja kes-tohib-keda hallata."""
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.auth import (
    ROLE_HIERARCHY,
    role_level,
    is_valid_role,
    is_at_least,
    can_manage_user,
    can_assign_role,
    can_change_role,
    has_superadmin,
)
from server.access_ops import can_read_work


def test_hierarchy_has_four_tiers():
    assert ROLE_HIERARCHY == {"contributor": 0, "editor": 1, "admin": 2, "superadmin": 3}


def test_role_level_known():
    assert role_level("contributor") == 0
    assert role_level("superadmin") == 3


def test_role_level_unknown_raises():
    # KRIITILINE: tundmatu roll EI TOHI vaikselt muutuda tasemeks 0
    with pytest.raises(ValueError):
        role_level("user")
    with pytest.raises(ValueError):
        role_level("")


def test_is_valid_role():
    assert is_valid_role("admin") is True
    assert is_valid_role("superadmin") is True
    assert is_valid_role("user") is False


def test_can_manage_user_strictly_lower():
    # admin saab hallata editorit/contributorit
    assert can_manage_user("admin", "editor") is True
    assert can_manage_user("admin", "contributor") is True
    # admin EI saa hallata teist admini ega superadmini (augu sulgemine)
    assert can_manage_user("admin", "admin") is False
    assert can_manage_user("admin", "superadmin") is False
    # superadmin saab hallata admini, mitte teist superadmini
    assert can_manage_user("superadmin", "admin") is True
    assert can_manage_user("superadmin", "superadmin") is False


def test_can_assign_role_ceiling():
    # admin saab määrata kuni editor, mitte admin/superadmin
    assert can_assign_role("admin", "editor") is True
    assert can_assign_role("admin", "contributor") is True
    assert can_assign_role("admin", "admin") is False
    assert can_assign_role("admin", "superadmin") is False
    # superadmin saab määrata kuni admin, mitte superadmin (võrdne tase)
    assert can_assign_role("superadmin", "admin") is True
    assert can_assign_role("superadmin", "superadmin") is False


def test_can_change_role_requires_both():
    # admin: tohib editorit puutuda JA contributoriks määrata
    assert can_change_role("admin", "editor", "contributor") is True
    # admin: ei tohi editorit adminiks tõsta (lagi)
    assert can_change_role("admin", "editor", "admin") is False
    # admin: ei tohi admini puutuda (sihtmärk)
    assert can_change_role("admin", "admin", "contributor") is False
    # superadmin: tohib admini editoriks alandada
    assert can_change_role("superadmin", "admin", "editor") is True


def test_is_at_least_superadmin_counts_as_admin():
    # KRIITILINE: superadmin peab läbima admin-taseme võimekuse-kontrollid
    assert is_at_least("superadmin", "admin") is True
    assert is_at_least("admin", "admin") is True
    assert is_at_least("editor", "admin") is False
    assert is_at_least("superadmin", "editor") is True


def test_superadmin_can_read_restricted_work(monkeypatch):
    # Regressioon: superadmin ei tohi piiratud teosest välja kukkuda (nagu admin saab).
    # is_work_public loeb kollektsiooni-konfist — märgi "secret-coll" piiratuks.
    import server.access_ops as access_ops
    monkeypatch.setattr(access_ops, "get_cached_collections",
                        lambda: {"secret-coll": {"visibility": "restricted"}})
    work = {"collections": ["secret-coll"]}
    admin = {"role": "admin", "allowed_collections": []}
    superadmin = {"role": "superadmin", "allowed_collections": []}
    editor = {"role": "editor", "allowed_collections": []}
    assert can_read_work(work, admin) is True
    assert can_read_work(work, superadmin) is True
    # editorit ei päästa allowed_collections (tühi) → piiratud teost ei loe
    assert can_read_work(work, editor) is False


def test_has_superadmin():
    assert has_superadmin({"a": {"role": "admin"}}) is False
    assert has_superadmin({"a": {"role": "superadmin"}}) is True
    assert has_superadmin({}) is False


def test_warn_if_no_superadmin(monkeypatch, caplog):
    import logging
    import server.auth as auth_mod
    monkeypatch.setattr(auth_mod, "load_users", lambda: {"a": {"role": "admin"}})
    with caplog.at_level(logging.WARNING):
        present = auth_mod.warn_if_no_superadmin()
    assert present is False
    assert any("superadmin" in r.message.lower() for r in caplog.records)


def test_warn_if_no_superadmin_present(monkeypatch, caplog):
    import server.auth as auth_mod
    monkeypatch.setattr(auth_mod, "load_users", lambda: {"a": {"role": "superadmin"}})
    present = auth_mod.warn_if_no_superadmin()
    assert present is True
