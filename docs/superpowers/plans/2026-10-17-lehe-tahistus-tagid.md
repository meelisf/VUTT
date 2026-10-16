# Lehe tähistus: tägid, otsingutekst ja märgenduse register — teostusplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Neli lehe tähistuse tägi (`<fw> <sig> <catch> <rh>`) redaktoris, otsingutekstist väljas ja Meilis mitteotsitavas väljas `page_marks`, koos märgenduse registriga (ADR 0071).

**Architecture:** Üks parser (`server/vutt_tags.py` `parse_page_marks`, TS-peegel `src/markup/pageMarks.ts`) seob tähistuse tägid paarideks ja märgib kehtivuse/pesastuse; otsingupuhastus, `page_marks` ja normaliseerija tarbivad seda. Register on kahes keeles (Python + TS), kooskõla valvab paarsustest ja ühine juhtumite fikstuur. Redaktoris sisestab tähistuse puhas funktsioon `pageMarkEdit` (paneel + kiirklahvi menüü).

**Tech Stack:** Python 3.12 (FastAPI backend, pytest), React 19 + TypeScript + CodeMirror 6 (vitest), Meilisearch, MCP (`mcp/vutt_mcp`).

**Spec:** `docs/superpowers/specs/2026-10-16-lehe-tahistus-tagid-design.md` (loe enne alustamist; ADR 0070 `docs/decisions/0070-lehe-tahistus-ja-lehe-aadress.md`).

## Global Constraints

- **Koodikommentaarid eesti keeles.** UI eesti + inglise keeles.
- **i18n (ADR 0011):** iga uus võti MÕLEMASSE keelde (`src/locales/et/workspace.json`, `src/locales/en/workspace.json`) korraga; `fallbackLng` on väljas.
- **Meili (ADR 0006):** uus indekseeritav väli ainult `server/meili_doc.py`-s; `page_marks` EI lähe `SEARCHABLE_ATTRIBUTES`-isse ega filtreeritavaks; `meili_settings.py` ei muutu.
- **Normaliseerimine ainult salvestamisel** (`normalize_marginalia_tags` kõigis kirjutusteedes), MITTE elavalt redaktoris.
- **CodeMirror (ADR 0044):** paaristägid = mark-dekoratsioon + `atomicRanges`, mitte `Decoration.replace`. Redaktori CSS-is EI kasutata `vertical-align`-i ega teksti `font-size`-i muutmist (`src/index.css` `.vutt-add` kommentaar: muudaks rea kõrgust ja kursori asukohta).
- **Tehing:** vormindustoimingud `Transaction.userEvent.of('input.format')`.
- **z-index:** päis `z-[1200]`; paneel redaktori sees `z-10`.
- **Terminid** (raamatukogusõnastik): lehenummerdus / leheküljenummerdus, signatuur, siirdeviit (rööptermin kustos), veerutiitel. Tägid: `fw` `sig` `catch` `rh`.
- **TEI:** `fw type="pageNum|sig|catch|header"`.
- **localStorage** ainult mugavusseadeks, iga lugemine/kirjutus try/catch-is; võtmed `vutt_pagemark_palette`, `vutt_pagemark_palette_pos`.
- **Väravad:** `npm run typecheck`, `npm test`, `npm run lint:ci` (praegu `--max-warnings 41`, ära tõsta), `.venv/bin/pytest tests/`, MCP: `PYTHONPATH=$PWD .venv/bin/pytest mcp/tests`.
- **Komponenditest** vajab failipäist `/** @vitest-environment jsdom */`; loogikatestid jooksevad `node`-is.
- **MCP:** ei impordi `server`-it runtime'is; `mcp/tests/` ilma `__init__.py`-ta.
- **Commit** iga ülesande lõpus feature-harus `feat/lehe-tahistus-630` (mitte `main`); `git branch --show-current` enne iga commiti. Lõpp `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Orb tähistuse täg kleebitud tekstis** (`x <sig>A ij y`) — ootus: otsingus jääb `A ij` alles, `page_marks` tühi, ülejäänud leht ei kao. Test: Task 1 fikstuur „orv", Task 3 `test_orv_ei_pyhi_lehte`.
2. **Ristuvad tähistused** (`<fw>a<sig>b</fw>c</sig>`) — ootus: kumbki ei ole kehtiv, sisu jääb otsingusse, salvestus eemaldab tägid. Test: Task 1 fikstuur „ristuv", Task 2 `test_normaliseerija_fikstuurid`.
3. **Valiku serv tägi sees** (valik algab `<i>` tägi keskelt, nt programmeeritud valik või hiir peidetud tägi piiril) — ootus: keeldumine `tagBoundary`, tekst ei muutu. Test: Task 6 `keeldub, kui serv on tägi sees`.
4. **Salvestatud paneeli asukoht ei mahu enam kasti** (aken kitsamaks, rikutud JSON) — ootus: paneel klammerdatakse kasti, rikutud väärtus ei murra. Test: Task 7 `rikutud või liiga suur asukoht klammerdatakse`.
5. **Kursor liigub üle tähistuse silt-pseudoelemendi** (`::before` silt mark-dekoratsioonis) — ootus: nooled ja Shift+nooled liiguvad tavapäraselt, rea kõrgus ei muutu. Käsitsi kontroll Task 7 sammus 9 (tunnel + `npm run dev`, ainult lugemine).

---

## Failide kaart

| Fail | Vastutus |
|---|---|
| `server/vutt_tags.py` (uus) | Register (Python), `parse_page_marks`, `page_mark_spans`, `page_mark_entries`, `remove_page_marks`, `normalize_page_mark_structure`, regexi abilised |
| `tests/fixtures/page_marks_cases.json` (uus) | Ühine juhtumite tabel Pythonile ja TS-ile |
| `tests/test_vutt_tags.py` (uus) | Parser + fikstuurid |
| `server/marginalia_normalize.py` | `_INLINE`/`_EMPTY_RE` registrist; struktuuri normaliseerimine |
| `server/meili_doc.py` | `clean_text_for_search` eemaldab tähistuse; `page_marks` väli |
| `src/markup/vuttTags.ts` (uus) | Register (TS, JSON-plokk) |
| `src/markup/pageMarks.ts` (uus) | TS-parser (peegel) |
| `tests/test_vutt_tags_parity.py` (uus) | TS-register == Pythoni register |
| `src/markup/__tests__/*.test.ts` (uus) | TS-parser fikstuuril; tarbijaloendid registrist |
| `src/components/editor/VuttMarkupExtension.ts` | `VUTT_TAGS` + neli, eksport |
| `src/utils/renderVuttMarkup.ts` | lubatud tägid registrist, tähistuse renderdus |
| `src/components/editor/useEditorFormattingActions.ts` | `cleanMarkup` regex registrist; `wrapPageMark` |
| `src/components/editor/wrapTagUtils.ts` | struktuuritägid registrist |
| `src/components/editor/pageMarkEdit.ts` (uus) | Puhas sisestusfunktsioon |
| `src/components/editor/PageMarkPalette.tsx` (uus) | Paneel + menüü |
| `src/components/editor/EditorEditTab.tsx`, `EditorToolbar.tsx`, `useCodeMirrorLifecycle.ts`, `src/components/TextEditor.tsx` | Ühendamine |
| `src/index.css` | `.vutt-pm*` |
| `src/locales/{et,en}/workspace.json` | sildid |
| `mcp/vutt_mcp/queries.py`, `format.py`, `server.py` (tööriista kirjeldus), `mcp/README.md`, `mcp/tests/test_format.py` | MCP päis |
| `docs/decisions/0071-…md` (uus), `docs/decisions/README.md`, `docs/decisions/0070-…md` | ADR |
| `public/transcription_guide.html`, `public/transcription_guide_en.html` | Juhend |
| `scripts/dryrun_page_marks_search.py` (uus) | Korpuse kuivkäivitus |

---

### Task 1: Pythoni register ja tähistuse parser

**Files:**
- Create: `server/vutt_tags.py`
- Create: `tests/fixtures/page_marks_cases.json`
- Test: `tests/test_vutt_tags.py`

**Interfaces:**
- Produces:
  - `TagDef` (frozen dataclass): `name, tei, paired, search ('keep'|'drop'|'marginalia'), page_mark, numbered, marginalia_inline, strip_empty, clean_markup ('remove'|'keep'), wrap_block`
  - `VUTT_TAG_REGISTRY: tuple[TagDef, ...]`, `PAGE_MARK_KINDS: tuple[str, ...]` (`('fw','sig','catch','rh')`)
  - `tag_pattern(t: TagDef) -> str` (`'ann\\d*'` nummerdatul, muidu nimi)
  - `PageMarkPair` (frozen dataclass): `kind, open_from, open_to, close_from, close_to, valid, outer`
  - `parse_page_marks(text: str) -> tuple[list[PageMarkPair], list[tuple[int, int]]]` — kõik paarid (järjestatud `open_from` järgi) + paarita tägide vahemikud
  - `page_mark_spans(text: str) -> list[PageMarkPair]` — `valid and outer`
  - `page_mark_entries(text: str) -> list[dict]` — `[{"kind", "text", "seg"}]`
  - `remove_page_marks(text: str) -> str`
  - `normalize_page_mark_structure(text: str) -> str`

- [ ] **Step 1: Loo haru**

```bash
git switch main && git pull && git switch -c feat/lehe-tahistus-630
```

- [ ] **Step 2: Kirjuta ühine fikstuur**

`tests/fixtures/page_marks_cases.json` (UTF-8, `spans[].inner` = tekst avatägi lõpu ja sulgetägi alguse vahel; `search` = `clean_text_for_search(text)`; `normalized` = `normalize_marginalia_tags(text)`):

```json
[
  {"name": "lihtne", "text": "1. Cor. 1.\n<catch>Ehrwür⸗</catch>\n<sig>A ij</sig>",
   "spans": [{"kind": "catch", "inner": "Ehrwür⸗"}, {"kind": "sig", "inner": "A ij"}],
   "normalized": "1. Cor. 1.\n<catch>Ehrwür⸗</catch>\n<sig>A ij</sig>",
   "search": "1. Cor. 1.",
   "marks": [{"kind": "catch", "text": "Ehrwür⸗", "seg": 0}, {"kind": "sig", "text": "A ij", "seg": 0}]},
  {"name": "pesastus", "text": "x <sig>A <sig>ij</sig> muu</sig> y",
   "spans": [{"kind": "sig", "inner": "A <sig>ij</sig> muu"}],
   "normalized": "x <sig>A ij muu</sig> y",
   "search": "x y",
   "marks": [{"kind": "sig", "text": "A ij muu", "seg": 0}]},
  {"name": "orv", "text": "x <sig>A ij y",
   "spans": [], "normalized": "x <sig>A ij y", "search": "x A ij y", "marks": []},
  {"name": "ule_pb", "text": "<fw>12<pb/>13</fw>",
   "spans": [], "normalized": "12<pb/>13", "search": "12 13", "marks": []},
  {"name": "ristuv", "text": "<fw>a<sig>b</fw>c</sig>",
   "spans": [], "normalized": "abc", "search": "abc", "marks": []},
  {"name": "m_sees", "text": "<m><fw>246</fw> nota</m>\npõhi",
   "spans": [{"kind": "fw", "inner": "246"}],
   "normalized": "<m><fw>246</fw> nota</m>\npõhi",
   "search": "nota põhi",
   "marks": [{"kind": "fw", "text": "246", "seg": 0}]},
  {"name": "laotus_seg", "text": "<fw>12</fw>\na<pb/>\n<fw>13</fw>\nb",
   "spans": [{"kind": "fw", "inner": "12"}, {"kind": "fw", "inner": "13"}],
   "normalized": "<fw>12</fw>\na<pb/>\n<fw>13</fw>\nb",
   "search": "a b",
   "marks": [{"kind": "fw", "text": "12", "seg": 0}, {"kind": "fw", "text": "13", "seg": 1}]},
  {"name": "vormindus_sees", "text": "<catch><i>Vor⸗</i></catch>",
   "spans": [{"kind": "catch", "inner": "<i>Vor⸗</i>"}],
   "normalized": "<catch><i>Vor⸗</i></catch>",
   "search": "",
   "marks": [{"kind": "catch", "text": "Vor⸗", "seg": 0}]},
  {"name": "labipaistev", "text": "dem⸗\n<sig>A ij</sig>\nWort",
   "spans": [{"kind": "sig", "inner": "A ij"}],
   "normalized": "dem⸗\n<sig>A ij</sig>\nWort",
   "search": "demWort",
   "marks": [{"kind": "sig", "text": "A ij", "seg": 0}]},
  {"name": "uhel_real", "text": "dem⸗<sig>A ij</sig> Wort",
   "spans": [{"kind": "sig", "inner": "A ij"}],
   "normalized": "dem⸗<sig>A ij</sig> Wort",
   "search": "dem⸗ Wort",
   "marks": [{"kind": "sig", "text": "A ij", "seg": 0}]},
  {"name": "tuhi_sisu", "text": "<sig> </sig>x",
   "spans": [{"kind": "sig", "inner": " "}],
   "normalized": " x", "search": "x", "marks": []},
  {"name": "kehtetu_sees_kehtiv", "text": "<fw>12<pb/><sig>B</sig></fw>",
   "spans": [], "normalized": "12<pb/>B", "search": "12 B", "marks": []},
  {"name": "markimata", "text": "Hom. 1903\nVorrede",
   "spans": [], "normalized": "Hom. 1903\nVorrede", "search": "Hom. 1903 Vorrede", "marks": []}
]
```

- [ ] **Step 3: Kirjuta ebaõnnestuv test**

`tests/test_vutt_tags.py`:

```python
"""Lehe tähistuse parser (ADR 0070, #630) ja märgenduse register (ADR 0071)."""
import json
import os

import pytest

from server.vutt_tags import (
    PAGE_MARK_KINDS, VUTT_TAG_REGISTRY, normalize_page_mark_structure,
    page_mark_entries, page_mark_spans, parse_page_marks, remove_page_marks,
)

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "page_marks_cases.json")
with open(FIXTURE, encoding="utf-8") as f:
    CASES = json.load(f)


def test_tahistuse_liigid_registrist():
    assert PAGE_MARK_KINDS == ("fw", "sig", "catch", "rh")
    nimed = [t.name for t in VUTT_TAG_REGISTRY]
    assert len(nimed) == len(set(nimed))


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_spans_fikstuurid(case):
    text = case["text"]
    got = [{"kind": p.kind, "inner": text[p.open_to:p.close_from]} for p in page_mark_spans(text)]
    assert got == case["spans"]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_entries_fikstuurid(case):
    assert page_mark_entries(case["text"]) == case["marks"]


def test_parser_tagastab_ka_kehtetud_ja_sisemised():
    pairs, orphans = parse_page_marks("<fw>12<pb/><sig>B</sig></fw> <rh>x")
    by_kind = {p.kind: p for p in pairs}
    assert by_kind["fw"].valid is False and by_kind["fw"].outer is True
    assert by_kind["sig"].valid is True and by_kind["sig"].outer is False
    assert len(orphans) == 1


def test_remove_page_marks_eemaldab_ainult_kehtivad_valimised():
    assert remove_page_marks("a<sig>B</sig>b") == "ab"
    assert remove_page_marks("<fw>12<pb/>13</fw>") == "<fw>12<pb/>13</fw>"


def test_struktuuri_normaliseerimine_idempotentne():
    for case in CASES:
        once = normalize_page_mark_structure(case["text"])
        assert normalize_page_mark_structure(once) == once
```

- [ ] **Step 4: Käivita, veendu et kukub**

Run: `.venv/bin/pytest tests/test_vutt_tags.py -q`
Expected: FAIL `ModuleNotFoundError: No module named 'server.vutt_tags'`

- [ ] **Step 5: Kirjuta `server/vutt_tags.py`**

```python
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
_ANY_TAG_RE = re.compile(r"</?[a-z]+\d*/?>")


