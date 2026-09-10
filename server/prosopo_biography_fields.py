"""Eluloo keeleväljade nimed, AA-klassifikaator ja vananemisankru räsi.

AINULT stdlib. Seda moodulit impordib nii backend kui `scripts/`-i
migratsiooniskript, mis jookseb hosti venv-is ilma FastAPI ja gitpythonita.

Miks eraldi moodul, mitte `person_crud`-i sees: `person_crud` tõmbab kaasa
`state`, `indices`, `entity_labels_ops` — migratsiooniskript ei tohi neist
sõltuda (vt `scripts/detect_greek.py` fake-package muster).
"""
from __future__ import annotations

import hashlib
import re
from typing import List, Optional

BIOGRAPHY_ET = "biography_et"
BIOGRAPHY_EN = "biography_en"
AA_RAW = "aa_raw"
SRC_ET = "biography_et_src"
SRC_EN = "biography_en_src"
LEGACY_BIOGRAPHY = "biography"

TEXT_FIELDS = (BIOGRAPHY_ET, BIOGRAPHY_EN, AA_RAW)
ANCHOR_FIELDS = (SRC_ET, SRC_EN)

# Keeleväli → tema ankur.
ANCHOR_OF = {BIOGRAPHY_ET: SRC_ET, BIOGRAPHY_EN: SRC_EN}
# Ankur → väli, MILLE räsi ta kannab. Suunad on RISTIS: ingliskeelse teksti
# ankur kinnitab vastavust EESTIKEELSELE tekstile.
ANCHOR_SOURCE = {SRC_ET: BIOGRAPHY_EN, SRC_EN: BIOGRAPHY_ET}

HASH_LENGTH = 12


def text_hash(text: Optional[str]) -> str:
    """Teksti räsi ankru jaoks: sha256 esimesed 12 hex-märki.

    Ümbritsev tühik lubjatakse — reavahetus teksti lõpus ei ole sisuline
    muudatus ja ei tohi vale hoiatust tekitada.
    """
    normaliseeritud = (text or "").strip()
    return hashlib.sha256(normaliseeritud.encode("utf-8")).hexdigest()[:HASH_LENGTH]


# AA-kirje algus. NB: kontrollime ALGUST, mitte „sisaldab kuskil" — proosa,
# mis tsiteerib AA-kirjet, on elulugu.
_AA_PAIS = re.compile(r"^\s*Immatrikuleerimise\s+kuupäev\s*:", re.I)
_AA_DEP = re.compile(r"^\s*AG\s*:\s*Dep\.", re.I)
# „154. Lünaeus (…), Emundus, Smål., * 1604, † 1693."
_AA_NUMBER = re.compile(r"^\s*\d{1,4}\.\s+[A-ZÄÖÜÕŠŽ]")
# Numbriga algav rida vajab kinnitust: paljas „1759. aastal…" on aastaarv,
# mitte kirje number (sama lõks mis `escapeAccidentalOrderedLists` frontendis).
_AA_KINNITUS = re.compile(r"(†|\*\s*1\d{3}|\bAG\s*:|\bImm\.|\bDep\.)")
_AA_KINNITUSE_AKEN = 300

# Marker kuskil tekstis (kahtluse lipu jaoks, mitte klassifitseerimiseks).
_AA_MARKER_UKSKOIK_KUS = re.compile(
    r"(Immatrikuleerimise\s+kuupäev\s*:|\bAG\s*:\s*Dep\.)", re.I)

# Kaheksa järjestikust puhast sõna — AA-kirjes on lühendeid ja numbreid nii
# tihedalt, et selline jada on seal ebatavaline.
_PROOSA = re.compile(r"(?:\b[A-Za-zÄÖÜÕäöüõŠšŽž]{2,}\s+){8,}")
_MARKDOWN = re.compile(r"(\*\*|~~|^\s{0,3}#{1,6}\s|\]\()", re.M)


def is_aa_record(text: Optional[str]) -> bool:
    """Kas tekst ALGAB Album Academicumi kirjena?"""
    if not text or not text.strip():
        return False
    if _AA_PAIS.search(text) or _AA_DEP.search(text):
        return True
    if _AA_NUMBER.search(text) and _AA_KINNITUS.search(text[:_AA_KINNITUSE_AKEN]):
        return True
    return False


def classify(text: Optional[str]) -> Optional[str]:
    """Vana `biography` sisu → sihtväli. None, kui sisu ei ole."""
    if not text or not text.strip():
        return None
    return AA_RAW if is_aa_record(text) else BIOGRAPHY_ET


def suspicion_flags(text: str, target: str, aa_median: int) -> List[str]:
    """Kahtluse lipud kuivkäivituse aruandele. Lipp ei ole viga, vaid vaatamiskoht."""
    lipud: List[str] = []
    sisu = text or ""

    marker = _AA_MARKER_UKSKOIK_KUS.search(sisu)
    if marker and marker.start() > 0:
        lipud.append("marker_ei_ole_alguses")

    if target == AA_RAW:
        if _MARKDOWN.search(sisu):
            lipud.append("markdown")
        if _PROOSA.search(sisu):
            lipud.append("proosa_aa_kirjes")
        if aa_median > 0 and not (0.2 * aa_median <= len(sisu) <= 5 * aa_median):
            lipud.append("pikkus_kahtlane")

    return lipud


__all__ = [
    "BIOGRAPHY_ET", "BIOGRAPHY_EN", "AA_RAW", "SRC_ET", "SRC_EN",
    "LEGACY_BIOGRAPHY", "TEXT_FIELDS", "ANCHOR_FIELDS", "ANCHOR_OF",
    "ANCHOR_SOURCE", "HASH_LENGTH", "text_hash", "is_aa_record", "classify",
    "suspicion_flags",
]
