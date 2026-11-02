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
from typing import Optional
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


_EDITORIAL_RE = re.compile(r"\[[^\]\n]*\]")
_EMPTY_I_RE = re.compile(r"<i>([ \t]*)</i>")


def _wrap_runs(segment: str) -> str:
    """Toimetaja märge nurksulgudes (`[tühi lehekülg]`, `[vasakpoolne lk]`) ei ole trükitekst
    ega lähe `<f>`-i — tühja lehe märgend peab jääma baidi-täpseks."""
    out, pos = [], 0
    for m in _EDITORIAL_RE.finditer(segment):
        out.append(_wrap_runs_plain(segment[pos:m.start()]))
        out.append(m.group(0))
        pos = m.end()
    out.append(_wrap_runs_plain(segment[pos:]))
    return "".join(out)


def _wrap_runs_plain(segment: str) -> str:
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
    - `<cs>`/`<i>` pesastuses otsustab SISEMINE täg: `<i>` sees on antiikva (gooti
      kirjal kursiivi ei ole, `<f>`/`<i>` välistavad teineteist), aga `<cs>`
      kursiivi sees on antiikvateoses fraktuurisõna kursiivlõigus — kursiiv
      tükeldatakse ümber `<f>`-i (`<i>ne in </i><f>Frödzwijck</f><i> &c.</i>`).
      Fraktuurteoses tähendab kursiivisisene `<cs>` antiikvat. `<fn>` sisu ei märgita;
    - `<f>` mähib ainult tekstisegmente tägide vahel: ta jääb struktuuri- ja
      stiilitägide SISSE (`<catch><f>Vor⸗</f></catch>`) ega ületa reapiiri;
    - `<cs>` tokenid kaovad, kõik muud tokenid jäävad.
    Juba `<f>`-iga tekst (absoluutne) tagastatakse muutmata.
    """
    if base not in ("A", "F"):
        raise ValueError(f"tundmatu põhikiri: {base!r}")
    if "<f>" in text and "<cs>" not in text:
        return text
    # `<cs>`/`<i>` virn avamise järjekorras: sisemine (viimane) otsustab.
    stack = []
    fn_open = 0
    out = []
    pos = 0

    def emit_text(seg: str):
        if not seg:
            return
        if fn_open or (stack and stack[-1] == "i"):
            out.append(seg)
            return
        # mõni `<cs>` avatud = lülitus (pesastatud/sulgemata `<cs>` ei pööra tagasi)
        fraktur = (base == "F") != ("cs" in stack)
        if not fraktur:
            out.append(seg)
            return
        wrapped = "\n".join(_wrap_runs(line) for line in seg.split("\n"))
        if "i" not in stack:
            out.append(wrapped)
        elif "<f>" not in wrapped:
            out.append(seg)  # ainult kirjavahemärgid — kursiivi ei tükeldata
        else:
            core = wrapped.strip()
            lead = wrapped[: len(wrapped) - len(wrapped.lstrip())]
            trail = wrapped[len(wrapped.rstrip()):]
            out.append(f"{lead}</i>{core}<i>{trail}")

    for m in _TOKEN_RE.finditer(text):
        emit_text(text[pos:m.start()])
        pos = m.end()
        closing, name, self_closing = m.group(1) == "/", m.group(2), m.group(4) == "/"
        if not self_closing:
            if name == "fn":
                fn_open = max(0, fn_open + (-1 if closing else 1))
            elif name in ("cs", "i"):
                if not closing:
                    stack.append(name)
                elif name in stack:
                    # vale pesastus (`<cs>X</i></cs>`): eemalda viimane sama nimega
                    del stack[len(stack) - 1 - stack[::-1].index(name)]
        if name == "cs":
            continue
        out.append(m.group(0))
    emit_text(text[pos:])
    # kursiivi tükeldusest jäänud tühjad paarid
    return _EMPTY_I_RE.sub(r"\1", "".join(out))


def cs_inside_italic(text: str) -> bool:
    """Kas `<cs>` avatakse avatud `<i>` sees — juhtum, mille esimene migratsioon
    (2026-11-02) antiikvateoses ära viskas; parandus: `migrate_cs_to_f.py --fix-italic`."""
    i_open = 0
    for m in _TOKEN_RE.finditer(text or ""):
        closing, name = m.group(1) == "/", m.group(2)
        if name == "i" and m.group(4) != "/":
            i_open = max(0, i_open + (-1 if closing else 1))
        elif name == "cs" and not closing and i_open:
            return True
    return False


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


def work_entry(work_id: str, manifest: Optional[dict] = None) -> Optional[dict]:
    m = manifest if manifest is not None else load_manifest()
    return m["works"].get(work_id)


def is_premigration_base(work_id: str, filename: str, base_text: str,
                         manifest: Optional[dict] = None) -> bool:
    """Kas kliendi `base` on migratsioonieelne tekst (vananenud redaktoriseanss)."""
    entry = work_entry(work_id, manifest)
    if not entry:
        return False
    page = entry.get("pages", {}).get(filename)
    if not page or page.get("in") == page.get("out"):
        return False
    return text_hash(base_text) == page.get("in")


# --- Keelepõhine põhikiri (kasutaja reegel 2026-11-02) ---
#
# Poolitusmärk on signaal AINULT inimese üle vaadatud lehel; Toores-lehe poolitusmärgi
# kirjutas OCR-mudel. Keel on kindlam: ladina/prantsuse → antiikva, saksa/rootsi/eesti →
# fraktuur (harvad erandid → ülevaatus).

REVIEWED_STATUSES = frozenset({"Valmis", "Annoteeritud", "Parandatud"})
SCRIPT_OF_LANG = {"lat": "A", "fra": "A", "deu": "F", "swe": "F", "est": "F"}

# Ainult ühele keelele omased sõnad: ladina „die" (kuupäev), „se", „ei", „ne", „en", „qui",
# „que", „des", „the" on välja jäetud, sest nad tõmbaksid ladina lehe teise keele poole.
_STOP = {
    "lat": "et in est non ad cum quod qui quae quam ut sed de ex per sunt enim autem vel ac atque "
           "nec hoc esse eius sic tam etiam ab pro sub inter ita si nos vos tibi mihi quoque deus dei "
           "deo nobis ipse illa ille quia quibus sive seu omnia omnes erat esset sit ad",
    "deu": "und vnd der das ist nicht ein eine zu den mit sich auch auff auf von dem des wie er "
           "sie ich wir daß dass dieser welche wird hat nach bey bei aus auß seyn sein gott herr "
           "ihr ihm ihn uns vns kan kann noch doch wann wenn als mein dein sol soll",
    "swe": "och att det som ett är på med för af til then thet hwar icke eller han hon sigh sin "
           "uthi uti wara war gudh gud oss migh tigh mitt ditt hwad ock skal skall hafwer",
    "est": "ja ning on kes mis ka nüüd wäega kui temma sedda ollema jummal jummala meie sinna "
           "minna kõik kõige sees peale wasto agga ollid sinno minno tahhan",
    "fra": "le la les du un une pour dans avec pas au aux ce cette il elle sont nous "
           "vous mais leur",
}
_STOP_SETS = {lang: frozenset(w.split()) for lang, w in _STOP.items()}
_WORD_RE = re.compile(r"[^\W\d_]+")
_CS_BLOCK_RE = re.compile(r"<cs>.*?</cs>", re.S)


def _words(text: str) -> list:
    plain = _TOKEN_RE.sub(" ", text or "").replace("ſ", "s").lower()
    return _WORD_RE.findall(plain)


def language_scores(text: str) -> dict:
    words = _words(text)
    return {lang: sum(1 for w in words if w in s) for lang, s in _STOP_SETS.items()}


def detect_language(text: str, min_hits: int = 2):
    """Keelekood või None (liiga vähe tõendit / viik). Ülekaal: vähemalt 2× teisest."""
    scores = language_scores(text)
    ranked = sorted(scores.items(), key=lambda kv: -kv[1])
    (top, n1), (_, n2) = ranked[0], ranked[1]
    if n1 >= min_hits and n1 >= 2 * n2:
        return top
    return None


def _is_mixed(text: str) -> bool:
    """Kas lehel on kahe eri kirja keeled märkimisväärselt (nt ladina + saksa luuletus)."""
    by_script = {"A": 0, "F": 0}
    for lang, n in language_scores(text).items():
        by_script[SCRIPT_OF_LANG[lang]] += n
    lo, hi = sorted(by_script.values())
    return lo >= 3 and lo >= 0.2 * hi


def _line_scripts(text: str) -> list:
    """Iga rea kiri ('A'|'F'|None) rea keelest; tõenditeta rida pärib eelmise
    (luuletus ja proosaplokk on mitmerealised), alguse tühimik järgmise."""
    out = []
    for line in text.split("\n"):
        lang = detect_language(line, min_hits=1)
        out.append(SCRIPT_OF_LANG[lang] if lang else None)
    last = None
    for i, s in enumerate(out):
        if s is None:
            out[i] = last
        else:
            last = s
    nxt = None
    for i in range(len(out) - 1, -1, -1):
        if out[i] is None:
            out[i] = nxt
        else:
            nxt = out[i]
    return out


def _wrap_lines(text: str, scripts: list) -> str:
    """Mähib fraktuuriread: antiikvaread märgitakse ajutiselt <cs>-iga ja teisendatakse
    põhikirjaga F — sama `cs_to_f` reeglid (struktuuritägide sees, kreeka välja jne)."""
    lines = text.split("\n")
    marked = [f"<cs>{ln}</cs>" if s != "F" else ln for ln, s in zip(lines, scripts)]
    return cs_to_f("\n".join(marked), "F")


def to_absolute(text: str, status=None, fallback=None, override=None):
    """Lehe teisendus absoluutseks `<f>`-iks. Tagastab (uus_tekst, info).

    info: {"kind": 'cs'|'whole'|'mixed'|'antiqua'|'none'|'unknown', "base": 'A'|'F'|None,
           "lang": keel|None, "conflict": bool, "reason": str}
    - `<cs>`-iga leht: põhikiri = `<cs>`-ist VÄLJAPOOLE jääva teksti keel (`<cs>` tähistas
      kõrvalekallet just sellest); tundmatu → `<cs>`-i sisu keele vastand → üle vaadatud
      lehe poolitusmärk →
      `fallback` (teose otsus) → 'unknown' (tekst muutumata).
    - `<cs>`-ita leht: fraktuurikeelne leht → `<f>`; segaleht → rea kaupa; antiikva → muutumata.
    - `override` ('A'|'F', lehe käsitsi otsus) võidab keele.
    - `conflict`: üle vaadatud lehe poolitusmärk on keelega vastuolus → ülevaatusse.
    """
    info = {"kind": "none", "base": None, "lang": None, "conflict": False, "reason": ""}
    if not text or not text.strip():
        return text, info
    if "<f>" in text and "<cs>" not in text:
        info.update(kind="none", reason="juba <f>")
        return text, info
    reviewed = status in REVIEWED_STATUSES
    hyphen = infer_base([text])[0] if reviewed else None
    has_cs = "<cs>" in text
    probe = _CS_BLOCK_RE.sub(" ", text) if has_cs else text
    lang = detect_language(probe)
    info["lang"] = lang
    lang_base = SCRIPT_OF_LANG.get(lang) if lang else None

    # Väljaspool <cs>-i keel tundmatu (nt terve leht <cs>-is): põhikiri on <cs>-i sisu
    # kirja VASTAND (<cs> tähistas kõrvalekallet).
    inner_base = None
    if has_cs and not lang_base:
        inner = detect_language(" ".join(_CS_BLOCK_RE.findall(text)))
        if inner:
            inner_base = "F" if SCRIPT_OF_LANG[inner] == "A" else "A"
    if override:
        base, reason = override, "lehe otsus"
    elif lang_base:
        base, reason = lang_base, f"keel {lang}"
    elif inner_base:
        base, reason = inner_base, "<cs>-i sisu keel"
    elif hyphen:
        base, reason = hyphen, "poolitus (üle vaadatud)"
    elif fallback in ("A", "F"):
        base, reason = fallback, "teose otsus"
    else:
        base, reason = None, "keel tundmatu"
    info.update(base=base, reason=reason,
                conflict=bool(not override and lang_base and hyphen and hyphen != lang_base))

    if has_cs:
        if base is None:
            info["kind"] = "unknown"
            return text, info
        info["kind"] = "cs"
        return cs_to_f(text, base), info

    # <cs>-ita leht
    if not override and _is_mixed(text):
        info["kind"] = "mixed"
        return _wrap_lines(text, _line_scripts(text)), info
    if base == "F":
        info["kind"] = "whole"
        return cs_to_f(text, "F"), info
    if base == "A":
        info["kind"] = "antiqua"
        return text, info
    # Keel tundmatu: kui lehel on fraktuuri poolitus ja piisavalt teksti, vajab ülevaatust.
    letters = sum(1 for c in probe if _is_latin(c))
    info["kind"] = "unknown" if ("⸗" in text and letters >= 40) else "none"
    return text, info