@dataclass(frozen=True)
class PageMarkPair:
    kind: str
    open_from: int
    open_to: int
    close_from: int
    close_to: int
    valid: bool   # ei sisalda <pb/>-d ega ristu teise paariga
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
        pairs.append(PageMarkPair(kind, of, ot, cf, ct,
                                  valid=not has_pb and not crossing, outer=not contained))
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
```

- [ ] **Step 6: Käivita testid**

Run: `.venv/bin/pytest tests/test_vutt_tags.py -q`
Expected: PASS (kõik, sh 13 fikstuuri kahes testis)

- [ ] **Step 7: Commit**

```bash
git branch --show-current
git add server/vutt_tags.py tests/fixtures/page_marks_cases.json tests/test_vutt_tags.py
git commit -m "feat(markup): märgenduse register ja lehe tähistuse parser (#630, ADR 0070/0071)"
```

---

### Task 2: Normaliseerija registrist + tähistuse struktuur

**Files:**
- Modify: `server/marginalia_normalize.py:22-25` (`_INLINE`), `:58-60` (`_EMPTY_RE`), `normalize_marginalia_tags`
- Test: `tests/test_marginalia_normalize.py` (lisa lõppu)

**Interfaces:**
- Consumes: `VUTT_TAG_REGISTRY`, `tag_pattern`, `normalize_page_mark_structure` (Task 1)
- Produces: `normalize_marginalia_tags` muudab tähistuse struktuuri (avalik signatuur sama)

- [ ] **Step 1: Kirjuta ebaõnnestuvad testid** (lisa `tests/test_marginalia_normalize.py` lõppu)

```python
# --- Lehe tähistus (ADR 0070, #630) ---
import json as _json
import os as _os

import pytest as _pytest

_CASES = _json.load(open(_os.path.join(_os.path.dirname(__file__), "fixtures",
                                       "page_marks_cases.json"), encoding="utf-8"))


@_pytest.mark.parametrize("case", _CASES, ids=[c["name"] for c in _CASES])
def test_normaliseerija_fikstuurid(case):
    assert norm(case["text"]) == case["normalized"]


def test_tuhi_tahistus_koristatakse():
    assert strip("a<fw></fw>b<rh> </rh>") == "ab "


def test_tahistus_m_sees_m_jaab_valimiseks():
    assert norm("<fw><m>246</m></fw>") == "<m><fw>246</fw></m>"


def test_normaliseerimine_idempotentne_tahistusega():
    t = "x <sig>A <sig>ij</sig></sig>\n<fw>1<pb/>2</fw>"
    assert norm(norm(t)) == norm(t)
```

- [ ] **Step 2: Käivita, veendu et kukub**

Run: `.venv/bin/pytest tests/test_marginalia_normalize.py -q`
Expected: FAIL (`test_normaliseerija_fikstuurid[pesastus]`, `[ule_pb]`, `[ristuv]`, `[tuhi_sisu]`, `[kehtetu_sees_kehtiv]`, `test_tuhi_tahistus_koristatakse`, `test_tahistus_m_sees_m_jaab_valimiseks`)

- [ ] **Step 3: Muuda `server/marginalia_normalize.py`**

Asenda `_INLINE` rida (`_INLINE = r'(?:i|b|cs|hi|add|ann\d*)'`) ja selle kommentaar:

```python
from .vutt_tags import VUTT_TAG_REGISTRY, normalize_page_mark_structure, tag_pattern

# Inline-tägid, mis VÕIVAD <m> ümber/ristuda — registrist (ADR 0071, `marginalia_inline`).
# EI sisalda 'm' ennast ega widget-tägi 'fn'/'pb'. Lehe tähistus on siin: ta võib olla
# <m> sees, mitte vastupidi (ADR 0070).
_INLINE = r'(?:' + '|'.join(tag_pattern(t) for t in VUTT_TAG_REGISTRY if t.marginalia_inline) + r')'
```

(NB: `import re` jääb faili algusesse; uus import tule `import re` järele.)

Asenda `_EMPTY_RE` rida ja kommentaar:

```python
# Tühje paaris-tage koristatakse registri `strip_empty` järgi. EI sisalda 'ann\d*'
# (ID viitab andmetele), 'fn' (joonealuse viide) ega 'pb' (self-closing).
_EMPTY_RE = re.compile(
    r'<(' + '|'.join(t.name for t in VUTT_TAG_REGISTRY if t.strip_empty) + r')>(\s*)</\1>'
)
```

Uuenda `strip_empty_tags` docstringi rida „Komplekt: `m, i, b, cs, hi, add`." → „Komplekt registrist (`strip_empty`): `m i b cs hi add fw sig catch rh`."

`normalize_marginalia_tags` sees, vahetult `if not text: return text` järel:

```python
    # Lehe tähistus (ADR 0070): sisemised ja kehtetud paarid (üle <pb/>, ristuvad)
    # kaovad enne <m>-normaliseerimist — üks kord, tulemus on püsipunkt.
    text = normalize_page_mark_structure(text)
```

- [ ] **Step 4: Käivita testid**

Run: `.venv/bin/pytest tests/test_marginalia_normalize.py tests/test_vutt_tags.py -q`
Expected: PASS

- [ ] **Step 5: Kogu backendi testikomplekt** (normaliseerija on kõigis kirjutusteedes)

Run: `.venv/bin/pytest tests/ -q -x`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git branch --show-current
git add server/marginalia_normalize.py tests/test_marginalia_normalize.py
git commit -m "feat(normalize): tähistuse struktuur salvestusel, _INLINE/_EMPTY_RE registrist (#630)"
```

---

### Task 3: Otsingutekst ja `page_marks` väli

**Files:**
- Modify: `server/meili_doc.py` — `clean_text_for_search` samm 1 algus (~rida 135), `_build_page_document` `doc` dict (~rida 460, `"text_content"` järel)
- Test: `tests/test_page_marks_index.py` (uus)

**Interfaces:**
- Consumes: `remove_page_marks`, `page_mark_entries` (Task 1)
- Produces: lehedokumendi väli `"page_marks": list[{"kind","text","seg"}]` (alati olemas)

- [ ] **Step 1: Kirjuta ebaõnnestuvad testid**

`tests/test_page_marks_index.py`:

```python
"""Lehe tähistus otsingutekstis ja Meili lehedokumendis (ADR 0070, #630)."""
import json
import os

import pytest

from server.meili_doc import _clean_search_text, clean_text_for_search

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "page_marks_cases.json")
with open(FIXTURE, encoding="utf-8") as f:
    CASES = json.load(f)


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_otsingutekst_fikstuurid(case):
    assert clean_text_for_search(case["text"]) == case["search"]


def test_signatuur_ei_kleepu_siirdeviida_kulge():
    # 04na2fu4 lk 3: varem `EhrwürA ij`
    assert clean_text_for_search("1. Cor. 1.\nEhrwür⸗\n<sig>A ij</sig>") == "1. Cor. 1. Ehrwür"


def test_orv_ei_pyhi_lehte():
    assert clean_text_for_search("algus <sig>A ij\nülejäänud lehekülg") == "algus A ij ülejäänud lehekülg"


def test_ann_tekst_eemaldab_tahistuse():
    assert clean_text_for_search("<ann3>sõna</ann3>\n<sig>B</sig>", keep_ann=True) == "<ann3>sõna</ann3>"


def test_tahistus_marginaalia_sees():
    main, marg = _clean_search_text("põhi\n<m><fw>246</fw> nota</m>")
    assert main == "põhi"
    assert marg == "nota"


def _sync(tmp_path, monkeypatch, pages):
    """Sama muster mis tests/test_meilisearch_sync_snapshot.py `synced` fixture:
    fiksiivne teos, välised sõltuvused mockitud, dokumendid kinni püütud.
    (tests/ ei ole pakett; pytest paneb testikausta sys.path-i, seega import otse.)"""
    import test_meilisearch_sync_snapshot as snap
    import server.meilisearch_ops as ops
    work_dir = tmp_path / snap.SLUG
    work_dir.mkdir()
    snap._write_metadata(work_dir)
    for i, txt in enumerate(pages, start=1):
        snap._write_page(work_dir, f"{snap.SLUG}-{snap.WORK_ID}-{i:03d}", txt=txt,
                         sequence=i * 100, status="Toores")
    monkeypatch.setattr(ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(ops, "ARCHIVES_FILE", str(tmp_path / "_archives.json"))
    (tmp_path / "_archives.json").write_text(json.dumps(snap.ARCHIVES), encoding="utf-8")
    monkeypatch.setattr(ops, "load_collections", lambda: snap.COLLECTIONS)
    monkeypatch.setattr(ops, "load_people_aliases", lambda: snap.PEOPLE)
    monkeypatch.setattr(ops, "load_labels_store", lambda: snap.LABELS)
    captured = {}

    def fake_send(documents, wait=True):
        captured["docs"] = documents
        return True

    monkeypatch.setattr(ops, "send_to_meilisearch", fake_send)
    monkeypatch.setattr(ops, "_delete_extra_pages", lambda *a: True)
    monkeypatch.setattr(ops, "sync_letters", lambda *a: True)
    assert ops.sync_work_to_meilisearch(snap.SLUG) is True
    return captured["docs"]


def test_lehedokument_kannab_page_marks(tmp_path, monkeypatch):
    docs = _sync(tmp_path, monkeypatch, ["tekst\n<rh>Vorrede</rh>\n<catch>habe</catch>", "puhas"])
    assert docs[0]["page_marks"] == [
        {"kind": "rh", "text": "Vorrede", "seg": 0},
        {"kind": "catch", "text": "habe", "seg": 0},
    ]
    assert docs[0]["lehekylje_tekst"] == "tekst"
    assert docs[1]["page_marks"] == []   # alati olemas, ka tühjana
```

(Konstandid `SLUG`, `WORK_ID`, `ARCHIVES`, `COLLECTIONS`, `PEOPLE`, `LABELS` ja abilised `_write_metadata`, `_write_page` on `tests/test_meilisearch_sync_snapshot.py`-s olemas — kontrolli `grep -n "^SLUG\|^WORK_ID\|^ARCHIVES\|^COLLECTIONS\|^PEOPLE\|^LABELS\|^def _write" tests/test_meilisearch_sync_snapshot.py`.)

- [ ] **Step 2: Käivita, veendu et kukub**

