# Kreeka keele tuvastus ja märgistus — teostusplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Märgistada skriptiga kõik teosed, milles on vähemalt üks vähemalt 20 % ulatuses kreekakeelne lehekülg (`languages += "grc"`, ~112 teost), ja lisada otsingulehele keelefilter.

**Architecture:** Kolm sõltumatut osa. (1) Puhas tuvastusmoodul `server/greek_detect.py` — ilma failisüsteemita, seega täielikult ühiktestitav. (2) Skript `scripts/detect_greek.py`, mis moodulit kasutab, kirjutab `_metadata.json`-i otse ja teeb ühe git-commiti. (3) Frontendi keelefilter, mis loeb sõnavarast ja lisab Meili filtriklausli. Osad 1–2 ja osa 3 ei sõltu teineteisest ja neid võib teha kummas järjekorras tahes.

**Tech Stack:** Python 3.9 (backend, Docker), React 19 + TypeScript + Vite, Meilisearch, vitest, pytest.

**Spekk:** `docs/superpowers/specs/2026-08-11-kreeka-keele-tuvastus-design.md`

## Global Constraints

- **Koodikommentaarid eesti keeles.** Ka docstringid ja commit-sõnumid.
- **Python 3.9 ühilduvus:** `Optional[dict]`, `List[str]`, `Tuple[int, float]` — MITTE `dict | None` ega `list[str]`.
- **i18n:** `fallbackLng` on VÄLJAS (ADR 0011). Iga uus tõlkevõti läheb **korraga mõlemasse** faili — `src/locales/et/search.json` JA `src/locales/en/search.json`. Ühte lisamine katkestab buildi testis `localeParity.test.ts`.
- **Väravad enne iga commiti** (samad jooksevad CI-s): `npm run typecheck`, `npm test`, `npm run lint:ci` (lävi `--max-warnings 55`, parandades LANGETA), `.venv/bin/pytest tests/`.
- **pytest käib alati projekti venv-iga:** `.venv/bin/pytest`, MITTE süsteemi `python3 -m pytest` (sõltuvused puuduvad).
- **Skript jookseb serveris Dockeris:** `docker exec vutt-backend python3 scripts/detect_greek.py`. Lokaalselt arendades jookseb sama skript lokaalse `data/` vastu, aga **lokaalne `data/` EI peegelda tootmist** — ära tee järeldusi selle sisust.
- **Kreeka tähemärgid:** `U+0370–U+03FF` (Greek and Coptic) + `U+1F00–U+1FFF` (Greek Extended). **Ladina tähemärgid:** `A–Z`, `a–z`, `À–ÿ` (`U+00C0–U+00FF`).
- **Lävendid:** osakaal `>= 0.20`, kreeka tähemärke `>= 20`.
- Tööharu on juba olemas: `feat/kreeka-keele-tuvastus`. Ära loo uut.

---

## Failide struktuur

**Luuakse:**

| Fail | Vastutus |
|---|---|
| `server/greek_detect.py` | Puhas tuvastusloogika: tähemärkide lugemine, osakaal, lävendiotsus. Ei puutu faile ega metaandmeid. |
| `scripts/detect_greek.py` | Käsurea-skript: käib `data/` läbi, kasutab `greek_detect`-i, kirjutab metaandmed, teeb git-commiti, toodab aruande. |
| `tests/test_greek_detect.py` | `server/greek_detect.py` ühiktestid. |
| `tests/test_detect_greek_script.py` | Skripti metaandmete-uuendamise loogika testid (ajutise kaustaga). |
| `docs/decisions/0019-keelemargend-grc-sisaldab-osa.md` | ADR: mida `grc` pärast seda tööd tähendab. |
| `src/pages/search/hooks/__tests__/searchUrlParams.test.ts` | URL-parameetri parsimise testid. |
| `src/services/__tests__/searchLanguages.test.ts` | Keele-filtriklausli testid. |

**Muudetakse:**

| Fail | Muudatus |
|---|---|
| `src/pages/search/hooks/useSearchUrlParams.ts` | eksporditud `parseListParam`, `languages: string[]` väli, URL-param `langs` |
| `src/pages/search/hooks/useFilterDraft.ts` | `selectedLanguages` olek + `commit` + `clearFilters` + deps |
| `src/pages/search/SearchFilters.tsx` | uus „Keel" sektsioon + `onLanguageToggle` prop |
| `src/pages/SearchPage.tsx` | `onLanguageToggle` juhtmestik + aktiivse filtri kiip |
| `src/pages/search/hooks/useSearchResults.ts` | `languages` edasi `searchContent`-ile |
| `src/services/searchService.ts` | `languages?: string[]` options-is + filtriklausel |
| `src/locales/et/search.json`, `src/locales/en/search.json` | `filters.languages` |

---

### Task 1: Puhas tuvastusmoodul

Kogu sisuline otsustusloogika ühte faili, mis ei tea failisüsteemist midagi. See teeb testimise triviaalseks ja hoiab skripti õhukeseks.

**Files:**
- Create: `server/greek_detect.py`
- Test: `tests/test_greek_detect.py`

**Interfaces:**
- Consumes: mitte midagi (ainult standardteek `re`)
- Produces:
  - `GREEK_RATIO_THRESHOLD: float = 0.20`
  - `GREEK_MIN_CHARS: int = 20`
  - `greek_ratio(text: str) -> Tuple[int, float]` — tagastab `(kreeka tähemärkide arv, osakaal)`
  - `page_is_greek(text: str) -> bool`
  - `work_qualifies(pages: Dict[str, str]) -> Tuple[bool, List[str]]` — sisend `{failinimi: tekst}`, tagastab `(kas läbib, sorteeritud kvalifitseeruvate failinimede loend)`

- [ ] **Step 1: Kirjuta kukkuvad testid**

Loo `tests/test_greek_detect.py`:

