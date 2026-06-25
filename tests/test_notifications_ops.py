"""
Testid server/notifications_ops.py äraloogikale (Faas 1 refaktoreering).

Domeen oli enne refaktoreeringut täiesti testita (0 testi). Need ühiktestid
katavad failipõhise teatiste salvestuse tuumloogikat sõltumatult HTTP-st.

Kaetud käitumine:
- get_notifications_path: path-traversali kaitse (basename), tühi nimi → 400
- load/save_notifications: round-trip, puuduv fail → [], korrumpeerunud → []
- append_notification: uuemad ees, kärpimine MAX_NOTIFICATIONS piirini
- create_notification: genereerib id/ajatempli, täidab actor väljad
- find_username_by_display_name: otsib username JA name väljalt
"""
import json
import pytest
from fastapi import HTTPException


# ---------------------------------------------------------------------------
# get_notifications_path / safe_username
# ---------------------------------------------------------------------------

def test_safe_username_strips_path_separators(backend_env):
    """Path-traversali kaitse: '../etc/passwd' → 'passwd' (basename)."""
    from server.notifications_ops import safe_username
    assert safe_username("../etc/passwd") == "passwd"
    assert safe_username("admin") == "admin"
    assert safe_username("  spaced  ") == "spaced"
    assert safe_username(None) == ""
    assert safe_username("") == ""


def test_get_notifications_path_rejects_empty_username(backend_env):
    """Tühi kasutajanimi → HTTPException 400 (sisendivalideerimine)."""
    from server.notifications_ops import get_notifications_path
    with pytest.raises(HTTPException) as exc:
        get_notifications_path("")
    assert exc.value.status_code == 400
    with pytest.raises(HTTPException):
        get_notifications_path("   ")  # ainult tühikud → safe_username → ""


def test_get_notifications_path_points_to_notifications_dir(backend_env):
    from server.notifications_ops import get_notifications_path
    path = get_notifications_path("editor")
    assert path.endswith("notifications/editor.json")
    # Peab langema kokku conftesti notifications_dir-iga
    assert str(backend_env["notifications_dir"]) in path


# ---------------------------------------------------------------------------
# load / save notifications round-trip
# ---------------------------------------------------------------------------

def test_load_notifications_returns_empty_for_missing_user(backend_env):
    """Kasutaja, kel teatisi pole → [] (mitte None või erind)."""
    from server.notifications_ops import load_notifications
    assert load_notifications("uus-kasutaja") == []


def test_save_then_load_roundtrip(backend_env):
    from server.notifications_ops import save_notifications, load_notifications
    notifs = [{"id": "1", "title": "Tere"}, {"id": "2", "title": "Hüvasti"}]
    save_notifications("editor", notifs)
    assert load_notifications("editor") == notifs


def test_load_notifications_returns_empty_for_corrupt_json(backend_env):
    """Korrumpeerunud JSON → [] (mitte erind). Kaitse brute'liku failikorruptsiooni eest."""
    from server.notifications_ops import load_notifications, get_notifications_path
    path = get_notifications_path("corrupt")
    with open(path, "w") as f:
        f.write("{ see pole json :::")
    assert load_notifications("corrupt") == []


def test_load_notifications_returns_empty_for_non_list_json(backend_env):
    """Kui fail sisaldab dict-i (mitte list-i) → [] (tüüpide valideerimine)."""
    from server.notifications_ops import load_notifications, save_notifications
    save_notifications("dictuser", {"not": "a list"})  # kirjutab dict-i
    assert load_notifications("dictuser") == []


def test_save_notifications_creates_dir(backend_env, tmp_path):
    """Kui NOTIFICATIONS_DIR-i pole, save_notifications loob selle."""
    from server import main as main_mod
    from server.notifications_ops import save_notifications
    import server.notifications_ops as ops

    # Kasuta täiesti uut tmp kataloogi
    new_dir = tmp_path / "fresh-notifs"
    assert not new_dir.exists()
    monkeypatch_dir = str(new_dir)
    # Patch otse ops moodulis (conftest on juba patchinud main-i; siin näitame
    # et save_notifications kasutab ops.NOTIFICATIONS_DIR-i)
    original = ops.NOTIFICATIONS_DIR
    ops.NOTIFICATIONS_DIR = monkeypatch_dir
    try:
        save_notifications("someone", [{"id": "x"}])
        assert new_dir.exists()
        assert (new_dir / "someone.json").exists()
    finally:
        ops.NOTIFICATIONS_DIR = original


# ---------------------------------------------------------------------------
# append_notification — järjekord ja kärpimine
# ---------------------------------------------------------------------------