Run: `.venv/bin/pytest tests/test_page_marks_index.py -q`
Expected: FAIL (`lihtne` annab `1. Cor. 1. Ehrwür A ij` jne; `KeyError: 'page_marks'`)

- [ ] **Step 3: Muuda `clean_text_for_search`** (`server/meili_doc.py`)

Lisa importide hulka (`from .marginalia_normalize import normalize_marginalia_tags` järele):

```python
from .vutt_tags import page_mark_entries, remove_page_marks
```

Funktsiooni sees, vahetult `if not text: return ""` järel ja ENNE rida `text = re.sub(r'<fn>\d+</fn>', ' ', text)`:

```python
    # 0. Lehe tähistus (ADR 0070): kehtivad välimised paarid KOOS sisuga välja,
    # ENNE üldist tägieemaldust ja poolituste liitmist. Asendus = tühi string —
    # tähistus on teksti voos läbipaistev (`dem⸗` ⏎ `<sig>B</sig>` ⏎ `Wort` → `demWort`),
    # signatuur ei kleepu siirdeviida külge.
    text = remove_page_marks(text)
```

Uuenda docstringi rida „Uus XML: …" → „Uus XML: <i>, <b>, <cs>, <m>, <hi>, <add>, <fn>n</fn>, <pb/>; lehe tähistus <fw>/<sig>/<catch>/<rh> eemaldatakse koos sisuga".

- [ ] **Step 4: Lisa väli `_build_page_document`-is**

`doc` dict-is rea `"text_content": page_text,` järele:

```python
        "page_marks": page_mark_entries(page_text),            # KUVA (ei otsita): lehe tähistus [{kind,text,seg}], ADR 0070
```

- [ ] **Step 5: Käivita testid**

Run: `.venv/bin/pytest tests/test_page_marks_index.py tests/test_meilisearch_ops.py tests/test_annotation_index_field.py tests/test_consolidate_data.py tests/test_meili_seed_live_parity.py -q`
Expected: PASS

- [ ] **Step 6: MCP leping** (väli peab dokumendis eksisteerima, kui MCP seda küsib — Task 8)

Run: `PYTHONPATH=$PWD .venv/bin/pytest mcp/tests/test_meili_contract.py -q`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git branch --show-current
git add server/meili_doc.py tests/test_page_marks_index.py
git commit -m "feat(meili): lehe tähistus otsingutekstist välja, page_marks väli (#630)"
```

---

### Task 4: TS-register, TS-parser ja paarsustestid

**Files:**
- Create: `src/markup/vuttTags.ts`, `src/markup/pageMarks.ts`
- Test: `src/markup/__tests__/pageMarks.test.ts`, `tests/test_vutt_tags_parity.py`

**Interfaces:**
- Consumes: Pythoni `VUTT_TAG_REGISTRY` (Task 1), `tests/fixtures/page_marks_cases.json`
- Produces:
  - `export interface VuttTagDef { name; tei; paired; search; pageMark; numbered; marginaliaInline; stripEmpty; cleanMarkup; wrapBlock }`
  - `export const VUTT_TAG_REGISTRY: readonly VuttTagDef[]`
  - `export type PageMarkKind = 'fw' | 'sig' | 'catch' | 'rh'`
  - `export const PAGE_MARK_KINDS: readonly PageMarkKind[]`
  - `export function tagPattern(t: VuttTagDef): string`
  - `export interface PageMarkPair { kind: PageMarkKind; openFrom; openTo; closeFrom; closeTo: number; valid: boolean; outer: boolean }`
  - `export function parsePageMarks(text: string): { pairs: PageMarkPair[]; orphans: { from: number; to: number }[] }`
  - `export function pageMarkSpans(text: string): PageMarkPair[]`

- [ ] **Step 1: Kirjuta ebaõnnestuv paarsustest**

`tests/test_vutt_tags_parity.py`:

```python
"""TS-register (src/markup/vuttTags.ts) == Pythoni register (ADR 0071).

TS-fail kannab registrit RANGE JSON-plokina markerite vahel, et seda saaks
siin lugeda ilma TS-i käivitamata.
"""
import json
import os
import re

from server.vutt_tags import VUTT_TAG_REGISTRY

TS = os.path.join(os.path.dirname(__file__), "..", "src", "markup", "vuttTags.ts")
CAMEL = {"page_mark": "pageMark", "marginalia_inline": "marginaliaInline",
         "strip_empty": "stripEmpty", "clean_markup": "cleanMarkup", "wrap_block": "wrapBlock"}


def _ts_registry():
    src = open(TS, encoding="utf-8").read()
    m = re.search(r"// REGISTRY-START\n(.*?)\n// REGISTRY-END", src, re.S)
    assert m, "REGISTRY-START/END markerid puuduvad"
    return json.loads(m.group(1))


def test_ts_ja_python_register_kattuvad():
    ts = _ts_registry()
    py = [{CAMEL.get(k, k): v for k, v in t.__dict__.items()} for t in VUTT_TAG_REGISTRY]
    assert ts == py
```

- [ ] **Step 2: Kirjuta ebaõnnestuv TS-parseri test**

`src/markup/__tests__/pageMarks.test.ts`:

```ts
// TS-parser peab andma Pythoniga sama tõlgenduse (ühine fikstuur, ADR 0070).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pageMarkSpans, parsePageMarks } from '../pageMarks';
import { PAGE_MARK_KINDS } from '../vuttTags';

interface Case { name: string; text: string; spans: { kind: string; inner: string }[] }
const CASES: Case[] = JSON.parse(
  readFileSync(resolve(__dirname, '../../../tests/fixtures/page_marks_cases.json'), 'utf-8'),
);

describe('pageMarkSpans — ühine fikstuur', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const got = pageMarkSpans(c.text).map(p => ({ kind: p.kind, inner: c.text.slice(p.openTo, p.closeFrom) }));
      expect(got).toEqual(c.spans);
    });
  }
});

describe('parsePageMarks', () => {
  it('tagastab kehtetud ja sisemised paarid ning orvud', () => {
    const { pairs, orphans } = parsePageMarks('<fw>12<pb/><sig>B</sig></fw> <rh>x');
    const fw = pairs.find(p => p.kind === 'fw')!;
    const sig = pairs.find(p => p.kind === 'sig')!;
    expect([fw.valid, fw.outer]).toEqual([false, true]);
    expect([sig.valid, sig.outer]).toEqual([true, false]);
    expect(orphans).toHaveLength(1);
  });

  it('liigid registrist', () => {
    expect(PAGE_MARK_KINDS).toEqual(['fw', 'sig', 'catch', 'rh']);
  });
});
```

- [ ] **Step 3: Käivita, veendu et kukuvad**

Run: `.venv/bin/pytest tests/test_vutt_tags_parity.py -q; npx vitest run src/markup`
Expected: mõlemad FAIL (fail puudub)

- [ ] **Step 4: Kirjuta `src/markup/vuttTags.ts`**

```ts
// VUTT-i märgenduse register (ADR 0071): VUTT-i märgendus on TEI alamhulga
// lühisüntaks — iga täg koos TEI vaste ja käitumisega. Pythoni peegel:
// server/vutt_tags.py. Plokk REGISTRY-START…END on RANGE JSON (topeltjutumärgid,
// ilma lõpukomadeta): tests/test_vutt_tags_parity.py loeb ja võrdleb seda.

export interface VuttTagDef {
  name: string;
  tei: string;
  paired: boolean;
  search: 'keep' | 'drop' | 'marginalia';
  pageMark: boolean;
  numbered: boolean;
  marginaliaInline: boolean;
  stripEmpty: boolean;
  cleanMarkup: 'remove' | 'keep';
  wrapBlock: boolean;
}

export const VUTT_TAG_REGISTRY: readonly VuttTagDef[] =
// REGISTRY-START
[
  {"name": "i", "tei": "hi rend=\"italic\"", "paired": true, "search": "keep", "pageMark": false, "numbered": false, "marginaliaInline": true, "stripEmpty": true, "cleanMarkup": "remove", "wrapBlock": false},
  {"name": "b", "tei": "hi rend=\"bold\"", "paired": true, "search": "keep", "pageMark": false, "numbered": false, "marginaliaInline": true, "stripEmpty": true, "cleanMarkup": "remove", "wrapBlock": false},
  {"name": "cs", "tei": "hi (kiri vastupidine teose põhikirjale; ADR 0071 erand)", "paired": true, "search": "keep", "pageMark": false, "numbered": false, "marginaliaInline": true, "stripEmpty": true, "cleanMarkup": "remove", "wrapBlock": false},
  {"name": "hi", "tei": "hi", "paired": true, "search": "keep", "pageMark": false, "numbered": false, "marginaliaInline": true, "stripEmpty": true, "cleanMarkup": "remove", "wrapBlock": true},
  {"name": "m", "tei": "note place=\"margin\"", "paired": true, "search": "marginalia", "pageMark": false, "numbered": false, "marginaliaInline": false, "stripEmpty": true, "cleanMarkup": "remove", "wrapBlock": true},
  {"name": "add", "tei": "add", "paired": true, "search": "keep", "pageMark": false, "numbered": false, "marginaliaInline": true, "stripEmpty": true, "cleanMarkup": "remove", "wrapBlock": true},
  {"name": "ann", "tei": "anchor/span — toimetaja märkuse ankur (ADR 0041)", "paired": true, "search": "keep", "pageMark": false, "numbered": true, "marginaliaInline": true, "stripEmpty": false, "cleanMarkup": "keep", "wrapBlock": false},
  {"name": "fn", "tei": "ref type=\"note\"", "paired": true, "search": "drop", "pageMark": false, "numbered": false, "marginaliaInline": false, "stripEmpty": false, "cleanMarkup": "remove", "wrapBlock": true},
  {"name": "pb", "tei": "pb", "paired": false, "search": "drop", "pageMark": false, "numbered": false, "marginaliaInline": false, "stripEmpty": false, "cleanMarkup": "remove", "wrapBlock": false},
  {"name": "fw", "tei": "fw type=\"pageNum\"", "paired": true, "search": "drop", "pageMark": true, "numbered": false, "marginaliaInline": true, "stripEmpty": true, "cleanMarkup": "remove", "wrapBlock": true},
  {"name": "sig", "tei": "fw type=\"sig\"", "paired": true, "search": "drop", "pageMark": true, "numbered": false, "marginaliaInline": true, "stripEmpty": true, "cleanMarkup": "remove", "wrapBlock": true},
  {"name": "catch", "tei": "fw type=\"catch\"", "paired": true, "search": "drop", "pageMark": true, "numbered": false, "marginaliaInline": true, "stripEmpty": true, "cleanMarkup": "remove", "wrapBlock": true},
  {"name": "rh", "tei": "fw type=\"header\"", "paired": true, "search": "drop", "pageMark": true, "numbered": false, "marginaliaInline": true, "stripEmpty": true, "cleanMarkup": "remove", "wrapBlock": true}
]
// REGISTRY-END
;

export type PageMarkKind = 'fw' | 'sig' | 'catch' | 'rh';

export const PAGE_MARK_KINDS: readonly PageMarkKind[] =
  VUTT_TAG_REGISTRY.filter(t => t.pageMark).map(t => t.name as PageMarkKind);

/** Regexi osa tägi nime jaoks (`ann\d*` nummerdatul). */
export function tagPattern(t: VuttTagDef): string {
  return t.numbered ? `${t.name}\\d*` : t.name;
}

/** Nimed alternatsioonina registri predikaadi järgi, nt `i|b|cs`. */
export function tagAlternation(pred: (t: VuttTagDef) => boolean): string {
  return VUTT_TAG_REGISTRY.filter(pred).map(tagPattern).join('|');
}
```

Pythoni `TagDef.__dict__` järjekord on `name, tei, paired, search, page_mark, numbered, marginalia_inline, strip_empty, clean_markup, wrap_block` — JSON-võtmete järjekord ei loe (dict-võrdlus), aga hoia sama loetavuse jaoks.

- [ ] **Step 5: Kirjuta `src/markup/pageMarks.ts`**

```ts
// Lehe tähistuse parser (ADR 0070) — server/vutt_tags.py parse_page_marks-i peegel.
// Ühine fikstuur tests/fixtures/page_marks_cases.json valvab, et tõlgendus on sama.
import { PAGE_MARK_KINDS, type PageMarkKind } from './vuttTags';

export interface PageMarkPair {
  kind: PageMarkKind;
  openFrom: number;
  openTo: number;
  closeFrom: number;
  closeTo: number;
  /** ei sisalda <pb/>-d ega ristu teise paariga */
  valid: boolean;
  /** ei ole ühegi teise paari sees */
  outer: boolean;
}

const TOKEN_RE = new RegExp(`<(/?)(${PAGE_MARK_KINDS.join('|')})>`, 'g');
const PB_RE = /<pb\s*\/>/;

