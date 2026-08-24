"""Veatüübid.

Tööriistad TÕSTAVAD neid — MCP protokollikiht teeb sellest is_error=True
tulemuse, mida mudel loeb veana ja mille järel oskab päringut muuta. Stringi
"Error: ..." tagastamine näeks mudelile välja nagu õnnestunud tulemus.

MIKS `ToolError` alamtüüp: alates SDK 2.1.0-st jõuab mudelini AINULT
`ToolError`-i sõnum; iga muu erind on SDK jaoks krahh ja mudel näeb üldist
teksti "Error executing tool <nimi>". Meie veateated ongi juhised agendile
("tundmatu work_id — kasuta search_works", "korraga kuni 20 lehte"), seega
peavad nad kohale jõudma. SDK 2.0-l on käitumine sama, see alamtüüp lihtsalt
teeb kavatsuse selgeks.
"""
from mcp.server.mcpserver.exceptions import ToolError


class VuttError(ToolError):
    """Kõigi VUTT MCP vigade ülemtüüp."""


class VuttConfigError(VuttError):
    """Seadistusviga — puuduv või kehtetu võti. Ei ole korratav."""


class VuttTemporaryError(VuttError):
    """Ajutine tõrge (võrk, 5xx, 429). Agent võib hiljem uuesti proovida."""


class VuttNotFound(VuttError):
    """Küsitud ressurssi ei ole."""
