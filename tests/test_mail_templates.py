"""Kirjamallide renderdus.

Mallid on repos tekstifailidena, sest need kirjad lähevad välja ülikooli nimel
ja tekstimuudatus väärib ülevaatust. Katkine mall peab kukkuma siin, mitte
kasutaja postkastis.
"""
import sys
from pathlib import Path
from urllib.parse import quote

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.mail_templates import MAILTO_BUDGET, render_mail
from server.registration import INVITE_EXPIRY_HOURS

INVITE_CONTEXT = {
    "name": "Mari Maasikas",
    "username": "mmaasikas",
    "url": "https://vutt.utlib.ut.ee/set-password?token=abc123",
    "expires_hours": INVITE_EXPIRY_HOURS,
}


@pytest.mark.parametrize("lang", ["et", "en"])
def test_invite_renders_in_both_languages(lang):
    subject, body = render_mail("invite", lang, **INVITE_CONTEXT)
    assert subject and body
    # Ükski platseholder ei tohi renderdamata jääda
    assert "$" not in subject
    assert "$" not in body
    assert INVITE_CONTEXT["url"] in body
    assert INVITE_CONTEXT["username"] in body
    assert str(INVITE_EXPIRY_HOURS) in body


def test_languages_differ():
    """Kaks keelt ei tohi olla sama fail kaks korda."""
    et_subject, et_body = render_mail("invite", "et", **INVITE_CONTEXT)
    en_subject, en_body = render_mail("invite", "en", **INVITE_CONTEXT)
    assert et_subject != en_subject
    assert et_body != en_body


def test_unknown_language_falls_back_to_estonian():
    assert render_mail("invite", "de", **INVITE_CONTEXT) == render_mail("invite", "et", **INVITE_CONTEXT)


def test_missing_placeholder_raises(tmp_path):
    """Puuduv võti peab andma KeyError, MITTE saatma kirja, milles on $username."""
    with pytest.raises(KeyError):
        render_mail("invite", "et", name="Mari")


def test_unknown_template_raises():
    with pytest.raises(FileNotFoundError):
        render_mail("pole-olemas", "et")


def test_crlf_template_gives_same_result_as_lf(tmp_path, monkeypatch):
    """Windowsis toimetatud mall jätaks pealkirja lõppu nähtamatu \\r-i,
    mis läheks otse kirja Subject: päisesse."""
    from server import mail_templates

    (tmp_path / "proov.et.txt").write_bytes(b"Pealkiri\r\n\r\nTere $name,\r\nAitah.\r\n")
    monkeypatch.setattr(mail_templates, "TEMPLATE_DIR", str(tmp_path))

    subject, body = mail_templates.render_mail("proov", "et", name="Mari")
    assert subject == "Pealkiri"
    assert "\r" not in subject
    assert "\r" not in body
    assert body.startswith("Tere Mari,")


def test_template_without_blank_line_raises(tmp_path, monkeypatch):
    """Tühja reata mall on viga, mitte pealkirjata kiri."""
    from server import mail_templates

    (tmp_path / "vigane.et.txt").write_text("Ainult üks rida", encoding="utf-8")
    monkeypatch.setattr(mail_templates, "TEMPLATE_DIR", str(tmp_path))

    with pytest.raises(ValueError):
        mail_templates.render_mail("vigane", "et")


@pytest.mark.parametrize("lang", ["et", "en"])
def test_invite_fits_mailto_budget(lang):
    """Outlook lõikab pika mailto: URL-i vaikselt — lävi on mõõdetav, mitte soovitus."""
    subject, body = render_mail("invite", lang, **INVITE_CONTEXT)
    encoded = len(quote(subject)) + len(quote(body))
    assert encoded < MAILTO_BUDGET, f"{lang}: {encoded} märki, eelarve {MAILTO_BUDGET}"