export function parsePageMarks(text: string): { pairs: PageMarkPair[]; orphans: { from: number; to: number }[] } {
  const stacks = new Map<string, { from: number; to: number }[]>(PAGE_MARK_KINDS.map(k => [k, []]));
  const raw: { kind: PageMarkKind; of: number; ot: number; cf: number; ct: number }[] = [];
  const orphans: { from: number; to: number }[] = [];
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    const kind = m[2] as PageMarkKind;
    const stack = stacks.get(kind)!;
    const tok = { from: m.index, to: m.index + m[0].length };
    if (!m[1]) stack.push(tok);
    else if (stack.length) {
      const open = stack.pop()!;
      raw.push({ kind, of: open.from, ot: open.to, cf: tok.from, ct: tok.to });
    } else orphans.push(tok);
  }
  for (const s of stacks.values()) orphans.push(...s);
  orphans.sort((a, b) => a.from - b.from);
  raw.sort((a, b) => a.of - b.of);

  const pairs = raw.map((r, i) => {
    let contained = false;
    let crossing = false;
    raw.forEach((o, j) => {
      if (i === j) return;
      if (o.of < r.of && r.ct < o.ct) contained = true;
      else if ((o.of < r.of && r.of < o.ct && o.ct < r.ct) || (r.of < o.of && o.of < r.ct && r.ct < o.ct)) crossing = true;
    });
    const hasPb = PB_RE.test(text.slice(r.ot, r.cf));
    return { kind: r.kind, openFrom: r.of, openTo: r.ot, closeFrom: r.cf, closeTo: r.ct,
      valid: !hasPb && !crossing, outer: !contained };
  });
  return { pairs, orphans };
}

/** Kehtivad välimised paarid. */
export function pageMarkSpans(text: string): PageMarkPair[] {
  return parsePageMarks(text).pairs.filter(p => p.valid && p.outer);
}
```

- [ ] **Step 6: Käivita testid**

Run: `.venv/bin/pytest tests/test_vutt_tags_parity.py -q && npx vitest run src/markup && npm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git branch --show-current
git add src/markup tests/test_vutt_tags_parity.py
git commit -m "feat(markup): TS-register ja tähistuse parser, paarsustest (#630, ADR 0071)"
```

---

### Task 5: Redaktori kuvamine, lugemisvaade ja kordusloendid registrist

**Files:**
- Modify: `src/components/editor/VuttMarkupExtension.ts:46-56` (`VUTT_TAGS` + eksport)
- Modify: `src/utils/renderVuttMarkup.ts:10` (lubatud tägid), + tähistuse rida
- Modify: `src/components/editor/useEditorFormattingActions.ts:198` (`cleanMarkup` regex)
- Modify: `src/components/editor/wrapTagUtils.ts:122,132` (struktuuritägid)
- Modify: `src/index.css` (`.vutt-add` ploki järele)
- Test: `src/markup/__tests__/vuttTagsConsumers.test.ts`, `src/utils/__tests__/renderVuttMarkup.test.ts`, `src/components/editor/__tests__/wrapTagUtils.test.ts`

**Interfaces:**
- Consumes: `VUTT_TAG_REGISTRY`, `tagAlternation` (Task 4)
- Produces:
  - `export const VUTT_TAGS` (VuttMarkupExtension.ts)
  - `export const CLEAN_MARKUP_TAG_RE: RegExp` (uus `src/markup/consumers.ts`)
  - `export const STRUCTURAL_TAGS: readonly string[]` (`src/markup/consumers.ts`)
  - `export const RENDER_ALLOWED_RE: RegExp` (`src/markup/consumers.ts`)

- [ ] **Step 1: Kirjuta ebaõnnestuvad testid**

`src/markup/__tests__/vuttTagsConsumers.test.ts`:

```ts
// Tarbijaloendid võrduvad registri alamhulgaga (ADR 0071) — uus täg ei saa
// enam vaikselt mõnest kohast välja jääda.
import { describe, it, expect } from 'vitest';
import { VUTT_TAG_REGISTRY } from '../vuttTags';
import { CLEAN_MARKUP_TAG_RE, RENDER_ALLOWED_RE, STRUCTURAL_TAGS } from '../consumers';
import { VUTT_TAGS } from '../../components/editor/VuttMarkupExtension';

describe('registri tarbijad', () => {
  it('redaktori VUTT_TAGS = kõik registri tägid', () => {
    expect(new Set(VUTT_TAGS.map(t => t.tag))).toEqual(new Set(VUTT_TAG_REGISTRY.map(t => t.name)));
  });

  it('STRUCTURAL_TAGS = wrapBlock', () => {
    expect([...STRUCTURAL_TAGS].sort()).toEqual(VUTT_TAG_REGISTRY.filter(t => t.wrapBlock).map(t => t.name).sort());
  });

  it('Puhasta eemaldab cleanMarkup=remove tägid, ann jääb', () => {
    const s = '<i>a</i><fw>1</fw><sig>B</sig><ann2>x</ann2><pb/>';
    expect(s.replace(CLEAN_MARKUP_TAG_RE, '')).toBe('a1B<ann2>x</ann2>');
  });

  it('lugemisvaade lubab kõik registri tägid, muu escape', () => {
    for (const t of VUTT_TAG_REGISTRY) {
      const tag = t.numbered ? `<${t.name}1>` : `<${t.name}>`;
      expect(tag.replace(RENDER_ALLOWED_RE, '&lt;')).toBe(tag);
    }
    expect('<img src=x>'.replace(RENDER_ALLOWED_RE, '&lt;')).toBe('&lt;img src=x>');
  });
});
```

Lisa `src/utils/__tests__/renderVuttMarkup.test.ts` lõppu (olemasolevasse `describe`-plokki või uude):

```ts
describe('renderVuttMarkup — lehe tähistus (ADR 0070)', () => {
  it('tähistus renderdub klassiga', () => {
    expect(renderVuttMarkup('<sig>A iij</sig>')).toBe('<span class="vutt-pm vutt-pm-sig">A iij</span>');
  });
});
```

(Kui failis puudub `renderVuttMarkup` import, lisa `import { renderVuttMarkup } from '../renderVuttMarkup';`.)

Lisa `src/components/editor/__tests__/wrapTagUtils.test.ts` `describe('selectionWrapChanges — mähkimine'` plokki:

```ts
  it('kursiiv läheb tähistuse sisse (struktuuritäg)', () => {
    expect(lulita('⟦<sig>A ij</sig>⟧')).toBe('<sig><i>A ij</i></sig>');
  });
```

- [ ] **Step 2: Käivita, veendu et kukuvad**

Run: `npx vitest run src/markup src/utils/__tests__/renderVuttMarkup.test.ts src/components/editor/__tests__/wrapTagUtils.test.ts`
Expected: FAIL (`consumers` puudub, `VUTT_TAGS` pole eksporditud, render ei tunne `sig`-i)

- [ ] **Step 3: Kirjuta `src/markup/consumers.ts`**

```ts
// Registrist tuletatud tarbijaloendid (ADR 0071). Iga loend on ÜKS kord siin —
// käsitsi kordusloendit ei ole.
import { tagAlternation, VUTT_TAG_REGISTRY } from './vuttTags';

/** „Puhasta" (cleanMarkup): eemaldatavad tägid; annotatsioon (annN) jääb. */
export const CLEAN_MARKUP_TAG_RE = new RegExp(`<\\/?(?:${tagAlternation(t => t.cleanMarkup === 'remove')})[^>]*>`, 'g');

/** wrapTagUtils: stiilitäg (i, b, cs) liigub nende SISSE. */
export const STRUCTURAL_TAGS: readonly string[] = VUTT_TAG_REGISTRY.filter(t => t.wrapBlock).map(t => t.name);

/** Lugemisvaade: `<`, mis EI alusta registri tägi, escape'itakse (HTML-injektsiooni kaitse). */
export const RENDER_ALLOWED_RE = new RegExp(`<(?!\\/?(?:${tagAlternation(() => true)})\\b)`, 'g');
```

NB: `tagPattern` annab `ann\d*`; render varem nõudis `ann\d+`. `\d*` lubab ka paljast `<ann>`, mille lõpus olev üldine tundmatute tägide eemaldus (`renderVuttMarkup` viimane `replace`) koristab — kahju ei ole.

- [ ] **Step 4: Ühenda tarbijad**

`src/components/editor/VuttMarkupExtension.ts` — muuda `const VUTT_TAGS` → `export const VUTT_TAGS` ja lisa `add`-kirje järele:

```ts
  // Lehe tähistus (ADR 0070): tähistus, mitte tekst — hall, liigi silt CSS-ist.
  { tag: 'fw', cls: 'vutt-pm vutt-pm-fw' },
  { tag: 'sig', cls: 'vutt-pm vutt-pm-sig' },
  { tag: 'catch', cls: 'vutt-pm vutt-pm-catch' },
  { tag: 'rh', cls: 'vutt-pm vutt-pm-rh' },
```

`src/utils/renderVuttMarkup.ts` — lisa import ja asenda rida 10 ning lisa tähistuse rida `<add>`-rea järele:

```ts
import { RENDER_ALLOWED_RE } from '../markup/consumers';
```

```ts
    // Escape kõik < mis EI alusta registri VUTT-tägi (ADR 0071) → kaitse HTML-injektsiooni
    // eest (security_review Leid A).
    .replace(RENDER_ALLOWED_RE, '&lt;')
```

```ts
    // Lehe tähistus (ADR 0070): sama klass mis redaktoris
    .replace(/<(fw|sig|catch|rh)>([\s\S]*?)<\/\1>/g, '<span class="vutt-pm vutt-pm-$1">$2</span>')
```

Uuenda faili päisekommentaari tägide loetelu: „… lisandus, lehe tähistus, footnote, pagebreak."

`src/components/editor/useEditorFormattingActions.ts` — lisa import `import { CLEAN_MARKUP_TAG_RE } from '../../markup/consumers';` ja asenda

```ts
      s => s.replace(/<\/?(?:i|b|cs|m|hi|add|fn|pb)[^>]*>/g, ''),
```

ridaga

```ts
      s => s.replace(CLEAN_MARKUP_TAG_RE, ''),
```

`src/components/editor/wrapTagUtils.ts` — lisa import `import { STRUCTURAL_TAGS } from '../../markup/consumers';` ja asenda mõlemas kohas `['m', 'hi', 'add', 'fn'].includes(tagName)` → `STRUCTURAL_TAGS.includes(tagName)`. Uuenda kommentaar „(m, hi, add, fn)" → „(registri wrapBlock: m, hi, add, fn, lehe tähistus)".

`src/index.css` — `.vutt-add` ploki järele:

```css
/* Lehe tähistus (ADR 0070): <fw> <sig> <catch> <rh> — lehe kui füüsilise objekti
   tähistus, mitte tekst. Hall + kerge taust; liigi silt ::before tägi nimega
   (keeleneutraalne, sama mis toortekstis). EI vertical-align-i ega font-size
   muutust (vt .vutt-add): CodeMirroris muudaks see rea kõrgust ja kursorit. */
.vutt-pm {
  color: #6b7280; /* gray-500 */
  background-color: #f3f4f6; /* gray-100 */
  border-radius: 2px;
}
.vutt-pm::before {
  color: #9ca3af; /* gray-400 */
  font-family: system-ui, sans-serif;
  letter-spacing: 0.03em;
  margin-right: 0.25em;
}
.vutt-pm-fw::before { content: "fw"; }
.vutt-pm-sig::before { content: "sig"; }
.vutt-pm-catch::before { content: "catch"; }
.vutt-pm-rh::before { content: "rh"; }
```

- [ ] **Step 5: Käivita testid ja tüübikontroll**

Run: `npx vitest run src/markup src/utils src/components/editor && npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git branch --show-current
git add src/markup/consumers.ts src/markup/__tests__/vuttTagsConsumers.test.ts src/components/editor/VuttMarkupExtension.ts src/utils/renderVuttMarkup.ts src/components/editor/useEditorFormattingActions.ts src/components/editor/wrapTagUtils.ts src/index.css src/utils/__tests__/renderVuttMarkup.test.ts src/components/editor/__tests__/wrapTagUtils.test.ts
git commit -m "feat(editor): lehe tähistuse kuvamine; tarbijaloendid registrist (#630, ADR 0071)"
```

---

### Task 6: Puhas sisestusfunktsioon `pageMarkEdit` + `wrapPageMark`

**Files:**
- Create: `src/components/editor/pageMarkEdit.ts`
- Modify: `src/components/editor/useEditorFormattingActions.ts` (uus `wrapPageMark`, tagastusobjekti)
- Test: `src/components/editor/__tests__/pageMarkEdit.test.ts`

**Interfaces:**
- Consumes: `parsePageMarks` (Task 4), `PageMarkKind`, `VUTT_TAG_REGISTRY` (Task 4), `findMarginaliaBlocks` (`src/utils/marginaliaUtils.ts`), `hiddenBlockRanges` (`MarginaliaExtension.ts`)
- Produces:
  - `export type PageMarkRefusal = 'multiple' | 'pageBreak' | 'marginalia' | 'tagBoundary'`
  - `export type PageMarkEditResult = { ok: true; changes: { from: number; to: number; insert: string }[]; cursor?: number } | { ok: false; reason: PageMarkRefusal }`
  - `export function pageMarkEdit(doc: string, selFrom: number, selTo: number, kind: PageMarkKind, hidden: { from: number; to: number }[]): PageMarkEditResult`
  - `useEditorFormattingActions` tagastab lisaks `wrapPageMark: (kind: PageMarkKind) => PageMarkRefusal | null`

- [ ] **Step 1: Kirjuta ebaõnnestuv test**

`src/components/editor/__tests__/pageMarkEdit.test.ts`:

```ts
// Lehe tähistuse sisestus (ADR 0070, spekk 1 §3): rida/valik, olemasolev paar,
// keeldumised, vorminduse poolitus — tähistus ei haara kunagi valimata põhiteksti.
import { describe, it, expect } from 'vitest';
import { pageMarkEdit, type PageMarkEditResult } from '../pageMarkEdit';
import type { PageMarkKind } from '../../../markup/vuttTags';

// ⟦ … ⟧ = valik, ‸ = kursor
function run(marked: string, kind: PageMarkKind, hidden: { from: number; to: number }[] = []) {
  let from: number;
  let to: number;
  let doc: string;
  if (marked.includes('‸')) {
    from = to = marked.indexOf('‸');
    doc = marked.replace('‸', '');
  } else {
    from = marked.indexOf('⟦');
    to = marked.indexOf('⟧') - 1;
    doc = marked.replace('⟦', '').replace('⟧', '');
  }
  const r: PageMarkEditResult = pageMarkEdit(doc, from, to, kind, hidden);
  if (!r.ok) return { refused: r.reason };
  let out = doc;
  for (const c of [...r.changes].sort((a, b) => b.from - a.from)) out = out.slice(0, c.from) + c.insert + out.slice(c.to);
  return { doc: out, cursor: r.cursor };
}

describe('pageMarkEdit — rida ja valik', () => {
  it('valikuta mähib kursori rea', () => {
    expect(run('a\nA i‸ij\nb', 'sig').doc).toBe('a\n<sig>A iij</sig>\nb');
  });
  it('rea äärmised tühikud jäävad välja', () => {
    expect(run('  A‸ ij  ', 'sig').doc).toBe('  <sig>A ij</sig>  ');
  });
  it('valik mähitakse', () => {
    expect(run('Hom. ⟦1903⟧', 'fw').doc).toBe('Hom. <fw>1903</fw>');
  });
  it('valiku servatühikud jäävad välja', () => {
    expect(run('Hom.⟦ 1903 ⟧', 'fw').doc).toBe('Hom. <fw>1903</fw> ');
  });
  it('tühi rida: tühi paar, kursor sisse', () => {
    expect(run('a\n‸\nb', 'fw')).toEqual({ doc: 'a\n<fw></fw>\nb', cursor: 6 });
  });
  it('kursor avatud <m> sees: ainult ploki sisu', () => {
    expect(run('<m>fol‸. 3</m>\npõhi', 'fw').doc).toBe('<m><fw>fol. 3</fw></m>\npõhi');
  });
});

describe('pageMarkEdit — olemasolev tähistus', () => {
  it('sama liik eemaldab terve paari', () => {
    expect(run('x\n<sig>A‸ ij</sig>', 'sig').doc).toBe('x\nA ij');
  });
  it('teine liik vahetab', () => {
    expect(run('x\n<sig>A‸ ij</sig>', 'catch').doc).toBe('x\n<catch>A ij</catch>');
  });
  it('mitu tähistust → keeldumine', () => {
    expect(run('⟦<sig>A</sig> <catch>b</catch>⟧', 'fw')).toEqual({ refused: 'multiple' });
  });
});

describe('pageMarkEdit — keeldumised', () => {
  it('<pb/> vahemikus', () => {
    expect(run('⟦a<pb/>b⟧', 'fw')).toEqual({ refused: 'pageBreak' });
  });
  it('ületab <m> piiri', () => {
    expect(run('⟦a <m>b⟧ c</m>', 'fw')).toEqual({ refused: 'marginalia' });
  });
  it('peidetud marginaaliaplokk vahemikus', () => {
    expect(run('⟦ab cd⟧', 'fw', [{ from: 1, to: 3 }])).toEqual({ refused: 'marginalia' });
  });
  it('ristub annotatsiooniga', () => {
    expect(run('<ann1>a⟦b</ann1>c⟧', 'fw')).toEqual({ refused: 'tagBoundary' });
  });
  it('keeldub, kui serv on tägi sees', () => {
    // valik algab <i> tägi keskelt (Review Focus 3)
    expect(pageMarkEdit('<i>ab</i>', 1, 5, 'fw', [])).toEqual({ ok: false, reason: 'tagBoundary' });
  });
});

describe('pageMarkEdit — vormindus: nähtav ulatus säilib', () => {
  it('valik kursiivi sees → tähistus kursiivi sisse, põhitekst puutumata', () => {
    expect(run('<i>põhitekst ⟦12⟧</i>', 'fw').doc).toBe('<i>põhitekst <fw>12</fw></i>');
  });
  it('lõikab kursiivi algust → kursiiv poolitatakse', () => {
    expect(run('<i>a⟦b</i>cd⟧e', 'fw').doc).toBe('<i>a</i><fw><i>b</i>cd</fw>e');
  });
  it('lõikab kursiivi lõppu → kursiiv poolitatakse', () => {
    expect(run('⟦a<i>b⟧c</i>', 'fw').doc).toBe('<fw>a<i>b</i></fw><i>c</i>');
  });
  it('terve kursiivirida mähitakse ilma poolituseta', () => {
    expect(run('<i>Vorr‸ede</i>\nhabe', 'rh').doc).toBe('<rh><i>Vorrede</i></rh>\nhabe');
  });
});
```

- [ ] **Step 2: Käivita, veendu et kukub**

Run: `npx vitest run src/components/editor/__tests__/pageMarkEdit.test.ts`
Expected: FAIL (moodul puudub)

- [ ] **Step 3: Kirjuta `src/components/editor/pageMarkEdit.ts`**

```ts
// Lehe tähistuse sisestus (ADR 0070, spekk 2026-10-16 §3) — puhas funktsioon
// stringidel, et servajuhud oleks testitavad ilma redaktorita.
//
// Reeglid: tähistus ei haara kunagi valimata põhiteksti; olemasoleva tähistuse
// puudutamisel tegutsetakse terve paari peal; üle <pb/>-i, <m> piiri, peidetud
// marginaalia või annotatsiooni/viite piiri ei märgendata (keeldumine, tekst ei muutu).
import { parsePageMarks } from '../../markup/pageMarks';
import { VUTT_TAG_REGISTRY, type PageMarkKind } from '../../markup/vuttTags';
import { findMarginaliaBlocks } from '../../utils/marginaliaUtils';

export type PageMarkRefusal = 'multiple' | 'pageBreak' | 'marginalia' | 'tagBoundary';
export type PageMarkEditResult =
  | { ok: true; changes: { from: number; to: number; insert: string }[]; cursor?: number }
  | { ok: false; reason: PageMarkRefusal };

// Vormindustägid, mida tohib poolitada: inline, nummerdamata, mitte tähistus (i b cs hi add).
const FORMAT_TAGS = new Set(
  VUTT_TAG_REGISTRY.filter(t => t.marginaliaInline && !t.numbered && !t.pageMark).map(t => t.name),
);
const TOKEN_RE = /<(\/?)([a-z]+)(\d*)(\/?)>/g;

interface Token { from: number; to: number; name: string; close: boolean; self: boolean }
interface Pair { name: string; openFrom: number; openTo: number; closeFrom: number; closeTo: number }

function tokens(doc: string): Token[] {
  const out: Token[] = [];
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(doc)) !== null) {
    out.push({ from: m.index, to: m.index + m[0].length, name: m[2] + m[3], close: m[1] === '/', self: m[4] === '/' || m[2] === 'pb' });
  }
  return out;
}

