# Prosopograafia: elulugu keelega väljanimes — teostusplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Isikukaardi elulugu on olemas eesti ja inglise keeles eraldi väljadena, Album Academicumi toorik on omaette väli, toimetaja saab masintõlke mustandi nupuvajutusega ja näeb hoiatust, kui lähtetekst on pärast kinnitamist muutunud.

**Architecture:** Sisuvälja keel läheb **väljanimesse** (`biography_et`, `biography_en`, `aa_raw`); vana `biography` kaob skeemist migratsiooniga, mis jookseb kahes passis (expand–migrate–contract), nii et lugemine ei katke kordagi. Vananemisankur (`biography_et_src` / `biography_en_src`) on **selgesõnalise kinnituse kirje**, mitte salvestamise kõrvalmõju: server arvutab teise keele teksti räsi ainult siis, kui klient saatis kinnitusmärke. Tõlge on olekuta endpoint, mis kaarti ei ava — salvestamine käib tavalist `update_person` teed.

**Tech Stack:** FastAPI (Python 3.9 ühilduvus!), GitPython, requests + Gemini API, React 19 + TypeScript, vitest, pytest.

**Spec:** `docs/superpowers/specs/2026-09-10-prosopograafia-ingliskeelne-elulugu-design.md`

## Global Constraints

- **Koodikommentaarid eesti keeles** (CLAUDE.md).
- **Python 3.9:** `Optional[dict]`, mitte `dict | None`. Ka `Tuple[str, Dict[str, int]]`, mitte `tuple[...]`.
- **i18n:** `fallbackLng` on VÄLJAS — iga uus võti tuleb lisada **korraga** `src/locales/et/prosopography.json` ja `src/locales/en/prosopography.json` alla, muidu katkeb build (valvurid: `localeParity.test.ts`, `translationKeysResolve.test.ts`).
- **Blokeeriv I/O `async def` sees on keelatud** (ADR 0002). Kaks lubatud kuju: sünkroonne `def` route (FastAPI viib ise threadpooli) VÕI `async def` + `await run_in_threadpool(...)`.
- **`GET /prosopography/{id}` on autentimata avalik** ja nginx `/api/files/` proksib kõik backend-teed — uus väli, mis sinna satub, on avalik. Ankrud EI ole salajased, aga kliendi saadetud ankur visatakse alati ära.
- **Marsruudi järjekord `router.py`-s:** `GET /{person_id:path}` (rida 791) ja `PUT /{person_id:path}` (rida 816) on failis viimased — iga uus konkreetne tee registreeritakse **enne neid**.
- **Prosopograafia kirjutusteed käivad `save_with_git` kaudu** ja lõpetavad `_indices()._update_index_entry(person)`-iga. Uus kirjutustee neid ei möödu.
- **Testide käivitamine:** venv elab PÕHIKAUSTAS, mitte tööpuus — käivita
  `/home/mf/LLM/VUTT/.venv/bin/pytest tests/ -q` tööpuu juurest. Süsteemi `python3`-l
  puuduvad sõltuvused. Plaanis on lühiduse mõttes `.venv/bin/pytest` — asenda see teega ülal.
- **MCP-testid TÖÖPUUS vajavad `PYTHONPATH`-i.** Venv-is on `vutt_mcp` editable-paigaldus,
  mis osutab PÕHIKAUSTALE (`/home/mf/LLM/VUTT/mcp`), ja `mcp/tests/` ei ole pakett — seega
  impordib `pytest mcp/tests/` tööpuus vaikimisi PÕHIKAUSTA koodi ja sinu muudatust ei
  testita (roheline pakett valetab). Käivita `cd mcp && PYTHONPATH=$PWD
  /home/mf/LLM/VUTT/.venv/bin/pytest tests/ -q`.
- **Frontendi testid on PUHTA LOOGIKA testid.** `@testing-library/react` ei ole
  projektis olemas ja `vitest.config.ts` on `environment: 'node'` — ühtki
  komponenditesti ei eksisteeri. Ära lisa komponenditestimise stäki. Testitav otsus
  tõstetakse `src/prosopography/utils/`-i puhtasse funktsiooni ja testitakse seal;
  komponent jääb õhukeseks juhtmestikuks. (Eelkontrolli otsus R1.)
- **Väravad enne igat commiti:** `/home/mf/LLM/VUTT/.venv/bin/pytest tests/ -q`, `npm run typecheck`, `npx vitest run`, `npm run lint:ci` (lävi `--max-warnings 49`).
- **Ülesanded 1–4 (migratsiooniskript) EI muuda backendi** ja on tootmises käivitatavad enne backend-deploy'd — see on expand–migrate–contract eeldus, mitte mugavus.
- **Avaldamise värav:** ülesanded 5–21 lähevad tootmisse ÜHE partiina (ülesanne 22, sammud 4–5);
  migratsiooni pass B (ülesanne 22, samm 7) jookseb alles pärast tootmiskontrolli sammus 6.
  Kuni passini B on kõik pöörduv — `biography` on veel alles.

## Failikaart

| Fail | Vastutus |
|---|---|
| `server/prosopo_biography_fields.py` | **uus.** Väljanimed, AA-klassifikaator, räsi. Ainult stdlib — nii saab migratsiooniskript seda importida ilma FastAPI-ta. |
| `scripts/migrate_biography_language_fields.py` | **uus.** Kaks passi + kuivkäivitus + kinnitatud vastendus. |
| `server/prosopography/person_crud.py` | Skeem, neli katget, pärandvälja reegel, ankru kirjutamine. |
| `server/prosopography/person_search.py` | Indeksikirje neli katget. |
| `server/prosopography/ops.py`, `_compat.py` | `_make_snippet` re-ekspordid (T5) — vahelejätmine = `ImportError`. |
| `server/prosopography/merge_ops.py` | Kolm tekstivälja + ankru nullimine. |
| `server/prosopography/git_history.py` | Ankrud ignoreeritud väljade hulka. |
| `server/prosopography/enrichment.py` | AA raw_text → `aa_raw`. |
| `scripts/match_aa_duplicates.py`, `match_comma_duplicates.py` | Sama võtme tarbijad (T9) — muidu vaikne no-op. |
| `server/prosopography/router.py` | `POST /translate`, `GET /{id}/source-diff`. |
| `server/text_translate.py` | **uus.** Olekuta tõlkeklient. |
| `server/metadata_handler.py` | SEO-prerenderi väljakaardistus. |
| `mcp/vutt_mcp/persons.py` | Mõlemad keeleväljad + AA eraldi. |
| `src/prosopography/utils/biographyChain.ts` | **uus.** Kuvamise ja katke varuvariandi ahel + märke valik — ÜKS allikas kahele tarbijale. |
| `src/prosopography/utils/biographyBlocks.ts` | **uus.** Isikulehe kahe ploki otsus puhta funktsioonina. |
| `src/prosopography/utils/translationFlow.ts` | **uus.** Tõlkevoo kolm kaitset puhaste funktsioonidena. |
| `src/prosopography/utils/textHash.ts` | **uus.** Serveri `text_hash`-i kliendipoolne kaksik. |
| `src/prosopography/pages/PersonDetailPage.tsx` | Eluloo ahel + AA-plokk. |
| `src/prosopography/components/PersonCard.tsx` | Katke ahel + keelemärge. |
| `src/prosopography/pages/PersonEditPage.tsx` | Keeletabid, tõlkenupp, kinnitusruut, hoiatus. |

---

### Task 1: Jagatud väljamoodul (`server/prosopo_biography_fields.py`)

Väljanimed, AA-klassifikaator ja räsi elavad ÜHES kohas: neid vajavad nii backend, migratsiooniskript kui testid. Moodul kasutab **ainult stdlib-i** — migratsiooniskript jookseb hosti venv-is, kus FastAPI-t ei ole.

**Files:**
- Create: `server/prosopo_biography_fields.py`
- Test: `tests/test_prosopo_biography_fields.py`

**Interfaces:**
- Consumes: —
- Produces:
  - konstandid `BIOGRAPHY_ET = "biography_et"`, `BIOGRAPHY_EN = "biography_en"`, `AA_RAW = "aa_raw"`, `SRC_ET = "biography_et_src"`, `SRC_EN = "biography_en_src"`, `LEGACY_BIOGRAPHY = "biography"`
  - `TEXT_FIELDS: tuple` = `(BIOGRAPHY_ET, BIOGRAPHY_EN, AA_RAW)`
  - `ANCHOR_FIELDS: tuple` = `(SRC_ET, SRC_EN)`
  - `ANCHOR_OF: dict` = `{BIOGRAPHY_ET: SRC_ET, BIOGRAPHY_EN: SRC_EN}` (keeleväli → tema ankur)
  - `ANCHOR_SOURCE: dict` = `{SRC_ET: BIOGRAPHY_EN, SRC_EN: BIOGRAPHY_ET}` (ankur → väli, mille räsi ta kannab)
  - `text_hash(text: Optional[str]) -> str`
  - `is_aa_record(text: Optional[str]) -> bool`
  - `classify(text: Optional[str]) -> Optional[str]` → `AA_RAW`, `BIOGRAPHY_ET` või `None`
  - `suspicion_flags(text: str, target: str, aa_median: int) -> List[str]`

- [ ] **Step 1: Kirjuta kukkuv test**

```python
"""AA-toorik on KIRJE, mitte tekst — klassifikaator peab need lahku ajama.

Kriitiline servajuht (spekk, „Klassifikatsioon"): inimese kirjutatud elulugu, mis
TSITEERIB AA-kirjet, ei tohi tervikuna `aa_raw`-ks muutuda — tekst kaoks eluloo
kohalt ja muutuks vormis mittemuudetavaks.
"""
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.prosopo_biography_fields import (  # noqa: E402
    AA_RAW, BIOGRAPHY_ET, ANCHOR_OF, ANCHOR_SOURCE, SRC_ET, SRC_EN,
    BIOGRAPHY_EN, classify, is_aa_record, suspicion_flags, text_hash,
)

AA_NAIDE = (
    "Immatrikuleerimise kuupäev: 20. September 1634\n"
    "154. Lünaeus (Lynaeus, Lineus), Emundus, Smål., * 1604, † 1693. V.: Joh. L.\n"
    "Imm. Uppsala 1. 8. 1639. AG: Dep. 18. 9. 1634; Konv. 1. 11. 1634—36;"
)
AA_NUMBRIGA = (
    "154. Lünaeus (Lynaeus, Lineus), Emundus, Smål., * 1604, † 1693. V.: Joh. L.\n"
    "AG: Dep. 18. 9. 1634."
)
PROOSA_MIS_TSITEERIB_AA = (
    "Emundus Lünaeus oli Smålandist pärit üliõpilane, kes jõudis Tartusse "
    "kolmekümneaastase sõja keskel ja jäi siia mitmeks aastaks õppima.\n\n"
    "Album Academicum kannab tema kohta kirjet:\n\n"
    "> 154. Lünaeus (Lynaeus, Lineus), Emundus, Smål., * 1604, † 1693. "
    "AG: Dep. 18. 9. 1634."
)


@pytest.mark.parametrize("tekst", [AA_NAIDE, AA_NUMBRIGA])
def test_aa_kirje_tuvastatakse(tekst):
    assert is_aa_record(tekst) is True
    assert classify(tekst) == AA_RAW


def test_aa_marker_keset_proosat_ei_ole_aa_kirje():
    assert is_aa_record(PROOSA_MIS_TSITEERIB_AA) is False
    assert classify(PROOSA_MIS_TSITEERIB_AA) == BIOGRAPHY_ET


def test_aastaarvuga_algav_proosa_ei_ole_aa_kirje():
    # „1759. aastal…" on CommonMarki loendimarkeri lõks JA AA-numbri lõks korraga.
    tekst = "1759. aastal sai temast Tartu ülikooli professor ning ta pidas seal loenguid."
    assert is_aa_record(tekst) is False
    assert classify(tekst) == BIOGRAPHY_ET


def test_tuhi_tekst_ei_klassifitseeru():
    assert classify("") is None
    assert classify(None) is None
    assert classify("   \n  ") is None


def test_rasi_on_stabiilne_ja_lubjab_umbritseva_tuhiku():
    assert text_hash("tekst") == text_hash("  tekst \n")
    assert len(text_hash("tekst")) == 12
    assert text_hash("tekst") != text_hash("teksti")


def test_ankru_suunad_on_ristis():
    # Ingliskeelse teksti ankur kannab EESTIKEELSE teksti räsi.
    assert ANCHOR_OF[BIOGRAPHY_EN] == SRC_EN
    assert ANCHOR_SOURCE[SRC_EN] == BIOGRAPHY_ET
    assert ANCHOR_OF[BIOGRAPHY_ET] == SRC_ET
    assert ANCHOR_SOURCE[SRC_ET] == BIOGRAPHY_EN


def test_kahtluse_lipud():
    # AA-ks liigitatud, aga sees on proosalõik → lipp.
    lipud = suspicion_flags(PROOSA_MIS_TSITEERIB_AA, AA_RAW, aa_median=400)
    assert "proosa_aa_kirjes" in lipud
    # Markdown eluloos ei ole kahtlane; markdown AA-kirjes on.
    assert "markdown" in suspicion_flags("**paks** kirje", AA_RAW, aa_median=400)
    assert "markdown" not in suspicion_flags("**paks** lugu", BIOGRAPHY_ET, aa_median=400)
    # Marker olemas, aga mitte alguses → lipp ka siis, kui siht on elulugu.
    assert "marker_ei_ole_alguses" in suspicion_flags(
        PROOSA_MIS_TSITEERIB_AA, BIOGRAPHY_ET, aa_median=400)
    # AA-kirje, mille pikkus on mediaanist kaugel.
    assert "pikkus_kahtlane" in suspicion_flags("x" * 5000, AA_RAW, aa_median=400)
```

- [ ] **Step 2: Käivita test ja veendu, et see kukub**

Run: `.venv/bin/pytest tests/test_prosopo_biography_fields.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'server.prosopo_biography_fields'`

- [ ] **Step 3: Kirjuta moodul**

```python
"""Eluloo keeleväljade nimed, AA-klassifikaator ja vananemisankru räsi.

AINULT stdlib. Seda moodulit impordib nii backend kui `scripts/`-i
migratsiooniskript, mis jookseb hosti venv-is ilma FastAPI ja gitpythonita.

Miks eraldi moodul, mitte `person_crud`-i sees: `person_crud` tõmbab kaasa
`state`, `indices`, `entity_labels_ops` — migratsiooniskript ei tohi neist
sõltuda (vt `scripts/detect_greek.py` fake-package muster).
"""
from __future__ import annotations

import hashlib
import re
from typing import List, Optional

BIOGRAPHY_ET = "biography_et"
BIOGRAPHY_EN = "biography_en"
AA_RAW = "aa_raw"
SRC_ET = "biography_et_src"
SRC_EN = "biography_en_src"
LEGACY_BIOGRAPHY = "biography"

TEXT_FIELDS = (BIOGRAPHY_ET, BIOGRAPHY_EN, AA_RAW)
ANCHOR_FIELDS = (SRC_ET, SRC_EN)

# Keeleväli → tema ankur.
ANCHOR_OF = {BIOGRAPHY_ET: SRC_ET, BIOGRAPHY_EN: SRC_EN}
# Ankur → väli, MILLE räsi ta kannab. Suunad on RISTIS: ingliskeelse teksti
# ankur kinnitab vastavust EESTIKEELSELE tekstile.
ANCHOR_SOURCE = {SRC_ET: BIOGRAPHY_EN, SRC_EN: BIOGRAPHY_ET}

HASH_LENGTH = 12


def text_hash(text: Optional[str]) -> str:
    """Teksti räsi ankru jaoks: sha256 esimesed 12 hex-märki.

    Ümbritsev tühik lubjatakse — reavahetus teksti lõpus ei ole sisuline
    muudatus ja ei tohi vale hoiatust tekitada.
    """
    normaliseeritud = (text or "").strip()
    return hashlib.sha256(normaliseeritud.encode("utf-8")).hexdigest()[:HASH_LENGTH]


# AA-kirje algus. NB: kontrollime ALGUST, mitte „sisaldab kuskil" — proosa,
# mis tsiteerib AA-kirjet, on elulugu.
_AA_PAIS = re.compile(r"^\s*Immatrikuleerimise\s+kuupäev\s*:", re.I)
_AA_DEP = re.compile(r"^\s*AG\s*:\s*Dep\.", re.I)
# „154. Lünaeus (…), Emundus, Smål., * 1604, † 1693."
_AA_NUMBER = re.compile(r"^\s*\d{1,4}\.\s+[A-ZÄÖÜÕŠŽ]")
# Numbriga algav rida vajab kinnitust: paljas „1759. aastal…" on aastaarv,
# mitte kirje number (sama lõks mis `escapeAccidentalOrderedLists` frontendis).
_AA_KINNITUS = re.compile(r"(†|\*\s*1\d{3}|\bAG\s*:|\bImm\.|\bDep\.)")
_AA_KINNITUSE_AKEN = 300

# Marker kuskil tekstis (kahtluse lipu jaoks, mitte klassifitseerimiseks).
_AA_MARKER_UKSKOIK_KUS = re.compile(
    r"(Immatrikuleerimise\s+kuupäev\s*:|\bAG\s*:\s*Dep\.)", re.I)

# Kaheksa järjestikust puhast sõna — AA-kirjes on lühendeid ja numbreid nii
# tihedalt, et selline jada on seal ebatavaline.
_PROOSA = re.compile(r"(?:\b[A-Za-zÄÖÜÕäöüõŠšŽž]{2,}\s+){8,}")
_MARKDOWN = re.compile(r"(\*\*|~~|^\s{0,3}#{1,6}\s|\]\()", re.M)


def is_aa_record(text: Optional[str]) -> bool:
    """Kas tekst ALGAB Album Academicumi kirjena?"""
    if not text or not text.strip():
        return False
    if _AA_PAIS.search(text) or _AA_DEP.search(text):
        return True
    if _AA_NUMBER.search(text) and _AA_KINNITUS.search(text[:_AA_KINNITUSE_AKEN]):
        return True
    return False


def classify(text: Optional[str]) -> Optional[str]:
    """Vana `biography` sisu → sihtväli. None, kui sisu ei ole."""
    if not text or not text.strip():
        return None
    return AA_RAW if is_aa_record(text) else BIOGRAPHY_ET


def suspicion_flags(text: str, target: str, aa_median: int) -> List[str]:
    """Kahtluse lipud kuivkäivituse aruandele. Lipp ei ole viga, vaid vaatamiskoht."""
    lipud: List[str] = []
    sisu = text or ""

    marker = _AA_MARKER_UKSKOIK_KUS.search(sisu)
    if marker and marker.start() > 0:
        lipud.append("marker_ei_ole_alguses")

    if target == AA_RAW:
        if _MARKDOWN.search(sisu):
            lipud.append("markdown")
        if _PROOSA.search(sisu):
            lipud.append("proosa_aa_kirjes")
        if aa_median > 0 and not (0.2 * aa_median <= len(sisu) <= 5 * aa_median):
            lipud.append("pikkus_kahtlane")

    return lipud


__all__ = [
    "BIOGRAPHY_ET", "BIOGRAPHY_EN", "AA_RAW", "SRC_ET", "SRC_EN",
    "LEGACY_BIOGRAPHY", "TEXT_FIELDS", "ANCHOR_FIELDS", "ANCHOR_OF",
    "ANCHOR_SOURCE", "HASH_LENGTH", "text_hash", "is_aa_record", "classify",
    "suspicion_flags",
]
```

- [ ] **Step 4: Käivita test ja veendu, et see läbib**

Run: `.venv/bin/pytest tests/test_prosopo_biography_fields.py -q`
Expected: PASS (7 testi)

- [ ] **Step 5: Commit**

```bash
git add server/prosopo_biography_fields.py tests/test_prosopo_biography_fields.py
git commit -m "feat(prosopo): eluloo keeleväljade nimed ja AA-klassifikaator"
```

---
### Task 2: Migratsiooniskript — kuivkäivitus ja vastendusfail

Kuivkäivitus katab **KÕIK 371 täidetud kirjet** (mitte ainult 63 mitte-AA oma) ja kirjutab
vastendusfaili, mille inimene üle vaatab. `--apply` loeb ainult seda faili.

**Files:**
- Create: `scripts/migrate_biography_language_fields.py`
- Test: `tests/test_migrate_biography_fields.py`

**Interfaces:**
- Consumes: Task 1 — `classify`, `text_hash`, `suspicion_flags`, `AA_RAW`, `BIOGRAPHY_ET`, `LEGACY_BIOGRAPHY`
- Produces:
  - `build_mapping(persons: List[dict]) -> dict` — `{"generated_at": str, "entries": [ ... ]}`
  - kirje kuju: `{"id": str, "name": str, "length": int, "target": str, "source_hash": str, "flags": List[str], "preview": str}`
  - `format_report(mapping: dict) -> str` — lipuga read ESIMESENA
  - `load_persons(prosopo_dir: str) -> List[dict]`
  - CLI: `--mapping PATH` (vaikimisi `biography_mapping.json`), `--apply`, `--pass {a,b}`, `--commit`

- [ ] **Step 1: Kirjuta kukkuv test**

```python
"""Migratsiooni kuivkäivitus: klassifikatsioon, lipud, aruande järjekord.

Kuivkäivitus EI KIRJUTA kaartidele midagi — see on kogu passi A ohutuse alus.
"""
import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
sys.path.insert(0, str(PROJECT_ROOT / "scripts"))

from migrate_biography_language_fields import (  # noqa: E402
    build_mapping, format_report, load_persons,
)
from server.prosopo_biography_fields import AA_RAW, BIOGRAPHY_ET, text_hash  # noqa: E402

AA_TEKST = (
    "Immatrikuleerimise kuupäev: 20. September 1634\n"
    "154. Lünaeus, Emundus, Smål., * 1604, † 1693. AG: Dep. 18. 9. 1634."
)
PROOSA_TEKST = (
    "Emundus Lünaeus oli Smålandist pärit üliõpilane, kes jõudis Tartusse "
    "kolmekümneaastase sõja keskel ja jäi siia mitmeks aastaks õppima."
)


def _person(pid, nimi, bio):
    return {"id": pid, "name": {"label": nimi}, "biography": bio}


def test_kaardistus_katab_koik_taidetud_kirjed():
    persons = [
        _person("vutt:Pa", "Lünaeus", AA_TEKST),
        _person("vutt:Pb", "Ludenius", PROOSA_TEKST),
        _person("vutt:Pc", "Tühi", None),
        _person("vutt:Pd", "Tühik", "   \n "),
    ]
    mapping = build_mapping(persons)
    ids = [e["id"] for e in mapping["entries"]]
    assert ids == ["vutt:Pa", "vutt:Pb"] or sorted(ids) == ["vutt:Pa", "vutt:Pb"]
    sihid = {e["id"]: e["target"] for e in mapping["entries"]}
    assert sihid["vutt:Pa"] == AA_RAW
    assert sihid["vutt:Pb"] == BIOGRAPHY_ET


def test_kirje_kannab_rasi_ja_eelvaadet():
    mapping = build_mapping([_person("vutt:Pa", "Lünaeus", AA_TEKST)])
    kirje = mapping["entries"][0]
    assert kirje["source_hash"] == text_hash(AA_TEKST)
    assert kirje["length"] == len(AA_TEKST)
    assert kirje["preview"] == AA_TEKST[:200]
    assert kirje["name"] == "Lünaeus"


def test_lipuga_read_on_aruande_alguses():
    kahtlane = _person("vutt:Px", "Kahtlane", "**paks** " + AA_TEKST)
    puhas = _person("vutt:Py", "Puhas", AA_TEKST)
    mapping = build_mapping([puhas, kahtlane])
    aruanne = format_report(mapping)
    assert aruanne.index("vutt:Px") < aruanne.index("vutt:Py")


def test_load_persons_jatab_pildikausta_vahele(tmp_path):
    (tmp_path / "images").mkdir()
    (tmp_path / "images" / "ei_ole.json").write_text("{}", encoding="utf-8")
    (tmp_path / "abc.json").write_text(
        json.dumps({"id": "vutt:Pabc", "biography": PROOSA_TEKST}), encoding="utf-8")
    (tmp_path / "katki.json").write_text("{ see ei ole json", encoding="utf-8")
    persons = load_persons(str(tmp_path))
    assert [p["id"] for p in persons] == ["vutt:Pabc"]
```

