# Gemini re-OCR superadminile — Faas A teostusplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Superadmin saab Workspace'i redaktoris ja Manage-lehel käivitada re-OCR-i Google Gemini API kaudu, tulemus liigub täpselt sama teed pidi kui LOSSi re-OCR (`.ocr` staging → `apply` → git → Meili).

**Architecture:** Pakkuja on olemasoleva job-mudeli uus dimensioon, mitte paralleelne süsteem. Job-kirjesse tuleb `provider: "loss" | "gemini"`; `server/ocr_providers/gemini.py` on puhas olekuta klient (pildibaidid + juhis → tekst); kogu olek, püsivus, katkestamine ja staatus jäävad `reocr_ops`-i. Mõlemad teed ühinevad `_write_ocr_file` juures ja kõik sellest allapoole jääb muutmata.

**Tech Stack:** FastAPI (Python 3.9 ühilduvus kohustuslik), `requests`, `Pillow`, pytest; React 19 + TypeScript + Tailwind, vitest, i18next.

**Spec:** `docs/superpowers/specs/2026-09-01-gemini-reocr-superadmin-design.md`

## Skoop: see plaan katab speki teostusjärjekorra punktid 1–6

Spekk jagab töö kaheks ja määrab katkestuskoha: **„Punktid 1–6 on iseseisvalt kasutuskõlblik tulemus; 7–9 on iteratsioonisilmus, mille väärtus selgub alles siis, kui punkt 6 on päris materjali peal proovitud. Kui töö tuleb kuskilt katkestada, siis 6. ja 7. vahelt."**

Seda plaani järgides saab töötava Gemini re-OCR-i. **Faas B** (teosepõhine juhis `state/ocr_prompts.json`-is, `prompt_override`, few-shot näited, `GeminiPromptPanel`) saab oma plaani **pärast seda, kui Faas A on päris käsikirjamaterjali peal mõõdetud** — sest just see mõõtmine ütleb, kas ja millist iteratsioonisilmust vaja on.

Faasi A klient võtab `few_shot` parameetri juba vastu (vaikimisi tühi), et Faas B ei nõuaks signatuuri muutmist. Muud few-shot-torustikku Faasis A ei ehitata.

## Global Constraints

Need kehtivad **igas** allolevas ülesandes.

- **Python 3.9 ühilduvus:** `Optional[dict]`, mitte `dict | None`. Ka `Tuple`, `List`, `Sequence` tuleb `typing`-ust.
- **Koodikommentaarid eesti keeles.**
- **Blokeeriv I/O `async def` sees on keelatud** (ADR 0002) — kas sync `def` route või `run_in_threadpool`.
- **i18n (ADR 0011):** `fallbackLng` on VÄLJAS. Iga uus tõlkevõti tuleb lisada **`src/locales/et/` JA `src/locales/en/` korraga**, muidu katkeb build. Valvur: `localeParity.test.ts`.
- **Rollikontroll ALATI `is_at_least()` / `isAtLeast()`**, mitte `role == "superadmin"`.
- **nginx `/api/files/` proksib KÕIK backend-teed avalikult** — iga uus endpoint peab olema `/admin/` prefiksi all **ja** rollikontrolliga.
- **`GEMINI_API_KEY` ei tohi jõuda ühessegi API-vastusesse, logireale ega veateatesse.** Päringu headereid ei logita kunagi.
- **Iga Gemini päring kannab `store=false`.** Interactions API salvestab vaikimisi (`store=true`); tasulisel tasandil 55 päeva.
- **Sampling-parameetreid (`temperature`, `top_p`, `top_k`) ei saadeta** — Gemini 3.x-il deprecated. Kasutatakse `thinking_level`.
- **Väravad enne iga commiti:** `.venv/bin/pytest tests/` (backend), `npm run typecheck` + `npm test` (frontend). `npm run lint:ci` lävi on `--max-warnings 55` — parandades LANGETA arvu, ära tõsta.
- **Ära muuda** `server/reocr_apply.py`, `server/git_ops.py`, `server/meilisearch_ops.py` ega ühtki rida `.ocr` faili rakendamisest allpool.

---

## Failistruktuur

| Fail | Vastutus | Ülesanne |
|---|---|---|
| `server/ocr_prompts.py` | **Loo.** Juhiste tekstid + väljundi puhastus + tüübi→juhis valik | 1 |
| `tests/test_ocr_prompts.py` | **Loo.** | 1 |
| `server/ocr_providers/__init__.py` | **Loo.** Tühi pakett | 2 |
| `server/ocr_providers/gemini.py` | **Loo.** Olekuta HTTP-klient: pilt+juhis → (tekst, usage) | 2 |
| `tests/test_gemini_client.py` | **Loo.** | 2 |
| `server/config.py` | **Muuda.** Üheksa `GEMINI_*` seadet + `gemini_enabled()` | 3 |
| `.env.example`, `docker-compose.yml` | **Muuda.** Samad nimed — compose loetleb nimeliselt | 3 |
| `tests/test_gemini_config.py` | **Loo.** | 3 |
| `server/reocr_ops.py` | **Muuda.** `provider` dimensioon, Gemini töölõimed, poll-harud | 4 |
| `tests/test_gemini_provider_routing.py` | **Loo.** | 4 |
| `server/routers/reocr.py` | **Muuda.** `provider` body-väli + superadmin-värav | 5 |
| `server/routers/admin.py` | **Muuda.** `GET /admin/ocr/providers` | 5 |
| `tests/conftest.py` | **Muuda.** Lisa `superadmin` kasutaja | 5 |
| `tests/test_gemini_router.py` | **Loo.** | 5 |
| `src/services/workApi.ts` | **Muuda.** `getOcrProviders`, `provider` parameetrid | 6 |
| `src/components/editor/useReOcr.ts` | **Muuda.** `provider` parameeter | 6 |
| `src/components/editor/HistoryTab.tsx` | **Muuda.** Teine rida superadminile | 6 |
| `src/components/TextEditor.tsx`, `EditorInfoHistoryTabs.tsx` | **Muuda.** Propide läbiandmine | 6 |
| `src/pages/manage/PageActionBar.tsx` | **Muuda.** Teine nupp | 7 |
| `src/pages/WorkManage.tsx` | **Muuda.** `handleBatchReocr(provider)` | 7 |
| `src/locales/{et,en}/{workspace,manage}.json` | **Muuda.** Uued võtmed MÕLEMAS | 6, 7 |

---

## Task 1: Juhised ja väljundi puhastus

**Files:**
- Create: `server/ocr_prompts.py`
- Test: `tests/test_ocr_prompts.py`

**Interfaces:**
- Consumes: midagi (esimene ülesanne, ei sõltu millestki)
- Produces:
  - `GEMINI_PRINT_INSTRUCTION: str`, `GEMINI_HAND_INSTRUCTION: str`
  - `instruction_for(material_type: str) -> str` — `"print"`/`"hand"`, tundmatu → `ValueError`
  - `strip_model_output(text: str) -> str`

### Enne alustamist: too juhiste tekstid LOSSist

**ÄRA kopeeri teksti spekist ega sellest plaanist.** LOSSi juhist muudeti 2026-09-01; võta see teostushetkel kehtiv:

```bash
ssh loss 'cat ~/Dokumendid/LLM/qwen3.5/scripts/prompt.py'
ssh loss 'stat -c "%y" ~/Dokumendid/LLM/qwen3.5/scripts/prompt.py'
```

`INSTRUCTION` → `GEMINI_PRINT_INSTRUCTION`, `KURRENT_INSTRUCTION` → `GEMINI_HAND_INSTRUCTION`, **sõna-sõnalt**.

Faili päisesse kirjuta (asenda kuupäev ja mtime päris väärtustega):

```python
"""OCR-juhised Gemini-teele.

TRÜKISE juhis on KOOPIA LOSSi failist `~/Dokumendid/LLM/qwen3.5/scripts/prompt.py`
(`INSTRUCTION`). Kopeeritud <KUUPÄEV>, lähtefaili mtime <MTIME>.
See on trükisel PARITEEDINÕUE: sama teost transkribeeritakse mõlema pakkujaga ja
tulemused peavad olema samas märgenduses. LOSSi juhise muutmisel tuleb see üle vaadata.

KÄSIKIRJA juhis on lähtekohana sama faili `KURRENT_INSTRUCTION`, aga TOHIB LOSS-ist
lahkneda ja seda arendatakse edasi siin. Põhjus on mudeliklass: `KURRENT_INSTRUCTION`
on fine-tuunitud mudeli TREENINGVORM (mudel tahab täpselt seda stringi), Gemini on
üldmudel, kellele juhis on ainus info. Käsikirja juhise triiv on ootuspärane, mitte viga.

Automaatset valvurit LOSSi vastu ei ole — LOSS ei ole VUTT-i jaoks runtime'is loetav.
"""
```

- [ ] **Step 1: Kirjuta kukkuv test**

`tests/test_ocr_prompts.py`:

```python
"""OCR-juhiste valik ja mudeli väljundi puhastus (Gemini-tee)."""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def test_instruction_for_valib_tuubi_jargi():
    from server.ocr_prompts import (
        GEMINI_HAND_INSTRUCTION,
        GEMINI_PRINT_INSTRUCTION,
        instruction_for,
    )
    assert instruction_for("print") == GEMINI_PRINT_INSTRUCTION
    assert instruction_for("hand") == GEMINI_HAND_INSTRUCTION


def test_instruction_for_tundmatu_tuup_viskab():
    """Vaikne fallback trükise juhisele oli LOSSi viga — siin kukume valjult."""
    from server.ocr_prompts import instruction_for
    with pytest.raises(ValueError):
        instruction_for("pilt")


def test_juhised_ei_ole_tuhjad_ega_samad():
    from server.ocr_prompts import GEMINI_HAND_INSTRUCTION, GEMINI_PRINT_INSTRUCTION
    assert len(GEMINI_PRINT_INSTRUCTION) > 200
    assert len(GEMINI_HAND_INSTRUCTION) > 200
    assert GEMINI_PRINT_INSTRUCTION != GEMINI_HAND_INSTRUCTION


def test_trukise_juhis_sisaldab_vutt_margendust():
    """Pariteedi ankur: kui see kaob, ei tule Gemini väljund enam VUTT-i kujul."""
    from server.ocr_prompts import GEMINI_PRINT_INSTRUCTION
    for marker in ("<i>", "<m>", "<pb/>", "⸗"):
        assert marker in GEMINI_PRINT_INSTRUCTION


def test_strip_eemaldab_markdown_koodiploki():
    from server.ocr_prompts import strip_model_output
    assert strip_model_output("```xml\nMus. 1309\n```") == "Mus. 1309"
    assert strip_model_output("```\ntekst\n```") == "tekst"


def test_strip_eemaldab_think_ploki():
    from server.ocr_prompts import strip_model_output
    assert strip_model_output("<think>arutlen</think>\nMus. 1309") == "Mus. 1309"
    assert strip_model_output("<think></think>tekst") == "tekst"


def test_strip_sailitab_tuhja_lehe_margendi():
    """[tühi lehekülg] on kokkulepitud märgend — LOSS ei eemalda seda ja meie ka mitte."""
    from server.ocr_prompts import strip_model_output
    assert strip_model_output("[tühi lehekülg]") == "[tühi lehekülg]"


def test_strip_sailitab_reastruktuuri():
    """Sedelkataloogi kirje read PEAVAD alles jääma — ainult otsas olev ws lõigatakse."""
    from server.ocr_prompts import strip_model_output
    assert strip_model_output("\nMus. 1309\nAlexander I.\n1806.\n") == (
        "Mus. 1309\nAlexander I.\n1806."
    )


def test_strip_sailitab_vutt_margenduse():
    from server.ocr_prompts import strip_model_output
    assert strip_model_output("<m>Chrysost.</m>\ntekst") == "<m>Chrysost.</m>\ntekst"
```