function pairsOf(toks: Token[]): Pair[] {
  const stacks = new Map<string, Token[]>();
  const pairs: Pair[] = [];
  for (const t of toks) {
    if (t.self) continue;
    const s = stacks.get(t.name) ?? [];
    stacks.set(t.name, s);
    if (!t.close) s.push(t);
    else if (s.length) {
      const o = s.pop()!;
      pairs.push({ name: t.name, openFrom: o.from, openTo: o.to, closeFrom: t.from, closeTo: t.to });
    }
  }
  return pairs;
}

const isWs = (c: string) => c === ' ' || c === '\t';

export function pageMarkEdit(
  doc: string, selFrom: number, selTo: number, kind: PageMarkKind,
  hidden: { from: number; to: number }[],
): PageMarkEditResult {
  let from = Math.min(selFrom, selTo);
  let to = Math.max(selFrom, selTo);
  const caret = from === to ? from : -1;

  // 1. Sihtvahemik: valikuta kursori rida (avatud <m> sees ainult ploki sisu).
  if (caret >= 0) {
    from = doc.lastIndexOf('\n', caret - 1) + 1;
    const nl = doc.indexOf('\n', caret);
    to = nl === -1 ? doc.length : nl;
    const block = findMarginaliaBlocks(doc).find(b => caret >= b.contentFrom && caret <= b.contentTo);
    if (block) {
      from = Math.max(from, block.contentFrom);
      to = Math.min(to, block.contentTo);
    }
  }
  while (from < to && isWs(doc[from])) from++;
  while (to > from && isWs(doc[to - 1])) to--;

  // 2. Olemasolev tähistus: puudutamine → terve paar.
  const touched = parsePageMarks(doc).pairs.filter(p =>
    caret >= 0 ? (p.openFrom <= caret && caret <= p.closeTo) || (p.openFrom < to && p.closeTo > from)
      : p.openFrom < to && p.closeTo > from);
  const outerTouched = touched.filter(p => !touched.some(o => o !== p && o.openFrom < p.openFrom && p.closeTo < o.closeTo));
  if (outerTouched.length > 1) return { ok: false, reason: 'multiple' };
  if (outerTouched.length === 1) {
    const p = outerTouched[0];
    if (p.kind === kind) {
      return { ok: true, changes: [{ from: p.openFrom, to: p.openTo, insert: '' }, { from: p.closeFrom, to: p.closeTo, insert: '' }] };
    }
    return { ok: true, changes: [
      { from: p.openFrom, to: p.openTo, insert: `<${kind}>` },
      { from: p.closeFrom, to: p.closeTo, insert: `</${kind}>` },
    ] };
  }

  // 3. Tühi vahemik (tühi rida): tühi paar, kursor sisse.
  if (from >= to) {
    const at = caret >= 0 ? caret : from;
    return { ok: true, changes: [{ from: at, to: at, insert: `<${kind}></${kind}>` }], cursor: at + kind.length + 2 };
  }

  // 4. Keeldumised lõpliku vahemiku kohta.
  if (hidden.some(h => h.from < to && h.to > from)) return { ok: false, reason: 'marginalia' };
  const toks = tokens(doc);
  if (toks.some(t => (t.from < from && from < t.to) || (t.from < to && to < t.to))) return { ok: false, reason: 'tagBoundary' };
  const inside = toks.filter(t => t.from >= from && t.to <= to);
  if (inside.some(t => t.name === 'pb')) return { ok: false, reason: 'pageBreak' };
  if (inside.some(t => t.name === 'm')) return { ok: false, reason: 'marginalia' };

  // 5. Vormindus: ristuvad paarid poolitatakse piiril; muu ristuv paar → keeldu.
  // Paar, mis sisaldab kogu vahemiku või on tervikuna selle sees, ei ristu.
  const crossFrom: Pair[] = [];
  const crossTo: Pair[] = [];
  for (const p of pairsOf(toks)) {
    const atFrom = p.openTo <= from && from < p.closeFrom && p.closeTo <= to;
    const atTo = from <= p.openFrom && p.openTo <= to && to < p.closeFrom;
    if (!atFrom && !atTo) continue;
    if (!FORMAT_TAGS.has(p.name)) return { ok: false, reason: 'tagBoundary' };
    (atFrom ? crossFrom : crossTo).push(p);
  }
  crossFrom.sort((a, b) => a.openFrom - b.openFrom);
  crossTo.sort((a, b) => a.openFrom - b.openFrom);
  const closes = (ps: Pair[]) => [...ps].reverse().map(p => `</${p.name}>`).join('');
  const opens = (ps: Pair[]) => ps.map(p => `<${p.name}>`).join('');
  const a = closes(crossFrom) + `<${kind}>` + opens(crossFrom);
  const b = closes(crossTo) + `</${kind}>` + opens(crossTo);
  return { ok: true, changes: [{ from, to: from, insert: a }, { from: to, to, insert: b }] };
}
```

- [ ] **Step 4: Käivita test**

Run: `npx vitest run src/components/editor/__tests__/pageMarkEdit.test.ts`
Expected: PASS. Kui `ristub annotatsiooniga` kukub: `<ann1>a⟦b</ann1>c⟧` — `ann1` paar `atFrom` (openTo ≤ from < closeFrom, closeTo ≤ to) → `FORMAT_TAGS` ei sisalda `ann1` → `tagBoundary`. Kontrolli, et `tokens()` annab nimeks `ann1` (`m[2] + m[3]`).

- [ ] **Step 5: Lisa `wrapPageMark` hooki**

`src/components/editor/useEditorFormattingActions.ts` — importid:

```ts
import { hiddenBlockRanges, marginaliaField, openMarginalia } from './MarginaliaExtension';
import { pageMarkEdit, type PageMarkRefusal } from './pageMarkEdit';
import type { PageMarkKind } from '../../markup/vuttTags';
```

(`hiddenBlockRanges` on juba imporditud — ära topelda.) `cleanMarkup` järele:

```ts
  // Lehe tähistus (ADR 0070): üks tehing; keeldumisel tekst ei muutu ja põhjus
  // tagastatakse paneelile kuvamiseks.
  const wrapPageMark = useCallback((kind: PageMarkKind): PageMarkRefusal | null => {
    const view = viewRef.current;
    if (!view || readOnly) return null;
    const { from, to } = view.state.selection.main;
    const r = pageMarkEdit(view.state.doc.toString(), from, to, kind, hiddenBlockRanges(view.state));
    if (!r.ok) {
      view.focus();
      return r.reason;
    }
    const changes = view.state.changes(r.changes);
    view.dispatch({
      changes,
      selection: EditorSelection.cursor(r.cursor ?? changes.mapPos(to, 1)),
      annotations: Transaction.userEvent.of('input.format'),
    });
    view.focus();
    return null;
  }, [readOnly, viewRef]);
