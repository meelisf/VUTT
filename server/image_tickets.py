"""Admini pildipiletid (#764, N10-09).

`<img src>` ei kanna Authorization-päist. Varem käis sessioonitoken seepärast
päringustringis (`?token=`) ja jäi 24 h kehtivana nginxi access-logi. Pilet on
lühiajaline HMAC-allkiri, mis on seotud ÜHE ulatusega (`upload:<id>` või
`work:<id>`) ja annab ainult selle ulatuse admini-piltide lugemise — sama muster
mis pildiserveri `image:`- ja allalaadimise `download:`-allkiri, eri prefiks.
"""
import hashlib
import hmac
import re
import time

from .config import IMAGE_TOKEN_SECRET

TICKET_TTL = 3600
_SCOPE = re.compile(r"^(upload|work):[A-Za-z0-9_-]{1,64}$")


def is_valid_scope(scope) -> bool:
    return isinstance(scope, str) and bool(_SCOPE.match(scope))


def _sig(scope: str, exp: int) -> str:
    return hmac.new(IMAGE_TOKEN_SECRET.encode(), f"adminimg:{scope}:{exp}".encode(),
                    hashlib.sha256).hexdigest()


def issue(scope: str) -> dict:
    exp = int(time.time()) + TICKET_TTL
    return {"exp": exp, "sig": _sig(scope, exp)}


def is_valid(scope: str, exp, sig) -> bool:
    if not exp or not sig or not is_valid_scope(scope):
        return False
    try:
        exp_int = int(exp)
    except (TypeError, ValueError):
        return False
    if exp_int < int(time.time()):
        return False
    return hmac.compare_digest(_sig(scope, exp_int), str(sig))
