"""Suhtelise `<cs>` teisendus absoluutseks `<f>`-iks (ADR 0077) + migratsiooni manifest.

ÜKS teisendusfunktsioon (`cs_to_f`) kõigile teedele: migratsiooniskript,
ajaloo taastamine (`/git-restore`), vana mudeli väljundi import üleminekuajal.

Manifest (`data/config/migrations/0077-f.json`) on teisendatuse tunnus — MITTE
`<f>`-i olemasolu: fraktuurteose täielikult antiikvas leht teisendub
`<cs>ABC</cs>` → `ABC` ja korduskäivitus loeks selle muidu teisendamata
fraktuuriks. Manifest EI OLE põhikirja väli andmemudelis: seda loeb ainult
üleminekukiht.

Ainult stdlib: moodulit impordib ka standalone migratsiooniskript.
"""
import hashlib
import json
import os
import re
import unicodedata

from .config import DATA_CONFIG_DIR

MANIFEST_PATH = os.path.join(DATA_CONFIG_DIR, "migrations", "0077-f.json")

_TOKEN_RE = re.compile(r"<(/?)([a-z]+)(\d*)(/?)>")
_TRAILING_CLOSE_RE = re.compile(r"(?:</[a-z]+\d*>|\s)+$")


def text_hash(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


def _is_latin(ch: str) -> bool:
    return ch.isalpha() and unicodedata.name(ch, "").startswith("LATIN")


def _wrap_runs(segment: str) -> str:
    """Mähib segmendi fraktuurijooksud `<f>`-i: jooks on maksimaalne jupp ilma
    mitteladina täheta (kreeka/heebrea katkestab), servatühik väljas, vähemalt üks
    ladina täht. Numbrid ja kirjavahemärgid jooksu sees JA servas jäävad sisse
    (`<f>(Gott sey Lob).</f>`, `<f>Ge⸗</f>`); ainult neist koosnev jupp jääb
    märgendamata (ADR 0077 p 3, 6.4)."""
    out = []
    piece = []

    def flush():
        if not piece:
            return
        s = "".join(piece)
        core = s.strip()
        if core and any(_is_latin(c) for c in core):
            lead = s[: len(s) - len(s.lstrip())]
            trail = s[len(s.rstrip()):]
            out.append(f"{lead}<f>{core}</f>{trail}")
        else:
            out.append(s)
        piece.clear()

    for ch in segment:
        if ch.isalpha() and not _is_latin(ch):
            flush()
            out.append(ch)
        else:
            piece.append(ch)
    flush()
    return "".join(out)


def cs_to_f(text: str, base: str) -> str:
    """Teisendab suhtelise `<cs>` märgenduse absoluutseks `<f>`-iks.

    base: teose põhikiri, 'A' (antiikva) või 'F' (fraktuur).
    - kiri = fraktuur, kui (base == 'F') XOR (`<cs>` avatud);
    - `<i>` sisu on alati antiikva (gooti kirjal kursiivi ei ole, `<f>`/`<i>`
      välistavad teineteist); `<fn>` sisu ei märgita;
    - `<f>` mähib ainult tekstisegmente tägide vahel: ta jääb struktuuri- ja
      stiilitägide SISSE (`<catch><f>Vor⸗</f></catch>`) ega ületa reapiiri;
    - `<cs>` tokenid kaovad, kõik muud tokenid jäävad.
    Juba `<f>`-iga tekst (absoluutne) tagastatakse muutmata.
    """
    if base not in ("A", "F"):
        raise ValueError(f"tundmatu põhikiri: {base!r}")
    if "<f>" in text and "<cs>" not in text:
        return text
    open_counts = {"cs": 0, "i": 0, "fn": 0}
    out = []
    pos = 0

    def emit_text(seg: str):
        if not seg:
            return
        if open_counts["fn"]:
            out.append(seg)
            return
        fraktur = (base == "F") != bool(open_counts["cs"])
        if open_counts["i"] or not fraktur:
            out.append(seg)
            return
        out.append("\n".join(_wrap_runs(line) for line in seg.split("\n")))

    for m in _TOKEN_RE.finditer(text):
        emit_text(text[pos:m.start()])
        pos = m.end()
        closing, name, self_closing = m.group(1) == "/", m.group(2), m.group(4) == "/"
        if name in open_counts and not self_closing:
            open_counts[name] = max(0, open_counts[name] + (-1 if closing else 1))
        if name == "cs":
            continue
        out.append(m.group(0))
    emit_text(text[pos:])
    return "".join(out)


def hyphen_signal(texts) -> tuple:
    """Põhikirja signaal rea lõpu poolitusmärgist: (fraktuur, antiikva).

    Rea viimane nähtav märk enne sulgevaid täge; `-` ainult tähe järel (`1640-` ei
    ole poolitus). `⸗` väljaspool `<cs>`-i või `-` sees → fraktuur; vastupidi →
    antiikva (juhis seob `⸗` fraktuuri ja `-` antiikvaga)."""
    f = a = 0
    for text in texts:
        cs_open = 0
        for line in (text or "").split("\n"):
            core = _TRAILING_CLOSE_RE.sub("", line)
            # <cs> olek rea lõpus (enne sulgevaid täge)
            for m in _TOKEN_RE.finditer(core):
                if m.group(2) == "cs":
                    cs_open = max(0, cs_open + (-1 if m.group(1) else 1))
            if core.endswith("⸗"):
                kind = "F"
            elif len(core) >= 2 and core.endswith("-") and core[-2].isalpha():
                kind = "A"
            else:
                kind = None
            if kind is None:
                pass
            elif (kind == "F") != bool(cs_open):
                f += 1
            else:
                a += 1
            # sulgevad tägid rea lõpus
            for m in _TOKEN_RE.finditer(line[len(core):]):
                if m.group(2) == "cs":
                    cs_open = max(0, cs_open + (-1 if m.group(1) else 1))
    return f, a


def infer_base(texts):
    """('F'|'A'|None, fraktuur, antiikva). None = signaal puudub või vastuoluline
    → inimene otsustab (ADR 0077 p 6.2)."""
    f, a = hyphen_signal(texts)
    if f and not a:
        return "F", f, a
    if a and not f:
        return "A", f, a
    return None, f, a


# --- Manifest ---

def load_manifest(path: str = MANIFEST_PATH) -> dict:
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"version": 1, "works": {}}
    data.setdefault("works", {})
    return data


def work_entry(work_id: str, manifest: dict | None = None) -> dict | None:
    m = manifest if manifest is not None else load_manifest()
    return m["works"].get(work_id)


def is_premigration_base(work_id: str, filename: str, base_text: str,
                         manifest: dict | None = None) -> bool:
    """Kas kliendi `base` on migratsioonieelne tekst (vananenud redaktoriseanss)."""
    entry = work_entry(work_id, manifest)
    if not entry:
        return False
    page = entry.get("pages", {}).get(filename)
    if not page or page.get("in") == page.get("out"):
        return False
    return text_hash(base_text) == page.get("in")
