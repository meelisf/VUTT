"""Lehe teksti kanooniline kuju ja räsi — ühine `/save`-ile ja agendi
tekstiettepanekutele (#641). Ainult stdlib + marginaalia normaliseerija."""
import hashlib
import unicodedata

from .marginalia_normalize import normalize_marginalia_tags


def normalize_page_text(text):
    """Salvestatava lehe teksti kanooniline kuju: NFC + marginaalia-tägid (<m> välimiseks)."""
    if not text:
        return ""
    return normalize_marginalia_tags(unicodedata.normalize('NFC', text))


def text_hash(raw: str) -> str:
    """Räsi TÄPSELT antud toortekstist (UTF-8 baidid), mitte normaliseeritud
    kujust: kaks eri toorteksti võivad normaliseeruda samaks."""
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()
