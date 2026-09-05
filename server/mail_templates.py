"""Kirjamallide laadimine ja renderdus.

Mallid on repos tekstifailidena (`server/email_templates/{nimi}.{keel}.txt`):
esimene rida = pealkiri, tühi rida, ülejäänu = keha. Platseholderid on
`string.Template` kujul (`$name`), sest stdlib katab vajaduse ja uut sõltuvust
ei ole vaja.

Kuupäevi mallides ei ole — kuupäev on lokaaditundlik ja tekitaks küsimuse,
kas vormindada „05.09.2026 kell 18:00" või „Sep 5, 2026". Kui mall siiski
kunagi kuupäeva vajab, vormindab selle KUTSUJA saaja keeles ja annab mallile
valmis stringi; `render_mail` ei võta vastu `datetime`-i.
"""
import os
from string import Template
from typing import Tuple

from .config import get_logger
from .user_language import normalize_language

logger = get_logger(__name__)

TEMPLATE_DIR = os.path.join(os.path.dirname(__file__), "email_templates")

# mailto: URL-i eelarve. Outlook lõikab pika URL-i vaikselt katki, seega on
# see mõõdetav lävi (vt tests/test_mail_templates.py), mitte soovitus.
MAILTO_BUDGET = 1800


def _template_path(template_name: str, lang: str) -> str:
    return os.path.join(TEMPLATE_DIR, f"{template_name}.{lang}.txt")


def render_mail(template_name: str, lang, **context) -> Tuple[str, str]:
    """Renderdab malli ja tagastab (pealkiri, keha).

    Kasutab `Template.substitute`, MITTE `safe_substitute`: puuduv võti peab
    andma `KeyError` testis, mitte saatma kasutajale kirja, milles seisab
    `$username`.
    """
    language = normalize_language(lang)
    path = _template_path(template_name, language)
    if not os.path.exists(path):
        raise FileNotFoundError(f"Kirjamalli ei leitud: {path}")

    with open(path, "r", encoding="utf-8") as f:
        raw = f.read().replace("\r\n", "\n")

    if "\n\n" not in raw:
        raise ValueError(f"Kirjamallil puudub pealkirja ja keha vahel tühi rida: {path}")

    subject, body = raw.split("\n\n", 1)
    return (
        Template(subject.strip()).substitute(**context),
        Template(body.strip()).substitute(**context),
    )
