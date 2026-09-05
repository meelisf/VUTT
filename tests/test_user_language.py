"""Testid keele normaliseerimisele ja ainuõigele keeleallikale.

`users.json` kannab keelt, mille inimene registreerudes valis; Seadetes tehtud
muudatus kirjutatakse `user_settings`-i. Kaks kirjutuskohta lahkneksid ajas,
seega on lugemiskoht üks: `get_user_language`.
"""
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.user_language import normalize_language, get_user_language


@pytest.mark.parametrize("raw,expected", [
    ("et", "et"),
    ("en", "en"),
    ("EN", "en"),          # suurtähed
    ("en-GB", "en"),       # brauseri i18n.language võib olla piirkonnaga
    ("et-EE", "et"),
    ("  en  ", "en"),      # ümbritsevad tühikud
    ("de", "et"),          # toetamata keel → saidi vaikekeel
    ("", "et"),
    (None, "et"),
    (123, "et"),           # mitte-string ei tohi visata
])
def test_normalize_language(raw, expected):
    assert normalize_language(raw) == expected


def test_get_user_language_prefers_user_settings(monkeypatch):
    """Seadetes tehtud valik võidab registreerimisel valitut."""
    from server import user_language
    monkeypatch.setattr(user_language, "load_users", lambda: {"anne": {"language": "et"}})
    monkeypatch.setattr(user_language, "load_user_settings", lambda u: {"language": "en"})
    assert get_user_language("anne") == "en"


def test_get_user_language_falls_back_to_users_json(monkeypatch):
    """Kui kasutaja pole Seadetes keelt puutunud, kehtib registreerimisel valitu."""
    from server import user_language
    monkeypatch.setattr(user_language, "load_users", lambda: {"anne": {"language": "en"}})
    monkeypatch.setattr(user_language, "load_user_settings", lambda u: {})
    assert get_user_language("anne") == "en"


def test_get_user_language_defaults_when_nothing_set(monkeypatch):
    """Vana kasutaja ilma keeleta = et, ilma migratsioonita."""
    from server import user_language
    monkeypatch.setattr(user_language, "load_users", lambda: {"anne": {}})
    monkeypatch.setattr(user_language, "load_user_settings", lambda u: {})
    assert get_user_language("anne") == "et"


def test_get_user_language_unknown_user(monkeypatch):
    """Tundmatu kasutajanimi ei tohi visata — kiri läheb vaikekeeles."""
    from server import user_language
    monkeypatch.setattr(user_language, "load_users", lambda: {})
    monkeypatch.setattr(user_language, "load_user_settings", lambda u: {})
    assert get_user_language("pole-olemas") == "et"


def test_get_user_language_survives_broken_settings(monkeypatch):
    """Katkine seadetefail ei tohi keele küsimist kukutada."""
    from server import user_language

    def _raise(_username):
        raise OSError("katkine fail")

    monkeypatch.setattr(user_language, "load_users", lambda: {"anne": {"language": "en"}})
    monkeypatch.setattr(user_language, "load_user_settings", _raise)
    assert get_user_language("anne") == "en"