```

Lisa `wrapPageMark` tagastatavasse objekti (`return { wrapWithTag, … }`).

- [ ] **Step 6: Tüübikontroll ja testid**

Run: `npm run typecheck && npx vitest run src/components/editor`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git branch --show-current
git add src/components/editor/pageMarkEdit.ts src/components/editor/__tests__/pageMarkEdit.test.ts src/components/editor/useEditorFormattingActions.ts
git commit -m "feat(editor): lehe tähistuse sisestus — rida/valik, terve paar, keeldumised, vorminduse poolitus (#630)"
```

---

### Task 7: Paneel, kiirklahvi menüü, tööriistariba ja i18n

**Files:**
- Create: `src/components/editor/PageMarkPalette.tsx`
- Modify: `src/components/editor/EditorEditTab.tsx`, `src/components/editor/EditorToolbar.tsx`, `src/components/editor/useCodeMirrorLifecycle.ts:21,33,86`, `src/components/TextEditor.tsx` (~read 89, 145-155, 233-248, 281-300)
- Modify: `src/locales/et/workspace.json`, `src/locales/en/workspace.json` (`editor` all)
- Test: `src/components/editor/__tests__/PageMarkPalette.test.tsx`

**Interfaces:**
- Consumes: `wrapPageMark` (Task 6), `PAGE_MARK_KINDS`, `PageMarkKind` (Task 4)
- Produces:
  - `export default function PageMarkPalette(props: { open: boolean; onClose: () => void; onApply: (k: PageMarkKind) => PageMarkRefusal | null; containerRef: RefObject<HTMLElement | null> })`
  - `export function PageMarkMenu(props: { anchor: { left: number; top: number }; onApply: (k: PageMarkKind) => PageMarkRefusal | null; onClose: () => void })`
  - `export function readPaletteOpen(): boolean`, `export function writePaletteOpen(open: boolean): void`
  - `useCodeMirrorLifecycle` param `openPageMarkMenuRef: MutableRefObject<() => void>`

- [ ] **Step 1: Lisa i18n võtmed** (mõlemasse faili korraga; `editor` objekti sisse, `tooltips` kõrvale)

`src/locales/et/workspace.json`:

```json
    "pageMarks": {
      "title": "Lehe tähistus",
      "toolbar": "Lehe tähistus — näita/peida paneel",
      "drag": "Lohista",
      "close": "Sulge (tööriistariba nupp toob tagasi)",
      "fw": "Lehe-/leheküljenumber",
      "sig": "Signatuur",
      "catch": "Siirdeviit",
      "rh": "Veerutiitel",
      "refused": {
        "multiple": "Valikus on mitu tähistust — vali üks",
        "pageBreak": "Tähistus ei ületa lehevahetust",
        "marginalia": "Tähistus ei ületa marginaalia piiri",
        "tagBoundary": "Valik lõikab märgendi pooleks — vali täpsemalt"
      }
    },
```

`src/locales/en/workspace.json`:

```json
    "pageMarks": {
      "title": "Page marks",
      "toolbar": "Page marks — show/hide panel",
      "drag": "Drag",
      "close": "Close (the toolbar button brings it back)",
      "fw": "Folio / page number",
      "sig": "Signature",
      "catch": "Catchword",
      "rh": "Running head",
      "refused": {
        "multiple": "The selection contains several page marks — select one",
        "pageBreak": "A page mark cannot cross a page break",
        "marginalia": "A page mark cannot cross a marginal note boundary",
        "tagBoundary": "The selection cuts a tag in half — select more precisely"
      }
    },
```

Run: `npx vitest run src/locales` (paarsus + `translationKeysResolve`)
Expected: PASS

- [ ] **Step 2: Kirjuta ebaõnnestuv komponenditest**

`src/components/editor/__tests__/PageMarkPalette.test.tsx`:

```tsx
/** @vitest-environment jsdom */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useRef } from 'react';
import '../../../pages/manage/parts/__tests__/testI18n';
import PageMarkPalette, { PageMarkMenu, readPaletteOpen } from '../PageMarkPalette';

function Harness(props: { onApply?: (k: string) => any; onClose?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <PageMarkPalette open containerRef={ref}
        onApply={(props.onApply ?? (() => null)) as any} onClose={props.onClose ?? (() => {})} />
    </div>
  );
}

beforeEach(() => localStorage.clear());

describe('PageMarkPalette', () => {
  it('nupp rakendab liigi', () => {
    const onApply = vi.fn(() => null);
    render(<Harness onApply={onApply} />);
    fireEvent.mouseDown(screen.getByRole('button', { name: /Signatuur/ }));
    expect(onApply).toHaveBeenCalledWith('sig');
  });

  it('keeldumisel näitab põhjust', () => {
    render(<Harness onApply={() => 'pageBreak'} />);
    fireEvent.mouseDown(screen.getByRole('button', { name: /Siirdeviit/ }));
    expect(screen.getByRole('status').textContent).toMatch(/lehevahetust/);
  });

  it('× sulgeb', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.mouseDown(screen.getByTitle(/Sulge/));
    expect(onClose).toHaveBeenCalled();
  });

  it('rikutud või liiga suur asukoht klammerdatakse', () => {
    localStorage.setItem('vutt_pagemark_palette_pos', '{"x":9999,"y":9999}');
    const { container } = render(<Harness />);
    const pal = container.querySelector('[data-testid="pagemark-palette"]') as HTMLElement;
    expect(pal.style.left).toBe('0px'); // jsdom: kasti laius 0 → klammerdub 0-ks
    localStorage.setItem('vutt_pagemark_palette_pos', 'ei ole json');
    expect(() => render(<Harness />)).not.toThrow();
  });

  it('avatuse vaikeväärtus on lahti, ka ilma localStorage-ita', () => {
    expect(readPaletteOpen()).toBe(true);
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(readPaletteOpen()).toBe(true);
    spy.mockRestore();
  });
});

describe('PageMarkMenu', () => {
  it('täht valib liigi, Esc sulgeb', () => {
    const onApply = vi.fn(() => null);
    const onClose = vi.fn();
    render(<PageMarkMenu anchor={{ left: 0, top: 0 }} onApply={onApply} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'r' });
    expect(onApply).toHaveBeenCalledWith('rh');
    render(<PageMarkMenu anchor={{ left: 0, top: 0 }} onApply={onApply} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
```

Run: `npx vitest run src/components/editor/__tests__/PageMarkPalette.test.tsx`
Expected: FAIL (moodul puudub)

- [ ] **Step 3: Kirjuta `src/components/editor/PageMarkPalette.tsx`**

```tsx
// Lehe tähistuse paneel (ADR 0070, spekk §3): alati nähtav, lohistatav, suletav.
// Katse 2026-10-16: rippmenüüs „peab valikut jahtima", paneel on mugavam.
// Lahti/kinni ja asukoht on brauseri mugavusseaded (localStorage, try/catch).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { PAGE_MARK_KINDS, type PageMarkKind } from '../../markup/vuttTags';
import type { PageMarkRefusal } from './pageMarkEdit';

const OPEN_KEY = 'vutt_pagemark_palette';
const POS_KEY = 'vutt_pagemark_palette_pos';
const KEY_OF: Record<PageMarkKind, string> = { fw: 'f', sig: 's', catch: 'c', rh: 'r' };

export function readPaletteOpen(): boolean {
  try { return localStorage.getItem(OPEN_KEY) !== '0'; } catch { return true; }
}
export function writePaletteOpen(open: boolean): void {
  try { localStorage.setItem(OPEN_KEY, open ? '1' : '0'); } catch { /* mugavusseade */ }
}
function readPos(): { x: number; y: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
    return v && typeof v.x === 'number' && typeof v.y === 'number' ? v : null;
  } catch { return null; }
}

function useRefusal() {
  const { t } = useTranslation(['workspace']);
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const show = useCallback((r: PageMarkRefusal | null) => {
    if (!r) return;
    setMsg(t(`editor.pageMarks.refused.${r}`));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMsg(null), 3000);
  }, [t]);
  return { msg, show };
}

interface PaletteProps {
  open: boolean;
  onClose: () => void;
  onApply: (k: PageMarkKind) => PageMarkRefusal | null;
  containerRef: RefObject<HTMLElement | null>;
}

export default function PageMarkPalette({ open, onClose, onApply, containerRef }: PaletteProps) {
  const { t } = useTranslation(['workspace']);
  const palRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(readPos);
  const { msg, show } = useRefusal();

  const clamp = useCallback((x: number, y: number) => {
    const box = containerRef.current;
    const pal = palRef.current;
    const maxX = Math.max(0, (box?.clientWidth ?? 0) - (pal?.offsetWidth ?? 0));
    const maxY = Math.max(0, (box?.clientHeight ?? 0) - (pal?.offsetHeight ?? 0));
    return { x: Math.min(Math.max(0, x), maxX), y: Math.min(Math.max(0, y), maxY) };
  }, [containerRef]);

  // Salvestatud asukoht võib olla kitsama kasti jaoks liiga suur — klammerda kohe.
  useLayoutEffect(() => {
    if (pos) {
      const c = clamp(pos.x, pos.y);
      if (c.x !== pos.x || c.y !== pos.y) setPos(c);
    }
  }, [pos, clamp, open]);

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const pal = palRef.current;
    if (!pal) return;
    const start = { px: e.clientX, py: e.clientY, x: pal.offsetLeft, y: pal.offsetTop };
    const move = (ev: PointerEvent) => setPos(clamp(start.x + ev.clientX - start.px, start.y + ev.clientY - start.py));
    const up = () => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      try { localStorage.setItem(POS_KEY, JSON.stringify({ x: pal.offsetLeft, y: pal.offsetTop })); } catch { /* mugavusseade */ }
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  };

  if (!open) return null;
  const style = pos ? { left: `${pos.x}px`, top: `${pos.y}px` } : { right: '14px', top: '6px' };
  return (
    <div ref={palRef} data-testid="pagemark-palette" style={style}
      className="absolute z-10 flex items-center gap-1 rounded-md border border-gray-300 bg-white/95 px-1.5 py-1 text-xs shadow-sm">
      <span onPointerDown={startDrag} title={t('editor.pageMarks.drag')}
        className="cursor-grab select-none pr-1 text-[11px] text-gray-400">⠿ {t('editor.pageMarks.title')}</span>
      {PAGE_MARK_KINDS.map(k => (
        <button key={k} type="button" onMouseDown={e => { e.preventDefault(); show(onApply(k)); }}
          className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-gray-700 hover:border-indigo-200 hover:bg-indigo-50">
          {t(`editor.pageMarks.${k}`)}<span className="ml-1 font-mono text-[10px] text-gray-400">{KEY_OF[k]}</span>
        </button>
      ))}
      <button type="button" onMouseDown={e => { e.preventDefault(); onClose(); }} title={t('editor.pageMarks.close')}
        className="px-1 text-gray-400 hover:text-gray-700"><X size={13} /></button>
      {msg && <span role="status" className="absolute left-0 top-full mt-1 whitespace-nowrap rounded bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800 shadow-sm">{msg}</span>}
    </div>
  );
}

interface MenuProps {
  anchor: { left: number; top: number };
  onApply: (k: PageMarkKind) => PageMarkRefusal | null;
  onClose: () => void;
}

// Ctrl/⌘+Shift+F menüü kursori juures: täht (f s c r) või nooled + Enter, Esc sulgeb.
export function PageMarkMenu({ anchor, onApply, onClose }: MenuProps) {
  const { t } = useTranslation(['workspace']);
  const [active, setActive] = useState(0);
  const { msg, show } = useRefusal();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const byKey = PAGE_MARK_KINDS.find(k => KEY_OF[k] === e.key.toLowerCase());
      let handled = true;
      if (byKey) { const r = onApply(byKey); show(r); if (!r) onClose(); }
      else if (e.key === 'ArrowDown') setActive(a => (a + 1) % PAGE_MARK_KINDS.length);
      else if (e.key === 'ArrowUp') setActive(a => (a + PAGE_MARK_KINDS.length - 1) % PAGE_MARK_KINDS.length);
      else if (e.key === 'Enter') { const r = onApply(PAGE_MARK_KINDS[active]); show(r); if (!r) onClose(); }
      else if (e.key === 'Escape') onClose();
      else handled = false;
      if (handled) { e.preventDefault(); e.stopPropagation(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [active, onApply, onClose, show]);
  return (
    <div role="menu" style={{ left: anchor.left, top: anchor.top }}
      className="fixed z-[1250] min-w-[220px] rounded-md border border-gray-300 bg-white p-1 text-xs shadow-lg">
      <div className="px-2 pb-1 pt-0.5 text-[11px] text-gray-400">{t('editor.pageMarks.title')}</div>
      {PAGE_MARK_KINDS.map((k, i) => (
        <div key={k} role="menuitem" onMouseDown={e => { e.preventDefault(); const r = onApply(k); show(r); if (!r) onClose(); }}
          className={`flex cursor-pointer justify-between gap-4 rounded px-2 py-1 ${i === active ? 'bg-indigo-50' : 'hover:bg-indigo-50'}`}>
          <span>{t(`editor.pageMarks.${k}`)}</span><span className="font-mono text-gray-400">{KEY_OF[k]}</span>
        </div>
      ))}
      {msg && <div role="status" className="px-2 py-1 text-[11px] text-amber-800">{msg}</div>}
    </div>
  );
}
```