- [ ] **Step 2: Jooksuta test, veendu et kukub**

Run: `.venv/bin/pytest tests/test_ocr_prompts.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'server.ocr_prompts'`

- [ ] **Step 3: Kirjuta `server/ocr_prompts.py`**

Päis (vt ülal) + LOSSist toodud tekstid + see loogika:

```python
import re

GEMINI_PRINT_INSTRUCTION = """..."""   # LOSSi INSTRUCTION, sõna-sõnalt
GEMINI_HAND_INSTRUCTION = """..."""    # LOSSi KURRENT_INSTRUCTION, sõna-sõnalt

_INSTRUCTIONS = {
    "print": GEMINI_PRINT_INSTRUCTION,
    "hand": GEMINI_HAND_INSTRUCTION,
}


def instruction_for(material_type: str) -> str:
    """Juhis materjalitüübi järgi. Tundmatu tüüp on VIGA, mitte vaikne vaikeväärtus."""
    try:
        return _INSTRUCTIONS[material_type]
    except KeyError:
        raise ValueError("Tundmatu materjalitüüp: {!r}".format(material_type))


_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL)
_FENCE_OPEN_RE = re.compile(r"^```[a-zA-Z]*\n?")
_FENCE_CLOSE_RE = re.compile(r"\n?```$")


def strip_model_output(text: str) -> str:
    """Eemaldab mudeli süsteemiartefaktid: <think>-plokid ja markdown-koodipiirded.

    Sisemist reastruktuuri EI puudutata — sedelkataloogi kirje read on sisu.
    `[tühi lehekülg]` on kokkulepitud märgend ja jääb alles (LOSS käitub samamoodi).
    """
    text = _THINK_RE.sub("", text)
    text = _FENCE_OPEN_RE.sub("", text.strip())
    text = _FENCE_CLOSE_RE.sub("", text)
    return text.strip()
```

- [ ] **Step 4: Jooksuta testid, veendu et lähevad läbi**

Run: `.venv/bin/pytest tests/test_ocr_prompts.py -v`
Expected: PASS (9 testi)

- [ ] **Step 5: Commit**

```bash
git add server/ocr_prompts.py tests/test_ocr_prompts.py
git commit -m "feat(ocr): Gemini-tee juhised ja väljundi puhastus"
```

---

## Task 2: Gemini-klient

**Files:**
- Create: `server/ocr_providers/__init__.py`, `server/ocr_providers/gemini.py`
- Test: `tests/test_gemini_client.py`

**Interfaces:**
- Consumes: Task 1 `strip_model_output`
- Produces:
  - `class GeminiError(Exception)` — sõnum on kasutajale näidatav
  - `transcribe(image_bytes: bytes, instruction: str, few_shot: Sequence[Tuple[bytes, str]] = ()) -> Tuple[str, Dict[str, int]]`
  - Usage-dict võtmed: `input_tokens`, `output_tokens`, `thought_tokens`, `cached_tokens`, `total_tokens`
  - `build_payload(...) -> dict` (testimiseks avalik)

**Miks `few_shot` juba nüüd:** Faas B ei pea signatuuri muutma. Faasis A antakse alati tühi.

- [ ] **Step 1: Kirjuta kukkuv test**

`tests/test_gemini_client.py`:

```python
"""Gemini OCR-kliendi leping: päringu kuju, usage normaliseerimine, vead, pildi lagi."""
import io
import sys
from pathlib import Path

import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def _jpeg(width=100, height=100) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (width, height), (128, 128, 128)).save(buf, "JPEG", quality=95)
    return buf.getvalue()


def test_payload_kannab_store_false():
    """Interactions API salvestab VAIKIMISI. Skanne ei tohi Google'isse seisma jääda."""
    from server.ocr_providers.gemini import build_payload
    payload = build_payload(_jpeg(), "JUHIS", (), "gemini-3.7-flash", "low")
    assert payload["store"] is False


def test_payload_ei_sisalda_sampling_parameetreid():
    """temperature/top_p/top_k on Gemini 3.x-il deprecated."""
    from server.ocr_providers.gemini import build_payload
    payload = build_payload(_jpeg(), "JUHIS", (), "gemini-3.7-flash", "low")
    for key in ("temperature", "top_p", "top_k", "topP", "topK"):
        assert key not in payload


def test_payload_kannab_thinking_level_ja_mudelit():
    from server.ocr_providers.gemini import build_payload
    payload = build_payload(_jpeg(), "JUHIS", (), "gemini-3.7-flash", "low")
    assert payload["model"] == "gemini-3.7-flash"
    assert "low" in str(payload)


def test_payload_ei_sisalda_model_rolli_samme():
    """Näited on ÜKS user-input, mitte sünteetiline vestlusajalugu (dokumenteerimata)."""
    from server.ocr_providers.gemini import build_payload
    payload = build_payload(_jpeg(), "JUHIS", ((_jpeg(), "näite tekst"),),
                            "gemini-3.7-flash", "low")
    def roles(node):
        if isinstance(node, dict):
            for k, v in node.items():
                if k == "role":
                    yield v
                for r in roles(v):
                    yield r
        elif isinstance(node, list):
            for item in node:
                for r in roles(item):
                    yield r
    assert "model" not in set(roles(payload))


def test_payload_lopeb_tekstiga_mitte_pildiga():
    """Sihtpilt ei tohi olla viimane element — API-versioonide kindlus."""
    from server.ocr_providers.gemini import build_payload
    payload = build_payload(_jpeg(), "JUHIS", (), "gemini-3.7-flash", "low")
    last = payload["input"][-1]
    assert last.get("type") == "text"
    assert last.get("text", "").strip()


def test_naited_tulevad_enne_sihtpilti():
    """Stabiilne prefiks: juhis → näited → sihtpilt. Implicit caching sõltub sellest."""
    from server.ocr_providers.gemini import build_payload
    payload = build_payload(_jpeg(), "JUHIS", ((_jpeg(), "NÄITETEKST"),),
                            "gemini-3.7-flash", "low")
    blob = payload["input"]
    naite_idx = next(i for i, b in enumerate(blob)
                     if b.get("type") == "text" and "NÄITETEKST" in b.get("text", ""))
    pilte = [i for i, b in enumerate(blob) if b.get("type") == "image"]
    assert pilte[-1] > naite_idx      # sihtpilt on viimane pilt, näite teksti järel


def test_transcribe_normaliseerib_usage(monkeypatch):
    """reocr_ops ei tohi kunagi näha API enda väljanimesid."""
    import server.ocr_providers.gemini as gem

    class Resp:
        status_code = 200
        headers = {"content-type": "application/json"}
        def json(self):
            return {
                "output": [{"content": [{"type": "text", "text": "Mus. 1309"}]}],
                "usage": {"total_input_tokens": 11, "total_output_tokens": 22,
                          "total_thought_tokens": 3, "total_cached_tokens": 4,
                          "total_tokens": 40},
            }
        text = ""

    monkeypatch.setattr(gem.requests, "post", lambda *a, **kw: Resp())
    monkeypatch.setattr(gem, "_api_key", lambda: "x")
    text, usage = gem.transcribe(_jpeg(), "JUHIS")
    assert text == "Mus. 1309"
    assert usage == {"input_tokens": 11, "output_tokens": 22, "thought_tokens": 3,
                     "cached_tokens": 4, "total_tokens": 40}


def test_transcribe_rakendab_strip_model_output(monkeypatch):
    import server.ocr_providers.gemini as gem

    class Resp:
        status_code = 200
        headers = {"content-type": "application/json"}
        def json(self):
            return {"output": [{"content": [{"type": "text",
                                             "text": "```\nMus. 1309\n```"}]}],
                    "usage": {}}
        text = ""

    monkeypatch.setattr(gem.requests, "post", lambda *a, **kw: Resp())
    monkeypatch.setattr(gem, "_api_key", lambda: "x")
    text, _ = gem.transcribe(_jpeg(), "JUHIS")
    assert text == "Mus. 1309"


def test_429_korratakse_ja_onnestub(monkeypatch):
    import server.ocr_providers.gemini as gem
    calls = {"n": 0}

    class Resp:
        def __init__(self, status):
            self.status_code = status
            self.headers = {"content-type": "application/json"}
            self.text = "{}"
        def json(self):
            return {"output": [{"content": [{"type": "text", "text": "ok"}]}],
                    "usage": {}}

    def fake_post(*a, **kw):
        calls["n"] += 1
        return Resp(429 if calls["n"] == 1 else 200)

    monkeypatch.setattr(gem.requests, "post", fake_post)
    monkeypatch.setattr(gem, "_api_key", lambda: "x")
    monkeypatch.setattr(gem.time, "sleep", lambda _s: None)
    text, _ = gem.transcribe(_jpeg(), "JUHIS")
    assert text == "ok"
    assert calls["n"] == 2


