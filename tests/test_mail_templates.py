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
from server.password_reset import RESET_TOKEN_TTL_HOURS

INVITE_CONTEXT = {
    "name": "Mari Maasikas",
    "username": "mmaasikas",
    "url": "https://vutt.utlib.ut.ee/set-password?token=abc123",
    "expires_hours": INVITE_EXPIRY_HOURS,
    "submitted_on": "5. septembril 2026",
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


# --- Parooli taastamine (#298) --------------------------------------------

RESET_CONTEXT = {
    "name": "Mari Maasikas",
    "username": "mmaasikas",
    "url": "https://vutt.utlib.ut.ee/set-password?token=abc123&reset=1",
    "expires_hours": RESET_TOKEN_TTL_HOURS,
    "initiated_by": "mfriedenthal",
    "initiated_on": "9. septembril 2026",
}


@pytest.mark.parametrize("lang", ["et", "en"])
def test_password_reset_renders_in_both_languages(lang):
    subject, body = render_mail("password_reset", lang, **RESET_CONTEXT)
    assert subject and body
    assert "$" not in subject
    assert "$" not in body
    assert RESET_CONTEXT["url"] in body
    assert RESET_CONTEXT["username"] in body
    assert str(RESET_TOKEN_TTL_HOURS) in body


def test_password_reset_languages_differ():
    et = render_mail("password_reset", "et", **RESET_CONTEXT)
    en = render_mail("password_reset", "en", **RESET_CONTEXT)
    assert et[0] != en[0]
    assert et[1] != en[1]


def test_password_reset_is_not_invite():
    """Kaks eri kirja: „algatati taastamine" ei tohi lugeda „konto kinnitati"."""
    reset_subject, reset_body = render_mail("password_reset", "et", **RESET_CONTEXT)
    invite_subject, invite_body = render_mail("invite", "et", **INVITE_CONTEXT)
    assert reset_subject != invite_subject
    assert reset_body != invite_body


@pytest.mark.parametrize("lang", ["et", "en"])
def test_password_reset_fits_mailto_budget(lang):
    subject, body = render_mail("password_reset", lang, **RESET_CONTEXT)
    encoded = len(quote(subject)) + len(quote(body))
    assert encoded < MAILTO_BUDGET, f"{lang}: {encoded} märki, eelarve {MAILTO_BUDGET}"


@pytest.mark.parametrize("template", ["invite", "password_reset"])
@pytest.mark.parametrize("lang", ["et", "en"])
def test_subject_has_no_non_ascii_punctuation(template, lang):
    """Teemareas ei tohi olla mitte-ASCII KIRJAVAHEMÄRKI ega sümbolit.

    Mõõdetud tootmises (2026-09-07): mõttekriips teemas andis päise
    `Subject: VUTT =?utf-8?b?4oCT?= account activation link` — enamasti ASCII
    rida, mille keskel üksik base64-plokk ainult kirjavahemärgi ümber.

    Reegel on tahtlikult KITSAS. „Teemarida peab olema ASCII" oleks lihtsam,
    aga keelaks ka `juurdepääsutaotlus` — eesti tähtede kodeerimine on igas
    Euroopa keeles tavaline ja täiesti korras. Kodeerida ei ole mõtet ainult
    KAUNISTUST, millest ei võida keegi.
    """
    context = INVITE_CONTEXT if template == "invite" else RESET_CONTEXT
    subject, _ = render_mail(template, lang, **context)
    kahtlased = [c for c in subject if not c.isascii() and not c.isalpha()]
    assert not kahtlased, f"Teemareas on mitte-ASCII kirjavahemärk {kahtlased!r}: {subject!r}"


@pytest.mark.parametrize("template", ["invite", "password_reset"])
def test_ascii_subject_stays_unencoded_in_header(template):
    """Ingliskeelsed teemad on puhas ASCII ja peavad päises kodeerimata jääma.

    Kontrollib SEERIALISEERITUD kirja, sest `msg["Subject"]` annab
    dekodeeritud väärtuse ega näeks kodeeringut üldse.
    """
    from server.mailer import build_message

    context = INVITE_CONTEXT if template == "invite" else RESET_CONTEXT
    subject, body = render_mail(template, "en", **context)
    raw = build_message("keegi@example.com", subject, body).as_string()
    header = next(r for r in raw.split("\n") if r.startswith("Subject:"))
    assert "=?" not in header, f"Teemareas on kodeeritud sõna: {header!r}"


@pytest.mark.parametrize("lang", ["et", "en"])
def test_invite_names_the_request_date(lang):
    """Taotluse kuupäev on kontekst, mida massipostitajal ei ole — see on
    kogu tase-1 muudatuse mõte, seega valvur, mitte hea tahe."""
    subject, body = render_mail("invite", lang, **INVITE_CONTEXT)
    assert INVITE_CONTEXT["submitted_on"] in body


@pytest.mark.parametrize("lang", ["et", "en"])
def test_password_reset_names_initiator_and_date(lang):
    """Parooli taastamine on ainus kiri, mille tegevust saaja ise ei
    algatanud: kes ja millal PEAB kirjas olema."""
    subject, body = render_mail("password_reset", lang, **RESET_CONTEXT)
    assert RESET_CONTEXT["initiated_by"] in body
    assert RESET_CONTEXT["initiated_on"] in body


@pytest.mark.parametrize("template", ["invite", "password_reset"])
@pytest.mark.parametrize("lang", ["et", "en"])
def test_states_password_is_never_requested_by_mail(template, lang):
    """„Me ei küsi kunagi parooli" on lubadus, mille rikkumine peab kukkuma
    testis, mitte kasutaja usalduses."""
    context = INVITE_CONTEXT if template == "invite" else RESET_CONTEXT
    _, body = render_mail(template, lang, **context)
    oodatud = "ei küsi" if lang == "et" else "never ask"
    assert oodatud in body
    assert "vutt-abi@ut.ee" in body


# --- format_mail_date -------------------------------------------------------

def test_format_mail_date_estonian_uses_month_in_adessive():
    from datetime import datetime

    from server.mail_templates import format_mail_date

    assert format_mail_date(datetime(2026, 9, 5), "et") == "5. septembril 2026"
    assert format_mail_date(datetime(2026, 1, 31), "et") == "31. jaanuaril 2026"


def test_format_mail_date_english():
    from datetime import datetime

    from server.mail_templates import format_mail_date

    assert format_mail_date(datetime(2026, 9, 5), "en") == "5 September 2026"


def test_format_mail_date_accepts_iso_string():
    """`submitted_at` on kettal ISO-stringina, mitte datetime'ina."""
    from server.mail_templates import format_mail_date

    assert format_mail_date("2026-09-05T18:22:41.123456", "et") == "5. septembril 2026"


@pytest.mark.parametrize("value", [None, "", "eile", 12345, "2026-13-45"])
def test_format_mail_date_never_raises(value):
    """Kuupäev on kirjas kaunistus: loetamatu väärtus annab tühja stringi,
    MITTE erindi. Vastasel juhul jääks kutse tema pärast saatmata."""
    from server.mail_templates import format_mail_date

    assert format_mail_date(value, "et") == ""


def test_format_mail_date_has_no_clock_time():
    """Backend-konteiner on UTC, host EEST — kellaaeg oleks kolm tundi vale."""
    from datetime import datetime

    from server.mail_templates import format_mail_date

    rendered = format_mail_date(datetime(2026, 9, 5, 18, 22), "et")
    assert ":" not in rendered and "18" not in rendered