- [ ] **Step 2: Käivita test ja veendu, et see kukub**

Run: `.venv/bin/pytest tests/test_migrate_biography_fields.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'migrate_biography_language_fields'`

- [ ] **Step 3: Kirjuta skripti kuivkäivituse pool**

```python
#!/usr/bin/env python3
"""Kolib `biography` keelega väljadesse: `biography_et` või `aa_raw`.

KAKS PASSI (expand–migrate–contract, vt spekk „Avaliku API üleminek"):
  pass a — kirjutab uue välja, JÄTAB `biography` alles (vana kood loeb edasi)
  pass b — eemaldab `biography` (alles pärast tootmiskontrolli)

Kasutus (serveris, KONTEINERIST — `data/` git commitib root'ina):
  docker exec vutt-backend python3 scripts/migrate_biography_language_fields.py
  # → aruanne stdout'i + biography_mapping.json; inimene vaatab üle
  docker exec vutt-backend python3 scripts/migrate_biography_language_fields.py \
      --apply --pass a --mapping biography_mapping.json --commit

Kuivkäivitus on VAIKIMISI (nagu `scripts/detect_greek.py`) ega kirjuta midagi.
`--apply` loeb AINULT vastendusfaili, mitte oma klassifikaatorit — nii on
inimese ülevaatus tegelik värav, mitte formaalsus.
"""
import argparse
import json
import os
import subprocess
import sys
import types
from datetime import datetime, timezone
from typing import List, Optional

# Fake-package muster (vt `scripts/detect_greek.py`): registreerib `server`
# nimeruumi ILMA `server/__init__.py` käivitamiseta — muidu tõmbaks import
# kaasa FastAPI ja gitpythoni, mida hosti venv-is ei ole.
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if "server" not in sys.modules:
    _server_pkg = types.ModuleType("server")
    _server_pkg.__path__ = [os.path.join(_PROJECT_ROOT, "server")]
    _server_pkg.__package__ = "server"
    sys.modules.setdefault("server", _server_pkg)
sys.path.insert(0, _PROJECT_ROOT)

from server.prosopo_biography_fields import (  # noqa: E402
    AA_RAW, LEGACY_BIOGRAPHY, classify, suspicion_flags, text_hash,
)

PREVIEW_CHARS = 200
IMAGES_DIR_NAME = "images"


def _prosopo_dir() -> str:
    """Isikukaartide kaust. `server.config` on ainuõige allikas (CLAUDE.md)."""
    from server.config import DATA_CONFIG_DIR
    return os.path.join(DATA_CONFIG_DIR, "prosopography")


def load_persons(prosopo_dir: str) -> List[dict]:
    """Laeb kõik isikukaardid. Pildikaust ja katkine JSON jäetakse vahele."""
    persons = []
    for entry in sorted(os.scandir(prosopo_dir), key=lambda e: e.name):
        if not entry.is_file() or not entry.name.endswith(".json"):
            continue
        if IMAGES_DIR_NAME in entry.path.split(os.sep):
            continue
        try:
            with open(entry.path, encoding="utf-8") as f:
                doc = json.load(f)
        except Exception:
            continue
        if isinstance(doc, dict) and doc.get("id"):
            persons.append(doc)
    return persons


def _aa_median(persons: List[dict]) -> int:
    """AA-ks liigituvate tekstide mediaanpikkus — `pikkus_kahtlane` lipu alus.

    Arvutatakse ANDMETEST, mitte konstandist: korpus kasvab ja sisse kirjutatud
    number vananeks vaikselt.
    """
    pikkused = sorted(
        len(p[LEGACY_BIOGRAPHY])
        for p in persons
        if p.get(LEGACY_BIOGRAPHY) and classify(p[LEGACY_BIOGRAPHY]) == AA_RAW
    )
    if not pikkused:
        return 0
    return pikkused[len(pikkused) // 2]


def build_mapping(persons: List[dict]) -> dict:
    """Kõik täidetud `biography` kirjed → vastendusfaili kuju."""
    mediaan = _aa_median(persons)
    entries = []
    for person in persons:
        tekst = person.get(LEGACY_BIOGRAPHY)
        target = classify(tekst)
        if target is None:
            continue
        entries.append({
            "id": person["id"],
            "name": (person.get("name") or {}).get("label") or "",
            "length": len(tekst),
            "target": target,
            "source_hash": text_hash(tekst),
            "flags": suspicion_flags(tekst, target, mediaan),
            "preview": tekst[:PREVIEW_CHARS],
        })
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "aa_median_length": mediaan,
        "entries": entries,
    }


def format_report(mapping: dict) -> str:
    """Inimloetav aruanne. LIPUGA READ ON ALGUSES — need vajavad otsust."""
    entries = mapping["entries"]
    lipuga = [e for e in entries if e["flags"]]
    puhtad = [e for e in entries if not e["flags"]]

    read = [
        "MIGRATSIOONI KUIVKÄIVITUS",
        f"  kirjeid kokku: {len(entries)}",
        f"  → {AA_RAW}: {sum(1 for e in entries if e['target'] == AA_RAW)}",
        f"  → elulugu:    {sum(1 for e in entries if e['target'] != AA_RAW)}",
        f"  lipuga:       {len(lipuga)}",
        f"  AA mediaanpikkus: {mapping['aa_median_length']}",
        "",
    ]
    for pealkiri, grupp in (("LIPUGA (vaata üle)", lipuga), ("PUHTAD", puhtad)):
        read.append(f"── {pealkiri} ──")
        for e in grupp:
            lipud = (" [" + ", ".join(e["flags"]) + "]") if e["flags"] else ""
            read.append(f"{e['id']}  {e['name']}  {e['length']} märki  → {e['target']}{lipud}")
            read.append("    " + e["preview"].replace("\n", " ⏎ "))
        read.append("")
    return "\n".join(read)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mapping", default="biography_mapping.json",
                        help="Vastendusfaili tee (kuivkäivitus kirjutab, --apply loeb)")
    parser.add_argument("--apply", action="store_true", help="Kirjuta muudatused kaartidele")
    parser.add_argument("--pass", dest="pass_", choices=("a", "b"),
                        help="a = kirjuta uus väli; b = eemalda `biography`")
    parser.add_argument("--commit", action="store_true", help="Tee data/ git commit")
    args = parser.parse_args()

    prosopo_dir = _prosopo_dir()
    if not os.path.isdir(prosopo_dir):
        print(f"VIGA: kausta ei ole: {prosopo_dir}", file=sys.stderr)
        return 1

    if not args.apply:
        mapping = build_mapping(load_persons(prosopo_dir))
        with open(args.mapping, "w", encoding="utf-8") as f:
            json.dump(mapping, f, ensure_ascii=False, indent=2)
        print(format_report(mapping))
        print(f"Vastendus kirjutatud: {args.mapping}")
        print("Vaata lipuga read üle, paranda vajadusel `target`, siis --apply --pass a")
        return 0

    if not args.pass_:
        print("VIGA: --apply nõuab --pass a või --pass b", file=sys.stderr)
        return 1
    print("VIGA: --apply ei ole veel teostatud (ülesanded 3–4)", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Käivita test ja veendu, et see läbib**

Run: `.venv/bin/pytest tests/test_migrate_biography_fields.py -q`
Expected: PASS (4 testi)

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate_biography_language_fields.py tests/test_migrate_biography_fields.py
git commit -m "feat(migratsioon): eluloo keeleväljade kuivkäivitus ja vastendusfail"
```

---

### Task 3: Migratsiooniskript — pass A (`--apply --pass a`)

Kolm kontrolli enne iga kirjet: lähtetekst muutumata, sihtväli tühi, kirje veel migreerimata.
Esimesed kaks **peatavad jooksu**, kolmas jätab vahele (idempotentsus).

**Files:**
- Modify: `scripts/migrate_biography_language_fields.py`
- Test: `tests/test_migrate_biography_fields.py`

**Interfaces:**
- Consumes: Task 2 — `load_persons`, `build_mapping`
- Produces:
  - `apply_pass_a(persons: List[dict], mapping: dict) -> dict` → `{"written": [person, ...], "skipped": int, "error": Optional[str]}` — `written` on PALJASTE kaardi-dict'ide list, mitte paaride oma
  - `_git_commit(data_root: str, paths: List[str], message: str) -> bool`

- [ ] **Step 1: Kirjuta kukkuvad testid**

```python
# Lisa faili tests/test_migrate_biography_fields.py

from migrate_biography_language_fields import apply_pass_a  # noqa: E402
from server.prosopo_biography_fields import BIOGRAPHY_ET  # noqa: E402


def _mapping_for(persons):
    return build_mapping(persons)


def test_pass_a_kirjutab_uue_valja_ja_jatab_vana_alles():
    persons = [_person("vutt:Pb", "Ludenius", PROOSA_TEKST)]
    tulem = apply_pass_a(persons, _mapping_for(persons))
    assert tulem["error"] is None
    assert persons[0][BIOGRAPHY_ET] == PROOSA_TEKST
    assert persons[0]["biography"] == PROOSA_TEKST   # pass A EI eemalda
    assert len(tulem["written"]) == 1


def test_pass_a_peatub_kui_lahtetekst_on_muutunud():
    persons = [_person("vutt:Pb", "Ludenius", PROOSA_TEKST)]
    mapping = _mapping_for(persons)
    persons[0]["biography"] = PROOSA_TEKST + " (toimetaja lisas vahepeal lause)"
    tulem = apply_pass_a(persons, mapping)
    assert tulem["error"] is not None
    assert "vutt:Pb" in tulem["error"]
    assert BIOGRAPHY_ET not in persons[0]      # midagi ei kirjutatud
    assert tulem["written"] == []


def test_pass_a_peatub_kui_sihtvali_on_taidetud_teise_tekstiga():
    persons = [_person("vutt:Pb", "Ludenius", PROOSA_TEKST)]
    mapping = _mapping_for(persons)
    persons[0][BIOGRAPHY_ET] = "midagi muud, mille keegi käsitsi kirjutas"
    tulem = apply_pass_a(persons, mapping)
    assert tulem["error"] is not None
    assert persons[0][BIOGRAPHY_ET] == "midagi muud, mille keegi käsitsi kirjutas"


def test_pass_a_on_idempotentne():
    persons = [_person("vutt:Pb", "Ludenius", PROOSA_TEKST)]
    mapping = _mapping_for(persons)
    esimene = apply_pass_a(persons, mapping)
    teine = apply_pass_a(persons, mapping)
    assert esimene["error"] is None and teine["error"] is None
    assert teine["written"] == []
    assert teine["skipped"] == 1


def test_pass_a_austab_kasitsi_muudetud_sihtvalja_vastenduses():
    # Inimene parandas aruandes `target`-i: AA-marker keset proosat → elulugu.
    persons = [_person("vutt:Px", "Segane", AA_TEKST)]
    mapping = _mapping_for(persons)
    assert mapping["entries"][0]["target"] == AA_RAW
    mapping["entries"][0]["target"] = BIOGRAPHY_ET       # inimese otsus
    tulem = apply_pass_a(persons, mapping)
    assert tulem["error"] is None
    assert persons[0][BIOGRAPHY_ET] == AA_TEKST
    assert AA_RAW not in persons[0]
```

- [ ] **Step 2: Käivita testid ja veendu, et need kukuvad**

Run: `.venv/bin/pytest tests/test_migrate_biography_fields.py -q -k pass_a`
Expected: FAIL — `ImportError: cannot import name 'apply_pass_a'`

- [ ] **Step 3: Teosta `apply_pass_a` ja ühenda CLI-sse**

```python
def apply_pass_a(persons: List[dict], mapping: dict) -> dict:
    """Kirjutab `biography` sisu vastenduse sihtvälja. `biography` JÄÄB ALLES.

    Peatub esimese lahknevuse peal ega kirjuta osaliselt: `written` on nimekiri
    kaartidest, mis TULEB salvestada, ja kutsuja salvestab need alles siis, kui
    `error` on None.
    """
    kaardid = {p["id"]: p for p in persons}
    written = []
    skipped = 0

    for kirje in mapping["entries"]:
        pid = kirje["id"]
        target = kirje["target"]
        person = kaardid.get(pid)
        if person is None:
            return {"written": [], "skipped": skipped,
                    "error": f"{pid}: kaarti ei leitud"}

        tekst = person.get(LEGACY_BIOGRAPHY)

        # 3. Juba migreeritud? Sihtväli kannab sama teksti → vahele.
        if person.get(target) == tekst:
            skipped += 1
            continue

        # 1. Lähtetekst muutumata ülevaatusest saadik?
        if text_hash(tekst) != kirje["source_hash"]:
            return {"written": [], "skipped": skipped, "error": (
                f"{pid}: `biography` on pärast ülevaatust muutunud "
                f"(räsi {text_hash(tekst)} != {kirje['source_hash']}). "
                f"Tee kuivkäivitus uuesti.")}

        # 2. Sihtväli tühi?
        if person.get(target):
            return {"written": [], "skipped": skipped, "error": (
                f"{pid}: sihtväli `{target}` on juba täidetud teise tekstiga — "
                f"ei kirjuta üle. Lahenda käsitsi.")}

        person[target] = tekst
        written.append(person)

    return {"written": written, "skipped": skipped, "error": None}
```

Salvestamine ja commit CLI-s:

```python
def _save(prosopo_dir: str, person: dict) -> str:
    """Kirjutab kaardi tagasi. Tagastab faili tee (commiti lavastamiseks)."""
    nanoid = person["id"].removeprefix("vutt:P")
    path = os.path.join(prosopo_dir, f"{nanoid}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(person, f, ensure_ascii=False, indent=2)
    return path


def _git_commit(data_root: str, paths: List[str], message: str) -> bool:
    """Üks commit partii kohta. Laval AINULT selle jooksu failid.

    `git add -A` oleks vale: jooksev backend uuendab `data/config/` tuletatud
    indekseid pidevalt ja need satuksid vaikselt migratsiooni commiti sisse.
    """
    for cmd in (["git", "add", "--"] + paths, ["git", "commit", "-m", message]):
        result = subprocess.run(cmd, cwd=data_root, capture_output=True, text=True)
        if result.returncode != 0:
            print(f"VIGA: {' '.join(cmd[:3])} ebaõnnestus: {result.stderr}", file=sys.stderr)
            return False
    return True
```

`main()`-is asenda `--apply` haru:

```python
    with open(args.mapping, encoding="utf-8") as f:
        mapping = json.load(f)
    persons = load_persons(prosopo_dir)

    if args.pass_ == "a":
        tulem = apply_pass_a(persons, mapping)
        pass_nimi = "pass A"
        sonum = "refactor(prosopo): biography → keelega väljad, pass A ({n} kaarti)"
    else:
        # Pass B sünnib ülesandes 4. SIIN peab olema selge viga, mitte kutse
        # funktsioonile, mida veel ei ole — muidu annab `--pass b` selle ja
        # järgmise commiti vahel `NameError`-i.
        print("VIGA: --pass b ei ole veel teostatud", file=sys.stderr)
        return 1

    if tulem["error"]:
        print(f"PEATUTUD ({pass_nimi}): {tulem['error']}", file=sys.stderr)
        return 1

    paths = [_save(prosopo_dir, p) for p in tulem["written"]]
    print(f"{pass_nimi}: kirjutatud {len(paths)}, vahele jäetud {tulem['skipped']}")

    if args.commit and paths:
        from server.config import DATA_CONFIG_DIR
        data_root = os.path.dirname(DATA_CONFIG_DIR)
        if not _git_commit(data_root, paths, sonum.format(n=len(paths))):
            return 1
        print("  Git commit loodud.")
    return 0
```

- [ ] **Step 4: Käivita testid ja veendu, et need läbivad**

Run: `.venv/bin/pytest tests/test_migrate_biography_fields.py -q`
Expected: PASS (9 testi)

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate_biography_language_fields.py tests/test_migrate_biography_fields.py
git commit -m "feat(migratsioon): pass A kolme kontrolliga (räsi, tühi siht, idempotentsus)"
```

---

### Task 4: Migratsiooniskript — pass B (contract)

Pass B eemaldab `biography` **kõigilt** kaartidelt: migreeritutelt (sihtväli täidetud) ja
nendelt 2018 kaardilt, kus väärtus oli algusest peale `null`. Migreerimata täidetud kirjet
EI puudutata — see oleks andmekadu.

**Files:**
- Modify: `scripts/migrate_biography_language_fields.py`
- Test: `tests/test_migrate_biography_fields.py`

**Interfaces:**
- Consumes: Task 3 — `apply_pass_a`, `_save`, `_git_commit`
- Produces: `apply_pass_b(persons: List[dict], mapping: dict) -> dict` (sama tagastuskuju mis `apply_pass_a`)

- [ ] **Step 1: Kirjuta kukkuvad testid**

```python
from migrate_biography_language_fields import apply_pass_b  # noqa: E402


def test_pass_b_eemaldab_migreeritud_kaardilt():
    persons = [_person("vutt:Pb", "Ludenius", PROOSA_TEKST)]
    mapping = _mapping_for(persons)
    apply_pass_a(persons, mapping)
    tulem = apply_pass_b(persons, mapping)
    assert tulem["error"] is None
    assert "biography" not in persons[0]
    assert persons[0][BIOGRAPHY_ET] == PROOSA_TEKST


def test_pass_b_eemaldab_tuhja_valja_ka_vastenduses_puuduvalt_kaardilt():
    persons = [{"id": "vutt:Pc", "name": {"label": "Tühi"}, "biography": None}]
    tulem = apply_pass_b(persons, {"entries": []})
    assert tulem["error"] is None
    assert "biography" not in persons[0]
    assert len(tulem["written"]) == 1


def test_pass_b_ei_puuduta_migreerimata_taidetud_kirjet():
    persons = [_person("vutt:Pz", "Migreerimata", PROOSA_TEKST)]
    tulem = apply_pass_b(persons, {"entries": []})
    assert tulem["error"] is not None
    assert persons[0]["biography"] == PROOSA_TEKST


def test_pass_b_on_idempotentne():
    persons = [_person("vutt:Pb", "Ludenius", PROOSA_TEKST)]
    mapping = _mapping_for(persons)
    apply_pass_a(persons, mapping)
    apply_pass_b(persons, mapping)
    teine = apply_pass_b(persons, mapping)
    assert teine["error"] is None
    assert teine["written"] == []


def test_pass_b_lubab_vahepeal_toimetatud_sihtvalja():
    # Toimetaja parandas `biography_et`-d pärast passi A — see on OODATUD,
    # uus väli on autoriteet ja `biography` on lihtsalt jäänuk.
    persons = [_person("vutt:Pb", "Ludenius", PROOSA_TEKST)]
    mapping = _mapping_for(persons)
    apply_pass_a(persons, mapping)
    persons[0][BIOGRAPHY_ET] = PROOSA_TEKST + " Toimetaja täiendas."
    tulem = apply_pass_b(persons, mapping)
    assert tulem["error"] is None
    assert "biography" not in persons[0]
```

- [ ] **Step 2: Käivita testid ja veendu, et need kukuvad**

Run: `.venv/bin/pytest tests/test_migrate_biography_fields.py -q -k pass_b`
Expected: FAIL — `ImportError: cannot import name 'apply_pass_b'`

- [ ] **Step 3: Teosta `apply_pass_b`**

```python
def apply_pass_b(persons: List[dict], mapping: dict) -> dict:
    """Eemaldab `biography` võtme. Contract-samm — jookseb PÄRAST tootmiskontrolli.

    Kolm juhtu:
      - väärtus tühi/None → võti maha (need on need ~2018 kaarti, mida
        vastenduses ei ole);
      - vastenduses olemas JA sihtväli täidetud → võti maha. Sihtvälja sisu
        EI võrrelda `biography`-ga: toimetaja võis seda passide vahel muuta ja
        see on oodatud, uus väli on autoriteet;
      - täidetud, aga migreerimata → PEATU. Võtme eemaldamine oleks andmekadu.
    """
    sihid = {e["id"]: e["target"] for e in mapping.get("entries", [])}
    written = []
    skipped = 0

    for person in persons:
        if LEGACY_BIOGRAPHY not in person:
            skipped += 1
            continue

        tekst = person.get(LEGACY_BIOGRAPHY)
        if not tekst or not tekst.strip():
            person.pop(LEGACY_BIOGRAPHY)
            written.append(person)
            continue

        target = sihid.get(person["id"])
        if not target or not person.get(target):
            return {"written": [], "skipped": skipped, "error": (
                f"{person['id']}: `biography` on täidetud, aga migreeritud ei ole "
                f"(sihtväli {target or '—'} tühi). Jooksuta enne --pass a.")}

        person.pop(LEGACY_BIOGRAPHY)
        written.append(person)

    return {"written": written, "skipped": skipped, "error": None}
```

- [ ] **Step 3b: Ühenda pass B CLI-sse**

`main()`-is asenda ülesandes 3 kirjutatud `else`-haru („--pass b ei ole veel teostatud"):

```python
    else:
        tulem = apply_pass_b(persons, mapping)
        pass_nimi = "pass B"
        sonum = "refactor(prosopo): `biography` eemaldatud, pass B ({n} kaarti)"
```

- [ ] **Step 4: Käivita kogu testifail ja veendu, et see läbib**

Run: `.venv/bin/pytest tests/test_migrate_biography_fields.py -q`
Expected: PASS (14 testi)

Kontrolli ka CLI mõlemat passi käsitsi ajutise kaustaga, et `main()` ei kuku
`NameError`-i taha:

```bash
.venv/bin/python3 scripts/migrate_biography_language_fields.py --help
```

- [ ] **Step 5: Commit**

```bash
git add scripts/migrate_biography_language_fields.py tests/test_migrate_biography_fields.py
git commit -m "feat(migratsioon): pass B eemaldab pärandvälja, migreerimata kirje peatab"
```

---
### Task 5: Backend skeem ja neli katget

Uus kaart luuakse keeleväljadega; nimekirja indeks kannab **iga allika kohta oma katke**
(spekk, otsus 6). Vana `biography_snippet` KAOB indeksist — varuvariandi valib vaade,
mitte indeks.

**Files:**
- Modify: `server/prosopography/person_crud.py` (`create_person` ~rida 160, `_make_snippet` ~rida 128)
- Modify: `server/prosopography/person_search.py:689`
- Test: `tests/test_prosopo_biography_snippets.py`

**Interfaces:**
- Consumes: Task 1 — `AA_RAW`, `BIOGRAPHY_ET`, `BIOGRAPHY_EN`, `SRC_ET`, `SRC_EN`
- Produces: `person_crud._make_snippets(person: dict) -> dict` neljas võtmes:
  `biography_snippet_et`, `biography_snippet_en`, `notes_snippet`, `aa_snippet`.
  `_make_snippet` **eemaldatakse** (ka `__all__`-ist).

- [ ] **Step 1: Kirjuta kukkuvad testid**

```python
"""Nimekirja katked on keele kaupa ERALDI (spekk, otsus 6).

Miks mitte üks katke, mille sisse varuvariant juba arvestatud: siis võiks
„ingliskeelses" katkes olla eestikeelne tekst või AA-kirje ja kaart ei saaks
välja nime järgi ühtki ausat keelemärget valida.
"""
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.prosopography.person_crud import _make_snippets  # noqa: E402
from server.prosopo_biography_fields import AA_RAW, BIOGRAPHY_EN, BIOGRAPHY_ET  # noqa: E402


def test_iga_allikas_annab_oma_katke():
    katked = _make_snippets({
        BIOGRAPHY_ET: "Eestikeelne elulugu.",
        BIOGRAPHY_EN: "English biography.",
        "notes": "Sisemised märkmed.",
        AA_RAW: "154. Lünaeus, Emundus.",
    })
    assert katked["biography_snippet_et"] == "Eestikeelne elulugu."
    assert katked["biography_snippet_en"] == "English biography."
    assert katked["notes_snippet"] == "Sisemised märkmed."
    assert katked["aa_snippet"] == "154. Lünaeus, Emundus."


def test_puuduv_allikas_annab_tuhja_stringi_mitte_None():
    katked = _make_snippets({BIOGRAPHY_ET: "Ainult eesti keeles."})
    assert katked["biography_snippet_en"] == ""
    assert katked["aa_snippet"] == ""
    assert katked["notes_snippet"] == ""


