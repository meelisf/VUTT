"""Käsikirja lehe aadress ja osa aadressiviide (#630 spekk 2, ADR 0070).

Puhas moodul (side-effect-vaba, nagu `meili_doc.py`): sisend on tüvede järjekord,
tüve → lehe tekst ja skeem; väljund on osade viited. I/O teeb route.

v1: ainult käsikirjad (`type.id == Q87167`) ja määratud skeem (`page_numbering`).
Aadress tuleb lehe esimesest `<fw>`-st; tähistuseta leht saab aadressi AINULT
ühe sammu edasituletusega eelmiselt nähtavalt lehelt (tuletatud = nurksulgudes).
Kahtluse korral `?`, mitte vale aadress.
"""
import re
from typing import Optional

from .vutt_tags import _PB_RE, page_mark_entries

MANUSCRIPT_TYPE = "Q87167"   # sama mis work_relations_ops.MANUSCRIPT_TYPE
SCHEMES = ("foliation", "pagination")
PREFIX = {"foliation": "fol.", "pagination": "p."}

_FOLIO_RE = re.compile(r"^(\d+)\s*([rv])?$", re.IGNORECASE)
_PAGE_RE = re.compile(r"^(\d+)$")


def clean_page_numbering(value):
    """`/update-work-metadata` valideerimine: `foliation` | `pagination` | None (ka "")."""
    if value in (None, ""):
        return None
    if value not in SCHEMES:
        raise ValueError(f"Tundmatu lehenummerdus: {value!r}")
    return value


def work_scheme(meta: dict) -> Optional[str]:
    """Skeem, mille järgi aadress arvutatakse; None = aadressi ei tehta.
    Trükisel (või kui tüüp hiljem muutus) jääb väli alles, aga ei rakendu."""
    t = meta.get("type")
    if not (isinstance(t, dict) and t.get("id") == MANUSCRIPT_TYPE):
        return None
    scheme = meta.get("page_numbering")
    return scheme if scheme in SCHEMES else None


# ── Lehe olek ────────────────────────────────────────────────────────────────
# Olek on ('spread' | 'unparsable' | 'blank' | 'unknown', None) või ('visible', aadress).
# Aadress: (n, side) foliatsioonis, (n, None) paginatsioonis.

def parse_mark(text: str, scheme: str):
    """`<fw>` sisu → aadress või None (parsimatu). Rooma, `Fol. 3a`, `86a`, `[12]`, `0` → None."""
    m = (_FOLIO_RE if scheme == "foliation" else _PAGE_RE).match(text.strip())
    if not m or int(m.group(1)) < 1:
        return None
    if scheme == "foliation":
        return (int(m.group(1)), (m.group(2) or "r").lower())
    return (int(m.group(1)), None)


def page_state(text: Optional[str], scheme: str):
    if text is None:
        return ("unknown", None)          # lugemata/loetamatu: ei ole allikas ega takista kontrolli
    if _PB_RE.search(text):
        return ("spread", None)
    fws = [e["text"] for e in page_mark_entries(text) if e["kind"] == "fw"]
    if not fws:
        return ("blank", None)
    addr = parse_mark(fws[0], scheme)     # teised <fw>-d samal lehel ei lähe arvesse (v1)
    return ("visible", addr) if addr else ("unparsable", None)


def successor(addr, scheme: str):
    n, side = addr
    if scheme == "pagination":
        return (n + 1, None)
    return (n, "v") if side == "r" else (n + 1, "r")


def page_addresses(stems: list, texts: dict, scheme: str, indices) -> dict:
    """Indeks → (aadress, tuletatud) või None (teadmata). `texts` peab katma iga
    indeksi ja selle otsesed naabrid (vt `needed_stems`)."""
    states = {}

    def state(i):
        if i < 0 or i >= len(stems):
            return ("unknown", None)
        if i not in states:
            states[i] = page_state(texts.get(stems[i]), scheme)
        return states[i]

    out = {}
    for i in indices:
        kind, addr = state(i)
        if kind == "visible":
            out[i] = (addr, False)
            continue
        out[i] = None
        if kind != "blank":
            continue
        # Üks samm, ainult edasi, ainult eelmiselt NÄHTAVALT lehelt. Foliatsioonis
        # ainult rectolt: verso ja tema recto on sama leht, järgmine recto juba teine.
        pk, prev = state(i - 1)
        if pk != "visible" or (scheme == "foliation" and prev[1] != "r"):
            continue
        cand = successor(prev, scheme)
        # Nähtav järgmine leht, mis ei ole kandidaadi järglane, näitab hüpet → `?`.
        nk, nxt = state(i + 1)
        if nk == "visible" and nxt != successor(cand, scheme):
            continue
        out[i] = (cand, True)
    return out