```python
"""Kreeka keele tuvastuse ühiktestid (server/greek_detect.py)."""


def test_puhas_ladina_annab_nulli():
    from server.greek_detect import greek_ratio
    count, ratio = greek_ratio("Disputatio theologica de anima")
    assert count == 0
    assert ratio == 0.0


def test_puhas_kreeka_annab_taisosakaalu():
    from server.greek_detect import greek_ratio
    count, ratio = greek_ratio("περὶ τῆς ψυχῆς")
    assert count == 12
    assert ratio == 1.0


def test_tuhi_tekst_ei_jaga_nulliga():
    from server.greek_detect import greek_ratio
    assert greek_ratio("") == (0, 0.0)
    assert greek_ratio("1648 — 12,5 %") == (0, 0.0)


def test_segu_arvutab_osakaalu():
    from server.greek_detect import greek_ratio
    # λόγος = 5 kreeka tähte, Verbum = 6 ladina tähte, tühik ei loe
    count, ratio = greek_ratio("λόγος Verbum")
    assert count == 5
    assert abs(ratio - 5 / 11) < 1e-9


def test_kreeka_extended_plokk_loetakse():
    from server.greek_detect import greek_ratio
    # ἀ on U+1F00 (Greek Extended), mitte põhiplokis
    count, _ = greek_ratio("ἀἁἂ")
    assert count == 3


def test_markup_tagid_ei_loe_ladina_hulka_valesti():
    from server.greek_detect import greek_ratio
    # <i> sisaldab ladina tähte 'i' — see ON ladina täht ja loeb.
    # Test fikseerib teadliku valiku: märgendeid EI eemaldata,
    # sest nende maht on tekstiga võrreldes tühine ja eemaldamine
    # tooks sisse parsimisvea riski.
    count, ratio = greek_ratio("<i>λόγος</i>")
    assert count == 5
    assert ratio == 5 / 7


def test_lavend_20_protsenti_piiril():
    from server.greek_detect import page_is_greek
    # 20 kreeka + 80 ladina = täpselt 20% → LÄBIB
    assert page_is_greek("α" * 20 + "a" * 80) is True
    # 20 kreeka + 81 ladina = 19,8% → EI LÄBI
    assert page_is_greek("α" * 20 + "a" * 81) is False


def test_tahemargi_valvur_lykkab_luhikese_tagasi():
    from server.greek_detect import page_is_greek
    # 19 kreeka tähemärki 100% osakaaluga → EI LÄBI (liiga lühike)
    assert page_is_greek("α" * 19) is False
    # 20 tähemärki → LÄBIB
    assert page_is_greek("α" * 20) is True


def test_work_qualifies_uks_leht_paljude_seas():
    from server.greek_detect import work_qualifies
    pages = {f"lk-{i:03d}.txt": "Latina oratio " * 40 for i in range(200)}
    pages["lk-077.txt"] = "α" * 60 + "a" * 40
    ok, hits = work_qualifies(pages)
    assert ok is True
    assert hits == ["lk-077.txt"]


def test_work_qualifies_tagastab_lehed_sorteeritult():
    from server.greek_detect import work_qualifies
    pages = {
        "c.txt": "α" * 30,
        "a.txt": "α" * 30,
        "b.txt": "ladina tekst ilma kreekata",
    }
    ok, hits = work_qualifies(pages)
    assert ok is True
    assert hits == ["a.txt", "c.txt"]


def test_work_qualifies_ilma_kreekata():
    from server.greek_detect import work_qualifies
    ok, hits = work_qualifies({"a.txt": "Disputatio", "b.txt": ""})
    assert ok is False
    assert hits == []


def test_work_qualifies_tuhi_teos():
    from server.greek_detect import work_qualifies
    assert work_qualifies({}) == (False, [])
```

- [ ] **Step 2: Jooksuta testid, veendu et kukuvad**

```bash
.venv/bin/pytest tests/test_greek_detect.py -v
```

Oodatud: KÕIK kukuvad, `ModuleNotFoundError: No module named 'server.greek_detect'`.

- [ ] **Step 3: Kirjuta moodul**

Loo `server/greek_detect.py`:

```python
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
```

- [ ] **Step 4: Jooksuta testid, veendu et lähevad läbi**

```bash
.venv/bin/pytest tests/test_greek_detect.py -v
```

Oodatud: 12 passed.

- [ ] **Step 5: Committi**

```bash
git add server/greek_detect.py tests/test_greek_detect.py
git commit -m "feat(kreeka): puhas tuvastusmoodul tähemärgistiku järgi

Lehekülg on kreekakeelne, kui kreeka tähtede osakaal kreeka+ladina
tähtedest on >= 20% ja kreeka tähemärke on >= 20. Greek Extended plokk
on kaasatud — varauusaegne kreeka on polütooniline.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Metaandmete uuendamise loogika

Eraldi funktsioon, mis otsustab, kuidas `languages` massiiv muutub. Eraldi Task 1-st, sest siin on idempotentsuse ja säilitamise reeglid, mis on kõige tõenäolisem vigade koht. Eraldi Task 3-st, sest see on testitav ilma git-ita.

**Files:**
- Modify: `server/greek_detect.py` (lisa üks funktsioon)
- Test: `tests/test_greek_detect.py` (lisa testid)

**Interfaces:**
- Consumes: mitte midagi Task 1-st (sõltumatu funktsioon samas failis)
- Produces: `add_language(meta: dict, code: str) -> bool` — muudab `meta`-t **kohapeal**, tagastab `True` kui midagi muutus, `False` kui oli juba olemas

- [ ] **Step 1: Kirjuta kukkuvad testid**

Lisa `tests/test_greek_detect.py` lõppu:

```python
def test_add_language_lisab_puuduva_valja():
    from server.greek_detect import add_language
    meta = {"title": "Oratio"}
    assert add_language(meta, "grc") is True
    assert meta["languages"] == ["grc"]


def test_add_language_sailitab_olemasoleva_keele():
    from server.greek_detect import add_language
    meta = {"languages": ["lat"]}
    assert add_language(meta, "grc") is True
    assert meta["languages"] == ["lat", "grc"]


def test_add_language_on_idempotentne():
    from server.greek_detect import add_language
    meta = {"languages": ["lat", "grc"]}
    assert add_language(meta, "grc") is False
    assert meta["languages"] == ["lat", "grc"]


def test_add_language_tuhi_massiiv():
    from server.greek_detect import add_language
    meta = {"languages": []}
    assert add_language(meta, "grc") is True
    assert meta["languages"] == ["grc"]


def test_add_language_none_vaartus():
    from server.greek_detect import add_language
    meta = {"languages": None}
    assert add_language(meta, "grc") is True
    assert meta["languages"] == ["grc"]


def test_add_language_vigane_tuup_asendatakse():
    from server.greek_detect import add_language
    # Vana andmestik võib kanda stringi massiivi asemel
    meta = {"languages": "lat"}
    assert add_language(meta, "grc") is True
    assert meta["languages"] == ["lat", "grc"]
```

- [ ] **Step 2: Jooksuta testid, veendu et kukuvad**

```bash
.venv/bin/pytest tests/test_greek_detect.py -k add_language -v
```

Oodatud: 6 failed, `ImportError: cannot import name 'add_language'`.

- [ ] **Step 3: Lisa funktsioon**

Lisa `server/greek_detect.py` lõppu:

```python
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
```

- [ ] **Step 4: Jooksuta kõik testid**

```bash
.venv/bin/pytest tests/test_greek_detect.py -v
```

Oodatud: 18 passed.

- [ ] **Step 5: Committi**

```bash
git add server/greek_detect.py tests/test_greek_detect.py
git commit -m "feat(kreeka): languages välja rangelt lisav uuendus

add_language on idempotentne ja ei eemalda kunagi olemasolevaid keeli.
Talub None, stringi ja puuduvat välja.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Skript

**Files:**
- Create: `scripts/detect_greek.py`
- Test: `tests/test_detect_greek_script.py`

