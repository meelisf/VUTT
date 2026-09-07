"""Kirjade saatmine hosti postfixi kaudu (#298, ADR 0034).

Ükski test ei ava päris ühendust: `smtplib.SMTP` asendatakse vaikse topeldiga.
Keskne nõue on, et `send_mail` EI VISKA kunagi — saatmisviga on kutsuja jaoks
tagastusväärtus, sest kutse- ja taastelink on selleks hetkeks juba loodud.
"""
import smtplib

import pytest

from server import mailer


class FakeSMTP:
    """Salvestab, mis saadeti; `raise_on` laseb ühe vea imiteerida."""

    instances = []

    def __init__(self, host, port, timeout=None):
        self.host, self.port, self.timeout = host, port, timeout
        self.sent = []
        self.quit_called = False
        FakeSMTP.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.quit_called = True
        return False

    def send_message(self, msg):
        self.sent.append(msg)


@pytest.fixture
def smtp(monkeypatch):
    FakeSMTP.instances = []
    monkeypatch.setattr(mailer.smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(mailer.config, "SMTP_HOST", "smtp-relay")
    monkeypatch.setattr(mailer.config, "SMTP_PORT", 25)
    monkeypatch.setattr(mailer.config, "MAIL_FROM", "vutt-abi@ut.ee")
    monkeypatch.setattr(mailer.config, "MAIL_FROM_NAME", "VUTT")
    return FakeSMTP


def test_saadab_kirja_ja_tagastab_edu(smtp):
    ok, error = mailer.send_mail("keegi@example.test", "Pealkiri", "Keha")
    assert (ok, error) == (True, None)

    msg = smtp.instances[0].sent[0]
    assert msg["To"] == "keegi@example.test"
    assert msg["Subject"] == "Pealkiri"
    assert msg["From"] == "VUTT <vutt-abi@ut.ee>"
    assert msg.get_content().strip() == "Keha"


def test_kasutab_seadistatud_hosti_ja_porti(smtp):
    mailer.send_mail("keegi@example.test", "P", "K")
    inst = smtp.instances[0]
    assert (inst.host, inst.port) == ("smtp-relay", 25)
    assert inst.timeout, "timeout PEAB olema — muidu ripub päring releed oodates"
    assert inst.quit_called, "ühendus tuleb sulgeda ka eduka saatmise järel"


def test_taheline_sisu_sailib(smtp):
    """Kirjamallid on eestikeelsed; latin-1 kodeering lõhuks „ä" ja „õ"."""
    mailer.send_mail("keegi@example.test", "Kutse õnnestus", "Tere, Märt — ülikool")
    msg = smtp.instances[0].sent[0]
    assert "õnnestus" in msg["Subject"]
    assert "Märt — ülikool" in msg.get_content()


def test_auto_submitted_pais_valdib_puhkusevastuseid(smtp):
    """RFC 3834: transaktsioonikiri ei tohi tekitada automaatvastuste ahelat."""
    mailer.send_mail("keegi@example.test", "P", "K")
    assert smtp.instances[0].sent[0]["Auto-Submitted"] == "auto-generated"


def test_smtp_viga_ei_viska_vaid_tagastatakse(smtp, monkeypatch):
    def _boom(self, msg):
        raise smtplib.SMTPRecipientsRefused({"keegi@example.test": (550, b"nope")})

    monkeypatch.setattr(FakeSMTP, "send_message", _boom)
    ok, error = mailer.send_mail("keegi@example.test", "P", "K")
    assert ok is False
    assert error, "viga peab jõudma kutsujani, et admin näeks, miks kiri ei läinud"


def test_vorguviga_ei_viska(smtp, monkeypatch):
    """Postfix maas või Docker-võrk katki — samuti tagastusväärtus, mitte 500."""
    def _boom(self, *a, **kw):
        raise OSError("Connection refused")

    monkeypatch.setattr(FakeSMTP, "__init__", _boom)
    ok, error = mailer.send_mail("keegi@example.test", "P", "K")
    assert ok is False
    assert "Connection refused" in error


def test_seadistamata_saatja_ei_proovi_uhendust(monkeypatch):
    """Arenduses on SMTP_HOST tühi: see on kehtiv seisund, mitte viga.

    Vaikimisi katse localhost:25 vastu ripuks või logiks vea igal kutsel.
    """
    FakeSMTP.instances = []
    monkeypatch.setattr(mailer.smtplib, "SMTP", FakeSMTP)
    monkeypatch.setattr(mailer.config, "SMTP_HOST", "")
    monkeypatch.setattr(mailer.config, "MAIL_FROM", "vutt-abi@ut.ee")

    ok, error = mailer.send_mail("keegi@example.test", "P", "K")
    assert ok is False
    assert FakeSMTP.instances == [], "väljalülitatud saatja ei tohi ühendust avada"
    assert error


def test_puuduv_saaja_ei_ava_uhendust(smtp):
    ok, error = mailer.send_mail("", "P", "K")
    assert ok is False
    assert smtp.instances == []


def test_aadress_logis_on_maskitud():
    """Saaja aadress on isikuandmed — logi ei pea seda tervikuna kandma."""
    assert mailer.mask_address("meelis.friedenthal@ut.ee") == "m***@ut.ee"
    assert mailer.mask_address("") == "(puudub)"
