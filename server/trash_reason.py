"""Prügikasti kirje liik: mis operatsioon selle faili sinna pani (#325).

Liik loetakse kustutamise commiti SÕNUMIST. Sõnumit ei saa tagantjärele muuta,
seega on prefiksid AJALOOLINE FORMAAT: uue sõnastuse kasutuselevõtt tähendab
nimekirja LISAMIST, mitte asendamist.
"""
from typing import Optional

# Sõnumi algus, mida UUED commitid kasutavad.
SPLIT_COMMIT_PREFIX = "Lõika leht"
DELETE_COMMIT_PREFIX = "Kustuta"

# AJALOOLINE FORMAAT — need stringid on juba git-ajaloos. EI TOHI muuta ega
# eemaldada; vastasel korral muutuvad varem tehtud commitid `unknown`-iks ja
# nende lehtede taastamine kaob.
SPLIT_PREFIXES_AJALUGU = (SPLIT_COMMIT_PREFIX,)
DELETE_PREFIXES_AJALUGU = (DELETE_COMMIT_PREFIX,)


def liigita(commit_sonum: Optional[str]) -> str:
    """→ 'split' | 'deleted' | 'unknown'."""
    if not commit_sonum:
        return "unknown"
    sonum = commit_sonum.strip()
    if sonum.startswith(SPLIT_PREFIXES_AJALUGU):
        return "split"
    if sonum.startswith(DELETE_PREFIXES_AJALUGU):
        return "deleted"
    return "unknown"


def on_taastatav(liik: str) -> bool:
    """Ainult päris kustutatud leht on taastatav.

    Poolituse jääk on kahe elava lehe LÄHTEPILT — tema tagasitoomine annaks
    sama sisu kolmandat korda ja kaks lehte sama `sequence`-iga. Tundmatu
    päritolu on sama risk ilma teadmiseta.
    """
    return liik == "deleted"