def test_429_ammendumisel_viskab_geminierrori(monkeypatch):
    import server.ocr_providers.gemini as gem

    class Resp:
        status_code = 429
        headers = {"content-type": "application/json"}
        text = '{"error": {"code": 429, "status": "RESOURCE_EXHAUSTED", "message": "liiga palju"}}'
        def json(self):
            return {"error": {"code": 429, "status": "RESOURCE_EXHAUSTED",
                              "message": "liiga palju"}}

    monkeypatch.setattr(gem.requests, "post", lambda *a, **kw: Resp())
    monkeypatch.setattr(gem, "_api_key", lambda: "x")
    monkeypatch.setattr(gem.time, "sleep", lambda _s: None)
    with pytest.raises(gem.GeminiError) as exc:
        gem.transcribe(_jpeg(), "JUHIS")
    assert "RESOURCE_EXHAUSTED" in str(exc.value)


def test_veateade_ei_sisalda_api_votit(monkeypatch):
    import server.ocr_providers.gemini as gem

    class Resp:
        status_code = 500
        headers = {"content-type": "application/json"}
        text = '{"error": {"message": "sisemine viga"}}'
        def json(self):
            return {"error": {"message": "sisemine viga"}}

    monkeypatch.setattr(gem.requests, "post", lambda *a, **kw: Resp())
    monkeypatch.setattr(gem, "_api_key", lambda: "SALAJANE-VOTI-123")
    monkeypatch.setattr(gem.time, "sleep", lambda _s: None)
    with pytest.raises(gem.GeminiError) as exc:
        gem.transcribe(_jpeg(), "JUHIS")
    assert "SALAJANE-VOTI-123" not in str(exc.value)


def test_vaike_pilt_saadetakse_muutmata():
    """Pariteet LOSS-iga: tema saab sama 300 DPI faili."""
    import base64
    from server.ocr_providers.gemini import build_payload
    raw = _jpeg(100, 100)
    payload = build_payload(raw, "JUHIS", (), "gemini-3.7-flash", "low")
    pildid = [b for b in payload["input"] if b.get("type") == "image"]
    assert base64.b64decode(pildid[0]["data"]) == raw


def test_liiga_suur_paring_ei_lahe_apisse(monkeypatch):
    """Terminaltingimus: kui skaleerimine ei aita, kutset EI tehta."""
    import server.ocr_providers.gemini as gem
    monkeypatch.setattr(gem, "MAX_REQUEST_BYTES", 10)   # kõik on liiga suur
    monkeypatch.setattr(gem, "_api_key", lambda: "x")

    def ei_tohi_kutsuda(*a, **kw):
        raise AssertionError("API-kutset ei tohi teha")

    monkeypatch.setattr(gem.requests, "post", ei_tohi_kutsuda)
    with pytest.raises(gem.GeminiError) as exc:
        gem.transcribe(_jpeg(4000, 4000), "JUHIS")
    assert "request_too_large" in str(exc.value)
```

- [ ] **Step 2: Jooksuta test, veendu et kukub**

Run: `.venv/bin/pytest tests/test_gemini_client.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'server.ocr_providers'`

- [ ] **Step 3: Kirjuta klient**

`server/ocr_providers/__init__.py` — tühi fail.

`server/ocr_providers/gemini.py`:

```python
"""Google Gemini OCR-klient. OLEKUTA: sisse pildibaidid + juhis, välja tekst + usage.

Ei loe `_metadata.json`-it ega `state/`-i, ei tea `reocr_ops`-ist midagi — juhise
VALIK on kutsuja töö. Nii on klient testitav ilma failisüsteemita.

API kuju (tee, väljanimed) on TEOSTUSDETAIL. Leping on `transcribe()` signatuur ja
normaliseeritud usage-kuju — Google on API kuju vahetanud ja teeb seda uuesti.
"""
import base64
import io
import json
import time
from typing import Dict, List, Optional, Sequence, Tuple

import requests
from PIL import Image

from ..config import (
    GEMINI_API_KEY, GEMINI_MAX_REQUEST_BYTES, GEMINI_MAX_RETRIES,
    GEMINI_OCR_MODEL, GEMINI_REQUEST_TIMEOUT, GEMINI_THINKING_LEVEL, get_logger,
)
from ..ocr_prompts import strip_model_output

logger = get_logger(__name__)

API_URL = "https://generativelanguage.googleapis.com/v1beta/interactions"
MAX_REQUEST_BYTES = GEMINI_MAX_REQUEST_BYTES
TARGET_MAX_PX = 4000        # sihtpildi skaleerimislagi
EXAMPLE_MAX_PX = 2000       # näited on kontekst, mitte transkribeeritav objekt
SCALED_QUALITY = 90
LOPUJUHIS = "Transkribeeri ülalolev sihtpilt. Tagasta ainult transkriptsioon."


class GeminiError(Exception):
    """Kasutajale näidatav viga. Sõnum EI TOHI sisaldada võtit ega vastuse keha."""


def _api_key() -> str:
    """Eraldi funktsioon, et testid saaksid seda patchida ilma configi laadimata."""
    if not GEMINI_API_KEY:
        raise GeminiError("Gemini API võti puudub (GEMINI_API_KEY)")
    return GEMINI_API_KEY


def _scale(image_bytes: bytes, max_px: int) -> bytes:
    """Skaleerib pildi nii, et pikem külg on kuni max_px. Alati JPEG."""
    im = Image.open(io.BytesIO(image_bytes))
    im.thumbnail((max_px, max_px))
    buf = io.BytesIO()
    im.convert("RGB").save(buf, "JPEG", quality=SCALED_QUALITY)
    return buf.getvalue()


def _image_block(image_bytes: bytes) -> dict:
    return {"type": "image", "mime_type": "image/jpeg",
            "data": base64.b64encode(image_bytes).decode("ascii")}


def build_payload(image_bytes: bytes, instruction: str,
                  few_shot: Sequence[Tuple[bytes, str]],
                  model: str, thinking_level: str) -> dict:
    """Ehitab päringu keha. Järjekord on FIKSEERITUD (implicit caching sõltub sellest):
    juhis → näide 1 (pilt + tekst) → ... → sihtpilt → lõpujuhis.

    Näited on ÜHE user-inputi plokid, MITTE sünteetilised `model`-rolli sammud:
    stateless API nõuab, et mudeli sammud saadetaks tagasi täpselt sellisena, nagu
    need API-st tulid, ja meie `.txt` on inimese tekst, mitte Gemini varasem vastus.
    """
    blocks: List[dict] = [{"type": "text", "text": instruction}]
    for i, (naite_pilt, naite_tekst) in enumerate(few_shot, start=1):
        blocks.append({"type": "text", "text": "NÄIDE {}".format(i)})
        blocks.append(_image_block(naite_pilt))
        blocks.append({"type": "text",
                       "text": "Selle pildi korrektne transkriptsioon:\n{}\n"
                               "LÕPP NÄIDE {}".format(naite_tekst, i)})
    blocks.append({"type": "text", "text": "TRANSKRIBEERI JÄRGMINE PILT:"})
    blocks.append(_image_block(image_bytes))
    blocks.append({"type": "text", "text": LOPUJUHIS})
    return {
        "model": model,
        "store": False,                      # vaikimisi on True — vt ADR/spekk
        "thinking_level": thinking_level,
        "input": blocks,
    }


def _payload_size(payload: dict) -> int:
    return len(json.dumps(payload).encode("utf-8"))


def _fit_payload(image_bytes: bytes, instruction: str,
                 few_shot: Sequence[Tuple[bytes, str]],
                 model: str, thinking_level: str) -> dict:
    """Mahutab päringu eelarvesse. Kolm astet: nagu on → näited alla → sihtpilt alla.

    Mõõdetakse VALMIS serialiseeritud payload'i, mitte pildibaitide summat: API 20 MB
    lagi katab kogu request'i (pildid + juhis + näidete tekstid + JSON overhead).
    """
    payload = build_payload(image_bytes, instruction, few_shot, model, thinking_level)
    if _payload_size(payload) <= MAX_REQUEST_BYTES:
        return payload

    if few_shot:
        few_shot = [(_scale(p, EXAMPLE_MAX_PX), t) for p, t in few_shot]
        payload = build_payload(image_bytes, instruction, few_shot, model, thinking_level)
        logger.info("Gemini: näited skaleeritud (%d px)", EXAMPLE_MAX_PX)
        if _payload_size(payload) <= MAX_REQUEST_BYTES:
            return payload

    scaled = _scale(image_bytes, TARGET_MAX_PX)
    payload = build_payload(scaled, instruction, few_shot, model, thinking_level)
    logger.info("Gemini: sihtpilt skaleeritud %d → %d baiti",
                len(image_bytes), len(scaled))
    if _payload_size(payload) <= MAX_REQUEST_BYTES:
        return payload

    raise GeminiError(
        "request_too_large: päring ei mahu {} baiti ka pärast skaleerimist".format(
            MAX_REQUEST_BYTES))


def _error_summary(response) -> str:
    """Vea kokkuvõte LOGIMISEKS ja kasutajale. Vastuse keha EI dumbita.

    200-vastus ootamatu kujuga võib sisaldada transkribeeritud teksti; veakeha
    lõikamine logisse muutub aastatega vaikselt sisulekkeks.
    """
    try:
        err = (response.json() or {}).get("error") or {}
        osad = [str(err.get(k)) for k in ("code", "status", "message") if err.get(k)]
        if osad:
            return "HTTP {}: {}".format(response.status_code, " ".join(osad))
    except (ValueError, AttributeError):
        pass
    return "HTTP {} (vastus ei ole parsitav JSON, {} baiti)".format(
        response.status_code, len(getattr(response, "text", "") or ""))


def _normalize_usage(raw: Optional[dict]) -> Dict[str, int]:
    """API usage → VUTT-i kuju. reocr_ops ei tohi API väljanimesid kunagi näha."""
    raw = raw or {}
    return {
        "input_tokens": int(raw.get("total_input_tokens") or 0),
        "output_tokens": int(raw.get("total_output_tokens") or 0),
        "thought_tokens": int(raw.get("total_thought_tokens") or 0),
        "cached_tokens": int(raw.get("total_cached_tokens") or 0),
        "total_tokens": int(raw.get("total_tokens") or 0),
    }


def _extract_text(data: dict) -> str:
    osad = []
    for step in data.get("output") or []:
        for block in step.get("content") or []:
            if block.get("type") == "text" and block.get("text"):
                osad.append(block["text"])
    return "\n".join(osad)


