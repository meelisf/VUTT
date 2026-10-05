"""Lühendusmärk → makron (ADR 0062, #533).

Rõhtjoon tähe kohal (lühend, geminatsioonikriips) on U+0304 COMBINING MACRON.
Teisendatakse ainult LADINA tähe kohal:
  U+0303 tilde     → U+0304   (ũ ñ õ m̃ …; precomposed lagundatakse NFD-ga)
  U+0305 ülakriips → U+0304
  topeltmakron     → üks
Puutumata: kreeka (U+0342 ja tilde kreeka tähel), numbrite vinculum, eraldiseisev „~".
Väljund NFC (ā ē ī ō ū precomposed, m̄ n̄ q̄ kombineeriv).

SAMA kaart on LOSS-i `scripts/lyhend_makron.py`-s (Kurrendi treeningandmed) ja
redaktori `src/utils/macron.ts`-is — muutes muuda kõiki (testid kordavad juhtumeid).

Keelevalvur (ADR 0062 p 3): eesti, hispaania ja portugali keeles on tilde päris
täht (õ, ñ, ã). Teost, mille `languages` sisaldab mõnda neist, ei teisendata
automaatselt — `convert_text` tagastab siis tildega sõnad aruande jaoks.
"""
import json
import os
import re
import unicodedata as ud

from .config import get_logger

logger = get_logger(__name__)

TILDE, MACRON, OVERLINE = "\u0303", "\u0304", "\u0305"

# ADR 0019: `languages` kannab nii 2- kui 3-tähelisi koode (la/lat, de/ger)
GUARDED_LANGUAGES = frozenset({"est", "et", "spa", "es", "por", "pt"})

# \w ei sobitu kombineerivate märkidega — NFD sõnas peavad need olema kaasas
_WORD = re.compile(r"[\w\u0300-\u036f]+")


def _is_latin_letter(ch):
    return ch.isalpha() and "LATIN" in ud.name(ch, "")


def to_macron(text):
    """Tagastab (uus_tekst, muudetud_märkide_arv). Muutuseta tekst tuleb tagasi
    NFC-na; arv 0 ei tähenda, et NFC midagi ei muutnud."""
    s = ud.normalize("NFD", text)
    out, changed, base = [], 0, ""
    for ch in s:
        if ud.combining(ch) == 0:
            base = ch
            out.append(ch)
            continue
        if ch in (TILDE, OVERLINE) and _is_latin_letter(base):
            ch = MACRON
            changed += 1
        if ch == MACRON and out and out[-1] == MACRON:
            changed += 1                       # topeltmakron → üks
            continue
        out.append(ch)
    return ud.normalize("NFC", "".join(out)), changed


def is_guarded(languages):
    """Kas teose keelte hulgas on keel, kus tilde on päris täht."""
    return any(str(code).strip().lower() in GUARDED_LANGUAGES for code in languages or [])


def tilde_words(text):
    """Sõnad, kus ladina tähe kohal on tilde või ülakriips (aruande jaoks)."""
    words = []
    for m in _WORD.finditer(ud.normalize("NFD", text)):
        base = ""
        for ch in m.group(0):
            if ud.combining(ch) == 0:
                base = ch
            elif ch in (TILDE, OVERLINE) and _is_latin_letter(base):
                words.append(ud.normalize("NFC", m.group(0)))
                break
    return words


def convert_text(text, languages):
    """Lehe tekst teose keelte järgi.

    Tagastab (uus_tekst, muudetud_märkide_arv, aruande_sõnad):
      - valvuriga keel → tekst muutumata, 0, tildega sõnad käsitsi otsustamiseks
      - muidu → to_macron, aruanne tühi
    """
    if is_guarded(languages):
        return text, 0, tilde_words(text)
    new, n = to_macron(text)
    return new, n, []


def work_languages(work_dir):
    """Teose `languages` tema `_metadata.json`-ist; lugemata metaandmed → None.
    None EI OLE tühi loend: keelt teadmata ei tohi valvurit vahele jätta."""
    try:
        with open(os.path.join(work_dir, "_metadata.json"), encoding="utf-8") as f:
            langs = json.load(f).get("languages")
    except (OSError, ValueError, AttributeError):
        return None
    return langs if isinstance(langs, list) else []


def convert_ocr_text(text, languages, context=""):
    """OCR-väljundi järeltöötlus (ADR 0062 samm b): kuni uue mudelini kirjutab
    OCR tildet, see ei tohi korpusesse uut kuju tuua. Valvuriga keele tildega
    sõnad logitakse — korpuse migratsiooni aruanne (samm 5) leiab nad uuesti.

    `languages is None` (keel teadmata) → tekst muutumata: tilde jääb migratsioonile,
    vale teisendus (eesti õ → ō) oleks hullem."""
    if languages is None:
        logger.warning("Makron: teose keeled teadmata, OCR-tekst teisendamata (%s)", context)
        return text
    new, _, report = convert_text(text, languages)
    if report:
        logger.info(
            "Makron: valvuriga keel, %d tildega sõna jäi teisendamata (%s): %s",
            len(report), context, ", ".join(report[:10]))
    return new