# ── Osa viide ────────────────────────────────────────────────────────────────

def _segments(indices: list) -> list:
    """Katkematud VUTT-i lõigud (sama jaotus mis kliendi `pageRangeList`)."""
    segs = []
    for i in sorted(set(indices)):
        if segs and segs[-1][-1] == i - 1:
            segs[-1].append(i)
        else:
            segs.append([i])
    return segs


def _fmt(addr, derived: bool) -> str:
    n, side = addr
    s = f"{n}{side or ''}"
    return f"[{s}]" if derived else s


def _addr_json(addr, derived: bool, scheme: str) -> dict:
    d = {"scheme": scheme, "n": addr[0]}
    if addr[1]:
        d["side"] = addr[1]
    d["derived"] = derived
    return d


def part_reference(part_pages: list, stems: list, addresses: dict, scheme: str) -> Optional[dict]:
    """Osa viide `{text, ranges}` või None, kui ühelgi lehel aadressi pole.

    Viide kirjeldab kontrollitud vahemikke: VUTT-i lõik jagatakse igal kohal, kus
    aadress ei ole eelmise järglane; teadmata leht katkestab alati (`?`)."""
    pos = {s: i for i, s in enumerate(stems)}
    idx = [pos[s] for s in part_pages if s in pos]
    runs = []        # [alg_i, lõpp_i, alg_aadress|None, lõpp_aadress|None]
    for seg in _segments(idx):
        prev = None  # eelmine teadmata-või-aadress selles lõigus
        for i in seg:
            a = addresses.get(i)
            if a is None:
                if runs and prev == "?":
                    runs[-1][1] = i
                else:
                    runs.append([i, i, None, None])
                prev = "?"
                continue
            if prev not in (None, "?") and a[0] == successor(prev[0], scheme):
                runs[-1][1] = i
                runs[-1][3] = a
            else:
                runs.append([i, i, a, a])
            prev = a
    if not any(r[2] for r in runs):
        return None
    parts, ranges = [], []
    for fi, ti, fa, ta in runs:
        if fa is None:
            parts.append("?")
        elif fi == ti:
            parts.append(_fmt(*fa))
        else:
            parts.append(f"{_fmt(*fa)}–{_fmt(*ta)}")
        ranges.append({
            "from_page": fi + 1, "to_page": ti + 1,
            "from_stem": stems[fi], "to_stem": stems[ti],
            "from": _addr_json(*fa, scheme) if fa else None,
            "to": _addr_json(*ta, scheme) if ta else None,
        })
    return {"text": f"{PREFIX[scheme]} {', '.join(parts)}", "ranges": ranges}


def needed_stems(stems: list, parts: list) -> set:
    """Tüved, mille tekst tuleb lugeda: kõik osade lehed + iga lehe otsesed naabrid."""
    pos = {s: i for i, s in enumerate(stems)}
    need = set()
    for p in parts:
        for s in p.get("pages") or []:
            i = pos.get(s)
            if i is None:
                continue
            for j in (i - 1, i, i + 1):
                if 0 <= j < len(stems):
                    need.add(stems[j])
    return need


def part_addresses(stems: list, texts: dict, parts: list, scheme: str) -> dict:
    """osa id → viide; ilma viiteta osa puudub."""
    pos = {s: i for i, s in enumerate(stems)}
    used = {pos[s] for p in parts for s in p.get("pages") or [] if s in pos}
    addresses = page_addresses(stems, texts, scheme, used)
    out = {}
    for p in parts:
        ref = part_reference(p.get("pages") or [], stems, addresses, scheme)
        if ref:
            out[p["id"]] = ref
    return out
