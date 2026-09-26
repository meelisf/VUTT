# server/prosopography/network_rules.py
"""Isikuseose liik rollipaarist (#461, ADR 0056).

ÜKS koht, kus rollipaar tõlgitakse seose liigiks. Reeglid kehtivad järjekorras;
esimene sobiv võidab. Suund: "ab" = a → b, "ba" = b → a, None = suunata.
Funktsioon on sümmeetriline: classify_pair(b, a) annab sama liigi ja pööratud suuna.
"""
from __future__ import annotations

from typing import Iterable, Optional

from ..config import get_logger

logger = get_logger(__name__)

KINDS = ("academic", "dedicated", "family", "cotext", "mention", "printer")

# `creator` on puuduva rolli vaikeväärtus (indices.py) — ka tema on looja.
CREATOR = frozenset({"praeses", "respondens", "auctor", "gratulator", "dedicator",
                     "editor", "aui", "creator"})
KNOWN = CREATOR | {"subject", "mentioned", "publisher"}

ACADEMIC_PAIRS = (("praeses", "respondens"), ("aui", "auctor"))
DEDICATED_CREATORS = CREATOR - {"dedicator"}   # pühendus on nõrk seos (spekk, otsus 5)
DEDICATED_PAIRS = tuple((c, "subject") for c in sorted(DEDICATED_CREATORS)) + (
    ("gratulator", "auctor"), ("gratulator", "respondens"))

_logged_unknown: set[str] = set()


def _direction(a: set, b: set, pairs) -> Optional[str] | bool:
    """"ab"/"ba"/None kui mõni paar sobib; False kui ükski ei sobi."""
    ab = any(p in a and q in b for p, q in pairs)
    ba = any(p in b and q in a for p, q in pairs)
    if ab and ba:
        return None
    if ab:
        return "ab"
    if ba:
        return "ba"
    return False


def classify_pair(a_roles: Iterable[str], b_roles: Iterable[str]) -> tuple[str, Optional[str]]:
    a_all, b_all = set(a_roles), set(b_roles)
    for role in (a_all | b_all) - KNOWN:
        if role not in _logged_unknown:
            _logged_unknown.add(role)
            logger.warning("Tundmatu roll seoste reeglites: %r (käsitletakse kaastekstina)", role)
    a, b = a_all & KNOWN, b_all & KNOWN

    d = _direction(a, b, ACADEMIC_PAIRS)
    if d is not False:
        return "academic", d
    d = _direction(a, b, DEDICATED_PAIRS)
    if d is not False:
        return "dedicated", d
    if (a & CREATOR and b & CREATOR) or _direction(a, b, (("dedicator", "subject"),)) is not False:
        return "cotext", None
    if "mentioned" in a or "mentioned" in b or ("subject" in a and "subject" in b):
        return "mention", None
    if "publisher" in a or "publisher" in b:
        return "printer", None
    return "cotext", None