NB `z-[1250]`: menüü on `fixed` ja peab olema päise (`z-[1200]`) kohal, aga modaalide (`z-[1300]`) all.

Run: `npx vitest run src/components/editor/__tests__/PageMarkPalette.test.tsx`
Expected: PASS

- [ ] **Step 4: Kiirklahv** — `src/components/editor/useCodeMirrorLifecycle.ts`

Liidesesse `wrapWithTagRef` järele: `openPageMarkMenuRef: MutableRefObject<() => void>;`; destruktureeri parameetrites; keymapi `Mod-Shift-l` rea järele:

```ts
            // Lehe tähistus (ADR 0070): menüü kursori juures. Ctrl+Shift+S/C on brauseri omad.
            { key: 'Mod-Shift-f', run: () => { openPageMarkMenuRef.current(); return true; }, preventDefault: true },
```

(Globaalne Ctrl+F käsitleja kontrollib `e.key === 'f'`; Shiftiga on `e.key === 'F'`, nii et ta seda ei püüa — ära muuda teda.)

- [ ] **Step 5: Tööriistariba nupp** — `src/components/editor/EditorToolbar.tsx`

Propsidesse: `pageMarkPaletteOpen: boolean; togglePageMarkPalette: () => void;` (liides + destruktureerimine). Import `Hash` `lucide-react`-ist. `<pb/>` nupu järele (enne eraldajat):

```tsx
        <button type="button" onClick={togglePageMarkPalette}
          className={`w-7 h-7 flex items-center justify-center rounded border ${pageMarkPaletteOpen ? 'bg-gray-100 border-gray-200 text-gray-700' : 'border-transparent hover:bg-gray-100 hover:border-gray-200 text-gray-500'}`}
          title={t('editor.pageMarks.toolbar')} aria-pressed={pageMarkPaletteOpen}><Hash size={14} /></button>
```

- [ ] **Step 6: Paneel ja menüü redaktori kasti** — `src/components/editor/EditorEditTab.tsx`

Propsid (liides + destruktureerimine + `EditorToolbar`-ile edasi):

```ts
  pageMarkPaletteOpen: boolean;
  togglePageMarkPalette: () => void;
  wrapPageMark: (kind: PageMarkKind) => PageMarkRefusal | null;
  pageMarkMenu: { left: number; top: number } | null;
  closePageMarkMenu: () => void;
```

Importid: `import { useRef } from 'react';`, `import PageMarkPalette, { PageMarkMenu } from './PageMarkPalette';`, `import type { PageMarkKind } from '../../markup/vuttTags';`, `import type { PageMarkRefusal } from './pageMarkEdit';`.

Komponendi alguses: `const boxRef = useRef<HTMLDivElement>(null);`. Muuda redaktori kast (`<div className="flex-1 relative flex overflow-hidden bg-white">`) → lisa `ref={boxRef}` ja editorContainerRef-diivi järele:

```tsx
        {!readOnly && (
          <PageMarkPalette open={pageMarkPaletteOpen} onClose={togglePageMarkPalette}
            onApply={wrapPageMark} containerRef={boxRef} />
        )}
```

Komponendi lõpus (enne `SpecialCharsPanel`-it):

```tsx
      {pageMarkMenu && !readOnly && (
        <PageMarkMenu anchor={pageMarkMenu} onApply={wrapPageMark} onClose={closePageMarkMenu} />
      )}
```

- [ ] **Step 7: Olek ja ühendus** — `src/components/TextEditor.tsx`

`wrapWithTagRef` rea (~89) järele:

```ts
  const openPageMarkMenuRef = useRef<() => void>(() => {});
  const [pageMarkPaletteOpen, setPageMarkPaletteOpen] = useState(readPaletteOpen);
  const [pageMarkMenu, setPageMarkMenu] = useState<{ left: number; top: number } | null>(null);
  const togglePageMarkPalette = useCallback(() => {
    setPageMarkPaletteOpen(o => { writePaletteOpen(!o); return !o; });
  }, []);
  const closePageMarkMenu = useCallback(() => { setPageMarkMenu(null); viewRef.current?.focus(); }, []);
```

(Import `readPaletteOpen, writePaletteOpen` `./editor/PageMarkPalette`-ist; `useCallback`/`useState` on tõenäoliselt juba imporditud — kontrolli.) `useCodeMirrorLifecycle({ … wrapWithTagRef, openPageMarkMenuRef, … })`. `useEditorFormattingActions` destruktureerimisse lisa `wrapPageMark`. `useEffect(() => { wrapWithTagRef.current = wrapWithTag; }, [wrapWithTag]);` järele:

```ts
  useEffect(() => {
    openPageMarkMenuRef.current = () => {
      const view = viewRef.current;
      if (!view || readOnly) return;
      const c = view.coordsAtPos(view.state.selection.main.head);
      setPageMarkMenu(c ? { left: c.left, top: c.bottom + 4 } : { left: 40, top: 120 });
    };
  }, [readOnly]);
```

`<EditorEditTab … />` propsidesse: `pageMarkPaletteOpen={pageMarkPaletteOpen} togglePageMarkPalette={togglePageMarkPalette} wrapPageMark={wrapPageMark} pageMarkMenu={pageMarkMenu} closePageMarkMenu={closePageMarkMenu}`.

Lehepööre ei monteeri redaktorit maha (ADR 0010) — paneeli olek on kasutaja mugavus ja PEABKI lehevahetuse üle jääma; menüü (`pageMarkMenu`) sulge lehevahetuse effectis: leia `TextEditor.tsx`-ist lehevahetuse lähtestamise effect (`grep -n "setIsDirty(false)\|saveError" src/components/TextEditor.tsx`) ja lisa sinna `setPageMarkMenu(null);`.

- [ ] **Step 8: Väravad**

Run: `npm run typecheck && npm test && npm run lint:ci`
Expected: PASS; lint hoiatusi ≤ 41

- [ ] **Step 9: Käsitsi kontroll (Review Focus 5)**

Tunnel eraldi aknas (`ssh -N -L 7700:localhost:7700 -L 8001:localhost:8001 -L 8002:localhost:8002 vutt`), siis `npm run dev`, ava `http://localhost:3000/work/lzogr0/4` **sisse logimata** (salvestus ei lähe tootmisse; redaktor on vaatamiseks — kui redaktor nõuab sisselogimist, kasuta lehe JSON-it ainult lugemiseks ja ÄRA vajuta Ctrl+S). Kontrolli: paneel nurgas, lohistamine, `Ctrl+Shift+F` menüü, `Vorrede` → `rh`, nooled ja Shift+nooled üle tähistuse (rea kõrgus ei muutu, kursor ei hüppa). Tulemus kirjuta PR-i kirjeldusse.

- [ ] **Step 10: Commit**

```bash
git branch --show-current
git add src/components/editor/PageMarkPalette.tsx src/components/editor/__tests__/PageMarkPalette.test.tsx src/components/editor/EditorEditTab.tsx src/components/editor/EditorToolbar.tsx src/components/editor/useCodeMirrorLifecycle.ts src/components/TextEditor.tsx src/locales/et/workspace.json src/locales/en/workspace.json
git commit -m "feat(editor): lehe tähistuse paneel, Ctrl+Shift+F menüü ja tööriistariba nupp (#630)"
```

---

### Task 8: MCP — tähistus lehe päises

**Files:**
- Modify: `mcp/vutt_mcp/queries.py` (`PAGE_RETRIEVE_FIELDS`)
- Modify: `mcp/vutt_mcp/format.py` (`format_pages`)
- Modify: `mcp/vutt_mcp/server.py` (`search_pages` ja `get_pages` tööriista kirjeldus), `mcp/README.md`
- Test: `mcp/tests/test_format.py`

**Interfaces:**
- Consumes: Meili lehedokumendi väli `page_marks` (Task 3)
- Produces: `format_pages` päis kujul `── lk N · seisund=S · signatuur A iij · siirdeviit Vor⸗ · <url>`

- [ ] **Step 1: Kirjuta ebaõnnestuvad testid** (`mcp/tests/test_format.py` lõppu)

```python
def test_format_pages_naitab_lehe_tahistust_paises():
    pages = [{
        "lehekylje_number": 5,
        "lehekylje_tekst": "derſelben Ihr gnädigſt",
        "status": "Toores",
        "page_marks": [{"kind": "sig", "text": "A iij", "seg": 0},
                       {"kind": "catch", "text": "Vor⸗", "seg": 0}],
    }]
    out = fmt.format_pages(pages, base_url=BASE, work_id="abc")
    paise = out.splitlines()[0]
    assert "signatuur A iij" in paise
    assert "siirdeviit Vor⸗" in paise


def test_format_pages_ilma_tahistuseta_paises_sama():
    pages = [{"lehekylje_number": 5, "lehekylje_tekst": "x", "status": "Toores"}]
    out = fmt.format_pages(pages, base_url=BASE, work_id="abc")
    assert out.splitlines()[0] == f"── lk 5 · seisund=Toores · {BASE}/work/abc/5"
```

(Kontrolli `work_url` kuju `grep -n "def work_url" -A6 mcp/vutt_mcp/format.py`; kui URL-i kuju on teine, kohanda teise testi oodatud rida selle järgi — test peab kinnitama, et päis ei muutunud.)

Run: `PYTHONPATH=$PWD .venv/bin/pytest mcp/tests/test_format.py -q`
Expected: FAIL (esimene)

- [ ] **Step 2: Muuda `format.py`**

Faili ülaosas (teiste konstantide juures):

```python
# Lehe tähistus (ADR 0070) — raamatukogusõnastiku eelistermin. Otsing seda ei leia:
# tähistus on otsingutekstist väljas, ainult kuvamiseks.
PAGE_MARK_LABELS = {"fw": "nr", "sig": "signatuur", "catch": "siirdeviit", "rh": "veerutiitel"}


def _page_marks_header(page: dict) -> str:
    marks = page.get("page_marks") or []
    osad = [f"{PAGE_MARK_LABELS.get(m.get('kind'), m.get('kind'))} {m.get('text')}"
            for m in marks if isinstance(m, dict) and m.get("text")]
    return "".join(f"{o} · " for o in osad)
```

`format_pages` päise rida:

```python
        blocks.append(
            f"── lk {num} · seisund={page.get('status', '?')} · "
            + _page_marks_header(page)
            + work_url(work_id, num, base_url=base_url)
        )
```

- [ ] **Step 3: `queries.py`** — `PAGE_RETRIEVE_FIELDS`-isse `"marginaalia_tekst",` järele:

```python
    # Lehe tähistus (ADR 0070): leheküljenumber, signatuur, siirdeviit, veerutiitel —
    # otsingutekstist väljas, siin ainult kuvamiseks.
    "page_marks",
```

- [ ] **Step 4: Tööriista kirjeldused ja README**

`mcp/vutt_mcp/server.py` — `search_pages` docstringi lõppu lisa lõik:

```
LEHE TÄHISTUS (leheküljenumber, signatuur, siirdeviit, veerutiitel) ei ole
otsingutekstis — „A iij" või „Vorrede" otsimine ei leia märgendatud tähistust.
get_pages näitab tähistust lehe päises.
```

`get_pages` docstringi NUMERATSIOON-lõigu järele:

```
Kui lehel on märgendatud lehe tähistus, on see päises (`signatuur A iij ·
siirdeviit Vor⸗`) — see on trükise/käsikirja enda tähistus, mitte VUTT-i number.
```

`mcp/README.md` — `get_pages`/`search_pages` kirjelduse juurde sama sisu üks lause kummagi kohta.

- [ ] **Step 5: Käivita MCP testid**

Run: `PYTHONPATH=$PWD .venv/bin/pytest mcp/tests -q`
Expected: PASS (sh `test_meili_contract.py::test_tagastatavad_valjad_eksisteerivad_dokumendis` — `"page_marks"` on `meili_doc.py`-s Task 3-st)