def test_append_notification_newest_first(backend_env):
    """Uued teatised lisatakse ette (indeks 0) — uuemad ees."""
    from server.notifications_ops import append_notification, load_notifications
    append_notification("editor", {"id": "1", "title": "Esimene"})
    append_notification("editor", {"id": "2", "title": "Teine"})
    notifs = load_notifications("editor")
    assert notifs[0]["id"] == "2"  # uuem ees
    assert notifs[1]["id"] == "1"


def test_append_notification_trims_to_max(backend_env):
    """Kasutaja fail ei kasva lõpmatuks — vanemad kärbitakse MAX_NOTIFICATIONS-ni."""
    from server.notifications_ops import append_notification, load_notifications, MAX_NOTIFICATIONS
    for i in range(MAX_NOTIFICATIONS + 50):
        append_notification("editor", {"id": str(i)})
    notifs = load_notifications("editor")
    assert len(notifs) == MAX_NOTIFICATIONS
    # Viimati lisatud (MAX+49) peab olema eesotsas
    assert notifs[0]["id"] == str(MAX_NOTIFICATIONS + 49)


# ---------------------------------------------------------------------------
# create_notification — struktuuri genereerimine
# ---------------------------------------------------------------------------

def test_create_notification_generates_id_and_timestamp(backend_env):
    from server.notifications_ops import create_notification, load_notifications
    notif = create_notification("editor", "system", "Testpealkiri", "Testsisu")
    assert "id" in notif and len(notif["id"]) > 0
    assert "created_at" in notif
    assert notif["read_at"] is None
    assert notif["type"] == "system"
    assert notif["title"] == "Testpealkiri"
    # Peab olema salvestatud
    loaded = load_notifications("editor")
    assert loaded[0]["id"] == notif["id"]


def test_create_notification_fills_actor_fields(backend_env):
    """actor dict täidab actor_username ja actor_name väljad."""
    from server.notifications_ops import create_notification
    actor = {"username": "admin", "name": "Admin Kasutaja"}
    notif = create_notification("editor", "review_request", "X", actor=actor)
    assert notif["actor_username"] == "admin"
    assert notif["actor_name"] == "Admin Kasutaja"


def test_create_notification_actor_falls_back_to_username(backend_env):
    """Kui actor.name puudub, kasutatakse actor.username-i actor_name väljal."""
    from server.notifications_ops import create_notification
    notif = create_notification("editor", "review_request", "X", actor={"username": "admin"})
    assert notif["actor_name"] == "admin"


def test_create_notification_without_actor(backend_env):
    """actor=None → tühjad actor väljad (mitte None väärtused)."""
    from server.notifications_ops import create_notification
    notif = create_notification("editor", "system", "X", actor=None)
    assert notif["actor_username"] == ""
    assert notif["actor_name"] == ""


def test_create_notification_metadata_defaults_empty(backend_env):
    """metadata=None → {} (mitte None)."""
    from server.notifications_ops import create_notification
    notif = create_notification("editor", "system", "X", metadata=None)
    assert notif["metadata"] == {}


# ---------------------------------------------------------------------------
# find_username_by_display_name
# ---------------------------------------------------------------------------

def test_find_username_by_display_name_matches_username(backend_env):
    from server.notifications_ops import find_username_by_display_name
    # conftest loob kasutajad: admin (name "Admin User"), editor (name "Editor User")
    assert find_username_by_display_name("admin") == "admin"
    assert find_username_by_display_name("editor") == "editor"


def test_find_username_by_display_name_matches_name(backend_env):
    """Legacy kommentaarid sisaldavad vaid kuvanime (name), mitte username-i."""
    from server.notifications_ops import find_username_by_display_name
    assert find_username_by_display_name("Admin User") == "admin"
    assert find_username_by_display_name("Editor User") == "editor"


def test_find_username_by_display_name_returns_none_for_unknown(backend_env):
    from server.notifications_ops import find_username_by_display_name
    assert find_username_by_display_name("olematu") is None
    assert find_username_by_display_name("") is None
    assert find_username_by_display_name(None) is None


# ---------------------------------------------------------------------------
# Backward-compat re-eksport main.py-st
# ---------------------------------------------------------------------------

def test_main_re_exports_notification_helpers():
    """main.py backward-compat re-eksport: vanad _-nimed peavad jääma ligipääsetavaks.

    Kaitseb regressiooni: kui mõni main.py endpoint või test veel impordib
    _create_notification vms server.main-st, peab see töötama.
    """
    import server.main as main
    assert callable(main._create_notification)
    assert callable(main._load_notifications)
    assert callable(main._save_notifications)
    assert callable(main._append_notification)
    assert callable(main._safe_username)
    assert callable(main._get_notifications_path)
    assert callable(main._find_username_by_display_name)
    # _notifications_lock peab olema ops mooduli sama objekt
    import server.notifications_ops as ops
    assert main._notifications_lock is ops._notifications_lock