def test_katked_on_puhas_tekst_ja_120_margi_pikkused():
    katked = _make_snippets({BIOGRAPHY_ET: "**Carl Lund** " + "x" * 200})
    assert not katked["biography_snippet_et"].startswith("**")
    assert len(katked["biography_snippet_et"]) == 120


def test_ei_varuvarianteeru_indeksis():
    # ET tühi, EN täidetud → ET katke JÄÄB tühjaks. Varuvariandi valib vaade.
    katked = _make_snippets({BIOGRAPHY_EN: "English only."})
    assert katked["biography_snippet_et"] == ""
    assert katked["biography_snippet_en"] == "English only."
```

Ja indeksikirje test — lisa `tests/test_prosopography_ops.py` lõppu:

```python
def test_indeksikirje_kannab_nelja_katet():
    from server.prosopography.person_search import _index_entry_from_person
    kirje = _index_entry_from_person(
        {"id": "vutt:Pa", "name": {"label": "Test"}, "biography_en": "English."}, 0)
    assert kirje["biography_snippet_en"] == "English."
    assert kirje["biography_snippet_et"] == ""
    assert "biography_snippet" not in kirje       # vana võti on kadunud
```

- [ ] **Step 2: Käivita testid ja veendu, et need kukuvad**

Run: `.venv/bin/pytest tests/test_prosopo_biography_snippets.py -q`
Expected: FAIL — `ImportError: cannot import name '_make_snippets'`

- [ ] **Step 3: Asenda `_make_snippet` neljaga**

`server/prosopography/person_crud.py` — kustuta:

```python
def _make_snippet(person: dict) -> str:
    biography = person.get("biography") or person.get("notes") or ""
    return _strip_markup(biography)[:120]
```

asenda:

```python
SNIPPET_LENGTH = 120

# Katke allikas → indeksi võtmenimi. Iga katke on tuletatud TÄPSELT ÜHEST
# väljast; varuvariandi valib vaade (ADR 0039, spekk otsus 6).
_SNIPPET_SOURCES = (
    (BIOGRAPHY_ET, "biography_snippet_et"),
    (BIOGRAPHY_EN, "biography_snippet_en"),
    ("notes", "notes_snippet"),
    (AA_RAW, "aa_snippet"),
)


def _make_snippets(person: dict) -> dict:
    """Neli katget, igaüks ühest väljast. Puuduv allikas → tühi string."""
    return {
        key: _strip_markup(person.get(field) or "")[:SNIPPET_LENGTH]
        for field, key in _SNIPPET_SOURCES
    }
```

Lisa faili algusesse import — **ainult see, mida SEE ülesanne kasutab.**
Ülesanded 6 ja 7 laiendavad seda rida ise; kasutamata import oleks ülevaatuse leid:

```python
from ..prosopo_biography_fields import AA_RAW, BIOGRAPHY_EN, BIOGRAPHY_ET, SRC_EN, SRC_ET
```

`create_person` — asenda rida `"biography": None,`:

```python
        BIOGRAPHY_ET: None,
        BIOGRAPHY_EN: None,
        AA_RAW: None,
        SRC_ET: None,
        SRC_EN: None,
```

**`_make_snippet` on re-eksporditud NELJAS kohas — kõik peavad kaasa tulema.**
CLAUDE.md hoiatab: „Funktsiooni eemaldamisel kontrolli ka re-eksporte." Kontrollitud
grepiga (kontroller, 2026-09-10); ühegi vahelejätmine annab `ImportError`-i mooduli
laadimisel, mis kukutab kogu backendi:

| Fail | Rida | Mida teha |
|---|---|---|
| `server/prosopography/person_crud.py` | `__all__` (~653) | `'_make_snippet'` → `'_make_snippets'` |
| `server/prosopography/person_search.py` | 10 | import `_make_snippets` |
| `server/prosopography/ops.py` | 47 | import `_make_snippets` |
| `server/prosopography/ops.py` | `__all__` (~114) | `'_make_snippet'` → `'_make_snippets'` |
| `server/prosopography/_compat.py` | 33 | `_SYNC_NAMES`-is `"_make_snippet"` → `"_make_snippets"` |

`_compat.py` `_SYNC_NAMES` on nimekiri, mida vanad testid võivad `server.prosopography.ops`
peal patch'ida — kui nimi sealt puudu jääb, ei ole viga kohe nähtav, aga patch'imine
lakkab vaikselt töötamast.

Kontroll pärast muudatust — vasteid ei tohi jääda:

```bash
grep -rn "_make_snippet\b" server/ tests/ | grep -v "_make_snippets"
```

`server/prosopography/person_search.py` — rida 10 import ja rida 689:

```python
from .person_crud import _make_snippets, get_person
```

```python
        **_make_snippets(person),
```

(asendab rea `"biography_snippet": _make_snippet(person),`)

- [ ] **Step 4: Käivita testid ja veendu, et need läbivad**

Run: `.venv/bin/pytest tests/test_prosopo_biography_snippets.py tests/test_prosopography_ops.py tests/test_prosopo_snippet_markdown.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/prosopography/person_crud.py server/prosopography/person_search.py \
        server/prosopography/ops.py server/prosopography/_compat.py \
        tests/test_prosopo_biography_snippets.py tests/test_prosopography_ops.py
git commit -m "feat(prosopo): keeleväljad skeemis, neli katget indeksis"
```

---

### Task 6: Pärandvälja reegel ja ankru pop `update_person`-is

Vana avatud vorm saadab `biography` tagasi ja **tekitaks välja uuesti** ka pärast passi B.
Identne väärtus → vaikselt maha; erinev → 409. Ankrud visatakse kliendi sisendist ALATI ära.

**Files:**
- Modify: `server/prosopography/person_crud.py` (`update_person` ~rida 265)
- Modify: `server/prosopography/router.py:816` (`prosopography_update` veakäsitlus)
- Test: `tests/test_prosopo_legacy_biography.py`

**Interfaces:**
- Consumes: Task 5 — `LEGACY_BIOGRAPHY`, `ANCHOR_FIELDS`
- Produces: `update_person` viskab `ValueError("legacy_biography_changed")`; router kaardistab selle 409-ks kujul `{"error": "stale_form", "message": ...}`

- [ ] **Step 1: Kirjuta kukkuvad testid**

```python
"""Vana vorm ei tohi `biography` välja tagasi tekitada (spekk, „Pärandvälja reegel").

`update_person` teeb `person.update(data)` — ilma reeglita kirjutaks vana avatud
vorm välja uuesti ka pärast passi B ja skeem lahkneks vaikselt.
"""
import sys
from pathlib import Path
from unittest.mock import patch

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.prosopography import person_crud  # noqa: E402
from server.prosopo_biography_fields import BIOGRAPHY_ET, SRC_EN  # noqa: E402


@pytest.fixture
def kaart(tmp_path, monkeypatch):
    """Üks salvestatud kaart; `save_with_git` ja indeksid on mockitud."""
    salvestatud = {}
    person = {
        "id": "vutt:Pabc", "updated_at": "2026-09-10T10:00:00+00:00",
        "name": {"label": "Test"}, BIOGRAPHY_ET: "Eesti tekst.",
        "biography": "Eesti tekst.",
    }
    monkeypatch.setattr(person_crud, "get_person", lambda pid: dict(person))
    monkeypatch.setattr(person_crud, "_id_to_path", lambda pid: str(tmp_path / "abc.json"))

    def _save(path, content, username, message=None, **kw):
        import json
        salvestatud["person"] = json.loads(content)

    monkeypatch.setattr(person_crud.state, "save_with_git", _save)
    monkeypatch.setattr(person_crud, "_indices", lambda: type(
        "I", (), {"_update_index_entry": staticmethod(lambda p: None),
                  "_update_aliases_entry": staticmethod(lambda p: None)})())
    return salvestatud


# NB: `update_person` kutsub lisaks `sync_from_facade()`, `person_lock()` ja
# `fill_person_labels_from_registry()`. Kui mõni neist puudutab failisüsteemi ja
# test kukub selle taha, patchi ka need — vaata `tests/test_prosopography_ops.py`
# olemasolevaid fikstuure ja korda sealset mustrit, ära leiuta uut.


def _payload(**extra):
    return {"updated_at": "2026-09-10T10:00:00+00:00", **extra}


def test_identne_parandvali_visatakse_vaikselt_maha(kaart):
    person_crud.update_person("vutt:Pabc", _payload(biography="Eesti tekst."), "kasutaja")
    # Salvestatud kaart kannab endiselt vana väärtust (`person`-ist), aga
    # kliendi saadetu ei ole seda üle kirjutanud ega uut võtit tekitanud.
    assert kaart["person"]["biography"] == "Eesti tekst."


def test_erinev_parandvali_annab_vea(kaart):
    with pytest.raises(ValueError) as exc:
        person_crud.update_person(
            "vutt:Pabc", _payload(biography="Keegi muutis vanas vormis."), "kasutaja")
    assert str(exc.value) == "legacy_biography_changed"
    assert "person" not in kaart          # midagi ei salvestatud


def test_kliendi_saadetud_ankur_visatakse_ara(kaart):
    person_crud.update_person(
        "vutt:Pabc",
        _payload(**{SRC_EN: {"hash": "deadbeefcafe", "at": "2020-01-01T00:00:00+00:00"}}),
        "kasutaja")
    assert kaart["person"].get(SRC_EN) is None


def test_parandvalja_puudumine_ei_sega(kaart):
    person_crud.update_person("vutt:Pabc", _payload(**{BIOGRAPHY_ET: "Uus tekst."}), "kasutaja")
    assert kaart["person"][BIOGRAPHY_ET] == "Uus tekst."
```

- [ ] **Step 2: Käivita testid ja veendu, et need kukuvad**

Run: `.venv/bin/pytest tests/test_prosopo_legacy_biography.py -q`
Expected: FAIL — `test_erinev_parandvali_annab_vea` ei viska `ValueError`-it; `test_kliendi_saadetud_ankur_visatakse_ara` leiab ankru salvestatust

- [ ] **Step 3: Lisa reegel `update_person`-isse**

`server/prosopography/person_crud.py` — **laienda ülesandes 5 lisatud importi** kahe nimega:

```python
from ..prosopo_biography_fields import (
    AA_RAW, ANCHOR_FIELDS, BIOGRAPHY_EN, BIOGRAPHY_ET, LEGACY_BIOGRAPHY, SRC_EN, SRC_ET,
)
```

`update_person` — pärast olemasolevat `for key in (...)` pop-tsüklit, ENNE `person.update(data)`:

```python
        # Ankur on SERVERI TULETIS: kliendi saadetu visatakse alati ära, nagu
        # `id` ja `created_at`. Lubadus, et uus frontend seda ei saada, ei ole
        # kaitse (spekk, „Avaliku API üleminek").
        for key in ANCHOR_FIELDS:
            data.pop(key, None)

        # Pärandväli: vana avatud vorm saadab `biography` tagasi ja tekitaks
        # välja uuesti ka pärast migratsiooni passi B.
        if LEGACY_BIOGRAPHY in data:
            saadetud = data.pop(LEGACY_BIOGRAPHY)
            salvestatud = person.get(LEGACY_BIOGRAPHY)
            if (saadetud or None) != (salvestatud or None):
                # Vaikne teisendus `biography_et`-sse võiks üle kirjutada teksti,
                # mida uus vorm vahepeal muutis — seepärast 409, mitte parandus.
                raise ValueError("legacy_biography_changed")
```

**`apply_enrichment` on TEINE kirjutustee, mis saab välja taastekitada.**
`apply_enrichment` (`person_crud.py`, ~rida 470) teeb `_deep_set(person, field_path, value)`
KLIENDILT tulnud väljateede kaupa — `update_person`-i reeglist ta mööda. Pärast passi B
paneks aegunud vorm ühe „Rakenda rikastus" vajutusega `biography` võtme tagasi. Väli, mille
teine tee saab taastekitada, ei ole skeemist kadunud.

Lisa `apply_enrichment`-i, kohe pärast rida `scheme = approved_fields.pop("_enrichment_scheme", None)`:

```python
        # Pärandväli ei tohi ühegi tee kaudu tagasi tekkida (ADR 0039). Siin
        # VAIKSELT maha, mitte 409: rikastus on masina ettepanek, mitte kasutaja
        # kirjutatud tekst — tema pärast dialoogi ei visata.
        approved_fields.pop(LEGACY_BIOGRAPHY, None)
```

Ja lisa test `tests/test_prosopo_legacy_biography.py`-sse:

```python
def test_rikastus_ei_saa_parandvalja_tagasi_tekitada(kaart):
    person_crud.apply_enrichment(
        "vutt:Pabc", {"biography": "Rikastus üritab", "_enrichment_scheme": "album_academicum"},
        "kasutaja")
    assert kaart["person"].get("biography") == "Eesti tekst."   # muutumatu, mitte üle kirjutatud
```

> **NB:** `tests/test_prosopography_side_writes.py:67-73` kinnitab täna vastupidist —
> et `apply_enrichment` KIRJUTAB `biography` välja. Uuenda see test: väli on skeemist
> eemaldatud, nii et ootus muutub. Ära kustuta testi, muuda selle väidet.

`server/prosopography/router.py`, `prosopography_update` — lisa `except ValueError as e` haru `conflict:` kontrolli JÄRELE:

```python
        if msg == "legacy_biography_changed":
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "stale_form",
                    "message": "Vorm on aegunud (väli `biography` on skeemist eemaldatud). "
                               "Laadi leht uuesti.",
                },
            )
```

- [ ] **Step 4: Käivita testid ja veendu, et need läbivad**

Run: `.venv/bin/pytest tests/test_prosopo_legacy_biography.py -q`
Expected: PASS (4 testi)

- [ ] **Step 5: Commit**

```bash
git add server/prosopography/person_crud.py server/prosopography/router.py \
        tests/test_prosopo_legacy_biography.py
git commit -m "feat(prosopo): pärandvälja reegel ja ankru pop kirjutusteel"
```

---

### Task 7: Vananemisankur — kirjutatakse AINULT selgesõnalisel kinnitusel

Ankur on **kinnituse kirje**, mitte salvestamise kõrvalmõju. Ilma märkeruuduta ei muutu ta
kunagi — ka siis mitte, kui `biography_en` muutus.

**Files:**
- Modify: `server/prosopography/person_crud.py` (`update_person`)
- Test: `tests/test_prosopo_translation_anchor.py`

**Interfaces:**
- Consumes: Task 6 — `update_person`, `ANCHOR_OF`, `ANCHOR_SOURCE`, `text_hash`
- Produces:
  - PUT-keha ajutine võti `_confirm_translation: List[str]` — sihtvälja nimede loend
    (`"biography_en"` tähendab „kinnita, et `biography_en` vastab `biography_et`-le").
    Võti popitakse ega jõua kaardile.
  - `update_person` viskab `ValueError("confirm_without_source")`, kui kinnitatakse tühja
    lähteteksti vastu; router → 400.

- [ ] **Step 1: Kirjuta kukkuvad testid**

```python
"""Ankur on KINNITUSE kirje, mitte salvestamise kõrvalmõju (spekk, otsus 5).

Kui ankur uueneks iga EN-välja muudatusega, kustutaks kirjavea parandus
hoiatuse ka siis, kui ET-s muutus vahepeal sünniaasta.
"""
import json
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.prosopography import person_crud  # noqa: E402
from server.prosopo_biography_fields import (  # noqa: E402
    BIOGRAPHY_EN, BIOGRAPHY_ET, SRC_EN, SRC_ET, text_hash,
)

ET_TEKST = "Eestikeelne elulugu."
EN_TEKST = "English biography."


@pytest.fixture
def kaart(tmp_path, monkeypatch):
    salvestatud = {}
    seis = {
        "id": "vutt:Pabc", "updated_at": "2026-09-10T10:00:00+00:00",
        "name": {"label": "Test"},
        BIOGRAPHY_ET: ET_TEKST, BIOGRAPHY_EN: EN_TEKST,
        SRC_ET: None, SRC_EN: None,
    }
    monkeypatch.setattr(person_crud, "get_person", lambda pid: dict(seis))
    monkeypatch.setattr(person_crud, "_id_to_path", lambda pid: str(tmp_path / "abc.json"))
    monkeypatch.setattr(person_crud.state, "save_with_git",
                        lambda path, content, username, message=None, **kw:
                        salvestatud.update(person=json.loads(content)))
    monkeypatch.setattr(person_crud, "_indices", lambda: type(
        "I", (), {"_update_index_entry": staticmethod(lambda p: None),
                  "_update_aliases_entry": staticmethod(lambda p: None)})())
    salvestatud["seis"] = seis
    return salvestatud


def _payload(**extra):
    return {"updated_at": "2026-09-10T10:00:00+00:00", **extra}


def test_kinnitus_kirjutab_ankru_teise_keele_rasiga(kaart):
    person_crud.update_person(
        "vutt:Pabc", _payload(_confirm_translation=[BIOGRAPHY_EN]), "kasutaja")
    ankur = kaart["person"][SRC_EN]
    assert ankur["hash"] == text_hash(ET_TEKST)      # EN-ankur kannab ET räsi
    assert ankur["at"].startswith("20")
    assert kaart["person"][SRC_ET] is None           # teine ankur puutumata


def test_salvestamine_ilma_kinnituseta_ei_muuda_ankrut(kaart):
    person_crud.update_person(
        "vutt:Pabc", _payload(**{BIOGRAPHY_EN: "Corrected typo in English."}), "kasutaja")
    assert kaart["person"][SRC_EN] is None


def test_ankur_ei_muutu_ka_siis_kui_lahtetekst_muutus(kaart):
    kaart["seis"][SRC_EN] = {"hash": text_hash(ET_TEKST), "at": "2026-09-01T00:00:00+00:00"}
    person_crud.update_person(
        "vutt:Pabc", _payload(**{BIOGRAPHY_ET: "Muudetud eestikeelne tekst."}), "kasutaja")
    # Ankur jääb VANA räsiga → hoiatus tekib. Just see ongi mõte.
    assert kaart["person"][SRC_EN]["hash"] == text_hash(ET_TEKST)


def test_kinnitus_kasutab_SAMAS_paringus_saadetud_uut_lahteteksti(kaart):
    uus_et = "Toimetaja kirjutas eestikeelse teksti ümber."
    person_crud.update_person(
        "vutt:Pabc",
        _payload(**{BIOGRAPHY_ET: uus_et, BIOGRAPHY_EN: "New English.",
                    "_confirm_translation": [BIOGRAPHY_EN]}),
        "kasutaja")
    assert kaart["person"][SRC_EN]["hash"] == text_hash(uus_et)


def test_tuhja_lahteteksti_vastu_ei_saa_kinnitada(kaart):
    kaart["seis"][BIOGRAPHY_ET] = None
    with pytest.raises(ValueError) as exc:
        person_crud.update_person(
            "vutt:Pabc", _payload(_confirm_translation=[BIOGRAPHY_EN]), "kasutaja")
    assert str(exc.value) == "confirm_without_source"


def test_sihtvalja_tuhjendamine_nullib_tema_ankru(kaart):
    kaart["seis"][SRC_EN] = {"hash": text_hash(ET_TEKST), "at": "2026-09-01T00:00:00+00:00"}
    person_crud.update_person("vutt:Pabc", _payload(**{BIOGRAPHY_EN: None}), "kasutaja")
    assert kaart["person"][SRC_EN] is None


def test_confirm_voti_ei_joua_kaardile(kaart):
    person_crud.update_person(
        "vutt:Pabc", _payload(_confirm_translation=[BIOGRAPHY_EN]), "kasutaja")
    assert "_confirm_translation" not in kaart["person"]
```

- [ ] **Step 2: Käivita testid ja veendu, et need kukuvad**

Run: `.venv/bin/pytest tests/test_prosopo_translation_anchor.py -q`
Expected: FAIL — ankur jääb `None`-iks (`test_kinnitus_kirjutab_ankru_teise_keele_rasiga`)

- [ ] **Step 3: Teosta ankru loogika**

`server/prosopography/person_crud.py` — **laienda importi** kolme nimega
(`ANCHOR_OF`, `ANCHOR_SOURCE`, `text_hash`):

```python
from ..prosopo_biography_fields import (
    AA_RAW, ANCHOR_FIELDS, ANCHOR_OF, ANCHOR_SOURCE, BIOGRAPHY_EN, BIOGRAPHY_ET,
    LEGACY_BIOGRAPHY, SRC_EN, SRC_ET, text_hash,
)
```

`update_person` — võta kinnitus VÄLJA enne `person.update(data)`
(samas plokis, kus ankru pop):

```python
        # Kinnitusruut („Vastab eestikeelsele tekstile"). Ajutine võti — kaardile
        # ei jõua. Väärtus on sihtväljade loend: `biography_en` tähendab, et
        # kinnitatakse `biography_en` vastavust `biography_et`-le.
        confirm = data.pop("_confirm_translation", None) or []
```

ja PÄRAST `person["updated_by"] = username` rida (enne `origin` rikastust):

```python
        # Ankur on serveri tuletis: räsi arvutatakse SIIN, salvestatava seisu
        # pealt. Klient räsi ei saada (vt ANCHOR pop ülal).
        for field in (BIOGRAPHY_ET, BIOGRAPHY_EN):
            anchor_field = ANCHOR_OF[field]
            if field in confirm:
                source_text = (person.get(ANCHOR_SOURCE[anchor_field]) or "").strip()
                if not source_text:
                    raise ValueError("confirm_without_source")
                person[anchor_field] = {"hash": text_hash(source_text), "at": now}
            elif not (person.get(field) or "").strip():
                # Tühjaks jäänud tekstil ei ole midagi kinnitada — jäänud ankur
                # tekitaks hoiatuse tekstile, mida ei ole.
                person[anchor_field] = None
```

Router (`prosopography_update`) — lisa `except ValueError` haru:

```python
        if msg == "confirm_without_source":
            raise HTTPException(
                status_code=400,
                detail="Tühja lähteteksti vastu ei saa tõlget kinnitada.")
```

- [ ] **Step 4: Käivita testid ja veendu, et need läbivad**

Run: `.venv/bin/pytest tests/test_prosopo_translation_anchor.py tests/test_prosopo_legacy_biography.py -q`
Expected: PASS (11 testi)

- [ ] **Step 5: Commit**

```bash
git add server/prosopography/person_crud.py server/prosopography/router.py \
        tests/test_prosopo_translation_anchor.py
git commit -m "feat(prosopo): vananemisankur kirjutatakse ainult selgesõnalisel kinnitusel"
```

---
### Task 8: Ühendamine — kolm välja, ankrud nulli

Kahtluse korral `null`: kaotatud kinnitus on üks märkeruudu vajutus, vale kinnitus on
vaikne viga (spekk, otsus 7).

**Files:**
- Modify: `server/prosopography/merge_ops.py:~105` (`if source.get("biography") …` plokk)
- Test: `tests/test_prosopo_merge_biography.py`

**Interfaces:**
- Consumes: Task 1 — `TEXT_FIELDS`, `ANCHOR_FIELDS`, `BIOGRAPHY_ET`, `BIOGRAPHY_EN`, `SRC_ET`, `SRC_EN`
- Produces: `_merge_person_locked` käitumine; avalikku signatuuri ei muuda

- [ ] **Step 1: Kirjuta kukkuvad testid**

```python
"""Ühendamisel ankur EI kandu kaasa (spekk, otsus 7).

Kui allikast kopeeritakse EN-elulugu, aga sihtmärgil on juba TEISTSUGUNE
ET-elulugu, väidaks kaasa kandunud ankur vastavust, mida keegi ei ole kunagi
kinnitanud.
"""
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.prosopography.merge_ops import _merge_biography_fields  # noqa: E402
from server.prosopo_biography_fields import (  # noqa: E402
    AA_RAW, BIOGRAPHY_EN, BIOGRAPHY_ET, SRC_EN, SRC_ET,
)

ANKUR = {"hash": "abc123abc123", "at": "2026-09-01T00:00:00+00:00"}


def test_allikas_taidab_ainult_tuhja_sihtvalja():
    source = {BIOGRAPHY_ET: "Allika ET", BIOGRAPHY_EN: "Source EN", AA_RAW: "154. AA"}
    target = {BIOGRAPHY_ET: "Sihtmärgi ET"}
    muutus = _merge_biography_fields(source, target)
    assert muutus is True
    assert target[BIOGRAPHY_ET] == "Sihtmärgi ET"     # ei kirjuta üle
    assert target[BIOGRAPHY_EN] == "Source EN"
    assert target[AA_RAW] == "154. AA"