- [ ] **Step 6: Commit**

```bash
git branch --show-current
git add mcp/vutt_mcp/queries.py mcp/vutt_mcp/format.py mcp/vutt_mcp/server.py mcp/README.md mcp/tests/test_format.py
git commit -m "feat(mcp): lehe tähistus get_pages päises (#630)"
```

---

### Task 9: Dokumendid — ADR 0071, ADR 0070, transkribeerimisjuhend

**Files:**
- Create: `docs/decisions/0071-markendus-on-tei-alamhulga-luhisuntaks.md`
- Modify: `docs/decisions/README.md` (register), `docs/decisions/0070-lehe-tahistus-ja-lehe-aadress.md`
- Modify: `public/transcription_guide.html`, `public/transcription_guide_en.html` (pärast „Lisandused" / „Insertions" jaotist)

- [ ] **Step 1: Kirjuta ADR 0071**

```markdown
# ADR 0071 — VUTT-i märgendus on TEI alamhulga lühisüntaks

**Kuupäev:** 2026-10-17
**Staatus:** kehtib
**Seotud:** ADR 0067 (`<add>`), ADR 0070 (lehe tähistus), #630

## Kontekst

VUTT-i tägisid oli 9 ja ühtki kirjapandud reeglit, mis tägiks kõlbab. Tägide loend
oli koodis vähemalt kuues kohas (redaktor, lugemisvaade, normaliseerija kaks loendit,
„Puhasta", wrapTagUtils); `<add>` puudutas 19 faili (#579). Lehe tähistus (ADR 0070)
tõi neli tägi juurde. Mure: VUTT-ist kujuneb murre, mida ei saa kadudeta TEI-ks
teisendada.

## Otsus

1. **Uus täg ainult siis, kui TEI-s on otsene vaste.** Nimi tuleb TEI elemendist või
   selle `type`-ist.
2. **Atribuute ei ole.** TEI atribuudi info kannab tägi nimi (`<sig>` = `fw type="sig"`).
3. **Iga täg on registris** koos TEI vaste ja käitumisega: `server/vutt_tags.py` ja
   `src/markup/vuttTags.ts`. Kooskõla valvab `tests/test_vutt_tags_parity.py`;
   tarbijaloendid tuletatakse registrist (`src/markup/consumers.ts`,
   `marginalia_normalize._INLINE`/`_EMPTY_RE`) ja `vuttTagsConsumers.test.ts` kontrollib
   redaktori `VUTT_TAGS`-i.

| Täg | TEI | Otsingusse |
|---|---|---|
| `i` `b` | `hi rend="italic\|bold"` | jah |
| `cs` | `hi`, kiri vastupidine teose põhikirjale — **erand**, vt allpool | jah |
| `hi` | `hi` | jah |
| `m` | `note place="margin"` | `marginaalia_tekst` |
| `add` | `add` (ADR 0067) | jah |
| `annN` | toimetaja märkuse ankur (`anchor`/`span` + `note`) — **erand**: VUTT-i toimetajakiht, mitte allika märgendus | jah |
| `fn` | `ref type="note"` (joonealuse viide) | ei |
| `pb` | `pb` | ei |
| `fw` `sig` `catch` `rh` | `fw type="pageNum\|sig\|catch\|header"` (ADR 0070) | ei → `page_marks` |

**`cs` on suhteline** (koodivahetus teose põhikirja suhtes). TEI teeb sama: põhikiri
deklareeritakse kord (`<text rendition="…">`), kõrvalekalle märgitakse. Puudu on
põhikirja väli; seni ei ole `cs`-i TEI teisendus mehaaniline.

**Eksport** (treeningandmed, LOSS `build_vutt_dataset.py`): toortekst läheb välja
tägidega muutmata; ehitaja otsustab, mida mudelile anda.

## Tagajärjed

- Uus täg = registri kirje MÕLEMAS failis + `VUTT_TAGS` kirje (kuvaklass) + juhend;
  paarsustest kukub, kui midagi puudub.
- TEI eksport on hiljem mehaaniline (v.a `cs` ilma põhikirja väljata).
- Tägi, millel TEI vastet ei ole, ei lisata.
```

- [ ] **Step 2: Registri rida** — `docs/decisions/README.md`, `| [0070]…` rea järele:

```markdown
| [0071](0071-markendus-on-tei-alamhulga-luhisuntaks.md) | VUTT-i märgendus on TEI alamhulga lühisüntaks: uus täg ainult otsese TEI vastega, atribuute ei ole, iga täg registris (`server/vutt_tags.py` + `src/markup/vuttTags.ts`, paarsustest); `cs` erand kuni põhikirja väljani | kehtib |
```

- [ ] **Step 3: ADR 0070** — `**Seotud:**` reale lisa „ADR 0071 (märgenduse register)"; `## Otsus` alguse ette:

```markdown
**Teostus (spekk 1):** `docs/superpowers/specs/2026-10-16-lehe-tahistus-tagid-design.md`,
plaan `docs/superpowers/plans/2026-10-17-lehe-tahistus-tagid.md` — tägid, otsingutekst,
`page_marks`, paneel. Aadressi tuletus (punktid 4–7) on spekk 2.
```

- [ ] **Step 4: Transkribeerimisjuhend (et)** — `public/transcription_guide.html`, „Lisandused" `</ul>` järele:

```html
<h3>Lehe tähistus (lehenumber, signatuur, siirdeviit, veerutiitel)</h3>
<ul>
  <li>Lehe tähistus on lehe kui füüsilise objekti tähistus, mitte teksti osa: <strong>lehe- või leheküljenumber</strong>, <strong>signatuur</strong> (nt <code>A iij</code>), <strong>siirdeviit</strong> (järgmise lehe esimene silp lehe lõpus) ja <strong>veerutiitel</strong> (lehe ülaservas korduv pealkiri). See ei ole marginaalia.</li>
  <li>Kirjuta tähistus täht-tähelt nii, nagu ta lehel on, eraldi reale. Pane kursor reale ja klõpsa paneelil vastavat nuppu (paneel on redaktori nurgas, lohistatav; tööriistariba nupp <strong>#</strong> toob ta tagasi) või vajuta <strong>Ctrl+Shift+F</strong> ja seejärel <strong>f</strong> / <strong>s</strong> / <strong>c</strong> / <strong>r</strong>. Ilma valikuta märgitakse kogu rida, valikuga ainult valik.</li>
  <li>Märgi <strong>funktsiooni järgi</strong>, mitte sõna järgi: <em>Vorrede.</em> jaotise alguses on pealkiri, sama sõna järgmiste lehtede ülaservas on veerutiitel.</li>
  <li>Siirdeviida poolitusmärk jääb siirdeviida sisse (<code>Vor⸗</code>).</li>
  <li>Märgitud tähistus ei ole otsingutekstis, seega ei kleepu signatuur enam eelmise sõna külge.</li>
</ul>
```

- [ ] **Step 5: Transkribeerimisjuhend (en)** — `public/transcription_guide_en.html`, „Insertions" `</ul>` järele:

```html
<h3>Page marks (folio/page number, signature, catchword, running head)</h3>
<ul>
  <li>A page mark labels the page as a physical object and is not part of the text: <strong>folio or page number</strong>, <strong>signature</strong> (e.g. <code>A iij</code>), <strong>catchword</strong> (the first syllable of the next page at the foot of the page) and <strong>running head</strong> (a title repeated at the top of the page). It is not a marginal note.</li>
  <li>Transcribe the mark exactly as printed or written, on its own line. Put the cursor on the line and click the matching button on the panel (in the editor corner, draggable; the toolbar button <strong>#</strong> brings it back) or press <strong>Ctrl+Shift+F</strong> followed by <strong>f</strong> / <strong>s</strong> / <strong>c</strong> / <strong>r</strong>. Without a selection the whole line is marked; with a selection only the selection.</li>
  <li>Mark by <strong>function</strong>, not by word: <em>Vorrede.</em> at the start of a section is a heading; the same word at the top of the following pages is a running head.</li>
  <li>A catchword keeps its hyphen inside the mark (<code>Vor⸗</code>).</li>
  <li>Marked page marks are excluded from the search text, so a signature no longer sticks to the preceding word.</li>
</ul>
```

- [ ] **Step 6: Commit**

```bash
git branch --show-current
git add docs/decisions/0071-markendus-on-tei-alamhulga-luhisuntaks.md docs/decisions/README.md docs/decisions/0070-lehe-tahistus-ja-lehe-aadress.md public/transcription_guide.html public/transcription_guide_en.html
git commit -m "docs: ADR 0071 märgenduse register, ADR 0070 viide, juhend — lehe tähistus (#630)"
```

---

### Task 10: Korpuse kuivkäivitus, väravad, PR

**Files:**
- Create: `scripts/dryrun_page_marks_search.py`

**Interfaces:**
- Consumes: `server.meili_doc.clean_text_for_search` (uus), `server.vutt_tags.remove_page_marks`

- [ ] **Step 1: Kirjuta skript** (ainult lugemine; spekk „Riskid": märgendamata korpusel peab muudatus andma null erinevust)

```python
"""Kuivkäivitus (#630): kas lehe tähistuse samm muudab korpuse otsinguteksti?

Keegi ei ole veel märgendanud, seega PEAB tulemus olema 0 erinevat lehte. Iga
erinevus tähendab, et samm puudutab midagi muud (nt sõnasõnaline `<fw>` tekstis).
Ainult lugemine. Käivita serveris host-venviga:
    cd ~/VUTT && .venv/bin/python scripts/dryrun_page_marks_search.py
"""
import glob
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from server.config import BASE_DIR  # noqa: E402
from server.meili_doc import clean_text_for_search  # noqa: E402
from server.vutt_tags import PAGE_MARK_KINDS, remove_page_marks  # noqa: E402


def main():
    pages = erinev = tahisega = 0
    for path in glob.glob(os.path.join(BASE_DIR, "*", "*.txt")):
        if os.path.basename(os.path.dirname(path)).startswith((".", "_")):
            continue
        with open(path, encoding="utf-8") as f:
            text = f.read()
        pages += 1
        if any(f"<{k}>" in text for k in PAGE_MARK_KINDS):
            tahisega += 1
        if remove_page_marks(text) != text:
            erinev += 1
            print("ERINEB:", path)
    print(f"lehti {pages}, tähistusega {tahisega}, otsingutekst erineb {erinev}")
    # Kontroll, et uus funktsioon ei viska ühelgi lehel
    for path in glob.glob(os.path.join(BASE_DIR, "*", "*.txt"))[:2000]:
        with open(path, encoding="utf-8") as f:
            clean_text_for_search(f.read())
    sys.exit(1 if erinev else 0)


if __name__ == "__main__":
    main()
```

(`BASE_DIR` — kontrolli `grep -n "^BASE_DIR" server/config.py`; kui nimi on teine, kasuta seda, mida `server/config.py` andmekausta kohta ekspordib.)

- [ ] **Step 2: Lokaalne kontroll** (lokaalne `data/` ei peegelda tootmist, aga skript peab jooksma)

Run: `.venv/bin/python scripts/dryrun_page_marks_search.py; echo exit=$?`
Expected: viimane rida `… otsingutekst erineb 0`, `exit=0`

- [ ] **Step 3: Kõik väravad**

Run: `npm run typecheck && npm test && npm run lint:ci && .venv/bin/pytest tests/ -q && PYTHONPATH=$PWD .venv/bin/pytest mcp/tests -q`
Expected: kõik PASS; lint ≤ 41 hoiatust

- [ ] **Step 4: Commit + push + PR**

```bash
git branch --show-current
git add scripts/dryrun_page_marks_search.py
git commit -m "chore(scripts): lehe tähistuse kuivkäivitus otsingutekstile (#630)"
git push -u origin feat/lehe-tahistus-630
gh pr create --base main --title "feat: lehe tähistus — tägid, otsingutekst, page_marks, paneel (#630, spekk 1)" --body "Spekk: docs/superpowers/specs/2026-10-16-lehe-tahistus-tagid-design.md · Plaan: docs/superpowers/plans/2026-10-17-lehe-tahistus-tagid.md · ADR 0070, 0071

Deploy: backend (server_update.sh --no-cache) + frontend (build + rsync). Enne deploy'd tootmises: \`.venv/bin/python scripts/dryrun_page_marks_search.py\` → 0 erinevust. Täisreindeksit ei ole vaja (page_marks tekib järgmisel sünkil).

Käsitsi kontroll (Task 7 samm 9): <tulemus>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 5: Pärast merge'i** (kasutaja luba eraldi)

- serveris kuivkäivitus (`cd ~/VUTT && git pull && .venv/bin/python scripts/dryrun_page_marks_search.py`) → 0 erinevust;
- deploy backend + frontend;
- #630 kommentaar: spekk 1 tehtud, spekk 2 järgmine; uued issue'd: OCR-rada (Gemini juhis + Qwen treeningandmed: DTA `fw`, PAGE `TextRegion @type`), põhikirja väli (`cs` TEI teisendus);
- kustuta katseharu: `git push origin --delete spike/lehe-tahistus-kiirklahv` (kui pushitud) ja `git branch -D spike/lehe-tahistus-kiirklahv`.
