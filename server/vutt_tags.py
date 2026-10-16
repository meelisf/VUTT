"""VUTT-i märgenduse register (ADR 0071) ja lehe tähistuse parser (ADR 0070, #630).

VUTT-i märgendus on TEI alamhulga lühisüntaks: iga täg on siin koos TEI vaste ja
käitumisega. TS-peegel: `src/markup/vuttTags.ts` — kooskõla valvab
`tests/test_vutt_tags_parity.py`.

Ainult stdlib: moodulit impordivad ka `marginalia_normalize` ja standalone-skriptid
(fake-package muster), seega EI tohi siia tulla FastAPI-t ega gitpython-it.
"""
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class TagDef:
    name: str
    tei: str
    paired: bool
    search: str             # 'keep' | 'drop' | 'marginalia'
    page_mark: bool
    numbered: bool          # annN: nimele järgneb number
    marginalia_inline: bool  # marginalia_normalize._INLINE (<m> jääb välimiseks)
    strip_empty: bool       # strip_empty_tags koristab tühja paari
    clean_markup: str       # 'remove' | 'keep' — redaktori „Puhasta"
    wrap_block: bool        # wrapTagUtils: stiilitäg liigub selle sisse


def _t(name, tei, *, paired=True, search="keep", page_mark=False, numbered=False,
       marginalia_inline=True, strip_empty=True, clean_markup="remove", wrap_block=False):
    return TagDef(name, tei, paired, search, page_mark, numbered,
                  marginalia_inline, strip_empty, clean_markup, wrap_block)


VUTT_TAG_REGISTRY = (
    _t("i", 'hi rend="italic"'),
    _t("b", 'hi rend="bold"'),
    _t("cs", "hi (kiri vastupidine teose põhikirjale; ADR 0071 erand)"),
    _t("hi", "hi", wrap_block=True),
    _t("m", 'note place="margin"', search="marginalia", marginalia_inline=False, wrap_block=True),
    _t("add", "add", wrap_block=True),
    _t("ann", "anchor/span — toimetaja märkuse ankur (ADR 0041)", numbered=True,
       strip_empty=False, clean_markup="keep"),
    _t("fn", 'ref type="note"', search="drop", marginalia_inline=False, strip_empty=False,
       wrap_block=True),
    _t("pb", "pb", paired=False, search="drop", marginalia_inline=False, strip_empty=False),
    _t("fw", 'fw type="pageNum"', search="drop", page_mark=True, wrap_block=True),
    _t("sig", 'fw type="sig"', search="drop", page_mark=True, wrap_block=True),
    _t("catch", 'fw type="catch"', search="drop", page_mark=True, wrap_block=True),
    _t("rh", 'fw type="header"', search="drop", page_mark=True, wrap_block=True),
)

PAGE_MARK_KINDS = tuple(t.name for t in VUTT_TAG_REGISTRY if t.page_mark)


def tag_pattern(t: TagDef) -> str:
    """Regexi osa tägi nime jaoks (`ann\\d*` nummerdatul)."""
    return f"{t.name}\\d*" if t.numbered else t.name


_PM_TOKEN_RE = re.compile(r"<(/?)(" + "|".join(PAGE_MARK_KINDS) + r")>")
_PB_RE = re.compile(r"<pb\s*/>")
# <m> või </m> paari sees: tähistus võib olla <m> sees, mitte vastupidi (ADR 0070).
_M_TAG_RE = re.compile(r"</?m>")
_ANY_TAG_RE = re.compile(r"</?[a-z]+\d*/?>")


@dataclass(frozen=True)
class PageMarkPair:
    kind: str
    open_from: int
    open_to: int
    close_from: int
    close_to: int
    valid: bool   # ei sisalda <pb/>-d ega <m>-tägi ega ristu teise paariga
    outer: bool   # ei ole ühegi teise paari sees


def parse_page_marks(text: str):
    """Kõik tähistuse paarid + paarita tägid. ÜKS tõlgendus kolmele tarbijale
    (otsingupuhastus, `page_marks`, normaliseerija)."""
    stacks = {k: [] for k in PAGE_MARK_KINDS}
    raw = []
    orphans = []
    for m in _PM_TOKEN_RE.finditer(text or ""):
        kind = m.group(2)
        if not m.group(1):
            stacks[kind].append((m.start(), m.end()))
        elif stacks[kind]:
            of, ot = stacks[kind].pop()
            raw.append((kind, of, ot, m.start(), m.end()))
        else:
            orphans.append((m.start(), m.end()))
    for st in stacks.values():
        orphans.extend(st)
    orphans.sort()
    raw.sort(key=lambda r: r[1])

    pairs = []
    for i, (kind, of, ot, cf, ct) in enumerate(raw):
        contained = False
        crossing = False
        for j, (_, of2, _ot2, _cf2, ct2) in enumerate(raw):
            if i == j:
                continue
            if of2 < of and ct < ct2:
                contained = True
            elif (of2 < of < ct2 < ct) or (of < of2 < ct < ct2):
                crossing = True
        has_pb = bool(_PB_RE.search(text, ot, cf))
        has_m = bool(_M_TAG_RE.search(text, ot, cf))
        pairs.append(PageMarkPair(kind, of, ot, cf, ct,
                                  valid=not has_pb and not has_m and not crossing,
                                  outer=not contained))
    return pairs, orphans


def page_mark_spans(text: str):
    """Kehtivad välimised paarid — need eemaldatakse otsingust ja lähevad `page_marks`-i."""
    pairs, _ = parse_page_marks(text)
    return [p for p in pairs if p.valid and p.outer]


def page_mark_entries(text: str):
    """`page_marks` väli: [{kind, text, seg}]; tühi sisu jäetakse välja."""
    out = []
    for p in page_mark_spans(text):
        sisu = re.sub(r"\s+", " ", _ANY_TAG_RE.sub("", text[p.open_to:p.close_from])).strip()
        if not sisu:
            continue
        seg = len(_PB_RE.findall(text, 0, p.open_from))
        out.append({"kind": p.kind, "text": sisu, "seg": seg})
    return out


def remove_page_marks(text: str) -> str:
    """Eemaldab kehtivad välimised paarid KOOS sisuga (asendus = tühi string, et
    ümbritsev tühik/reavahetus jääks nagu originaalis)."""
    if not text or "<" not in text:
        return text
    spans = page_mark_spans(text)
    for p in reversed(spans):
        text = text[:p.open_from] + text[p.close_to:]
    return text


def normalize_page_mark_structure(text: str) -> str:
    """Salvestusel: kehtetute (üle <pb/>, ristuvad) ja sisemiste paaride tägid
    eemaldatakse, sisu jääb. Paarita tägisid ei puututa (redaktori sanitiseerija)."""
    if not text or "<" not in text:
        return text
    pairs, _ = parse_page_marks(text)
    cuts = []
    for p in pairs:
        if p.valid and p.outer:
            continue
        cuts.append((p.open_from, p.open_to))
        cuts.append((p.close_from, p.close_to))
    for a, b in sorted(cuts, reverse=True):
        text = text[:a] + text[b:]
    return text