def test_ankur_nullitakse_kui_ainult_uks_vali_tuli_allikast():
    source = {BIOGRAPHY_EN: "Source EN", SRC_EN: ANKUR}
    target = {BIOGRAPHY_ET: "Sihtmärgi ET", SRC_ET: ANKUR}
    _merge_biography_fields(source, target)
    assert target[SRC_EN] is None
    assert target[SRC_ET] is None


def test_ankur_kandub_kui_MOLEMAD_valjad_tulid_samalt_kaardilt_tuhjale():
    source = {BIOGRAPHY_ET: "Allika ET", BIOGRAPHY_EN: "Source EN", SRC_EN: ANKUR}
    target = {}
    _merge_biography_fields(source, target)
    assert target[SRC_EN] == ANKUR
    assert target[SRC_ET] is None       # allikal seda ei olnud


def test_ankur_ei_kandu_kui_sihtmargil_oli_uks_valjadest():
    source = {BIOGRAPHY_ET: "Allika ET", BIOGRAPHY_EN: "Source EN", SRC_EN: ANKUR}
    target = {BIOGRAPHY_ET: "Sihtmärgi ET"}
    _merge_biography_fields(source, target)
    assert target[SRC_EN] is None


def test_tuhjade_kaartide_liitmine_ei_marki_muutust():
    target = {}
    assert _merge_biography_fields({}, target) is False
```

- [ ] **Step 2: Käivita testid ja veendu, et need kukuvad**

Run: `.venv/bin/pytest tests/test_prosopo_merge_biography.py -q`
Expected: FAIL — `ImportError: cannot import name '_merge_biography_fields'`

- [ ] **Step 3: Asenda `biography` plokk `merge_ops.py`-s**

Lisa import faili algusesse:

```python
from ..prosopo_biography_fields import ANCHOR_FIELDS, BIOGRAPHY_EN, BIOGRAPHY_ET, TEXT_FIELDS
```

Kustuta:

```python
    if source.get("biography") and not target.get("biography"):
        target["biography"] = source["biography"]
        target_changed = True
```

Lisa mooduli tasemele uus funktsioon (testitav ilma failisüsteemita):

```python
def _merge_biography_fields(source: dict, target: dict) -> bool:
    """Kolm tekstivälja + ankrud. Tagastab, kas sihtmärk muutus.

    Tekstiväljad: tavaline „allikas täidab ainult tühja sihtvälja" reegel.
    Ankrud: pärast ühendamist on MÕLEMAD `None`, välja arvatud kui mõlemad
    keeleväljad tulid samalt kaardilt tühjale sihtmärgile. Kahtluse korral
    `None` — kaotatud kinnitus on üks märkeruudu vajutus, vale kinnitus on
    vaikne viga (ADR 0039).
    """
    # Seis ENNE kopeerimist: pärast on mõlemad väljad täidetud ja tingimust
    # ei saaks enam hinnata.
    sihil_oli_elulugu = bool(target.get(BIOGRAPHY_ET)) or bool(target.get(BIOGRAPHY_EN))

    changed = False
    for field in TEXT_FIELDS:
        if source.get(field) and not target.get(field):
            target[field] = source[field]
            changed = True

    molemad_allikast = (
        not sihil_oli_elulugu
        and bool(source.get(BIOGRAPHY_ET))
        and bool(source.get(BIOGRAPHY_EN))
    )
    for anchor in ANCHOR_FIELDS:
        uus = source.get(anchor) if molemad_allikast else None
        if target.get(anchor) != uus:
            changed = True
        # Seatakse ALATI: skeem hoiab mõlemat ankrut olemas (person_crud
        # `create_person`), ja puuduv võti annaks lugejale KeyError'i.
        target[anchor] = uus

    return changed
```

ja kutsu teda `_merge_person_locked`-is samas kohas, kus vana plokk oli:

```python
    if _merge_biography_fields(source, target):
        target_changed = True
```

- [ ] **Step 4: Käivita testid ja veendu, et need läbivad**

Run: `.venv/bin/pytest tests/test_prosopo_merge_biography.py tests/test_prosopography_ops.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/prosopography/merge_ops.py tests/test_prosopo_merge_biography.py
git commit -m "feat(prosopo): ühendamine kolme tekstivälja ja ankru nullimisega"
```

---

### Task 9: Ankrud ajaloost välja, AA-rikastus ja SEO-prerender

Kolm väikest, kuid kohustuslikku parandust. **`metadata_handler.py` on kohustuslik:** ilma
selleta saaks 308 kaardi SEO-kirjelduseks AA-toorik ja 63 proosalugu kaoks Google'i eest.

**Files:**
- Modify: `server/prosopography/git_history.py:5`
- Modify: `server/prosopography/enrichment.py:721`
- Modify: `server/metadata_handler.py:559`
- Test: `tests/test_prosopo_biography_touchpoints.py`

**Interfaces:**
- Consumes: Task 1 — `AA_RAW`, `BIOGRAPHY_ET`, `BIOGRAPHY_EN`, `ANCHOR_FIELDS`
- Produces: —

- [ ] **Step 1: Kirjuta kukkuvad testid**

```python
"""Kolm puutepunkti, mille vahelejätmine annab vaikse vea."""
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.prosopography.git_history import _DIFF_IGNORED_FIELDS, compute_person_diff  # noqa: E402
from server.prosopo_biography_fields import AA_RAW, BIOGRAPHY_EN, BIOGRAPHY_ET, SRC_EN, SRC_ET  # noqa: E402


def test_ankrud_ei_tekita_ajaloos_mura():
    assert SRC_ET in _DIFF_IGNORED_FIELDS
    assert SRC_EN in _DIFF_IGNORED_FIELDS
    muutused = compute_person_diff(
        {SRC_EN: None, BIOGRAPHY_EN: "sama"},
        {SRC_EN: {"hash": "abc", "at": "x"}, BIOGRAPHY_EN: "sama"})
    assert muutused == []


def test_keeleväljad_ilmuvad_ajalukku_ilma_lisakoodita():
    muutused = compute_person_diff({BIOGRAPHY_ET: "vana"}, {BIOGRAPHY_ET: "uus"})
    assert [m["field"] for m in muutused] == [BIOGRAPHY_ET]


def test_aa_rikastus_kirjutab_aa_raw_valja(monkeypatch):
    # `_fetch_aa` (enrichment.py:650) loeb korpuse `_load_aa()` kaudu ja otsib
    # kirje `entry_number` järgi — testime kaardistust võltsitud korpusega.
    from server.prosopography import enrichment
    monkeypatch.setattr(enrichment, "_load_aa", lambda: [{
        "entry_number": 154,
        "person": {"name": {"full": "Lünaeus, Emundus"}},
        "raw_text": "154. Lünaeus, Emundus.",
    }])
    tulem = enrichment._fetch_aa("AA:154")
    assert tulem[AA_RAW] == "154. Lünaeus, Emundus."
    assert "biography" not in tulem


def test_seo_kirjeldus_votab_eluloo_mitte_aa_kirje():
    from server.metadata_handler import _person_biography_text
    assert _person_biography_text({AA_RAW: "154. AA", BIOGRAPHY_ET: "Elulugu."}) == "Elulugu."
    # ET puudub → EN; AA ei ole KUNAGI eluloo varuvariant.
    assert _person_biography_text({AA_RAW: "154. AA", BIOGRAPHY_EN: "Life."}) == "Life."
    assert _person_biography_text({AA_RAW: "154. AA"}) == ""
```

> **Eelkontrolli otsus R5 (kontrollitud koodis):** plaani varasem mustand kutsus
> funktsiooni `_aa_entry_to_result`, mida **ei eksisteeri**. Tegelik funktsioon on
> **`_fetch_aa(aa_id: str) -> Optional[dict]`** (`enrichment.py:650`); rida 721 on
> selle sees. `_fetch_aa` võtab AA-numbri (`"AA:154"`), laeb korpuse `_load_aa()`
> kaudu ja otsib kirje `entry_number` järgi — seepärast patchib test `_load_aa`-d.
> **Ära tõsta kaardistust eraldi funktsiooni** — muudetakse ainult rida 721.

- [ ] **Step 2: Käivita testid ja veendu, et need kukuvad**

Run: `.venv/bin/pytest tests/test_prosopo_biography_touchpoints.py -q`
Expected: FAIL — `SRC_ET not in _DIFF_IGNORED_FIELDS`

- [ ] **Step 3: Tee kolm parandust**

`server/prosopography/git_history.py`:

```python
from ..prosopo_biography_fields import SRC_EN, SRC_ET

_DIFF_IGNORED_FIELDS = frozenset({
    "updated_at", "updated_by", "created_at", "created_by",
    "schema_version", "import_batch_ids", "id",
    # Ankrud on serveri tuletis ja muutuvad igal kinnitusel — ajaloos on need müra.
    SRC_ET, SRC_EN,
})
```

`server/prosopography/enrichment.py:721` (funktsiooni `_fetch_aa` sees) — asenda
`result["biography"] = raw`:

```python
            result[AA_RAW] = raw
```

(lisa faili algusesse `from ..prosopo_biography_fields import AA_RAW`)

**Sama võtit loevad KOLM tarbijat — kõik peavad kaasa tulema.** `_fetch_aa` tulemus
jõuab `fetch_and_diff` kaudu nii vormi kui kahte admin-skripti. Kontrollitud grepiga
(kontroller, 2026-09-10):

| Tarbija | Koht | Kes muudab |
|---|---|---|
| Vormi autotäide | `helpers.ts:102`, `EnrichExistingSection.tsx:33` | **ülesanne 18** |
| `scripts/match_aa_duplicates.py` | rida 117–118 | **SIIN, ülesanne 9** |
| `scripts/match_comma_duplicates.py` | rida 107–108 | **SIIN, ülesanne 9** |

Mõlemas skriptis on sama plokk — asenda:

```python
    # Biograafia — ainult kui tühi
    if auto_filled.get("biography") and not (p.get("biography") or "").strip():
        p["biography"] = auto_filled["biography"]
```

sellega:

```python
    # AA-toorik — ainult kui tühi. Võti on `aa_raw`, mitte `biography` (ADR 0039):
    # AA `raw_text` on KIRJE, mitte elulugu.
    if auto_filled.get(AA_RAW) and not (p.get(AA_RAW) or "").strip():
        p[AA_RAW] = auto_filled[AA_RAW]
```

(mõlemas skriptis ka import — need kasutavad juba `sys.path` juurehäkki, nii et
`from server.prosopo_biography_fields import AA_RAW` töötab)

> **Miks see on kohustuslik, mitte kena:** skriptid loevad `auto_filled.get("biography")`
> võtit, mida `_fetch_aa` pärast seda ülesannet enam ei tagasta. Ilma paranduseta ei anna
> nad viga — nad lakkavad vaikselt elulugu kopeerimast. Täpselt see vaikne no-op, mille
> vastu `feedback_vaikne_fallback_ahel` hoiatab.

Testid `tests/test_match_aa_duplicates.py:61-69,154-156` kinnitavad täna vana võtit —
uuenda nende väited `aa_raw` peale. Ära kustuta teste.

`server/metadata_handler.py` — lisa mooduli tasemele:

```python
def _person_biography_text(person: dict) -> str:
    """Isiku elulugu SEO-kirjelduse jaoks. AA-toorik EI OLE eluloo varuvariant.

    Bot-tee on läbivalt eestikeelne (vt spekk, lahtine punkt 1) — seepärast
    eelistame `biography_et`-d. AA-kirje on struktureeritud allikakirje, mille
    esitamine lehe kirjeldusena annaks 308 kaardile loetamatu snippet'i.
    """
    return (person.get(BIOGRAPHY_ET) or person.get(BIOGRAPHY_EN) or "")
```

ja asenda rida 559:

```python
    biography = _strip_html_tags(_person_biography_text(person))
```

(lisa import `from .prosopo_biography_fields import BIOGRAPHY_EN, BIOGRAPHY_ET`)

- [ ] **Step 4: Käivita testid ja veendu, et need läbivad**

Run: `.venv/bin/pytest tests/test_prosopo_biography_touchpoints.py -q && .venv/bin/pytest tests/ -q`
Expected: PASS; kogu pakett roheline

- [ ] **Step 5: Commit**

```bash
git add server/prosopography/git_history.py server/prosopography/enrichment.py \
        server/metadata_handler.py tests/test_prosopo_biography_touchpoints.py \
        scripts/match_aa_duplicates.py scripts/match_comma_duplicates.py \
        tests/test_match_aa_duplicates.py
git commit -m "feat(prosopo): ankrud ajaloost välja, AA-rikastus ja SEO-kirjeldus uutele väljadele"
```

---
### Task 10: Olekuta tõlkeklient (`server/text_translate.py`)

Sisse tekst + keeled, välja tekst + normaliseeritud usage. Ei impordi prosopograafiat,
ei loe faile, ei tea ankrust midagi.

> **Mockitud leping ei ole leping** (Gemini faas A õppetund). Seetõttu EI kirjuta see
> moodul oma vastuseparserit: ta taaskasutab `ocr_providers/gemini.py` omi, mis on
> **elava API vastu mõõdetud** (2026-09-01, vt `_extract_text` docstring). Testi mock
> kasutab sama kuju: ülemisel tasemel `steps`, sees `type: "model_output"` ja
> `content: [{"type": "text", "text": …}]`.

**Files:**
- Create: `server/text_translate.py`
- Modify: `server/config.py` (~rida 297, GEMINI plokk)
- Test: `tests/test_text_translate.py`

**Interfaces:**
- Consumes: `server.ocr_providers.gemini` — `API_URL`, `_api_key`, `_error_status`, `_error_summary`, `_extract_text`, `_normalize_usage`, `CONTENT_BLOCKED`
- Produces:
  - `class TranslateError(Exception)`
  - `SUPPORTED_LANGS: tuple` = `("et", "en")`
  - `MAX_INPUT_CHARS: int` = `50000`
  - `translate(text: str, source_lang: str, target_lang: str) -> Tuple[str, Dict[str, int]]`
- Config: `GEMINI_TRANSLATE_MODEL = env("GEMINI_TRANSLATE_MODEL", "gemini-3.8-flash")`

- [ ] **Step 1: Kirjuta kukkuvad testid**

```python
"""Olekuta tõlkeklient. Vastuse kuju on `ocr_providers/gemini.py` oma —
ELAVA API vastu mõõdetud 2026-09-01, mitte välja mõeldud.
"""
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server import text_translate  # noqa: E402
from server.text_translate import MAX_INPUT_CHARS, TranslateError, translate  # noqa: E402


def _vastus(tekst, status=200):
    """Gemini 200-vastuse kuju: ülemisel tasemel `steps`, mitte `output`."""
    resp = MagicMock()
    resp.status_code = status
    resp.json.return_value = {
        "steps": [
            {"type": "thought", "signature": "EI TOHI VÄLJUNDISSE JÕUDA"},
            {"type": "model_output", "content": [{"type": "text", "text": tekst}]},
        ],
        "usage": {"total_input_tokens": 120, "total_output_tokens": 200,
                  "total_tokens": 320},
    }
    return resp


def test_tolge_tagastab_teksti_ja_normaliseeritud_usage():
    with patch.object(text_translate.requests, "post", return_value=_vastus("English biography.")), \
         patch.object(text_translate, "_api_key", return_value="VOTI"):
        tekst, usage = translate("Eestikeelne elulugu.", "et", "en")
    assert tekst == "English biography."
    assert usage["input_tokens"] == 120
    assert usage["output_tokens"] == 200


def test_mottekaigu_signature_ei_joua_valjundisse():
    with patch.object(text_translate.requests, "post", return_value=_vastus("Life.")), \
         patch.object(text_translate, "_api_key", return_value="VOTI"):
        tekst, _ = translate("Elu.", "et", "en")
    assert "SIGNATURE" not in tekst.upper()


def test_tuhi_mudelivastus_on_viga_mitte_tuhi_tolge():
    # OCR-is on tühi väljund KEHTIV tulemus (ADR 0025); tõlkes EI OLE.
    with patch.object(text_translate.requests, "post", return_value=_vastus("   ")), \
         patch.object(text_translate, "_api_key", return_value="VOTI"):
        with pytest.raises(TranslateError):
            translate("Elu.", "et", "en")


def test_tuhi_sisend_ei_tee_mudelikutset():
    with patch.object(text_translate.requests, "post") as post:
        with pytest.raises(TranslateError):
            translate("   \n ", "et", "en")
    post.assert_not_called()


def test_pikkuspiiri_ületav_sisend_ei_tee_mudelikutset():
    with patch.object(text_translate.requests, "post") as post:
        with pytest.raises(TranslateError) as exc:
            translate("x" * (MAX_INPUT_CHARS + 1), "et", "en")
    post.assert_not_called()
    assert "50000" in str(exc.value) or str(MAX_INPUT_CHARS) in str(exc.value)


def test_samad_keeled_on_viga():
    with pytest.raises(TranslateError):
        translate("Elu.", "et", "et")


def test_tundmatu_keel_on_viga():
    with pytest.raises(TranslateError):
        translate("Elu.", "et", "de")


def test_sisufiltri_keeldumine_kannab_masinloetavat_prefiksit():
    resp = MagicMock()
    resp.status_code = 400
    resp.json.return_value = {"error": {"code": 400, "status": "content_blocked",
                                        "message": "safe coding"}}
    with patch.object(text_translate.requests, "post", return_value=resp), \
         patch.object(text_translate, "_api_key", return_value="VOTI"):
        with pytest.raises(TranslateError) as exc:
            translate("Elu.", "et", "en")
    assert str(exc.value).startswith("content_blocked")


def test_veasõnum_ei_sisalda_votit_ega_vastuse_keha():
    resp = MagicMock()
    resp.status_code = 500
    resp.json.return_value = {"error": {"code": 500, "status": "INTERNAL",
                                        "message": "boom"}}
    with patch.object(text_translate.requests, "post", return_value=resp), \
         patch.object(text_translate, "_api_key", return_value="SALAJANE-VOTI"), \
         patch.object(text_translate, "GEMINI_MAX_RETRIES", 0):
        with pytest.raises(TranslateError) as exc:
            translate("Elu.", "et", "en")
    assert "SALAJANE-VOTI" not in str(exc.value)
```

- [ ] **Step 2: Käivita testid ja veendu, et need kukuvad**

Run: `.venv/bin/pytest tests/test_text_translate.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'server.text_translate'`

- [ ] **Step 3: Lisa config-kirje ja kirjuta moodul**

`server/config.py`, GEMINI ploki lõppu (~rida 307):

```python
# Tõlkemudel omas env-nimes (ADR 0021: üks nimi ühe seade kohta). Võti, timeout
# ja korduste arv jagatakse OCR-poolega — need on pakkuja, mitte kasutuskoha seaded.
GEMINI_TRANSLATE_MODEL = env("GEMINI_TRANSLATE_MODEL", "gemini-3.8-flash")
```

`server/text_translate.py`:

```python
"""Olekuta tekstitõlge. Sisse tekst + keeled, välja tekst + normaliseeritud usage.

Ei impordi prosopograafiat, ei loe faile, ei tea ankrust midagi — sama vaim kui
`ocr_providers/gemini.py`.

Vastuseparserit siin EI OLE: `_extract_text`, `_normalize_usage`, `_error_status`
ja `_error_summary` tulevad `ocr_providers.gemini`-st, sest need on ELAVA API
vastu mõõdetud. Kaks koopiat lahkneksid vaikselt, kui Google API kuju muudab
(mida ta on juba korra teinud).
"""
from __future__ import annotations

import time
from typing import Dict, Tuple

import requests

from .config import (
    GEMINI_MAX_RETRIES, GEMINI_REQUEST_TIMEOUT, GEMINI_THINKING_LEVEL,
    GEMINI_TRANSLATE_MODEL, get_logger,
)
from .ocr_providers.gemini import (
    API_URL, CONTENT_BLOCKED, _api_key, _error_status, _error_summary,
    _extract_text, _normalize_usage,
)

logger = get_logger(__name__)


class TranslateError(Exception):
    """Kasutajale näidatav viga. Sõnum EI TOHI sisaldada võtit ega vastuse keha."""


SUPPORTED_LANGS = ("et", "en")
# Pikim olemasolev elulugu on 30 590 märki (mõõdetud 2026-09-10). Piir on selge
# viga, mitte vaikne lõikamine.
MAX_INPUT_CHARS = 50000

_LANG_NAMES = {"et": "eesti keelest", "en": "inglise keelest"}
_LANG_TO = {"et": "eesti keelde", "en": "inglise keelde"}

JUHIS = (
    "Tõlgi järgnev ajalooline elulookirjeldus {}{}.\n"
    "- Säilita Markdowni struktuur ja linkide sihtaadressid.\n"
    "- Kuupäevadel säilita tähendus ja täpsus; vorm kohandub sihtkeelele "
    "(„20. septembril 1634\" → „20 September 1634\"). Ligikaudsus jääb ligikaudsuseks.\n"
    "- Isiku- ja kohanimed jäävad allikas kirjutatud kujule — ei tõlgita ega "
    "moderniseerita.\n"
    "- Allikatsitaadid (jutumärkides või ploktsitaadis) jäävad tõlkimata.\n"
    "- Ära lisa midagi juurde. Tagasta ainult tõlge."
)


def _build_instruction(source_lang: str, target_lang: str) -> str:
    return JUHIS.format(_LANG_NAMES[source_lang], " " + _LANG_TO[target_lang])


def _validate(text: str, source_lang: str, target_lang: str) -> str:
    if source_lang not in SUPPORTED_LANGS or target_lang not in SUPPORTED_LANGS:
        raise TranslateError(
            "Toetatud keeled: {}".format(", ".join(SUPPORTED_LANGS)))
    if source_lang == target_lang:
        raise TranslateError("Lähte- ja sihtkeel peavad erinema")
    sisu = (text or "").strip()
    if not sisu:
        raise TranslateError("Tõlgitav tekst on tühi")
    if len(sisu) > MAX_INPUT_CHARS:
        raise TranslateError(
            "Tekst on liiga pikk: {} märki, lubatud {}".format(
                len(sisu), MAX_INPUT_CHARS))
    return sisu


def translate(text: str, source_lang: str, target_lang: str) -> Tuple[str, Dict[str, int]]:
    """Tekst + keeled → (tõlge, normaliseeritud usage). Viskab `TranslateError`-i.

    BLOKEERIV — kutsuja peab olema sünkroonne `def` route või `run_in_threadpool`
    (ADR 0002).
    """
    sisu = _validate(text, source_lang, target_lang)
    payload = {
        "model": GEMINI_TRANSLATE_MODEL,
        "store": False,                  # vaikimisi True — tekst ei tohi Google'isse jääda
        # `thinking_level` PEAB olema `generation_config` sees; ülemisel tasemel
        # annab API 400 „Unknown parameter" (mõõdetud 2026-09-01).
        "generation_config": {"thinking_level": GEMINI_THINKING_LEVEL},
        "input": [
            {"type": "text", "text": _build_instruction(source_lang, target_lang)},
            {"type": "text", "text": sisu},
        ],
    }
    headers = {"x-goog-api-key": _api_key(), "Content-Type": "application/json"}

    viimane = ""
    for katse in range(GEMINI_MAX_RETRIES + 1):
        try:
            response = requests.post(API_URL, json=payload, headers=headers,
                                     timeout=GEMINI_REQUEST_TIMEOUT)
        except requests.RequestException as e:
            viimane = "ühenduse viga: {}".format(type(e).__name__)
            logger.warning("Tõlkepäring ebaõnnestus: %s", viimane)
        else:
            if response.status_code == 200:
                try:
                    data = response.json()
                except ValueError as e:
                    raise TranslateError(
                        "Tõlkevastus (200) ei ole loetav JSON: {}".format(type(e).__name__))
                tolge = (_extract_text(data) or "").strip()
                if not tolge:
                    # Erinevalt OCR-ist (ADR 0025) EI OLE tühi tõlge kehtiv
                    # tulemus — tühi kast vormis näeks välja nagu õnnestunud töö.
                    raise TranslateError("Tõlkemudel tagastas tühja vastuse")
                return tolge, _normalize_usage(data.get("usage"))
            viimane = _error_summary(response)
            logger.warning("Tõlkepäring ebaõnnestus: %s", viimane)
            if _error_status(response) == CONTENT_BLOCKED:
                # Masinloetav prefiks — UI renderdab lugeja keeles suunava lause
                # (ADR 0033, #292 muster).
                raise TranslateError(
                    "{}: Gemini sisufilter keeldus sellest tekstist".format(CONTENT_BLOCKED))
            if response.status_code not in (429, 500, 502, 503, 504):
                break
        if katse < GEMINI_MAX_RETRIES:
            time.sleep(2 ** katse)
    raise TranslateError("Tõlkepäring ebaõnnestus: {}".format(viimane))