**Interfaces:**
- Consumes: `server.greek_detect.work_qualifies`, `server.greek_detect.add_language`
- Produces:
  - `scan_work(work_dir: str) -> Optional[dict]` — skaneerib ühe teose kausta, tagastab `None` kui `_metadata.json` puudub või on katki, muidu `{"slug", "work_id", "title", "qualifies", "greek_pages", "greek_page_count", "page_count", "work_ratio", "already_tagged"}`
  - `apply_work(work_dir: str) -> bool` — kirjutab `grc` metaandmetesse, tagastab `True` kui fail muutus
  - `main() -> int` — käsurea sisenemispunkt, tagastab väljumiskoodi

- [ ] **Step 1: Kirjuta kukkuv test**

Loo `tests/test_detect_greek_script.py`:

```python
"""scripts/detect_greek.py teoste-skaneerimise testid."""
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))


def _make_work(tmp_path, slug, meta, pages):
    """Loob ajutise teose kausta: _metadata.json + lehed."""
    d = tmp_path / slug
    d.mkdir()
    (d / "_metadata.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    for name, text in pages.items():
        (d / name).write_text(text, encoding="utf-8")
    return str(d)


def test_scan_work_tuvastab_kreekakeelse_lehe(tmp_path):
    from detect_greek import scan_work
    d = _make_work(
        tmp_path, "1648-1-test",
        {"work_id": "abc123", "languages": ["lat"]},
        {"lk-001.txt": "Disputatio theologica de anima rationali",
         "lk-002.txt": "α" * 60 + " Latina"},
    )
    result = scan_work(d)
    assert result["qualifies"] is True
    assert result["greek_pages"] == ["lk-002.txt"]
    assert result["work_id"] == "abc123"
    assert result["already_tagged"] is False


def test_scan_work_juba_margitud(tmp_path):
    from detect_greek import scan_work
    d = _make_work(
        tmp_path, "1648-2-test",
        {"work_id": "def456", "languages": ["lat", "grc"]},
        {"lk-001.txt": "α" * 60},
    )
    result = scan_work(d)
    assert result["qualifies"] is True
    assert result["already_tagged"] is True


def test_scan_work_ilma_kreekata(tmp_path):
    from detect_greek import scan_work
    d = _make_work(
        tmp_path, "1648-3-test",
        {"work_id": "ghi789", "languages": ["lat"]},
        {"lk-001.txt": "Disputatio theologica"},
    )
    result = scan_work(d)
    assert result["qualifies"] is False
    assert result["greek_pages"] == []


def test_scan_work_puuduv_metadata_annab_none(tmp_path):
    from detect_greek import scan_work
    d = tmp_path / "1648-4-test"
    d.mkdir()
    (d / "lk-001.txt").write_text("α" * 60, encoding="utf-8")
    assert scan_work(str(d)) is None


def test_scan_work_vigane_metadata_annab_none(tmp_path):
    from detect_greek import scan_work
    d = tmp_path / "1648-5-test"
    d.mkdir()
    (d / "_metadata.json").write_text("{katki", encoding="utf-8")
    assert scan_work(str(d)) is None


def test_scan_work_ei_loe_alakriipsuga_faile(tmp_path):
    from detect_greek import scan_work
    d = _make_work(
        tmp_path, "1648-6-test",
        {"work_id": "jkl000", "languages": []},
        {"lk-001.txt": "Disputatio"},
    )
    # _notes.txt EI ole leheküljetekst ja seda ei tohi arvestada
    (tmp_path / "1648-6-test" / "_notes.txt").write_text("α" * 60, encoding="utf-8")
    result = scan_work(d)
    assert result["qualifies"] is False


def test_apply_work_kirjutab_ja_on_idempotentne(tmp_path):
    from detect_greek import apply_work
    d = _make_work(
        tmp_path, "1648-7-test",
        {"work_id": "mno111", "languages": ["lat"]},
        {"lk-001.txt": "α" * 60},
    )
    meta_path = os.path.join(d, "_metadata.json")

    assert apply_work(d) is True
    written = json.loads(open(meta_path, encoding="utf-8").read())
    assert written["languages"] == ["lat", "grc"]
    assert written["work_id"] == "mno111"  # ülejäänud väljad puutumata

    # Teistkordne jooks ei muuda midagi
    assert apply_work(d) is False
```

- [ ] **Step 2: Jooksuta test, veendu et kukub**

```bash
.venv/bin/pytest tests/test_detect_greek_script.py -v
```

Oodatud: KÕIK kukuvad, `ModuleNotFoundError: No module named 'detect_greek'`.

- [ ] **Step 3: Kirjuta skript**

Loo `scripts/detect_greek.py`:

```python
#!/usr/bin/env python3
"""Märgistab teosed, mis sisaldavad olulist kreekakeelset osa (`languages += grc`).

Reegel (ADR 0019): teos saab `grc`, kui vähemalt ÜHEL leheküljel on kreeka
tähtede osakaal >= 20 % ja kreeka tähemärke >= 20. Mõõdetud 2026-08-11:
1322 teosest läbib reegli 112, praegu on märgitud 7.

Miks lehepõhine, mitte teosepõhine: teosepõhine 20 % annaks 42 teost ja jätaks
välja 70 ladinakeelset köidet, mille sees ON kreekakeelne gratulatsioon. Just
need on Helleno-Nordica põhimaterjal.

Kasutus (serveris, Dockeris):
  docker exec vutt-backend python3 scripts/detect_greek.py            # kuivkäivitus
  docker exec vutt-backend python3 scripts/detect_greek.py --apply
  docker exec vutt-backend python3 scripts/detect_greek.py --apply --commit

Pärast --apply --commit tuleb Meilisearch reindekseerida:
  ./scripts/server_seed_data.sh

Skript on idempotentne — kordusjooks ei muuda midagi ega tekita commiti.
Olemasolevaid keelemärgendeid ei eemaldata kunagi.
"""
import argparse
import json
import os
import subprocess
import sys
from typing import Optional

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from server.greek_detect import add_language, greek_ratio, work_qualifies  # noqa: E402

LANGUAGE_CODE = "grc"


def _data_root() -> str:
    """Teoste juurkaust. server.config on ainuõige allikas."""
    from server.config import BASE_DIR
    return BASE_DIR


def _read_pages(work_dir: str) -> dict:
    """Loeb teose leheküljetekstid {failinimi: tekst}.

    Alakriipsuga algavad failid (nt _metadata.json, _notes.txt) EI ole
    leheküljetekstid ja jäetakse välja.
    """
    pages = {}
    for name in sorted(os.listdir(work_dir)):
        if not name.endswith(".txt") or name.startswith("_"):
            continue
        try:
            with open(os.path.join(work_dir, name), encoding="utf-8", errors="ignore") as f:
                pages[name] = f.read()
        except OSError as e:
            print(f"  HOIATUS: {name} lugemine ebaõnnestus: {e}", file=sys.stderr)
    return pages


def scan_work(work_dir: str) -> Optional[dict]:
    """Skaneerib ühe teose kausta. Tagastab None, kui metaandmeid ei ole/on katki."""
    meta_path = os.path.join(work_dir, "_metadata.json")
    if not os.path.exists(meta_path):
        return None
    try:
        with open(meta_path, encoding="utf-8") as f:
            meta = json.load(f)
    except (OSError, ValueError) as e:
        print(f"  HOIATUS: {work_dir} metaandmed katki: {e}", file=sys.stderr)
        return None

    pages = _read_pages(work_dir)
    qualifies, greek_pages = work_qualifies(pages)

    # Teose koguosakaal läheb AINULT aruandesse — otsust see ei mõjuta.
    # count/ratio annab tagasi selle lehe tähtede koguarvu.
    greek_sum = 0
    letter_sum = 0
    for text in pages.values():
        count, ratio = greek_ratio(text)
        greek_sum += count
        if ratio:
            letter_sum += count / ratio
    work_ratio = greek_sum / letter_sum if letter_sum else 0.0

    languages = meta.get("languages") or []
    if isinstance(languages, str):
        languages = [languages]

    return {
        "slug": os.path.basename(work_dir),
        "work_id": meta.get("work_id"),
        "title": meta.get("title"),
        "qualifies": qualifies,
        "greek_pages": greek_pages,
        "greek_page_count": len(greek_pages),
        "page_count": len(pages),
        "work_ratio": round(work_ratio, 4),
        "already_tagged": LANGUAGE_CODE in languages,
    }


def apply_work(work_dir: str) -> bool:
    """Kirjutab `grc` teose metaandmetesse. Tagastab True, kui fail muutus."""
    meta_path = os.path.join(work_dir, "_metadata.json")
    with open(meta_path, encoding="utf-8") as f:
        meta = json.load(f)

    if not add_language(meta, LANGUAGE_CODE):
        return False

    with open(meta_path, "w", encoding="utf-8") as f:
        f.write(json.dumps(meta, indent=2, ensure_ascii=False))
    return True


def _git_commit(data_root: str, count: int) -> bool:
    """Üks commit kogu partii kohta (ADR 0015 muster). Tagastab õnnestumise."""
    message = f"feat(keeled): grc märgend {count} teosele (automaattuvastus)"
    for cmd in (["git", "add", "-A"], ["git", "commit", "-m", message]):
        result = subprocess.run(cmd, cwd=data_root, capture_output=True, text=True)
        if result.returncode != 0:
            print(f"VIGA: {' '.join(cmd)} ebaõnnestus: {result.stderr}", file=sys.stderr)
            return False
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Kirjuta muudatused (vaikimisi kuivkäivitus)")
    parser.add_argument("--commit", action="store_true", help="Tee data/ git commit pärast --apply")
    parser.add_argument("--report", default=None, help="Aruande fail (vaikimisi state/greek_detection.json)")
    args = parser.parse_args()

    data_root = _data_root()
    if not os.path.isdir(data_root):
        print(f"VIGA: teoste kausta ei leitud: {data_root}", file=sys.stderr)
        return 1

    report = []
    written = 0
    failed = []

    for slug in sorted(os.listdir(data_root)):
        work_dir = os.path.join(data_root, slug)
        if not os.path.isdir(work_dir) or slug.startswith(".") or slug == "config":
            continue
        row = scan_work(work_dir)
        if row is None or not row["qualifies"]:
            continue
        report.append(row)

        if args.apply and not row["already_tagged"]:
            try:
                if apply_work(work_dir):
                    written += 1
            except (OSError, ValueError) as e:
                print(f"VIGA: {slug} kirjutamine ebaõnnestus: {e}", file=sys.stderr)
                failed.append(slug)

    # Aruanne kirjutatakse ALATI, ka osalise ebaõnnestumise korral.
    # Lehefailinimed on tasuta ja on hiljem gratulatsioon↔isik sidumise sisend.
    from server.config import STATE_DIR
    report_path = args.report or os.path.join(STATE_DIR, "greek_detection.json")
    try:
        os.makedirs(os.path.dirname(report_path), exist_ok=True)
        with open(report_path, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        print(f"Aruanne: {report_path}")
    except OSError as e:
        print(f"HOIATUS: aruande kirjutamine ebaõnnestus: {e}", file=sys.stderr)

    already = sum(1 for r in report if r["already_tagged"])
    print(f"\n{'[KUIVKÄIVITUS] ' if not args.apply else ''}Kokkuvõte:")
    print(f"  Reegli läbib:       {len(report)} teost")
    print(f"  Juba märgitud:      {already}")
    print(f"  Kirjutatud:         {written}")
    print(f"  Ebaõnnestus:        {len(failed)}")
    if failed:
        print("  Ebaõnnestunud teosed: " + ", ".join(failed))

    if not args.apply:
        print("\n  Kirjutamiseks: --apply")
        return 0

    if args.commit and written:
        if not _git_commit(data_root, written):
            return 1
        print("  Git commit loodud.")
        print("\n  JÄRGMINE SAMM: ./scripts/server_seed_data.sh (Meili reindeks)")

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Jooksuta testid, veendu et lähevad läbi**

```bash
.venv/bin/pytest tests/test_detect_greek_script.py -v
```

Oodatud: 7 passed.

- [ ] **Step 5: Jooksuta kogu Pythoni testikomplekt**

```bash
.venv/bin/pytest tests/ -q
```

Oodatud: kõik läbivad. Uusi kukkumisi ei tohi tekkida — `server/greek_detect.py` on uus moodul ega puutu olemasolevat koodi.

- [ ] **Step 6: Committi**

```bash
git add scripts/detect_greek.py tests/test_detect_greek_script.py
git commit -m "feat(kreeka): tuvastusskript kuivkäivituse ja partii-commitiga

Kuivkäivitus on vaikimisi (ADR 0014 õppetund). Kirjutab _metadata.json-i
otse ja teeb kogu partii kohta ÜHE git-commiti — save_work_metadata annaks
112 eraldi commiti, mille ADR 0015 tagasi lükkas.

Aruanne sisaldab kvalifitseeruvate lehtede failinimesid ka --apply režiimis:
see on hilisema gratulatsioon-isik sidumise sisend.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: ADR 0019

**Files:**
- Create: `docs/decisions/0019-keelemargend-grc-sisaldab-osa.md`

**Interfaces:**
- Consumes: mitte midagi
- Produces: mitte midagi (dokumentatsioon)

- [ ] **Step 1: Kontrolli, et number 0019 on endiselt vaba**

```bash
for b in $(git branch -a --format='%(refname:short)'); do git ls-tree -r --name-only "$b" docs/decisions/ 2>/dev/null | grep -E '0019'; done | sort -u
```

Oodatud: tühi väljund. Kui midagi ilmub, võta järgmine vaba number ja muuda failinime kõikjal.

- [ ] **Step 2: Kirjuta ADR**

Loo `docs/decisions/0019-keelemargend-grc-sisaldab-osa.md`:

```markdown
# ADR 0019 — Keelemärgend tähendab „sisaldab olulist osa selles keeles"

**Kuupäev:** 2026-08-11
**Staatus:** vastu võetud

## Kontekst

HUMGRAECA vol. 2 / Helleno-Nordica vajab kreekakeelse materjali korpusena
väljatoomist. `languages` väli oli praktiliselt täitmata: 1322 teosest kandis
`grc` märgendit 7, kuigi kreeka tähemärke sisaldab 775.

Automaattuvastuse jaoks mõõdeti (2026-08-11, tootmisandmed) kaks reeglit:

| Reegel | Teoseid |
|---|---|
| A: teose kogutekstis >= 20 % kreekat | 42 |
| B: vähemalt ühel leheküljel >= 20 % kreekat | 112 |

A on B täielik alamhulk. Vahe on 70 teost ja need on ladinakeelsed köited,
mille sees on kreekakeelne gratulatsioon, matuseluuletus või disputatsiooniosa —
projekti põhimaterjal, mitte servajuht.

## Otsus

`languages` sisaldab keelekoodi K, kui teoses on vähemalt üks lehekülg, mille
tähtedest on >= 20 % keeles K (ja neid tähemärke on >= 20).

Valitud reegel B.

## Tagajärg

**Keelemärgend ei ütle, mis keeles teos on.** Ladinakeelne disputatsioon, mille
lk 7 on kreekakeelne gratulatsioon, kannab NII `lat` kui `grc`. 112 teosest on
70 tervikuna ladinakeelsed.

See on tahtlik ja see EI ole andmeviga. Kui kunagi on vaja „teos on
kreekakeelne" tähendust, on see eraldi väli, mitte `languages` kitsendamine —
lehepõhine info on väärtuslikum ja kitsam tähendus on sellest tuletatav.

## Invariandid

- **Tuvastus on rangelt lisav.** Skript ei eemalda kunagi olemasolevat
  keelemärgendit. `add_language` on idempotentne, seega kordusjooks ei tekita
  git-commiti.
- **Lävendid elavad `server/greek_detect.py`-s** (`GREEK_RATIO_THRESHOLD`,
  `GREEK_MIN_CHARS`), mitte skriptis. Nende muutmine muudab korpuse koosseisu ja
  on sisuline otsus, mitte häälestus.
- **Ainult kreeka.** Tähemärgistiku järgi on usaldusväärselt eristatav ainult
  kreeka ja heebrea. Ladina-tähestikuliste keelte (lat, deu, swe, est) eristamine
  nõuab keeletuvastusmudelit — see EI kuulu siia skripti.
- **Enne massijooksu käib kuivkäivitus päris andmetel** (ADR 0014 õppetund).

## Tagasi lükatud alternatiivid

- **Reegel A (kogutekstis >= 20 %)** — kaotanuks 70 teost, sh kõik kreeka
  gratulatsioonid. Lävendi valik oleks olnud pea tähtsusetu (10 % → 46 teost,
  50 % → 39), mis näitab, et A mõõdab teist asja: valdavalt kreekakeelsete
  teoste loomulikku klastrit.
- **Lehepõhine salvestus** — kreekakeelsete lehekülgede märkimine andmemudelis
  oleks võimaldanud võrguanalüüsi servakaale. Lükati edasi: see nõuab lahendust
  probleemile „kuidas siduda konkreetne gratulatsioon konkreetse isikuga", mis on
  omaette suurusjärk. Skripti aruanne salvestab lehefailinimed, seega andmed on
  olemas, kui selleni jõutakse.
```

- [ ] **Step 3: Kontrolli, et ADR-register viitab uuele failile**

```bash
grep -n "0018" docs/decisions/README.md
```

Kui `README.md` loetleb ADR-e, lisa 0019 rida samas vormis nagu 0018. Kui `grep` ei anna vastet, ei ole registrit vaja uuendada.

- [ ] **Step 4: Committi**

```bash
git add docs/decisions/
git commit -m "docs(adr): 0019 keelemärgend tähendab sisaldab osa selles keeles

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Otsingu filtriklausel (searchService)

Frontendi osa algab kõige sügavamast kihist, et järgmised taskid saaksid sellele toetuda.

**Files:**
- Modify: `src/services/searchService.ts`
- Test: `src/services/__tests__/searchLanguages.test.ts`

**Interfaces:**
- Consumes: `buildMultiFilter(values: string[], buildSingle: (v: string) => string): string` failist `src/utils/filterUtils.ts`
- Produces: `searchContent` options-objekt saab uue valikulise välja `languages?: string[]`

**HOIATUS:** options-objektis on JUBA väli `lang` (UI keelekood siltide lahendamiseks). Uue välja nimi on `languages` — ära nimeta seda `lang`-iks.

- [ ] **Step 1: Kirjuta kukkuvad testid**

Loo `src/services/__tests__/searchLanguages.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSearch } = vi.hoisted(() => ({ mockSearch: vi.fn() }));

vi.mock('../meiliService', () => ({
  checkMixedContent: vi.fn(),
  normalizeWork: vi.fn((hit) => hit),
  normalizeContentSearchHit: vi.fn((hit) => hit),
}));

vi.mock('../../config', () => ({
  MEILI_HOST: 'http://localhost:7700',
  MEILI_INDEX: 'teosed',
  IMAGE_BASE_URL: '/api/images',
  FILE_API_URL: '/api/files',
}));

import { searchContent } from '../searchService';

const mockIndex = { search: mockSearch } as any;

beforeEach(() => {
  mockSearch.mockReset();
  mockSearch.mockResolvedValue({ hits: [], facetDistribution: {}, totalHits: 0, estimatedTotalHits: 0 });
});

const appliedFilters = (): string[] => mockSearch.mock.calls[0][1].filter ?? [];

describe('keelefilter', () => {
  it('ei lisa klauslit, kui keeli ei ole valitud', async () => {
    await searchContent(mockIndex, 'anima');
    expect(appliedFilters().some(f => f.includes('languages'))).toBe(false);
  });

  it('ei lisa klauslit tühja massiivi korral', async () => {
    await searchContent(mockIndex, 'anima', 1, { languages: [] });
    expect(appliedFilters().some(f => f.includes('languages'))).toBe(false);
  });

  it('üks keel annab lihtsa võrdluse', async () => {
    await searchContent(mockIndex, 'anima', 1, { languages: ['grc'] });
    expect(appliedFilters()).toContain('languages = "grc"');
  });

  it('mitu keelt annab OR-klausli', async () => {
    await searchContent(mockIndex, 'anima', 1, { languages: ['grc', 'heb'] });
    expect(appliedFilters()).toContain('(languages = "grc" OR languages = "heb")');
  });

  it('keelefilter ei sega UI keele lang-välja', async () => {
    await searchContent(mockIndex, 'anima', 1, { languages: ['grc'], lang: 'en' });
    expect(appliedFilters()).toContain('languages = "grc"');
    expect(appliedFilters().some(f => f.includes('"en"'))).toBe(false);
  });
});
```

- [ ] **Step 2: Jooksuta testid, veendu et kukuvad**

```bash
npm test -- searchLanguages
```

Oodatud: 3 kukkuvad testi (`languages = "grc"` puudub filtrites). Kaks „ei lisa klauslit" testi lähevad juba läbi — see on ootuspärane, need on regressioonikaitse.

- [ ] **Step 3: Lisa väli ja filtriklausel**

`src/services/searchService.ts`:

1. Options-tüübis, `type?: string[];` rea järel (~rida 57), lisa:

```typescript
  languages?: string[]; // Keele filter (OR loogika, ISO 639-3 koodid)
