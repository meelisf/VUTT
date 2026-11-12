"""Isiku nimeajalugu (ADR 0083).

Kirjaviisi variandid jäävad `name.aliases`-sse (stringid). Liigiga nimi
(aadlinimi, ladinastatud kuju, abielunimi…) elab `name.names[]`-is:
`{label, type, from, to, source, notes}`. Kasutajale on see üks plokk
„Nimed ja nimekujud” — liigi määramine tõstab kuju aliastest `names`-i.

`looks_like_other_name` on sama reegel mis kliendi
`src/prosopography/utils/personNames.ts` — muuda mõlemat koos (testid jagavad
juhtumeid).
"""
from __future__ import annotations

import re
import unicodedata
from typing import Optional

NAME_TYPES = ("birth", "latinized", "ennobled", "married", "pseudonym", "religious", "other")

_PREFIX = 5
_RATIO = 0.6
# Ladina lõpud (võrdluskujul, u→v): Leiman/Leimonius, Lange/Langius on üks nimi.
_ENDINGS = ("ensis", "ivs", "ios", "vs", "is", "es", "s", "i", "o", "a", "e")
# Põlvkonna- ja muud tähised nime lõpus — mitte nimi.
_SUFFIXES = {"jun", "junior", "iun", "iunior", "sen", "senior", "jr", "sr", "filius", "pater", "dä", "dj"}


def _fold(token: str) -> str:
    """Tähtede võrdluskuju: diakriitikud maha, väiketähed, w/u→v, j/y→i, ph→f, ch/ck/c→k."""
    t = unicodedata.normalize("NFKD", token)
    t = "".join(c for c in t if c.isalpha() and not unicodedata.combining(c)).casefold()
    t = (t.replace("ph", "f").replace("ch", "k").replace("ck", "k").replace("c", "k")
          .replace("w", "v").replace("u", "v").replace("j", "i").replace("y", "i"))
    return t


def _stem(t: str) -> str:
    for e in _ENDINGS:
        if t.endswith(e) and len(t) - len(e) >= 3:
            return t[: -len(e)]
    return t


def _tokens(text: str) -> list[str]:
    return [f for f in (_fold(w) for w in (text or "").split()) if f]


def _name_tokens(text: str) -> list[str]:
    """Nime sõnad võrdluskujul ilma põlvkonnatähisteta („jun.”).

    Komaga kuju („Ammersbach, Heinrich, Ev. Theologe, …”, GND „Perekonnanimi,
    Eesnimi, kirjeldus”) → ainult osa enne esimest koma (perekonnanimi).
    """
    if "," in text:
        return _tokens(text.split(",", 1)[0])
    words = [w for w in text.split() if re.sub(r"[^\w]", "", w).casefold() not in _SUFFIXES]
    return [f for f in (_fold(w) for w in words) if f]


def _surname_part(tokens: list[str], had_comma: bool) -> list[str]:
    """Mitte-eesnimelised sõnad. Eesnimi on keelekuju (Olof/Olaus), mitte nimemuutus."""
    if had_comma or len(tokens) <= 1:
        return tokens
    return tokens[1:]


def _levenshtein(a: str, b: str) -> int:
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def _similar(a: str, b: str) -> bool:
    a, b = _stem(a), _stem(b)
    common = 0
    for ca, cb in zip(a, b):
        if ca != cb:
            break
        common += 1
    if common >= _PREFIX or (common == min(len(a), len(b)) and common >= 3):
        return True
    return 1 - _levenshtein(a, b) / max(len(a), len(b)) >= _RATIO


def looks_like_other_name(alias: str, label: str) -> bool:
    """Kas kuju näib olevat TEINE nimi, mitte kirjaviisi variant?

    Kuju on variant, kui ta sisaldab kanoonilise nime perekonnanime (ka lisatud
    päritolunimega, „Petrus Laurentii Arbogensis”) VÕI kui tema perekonnanimi
    sarnaneb kanoonilise nime mõne mitte-eesnimelise sõnaga. Ladina lõpud
    võetakse enne võrdlust maha. Keskmine eesnimi („Elisabeth”) varianti ei tee. Eesnimesid ei võrrelda: Olof/Olaus/Olov on keelekujud, mitte nimemuutus.
    Ainult vihje — otsustab toimetaja.
    """
    alias = alias or ""
    a = [t for t in _surname_part(_name_tokens(alias), "," in alias) if len(t) >= 3]
    lab = _name_tokens(label or "")
    b = _surname_part(lab, False) or lab
    if not a or not b:
        return False
    # Kuju sisaldab kanoonilist perekonnanime (ka lisatud päritolunimega) → variant
    if any(_similar(x, b[-1]) for x in a):
        return False
    # Kuju perekonnanimi sarnaneb mõne kanoonilise mitte-eesnimelise sõnaga → variant
    return not any(_similar(a[-1], y) for y in b)


def possible_name_change(name_obj: dict) -> bool:
    """Tööjärjekorra filter: mõni alias näib teise nimena ja nimeajalugu on tühi."""
    if name_obj.get("names"):
        return False
    label = name_obj.get("label") or ""
    return any(isinstance(a, str) and looks_like_other_name(a, label) for a in name_obj.get("aliases") or [])


def _year(v) -> Optional[int]:
    if isinstance(v, int) and not isinstance(v, bool):
        return v if 0 < v < 3000 else None
    if isinstance(v, str) and re.fullmatch(r"\s*\d{3,4}\s*", v):
        return int(v)
    return None


def _text(v) -> Optional[str]:
    return v.strip() or None if isinstance(v, str) else None


def _key(s: str) -> str:
    return unicodedata.normalize("NFC", s).strip().casefold()


def normalize_name_obj(name_obj: dict) -> dict:
    """Kliendi `name`-objekti `names[]` puhtaks; liigiga kujud aliastest välja.

    Ilma `names` võtmeta objekt jääb puutumata (vana klient ei kaota midagi).
    """
    if "names" not in name_obj:
        return name_obj
    raw = name_obj.get("names")
    if raw is None:
        raw = []
    if not isinstance(raw, list):
        raise ValueError("names_not_list")
    out, seen = [], set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        label = _text(item.get("label"))
        if not label:
            continue
        k = _key(label)
        if k in seen:
            continue
        seen.add(k)
        typ = item.get("type") if item.get("type") in NAME_TYPES else "other"
        out.append({
            "label": unicodedata.normalize("NFC", label),
            "type": typ,
            "from": _year(item.get("from")),
            "to": _year(item.get("to")),
            "source": _text(item.get("source")),
            "notes": _text(item.get("notes")),
        })
    result = {**name_obj, "names": out}
    if isinstance(name_obj.get("aliases"), list):
        result["aliases"] = [a for a in name_obj["aliases"] if not (isinstance(a, str) and _key(a) in seen)]
    return result