__all__ = ["TranslateError", "SUPPORTED_LANGS", "MAX_INPUT_CHARS", "translate"]
```

- [ ] **Step 4: Käivita testid ja veendu, et need läbivad**

Run: `.venv/bin/pytest tests/test_text_translate.py -q`
Expected: PASS (9 testi)

> Kui `test_veasõnum_ei_sisalda_votit_ega_vastuse_keha` kukub `GEMINI_MAX_RETRIES`
> patchimise taha (moodulitasandi konstant on juba imporditud), patchi selle asemel
> `text_translate.GEMINI_MAX_RETRIES` — moodul impordib väärtuse `from .config import`,
> nii et nimi ELAB `text_translate` nimeruumis ja on sealt patchitav.

- [ ] **Step 5: Commit**

```bash
git add server/text_translate.py server/config.py tests/test_text_translate.py
git commit -m "feat(tõlge): olekuta tekstitõlke klient Gemini kaudu"
```

---
### Task 11: `POST /prosopography/translate`

Olekuta endpoint: kaardifaili ei avata, git-i ei commitita, lukku ei võeta.
Rate-limit **kasutajanime**, mitte IP järgi.

> **Kõrvalekalle spekist (üks lause, siis edasi):** spekk ütleb „sünkroonne `def`
> route". Selles koodibaasis EI OLE ühtki `Body(...)`/pydantic-sidumist — kõik
> keha-lugevad route'id on `async def` + `_get_json(request)`. Sünkroonne `def` ei
> saaks keha kätte. Teostame `async def` + `await run_in_threadpool(translate, …)`:
> ADR 0002 nõue („blokeeriv pakkujakutse ei jookse event-loopis") on täidetud ja
> kuju on sama mis olemasoleval `prosopography_update`-l.

**Files:**
- Modify: `server/prosopography/router.py` (uus route ENNE rida 791)
- Modify: `server/config.py:274` (`RATE_LIMITS`)
- Test: `tests/test_prosopo_translate_endpoint.py`

**Interfaces:**
- Consumes: Task 10 — `translate`, `TranslateError`, `SUPPORTED_LANGS`
- Produces: `POST /prosopography/translate`
  - keha: `{"source_lang": "et", "target_lang": "en", "text": "..."}`
  - vastus: `{"status": "ok", "text": "...", "usage": {...}}`
  - 401 puuduv/madal roll · 400 valideerimine · 429 rate-limit · 502 pakkuja viga
- Config: `'/prosopography/translate': (60, 3600)`

- [ ] **Step 1: Kirjuta kukkuvad testid**

```python
"""Tõlke-endpoint: roll, valideerimine, rate-limit kasutaja järgi.

Rate-limit EI TOHI olla IP-põhine: ülikooli pöördproksi tõttu jõuavad eri
kliendid serverini sama IP-ga (vt `config.py` kommentaar) — IP-võti tähendaks
ühist eelarvet kõigile toimetajatele.
"""
import sys
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


@pytest.fixture
def client():
    from server.main import app
    return TestClient(app)


def _keha(**extra):
    return {"source_lang": "et", "target_lang": "en", "text": "Elulugu.", **extra}


def test_contributor_ei_paase_ligi(client, contributor_token):
    resp = client.post("/prosopography/translate", json=_keha(),
                       headers={"Authorization": f"Bearer {contributor_token}"})
    assert resp.status_code == 401


def test_editor_saab_tolke(client, editor_token):
    with patch("server.prosopography.router.translate",
               return_value=("English biography.", {"total_tokens": 320})):
        resp = client.post("/prosopography/translate", json=_keha(),
                           headers={"Authorization": f"Bearer {editor_token}"})
    assert resp.status_code == 200
    assert resp.json()["text"] == "English biography."


def test_samad_keeled_annavad_400(client, editor_token):
    resp = client.post("/prosopography/translate", json=_keha(target_lang="et"),
                       headers={"Authorization": f"Bearer {editor_token}"})
    assert resp.status_code == 400


def test_pakkuja_viga_annab_502_ilma_sisemise_infota(client, editor_token):
    from server.text_translate import TranslateError
    with patch("server.prosopography.router.translate",
               side_effect=TranslateError("Tõlkepäring ebaõnnestus: HTTP 500 INTERNAL")):
        resp = client.post("/prosopography/translate", json=_keha(),
                           headers={"Authorization": f"Bearer {editor_token}"})
    assert resp.status_code == 502
    assert "Tõlkepäring ebaõnnestus" in resp.json()["detail"]


def test_rate_limit_kaib_kasutajanime_mitte_ip_jargi(client, editor_token):
    nahtud = []

    def _fake(key, endpoint):
        nahtud.append((key, endpoint))
        return False, 42

    with patch("server.prosopography.router.check_rate_limit", side_effect=_fake):
        resp = client.post("/prosopography/translate", json=_keha(),
                           headers={"Authorization": f"Bearer {editor_token}"})
    assert resp.status_code == 429
    assert resp.headers["Retry-After"] == "42"
    key, endpoint = nahtud[0]
    assert endpoint == "/prosopography/translate"
    assert "." not in key          # kasutajanimi, mitte IP-aadress


def test_rate_limit_kirje_on_konfiguratsioonis():
    # Ilma kirjeta laseb `check_rate_limit` tundmatu endpointi PIIRANGUTA läbi
    # (`rate_limit.py:112`) — see test on selle vaikse augu valvur.
    from server.config import RATE_LIMITS
    assert RATE_LIMITS["/prosopography/translate"] == (60, 3600)
```

> **Fikstuurid (kontrollitud `tests/conftest.py`-s — otsus R4):** `editor_token` ja
> `contributor_token` EI OLE olemas. Olemas on `client` (rida 223) ja `login` (rida 228)
> ning seemnekasutajad `editor`/`editorpass` (roll `editor`) ja `contrib`/`contribpass`
> (roll `contributor`). Kirjuta testifaili algusse olemasoleva mustri järgi (vrd
> `tests/test_admin_role_endpoints.py`):
>
> ```python
> @pytest.fixture
> def editor_token(login):
>     return login("editor", "editorpass")
>
>
> @pytest.fixture
> def contributor_token(login):
>     return login("contrib", "contribpass")
> ```
>
> **Ära** lisa neid `conftest.py`-sse ega loo uut auth-fikstuuri — `login` on juba
> ainuõige allikas. `client` fikstuur tuleb `conftest.py`-st automaatselt; kustuta
> plaani testifailist oma `client` fikstuuri definitsioon ja kasuta seda.

- [ ] **Step 2: Käivita testid ja veendu, et need kukuvad**

Run: `.venv/bin/pytest tests/test_prosopo_translate_endpoint.py -q`
Expected: FAIL — 404 (route puudub) ja `KeyError: '/prosopography/translate'`

- [ ] **Step 3: Lisa config-kirje ja route**

`server/config.py`, `RATE_LIMITS` sisse:

```python
    # Tõlge: võti on KASUTAJANIMI, mitte IP (pöördproksi tõttu jagaksid kõik
    # toimetajad ühte eelarvet). 60 tõlget tunnis kasutaja kohta.
    '/prosopography/translate': (60, 3600),
```

`server/prosopography/router.py` — import ja route. Route läheb faili sinna, kus on
teised konkreetsed teed (nt `/work-titles` järele, ~rida 344), **kindlasti enne**
`GET /{person_id:path}` ja `PUT /{person_id:path}` deklaratsioone:

```python
from ..text_translate import SUPPORTED_LANGS, TranslateError, translate
```

```python
@router.post("/translate")
async def prosopography_translate(
    request: Request,
    user=Depends(_require_role("editor")),
):
    """Tõlgib teksti. OLEKUTA: kaarti ei avata, git-i ei commitita, lukku ei võeta.

    Salvestamine käib tavalist `update_person` teed — teine kirjutaja tähendaks
    teist võimalust optimistlikust konkurentsikontrollist mööda minna (ADR 0039).
    """
    allowed, retry_after = check_rate_limit(
        user["username"], '/prosopography/translate')
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail=f"Liiga palju tõlkepäringuid, proovi uuesti {retry_after}s pärast",
            headers={"Retry-After": str(retry_after)},
        )

    data = await _get_json(request)
    source_lang = (data.get("source_lang") or "").strip()
    target_lang = (data.get("target_lang") or "").strip()
    text = data.get("text") or ""

    try:
        # Blokeeriv pakkujakutse EI TOHI event-loopis joosta (ADR 0002).
        tolge, usage = await run_in_threadpool(translate, text, source_lang, target_lang)
    except TranslateError as e:
        sonum = str(e)
        # Valideerimisvead on kliendi oma (400), pakkuja omad on 502. Eristame
        # SISENDI järgi, mitte veasõnumit parsides — sõnum on inimtekst ja
        # muutub, sisendi kuju on leping.
        sisu = (text or "").strip()
        klient_eksis = (
            source_lang not in SUPPORTED_LANGS
            or target_lang not in SUPPORTED_LANGS
            or source_lang == target_lang
            or not sisu
            or len(sisu) > MAX_INPUT_CHARS
        )
        raise HTTPException(status_code=400 if klient_eksis else 502, detail=sonum)

    return {"status": "ok", "text": tolge, "usage": usage}
```

Ülemine import (üks rida, sisaldab ka `MAX_INPUT_CHARS`-i):

```python
from ..text_translate import MAX_INPUT_CHARS, SUPPORTED_LANGS, TranslateError, translate
```

- [ ] **Step 4: Käivita testid ja veendu, et need läbivad**

Run: `.venv/bin/pytest tests/test_prosopo_translate_endpoint.py -q`
Expected: PASS (6 testi)

- [ ] **Step 5: Commit**

```bash
git add server/prosopography/router.py server/config.py \
        tests/test_prosopo_translate_endpoint.py tests/conftest.py
git commit -m "feat(tõlge): POST /prosopography/translate kasutajapõhise rate-limitiga"
```

---

### Task 12: `GET /{id}/source-diff` — mis lähteversioonis muutus

`GET /{id}/diff` **ei sobi**: too võrdleb commit'i tema vanemaga. Siin otsitakse ajaloost
**värskeim commit, mille lähtevälja räsi võrdub ankru räsiga**.

> **Räsi on ankur, commit ei ole.** Salvestuseelne HEAD ei kõlba: kui toimetaja muudab
> ET-d, tõlgib selle ja salvestab mõlemad korraga, on räsi uuest ET-st, aga HEAD osutaks
> vanale — „vaata, mis muutus" näitaks vale lähteversiooni.

**Files:**
- Modify: `server/prosopography/router.py` (~rida 570, `person_diff` järele)
- Test: `tests/test_prosopo_source_diff.py`

**Interfaces:**
- Consumes: `get_file_git_history`, `get_file_at_commit` (olemas), Task 1 — `ANCHOR_OF`, `ANCHOR_SOURCE`, `text_hash`
- Produces: `GET /prosopography/{id}/source-diff?field=biography_et`
  → `{"found": bool, "commit": Optional[str], "date": Optional[str], "text": Optional[str]}`

- [ ] **Step 1: Kirjuta kukkuvad testid**

```python
"""`source-diff` otsib ajaloost ANKRU RÄSIGA commiti, mitte vanemat.

Kui commiti ei leidu (ajalugu kärbitud 50 commiti peale, kaart taastatud), on
vastus aus `found: false` — mitte vale diff.
"""
import json
import sys
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.prosopo_biography_fields import BIOGRAPHY_EN, BIOGRAPHY_ET, SRC_EN, text_hash  # noqa: E402

VANA_ET = "Vana eestikeelne tekst."
UUS_ET = "Uus eestikeelne tekst."


@pytest.fixture
def client():
    from server.main import app
    return TestClient(app)


def _ajalugu():
    return [
        {"hash": "cccccccc", "full_hash": "cccccccc11", "date": "2026-09-09T00:00:00"},
        {"hash": "bbbbbbbb", "full_hash": "bbbbbbbb11", "date": "2026-09-05T00:00:00"},
        {"hash": "aaaaaaaa", "full_hash": "aaaaaaaa11", "date": "2026-09-01T00:00:00"},
    ]


def _commit_sisu(rel_path, commit):
    tekstid = {"cccccccc11": UUS_ET, "bbbbbbbb11": VANA_ET, "aaaaaaaa11": "Veel vanem."}
    return json.dumps({"id": "vutt:Pabc", BIOGRAPHY_ET: tekstid[commit]})


def test_leiab_ankru_rasiga_commiti(client, editor_token):
    person = {"id": "vutt:Pabc", BIOGRAPHY_ET: UUS_ET, BIOGRAPHY_EN: "English.",
              SRC_EN: {"hash": text_hash(VANA_ET), "at": "2026-09-05T00:00:00+00:00"}}
    with patch("server.prosopography.router.get_person", return_value=person), \
         patch("server.prosopography.router.get_file_git_history", return_value=_ajalugu()), \
         patch("server.prosopography.router.get_file_at_commit", side_effect=_commit_sisu):
        resp = client.get("/prosopography/vutt%3APabc/source-diff",
                          params={"field": BIOGRAPHY_EN},
                          headers={"Authorization": f"Bearer {editor_token}"})
    keha = resp.json()
    assert resp.status_code == 200
    assert keha["found"] is True
    assert keha["text"] == VANA_ET
    assert keha["commit"] == "bbbbbbbb"


def test_ei_leia_annab_ausa_vastuse(client, editor_token):
    person = {"id": "vutt:Pabc", BIOGRAPHY_ET: UUS_ET, BIOGRAPHY_EN: "English.",
              SRC_EN: {"hash": "deadbeefcafe", "at": "2026-01-01T00:00:00+00:00"}}
    with patch("server.prosopography.router.get_person", return_value=person), \
         patch("server.prosopography.router.get_file_git_history", return_value=_ajalugu()), \
         patch("server.prosopography.router.get_file_at_commit", side_effect=_commit_sisu):
        resp = client.get("/prosopography/vutt%3APabc/source-diff",
                          params={"field": BIOGRAPHY_EN},
                          headers={"Authorization": f"Bearer {editor_token}"})
    assert resp.json() == {"found": False, "commit": None, "date": None, "text": None}


def test_ankruta_vali_annab_found_false(client, editor_token):
    person = {"id": "vutt:Pabc", BIOGRAPHY_EN: "English.", SRC_EN: None}
    with patch("server.prosopography.router.get_person", return_value=person):
        resp = client.get("/prosopography/vutt%3APabc/source-diff",
                          params={"field": BIOGRAPHY_EN},
                          headers={"Authorization": f"Bearer {editor_token}"})
    assert resp.json()["found"] is False


def test_tundmatu_vali_annab_400(client, editor_token):
    resp = client.get("/prosopography/vutt%3APabc/source-diff",
                      params={"field": "notes"},
                      headers={"Authorization": f"Bearer {editor_token}"})
    assert resp.status_code == 400


def test_contributor_ei_paase_ligi(client, contributor_token):
    resp = client.get("/prosopography/vutt%3APabc/source-diff",
                      params={"field": BIOGRAPHY_EN},
                      headers={"Authorization": f"Bearer {contributor_token}"})
    assert resp.status_code == 401
```

- [ ] **Step 2: Käivita testid ja veendu, et need kukuvad**

Run: `.venv/bin/pytest tests/test_prosopo_source_diff.py -q`
Expected: FAIL — 404 (route puudub)

- [ ] **Step 3: Lisa route**

`server/prosopography/router.py`, `person_diff` järele (~rida 570):

```python
@router.get("/{person_id:path}/source-diff")
def person_source_diff(person_id: str, field: str, user=Depends(_require_role("editor"))):
    """Ankru-aegne LÄHTETEKST („vaata, mis muutus").

    EI OLE `GET /{id}/diff`: too võrdleb commit'i tema VANEMAGA. Siin käiakse
    ajalugu uuest vanemani läbi ja otsitakse värskeim commit, mille lähtevälja
    räsi võrdub ankru räsiga — nii osutab tulemus alati täpselt sellele tekstile,
    mille räsi ankrus on (ADR 0039).

    Sünkroonne `def`: git-I/O on blokeeriv, FastAPI viib route'i ise threadpooli.
    """
    if field not in ANCHOR_OF:
        raise HTTPException(
            status_code=400,
            detail="Lubatud väljad: {}".format(", ".join(sorted(ANCHOR_OF))))
    try:
        nanoid = _safe_nanoid(person_id)
    except ValueError:
        raise HTTPException(status_code=404, detail=f"Isikut ei leitud: {person_id}")

    person = get_person(person_id)
    if person is None:
        raise HTTPException(status_code=404, detail=f"Isikut ei leitud: {person_id}")

    tyhi = {"found": False, "commit": None, "date": None, "text": None}
    anchor = person.get(ANCHOR_OF[field])
    if not isinstance(anchor, dict) or not anchor.get("hash"):
        return tyhi

    source_field = ANCHOR_SOURCE[ANCHOR_OF[field]]
    relative_path = f"config/prosopography/{nanoid}.json"

    for commit in get_file_git_history(relative_path, max_count=50):
        content = get_file_at_commit(relative_path, commit["full_hash"])
        if not content:
            continue
        try:
            doc = json.loads(content)
        except json.JSONDecodeError:
            continue
        tekst = doc.get(source_field)
        if text_hash(tekst) == anchor["hash"]:
            return {"found": True, "commit": commit["hash"],
                    "date": commit["date"], "text": tekst}

    # Ajalugu kärbitud või kaart taastatud — aus „ei leidnud", mitte vale diff.
    return tyhi
```

Lisa faili algusesse import:

```python
from ..prosopo_biography_fields import ANCHOR_OF, ANCHOR_SOURCE, text_hash
```

- [ ] **Step 4: Käivita testid ja veendu, et need läbivad**

Run: `.venv/bin/pytest tests/test_prosopo_source_diff.py -q && .venv/bin/pytest tests/ -q`
Expected: PASS; kogu pakett roheline

- [ ] **Step 4b: Ümarreisi test — vorm → API → fail → API**

Spekk nõuab eraldi: *„Salvestus → uuestilugemine kogu vorm–API–fail teed pidi."*
Yksiktestid katavad iga tüki, aga mitte seda, et kolm väljanime kannatavad
täisringi välja. Lisa `tests/test_prosopo_biography_roundtrip.py`:

```python
"""Kolm välja + ankur peavad täisringi üle elama: PUT → fail → GET.

Üksiktestid katavad tükid; see katab lepingu. Tüüpiline auk, mille see püüab:
väli, mis kirjutusteel salvestub, aga lugemisteel filtreeritakse välja
(vrd #237 `SECRET_FIELDS`).
"""
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.prosopo_biography_fields import (  # noqa: E402
    AA_RAW, BIOGRAPHY_EN, BIOGRAPHY_ET, SRC_EN, text_hash,
)


@pytest.fixture
def client():
    from server.main import app
    return TestClient(app)


def test_kolm_valja_ja_ankur_elavad_taisringi_ule(client, editor_token, uus_isik):
    """`uus_isik` on fikstuur, mis loob ajutise kaardi ja tagastab (id, updated_at).

    Kui sellist fikstuuri conftest.py-s ei ole, kirjuta see sinna: loo kaart
    `POST /prosopography` kaudu ajutisse PROSOPOGRAPHY_DIR-i (monkeypatch) ja
    koristа see testi lõpus.
    """
    person_id, updated_at = uus_isik
    auth = {"Authorization": f"Bearer {editor_token}"}

    resp = client.put(f"/prosopography/{person_id}", headers=auth, json={
        "updated_at": updated_at,
        BIOGRAPHY_ET: "Eestikeelne elulugu.",
        BIOGRAPHY_EN: "English biography.",
        AA_RAW: "154. Lünaeus, Emundus.",
        "_confirm_translation": [BIOGRAPHY_EN],
    })
    assert resp.status_code == 200

    # Loe UUESTI API kaudu — mitte kirjutuse vastusest, vaid kettalt.
    loetud = client.get(f"/prosopography/{person_id}").json()
    assert loetud[BIOGRAPHY_ET] == "Eestikeelne elulugu."
    assert loetud[BIOGRAPHY_EN] == "English biography."
    assert loetud[AA_RAW] == "154. Lünaeus, Emundus."
    assert loetud[SRC_EN]["hash"] == text_hash("Eestikeelne elulugu.")
    # Ajutine võti EI tohi kaardile jõuda.
    assert "_confirm_translation" not in loetud
    # Pärandvälja ei ole enam.
    assert "biography" not in loetud
```

Run: `.venv/bin/pytest tests/test_prosopo_biography_roundtrip.py -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/prosopography/router.py tests/test_prosopo_source_diff.py \
        tests/test_prosopo_biography_roundtrip.py tests/conftest.py
git commit -m "feat(prosopo): GET /{id}/source-diff otsib ankru räsiga lähteversiooni"
```

---

### Task 13: MCP — mõlemad keeleväljad ja AA eraldi

`get_person` peab tagastama mõlemad keeleväljad **keelemärgistusega** + `aa_raw` eraldi.
Ainult `biography_et` peidaks ingliskeelsena kirjutatud eluloo.

> **MCP EI TOHI importida `server`-it runtime'is** (pipx-venv on isoleeritud) — väljanimed
> kirjutatakse siia stringidena, mitte impordina. Testid tohivad importida.

**Files:**
- Modify: `mcp/vutt_mcp/persons.py:83` (detail) ja `:44` (search)
- Test: `mcp/tests/test_persons.py`

**Interfaces:**
- Consumes: API vastuse uued väljad
- Produces: `_snippet_of(entry: dict) -> str` MCP-poolne katke ahel

- [ ] **Step 1: Kirjuta kukkuvad testid**

```python
# Lisa mcp/tests/test_persons.py lõppu

def test_detail_kuvab_molemad_keeleväljad_ja_aa_eraldi(fake_client):
    fake_client.responses["/prosopography/vutt:Pabc"] = {
        "id": "vutt:Pabc", "name": {"label": "Lünaeus"},
        "biography_et": "Eestikeelne elulugu.",
        "biography_en": "English biography.",
        "aa_raw": "154. Lünaeus, Emundus.",
        "works": [],
    }
    out = persons.detail(fake_client, "https://vutt.utlib.ut.ee", "vutt:Pabc", False)
    assert "Eestikeelne elulugu." in out
    assert "English biography." in out
    assert "154. Lünaeus" in out
    # AA-kirje EI OLE elulugu — sildid peavad seda eristama.
    assert "album_academicum" in out or "Album Academicum" in out


def test_search_katke_langeb_ahelas_tagasi(fake_client):
    fake_client.responses["/prosopography"] = {"total": 1, "results": [{
        "id": "vutt:Pabc", "label": "Lünaeus",
        "biography_snippet_et": "", "biography_snippet_en": "",
        "notes_snippet": "", "aa_snippet": "154. Lünaeus, Emundus.",
    }]}
    out = persons.search(fake_client, "https://vutt.utlib.ut.ee")
    assert "154. Lünaeus" in out
```

> Vaata `mcp/tests/test_persons.py` olemasolevat fikstuuri nime ja kuju ning kohanda
> `fake_client` sellega — ära loo teist paralleelset fikstuuri.

- [ ] **Step 2: Käivita testid ja veendu, et need kukuvad**

Run: `cd mcp && /home/mf/LLM/VUTT/.venv/bin/pytest tests/test_persons.py -q`
Expected: FAIL — väljundis ei ole ei EN-eluloo ega AA-kirje ridu

- [ ] **Step 3: Uuenda `persons.py`**

`detail()` — asenda rida `("elulugu", (person.get("biography") or "").strip() or None),`:

```python
        # Keel on VÄLJANIMES: ainult `biography_et` peidaks ingliskeelsena
        # kirjutatud eluloo. AA-kirje on eraldi liik sisu, mitte eluloo variant.
        ("elulugu_et", (person.get("biography_et") or "").strip() or None),
        ("elulugu_en", (person.get("biography_en") or "").strip() or None),
        ("album_academicum", (person.get("aa_raw") or "").strip() or None),