```

2. `searchContent` funktsioonis, kohe `buildMultiFilter(options.type, buildTypeFilter)` ploki järel (~rida 601), lisa:

```typescript
  // Keele filter — languages on massiiv, seega üks väärtus ühtib massiivi liikmega
  if (options.languages && options.languages.length > 0) {
    filter.push(buildMultiFilter(options.languages, (l) => `languages = "${l}"`));
  }
```

- [ ] **Step 4: Jooksuta testid, veendu et lähevad läbi**

```bash
npm test -- searchLanguages
```

Oodatud: 5 passed.

- [ ] **Step 5: Jooksuta väravad ja committi**

```bash
npm run typecheck && npm test && npm run lint:ci
git add src/services/searchService.ts src/services/__tests__/searchLanguages.test.ts
git commit -m "feat(otsing): keelefiltri klausel searchService-s

Väli on languages (mitte lang) — options-objektis on juba lang, mis kannab
UI keelekoodi siltide lahendamiseks.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: URL-parameeter ja filtri olek

**Files:**
- Modify: `src/pages/search/hooks/useSearchUrlParams.ts`
- Modify: `src/pages/search/hooks/useFilterDraft.ts`
- Test: `src/pages/search/hooks/__tests__/searchUrlParams.test.ts`

**Interfaces:**
- Consumes: mitte midagi eelmistest taskidest
- Produces:
  - `parseListParam(value: string | null): string[]` — eksporditud `useSearchUrlParams.ts`-ist
  - `SearchUrlParams.languages: string[]` (URL-param `langs`)
  - `FilterDraft.selectedLanguages: string[]`
  - `FilterDraftActions.setSelectedLanguages: (v: string[] | ((prev: string[]) => string[])) => void`

**Testimise piirang — loe enne kirjutamist.** Projektis EI OLE `@testing-library/react`-i ega jsdom-i: `vitest.config.ts` seab `environment: 'node'` ja `include: ['src/**/*.test.ts']`. Hooke ei saa renderdada. Koodibaasi muster (vt `src/pages/search/hooks/__tests__/useQCodeMaps.test.ts`) on **eksportida hookist puhas abifunktsioon ja testida seda**. Ära lisa uusi testisõltuvusi — see ei kuulu ülesande skoopi.

Seetõttu katab ühiktest parsimise, ja `commit`/`clearFilters` juhtmestiku kontrollib Task 7 Step 7 käsitsi brauseris. See on teadlik kompromiss, mitte tähelepanematus.

- [ ] **Step 1: Kirjuta kukkuvad testid**

Loo `src/pages/search/hooks/__tests__/searchUrlParams.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { parseListParam } from '../useSearchUrlParams';

describe('parseListParam', () => {
  it('poolitab komadega eraldatud väärtused', () => {
    expect(parseListParam('grc,lat')).toEqual(['grc', 'lat']);
  });

  it('annab ühe elemendiga massiivi ühe väärtuse korral', () => {
    expect(parseListParam('grc')).toEqual(['grc']);
  });

  it('annab tühja massiivi, kui parameetrit ei ole', () => {
    expect(parseListParam(null)).toEqual([]);
  });

  it('annab tühja massiivi tühja stringi korral', () => {
    expect(parseListParam('')).toEqual([]);
  });

  it('viskab tühjad vahed välja', () => {
    // ",grc,,lat," tekib, kui kasutaja on URL-i käsitsi näppinud
    expect(parseListParam(',grc,,lat,')).toEqual(['grc', 'lat']);
  });
});
```

- [ ] **Step 2: Jooksuta testid, veendu et kukuvad**

```bash
npm test -- searchUrlParams
```

Oodatud: kõik kukuvad, `parseListParam` ei ole eksporditud.

- [ ] **Step 3: Lisa URL-parameeter**

`src/pages/search/hooks/useSearchUrlParams.ts`:

1. Faili algusesse, `useSearchParams` impordi järele:

```typescript
/** Komadega eraldatud URL-parameeter → massiiv. Tühjad osad kukuvad välja. */
export function parseListParam(value: string | null): string[] {
    return value?.split(',').filter(Boolean) || [];
}
```

2. `SearchUrlParams` liidesesse, `types: string[];` rea järel:

```typescript
    languages: string[];
```

3. Tagastatavasse objekti, `types: …` rea järel:

```typescript
        languages: parseListParam(searchParams.get('langs')),
```

4. Kasuta `parseListParam`-i ka olemasolevatel loend-parameetritel, et fail jääks ühtseks. Loogika on identne, käitumine ei muutu:

```typescript
        teoseTags: parseListParam(searchParams.get('teoseTags')),
        pageTags: parseListParam(searchParams.get('pageTags')),
        genres: parseListParam(searchParams.get('genre')),
        types: parseListParam(searchParams.get('type')),
```

- [ ] **Step 4: Lisa olek `useFilterDraft`-i**

`src/pages/search/hooks/useFilterDraft.ts` — viis muudatust:

1. `FilterDraft` liidesesse, `selectedTypes: string[];` järel:

```typescript
    selectedLanguages: string[];
```

2. `FilterDraftActions` liidesesse, `setSelectedTypes` järel:

```typescript
    setSelectedLanguages: (v: string[] | ((prev: string[]) => string[])) => void;
```

3. Olek, `const [selectedTypes, setSelectedTypes] = …` rea järel:

```typescript
    const [selectedLanguages, setSelectedLanguages] = useState<string[]>(urlParams.languages);
```

4. `commit` funktsioonis kolm kohta:

`hasFilters` avaldisse lisa `selectedLanguages.length > 0 ||`:

```typescript
        const hasFilters = yearStart || yearEnd || selectedScope !== 'all' || selectedWork ||
            selectedTeoseTags.length > 0 || selectedPageTags.length > 0 ||
            selectedGenres.length > 0 || selectedTypes.length > 0 ||
            selectedLanguages.length > 0 || selectedAuthor;
```

Kustutamise nimekirja lisa `'langs'`:

```typescript
                ['q', 'p', 'ys', 'ye', 'scope', 'work', 'teoseTags', 'pageTags', 'genre', 'type', 'langs', 'author'].forEach(k => prev.delete(k));
```

`selectedTypes` seadmise rea järele:

