"""Kreeka keele tuvastus teksti tähemärgistiku järgi.

Puhas loogika — ei loe faile ega puutu metaandmeid, et oleks täielikult
ühiktestitav. Kasutaja: scripts/detect_greek.py.

Miks tähemärgistik, mitte keeletuvastusmudel: kreeka (ja heebrea) on ainsad
korpuses esinevad keeled, mis kasutavad ladinast erinevat tähestikku. Ladina,
saksa, rootsi ja eesti eristamine nõuaks mudelit — see on eraldi projekt.
"""
import re
from typing import Dict, List, Tuple

# Greek and Coptic (U+0370–U+03FF) + Greek Extended (U+1F00–U+1FFF).
# Extended plokk on hädavajalik: varauusaegne kreeka on polütooniline,
# ehk enamik täishäälikuid kannab diakriitikuid ja elab just seal.
_GREEK_RE = re.compile(r"[Ͱ-Ͽἀ-῿]")

# Ladina tähestik koos Latin-1 lisadega (ä, ö, ü, é …).
_LATIN_RE = re.compile(r"[A-Za-zÀ-ÿ]")

# Lehekülg loetakse kreekakeelseks, kui MÕLEMAD tingimused kehtivad.
# Osakaalu lävend eraldab kreekakeelse teksti kreeka tsitaadist ladinakeelses
# töös (mõõdetud 2026-08-11: tsitaadilehed jäävad 3–5 % juurde).
GREEK_RATIO_THRESHOLD = 0.20
# Tähemärgi-valvur ei muuda praegustes andmetes ühtki otsust. Ta on siin
# tulevaste OCR-tulemuste vastu: lühikesel tiitellehel annaks üksik
# kreekakeelne moto kunstlikult kõrge osakaalu.
GREEK_MIN_CHARS = 20


def greek_ratio(text: str) -> Tuple[int, float]:
    """Tagastab (kreeka tähemärkide arv, osakaal kreeka+ladina tähtedest).

    Osakaalu nimetajas on ainult tähed — numbrid, kirjavahemärgid ja
    tühikud jäetakse välja, sest need ei kanna keeleinfot ja nende osakaal
    kõigub lehe kujunduse järgi.
    """
    greek = len(_GREEK_RE.findall(text))
    latin = len(_LATIN_RE.findall(text))
    total = greek + latin
    if total == 0:
        return 0, 0.0
    return greek, greek / total


def page_is_greek(text: str) -> bool:
    """Kas lehekülg loetakse kreekakeelseks?"""
    count, ratio = greek_ratio(text)
    return count >= GREEK_MIN_CHARS and ratio >= GREEK_RATIO_THRESHOLD


def work_qualifies(pages: Dict[str, str]) -> Tuple[bool, List[str]]:
    """Kas teos saab `grc` märgendi?

    Sisend: {failinimi: lehe tekst}.
    Tagastab (kas läbib, kvalifitseeruvate failinimede sorteeritud loend).

    Reegel B (vt ADR 0019): piisab ÜHEST kreekakeelsest leheküljest. See on
    tahtlik — ladinakeelne köide, mille lk 7 on kreekakeelne gratulatsioon,
    ON kreeka korpuse osa.
    """
    hits = sorted(name for name, text in pages.items() if page_is_greek(text))
    return bool(hits), hits


def add_language(meta: dict, code: str) -> bool:
    """Lisab keelekoodi `languages` massiivi. Muudab `meta`-t kohapeal.

    Tagastab True, kui midagi muutus. RANGELT LISAV — olemasolevaid keeli
    ei eemaldata kunagi. Idempotentne: teistkordne kutse tagastab False,
    seega kordusjooks ei tekita git-commiti.
    """
    current = meta.get("languages")
    if current is None:
        current = []
    elif isinstance(current, str):
        # Vana andmestik võis kanda stringi massiivi asemel
        current = [current]
    elif not isinstance(current, list):
        current = []

    if code in current:
        meta["languages"] = current
        return False

    meta["languages"] = current + [code]
    return True