```

`search()` — lisa mooduli tasemele ja kasuta:

```python
# Katke varuvariandi ahel. Indeks kannab iga allika kohta oma katget (ADR 0039);
# valiku teeb TARBIJA, sest ainult tema teab, mida ta näidata tahab.
_SNIPPET_CHAIN = ("biography_snippet_et", "biography_snippet_en",
                  "notes_snippet", "aa_snippet")


def _snippet_of(entry: dict) -> str:
    """Esimene mittetühi katke ahelast."""
    for key in _SNIPPET_CHAIN:
        value = (entry.get(key) or "").strip()
        if value:
            return value
    return ""
```

ja asenda `snippet = (person.get("biography_snippet") or "").strip()`:

```python
        snippet = _snippet_of(person)
```

- [ ] **Step 4: Käivita testid ja veendu, et need läbivad**

Run: `cd mcp && /home/mf/LLM/VUTT/.venv/bin/pytest tests/ -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add mcp/vutt_mcp/persons.py mcp/tests/test_persons.py
git commit -m "feat(mcp): isikukaart kannab mõlemat keelevälja ja AA-kirjet eraldi"
```

---
### Task 14: Frontendi tüübid ja kuvamise ahel (`biographyChain.ts`)

Ahel elab ÜHES kohas — teda vajavad nii `PersonDetailPage` kui `PersonCard`, ja kaks
koopiat lahkneksid vaikselt (vrd #333: kaks tingimusteta peeglit).

**Files:**
- Modify: `src/prosopography/types.ts:45` (`ProsopoIndexEntry`), `:193` (`ProsopoRecord`)
- Create: `src/prosopography/utils/biographyChain.ts`
- Test: `src/prosopography/utils/__tests__/biographyChain.test.ts`

**Interfaces:**
- Consumes: —
- Produces (`biographyChain.ts`):
  - `export type BioLang = 'et' | 'en';`
  - `export interface BiographyPick { text: string; lang: BioLang; isFallback: boolean }`
  - `export function pickBiography(person: Pick<ProsopoRecord, 'biography_et' | 'biography_en'>, lang: BioLang): BiographyPick | null`
  - `export type SnippetSource = 'biography_et' | 'biography_en' | 'notes' | 'aa_raw';`
  - `export interface SnippetPick { text: string; source: SnippetSource; lang: BioLang | null; isFallback: boolean }`
  - `export function pickSnippet(entry: ProsopoIndexEntry, lang: BioLang): SnippetPick | null`
- Produces (`types.ts`): `TranslationAnchor`, `biography_et`, `biography_en`, `aa_raw`, `biography_et_src`, `biography_en_src`; neli katkevälja; `biography` ja `biography_snippet` **kaovad**

- [ ] **Step 1: Kirjuta kukkuvad testid**

```ts
/**
 * Eluloo ja katke ahel (ADR 0039, spekk otsused 4 ja 6).
 *
 * AA-plokk on ahelast VÄLJAS kuvamisel, aga katke ahela LÕPUS: ilma selleta
 * kaotaks 308 kaarti nimekirjas katke ära.
 */
import { describe, expect, it } from 'vitest';
import { pickBiography, pickSnippet } from '../biographyChain';

const rec = (et?: string | null, en?: string | null) =>
  ({ biography_et: et ?? null, biography_en: en ?? null }) as any;

const entry = (o: Partial<Record<string, string>>) =>
  ({
    biography_snippet_et: '', biography_snippet_en: '',
    notes_snippet: '', aa_snippet: '', ...o,
  }) as any;

describe('pickBiography', () => {
  it('eelistab lugeja keelt ja ei märgi varuvarianti', () => {
    expect(pickBiography(rec('Eesti', 'English'), 'en'))
      .toEqual({ text: 'English', lang: 'en', isFallback: false });
    expect(pickBiography(rec('Eesti', 'English'), 'et'))
      .toEqual({ text: 'Eesti', lang: 'et', isFallback: false });
  });

  it('langeb teise keelde ja MÄRGIB selle', () => {
    expect(pickBiography(rec('Eesti', null), 'en'))
      .toEqual({ text: 'Eesti', lang: 'et', isFallback: true });
    expect(pickBiography(rec(null, 'English'), 'et'))
      .toEqual({ text: 'English', lang: 'en', isFallback: true });
  });

  it('tagastab null, kui kumbagi ei ole', () => {
    expect(pickBiography(rec(null, null), 'et')).toBeNull();
    expect(pickBiography(rec('   ', ''), 'et')).toBeNull();
  });

  it('EI kasuta AA-kirjet eluloo varuvariandina', () => {
    const person = { biography_et: null, biography_en: null, aa_raw: '154. AA' } as any;
    expect(pickBiography(person, 'et')).toBeNull();
  });
});

describe('pickSnippet', () => {
  it('eelistab lugeja keele katget', () => {
    const pick = pickSnippet(entry({ biography_snippet_et: 'Eesti', biography_snippet_en: 'Eng' }), 'en');
    expect(pick).toEqual({ text: 'Eng', source: 'biography_en', lang: 'en', isFallback: false });
  });

  it('ahel: teine keel → märkmed → AA', () => {
    expect(pickSnippet(entry({ biography_snippet_et: 'Eesti' }), 'en')?.source).toBe('biography_et');
    expect(pickSnippet(entry({ notes_snippet: 'Märkmed' }), 'en')?.source).toBe('notes');
    expect(pickSnippet(entry({ aa_snippet: '154. AA' }), 'en')?.source).toBe('aa_raw');
  });

  it('märkmete ja AA katke ei kanna keelt', () => {
    expect(pickSnippet(entry({ aa_snippet: '154. AA' }), 'et'))
      .toEqual({ text: '154. AA', source: 'aa_raw', lang: null, isFallback: true });
  });

  it('tagastab null, kui ühtki allikat ei ole', () => {
    expect(pickSnippet(entry({}), 'et')).toBeNull();
  });
});
```

- [ ] **Step 2: Käivita testid ja veendu, et need kukuvad**

Run: `npx vitest run src/prosopography/utils/__tests__/biographyChain.test.ts`
Expected: FAIL — `Cannot find module '../biographyChain'`

- [ ] **Step 3: Uuenda tüübid ja kirjuta ahel**

`src/prosopography/types.ts` — `ProsopoIndexEntry`-s asenda `biography_snippet: string;`:

```ts
  // Iga katke on tuletatud TÄPSELT ÜHEST väljast — varuvariandi valib vaade
  // (ADR 0039). Nii teab kaart, mida ta näitab, ja saab keelemärke ausalt valida.
  biography_snippet_et: string;
  biography_snippet_en: string;
  notes_snippet: string;
  aa_snippet: string;
  /** @deprecated Kaob ülesandes 20. Hoiab typecheck'i rohelisena, kuni tarbijad
   *  on üle viidud — ära kirjuta uut koodi, mis seda loeb. */
  biography_snippet?: string;
```

`ProsopoRecord`-s asenda `biography: string | null;`:

```ts
  biography_et: string | null;
  biography_en: string | null;
  /** Album Academicumi toorik — KIRJE, mitte tekst. Ei tõlgita. */
  aa_raw: string | null;
  /** Vananemisankur: „keegi kinnitas vastavust teise keele tekstile, mis nägi välja nii." */
  biography_et_src: TranslationAnchor | null;
  biography_en_src: TranslationAnchor | null;
  /** @deprecated Kaob ülesandes 20. Vt `biography_snippet` kommentaari ülal. */
  biography?: string | null;
```

> **Miks pärandväljad valikulisena alles jäävad (eelkontrolli otsus R2):** plaani
> Global Constraints nõuab `npm run typecheck`-i enne IGAT commiti. Kui `biography`
> siit kohe kaob, ei typecheck'i ükski commit ülesannete 14 ja 20 vahel. Kaks rida
> `@deprecated` märkega hoiavad värava kehtivana; **ülesanne 20 kustutab mõlemad** ja
> selle ülevaatus kontrollib, et need on tõesti kadunud.

ja lisa tüüp faili:

```ts
export interface TranslationAnchor {
  /** Teise keele teksti sha256 esimesed 12 hex-märki kinnituse hetkel. */
  hash: string;
  at: string;
}
```

`src/prosopography/utils/biographyChain.ts`:

```ts
import type { ProsopoIndexEntry, ProsopoRecord } from '../types';

export type BioLang = 'et' | 'en';

export interface BiographyPick {
  text: string;
  /** Millise keele tekst tegelikult valiti. */
  lang: BioLang;
  /** Kas see EI ole lugeja keel — siis vajab kuvamine keelemärget. */
  isFallback: boolean;
}

const other = (lang: BioLang): BioLang => (lang === 'et' ? 'en' : 'et');
const filled = (v?: string | null): string => (v ?? '').trim();

/**
 * Eluloo ahel (spekk, otsus 4): oma keel → teine keel (+ märge) → mitte midagi.
 *
 * AA-kirje EI OLE selles ahelas: ta on teist liiki sisu ja renderdub omaette
 * plokina ALATI, kui ta on täidetud — ka siis, kui elulugu on olemas.
 */
export function pickBiography(
  person: Pick<ProsopoRecord, 'biography_et' | 'biography_en'>,
  lang: BioLang,
): BiographyPick | null {
  const own = filled(lang === 'et' ? person.biography_et : person.biography_en);
  if (own) return { text: own, lang, isFallback: false };

  const alt = other(lang);
  const fallback = filled(alt === 'et' ? person.biography_et : person.biography_en);
  if (fallback) return { text: fallback, lang: alt, isFallback: true };

  return null;
}

export type SnippetSource = 'biography_et' | 'biography_en' | 'notes' | 'aa_raw';

export interface SnippetPick {
  text: string;
  source: SnippetSource;
  /** null märkmete ja AA-kirje puhul — need ei kanna keelemärget. */
  lang: BioLang | null;
  isFallback: boolean;
}

/**
 * Katke ahel (spekk, otsus 6): oma keel → teine keel → märkmed → AA-kirje.
 *
 * `aa_snippet` on ahela lõpus TEADLIKULT: ilma selleta kaotaks 308 kaarti
 * nimekirjas katke ära, ja AA-kirje algus (nimi, aastad, päritolu) on
 * nimekirjavaates informatiivne.
 */
export function pickSnippet(entry: ProsopoIndexEntry, lang: BioLang): SnippetPick | null {
  const alt = other(lang);
  const chain: { text: string; source: SnippetSource; lang: BioLang | null }[] = [
    { text: filled(lang === 'et' ? entry.biography_snippet_et : entry.biography_snippet_en),
      source: (lang === 'et' ? 'biography_et' : 'biography_en'), lang },
    { text: filled(alt === 'et' ? entry.biography_snippet_et : entry.biography_snippet_en),
      source: (alt === 'et' ? 'biography_et' : 'biography_en'), lang: alt },
    { text: filled(entry.notes_snippet), source: 'notes', lang: null },
    { text: filled(entry.aa_snippet), source: 'aa_raw', lang: null },
  ];

  for (let i = 0; i < chain.length; i += 1) {
    const kandidaat = chain[i];
    if (kandidaat.text) {
      return { ...kandidaat, isFallback: i > 0 };
    }
  }
  return null;
}
```

- [ ] **Step 4: Käivita testid ja typecheck**

Run: `npx vitest run src/prosopography/utils/__tests__/biographyChain.test.ts && npm run typecheck`
Expected: mõlemad PASS. Typecheck PEAB olema puhas — pärandväljad jäid valikulisena
alles just selleks (otsus R2). Kui typecheck kukub, on midagi valesti: ära liigu edasi.

- [ ] **Step 5: Commit**

```bash
git add src/prosopography/types.ts src/prosopography/utils/biographyChain.ts \
        src/prosopography/utils/__tests__/biographyChain.test.ts
git commit -m "feat(prosopo): keeleväljade tüübid ja kuvamise/katke ahel"
```

---

### Task 15: i18n võtmed mõlemas keeles

`fallbackLng` on VÄLJAS — puuduv võti **katkestab buildi** (ADR 0011). Kõik võtmed
lähevad **korraga** `et`- ja `en`-faili.

**Files:**
- Modify: `src/locales/et/prosopography.json`
- Modify: `src/locales/en/prosopography.json`

**Interfaces:**
- Consumes: —
- Produces: võtmed, mida kasutavad ülesanded 16, 17 ja 20

- [ ] **Step 1: Kontrolli, et pariteedivalvur on roheline ENNE muudatust**

Run: `npx vitest run src/locales/__tests__/localeParity.test.ts`
Expected: PASS (lähtejoon)

- [ ] **Step 2: Lisa võtmed eesti faili**

`src/locales/et/prosopography.json` — ülemisele tasemele, `"biography"` kõrvale:

```json
  "biographyEt": "Elulugu (eesti)",
  "biographyEn": "Elulugu (inglise)",
  "aaRecord": "Album Academicumi kirje",
  "biographyOnlyEstonian": "Ingliskeelset tõlget ei ole — allpool on eestikeelne tekst.",
  "biographyOnlyEnglish": "Eestikeelset tõlget ei ole — allpool on ingliskeelne tekst.",
  "snippetInEstonian": "eesti k.",
  "snippetInEnglish": "inglise k.",
  "snippetNotes": "märkmed",
  "snippetAaRecord": "AA-kirje",
```

`"form"` objekti sisse:

```json
    "biographyEtPlaceholder": "Kirjelda isiku elukäiku eesti keeles…",
    "biographyEnPlaceholder": "Describe the person's life in English…",
    "translateFromEstonian": "Tõlgi eesti keelest",
    "translateFromEnglish": "Tõlgi inglise keelest",
    "translating": "Tõlgin…",
    "translateError": "Tõlkimine ebaõnnestus. Proovi uuesti või kirjuta tekst ise.",
    "translateBlocked": "Sisufilter keeldus sellest tekstist. Kirjuta tõlge ise.",
    "translateRateLimited": "Tõlkeid on tunnis liiga palju tehtud. Proovi hiljem.",
    "translateOverwriteConfirm": "Sihtväli ei ole tühi. Kas asendada olemasolev tekst tõlkega?",
    "translateStaleResult": "Tekst muutus tõlkimise ajal — tõlget ei rakendatud automaatselt.",
    "translateApplyAnyway": "Rakenda ikkagi",
    "confirmMatchesEstonian": "Vastab eestikeelsele tekstile",
    "confirmMatchesEnglish": "Vastab ingliskeelsele tekstile",
    "sourceChanged": "Originaaltekst on muutunud — kontrolli ka tõlget",
    "viewSourceDiff": "Vaata, mis muutus",
    "sourceVersionNotFound": "Lähteversiooni ei leitud (ajalugu on kärbitud).",
    "sourceVersionTitle": "Lähtetekst kinnituse hetkel",
```

- [ ] **Step 3: Lisa SAMAD võtmed inglise faili**

`src/locales/en/prosopography.json` — ülemisele tasemele:

```json
  "biographyEt": "Biography (Estonian)",
  "biographyEn": "Biography (English)",
  "aaRecord": "Album Academicum record",
  "biographyOnlyEstonian": "No English translation yet — the text below is in Estonian.",
  "biographyOnlyEnglish": "No Estonian translation yet — the text below is in English.",
  "snippetInEstonian": "in Estonian",
  "snippetInEnglish": "in English",
  "snippetNotes": "notes",
  "snippetAaRecord": "AA record",
```

`"form"` objekti sisse:

```json
    "biographyEtPlaceholder": "Kirjelda isiku elukäiku eesti keeles…",
    "biographyEnPlaceholder": "Describe the person's life in English…",
    "translateFromEstonian": "Translate from Estonian",
    "translateFromEnglish": "Translate from English",
    "translating": "Translating…",
    "translateError": "Translation failed. Try again or write the text yourself.",
    "translateBlocked": "The content filter refused this text. Please write the translation yourself.",
    "translateRateLimited": "Too many translations this hour. Please try later.",
    "translateOverwriteConfirm": "The target field is not empty. Replace the existing text with the translation?",
    "translateStaleResult": "The text changed while translating — the result was not applied automatically.",
    "translateApplyAnyway": "Apply anyway",
    "confirmMatchesEstonian": "Matches the Estonian text",
    "confirmMatchesEnglish": "Matches the English text",
    "sourceChanged": "The source text has changed — check the translation too",
    "viewSourceDiff": "See what changed",
    "sourceVersionNotFound": "Source version not found (history has been truncated).",
    "sourceVersionTitle": "Source text at the moment of confirmation",
```

> Kohatäited on **teadlikult mõlemas failis samad**: need on välja enda keele näited,
> mitte liidese keel — eestikeelses kastis peab kohatäide olema eesti keeles ka siis, kui
> liides on inglise keeles.

- [ ] **Step 4: Käivita i18n valvurid**

Run: `npx vitest run src/locales/__tests__/localeParity.test.ts src/locales/__tests__/translationKeysResolve.test.ts`
Expected: PASS — võtmestik identne

- [ ] **Step 5: Commit**

```bash
git add src/locales/et/prosopography.json src/locales/en/prosopography.json
git commit -m "feat(i18n): eluloo keeletabide, tõlke ja kinnituse võtmed mõlemas keeles"
```

---
### Task 16: `PersonDetailPage` — eluloo ahel ja AA-plokk eraldi

Praegune `person.biography &&` (rida 691) **peidaks ära kirje, millel on ainult
ingliskeelne tekst**. Ploki nähtavust kontrollitakse VALITUD TEKSTI järgi.

> **Testimise kuju (eelkontrolli otsus R1):** projektis EI OLE
> `@testing-library/react`-i ja `vitest.config.ts` on `environment: 'node'` — ühtki
> komponenditesti ei eksisteeri, kõik frontend-testid on puhaste utiliitide omad.
> Seda ei muudeta eluloo-featuuri kõrvalmõjuna. Seetõttu: ploki OTSUS elab puhtas
> funktsioonis ja testitakse seal; komponent on õhuke juhtmestik, mida katab
> typecheck ja ülesande 22 tootmiskontroll.

**Files:**
- Create: `src/prosopography/utils/biographyBlocks.ts`
- Create: `src/prosopography/components/BiographyBlocks.tsx`
- Modify: `src/prosopography/pages/PersonDetailPage.tsx:690-696`
- Test: `src/prosopography/utils/__tests__/biographyBlocks.test.ts`

**Interfaces:**
- Consumes: Task 14 — `pickBiography`, `BiographyPick`, `BioLang`; Task 15 — i18n võtmed
- Produces:
  - `export interface BiographyBlocksModel { biography: BiographyPick | null; aaRecord: string | null }`
  - `export function biographyBlocksModel(person: Pick<ProsopoRecord, 'biography_et' | 'biography_en' | 'aa_raw'>, lang: BioLang): BiographyBlocksModel`

- [ ] **Step 1: Kirjuta kukkuv test**

```ts
/**
 * Eluloo plokk + AA-plokk (spekk, otsus 4).
 *
 * AA-plokk on eluloo ahelast VÄLJAS ja renderdub ALATI, kui `aa_raw` on
 * täidetud — ka siis, kui elulugu on olemas.
 */
import { describe, expect, it } from 'vitest';
import { biographyBlocksModel } from '../biographyBlocks';

const person = (o: Record<string, unknown>) =>
  ({ biography_et: null, biography_en: null, aa_raw: null, ...o }) as any;

describe('biographyBlocksModel', () => {
  it('oma keele tekst, ilma märketa, AA-plokki ei ole', () => {
    const model = biographyBlocksModel(person({ biography_et: 'Eesti lugu.' }), 'et');
    expect(model.biography).toEqual({ text: 'Eesti lugu.', lang: 'et', isFallback: false });
    expect(model.aaRecord).toBeNull();
  });

  it('ainult ingliskeelne tekst eestikeelsele lugejale → märge', () => {
    const model = biographyBlocksModel(person({ biography_en: 'English life.' }), 'et');
    expect(model.biography).toEqual({ text: 'English life.', lang: 'en', isFallback: true });
  });

  it('AA-plokk on olemas KOOS elulooga', () => {
    const model = biographyBlocksModel(
      person({ biography_et: 'Eesti lugu.', aa_raw: '154. Lünaeus.' }), 'et');
    expect(model.biography?.text).toBe('Eesti lugu.');
    expect(model.aaRecord).toBe('154. Lünaeus.');
  });

  it('AA-kirje EI OLE eluloo varuvariant', () => {
    const model = biographyBlocksModel(person({ aa_raw: '154. Lünaeus.' }), 'et');
    expect(model.biography).toBeNull();
    expect(model.aaRecord).toBe('154. Lünaeus.');
  });

  it('ilma sisuta on mõlemad null', () => {
    const model = biographyBlocksModel(person({}), 'et');
    expect(model).toEqual({ biography: null, aaRecord: null });
  });

  it('tühikutest koosnev AA-väli loeb tühjaks', () => {
    expect(biographyBlocksModel(person({ aa_raw: '   \n ' }), 'et').aaRecord).toBeNull();
  });
});
```

- [ ] **Step 2: Käivita test ja veendu, et see kukub**

Run: `npx vitest run src/prosopography/utils/__tests__/biographyBlocks.test.ts`
Expected: FAIL — `Cannot find module '../biographyBlocks'`

- [ ] **Step 3: Kirjuta puhas mudel**

`src/prosopography/utils/biographyBlocks.ts`:

```ts
import type { ProsopoRecord } from '../types';
import { pickBiography, type BioLang, type BiographyPick } from './biographyChain';

export interface BiographyBlocksModel {
  /** Eluloo ahela tulemus (ADR 0039, otsus 4) või null. */
  biography: BiographyPick | null;
  /** AA-toorik. EI OLE eluloo varuvariant — omaette plokk, alati kui täidetud. */
  aaRecord: string | null;
}

/** Isikulehe kahe eluloo-ploki OTSUS ühes puhtas funktsioonis. */
export function biographyBlocksModel(
  person: Pick<ProsopoRecord, 'biography_et' | 'biography_en' | 'aa_raw'>,
  lang: BioLang,
): BiographyBlocksModel {
  return {
    biography: pickBiography(person, lang),
    aaRecord: (person.aa_raw ?? '').trim() || null,
  };
}
```

- [ ] **Step 4: Käivita test ja veendu, et see läbib**

Run: `npx vitest run src/prosopography/utils/__tests__/biographyBlocks.test.ts`
Expected: PASS (6 testi)

- [ ] **Step 5: Kirjuta komponent ja ühenda lehega**

`src/prosopography/components/BiographyBlocks.tsx` — õhuke juhtmestik mudeli ümber:

```tsx
import { BookMarked, ScrollText } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import MarkdownView from '../../components/MarkdownView';
import type { ProsopoRecord } from '../types';
import { biographyBlocksModel } from '../utils/biographyBlocks';
import type { BioLang } from '../utils/biographyChain';

interface Props {
  person: Pick<ProsopoRecord, 'biography_et' | 'biography_en' | 'aa_raw'>;
  lang: BioLang;
}

const CARD = 'bg-white p-5 rounded-lg border border-gray-200 shadow-sm mb-6';

/**
 * Eluloo plokk + Album Academicumi plokk.
 *
 * Otsuse teeb `biographyBlocksModel` (testitud); siin on ainult renderdus.
 * AA-kirje pealkiri on tõlgitud, sisu ei ole — see on struktureeritud
 * allikakirje, mitte tekst (ADR 0039).
 */
const BiographyBlocks: React.FC<Props> = ({ person, lang }) => {
  const { t } = useTranslation(['prosopography']);
  const { biography, aaRecord } = biographyBlocksModel(person, lang);

  if (!biography && !aaRecord) return null;

  return (
    <>
      {biography && (
        <div className={CARD}>
          <div className="flex items-center gap-2 mb-3">
            <BookMarked size={18} className="text-gray-400" />
            <h2 className="text-sm font-medium text-gray-700">{t('biography')}</h2>
          </div>
          {biography.isFallback && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mb-3">
              {biography.lang === 'et' ? t('biographyOnlyEstonian') : t('biographyOnlyEnglish')}
            </p>
          )}
          <MarkdownView content={biography.text} className="text-sm text-gray-800 leading-relaxed" />
        </div>
      )}

      {aaRecord && (
        <div className={CARD}>
          <div className="flex items-center gap-2 mb-3">
            <ScrollText size={18} className="text-gray-400" />
            <h2 className="text-sm font-medium text-gray-700">{t('aaRecord')}</h2>
          </div>
          {/* AA-kirje on kirje, mitte Markdown — reavahetused on sisulised. */}
          <pre className="text-xs text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
            {aaRecord}
          </pre>
        </div>
      )}
    </>
  );
};

