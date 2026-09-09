"""Kirjamallide laadimine ja renderdus.

Mallid on repos tekstifailidena (`server/email_templates/{nimi}.{keel}.txt`):
esimene rida = pealkiri, tühi rida, ülejäänu = keha. Platseholderid on
`string.Template` kujul (`$name`), sest stdlib katab vajaduse ja uut sõltuvust
ei ole vaja.

Kuupäevi mallides ei ole — kuupäev on lokaaditundlik ja tekitaks küsimuse,
kas vormindada „05.09.2026 kell 18:00" või „Sep 5, 2026". Kui mall siiski
kunagi kuupäeva vajab, vormindab selle KUTSUJA saaja keeles ja annab mallile
valmis stringi; `render_mail` ei võta vastu `datetime`-i. Vormindaja ise elab
siin (`format_mail_date`), et kuupäeva kuju oleks testitav ilma routerita.
"""
import os
from datetime import datetime
from string import Template
from typing import Tuple

from .config import get_logger
from .user_language import normalize_language

logger = get_logger(__name__)

TEMPLATE_DIR = os.path.join(os.path.dirname(__file__), "email_templates")

# mailto: URL-i eelarve. Outlook lõikab pika URL-i vaikselt katki, seega on
# see mõõdetav lävi (vt tests/test_mail_templates.py), mitte soovitus.
MAILTO_BUDGET = 1800


# Kuupäev kirjas on ÄRATUNDMISEKS („kas ma tõesti esitasin taotluse siis?"),
# mitte auditiks, seega KELLAAEGA EI OLE. Backend-konteiner jookseb UTC-s ja
# host EEST-is; kellaaja näitamine tähendaks kolme tunni võrra vale numbrit
# ilma ajavööndi-teisenduseta, mida selles koodibaasis kuskil ei tehta.
# Sama põhjusega on hilisõhtune taotlus võimalik näidata eelmise päevaga —
# äratundmiseks piisab, täpsuseks ei kõlba.
_MONTHS_ET = (
    "jaanuaril", "veebruaril", "märtsil", "aprillil", "mail", "juunil",
    "juulil", "augustil", "septembril", "oktoobril", "novembril", "detsembril",
)
_MONTHS_EN = (
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
)


def format_mail_date(value, lang) -> str:
    """Kuupäev saaja keeles: „5. septembril 2026" / „5 September 2026".

    `value` on `datetime` või ISO-string (`submitted_at` on kettal stringina).
    Loetamatu väärtus annab tühja stringi, MITTE erindi: kuupäev on kirjas
    kaunistus ja tema pärast ei tohi kutse saatmata jääda.
    """
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value)
        except ValueError:
            logger.warning("Kirja kuupäeva ei õnnestunud lugeda: %r", value)
            return ""
    if not isinstance(value, datetime):
        return ""

    if normalize_language(lang) == "et":
        return f"{value.day}. {_MONTHS_ET[value.month - 1]} {value.year}"
    return f"{value.day} {_MONTHS_EN[value.month - 1]} {value.year}"


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
