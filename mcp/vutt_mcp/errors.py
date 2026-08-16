"""Veatüübid.

Tööriistad TÕSTAVAD neid — MCP protokollikiht teeb sellest is_error=True
tulemuse, mida mudel loeb veana ja mille järel oskab päringut muuta. Stringi
"Error: ..." tagastamine näeks mudelile välja nagu õnnestunud tulemus.
"""


class VuttError(Exception):
    """Kõigi VUTT MCP vigade ülemtüüp."""


class VuttConfigError(VuttError):
    """Seadistusviga — puuduv või kehtetu võti. Ei ole korratav."""


class VuttTemporaryError(VuttError):
    """Ajutine tõrge (võrk, 5xx, 429). Agent võib hiljem uuesti proovida."""


class VuttNotFound(VuttError):
    """Küsitud ressurssi ei ole."""