def transcribe(image_bytes: bytes, instruction: str,
               few_shot: Sequence[Tuple[bytes, str]] = ()) -> Tuple[str, Dict[str, int]]:
    """Pilt + juhis (+ (pilt, tekst) näited) → (tekst, normaliseeritud usage)."""
    payload = _fit_payload(image_bytes, instruction, few_shot,
                           GEMINI_OCR_MODEL, GEMINI_THINKING_LEVEL)
    headers = {"x-goog-api-key": _api_key(), "Content-Type": "application/json"}

    viimane = ""
    for katse in range(GEMINI_MAX_RETRIES + 1):
        try:
            response = requests.post(API_URL, json=payload, headers=headers,
                                     timeout=GEMINI_REQUEST_TIMEOUT)
        except requests.RequestException as e:
            viimane = "ühenduse viga: {}".format(type(e).__name__)
            logger.warning("Gemini päring ebaõnnestus: %s", viimane)
        else:
            if response.status_code == 200:
                data = response.json()
                return (strip_model_output(_extract_text(data)),
                        _normalize_usage(data.get("usage")))
            viimane = _error_summary(response)
            logger.warning("Gemini päring ebaõnnestus: %s", viimane)
            if response.status_code not in (429, 500, 502, 503, 504):
                break
        if katse < GEMINI_MAX_RETRIES:
            time.sleep(2 ** katse)
    raise GeminiError("Gemini päring ebaõnnestus: {}".format(viimane))
```

- [ ] **Step 4: Jooksuta testid, veendu et lähevad läbi**

Run: `.venv/bin/pytest tests/test_gemini_client.py -v`
Expected: PASS (13 testi). Task 3 lisab configi konstandid — kui import kukub `ImportError`-iga `GEMINI_*` peale, tee Task 3 enne ja tule tagasi.

- [ ] **Step 5: Commit**

```bash
git add server/ocr_providers/ tests/test_gemini_client.py
git commit -m "feat(ocr): Gemini API klient (store=false, thinking_level, usage normaliseerimine)"
```

---

## Task 3: Konfiguratsioon

**Files:**
- Modify: `server/config.py`, `.env.example`, `docker-compose.yml`
- Test: `tests/test_gemini_config.py`

**Interfaces:**
- Consumes: midagi
- Produces: `GEMINI_API_KEY`, `GEMINI_OCR_MODEL`, `GEMINI_MAX_INFLIGHT_REQUESTS`, `GEMINI_THINKING_LEVEL`, `GEMINI_MAX_RETRIES`, `GEMINI_REQUEST_TIMEOUT`, `GEMINI_MAX_REQUEST_BYTES`, `GEMINI_MAX_PROMPT_BYTES`, `GEMINI_MAX_FEW_SHOT`, `gemini_enabled() -> bool`

**NB:** `GEMINI_MAX_PROMPT_BYTES` ja `GEMINI_MAX_FEW_SHOT` lisatakse juba nüüd (Faas B tarbib), et konfiguratsioon oleks üks kord paigas. `temperature` jaoks nime EI ole — 3.x-il deprecated, surnud haru.

- [ ] **Step 1: Kirjuta kukkuv test**

`tests/test_gemini_config.py`:

```python
"""Gemini seadete lugemine ja `enabled` semantika (ADR 0021: üks nimi ühe seade kohta)."""
import importlib
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

NIMED = ("GEMINI_API_KEY", "GEMINI_OCR_MODEL", "GEMINI_MAX_INFLIGHT_REQUESTS",
         "GEMINI_THINKING_LEVEL", "GEMINI_MAX_RETRIES", "GEMINI_REQUEST_TIMEOUT",
         "GEMINI_MAX_REQUEST_BYTES", "GEMINI_MAX_PROMPT_BYTES", "GEMINI_MAX_FEW_SHOT")


def _reload(monkeypatch, tmp_path, env):
    for n in NIMED:
        monkeypatch.delenv(n, raising=False)
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    (tmp_path / ".env").write_text("", encoding="utf-8")
    monkeypatch.setenv("VUTT_DOTENV_DIR", str(tmp_path))
    import server.config as cfg
    return importlib.reload(cfg)


def test_vaikevaartused(monkeypatch, tmp_path):
    cfg = _reload(monkeypatch, tmp_path, {})
    assert cfg.GEMINI_API_KEY == ""
    assert cfg.GEMINI_OCR_MODEL == "gemini-3.7-flash"
    assert cfg.GEMINI_THINKING_LEVEL == "low"
    assert cfg.GEMINI_MAX_INFLIGHT_REQUESTS == 4
    assert cfg.GEMINI_MAX_RETRIES == 3
    assert cfg.GEMINI_REQUEST_TIMEOUT == 120
    assert cfg.GEMINI_MAX_REQUEST_BYTES == 15 * 1024 * 1024
    assert cfg.GEMINI_MAX_PROMPT_BYTES == 8192
    assert cfg.GEMINI_MAX_FEW_SHOT == 3


def test_puuduv_voti_tahendab_valja_lulitatud(monkeypatch, tmp_path):
    """Puuduv võti on KEHTIV seisund, mitte konfiguratsiooniviga."""
    cfg = _reload(monkeypatch, tmp_path, {})
    assert cfg.gemini_enabled() is False


def test_voti_lulitab_sisse(monkeypatch, tmp_path):
    cfg = _reload(monkeypatch, tmp_path, {"GEMINI_API_KEY": "abc"})
    assert cfg.gemini_enabled() is True


def test_temperature_nime_ei_ole(monkeypatch, tmp_path):
    """3.x-il deprecated — surnud env-nime ei looda (ADR 0021)."""
    cfg = _reload(monkeypatch, tmp_path, {})
    assert not hasattr(cfg, "GEMINI_TEMPERATURE")


def test_check_production_secrets_ei_noua_gemini_votit(monkeypatch, tmp_path):
    """Gemini on valikuline funktsioon — puuduv võti ei tohi käivitust peatada."""
    cfg = _reload(monkeypatch, tmp_path, {
        "VUTT_ENV": "production",
        "MEILI_MASTER_KEY": "paris-voti",
        "IMAGE_TOKEN_SECRET": "paris-saladus",
    })
    assert cfg.check_production_secrets(exit_on_fail=False) is not False


def test_env_example_loetleb_koik_nimed():
    juur = Path(__file__).resolve().parents[1]
    tekst = (juur / ".env.example").read_text(encoding="utf-8")
    for n in NIMED:
        assert n in tekst, "{} puudub .env.example-ist".format(n)


def test_docker_compose_annab_nimed_konteinerisse():
    """Compose loetleb muutujad NIMELISELT — ainult .env ei jõua konteinerisse."""
    juur = Path(__file__).resolve().parents[1]
    tekst = (juur / "docker-compose.yml").read_text(encoding="utf-8")
    for n in NIMED:
        assert n in tekst, "{} puudub docker-compose.yml-ist".format(n)
```

- [ ] **Step 2: Jooksuta test, veendu et kukub**

Run: `.venv/bin/pytest tests/test_gemini_config.py -v`
Expected: FAIL — `AttributeError: module 'server.config' has no attribute 'GEMINI_API_KEY'`

- [ ] **Step 3: Lisa seaded `server/config.py`-sse**

`OCR_SERVER_PATH` rea järele:

```python
# =========================================================
# GEMINI (teine OCR-pakkuja, superadmin-only)
# =========================================================
# Puuduv võti = funktsioon välja lülitatud. See on KEHTIV seisund, mitte viga —
# `check_production_secrets()` seda ei nõua.
# `temperature`/`top_p`/`top_k` jaoks nime EI OLE: Gemini 3.x-il on need deprecated
# ja asendaja on `thinking_level`.
GEMINI_API_KEY = env("GEMINI_API_KEY", "")
GEMINI_OCR_MODEL = env("GEMINI_OCR_MODEL", "gemini-3.7-flash")
GEMINI_THINKING_LEVEL = env("GEMINI_THINKING_LEVEL", "low")
# Lagi kehtib TÖÖDE ÜLESELT — üks töö on järjestikune (vt spekk). Piir on VUTT-i
# poole ettevaatus, MITTE Google'i rate limit (konto on Tier 2, 1000–1500 RPM).
GEMINI_MAX_INFLIGHT_REQUESTS = int(env("GEMINI_MAX_INFLIGHT_REQUESTS", "4"))
GEMINI_MAX_RETRIES = int(env("GEMINI_MAX_RETRIES", "3"))
GEMINI_REQUEST_TIMEOUT = int(env("GEMINI_REQUEST_TIMEOUT", "120"))
# Hinnanguline SERIALISEERITUD päringu suurus, mitte pildibaitide summa:
# API 20 MB lagi katab kogu request'i.
GEMINI_MAX_REQUEST_BYTES = int(env("GEMINI_MAX_REQUEST_BYTES", str(15 * 1024 * 1024)))
GEMINI_MAX_PROMPT_BYTES = int(env("GEMINI_MAX_PROMPT_BYTES", "8192"))
GEMINI_MAX_FEW_SHOT = int(env("GEMINI_MAX_FEW_SHOT", "3"))


def gemini_enabled() -> bool:
    """Kas Gemini-tee on kasutatav? Ainus tingimus on seatud võti."""
    return bool(GEMINI_API_KEY)
```

- [ ] **Step 4: Lisa nimed `.env.example`-isse**

`# --- Upload / OCR-server ---` ploki järele:

```bash
# --- Gemini (teine OCR-pakkuja, ainult superadmin) ------------------------
# Tühi võti = funktsioon välja lülitatud (kehtiv seisund, mitte viga).
# NÕUE: mitteavalikku materjali tohib saata AINULT billing-enabled (Paid Tier)
# projekti võtmega — tasuta tasandil kasutatakse sisu Google'i toodete
# parandamiseks. See on `store=false`-ist eraldi ja sellest sõltumatu nõue.
GEMINI_API_KEY=
GEMINI_OCR_MODEL=gemini-3.7-flash
# low | medium | high. Mudeli enda vaikeväärtus oleks `medium`; OCR on
# tajuülesanne, mitte arutlusülesanne, ja thinking-tokenid on väljundikulu.
GEMINI_THINKING_LEVEL=low
GEMINI_MAX_INFLIGHT_REQUESTS=4
GEMINI_MAX_RETRIES=3
GEMINI_REQUEST_TIMEOUT=120
GEMINI_MAX_REQUEST_BYTES=15728640
GEMINI_MAX_PROMPT_BYTES=8192
GEMINI_MAX_FEW_SHOT=3
```

- [ ] **Step 5: Lisa nimed `docker-compose.yml` backendi `environment:` alla**

`- OCR_SERVER_PATH=...` rea järele:

```yaml
      # Gemini (teine OCR-pakkuja). Compose loetleb muutujad NIMELISELT —
      # ainult `.env`-i lisamine ei jõuaks konteinerisse ja funktsioon oleks
      # vaikselt väljas, ilma ühegi veateateta.
      - GEMINI_API_KEY=${GEMINI_API_KEY:-}
      - GEMINI_OCR_MODEL=${GEMINI_OCR_MODEL:-gemini-3.7-flash}
      - GEMINI_THINKING_LEVEL=${GEMINI_THINKING_LEVEL:-low}
      - GEMINI_MAX_INFLIGHT_REQUESTS=${GEMINI_MAX_INFLIGHT_REQUESTS:-4}
      - GEMINI_MAX_RETRIES=${GEMINI_MAX_RETRIES:-3}
      - GEMINI_REQUEST_TIMEOUT=${GEMINI_REQUEST_TIMEOUT:-120}
      - GEMINI_MAX_REQUEST_BYTES=${GEMINI_MAX_REQUEST_BYTES:-15728640}
      - GEMINI_MAX_PROMPT_BYTES=${GEMINI_MAX_PROMPT_BYTES:-8192}
      - GEMINI_MAX_FEW_SHOT=${GEMINI_MAX_FEW_SHOT:-3}
```

- [ ] **Step 6: Jooksuta testid**

Run: `.venv/bin/pytest tests/test_gemini_config.py tests/test_env_names.py tests/test_gemini_client.py -v`
Expected: PASS. `test_env_names.py` peab jääma roheliseks — uusi legacy nimesid ei lisandu.

- [ ] **Step 7: Commit**

```bash
git add server/config.py .env.example docker-compose.yml tests/test_gemini_config.py
git commit -m "feat(config): Gemini seaded (.env.example + compose, ADR 0021)"
```

---

## Task 4: `reocr_ops` pakkuja-dimensioon

**Files:**
- Modify: `server/reocr_ops.py`
- Test: `tests/test_gemini_provider_routing.py`

**Interfaces:**
- Consumes: Task 1 `instruction_for`, Task 2 `transcribe`/`GeminiError`, Task 3 `gemini_enabled`/`GEMINI_MAX_INFLIGHT_REQUESTS`
- Produces:
  - `start_reocr_job(..., provider: str = "loss")`
  - `start_reocr_batch(..., provider: str = "loss")`
  - `build_reocr_status()` vastuses lisaks `active_provider: Optional[str]`

**Kuus muudatuskohta.** Kõik muu jääb puutumata.

- [ ] **Step 1: Kirjuta kukkuv test**

`tests/test_gemini_provider_routing.py`:

```python
"""Pakkuja-marsruutimine: Gemini-töö ei puutu SFTP-d ja kirjutab .ocr atomaarselt."""
import sys
import threading
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture
def ops(tmp_path, monkeypatch):
    """reocr_ops ajutise BASE_DIR-iga; SFTP on lõks — selle kutsumine on VIGA."""
    import server.reocr_ops as reocr_ops
    (tmp_path / "w1").mkdir()
    monkeypatch.setattr(reocr_ops, "BASE_DIR", str(tmp_path))
    monkeypatch.setattr(reocr_ops, "REOCR_BACKUPS_DIR", str(tmp_path / "backups"))
    monkeypatch.setattr(reocr_ops, "_persist_active_jobs", lambda: None)
    monkeypatch.setattr(reocr_ops, "_append_to_log", lambda *a, **kw: None)

    def sftp_lõks(*a, **kw):
        raise AssertionError("Gemini-tee EI TOHI SFTP-d avada")

    monkeypatch.setattr(reocr_ops, "_sftp_open", sftp_lõks)
    reocr_ops._reocr_jobs.clear()
    reocr_ops._reocr_batch_jobs.clear()
    return reocr_ops


def _oota(tingimus, timeout=5.0):
    tähtaeg = time.time() + timeout
    while time.time() < tähtaeg:
        if tingimus():
            return True
        time.sleep(0.02)
    return False


def test_gemini_uksiktoo_kirjutab_ocr_ja_ei_ava_sftpd(ops, tmp_path, monkeypatch):
    import server.ocr_providers.gemini as gem
    monkeypatch.setattr(gem, "transcribe",
                        lambda *a, **kw: ("Mus. 1309\nAlexander I.", {"total_tokens": 5}))
    (tmp_path / "w1" / "pg1.jpg").write_bytes(b"\xff\xd8\xff")

    job_id = ops.start_reocr_job("wid", "w1", str(tmp_path / "w1" / "pg1.jpg"),
                                 page_filename="pg1.jpg", username="sa",
                                 material_type="hand", provider="gemini")

    assert _oota(lambda: ops._reocr_jobs[job_id]["status"] == "done")
    assert (tmp_path / "w1" / "pg1.ocr").read_text(encoding="utf-8") == (
        "Mus. 1309\nAlexander I.")
    assert ops._reocr_jobs[job_id]["produced_pages"] == ["pg1"]
    assert ops._reocr_jobs[job_id]["provider"] == "gemini"


def test_gemini_kasutab_kasikirja_juhist_kaepideme_jargi(ops, tmp_path, monkeypatch):
    """material_type='hand' PEAB andma käsikirja juhise, mitte trükise oma."""
    import server.ocr_prompts as prompts
    import server.ocr_providers.gemini as gem
    nähtud = {}
    monkeypatch.setattr(gem, "transcribe",
                        lambda img, instruction, **kw: (nähtud.setdefault("i", instruction), "x")[1:] and ("t", {}))
    (tmp_path / "w1" / "pg1.jpg").write_bytes(b"\xff\xd8\xff")

    job_id = ops.start_reocr_job("wid", "w1", str(tmp_path / "w1" / "pg1.jpg"),
                                 page_filename="pg1.jpg", material_type="hand",
                                 provider="gemini")

    assert _oota(lambda: ops._reocr_jobs[job_id]["status"] in ("done", "error"))
    assert nähtud["i"] == prompts.GEMINI_HAND_INSTRUCTION


def test_gemini_viga_laheb_error_staatusesse(ops, tmp_path, monkeypatch):
    import server.ocr_providers.gemini as gem

    def kukub(*a, **kw):
        raise gem.GeminiError("HTTP 429: RESOURCE_EXHAUSTED")

    monkeypatch.setattr(gem, "transcribe", kukub)
    (tmp_path / "w1" / "pg1.jpg").write_bytes(b"\xff\xd8\xff")

    job_id = ops.start_reocr_job("wid", "w1", str(tmp_path / "w1" / "pg1.jpg"),
                                 page_filename="pg1.jpg", provider="gemini")

    assert _oota(lambda: ops._reocr_jobs[job_id]["status"] == "error")
    assert "RESOURCE_EXHAUSTED" in ops._reocr_jobs[job_id]["error"]
    assert not (tmp_path / "w1" / "pg1.ocr").exists()


def test_poll_ei_ava_sftpd_gemini_tool(ops, tmp_path, monkeypatch):
    """poll_reocr_job peab Gemini-tööl kohe tagastama, mitte kaugfaili küsima."""
    ops._reocr_jobs["j1"] = {"provider": "gemini", "status": "processing",
                             "text": None, "error": None, "slug": "w1"}
    tulemus = ops.poll_reocr_job("j1")          # _sftp_open on lõks
    assert tulemus["status"] == "processing"


def test_batch_poll_ei_ava_sftpd_gemini_tool(ops):
    ops._reocr_batch_jobs["b1"] = {"kind": "batch", "provider": "gemini",
                                   "status": "processing", "work_id": "wid",
                                   "slug": "w1", "pages": [], "started_at": 0}
    ops._poll_batch_job("b1")                   # ei tohi visata


def test_build_reocr_status_naitab_aktiivse_pakkuja(ops, tmp_path):
    ops._reocr_batch_jobs["b1"] = {
        "kind": "batch", "provider": "gemini", "status": "processing",
        "work_id": "wid", "slug": "w1", "started_at": 1,
        "pages": [{"page_filename": "pg1.jpg", "stem": "pg1",
                   "status": "processing", "error": None}],
    }
    seis = ops.build_reocr_status("wid", str(tmp_path / "w1"))
    assert seis["active_provider"] == "gemini"


def test_katkestamine_kirjutamise_ajal_ei_jata_vahepealset_seisu(ops, tmp_path, monkeypatch):
    """Leht on kas produced_pages-is või .ocr on puutumata. Kolmandat ei ole."""
    import server.ocr_providers.gemini as gem
    väljas = threading.Event()

    def aeglane(*a, **kw):
        väljas.set()
        time.sleep(0.3)
        return ("uus tekst", {})

    monkeypatch.setattr(gem, "transcribe", aeglane)
    (tmp_path / "w1" / "pg1.jpg").write_bytes(b"\xff\xd8\xff")
    (tmp_path / "w1" / "pg1.ocr").write_text("VANA TULEMUS", encoding="utf-8")

    job_id = ops.start_reocr_job("wid", "w1", str(tmp_path / "w1" / "pg1.jpg"),
                                 page_filename="pg1.jpg", provider="gemini")
    assert väljas.wait(2)
    ops._cancel_event(job_id).set()
    with ops._reocr_jobs_lock:
        ops._reocr_jobs[job_id]["status"] = "cancelling"

    assert _oota(lambda: not ops._upload_threads[job_id].is_alive())
    töö = ops._reocr_jobs[job_id]
    kirjas = "pg1" in töö.get("produced_pages", [])
    sisu = (tmp_path / "w1" / "pg1.ocr").read_text(encoding="utf-8")
    # Kas töö omab lehte (siis on uus sisu ja ADR 0018 koristus taastab varukoopia),
    # või ta ei puutunud seda üldse (siis on vana sisu alles).
    assert kirjas or sisu == "VANA TULEMUS"
```

- [ ] **Step 2: Jooksuta test, veendu et kukub**

Run: `.venv/bin/pytest tests/test_gemini_provider_routing.py -v`
Expected: FAIL — `TypeError: start_reocr_job() got an unexpected keyword argument 'provider'`

- [ ] **Step 3: Lisa Gemini töölõimed `server/reocr_ops.py`-sse**

Lisa importide juurde ja `_build_batch_pages` järele:

```python
import threading as _threading

from .config import GEMINI_MAX_INFLIGHT_REQUESTS, gemini_enabled  # olemasolevasse config-importi
from .ocr_prompts import instruction_for

# Lagi kehtib TÖÖDE ÜLESELT — üks töö on järjestikune. Protsessi-lokaalne, nagu
# RENDER_SEMAPHORE: mitme workeriga (gunicorn) ei ole see enam õige piir.
_GEMINI_SEMAPHORE = _threading.Semaphore(GEMINI_MAX_INFLIGHT_REQUESTS)


def _gemini_transcribe_page(img_path: str, material_type: str) -> str:
    """Üks Gemini kutse. Import on FUNKTSIOONI sees, et testid saaksid patchida
    `server.ocr_providers.gemini.transcribe` ja et moodul ei laeks, kui võtit pole."""
    from .ocr_providers import gemini
    with open(img_path, "rb") as f:
        image_bytes = f.read()
    with _GEMINI_SEMAPHORE:
        text, usage = gemini.transcribe(image_bytes, instruction_for(material_type))
    logger.info("Gemini leht valmis: %d märki, usage=%s", len(text), usage)
    return text


def _gemini_commit_page(jobs: dict, lock, job_id: str, slug: str,
                        page_filename: str, text: str) -> bool:
    """Kirjutab .ocr JA registreerib omandi ÜHE kriitilise sektsioonina.

    Miks üks sektsioon: `_write_ocr_file` VARUNDAB olemasoleva .ocr faili enne
    ülekirjutamist, seega „kirjuta, siis vajadusel kustuta" EI OLE tagasipööramine —
    see jätaks sihtkoha tühjaks ja lehe produced_pages-ist välja. Ühe sektsiooniga
    on leht kas omatud (ADR 0018 koristus taastab varukoopia) või puutumata.

    OHUTU: `_write_ocr_file` ei võta kumbagi job-lukku (tema ainus lukk on
    reocr_state._file_lock), seega deadlock'i ei teki. Kirjutus on mõne KB suurune.
    """
    with lock:
        töö = jobs.get(job_id)
        if not töö or töö.get("status") != "processing":
            return False
        _write_ocr_file(slug, page_filename, text, job_id)
        _record_produced(töö, page_filename)
        return True
```

**Muudatuskoht 1 — `start_reocr_job`.** Lisa signatuuri `provider: str = "loss"`; job-kirjesse `"provider": provider`; Gemini korral ära pane `remote_*` välju ja kasuta seda lõime `_upload` asemel:

```python
    def _gemini_single():
        try:
            if _cancel_event(job_id).is_set():
                return
            text = _gemini_transcribe_page(img_path, material_type)
            if _cancel_event(job_id).is_set():
                return
            if _gemini_commit_page(_reocr_jobs, _reocr_jobs_lock, job_id, slug,
                                   page_filename, text):
                with _reocr_jobs_lock:
                    töö = _reocr_jobs.get(job_id)
                    if töö and töö.get("status") == "processing":
                        töö["status"] = "done"
                        töö["text"] = text
                        töö["finished_at"] = datetime.now().timestamp()
                        log_job = dict(töö)
                        _drop_backups(job_id)
                _append_to_log(log_job, job_id)
                _persist_active_jobs()
        except Exception as e:
            logger.error("Gemini re-OCR %s viga: %s", job_id, e)
            log_job = None
            with _reocr_jobs_lock:
                töö = _reocr_jobs.get(job_id)
                if töö and töö.get("status") in ("uploading", "processing"):
                    töö["status"] = "error"
                    töö["error"] = str(e)
                    töö["finished_at"] = datetime.now().timestamp()
                    log_job = dict(töö)
            if log_job:
                _append_to_log(log_job, job_id)
            _persist_active_jobs()
        finally:
            try:
                os.unlink(img_path)
            except Exception:
                pass
```

Gemini-tööl seatakse staatus kohe `"processing"` (üleslaadimise faasi ei ole).

**Muudatuskoht 2 — `start_reocr_batch`.** Lisa signatuuri `provider: str = "loss"`, job-kirjesse `"provider": provider`, ja Gemini korral käivita `_upload` asemel see lõim:

```python
    def _gemini_batch():
        for entry in page_entries:
            if _cancel_event(job_id).is_set():
                logger.info("Gemini batch %s: katkestatud", job_id)
                return
            with _reocr_batch_jobs_lock:
                praegune = _reocr_batch_jobs.get(job_id)
                if not praegune or praegune.get("status") != "processing":
                    return
            src = os.path.join(work_path, entry["page_filename"])
            try:
                text = _gemini_transcribe_page(src, material_type)
            except Exception as e:
                # Vigane leht ON edenemine (ADR 0025): ta on LAHENDATUD, mitte ootel.
                # Ilma last_progress_at uuenduseta lööks seisaku-tuvastus valehäire.
                logger.warning("Gemini batch %s %s: %s", job_id, entry["page_filename"], e)
                with _reocr_batch_jobs_lock:
                    praegune = _reocr_batch_jobs.get(job_id)
                    if not praegune or praegune.get("status") != "processing":
                        return
                    for kirje in praegune.get("pages", []):
                        if (kirje.get("page_filename") == entry["page_filename"]
                                and kirje.get("status") == "processing"):
                            kirje["status"] = "error"
                            kirje["error"] = str(e)
                            praegune["last_progress_at"] = datetime.now().timestamp()
                            break
                _log_batch_page_error(job, job_id, entry, str(e))
                continue
            if _cancel_event(job_id).is_set():
                return
            if _gemini_commit_page(_reocr_batch_jobs, _reocr_batch_jobs_lock, job_id,
                                   slug, entry["page_filename"], text):
                with _reocr_batch_jobs_lock:
                    praegune = _reocr_batch_jobs.get(job_id)
                    if praegune:
                        for kirje in praegune.get("pages", []):
                            if (kirje.get("page_filename") == entry["page_filename"]
                                    and kirje.get("status") == "processing"):
                                kirje["status"] = "ready"
                                praegune["last_progress_at"] = datetime.now().timestamp()
                                break
            _persist_active_jobs()
        with _reocr_batch_jobs_lock:
            praegune = _reocr_batch_jobs.get(job_id)
            if praegune:
                _finalize_batch_if_complete(praegune, job_id)
        _persist_active_jobs()
```

Gemini-batchil seatakse staatus kohe `"processing"` ja iga lehe kirje samuti — üleslaadimise faasi ei ole. `_gemini_commit_page` teeb omandi-registreerimise; `kirje["status"] = "ready"` on eraldi, sest see on batch-kirje väli, mitte omand.

**Muudatuskoht 3 — `poll_reocr_job`.** Kohe `snapshot` võtmise järele:

```python
    if snapshot.get("provider") == "gemini":
        # Kaugfaili ei ole — staatuse kirjutab töölõim ise.
        return {"status": snapshot["status"], "text": snapshot.get("text"),
                "error": snapshot.get("error")}
```

**Muudatuskoht 4 — `_poll_batch_job`.** Esimese luku all oleva ploki sees, `job` leidmise järel:

```python
        if job.get("provider") == "gemini":
            _finalize_batch_if_complete(job, job_id)
            return
```

**Muudatuskoht 5 — `build_reocr_status`.** Lisa `active_provider: Optional[str] = None`; seal kus `active_job_id = jid` seatakse, lisa `active_provider = j.get("provider", "loss")`; lisa see tagastusse.

**Muudatuskoht 6 — `start_reocr_background`.** Asenda:

```python
    if not UPLOAD_ENABLED:
        return None
```

sellega:

```python
    # Tööde LAADIMINE toimib ka ilma upload'ita — Gemini-tee ei kasuta SFTP-d.
    # SFTP-põhine scan_and_recover + reaper jäävad UPLOAD_ENABLED taha.
    if not UPLOAD_ENABLED and not gemini_enabled():
        return None
```

ja pane `reocr_recovery` käivitus `if UPLOAD_ENABLED:` taha. Lisaks `_revive_dead_uploads`-i: Gemini-töö ei ela restarti üle (kaugartefakti pole), seega

```python
    for j in jobs.values():
        if j.get("provider") == "gemini":
            # Krahh EI OLE kasutaja otsus: juba kirjutatud .ocr failid JÄÄVAD alles
            # ja on Manage'is ootel. See on teadlik erinevus katkestamisest (ADR 0018).
            if j.get("status") in ("uploading", "processing"):
                j["status"] = "error"
                j["error"] = "Server taaskäivitus töö ajal"
                n += 1
            continue
```

enne olemasolevat `uploading → processing` loogikat.

- [ ] **Step 4: Jooksuta testid**

Run: `.venv/bin/pytest tests/test_gemini_provider_routing.py -v`
Expected: PASS (7 testi)

- [ ] **Step 5: Jooksuta KOGU re-OCR testikomplekt (regressioon)**

Run: `.venv/bin/pytest tests/ -k "reocr or ocr" -v`
Expected: PASS. Kui midagi kukub, on LOSS-tee katki — paranda enne edasiminekut.

- [ ] **Step 6: Commit**

```bash
git add server/reocr_ops.py tests/test_gemini_provider_routing.py
git commit -m "feat(reocr): pakkuja-dimensioon + Gemini töölõimed"
```

---

## Task 5: Endpointid ja rollivärav

**Files:**
- Modify: `server/routers/reocr.py`, `server/routers/admin.py`, `tests/conftest.py`
- Test: `tests/test_gemini_router.py`

**Interfaces:**
- Consumes: Task 3 `gemini_enabled`/`GEMINI_OCR_MODEL`, Task 4 `provider` parameetrid
- Produces: `GET /admin/ocr/providers` → `{"status": "success", "gemini": {"enabled": bool, "model": str}}`

- [ ] **Step 1: Lisa `superadmin` kasutaja `tests/conftest.py`-sse**

`"editor"` kirje järele `users_file` sõnastikus:

```python
                "superadmin": {
                    "password_hash": _sha256("superpass"),
                    "name": "Super Admin",
                    "email": "super@example.test",
                    "role": "superadmin",
                    "created_at": "2026-01-01T00:00:00",
                },
```

- [ ] **Step 2: Kirjuta kukkuv test**

`tests/test_gemini_router.py`:

```python
"""Gemini-tee rollivärav ja pakkujate endpoint. Ligipääsu kiht 1 ja 3."""


def test_admin_ei_saa_gemini_teed_kasutada(client, login, tmp_path, monkeypatch):
    """admin PEAB saama 403 — Gemini on superadmin-only (vähemalt esialgu)."""
    import server.routers.reocr as reocr_router
    work_dir = tmp_path / "data" / "w1"
    work_dir.mkdir(parents=True)
    (work_dir / "pg1.jpg").write_bytes(b"\xff\xd8\xff")
    monkeypatch.setattr(reocr_router, "find_directory_by_id",
                        lambda wid: str(work_dir) if wid == "wid" else None)
    monkeypatch.setattr(reocr_router, "get_active_reocr_count", lambda: 0)
    alustatud = []
    monkeypatch.setattr(reocr_router, "start_reocr_job",
                        lambda *a, **kw: alustatud.append(kw) or "j1")

    token = login("admin", "adminpass")
    r = client.post("/admin/work/wid/reocr-page",
                    json={"page_filename": "pg1.jpg", "provider": "gemini"},
                    headers={"Authorization": f"Bearer {token}"})

    assert r.status_code == 403
    assert alustatud == []


def test_superadmin_saab_gemini_teed_kasutada(client, login, tmp_path, monkeypatch):
    import server.routers.reocr as reocr_router
    work_dir = tmp_path / "data" / "w1"
    work_dir.mkdir(parents=True)
    (work_dir / "pg1.jpg").write_bytes(b"\xff\xd8\xff")
    monkeypatch.setattr(reocr_router, "find_directory_by_id",
                        lambda wid: str(work_dir) if wid == "wid" else None)
    monkeypatch.setattr(reocr_router, "get_active_reocr_count", lambda: 0)
    monkeypatch.setattr(reocr_router.shutil, "copy2", lambda *a, **kw: None)
    nähtud = {}
    def fake_start(*a, **kw):
        nähtud.update(kw)
        return "j1"
    monkeypatch.setattr(reocr_router, "start_reocr_job", fake_start)

    token = login("superadmin", "superpass")
    r = client.post("/admin/work/wid/reocr-page",
                    json={"page_filename": "pg1.jpg", "provider": "gemini"},
                    headers={"Authorization": f"Bearer {token}"})

    assert r.status_code == 200
    assert nähtud["provider"] == "gemini"


def test_admin_saab_loss_teed_endiselt_kasutada(client, login, tmp_path, monkeypatch):
    """Regressioon: pakkuja lisamine EI TOHI tõsta LOSS-tee läve."""
    import server.routers.reocr as reocr_router
    work_dir = tmp_path / "data" / "w1"
    work_dir.mkdir(parents=True)
    (work_dir / "pg1.jpg").write_bytes(b"\xff\xd8\xff")
    monkeypatch.setattr(reocr_router, "find_directory_by_id",
                        lambda wid: str(work_dir) if wid == "wid" else None)
    monkeypatch.setattr(reocr_router, "get_active_reocr_count", lambda: 0)
    monkeypatch.setattr(reocr_router.shutil, "copy2", lambda *a, **kw: None)
    monkeypatch.setattr(reocr_router, "start_reocr_job", lambda *a, **kw: "j1")

    token = login("admin", "adminpass")
    r = client.post("/admin/work/wid/reocr-page",
                    json={"page_filename": "pg1.jpg"},
                    headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200


def test_batch_gemini_noiab_superadmini(client, login, tmp_path, monkeypatch):
    import server.routers.reocr as reocr_router
    work_dir = tmp_path / "data" / "w1"
    work_dir.mkdir(parents=True)
    (work_dir / "pg1.jpg").write_bytes(b"\xff\xd8\xff")
    monkeypatch.setattr(reocr_router, "find_directory_by_id",
                        lambda wid: str(work_dir) if wid == "wid" else None)
    monkeypatch.setattr(reocr_router, "get_active_batch_for_work", lambda wid: None)
    monkeypatch.setattr(reocr_router, "start_reocr_batch", lambda *a, **kw: "b1")

    token = login("admin", "adminpass")
    r = client.post("/admin/work/wid/reocr-batch",
                    json={"page_filenames": ["pg1.jpg"], "provider": "gemini"},
                    headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403


def test_tundmatu_pakkuja_on_400(client, login, tmp_path, monkeypatch):
    import server.routers.reocr as reocr_router
    work_dir = tmp_path / "data" / "w1"
    work_dir.mkdir(parents=True)
    monkeypatch.setattr(reocr_router, "find_directory_by_id",
                        lambda wid: str(work_dir) if wid == "wid" else None)
    monkeypatch.setattr(reocr_router, "get_active_reocr_count", lambda: 0)

    token = login("superadmin", "superpass")
    r = client.post("/admin/work/wid/reocr-page",
                    json={"page_filename": "pg1.jpg", "provider": "openai"},
                    headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 400


def test_providers_endpoint_ei_lekita_votit(client, login, monkeypatch):
    """Ligipääsu kiht 3: võti ei tohi jõuda ühessegi vastusesse."""
    import server.config as cfg
    monkeypatch.setattr(cfg, "GEMINI_API_KEY", "SALAJANE-VOTI-123")
    monkeypatch.setattr(cfg, "gemini_enabled", lambda: True)

    token = login("superadmin", "superpass")
    r = client.get("/admin/ocr/providers",
                   headers={"Authorization": f"Bearer {token}"})

    assert r.status_code == 200
    assert "SALAJANE-VOTI-123" not in r.text
    assert r.json()["gemini"]["enabled"] is True
    assert r.json()["gemini"]["model"]


def test_providers_endpoint_nouab_superadmini(client, login):
    token = login("admin", "adminpass")
    r = client.get("/admin/ocr/providers",
                   headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401
```

- [ ] **Step 3: Jooksuta test, veendu et kukub**

Run: `.venv/bin/pytest tests/test_gemini_router.py -v`
Expected: FAIL — admin saab 200 (väravat pole) ja `/admin/ocr/providers` annab 404.

- [ ] **Step 4: Lisa värav `server/routers/reocr.py`-sse**

Importidesse `from ..auth import is_at_least` ja `from ..config import gemini_enabled`.

Abifunktsioon:

```python
VALID_PROVIDERS = ("loss", "gemini")


def _resolve_provider(data: dict, user: dict) -> str:
    """Pakkuja bodyst + rollivärav.

    Kontroll on FUNKTSIOONI sees, mitte `Depends`-is: FastAPI dependency ei näe
    request body't ja pakkuja tuleb sealt. LOSS-tee lävi jääb `admin`-iks.
    """
    provider = data.get("provider") or "loss"
    if provider not in VALID_PROVIDERS:
        raise HTTPException(status_code=400, detail="Tundmatu pakkuja: {}".format(provider))
    if provider == "gemini":
        if not is_at_least(user.get("role", "contributor"), "superadmin"):
            raise HTTPException(status_code=403, detail="Gemini-tee on ainult superadminile")
        if not gemini_enabled():
            raise HTTPException(status_code=503, detail="Gemini ei ole seadistatud (GEMINI_API_KEY)")
    return provider
```

`admin_reocr_page`-is pärast `data = await get_json_data(request)`: `provider = _resolve_provider(data, user)` ja anna `start_reocr_job(..., provider=provider)`. Sama `admin_reocr_batch`-is.

- [ ] **Step 5: Lisa endpoint `server/routers/admin.py`-sse**

```python
@router.get("/admin/ocr/providers")
def admin_ocr_providers(user=Depends(require_role("superadmin"))):
    """Millised OCR-pakkujad on saadaval. VÕTIT EGA SELLE OSA EI TAGASTATA KUNAGI —
    ainult `enabled` ja mudeli nimi. Ilma selle endpointita ilmuks nupp ka siis, kui
    võtit pole, ja kukuks alles vajutusel."""
    from ..config import GEMINI_OCR_MODEL, gemini_enabled
    return {"status": "success",
            "gemini": {"enabled": gemini_enabled(), "model": GEMINI_OCR_MODEL}}
```

Import funktsiooni sees, et test saaks `server.config` atribuute monkeypatch'ida.

- [ ] **Step 6: Jooksuta testid**

Run: `.venv/bin/pytest tests/test_gemini_router.py tests/test_reocr_router.py tests/test_backend_smoke.py -v`
Expected: PASS

- [ ] **Step 7: Jooksuta KOGU backend-komplekt**

Run: `.venv/bin/pytest tests/`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add server/routers/reocr.py server/routers/admin.py tests/conftest.py tests/test_gemini_router.py
git commit -m "feat(api): Gemini pakkuja endpointides + superadmin-värav"
```

---

## Task 6: Workspace'i nupp

**Files:**
- Modify: `src/services/workApi.ts`, `src/components/editor/useReOcr.ts`, `src/components/editor/HistoryTab.tsx`, `src/components/editor/EditorInfoHistoryTabs.tsx`, `src/components/TextEditor.tsx`, `src/locales/et/workspace.json`, `src/locales/en/workspace.json`

**Interfaces:**
- Consumes: Task 5 `GET /admin/ocr/providers`, `provider` body-väli
- Produces: `useReOcr({..., provider})`; `getOcrProviders(token)`

- [ ] **Step 1: Lisa API-abifunktsioon `src/services/workApi.ts`-sse**

```ts
export interface OcrProvidersResponse extends ApiStatusResponse {
  gemini?: { enabled: boolean; model: string };
}

/** Millised OCR-pakkujad on seadistatud. Ainult superadmin; võtit vastus ei sisalda. */
export function getOcrProviders(token: string | null) {
  return apiGet<OcrProvidersResponse>('/admin/ocr/providers', auth(token, { timeout: 8000 }));
}
```

- [ ] **Step 2: Lisa `provider` `useReOcr`-i**

`UseReOcrProps`-i:

```ts
  /** OCR-pakkuja. 'gemini' on superadmin-only; backend kontrollib uuesti. */
  provider?: 'loss' | 'gemini';
```

Funktsiooni signatuuris `{ page, authToken, isAdmin, viewRef, setIsDirty, provider = 'loss' }`.

`handleReOcr`-i bodys:

```ts
        body: JSON.stringify({
          page_filename: pageFilename,
          page_number: page.page_number,
          provider,
        }),
```

Lisa `provider` `handleReOcr`-i `useCallback` sõltuvustesse.

**Ära muuda** `reocrStorageKey`-d — see on lehepõhine, mitte pakkujapõhine: ühel lehel saab korraga olla üks ootel tulemus, ükskõik kummalt pakkujalt.

- [ ] **Step 3: Kutsu `useReOcr` teist korda `TextEditor.tsx`-is**

Olemasoleva kutse kõrvale:

```tsx
  const isSuperadmin = isAtLeast(user?.role, 'superadmin');
  const gemini = useReOcr({
    page,
    authToken,
    isAdmin: isSuperadmin,
    viewRef,
    setIsDirty,
    provider: 'gemini',
  });