export default BiographyBlocks;
```

`src/prosopography/pages/PersonDetailPage.tsx` — asenda read 690–696:

```tsx
        {/* ── Elulugu + Album Academicumi kirje ── */}
        <BiographyBlocks person={person} lang={lang === 'en' ? 'en' : 'et'} />
```

Lisa import ja eemalda kasutuks jäänud `BookMarked` import, kui seda lehel mujal ei kasutata.

> `lang` on lehel juba olemas (`PersonDetailPage` annab selle ka `EntityPicker`-ile ja
> `usePersonTagSuggestions`-ile). Kui selle tüüp ei ole täpselt `'et' | 'en'`, kitsenda
> kutsel nagu ülal — ära muuda lehe `lang` muutuja tüüpi, see mõjutaks teisi tarbijaid.

- [ ] **Step 6: Typecheck ja kogu frontend-testipakett**

Run: `npm run typecheck && npx vitest run`
Expected: mõlemad PASS

- [ ] **Step 7: Commit**

```bash
git add src/prosopography/utils/biographyBlocks.ts \
        src/prosopography/utils/__tests__/biographyBlocks.test.ts \
        src/prosopography/components/BiographyBlocks.tsx \
        src/prosopography/pages/PersonDetailPage.tsx
git commit -m "feat(prosopo): eluloo ahel ja AA-kirje eraldi plokina isikulehel"
```

---

### Task 17: `PersonCard` — katke ahel ja keelemärge

> **Testimise kuju (eelkontrolli otsus R1):** projektis ei ole komponenditestimise
> stäki (`@testing-library/react` puudub, `vitest.config.ts` on `environment: 'node'`).
> Märke VALIK on puhas funktsioon ja testitakse `biographyChain.test.ts`-is; komponent
> on õhuke juhtmestik.

**Files:**
- Modify: `src/prosopography/utils/biographyChain.ts` (lisa `snippetBadgeKey`)
- Modify: `src/prosopography/utils/__tests__/biographyChain.test.ts` (lisa testid)
- Create: `src/prosopography/components/PersonSnippet.tsx`
- Modify: `src/prosopography/components/PersonCard.tsx:209-214`

**Interfaces:**
- Consumes: Task 14 — `pickSnippet`, `SnippetPick`, `SnippetSource`, `BioLang`;
  Task 15 — `snippetInEstonian`, `snippetInEnglish`, `snippetNotes`, `snippetAaRecord`
- Produces: `export function snippetBadgeKey(pick: SnippetPick): string | null`
  — i18n võti, või `null`, kui katke on lugeja enda keelest (märget ei ole)

- [ ] **Step 1: Kirjuta kukkuvad testid**

Lisa `src/prosopography/utils/__tests__/biographyChain.test.ts` lõppu:

```ts
import { snippetBadgeKey } from '../biographyChain';

describe('snippetBadgeKey', () => {
  it('oma keele katkel märget ei ole', () => {
    const pick = pickSnippet(entry({ biography_snippet_et: 'Eesti' }), 'et')!;
    expect(snippetBadgeKey(pick)).toBeNull();
  });

  it('teise keele katkel on keelemärge', () => {
    const pick = pickSnippet(entry({ biography_snippet_en: 'English' }), 'et')!;
    expect(snippetBadgeKey(pick)).toBe('snippetInEnglish');
  });

  it('märkmete ja AA katkel on oma märge, mitte keelemärge', () => {
    const notes = pickSnippet(entry({ notes_snippet: 'Märkmed' }), 'et')!;
    expect(snippetBadgeKey(notes)).toBe('snippetNotes');
    const aa = pickSnippet(entry({ aa_snippet: '154. AA' }), 'et')!;
    expect(snippetBadgeKey(aa)).toBe('snippetAaRecord');
  });

  it('kaardistus katab KÕIK allikad — uus allikas ei tohi vaikselt märketa jääda', () => {
    const allikad: SnippetSource[] = ['biography_et', 'biography_en', 'notes', 'aa_raw'];
    for (const source of allikad) {
      expect(snippetBadgeKey({ text: 'x', source, lang: null, isFallback: true }))
        .toEqual(expect.any(String));
    }
  });
});
```

Lisa faili olemasolevasse importi `SnippetSource` (`import { pickBiography, pickSnippet, snippetBadgeKey, type SnippetSource } from '../biographyChain';`).

- [ ] **Step 2: Käivita testid ja veendu, et need kukuvad**

Run: `npx vitest run src/prosopography/utils/__tests__/biographyChain.test.ts`
Expected: FAIL — `snippetBadgeKey is not a function` / eksporti ei ole

- [ ] **Step 3: Lisa `snippetBadgeKey` ahelamoodulisse**

`src/prosopography/utils/biographyChain.ts` lõppu:

```ts
// Katke allikas → i18n võti. Kaardistus on TOTAALNE (`Record<SnippetSource, string>`):
// uus allikas ei kompileeru enne, kui talle on märge antud.
const BADGE_KEY: Record<SnippetSource, string> = {
  biography_et: 'snippetInEstonian',
  biography_en: 'snippetInEnglish',
  notes: 'snippetNotes',
  aa_raw: 'snippetAaRecord',
};

/**
 * Märke i18n võti, või `null`, kui katke on lugeja enda keelest.
 *
 * Märge on AUSUSE küsimus: ilma selleta näeks lugeja võõrkeelset teksti või
 * AA-kirjet nii, nagu oleks see tema keeles kirjutatud elulugu (ADR 0039).
 */
export function snippetBadgeKey(pick: SnippetPick): string | null {
  return pick.isFallback ? BADGE_KEY[pick.source] : null;
}
```

- [ ] **Step 4: Käivita testid ja veendu, et need läbivad**

Run: `npx vitest run src/prosopography/utils/__tests__/biographyChain.test.ts`
Expected: PASS

- [ ] **Step 5: Loo komponent ja ühenda kaardiga**

`src/prosopography/components/PersonSnippet.tsx`:

```tsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ProsopoIndexEntry } from '../types';
import { pickSnippet, snippetBadgeKey, type BioLang } from '../utils/biographyChain';

interface Props { entry: ProsopoIndexEntry; lang: BioLang }

/** Nimekirja katke + aus märge selle kohta, MIS allikas see on. */
const PersonSnippet: React.FC<Props> = ({ entry, lang }) => {
  const { t } = useTranslation(['prosopography']);
  const pick = pickSnippet(entry, lang);
  if (!pick) return null;
  const badge = snippetBadgeKey(pick);

  return (
    <p className="text-xs text-gray-500 italic leading-relaxed line-clamp-2 border-l-2 border-gray-200 pl-2 mt-2">
      {badge && (
        <span className="not-italic text-[10px] uppercase tracking-wide text-gray-400 mr-1">
          {t(badge)}
        </span>
      )}
      „{pick.text}…"
    </p>
  );
};

export default PersonSnippet;
```

`src/prosopography/components/PersonCard.tsx` — asenda read 209–214:

```tsx
        {/* Katke: ahela valib vaade, mitte indeks */}
        <PersonSnippet entry={person} lang={i18n.language?.startsWith('en') ? 'en' : 'et'} />
```

- [ ] **Step 6: Typecheck ja kogu frontend-testipakett**

Run: `npm run typecheck && npx vitest run`
Expected: mõlemad PASS

- [ ] **Step 7: Commit**

```bash
git add src/prosopography/utils/biographyChain.ts \
        src/prosopography/utils/__tests__/biographyChain.test.ts \
        src/prosopography/components/PersonSnippet.tsx \
        src/prosopography/components/PersonCard.tsx
git commit -m "feat(prosopo): nimekirja katke valib ahela ja märgib allika"
```

---

### Task 18: Vormidraft ja `helpers.ts`

Draft saab kolm tekstivälja ja kaks kinnitusruutu. **Ankrud EI lähe payload'i** (server
viskaks need niikuinii ära, aga saatmata jätmine hoiab lepingu ausana).

**Files:**
- Modify: `src/prosopography/components/personForm/types.ts:63,84` (`FormDraft`, `emptyDraft`)
- Modify: `src/prosopography/components/personForm/helpers.ts:102,188,315`
- Modify: `src/prosopography/components/personForm/EnrichExistingSection.tsx:33`
- Test: `src/prosopography/components/personForm/__tests__/biographyDraft.test.ts`

**Interfaces:**
- Consumes: Task 14 tüübid
- Produces:
  - `FormDraft`: `biography_et: string`, `biography_en: string`, `aa_raw: string`, `confirm_et: boolean`, `confirm_en: boolean`
  - `draftToPayload` lisab `_confirm_translation: string[]` ainult siis, kui vähemalt üks ruut on märgitud

- [ ] **Step 1: Kirjuta kukkuvad testid**

```ts
/** Draft ↔ payload ümarreis eluloo keeleväljadele. */
import { describe, expect, it } from 'vitest';
import { draftToPayload, recordToDraft } from '../helpers';
import { emptyDraft } from '../types';

const record = (o: Record<string, unknown>) =>
  ({ id: 'vutt:Pabc', updated_at: '2026-09-10T10:00:00+00:00',
     name: { label: 'Test' }, identifiers: [], ...o }) as any;

describe('recordToDraft', () => {
  it('loeb kolm tekstivälja', () => {
    const draft = recordToDraft(record({
      biography_et: 'Eesti', biography_en: 'English', aa_raw: '154. AA' }));
    expect(draft.biography_et).toBe('Eesti');
    expect(draft.biography_en).toBe('English');
    expect(draft.aa_raw).toBe('154. AA');
  });

  it('kinnitusruudud algavad märkimata', () => {
    const draft = recordToDraft(record({ biography_en: 'English' }));
    expect(draft.confirm_et).toBe(false);
    expect(draft.confirm_en).toBe(false);
  });
});

describe('draftToPayload', () => {
  it('saadab kolm välja, tühi → null', () => {
    const payload = draftToPayload({ ...emptyDraft(), biography_et: 'Eesti' }) as any;
    expect(payload.biography_et).toBe('Eesti');
    expect(payload.biography_en).toBeNull();
    expect(payload.aa_raw).toBeNull();
  });

  it('EI saada ankruid', () => {
    const payload = draftToPayload(emptyDraft()) as any;
    expect(payload.biography_et_src).toBeUndefined();
    expect(payload.biography_en_src).toBeUndefined();
  });

  it('lisab _confirm_translation ainult märgitud ruutude kohta', () => {
    expect((draftToPayload(emptyDraft()) as any)._confirm_translation).toBeUndefined();
    const payload = draftToPayload({ ...emptyDraft(), confirm_en: true }) as any;
    expect(payload._confirm_translation).toEqual(['biography_en']);
  });

  it('EI saada pärandvälja `biography`', () => {
    const payload = draftToPayload(emptyDraft()) as any;
    expect('biography' in payload).toBe(false);
  });
});
```

> Funktsioonide TEGELIKUD nimed `helpers.ts`-is (kontrollitud):
> `recordToDraft` (rida 139), `draftToPayload` (rida 218), `applyEnrichmentToDraft`
> (rida 29). Ära nimeta neid ümber.

- [ ] **Step 2: Käivita testid ja veendu, et need kukuvad**

Run: `npx vitest run src/prosopography/components/personForm/__tests__/biographyDraft.test.ts`
Expected: FAIL — `draft.biography_et` on `undefined`

- [ ] **Step 3: Uuenda draft, helpers ja rikastuse kaardistus**

`personForm/types.ts` — `FormDraft`-is asenda `biography: string;`:

```ts
  biography_et: string;
  biography_en: string;
  /** AA-toorik. Vormis kirjutamiseks EI avata, aga käib ümarreisi kaasa. */
  aa_raw: string;
  /** Kinnitusruudud — ajutine vormiolek, kaardile ei salvestu. */
  confirm_et: boolean;
  confirm_en: boolean;
```

`emptyDraft()`-is asenda `biography: '',`:

```ts
  biography_et: '',
  biography_en: '',
  aa_raw: '',
  confirm_et: false,
  confirm_en: false,
```

`helpers.ts:102` (`applyEnrichmentToDraft`) — AA-rikastuse autotäide läheb `aa_raw`-sse:

```ts
  // AA raw_text on KIRJE, mitte elulugu — ta läheb `aa_raw`-sse (ADR 0039).
  if (autoFilled['aa_raw'] && !draft.aa_raw.trim()) {
    patch.aa_raw = autoFilled['aa_raw'];
  }
```

`helpers.ts:188` — `recordToDraft`-is asenda `biography: p.biography ?? '',`:

```ts
    biography_et: p.biography_et ?? '',
    biography_en: p.biography_en ?? '',
    aa_raw: p.aa_raw ?? '',
    confirm_et: false,
    confirm_en: false,
```

`helpers.ts:315` — `draftToPayload`-is asenda `biography: draft.biography.trim() || null,`:

```ts
    biography_et: draft.biography_et.trim() || null,
    biography_en: draft.biography_en.trim() || null,
    aa_raw: draft.aa_raw.trim() || null,
    // Kinnitus on ajutine võti, mitte kaardi väli — server popib ta ära ja
    // arvutab räsi ise. Ankruid me EI saada (server viskaks need niikuinii ära).
    ...(() => {
      const confirmed = [
        ...(draft.confirm_et ? ['biography_et'] : []),
        ...(draft.confirm_en ? ['biography_en'] : []),
      ];
      return confirmed.length ? { _confirm_translation: confirmed } : {};
    })(),
```

`EnrichExistingSection.tsx:33` — `FIELD_I18N`-is asenda `biography: 'biography',`:

```ts
  aa_raw: 'biography',
```

(i18n võti jääb `biography`, sest `form.enrich.fields.biography` on olemasolev tekst
„Biograafia" — ainult VÄLJA nimi muutus.)

- [ ] **Step 4: Käivita testid**

Run: `npx vitest run src/prosopography/components/personForm/__tests__/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/prosopography/components/personForm/ \
        src/prosopography/components/personForm/__tests__/biographyDraft.test.ts
git commit -m "feat(prosopo): vormidraft kolme tekstivälja ja kinnitusruutudega"
```

---
### Task 19: Teenusekiht — `translateText` ja `fetchSourceDiff`

**Files:**
- Modify: `src/prosopography/services/prosopographyService.ts`
- Test: `src/prosopography/services/__tests__/translateService.test.ts`

**Interfaces:**
- Consumes: Task 11, Task 12 endpointid
- Produces:
  - `export class TranslateFailed extends Error { readonly kind: 'blocked' | 'rate_limited' | 'other' }`
  - `export async function translateText(text: string, sourceLang: 'et' | 'en', targetLang: 'et' | 'en', token: string): Promise<string>`
  - `export interface SourceDiff { found: boolean; commit: string | null; date: string | null; text: string | null }`
  - `export async function fetchSourceDiff(personId: string, field: 'biography_et' | 'biography_en', token: string): Promise<SourceDiff>`

- [ ] **Step 1: Kirjuta kukkuvad testid**

```ts
/**
 * Tõlketeenus: veatüüp tuleb SERVERI koodist ja masinloetavast prefiksist,
 * mitte sõnumi sisust (#292 muster: kaks keelt, üks reegel).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TranslateFailed, fetchSourceDiff, translateText } from '../prosopographyService';

const mockFetch = (body: unknown, status = 200) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);

afterEach(() => vi.restoreAllMocks());

describe('translateText', () => {
  it('tagastab tõlke', async () => {
    mockFetch({ status: 'ok', text: 'English biography.' });
    await expect(translateText('Elulugu.', 'et', 'en', 'TOKEN'))
      .resolves.toBe('English biography.');
  });

  it('429 → kind rate_limited', async () => {
    mockFetch({ detail: 'Liiga palju' }, 429);
    await expect(translateText('Elulugu.', 'et', 'en', 'TOKEN'))
      .rejects.toMatchObject({ kind: 'rate_limited' });
  });

  it('content_blocked prefiks → kind blocked', async () => {
    mockFetch({ detail: 'content_blocked: Gemini sisufilter keeldus' }, 502);
    await expect(translateText('Elulugu.', 'et', 'en', 'TOKEN'))
      .rejects.toMatchObject({ kind: 'blocked' });
  });

  it('muu viga → kind other', async () => {
    mockFetch({ detail: 'Tõlkepäring ebaõnnestus' }, 502);
    const err = await translateText('Elulugu.', 'et', 'en', 'TOKEN').catch(e => e);
    expect(err).toBeInstanceOf(TranslateFailed);
    expect(err.kind).toBe('other');
  });
});

describe('fetchSourceDiff', () => {
  it('annab found:false ilma erandita', async () => {
    mockFetch({ found: false, commit: null, date: null, text: null });
    await expect(fetchSourceDiff('vutt:Pabc', 'biography_en', 'TOKEN'))
      .resolves.toMatchObject({ found: false });
  });

  it('kodeerib person_id URL-i', async () => {
    const spy = mockFetch({ found: false, commit: null, date: null, text: null });
    await fetchSourceDiff('vutt:Pabc', 'biography_en', 'TOKEN');
    expect(String(spy.mock.calls[0][0])).toContain('vutt%3APabc');
  });
});
```

- [ ] **Step 2: Käivita testid ja veendu, et need kukuvad**

Run: `npx vitest run src/prosopography/services/__tests__/translateService.test.ts`
Expected: FAIL — `translateText` ei ole eksporditud

- [ ] **Step 3: Lisa teenusefunktsioonid**

`src/prosopography/services/prosopographyService.ts` lõppu:

```ts
/** Tõlke veaklass. `kind` tuleb SERVERI koodist, mitte sõnumi sisust. */
export class TranslateFailed extends Error {
  readonly kind: 'blocked' | 'rate_limited' | 'other';
  constructor(kind: 'blocked' | 'rate_limited' | 'other', message: string) {
    super(message);
    this.name = 'TranslateFailed';
    this.kind = kind;
  }
}

// Masinloetav prefiks, mille backend paneb sisufiltri keeldumise ette (#292).
// Sama string on `server/ocr_providers/gemini.py` CONTENT_BLOCKED — kaks keelt,
// üks reegel.
const CONTENT_BLOCKED_PREFIX = 'content_blocked';

/**
 * Tõlgib teksti. OLEKUTA — kaarti ei puudutata, salvestamine käib eraldi.
 *
 * Timeout on 120 s: Gemini päring ise võib võtta kuni `GEMINI_REQUEST_TIMEOUT`
 * (120 s) ja lühem klienditimeout annaks „server 200 + klient viga" mustri.
 */
