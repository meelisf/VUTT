"""Kirjade saatmine hosti postfixi kaudu (#298, ADR 0034).

Kanal: konteiner → hosti postfix (`SMTP_HOST:SMTP_PORT`) → `mailhost.ut.ee`.
Autentimist ei ole (relee usaldab IP-d), seega siin ei liigu ühtki saladust.

Kaks reeglit, millest ülejäänu tuleneb:

1. **`send_mail` ei viska.** Kutse- ja taastelink on selleks hetkeks juba
   loodud ja kettal; erind muudaks juba tehtud töö kutsuja jaoks veaks.
   Saatmisviga on tagastusväärtus, mille kutsuja kuvab admini ekraanil.
2. **Väljalülitatud saatja ei ava ühendust.** Tühi `SMTP_HOST`/`MAIL_FROM` on
   kehtiv seisund (arendus, testid) — mitte katse localhost:25 vastu.

Blokeeriv I/O: kutsu `run_in_threadpool` kaudu või sync `def` route'ist
(ADR 0002).
"""
import smtplib
from email.message import EmailMessage
from email.utils import formataddr, formatdate, make_msgid
from typing import Optional, Tuple

from . import config
from .config import get_logger

logger = get_logger(__name__)


def mask_address(address: Optional[str]) -> str:
    """Aadress logi jaoks: `m***@ut.ee`. Domeen jääb — vea otsimisel on
    oluline just see, kuhu kiri ei jõudnud, mitte kellele."""
    if not address:
        return "(puudub)"
    local, _, domain = address.partition("@")
    if not domain:
        return f"{local[:1]}***"
    return f"{local[:1]}***@{domain}"


def build_message(to: str, subject: str, body: str) -> EmailMessage:
    """Koostab kirja. Eraldi funktsioon, et päiseid saaks testida ilma SMTP-ta."""
    msg = EmailMessage()
    msg["From"] = formataddr((config.MAIL_FROM_NAME, config.MAIL_FROM))
    msg["To"] = to
    msg["Subject"] = subject
    msg["Date"] = formatdate(localtime=True)
    # Message-ID domeen tuleb saatja aadressist, mitte konteineri hostinimest
    # (`vutt-backend` ei ole olemasolev domeen ja mõni filter loeb seda vastu).
    domain = config.MAIL_FROM.partition("@")[2] or "ut.ee"
    msg["Message-ID"] = make_msgid(domain=domain)
    # RFC 3834: transaktsioonikiri ei tohi tekitada automaatvastuste ahelat
    # (puhkuseteade → meie kiri → puhkuseteade …).
    msg["Auto-Submitted"] = "auto-generated"
    msg.set_content(body)
    return msg


def send_mail(to: str, subject: str, body: str) -> Tuple[bool, Optional[str]]:
    """Saadab kirja. Tagastab `(ok, viga)` — EI VISKA kunagi.

    `viga` on lühike inimloetav põhjus, mis on mõeldud admini ekraanile;
    saladusi selles ei ole, sest ühendus on autentimata.
    """
    if not to:
        return False, "Saaja aadress puudub"
    if not config.mail_enabled():
        return False, "Kirjade saatmine ei ole seadistatud (SMTP_HOST/MAIL_FROM)"

    try:
        msg = build_message(to, subject, body)
        with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT,
                          timeout=config.SMTP_TIMEOUT) as smtp:
            smtp.send_message(msg)
    except (smtplib.SMTPException, OSError) as e:
        # OSError katab ka socket.timeout'i ja ühenduse keeldumise.
        logger.error("Kirja saatmine ebaõnnestus (saaja=%s): %s", mask_address(to), e)
        return False, str(e)

    logger.info("Kiri saadetud (saaja=%s, teema=%s)", mask_address(to), subject)
    return True, None