```typescript
                if (selectedLanguages.length > 0) prev.set('langs', selectedLanguages.join(',')); else prev.delete('langs');
```

5. `clearFilters` funktsioonis kaks kohta:

```typescript
        setSelectedGenres([]); setSelectedTypes([]); setSelectedLanguages([]);
```

```typescript
            ['ys', 'ye', 'scope', 'work', 'teoseTags', 'pageTags', 'genre', 'type', 'langs', 'author', 'subjectPerson'].forEach(k => prev.delete(k));
```

6. Tagastatavasse `draft` objekti lisa `selectedLanguages`, ja `actions` objekti `setSelectedLanguages`.

7. URL-sünkroniseerimise `useEffect` deps-massiivi (see, mis sisaldab `urlParams.genres.join(',')`) lisa:

```typescript
        urlParams.languages.join(','),
```

- [ ] **Step 5: Jooksuta testid, veendu et lähevad läbi**

```bash
npm test -- searchUrlParams
```

Oodatud: 5 passed. Jooksuta ka kogu komplekt (`npm test`) — Step 3 punkt 4 puudutas olemasolevaid parameetreid ja ükski test ei tohi kukkuda.

- [ ] **Step 6: Jooksuta väravad ja committi**

```bash
npm run typecheck && npm test && npm run lint:ci
git add src/pages/search/hooks/
git commit -m "feat(otsing): keelefiltri olek ja langs URL-parameeter

URL-parameeter on langs, mitte lang — lang on juba UI keele oma.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Keelefiltri UI

**Files:**
- Modify: `src/locales/et/search.json`
- Modify: `src/locales/en/search.json`
- Modify: `src/pages/search/SearchFilters.tsx`
- Modify: `src/pages/SearchPage.tsx`
- Modify: `src/pages/search/hooks/useSearchResults.ts`

**Interfaces:**
- Consumes:
  - `FilterDraft.selectedLanguages` ja `setSelectedLanguages` (Task 6)
  - `searchContent` options `languages?: string[]` (Task 5)
  - `Vocabularies.languages: { [id: string]: VocabularyItem }` failist `src/services/collectionService.ts` — juba olemas
- Produces: `SearchFiltersProps.onLanguageToggle: (value: string) => void`

**Miks facet-loendureid ei ole:** sõnavara on kinnine kaheksa keelega, seega loend renderdatakse tervikuna. Meili facetid loendavad lehekülgi, mitte teoseid — „grc 3915" oleks eksitav. `useSearchFacets.ts` jääb PUUTUMATA.

- [ ] **Step 1: Lisa tõlkevõtmed MÕLEMASSE keelde**

`src/locales/et/search.json`, `filters` objektis pärast `"type": "Tüüp",`:

```json
    "languages": "Keel",
```

`src/locales/en/search.json`, `filters` objektis samas kohas:

```json
    "languages": "Language",
```

- [ ] **Step 2: Kontrolli, et keelepakid on paarikaupa**

```bash
npm test -- localeParity translationKeysResolve
```

Oodatud: PASS. Kui kukub, on võti ainult ühes failis — paranda enne edasiminekut.

- [ ] **Step 3: Lisa filtri sektsioon**

`src/pages/search/SearchFilters.tsx` — neli muudatust:

1. Ikooni import (`lucide-react` reale lisa `Languages`):

```typescript
import { Layers, Calendar, BookOpen, Tag, FileType, User, FileText, Languages } from 'lucide-react';
```

2. `SearchFiltersProps` liidesesse, `onTypeToggle` järel:

```typescript
    onLanguageToggle: (value: string) => void;
```

3. Komponendi destruktureerimisse, `onTypeToggle,` järel `onLanguageToggle,`. Ja `draft` destruktureerimisse lisa `selectedLanguages`.

4. Tüübi filtri `CollapsibleSection` sulgeva `)}`-i JÄRELE lisa:

```tsx
                {/* Keele filter — sõnavarast, ilma facet-loenduriteta.
                    Meili facetid loendavad lehekülgi, mitte teoseid, seega
                    loendur oleks eksitav. Sõnavara on kinnine (8 keelt). */}
                {vocabularies?.languages && Object.keys(vocabularies.languages).length > 0 && (
                    <CollapsibleSection
                        title={t('filters.languages')}
                        icon={<Languages size={14} />}
                        defaultOpen={selectedLanguages.length > 0}
                        badge={selectedLanguages.length || undefined}
                    >
                        <div className="space-y-1">
                            {Object.entries(vocabularies.languages).map(([code, data]) => (
                                <label
                                    key={code}
                                    className="flex items-center gap-2 px-1 py-0.5 text-sm text-gray-700 hover:bg-gray-50 rounded cursor-pointer"
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedLanguages.includes(code)}
                                        onChange={() => onLanguageToggle(code)}
                                        className="rounded text-primary-600 focus:ring-primary-500"
                                    />
                                    <span>{data[lang] || data.et || code}</span>
                                </label>
                            ))}
                        </div>
                    </CollapsibleSection>
                )}
```

- [ ] **Step 4: Ühenda `SearchPage`-is**

`src/pages/SearchPage.tsx` — kaks muudatust:

1. `<SearchFilters …>` propside hulka, `onTypeToggle={…}` järel:

```tsx
                    onLanguageToggle={(v) => {
                        actions.setSelectedLanguages(prev =>
                            prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]
                        );
                    }}
```

2. Aktiivsete filtrite kiibid — tingimusse (see, mis sisaldab `urlParams.types.length > 0`) lisa:

```tsx
                            urlParams.languages.length > 0 ||
```

ja „Tüübid" kiibiploki `))}`-i järele lisa:

```tsx
                                {/* Keeled */}
                                {urlParams.languages.map(code => (
                                    <div key={code} className="flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full text-xs font-medium border border-amber-200">
                                        <Languages size={11} />
                                        <span>{facets.vocabularies?.languages?.[code]?.[getLangCode(i18n.language)] || code}</span>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const next = urlParams.languages.filter(x => x !== code);
                                                actions.setSelectedLanguages(next);
                                                setSearchParams(prev => { if (next.length > 0) prev.set('langs', next.join(',')); else prev.delete('langs'); prev.set('p', '1'); return prev; });
                                            }}
                                            className="ml-0.5 hover:bg-amber-100 rounded-full p-0.5"
                                            title={t('filters.removeFilter')}
                                        >
                                            <X size={11} />
                                        </button>
                                    </div>
                                ))}
```

Lisa `Languages` `lucide-react` importi ja veendu, et `getLangCode` on imporditud (`src/utils/getLangCode`). Kui `i18n` ei ole komponendis olemas, võta see `useTranslation()`-ist: `const { t, i18n } = useTranslation(...)`.

- [ ] **Step 5: Anna keelefilter otsingupäringusse**

`src/pages/search/hooks/useSearchResults.ts`, `searchContent` valikute objektis `type:` rea järel:

```typescript
                    languages: urlParams.languages.length > 0 ? urlParams.languages : undefined,