export async function translateText(
  text: string,
  sourceLang: 'et' | 'en',
  targetLang: 'et' | 'en',
  token: string,
): Promise<string> {
  const resp = await fetchWithTimeout(`${BASE}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders(token) },
    body: JSON.stringify({ source_lang: sourceLang, target_lang: targetLang, text }),
    timeout: 120000,
  });

  if (resp.status === 429) {
    throw new TranslateFailed('rate_limited', 'rate limited');
  }
  if (!resp.ok) {
    const detail = await resp.json().then(b => String(b?.detail ?? '')).catch(() => '');
    throw new TranslateFailed(
      detail.startsWith(CONTENT_BLOCKED_PREFIX) ? 'blocked' : 'other', detail);
  }
  const body = await resp.json();
  return body.text as string;
}

export interface SourceDiff {
  found: boolean;
  commit: string | null;
  date: string | null;
  text: string | null;
}

/** Ankru-aegne lähtetekst („vaata, mis muutus"). `found: false` EI ole viga. */
export async function fetchSourceDiff(
  personId: string,
  field: 'biography_et' | 'biography_en',
  token: string,
): Promise<SourceDiff> {
  const encoded = encodeURIComponent(personId);
  const resp = await fetchWithTimeout(
    `${BASE}/${encoded}/source-diff?field=${field}`,
    { headers: getAuthHeaders(token), timeout: 15000 },
  );
  if (!resp.ok) throw new Error(`fetchSourceDiff: ${resp.status}`);
  return resp.json();
}
```

- [ ] **Step 4: Käivita testid ja typecheck**

Run: `npx vitest run src/prosopography/services/__tests__/translateService.test.ts`
Expected: PASS (6 testi)

- [ ] **Step 5: Commit**

```bash
git add src/prosopography/services/prosopographyService.ts \
        src/prosopography/services/__tests__/translateService.test.ts
git commit -m "feat(prosopo): tõlke ja lähteversiooni teenusefunktsioonid"
```

---

### Task 20: `PersonEditPage` — keeletabid, tõlkenupp, kinnitusruut, hoiatus

Viimane frontendi tükk. Kolm kaitset, mida EI TOHI ära jätta:
1. **täidetud sihtväli** → kinnitus ENNE päringu saatmist;
2. **hiline vastus** → mõlema välja hetktõmmis päringu alguses; muutus → ei rakenda automaatselt;
3. **lähteteksti muutmine** → kustutab kinnitusruudu märke (sihtteksti toimetamine EI kustuta).

> **Testimise kuju (eelkontrolli otsus R1):** komponenditestimise stäki projektis ei ole.
> Kõik kolm kaitset on OTSUSED, mitte renderdus — need lähevad puhtasse moodulisse
> `translationFlow.ts` ja testitakse seal. Komponent on juhtmestik. See on ühtlasi
> parem disain: kaitsed on loetavad ühest failist, mitte laiali `useState`-ide vahel.

**Files:**
- Create: `src/prosopography/utils/textHash.ts`
- Create: `src/prosopography/utils/translationFlow.ts`
- Create: `src/prosopography/components/personForm/BiographySection.tsx`
- Modify: `src/prosopography/types.ts` (kustuta R2 pärandväljad)
- Modify: `src/prosopography/pages/PersonEditPage.tsx:617-629`
- Test: `src/prosopography/utils/__tests__/textHash.test.ts`
- Test: `src/prosopography/utils/__tests__/translationFlow.test.ts`

**Interfaces:**
- Consumes: Task 14 (`BioLang`, `TranslationAnchor`), 15 (i18n), 18 (`FormDraft`), 19 (`translateText`, `fetchSourceDiff`, `TranslateFailed`)
- Produces (`textHash.ts`): `export async function textHash(text: string | null | undefined): Promise<string>`
- Produces (`translationFlow.ts`):
  - `export type BioField = 'biography_et' | 'biography_en';`
  - `export const OTHER_FIELD: Record<BioField, BioField>`
  - `export const CONFIRM_KEY: Record<BioField, 'confirm_et' | 'confirm_en'>`
  - `export interface BioSnapshot { biography_et: string; biography_en: string }`
  - `export function needsOverwriteConfirm(targetText: string): boolean`
  - `export function isStaleResult(snapshot: BioSnapshot, current: BioSnapshot): boolean`
  - `export function confirmClearPatch(editedField: BioField, confirms: { confirm_et: boolean; confirm_en: boolean }): Partial<FormDraft>`
  - `export function isAnchorStale(anchor: TranslationAnchor | null | undefined, currentSourceHash: string): boolean`
  - `export function translateErrorKey(kind: 'blocked' | 'rate_limited' | 'other'): string`

- [ ] **Step 1: Kirjuta `textHash` test**

`src/prosopography/utils/__tests__/textHash.test.ts`:

```ts
/**
 * Sama räsi mis serveril (`server/prosopo_biography_fields.py::text_hash`).
 * Kaks teostust, üks reegel — see test ON nendevaheline leping.
 */
import { describe, expect, it } from 'vitest';
import { textHash } from '../textHash';

describe('textHash', () => {
  it('lubjab ümbritseva tühiku ja annab 12 märki', async () => {
    expect(await textHash('  tekst \n')).toBe(await textHash('tekst'));
    expect(await textHash('tekst')).toHaveLength(12);
  });

  it('vastab serveri väärtusele', async () => {
    // Genereeritud serveri funktsiooniga, mitte välja mõeldud: sha256("tekst")[:12].
    expect(await textHash('tekst')).toBe('324d0315d575');
  });

  it('tühi, null ja undefined annavad sama räsi', async () => {
    const tyhi = await textHash('');
    expect(await textHash(null)).toBe(tyhi);
    expect(await textHash(undefined)).toBe(tyhi);
  });

  it('erinev tekst annab erineva räsi', async () => {
    expect(await textHash('tekst')).not.toBe(await textHash('teksti'));
  });
});
```

- [ ] **Step 2: Käivita ja veendu, et kukub; siis kirjuta `textHash.ts`**

Run: `npx vitest run src/prosopography/utils/__tests__/textHash.test.ts`
Expected: FAIL — `Cannot find module '../textHash'`

```ts
/**
 * Sama räsi mis `server/prosopo_biography_fields.py::text_hash`:
 * sha256, esimesed 12 hex-märki, ümbritsev tühik lubjatud.
 *
 * Kaks teostust, üks reegel — kui üht muudad, muuda mõlemat (vrd #292).
 */
export async function textHash(text: string | null | undefined): Promise<string> {
  const normaliseeritud = (text ?? '').trim();
  const bytes = new TextEncoder().encode(normaliseeritud);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 12);
}
```

Run uuesti: PASS (4 testi).

> **Kontrollitud (kontroller, 2026-09-10):** Node v22.23.0, `crypto.subtle.digest` on
> vitesti `node`-keskkonnas globaalselt olemas ja see teostus annab `'tekst'` peale
> täpselt `324d0315d575` — sama mis Pythoni pool. Polyfill'i EI ole vaja.

- [ ] **Step 3: Kirjuta `translationFlow` testid**

`src/prosopography/utils/__tests__/translationFlow.test.ts`:

```ts
/**
 * Tõlkevoo kolm kaitset (spekk, otsused 5 ja 8). Need on OTSUSED, mitte
 * renderdus — seepärast on nad siin puhaste funktsioonidena testitavad.
 */
import { describe, expect, it } from 'vitest';
import {
  CONFIRM_KEY, OTHER_FIELD, confirmClearPatch, isAnchorStale, isStaleResult,
  needsOverwriteConfirm, translateErrorKey,
} from '../translationFlow';

describe('needsOverwriteConfirm', () => {
  it('tühi sihtväli ei vaja kinnitust', () => {
    expect(needsOverwriteConfirm('')).toBe(false);
    expect(needsOverwriteConfirm('   \n ')).toBe(false);
  });
  it('täidetud sihtväli vajab kinnitust', () => {
    expect(needsOverwriteConfirm('Olemasolev tõlge.')).toBe(true);
  });
});

describe('isStaleResult', () => {
  const snap = { biography_et: 'Eesti', biography_en: '' };
  it('muutumatu olek ei ole aegunud', () => {
    expect(isStaleResult(snap, { ...snap })).toBe(false);
  });
  it('LÄHTEteksti muutus tõlke ajal → aegunud', () => {
    expect(isStaleResult(snap, { biography_et: 'Muudetud', biography_en: '' })).toBe(true);
  });
  it('SIHTteksti muutus tõlke ajal → samuti aegunud', () => {
    // Mõlema välja hetktõmmis, mitte ainult lähte oma: toimetaja võis
    // vahepeal sihtvälja ise kirjutama hakata.
    expect(isStaleResult(snap, { biography_et: 'Eesti', biography_en: 'Käsitsi' })).toBe(true);
  });
});

describe('confirmClearPatch', () => {
  it('LÄHTEteksti muutmine kustutab teise keele kinnituse', () => {
    expect(confirmClearPatch('biography_et', { confirm_et: false, confirm_en: true }))
      .toEqual({ confirm_en: false });
  });
  it('SIHTteksti toimetamine EI kustuta kinnitust', () => {
    // Toimetaja parandab tõlget — see on kinnituse SISU, mitte selle rikkumine.
    expect(confirmClearPatch('biography_en', { confirm_et: false, confirm_en: true }))
      .toEqual({});
  });
  it('juba märkimata ruut ei tekita tühja patchi', () => {
    expect(confirmClearPatch('biography_et', { confirm_et: false, confirm_en: false }))
      .toEqual({});
  });
});

describe('isAnchorStale', () => {
  it('ankruta väli EI ole vananenud', () => {
    // `null` tähendab „seost ei ole salvestatud", MITTE „vananenud" (ADR 0039).
    expect(isAnchorStale(null, 'abc123abc123')).toBe(false);
    expect(isAnchorStale(undefined, 'abc123abc123')).toBe(false);
  });
  it('sama räsi → ei ole vananenud', () => {
    expect(isAnchorStale({ hash: 'abc123abc123', at: 'x' }, 'abc123abc123')).toBe(false);
  });
  it('erinev räsi → vananenud', () => {
    expect(isAnchorStale({ hash: 'abc123abc123', at: 'x' }, 'zzz999zzz999')).toBe(true);
  });
});

describe('kaardistused ja veavõtmed', () => {
  it('OTHER_FIELD ja CONFIRM_KEY on ristis õigetpidi', () => {
    expect(OTHER_FIELD.biography_en).toBe('biography_et');
    expect(OTHER_FIELD.biography_et).toBe('biography_en');
    expect(CONFIRM_KEY.biography_en).toBe('confirm_en');
  });
  it('iga veatüüp annab oma i18n võtme', () => {
    const kõik = (['blocked', 'rate_limited', 'other'] as const).map(translateErrorKey);
    expect(new Set(kõik).size).toBe(3);
    expect(kõik.every(k => k.startsWith('form.'))).toBe(true);
  });
});
```

- [ ] **Step 4: Käivita ja veendu, et kukub; siis kirjuta `translationFlow.ts`**

Run: `npx vitest run src/prosopography/utils/__tests__/translationFlow.test.ts`
Expected: FAIL — `Cannot find module '../translationFlow'`

```ts
import type { FormDraft } from '../components/personForm/types';
import type { TranslationAnchor } from '../types';

export type BioField = 'biography_et' | 'biography_en';

/** Keeleväli → teise keele väli. Tõlke LÄHE on alati teine keel. */
export const OTHER_FIELD: Record<BioField, BioField> = {
  biography_et: 'biography_en',
  biography_en: 'biography_et',
};

/** Keeleväli → tema kinnitusruudu võti draftis. */
export const CONFIRM_KEY: Record<BioField, 'confirm_et' | 'confirm_en'> = {
  biography_et: 'confirm_et',
  biography_en: 'confirm_en',
};

export interface BioSnapshot { biography_et: string; biography_en: string }

/** Täidetud sihtväli → küsi kinnitust ENNE päringu saatmist. */
export function needsOverwriteConfirm(targetText: string): boolean {
  return targetText.trim().length > 0;
}

/**
 * Kas mõni väli muutus tõlke ajal?
 *
 * Hetktõmmis võetakse MÕLEMAST väljast, mitte ainult lähtest: toimetaja võis
 * ootamise ajal hakata sihtvälja ise kirjutama ja automaatne kirjutus sööks
 * selle ära (spekk, otsus 8).
 */
export function isStaleResult(snapshot: BioSnapshot, current: BioSnapshot): boolean {
  return snapshot.biography_et !== current.biography_et
      || snapshot.biography_en !== current.biography_en;
}

/**
 * Lähteteksti muutmine kustutab TEISE keele kinnituse märke.
 *
 * Sihtteksti toimetamine EI kustuta — toimetaja parandab tõlget, see on
 * kinnituse sisu, mitte selle rikkumine (spekk, otsus 5).
 */
export function confirmClearPatch(
  editedField: BioField,
  confirms: { confirm_et: boolean; confirm_en: boolean },
): Partial<FormDraft> {
  const key = CONFIRM_KEY[OTHER_FIELD[editedField]];
  return confirms[key] ? ({ [key]: false } as Partial<FormDraft>) : {};
}

/**
 * Kas ankur on vananenud?
 *
 * `null`/`undefined` ankur EI ole vananenud: see tähendab „seost ei ole
 * salvestatud", mitte „originaal on muutunud" (ADR 0039). Hoiatus tühja
 * ankru peale oleks vale hoiatus.
 */
export function isAnchorStale(
  anchor: TranslationAnchor | null | undefined,
  currentSourceHash: string,
): boolean {
  return !!anchor?.hash && anchor.hash !== currentSourceHash;
}

/** Pakkuja veatüüp → i18n võti (ADR 0033: sõnum tuleb lugeja keeles). */
export function translateErrorKey(kind: 'blocked' | 'rate_limited' | 'other'): string {
  if (kind === 'blocked') return 'form.translateBlocked';
  if (kind === 'rate_limited') return 'form.translateRateLimited';
  return 'form.translateError';
}
```

Run uuesti: PASS.

- [ ] **Step 5: Kirjuta `BiographySection` komponent**

`src/prosopography/components/personForm/BiographySection.tsx` — keeletabid ET | EN,
kummalgi `MarkdownEditor`, tõlkenupp, kinnitusruut, vananemishoiatus. AA-kirje EI ole
siin (ta on isikulehe lugemisplokk, ADR 0039).

Props:

```tsx
interface Props {
  draft: FormDraft;
  set: (patch: Partial<FormDraft>) => void;
  personId: string | null;
  anchors: { et: TranslationAnchor | null; en: TranslationAnchor | null };
  token: string;
  canEdit: boolean;
}
```

Nõuded, mille komponent peab täitma — **kõik otsused tulevad `translationFlow`-st,
komponent ei kirjuta oma loogikat**:

1. **Vananemishoiatus.** `useEffect` arvutab `textHash(draft[OTHER_FIELD[tab]])` ja
   annab selle `isAnchorStale(anchors[tab], hash)`-ile. `true` → kuva
   `t('form.sourceChanged')` ja selle kõrval nupp `t('form.viewSourceDiff')`.
2. **Tõlkenupp** `t('form.translateFromEstonian')` / `t('form.translateFromEnglish')`:
   - `needsOverwriteConfirm(draft[siht])` → `window.confirm(t('form.translateOverwriteConfirm'))`;
     `false` korral **päringut ei saadeta**;
   - enne päringut `const snapshot = { biography_et: draft.biography_et, biography_en: draft.biography_en }`;
     hoia värsket draft'i `useRef`-is, et vastuse saabudes näha praegust seisu;
   - `translateText(draft[lähe], lähteKeel, sihtKeel, token)`;
   - vastuse saabudes `isStaleResult(snapshot, refi praegune)` → **ära kirjuta**,
     kuva `t('form.translateStaleResult')` ja nupp `t('form.translateApplyAnyway')`,
     mis rakendab tulemuse käsitsi;
   - muidu `set({ [siht]: tolge, [CONFIRM_KEY[siht]]: true })` — ruut märgitakse, sest
     tõlge tehti demonstreeritavalt sellest lähtetekstist ja hetktõmmise valve kinnitas,
     et kumbki väli ei muutunud;
   - viga: `catch (e)` → `TranslateFailed` korral `t(translateErrorKey(e.kind))`,
     muidu `t('form.translateError')`.
3. **Kinnitusruut** — `t('form.confirmMatchesEstonian')` EN-tabil,
   `t('form.confirmMatchesEnglish')` ET-tabil; seob `draft.confirm_en` / `draft.confirm_et`.
4. **Teksti muutmine:**

```tsx
  onChange={v => set({ [tab]: v, ...confirmClearPatch(tab, draft) } as Partial<FormDraft>)}
```

   `confirmClearPatch` hoolitseb ise selle eest, et ainult LÄHTE muutmine kustutab märke.
5. **„Vaata, mis muutus"** — `fetchSourceDiff(personId, tab, token)`;
   `found: false` → `t('form.sourceVersionNotFound')`, muidu plokk pealkirjaga
   `t('form.sourceVersionTitle')` ja vana tekst praeguse kõrval.

- [ ] **Step 6: Kustuta R2 pärandväljad ja ühenda leht**

`src/prosopography/types.ts` — **kustuta** ülesandes 14 ajutiselt alles jäetud read:

```ts
  /** @deprecated Kaob ülesandes 20. … */
  biography_snippet?: string;
```
```ts
  /** @deprecated Kaob ülesandes 20. … */
  biography?: string | null;
```

Kui typecheck pärast seda kukub, on mõni tarbija üle viimata — leia ja paranda,
ära pane välja tagasi.

`src/prosopography/pages/PersonEditPage.tsx` — asenda read 617–629:

```tsx
        {/* ── Elulugu (ET | EN) ── */}
        <BiographySection
          draft={draft}
          set={set}
          personId={id ?? null}
          anchors={{
            et: original?.biography_et_src ?? null,
            en: original?.biography_en_src ?? null,
          }}
          token={token}
          canEdit={!!canEdit}
        />
```

- [ ] **Step 7: Kõik frontendi väravad**

Run: `npx vitest run && npm run typecheck && npm run lint:ci && npm run build`
Expected: kõik PASS. `lint:ci` lävi on `--max-warnings 49` — kui uusi hoiatusi tekkis,
paranda need, **ära tõsta läve**.

- [ ] **Step 8: Commit**

```bash
git add src/prosopography/utils/textHash.ts \
        src/prosopography/utils/translationFlow.ts \
        src/prosopography/utils/__tests__/textHash.test.ts \
        src/prosopography/utils/__tests__/translationFlow.test.ts \
        src/prosopography/components/personForm/BiographySection.tsx \
        src/prosopography/types.ts \
        src/prosopography/pages/PersonEditPage.tsx
git commit -m "feat(prosopo): eluloo keeletabid, tõlkenupp ja kinnitusruut vormis"
```

---

### Task 21: ADR 0039 ja dokumentatsiooni uuendus

Uus invariant dokumenteeritakse ADR-i, mitte ainult vestlusesse (CLAUDE.md töökord).

**Files:**
- Create: `docs/decisions/0039-sisuvalja-keel-on-valjanimes.md`
- Modify: `CLAUDE.md` (Invariandid, Andmeasukohad)
- Modify: `docs/decisions/README.md` (ADR-register)

**Interfaces:**
- Consumes: kõik eelnevad ülesanded
- Produces: —

- [ ] **Step 1: Kirjuta ADR 0039**

`docs/decisions/0039-sisuvalja-keel-on-valjanimes.md` — järgi ADR 0038 kuju
(Kontekst → Otsus → Tagajärjed → Alternatiivid). Sisu, mis SEAL PEAB olema:

- **Kontekst:** liides kahes keeles, sisu ei ole. `biography` kandis kahte eri asja:
  308 masinkopeeritud AA-kirjet (valdavalt saksakeelsete lühenditega) ja 63 inimese
  kirjutatud proosalugu. Mõõdetud 2026-09-10.
- **Otsus 1 — keel on väljanimes.** `biography_et`, `biography_en`, `aa_raw`;
  `biography` kaob skeemist. Ükski keeleväli ei ole „baas".
- **Otsus 2 — ankur on kinnituse kirje, mitte salvestamise kõrvalmõju.** Kui ankur
  uueneks iga salvestusega, kustutaks EN-kirjavea parandus hoiatuse ka siis, kui ET-s
  muutus vahepeal sünniaasta. `null` tähendab „seost ei ole salvestatud", MITTE
  „see on originaal".
- **Otsus 3 — räsi on ankur, commit ei ole.** Salvestuseelne HEAD osutaks vale
  lähteversioonile, kui ET ja EN salvestatakse korraga.
- **Otsus 4 — indeks kannab iga allika kohta oma katget; varuvariandi valib vaade.**
  Muidu võib „ingliskeelses" katkes olla eestikeelne tekst ja kaart ei saa ühtki ausat
  silti valida.
- **Otsus 5 — ühendamisel ankur ei kandu kaasa.** Kahtluse korral `null`: kaotatud
  kinnitus on üks märkeruudu vajutus, vale kinnitus on vaikne viga.
- **Otsus 6 — pärandväli tekitatakse uuesti, kui teda ei blokeeri.** `update_person`
  teeb `person.update(data)`; vana avatud vorm saadaks `biography` tagasi ka pärast
  passi B. Identne → vaikselt maha, erinev → 409.
- **Tagajärjed:** `GET /prosopography/{id}` kuju MUUTUS (avalik endpoint);
  expand–migrate–contract kuus sammu; MCP-pakett uuendatakse eraldi tempos.
- **Alternatiiv, mis kaalutud ja kõrvale jäetud:** `biography` jääb „originaali"
  pesaks + juurde `biography_en`. Kukub kahe küsimuse peale: keelemärge oleks vale
  kohe 308 saksakeelse kirje kohta, ja ingliskeelsena kirjutatud sissekandel ei oleks
  kohta.

- [ ] **Step 2: Lisa ADR registrisse**

`docs/decisions/README.md` — lisa rida olemasoleva tabeli/loendi kuju järgi:

```
| 0039 | Sisuvälja keel on väljanimes | 2026-09-10 | vastu võetud |
```

- [ ] **Step 3: Uuenda CLAUDE.md**

„Invariandid" sektsiooni, `**Markdown (ADR 0008)**` ploki kõrvale:

```markdown
**Eluloo keeleväljad (ADR 0039)** — sisuvälja keel on VÄLJANIMES: `biography_et`,
`biography_en`, `aa_raw`. `biography` on skeemist eemaldatud ja `update_person`
lükkab ta tagasi (identne → vaikselt maha, erinev → 409). Vananemisankur
(`biography_et_src` / `biography_en_src`) kirjutatakse AINULT selgesõnalise
kinnituse peale (`_confirm_translation`) ja kannab **teise keele** teksti räsi;
`null` = „seost ei ole salvestatud", mitte „originaal". Ankru pop kliendi
sisendist on kohustuslik. Indeks kannab NELJA katget
(`biography_snippet_et/_en`, `notes_snippet`, `aa_snippet`) — varuvariandi valib
VAADE (`biographyChain.ts`), mitte indeks. AA-kirje ei ole KUNAGI eluloo
varuvariant, aga on katke ahela lõpp.
```

„Andmeasukohad" all `data/config/` kirjelduses ei muutu midagi (kaardifailid on
samas kohas); „Domeen" sektsiooni lisa rida:

```markdown
**Album Academicumi toorik** — `aa_raw` on KIRJE, mitte tekst: masinkopeeritud
struktureeritud allikakirje saksakeelsete lühenditega. Seda **ei tõlgita**,
ta ei ole eluloo varuvariant ja vormis kirjutamiseks teda ei avata.
```

- [ ] **Step 4: Kontrolli, et dokumendid on järjekindlad**

Run: `grep -rn "biography" CLAUDE.md docs/decisions/README.md`
Expected: ainult uued read; ühtki viidet vanale ühele `biography` väljale ei ole alles

- [ ] **Step 5: Commit**

```bash
git add docs/decisions/0039-sisuvalja-keel-on-valjanimes.md \
        docs/decisions/README.md CLAUDE.md
git commit -m "docs(adr): 0039 — sisuvälja keel on väljanimes, ankur on kinnituse kirje"
```

---

### Task 22: Avaldamine (expand–migrate–contract)

**Ei ole koodiülesanne** — see on kuueastmeline juurutus, mille järjekord EI OLE
valikuline. Iga samm on eraldi kontrollitav ja pöörduv kuni sammuni 5.

**Files:** —

**Interfaces:**
- Consumes: ülesanded 1–21
- Produces: töötav tootmine

- [ ] **Step 1: Enne kõike — kontrolli, mis on lennus**

```bash
ssh vutt 'docker logs --tail 50 vutt-backend'
```

Kontrolli, et upload/re-OCR tööd ei ole lennus (`server_update.sh` kontrollib ise, aga
migratsioon jookseb enne seda). Kontrolli ka `git status` põhikaustas — ära vii kellegi
teise tööd maha.

- [ ] **Step 2: Migratsioon, pass A — kuivkäivitus ja ülevaatus**

```bash
ssh vutt
docker exec vutt-backend python3 scripts/migrate_biography_language_fields.py \
    --mapping /data/config/biography_mapping.json
```

Vaata aruanne läbi — **lipuga read on alguses**. Paranda vajadusel `target` väli
vastendusfailis. Oodatav suurusjärk: ~371 kirjet, neist ~308 `aa_raw` ja ~63 elulugu.
Kui numbrid erinevad oluliselt, PEATU ja uuri, miks.

- [ ] **Step 3: Migratsioon, pass A — rakendamine**

```bash
docker exec vutt-backend python3 scripts/migrate_biography_language_fields.py \
    --apply --pass a --mapping /data/config/biography_mapping.json --commit
```

`biography` JÄÄB ALLES — vana kood loeb edasi, midagi ei kao. Kontrolli:

```bash
ssh vutt 'cd ~/VUTT/data && git log --oneline -1 && git show --stat HEAD | tail -5'
```

- [ ] **Step 4: Backend deploy**

```bash
ssh vutt && cd ~/VUTT
./scripts/server_update.sh --no-cache     # Python muutus → --no-cache KOHUSTUSLIK
docker logs vutt-backend | tail -30       # NB: `| head` tapaks käsu SIGPIPE-ga
```

Kontrolli, et backend käivitus (`GEMINI_TRANSLATE_MODEL` puudumine ei tohi käivitust
peatada — tal on vaikeväärtus).

- [ ] **Step 5: Frontend deploy + indeksite taastamine**

```bash
# LOKAALSES masinas
npm run build && rsync -avz --delete dist/ vutt:~/VUTT/dist/
# `.br`/`.gz` PEAVAD kaasa minema — nginx serveerib need brotli_static/gzip_static kaudu
```

```bash
# serveris — katked tekivad read-modelisse (ADR 0007)
curl -X POST -H "Authorization: Bearer <ADMIN_TOKEN>" \
     http://localhost:8002/prosopography/admin/rebuild-indices
```

- [ ] **Step 6: Kontroll tootmises — ENNE pöördumatut sammu**

Kontrolli KOLM kihti eraldi (konteiner, nginx, brauseri vahemälu):

1. **63 elulugu on nähtavad** — ava mõni proosa-eluloo kaart, tekst on eluloo plokis.
2. **AA-plokid on nähtavad** — ava AA-toorikuga kaart, kirje on omaette plokis
   pealkirjaga „Album Academicumi kirje", eluloo plokki ei ole.
3. **Katked nimekirjas** — `/persons` näitab katkeid; AA-kaartidel on „AA-kirje" märge.
4. **Tõlge töötab** — toimetajana ava kaart, vajuta „Tõlgi eesti keelest", mustand tuleb.
5. **Kinnitus töötab** — märgi ruut, salvesta, muuda lähteteksti → hoiatus tekib,
   „Vaata, mis muutus" näitab vana teksti.
6. **SEO-kirjeldus** — `curl -A "Googlebot" https://vutt.utlib.ut.ee/persons/<id>` ja
   kontrolli, et kirjeldus on elulugu, mitte AA-toorik.

**Kui midagi on katki: PEATU siin.** Sammud 1–5 on pöörduvad (`biography` on veel alles).

- [ ] **Step 7: Migratsioon, pass B — contract**

```bash
docker exec vutt-backend python3 scripts/migrate_biography_language_fields.py \
    --apply --pass b --mapping /data/config/biography_mapping.json --commit
```

See puudutab KÕIKI ~2389 kaarti (2018 neist ainult `"biography": null` võtme
eemaldamiseks). Skript peatub, kui leiab täidetud, aga migreerimata kirje.

- [ ] **Step 8: MCP-paketi uuendus**

Eraldi juurutus omas tempos (pipx-venv). Kuni selleni näitab vana MCP `search_persons`
katkeid tühjalt — **kosmeetiline kadu, mitte rike**, sest indeksist kadus võti
`biography_snippet`. `get_person` töötab mõlemal pool.

```bash
pipx reinstall vutt-mcp    # või projekti README juhis
```

- [ ] **Step 9: Uuenda mälu**

Kirjuta `~/.claude/projects/-home-mf-LLM-VUTT/memory/` alla uus `project_`-fail
(ADR 0039, mis läks tootmisse ja millal, mis jäi lahtiseks: SEO kakskeelsus,
`biography_de`, masintõlke päritolu lipp) ja lisa rida `MEMORY.md`-sse.

---

## Lahtised punktid (spekist — EI blokeeri teostust)

1. **SEO-prerender kakskeelseks.** `metadata_handler.py` on läbivalt eestikeelne; siin
   parandatakse ainult väljakaardistus (ülesanne 9). Ingliskeelne elulugu jääb Google'i
   eest varju, kuni bot-tee keelevalik, `hreflang` ja kaks URL-kuju on omaette tööna tehtud.
2. **`biography_de`** — mahub mustrisse; nõuab tüübi-, vormi- ja indeksimuudatusi, aga
   mitte migratsiooni ega otsust.
3. **Masintõlke päritolu lipp** — teadlikult EI salvestata (spekk, otsus 2). Kui vaja
   läheb, on see eraldi väli, mitte ankru ülekoormamine.