```

Anna `EditorInfoHistoryTabs`-ile edasi `handleGeminiReOcr={gemini.handleReOcr}` ja `geminiReocrStatus={gemini.reocrStatus}`; sealt `HistoryTab`-ile.

`geminiEnabled` olek `TextEditor`-is:

```tsx
  const [geminiEnabled, setGeminiEnabled] = useState(false);
  useEffect(() => {
    if (!authToken || !isSuperadmin) { setGeminiEnabled(false); return; }
    let tühistatud = false;
    getOcrProviders(authToken)
      .then((d) => { if (!tühistatud) setGeminiEnabled(Boolean(d.gemini?.enabled)); })
      .catch(() => { if (!tühistatud) setGeminiEnabled(false); });
    return () => { tühistatud = true; };
  }, [authToken, isSuperadmin]);
```

- [ ] **Step 4: Lisa teine rida `HistoryTab.tsx`-i**

Propidesse `handleGeminiReOcr?: () => void; geminiReocrStatus?: ReocrStatus; geminiEnabled?: boolean;`.

Olemasoleva `{handleReOcr && (...)}` ploki JÄRELE, sama `{isAdmin && (` sees:

```tsx
          {handleGeminiReOcr && geminiEnabled && (
            <div className="px-5 py-4 flex items-start justify-between gap-4 border-b border-gray-100 last:border-0">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-sm font-medium text-gray-800 mb-0.5">
                  <Sparkles size={13} className="text-violet-600 shrink-0" />
                  {t('editor.reocrGemini.button')}
                </div>
                <p className="text-xs text-gray-400 leading-snug">{t('editor.reocrGemini.hint')}</p>
              </div>
              <button
                onClick={handleGeminiReOcr}
                disabled={geminiReocrStatus !== 'idle'}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-violet-700 border border-violet-200 bg-violet-50 hover:bg-violet-100 rounded transition-colors disabled:opacity-50"
              >
                {(geminiReocrStatus === 'uploading' || geminiReocrStatus === 'processing') && (
                  <Loader2 className="animate-spin" size={12} />
                )}
                {geminiReocrStatus === 'processing'
                  ? t('editor.reocr.processing')
                  : t('editor.reocrGemini.button')}
              </button>
            </div>
          )}
```

Lisa `Sparkles` `lucide-react` importi. Violetne eristab Gemini-tee rohelisest LOSS-teest.

- [ ] **Step 5: Lisa tõlkevõtmed MÕLEMASSE keelde**

`src/locales/et/workspace.json`, `editor` alla:

```json
    "reocrGemini": {
      "button": "Re-OCR (Gemini)",
      "hint": "Transkribeerib Google Gemini mudeliga. Ainult superadminile; tulemus tuleb sama ülevaatuse kaudu."
    },
```

`src/locales/en/workspace.json`, samasse kohta:

```json
    "reocrGemini": {
      "button": "Re-OCR (Gemini)",
      "hint": "Transcribes with the Google Gemini model. Superadmin only; the result goes through the same review step."
    },
```

- [ ] **Step 6: Jooksuta väravad**

Run: `npm run typecheck && npm test -- localeParity translationKeysResolve`
Expected: PASS. `fallbackLng` on VÄLJAS — puuduv võti ühes keeles katkestaks buildi.

- [ ] **Step 7: Commit**

```bash
git add src/services/workApi.ts src/components/editor/ src/components/TextEditor.tsx src/locales/
git commit -m "feat(workspace): Gemini re-OCR nupp superadminile"
```

---

## Task 7: Manage-lehe hulgitöö

**Files:**
- Modify: `src/services/workApi.ts`, `src/pages/manage/PageActionBar.tsx`, `src/pages/WorkManage.tsx`, `src/locales/et/manage.json`, `src/locales/en/manage.json`

**Interfaces:**
- Consumes: Task 5 `provider` body-väli, Task 6 `getOcrProviders`
- Produces: midagi (viimane ülesanne)

- [ ] **Step 1: Lisa `provider` `startReocrBatch`-i**

`src/services/workApi.ts`-is olevale `startReocrBatch` bodyle lisa `provider?: 'loss' | 'gemini'` väli tüüpi ja anna see päringu kehas edasi.

- [ ] **Step 2: Lisa teine nupp `PageActionBar.tsx`-i**

Propidesse `onGeminiReocrClick?: () => void; geminiEnabled?: boolean;`.

Olemasoleva „Transkribeeri" nupu `<div className="border-l border-gray-200 pl-3">` sees, sama nupu järele:

```tsx
              {props.onGeminiReocrClick && props.geminiEnabled && (
                <button onClick={props.onGeminiReocrClick} disabled={props.actionsDisabled}
                  title={props.actionsDisabled ? props.actionsDisabledTitle : ''}
                  className="ml-2 flex items-center gap-1.5 px-2.5 py-1 text-sm border border-violet-300 text-violet-700 hover:bg-violet-50 disabled:opacity-40 rounded">
                  <Sparkles size={13} />
                  {t('manage.reocrGemini.button', { count: props.selectedCount })}
                </button>
              )}
```

Lisa `Sparkles` `lucide-react` importi ja muuda ümbritsev `<div>` `flex items-center`-iks, et kaks nuppu kõrvuti mahuksid.

- [ ] **Step 3: Lisa pakkuja `WorkManage.tsx`-i**

`handleBatchReocr` võtab pakkuja:

```tsx
  const [batchProvider, setBatchProvider] = useState<'loss' | 'gemini'>('loss');

  const handleBatchReocr = async () => {
    setBatchBusy(true);
    setBatchError(null);
    try {
      await startReocrBatch(workId, authToken, {
        page_filenames: Array.from(selectedFiles),
        material_type: materialType,
        provider: batchProvider,
      });
      setBatchConfirm(false);
      setSelectedFiles(new Set());
      setReocrPollNonce((n) => n + 1);
    } catch (e: any) {
      setBatchError(e.message || t('manage.reocr.error'));
    } finally {
      setBatchBusy(false);
    }
  };
```

`PageActionBar`-ile:

```tsx
          onReocrClick={() => { setBatchProvider('loss'); setBatchConfirm(true); }}
          onGeminiReocrClick={() => { setBatchProvider('gemini'); setBatchConfirm(true); }}
          geminiEnabled={geminiEnabled}
```

`geminiEnabled` olek sama mustri järgi mis Task 6 Step 3 (`getOcrProviders` + `isAtLeast(user?.role, 'superadmin')`).

Kinnitusdialoogis näita, kumb pakkuja:

```tsx
              {t('manage.reocr.confirm.line1', { count: props.selectedCount })}{' '}
              {props.batchProvider === 'gemini'
                ? t('manage.reocrGemini.confirmSuffix')
                : t('manage.reocr.confirm.line2')}
```

(anna `batchProvider` `PageActionBar`-ile propina).

**Ära puuduta** ootel-tulemuste rakendamist, katkestamist ega progressiriba — need on pakkuja-ülesed ja töötavad juba.

- [ ] **Step 4: Lisa tõlkevõtmed MÕLEMASSE keelde**

`src/locales/et/manage.json`, `manage` alla:

```json
    "reocrGemini": {
      "button": "Gemini ({{count}})",
      "confirmSuffix": "Kasutatakse Google Gemini mudelit (ainult superadmin). Tulemus tuleb tavalisse ootel-loendisse."
    },
```

`src/locales/en/manage.json`:

```json
    "reocrGemini": {
      "button": "Gemini ({{count}})",
      "confirmSuffix": "Uses the Google Gemini model (superadmin only). The result appears in the usual pending list."
    },
```

- [ ] **Step 5: Jooksuta väravad**

Run: `npm run typecheck && npm test && npm run lint:ci`
Expected: PASS. Kui `lint:ci` hoiatuste arv langes, LANGETA `--max-warnings` arvu `package.json`-is.

- [ ] **Step 6: Commit**

```bash
git add src/pages/ src/services/workApi.ts src/locales/
git commit -m "feat(manage): Gemini hulgi-re-OCR superadminile"
```

---

## Lõppkontroll enne deploy'd

- [ ] `.venv/bin/pytest tests/` — kogu komplekt roheline
- [ ] `npm run typecheck && npm test && npm run build`
- [ ] **`GEMINI_API_KEY` on billing-enabled (Paid Tier) projekti võti.** Tasuta tasandil kasutatakse sisu Google'i toodete parandamiseks; Gemini-tee tohib puutuda mitteavalikke teoseid. See on `store=false`-ist eraldi nõue ja seda ei kontrollita runtime'is.
- [ ] Serveri `.env`-i lisatud `GEMINI_API_KEY` **ja** `docker-compose.yml` uuendatud (git pull toob selle kaasa)
- [ ] `./scripts/server_update.sh --no-cache` — **`--no-cache` on Python-muudatusel kohustuslik**
- [ ] Suitsutest tootmises: üks leht Workspace'ist, vaata `docker logs vutt-backend` — võti ei tohi logis esineda
- [ ] `npm run build && rsync -avz --delete dist/ vutt:~/VUTT/dist/` — `.br`/`.gz` peavad kaasa minema

## Pärast deploy'd: võrdlusjooks (spekk, „Enne laiemat kasutuselevõttu")

Faasi B plaani EI kirjutata enne, kui need on tehtud — nende tulemus ütleb, millist iteratsioonisilmust vaja on.

- [ ] **A. Käsikiri** — materjal, millega kurrendi-mudel hädas on, mõlemast teest läbi. Mõõdik on **„kas parandamine läheb kiiremaks"**, mitte CER: keerulisel käekirjal ei ole tõesttausta.
- [ ] **A2. `thinking_level` `low` vs `medium`** — neli mõõdikut: parandamise aeg, API latentsus lehe kohta, `thought_tokens`, subjektiivne lugemistäpsus.
- [ ] **B. Trükis** — ~20 lehte, millel on inimese kinnitatud „Valmis" tekst. CER, `<m>` plokkide arv, ⸗ vs `-` osakaal. **See peab olema tehtud enne, kui trükise Gemini-tulemusi teosekaupa `apply`-takse.**
- [ ] **C. Sedelkataloog `996o7v`** — väljade eristamise täpsus.

**Kvaliteeti hinnates loe `.txt` failist, MITTE MCP kaudu.** MCP `get_pages` tagastab Meili välja `lehekylje_tekst`, mis on otsinguks normaliseeritud (tühemik kollapseeritud) — see peidab just seda, mida siin mõõdetakse. Selle speki varasem versioon tegi täpselt selle vea.