```

- [ ] **Step 6: Jooksuta kõik väravad**

```bash
npm run typecheck && npm test && npm run lint:ci
```

Oodatud: kõik PASS. `lint:ci` hoiatuste arv EI TOHI tõusta — kui tõusis, paranda uus hoiatus.

- [ ] **Step 7: Kontrolli käsitsi brauseris**

```bash
npm run dev
```

Ava `http://localhost:5173/search`. Kontrolli:
1. Filtripaneelis on „Keel" sektsioon kaheksa keelega.
2. „Vanakreeka" valimine lisab URL-i `langs=grc` ja kitsendab tulemusi.
3. Otsinguriba all ilmub kollane kiip „Vanakreeka" X-nupuga; X eemaldab filtri ja URL-i parameetri.
4. „Tühjenda filtrid" eemaldab keelevaliku.
5. Keele vahetamine UI-s (et → en) muudab sildi „Ancient Greek"-iks, aga EI muuda valikut.

- [ ] **Step 8: Committi**

```bash
git add src/locales/ src/pages/
git commit -m "feat(otsing): keelefilter otsingulehele

Loend tuleb sõnavarast ilma facet-loenduriteta — Meili facetid loendavad
lehekülgi, mitte teoseid, seega loendur oleks eksitav.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Kuivkäivitus tootmisandmetel ja rakendamine

See ei ole koodi-task, vaid kontrollitud tootmismuudatus. **Ära tee ühtki sammu enne, kui Task 1–7 on valmis ja merge'itud.**

**Files:** ei muudeta ühtki repo faili

**Interfaces:**
- Consumes: `scripts/detect_greek.py` (Task 3)
- Produces: `state/greek_detection.json` serveris, `data/` git-commit

- [ ] **Step 1: Vii kood serverisse**

```bash
ssh vutt 'cd ~/VUTT && git pull && ./scripts/server_update.sh --no-cache'
```

`--no-cache` on Python-muudatuse korral kohustuslik.

- [ ] **Step 2: Kuivkäivitus**

```bash
ssh vutt 'cd ~/VUTT && docker exec vutt-backend python3 scripts/detect_greek.py'
```

Oodatud kokkuvõte:

```
  Reegli läbib:       112 teost
  Juba märgitud:      4
  Kirjutatud:         0
```

**Kui „Reegli läbib" ei ole 112 (±paar teost, kui andmeid on vahepeal lisandunud), PEATU** ja uuri, mis lahkneb. Number mõõdeti 2026-08-11 ja suur kõrvalekalle tähendab, et tuvastus käitub teisiti kui plaanitud.

- [ ] **Step 3: Vaata aruanne üle**

```bash
ssh vutt 'cd ~/VUTT && docker exec vutt-backend python3 -c "
import json
rows = json.load(open(\"/app/state/greek_detection.json\"))
rows.sort(key=lambda r: r[\"work_ratio\"])
print(f\"kokku {len(rows)}\")
print(\"--- madalaima osakaaluga 15 (kõige kahtlasemad):\")
for r in rows[:15]:
    print(f\"  {r[\"work_ratio\"]:6.1%}  {r[\"greek_page_count\"]:3d}/{r[\"page_count\"]:3d} lk  {r[\"slug\"][:55]}\")
"'
```

Loe madalaima osakaaluga teosed läbi. Need peavad olema ladinakeelsed köited kreekakeelse osaga (gratulatsioon, luuletus, disputatsiooniosa) — see on reegli mõte. Kui mõni on ilmselgelt ainult tsitaatidega ladina töö, **peatu ja teata sellest**: see tähendab, et lävend vajab arutelu.

- [ ] **Step 4: Rakenda**

```bash
ssh vutt 'cd ~/VUTT && docker exec vutt-backend python3 scripts/detect_greek.py --apply --commit'
```

Oodatud: `Kirjutatud: 108`, `Ebaõnnestus: 0`, `Git commit loodud.`

- [ ] **Step 5: Kontrolli idempotentsust**

```bash
ssh vutt 'cd ~/VUTT && docker exec vutt-backend python3 scripts/detect_greek.py --apply --commit'
```

Oodatud: `Kirjutatud: 0` ja MITTE ühtki uut git-commiti. Kontrolli:

```bash
ssh vutt 'cd ~/VUTT/data && git log --oneline -3'
```

- [ ] **Step 6: Reindekseeri Meilisearch**

```bash
ssh vutt 'cd ~/VUTT && ./scripts/server_seed_data.sh'
```

Skript küsib kinnitust (`y`). See kustutab ja taasloob `teosed` indeksi.

- [ ] **Step 7: Kontrolli tulemust**

```bash
ssh vutt 'cd ~/VUTT && K=$(grep -oP "MEILI_MASTER_KEY=\K.*" .env | head -1) && curl -s -X POST "http://localhost:7700/indexes/teosed/search" -H "Authorization: Bearer $K" -H "Content-Type: application/json" -d "{\"q\":\"\",\"hitsPerPage\":1,\"page\":1,\"distinct\":\"work_id\",\"filter\":\"languages = grc\"}" | python3 -c "import sys,json;print(\"grc teoseid:\", json.load(sys.stdin)[\"totalHits\"])"'
```

Oodatud: `grc teoseid: 112`.

- [ ] **Step 8: Deploy frontend**

```bash
npm run build && rsync -avz --delete dist/ vutt:~/VUTT/dist/
```

`--delete` on tahtlik. `.br`/`.gz` failid PEAVAD kaasa minema.

- [ ] **Step 9: Kontrolli tootmises**

Ava `https://vutt.utlib.ut.ee/search?langs=grc`. Oodatud: keelefilter näitab „Vanakreeka" valituna ja tulemused on kitsendatud.

---

## Enesekontroll

Plaan on speki vastu üle käidud:

| Speki nõue | Task |
|---|---|
| Reegel B, lävendid 20 % / 20 tähemärki | 1 |
| Kreeka + Greek Extended plokk | 1 |
| Rangelt lisav, idempotentne | 2 |
| Skript Dockeris, kuivkäivitus vaikimisi | 3 |
| Otsene kirjutus + üks partii-commit | 3 |
| Aruanne lehefailinimedega, ka `--apply` korral | 3 |
| Veakäsitlus: loetamatu fail, puuduv/katki metaandmed, kirjutusviga, git-viga | 1, 3 |
| ADR 0019 | 4 |
| Meili filtriklausel | 5 |
| URL-parameeter + olek | 6 |
| Filtri UI + tõlked mõlemas keeles | 7 |
| `useSearchFacets` puutumata (ei mingeid facet-loendureid) | 7 (selgesõnaline) |
| Python testid | 1, 2, 3 |
| Frontend testid (filtriklausel, URL-parsimine) | 5, 6 |
| `commit`/`clearFilters` juhtmestik | Task 7 Step 7 käsitsi — jsdom-i projektis ei ole |
| Meili reindeks + deploy | 8 |
