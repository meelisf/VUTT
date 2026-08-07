# Poolitamine enne OCR-i — teostusplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin saab topeltlehtedega materjali poolitada ja tühje lehti välja jätta enne, kui midagi OCR-serverisse jõuab.

**Architecture:** VUTT rasteriseerib PDF-i ise (`pdftoppm`, poppler on juba Docker-image'is) ja saadab poolitatud lehed OCR-serverisse olemasolevat kaustapõhist pildi-OCR teed pidi. OCR-serverit ei muudeta. Kogu prepress on opt-in: puutumata lülitiga upload ei renderda ühtki pikslit ja käib tänast teed.

**Tech Stack:** FastAPI + Python 3.9, poppler-utils (`pdftoppm`, `pdfinfo`), Pillow, paramiko SFTP; React 19 + TypeScript + Tailwind, vitest, pytest.

**Spec:** `docs/superpowers/specs/2026-08-07-poolitamine-enne-ocr-design.md`

## Global Constraints

- **Koodikommentaarid eesti keeles.** UI-tekstid tulevad i18n-ist, mitte koodist.
- **Python 3.9 ühilduvus:** `Optional[dict]`, `List[Tuple[int, int]]` — MITTE `dict | None` ega `list[tuple]`.
- **ADR 0002:** blokeeriv I/O `async def` sees on keelatud. Route on kas sync `def` või kasutab `run_in_threadpool`. Renderdus ja SFTP käivad taustalõimedes.
- **nginx `/api/files/` proksib KÕIK backend-teed avalikult.** Iga uus endpoint on `/admin/` all JA kannab `Depends(require_role("admin"))`.
- **i18n (ADR 0011):** `fallbackLng` on VÄLJAS. Iga uus võti läheb `src/locales/et/upload.json` JA `src/locales/en/upload.json` sisse **korraga**, muidu katkeb build.
- **Endpointid lähevad `server/routers/upload.py`-sse**, mitte `server/main.py`-sse.
- **`FULL_DPI = 300` ja `JPEG_QUALITY = 95` peavad kattuma** OCR-serveri `kataloogi-jalgimine-ja-ocr.py` väärtustega `PDF_DPI = 300` ja `img.save(..., quality=95)`.
- **Testid:** `.venv/bin/pytest` (mitte süsteemi `python3`). Väravad enne igat commiti, mis puudutab frontendi: `npm run typecheck`.
- Number-sisendid frontendis: `type="text"` + `inputMode="numeric"`, MITTE `type="number"`.

---

### Task 1: Plaanimudel — puhas poolitusgeomeetria

Spetsi `plan_to_sequence` leping. Ühtki failioperatsiooni siin ei ole — kogu moodul on testitav ilma PDF-ita.

**Files:**
- Create: `server/upload/prepress_plan.py`
- Test: `tests/test_prepress_plan.py`

**Interfaces:**
- Consumes: midagi (esimene ülesanne)
- Produces:
  - `default_plan(page_count: int) -> dict`
  - `effective_split_x(plan: Optional[dict], n: int) -> Optional[float]`
  - `is_excluded(plan: Optional[dict], n: int) -> bool`
  - `is_trivial_plan(plan: Optional[dict]) -> bool`
  - `page_cuts(plan: Optional[dict], n: int, width: int) -> List[Tuple[int, int]]`
  - `plan_to_sequence(plan: Optional[dict], page_widths: List[int]) -> List[dict]` — kirjed `{"src_page": int, "x0": int, "x1": int, "out_index": int}`
  - `output_page_count(plan: Optional[dict], page_count: int) -> int`

- [ ] **Step 1: Write the failing test**

Create `tests/test_prepress_plan.py`:

```python
"""Prepress-plaani puhas geomeetria. Ilma failideta, ilma PDF-ita."""
import pytest

from server.upload import prepress_plan as pp


def _plan(**over):
    """Kolme lehega plaan, kõik vaikeseades."""
    plan = pp.default_plan(3)
    plan.update(over)
    return plan


# --- default_plan ---

def test_default_plan_on_valjas_ja_lehed_vaikeseades():
    plan = pp.default_plan(3)
    assert plan["enabled"] is False
    assert plan["default_split_x"] == 0.5
    assert plan["preview_status"] == "idle"
    assert plan["preview_done"] == 0
    assert [p["n"] for p in plan["pages"]] == [1, 2, 3]
    assert all(p["mode"] == "default" and p["excluded"] is False for p in plan["pages"])


# --- effective_split_x ---

def test_enabled_false_teeb_custom_joone_inertseks():
    """Lüliti välja-sisse EI TOHI kustutada tehtud tööd: custom väärtus jääb
    plaani alles, aga ei rakendu."""
    plan = _plan(enabled=False)
    plan["pages"][0].update(mode="custom", split_x=0.42)
    assert pp.effective_split_x(plan, 1) is None
    assert plan["pages"][0]["split_x"] == 0.42  # alles


def test_enabled_true_default_mode_kasutab_globaalset_joont():
    plan = _plan(enabled=True, default_split_x=0.48)
    assert pp.effective_split_x(plan, 1) == 0.48


def test_custom_mode_kirjutab_globaalse_ule():
    plan = _plan(enabled=True, default_split_x=0.5)
    plan["pages"][1].update(mode="custom", split_x=0.46)
    assert pp.effective_split_x(plan, 1) == 0.5
    assert pp.effective_split_x(plan, 2) == 0.46


def test_nosplit_mode_ei_poolita():
    plan = _plan(enabled=True)
    plan["pages"][2]["mode"] = "nosplit"
    assert pp.effective_split_x(plan, 3) is None


def test_tundmatu_leht_ja_puuduv_plaan():
    assert pp.effective_split_x(None, 1) is None
    assert pp.effective_split_x(_plan(enabled=True), 99) is None


# --- is_trivial_plan ---

def test_tyhi_plaan_on_triviaalne():
    """REGRESSIOON: triviaalne plaan peab andma tänase PDF-teekonna."""
    assert pp.is_trivial_plan(None) is True
    assert pp.is_trivial_plan(pp.default_plan(3)) is True


def test_ainult_valjajatmised_on_triviaalne():
    """Väljajätmised EI mõjuta triviaalsust — originaalfail saadetakse edasi."""
    plan = _plan(enabled=True)
    for p in plan["pages"]:
        p["mode"] = "nosplit"
    plan["pages"][0]["excluded"] = True
    assert pp.is_trivial_plan(plan) is True


def test_uks_poolitus_teeb_plaani_mittetriviaalseks():
    plan = _plan(enabled=True)
    for p in plan["pages"]:
        p["mode"] = "nosplit"
    plan["pages"][1]["mode"] = "default"
    assert pp.is_trivial_plan(plan) is False


# --- page_cuts: piksliinvariandid ---

@pytest.mark.parametrize("width", [100, 101, 2280, 2281, 4961])
def test_poolitus_ei_kaota_ega_dubleeri_veergu(width):
    """cut_px täpselt piiril: len(vasak) + len(parem) == width."""
    plan = _plan(enabled=True, default_split_x=0.5)
    cuts = pp.page_cuts(plan, 1, width)
    assert len(cuts) == 2
    (l0, l1), (r0, r1) = cuts
    assert l0 == 0 and r1 == width
    assert l1 == r0                       # ei kattu, ei jäta auku
    assert (l1 - l0) + (r1 - r0) == width  # ükski veerg ei kao


@pytest.mark.parametrize("x", [0.05, 0.4999, 0.5, 0.5001, 0.95])
def test_poolitus_servavaartustel_jatab_molemad_pooled_mittetyhjaks(x):
    plan = _plan(enabled=True, default_split_x=x)
    (l0, l1), (r0, r1) = pp.page_cuts(plan, 1, 2280)
    assert l1 - l0 >= 1
    assert r1 - r0 >= 1


def test_erineva_laiusega_lehed_kasutavad_sama_x_frac_oigesti():
    """Skaneeringute laius kõigub päriselt (mõõdetud 2280–2344 px).
    Iga leht arvutab oma cut_px OMA laiusest."""
    plan = _plan(enabled=True, default_split_x=0.5)
    assert pp.page_cuts(plan, 1, 2280)[0][1] == 1140
    assert pp.page_cuts(plan, 2, 2344)[0][1] == 1172
    assert pp.page_cuts(plan, 3, 2303)[0][1] == 1152  # round(1151.5) → 1152


def test_poolitamata_leht_annab_yhe_taislaiuse_loike():
    assert pp.page_cuts(pp.default_plan(1), 1, 2280) == [(0, 2280)]


def test_valjajaetud_leht_annab_tyhja_listi():
    plan = _plan(enabled=True)
    plan["pages"][0]["excluded"] = True
    assert pp.page_cuts(plan, 1, 2280) == []


# --- plan_to_sequence ja output_page_count ---

def test_plan_to_sequence_nummerdab_vasak_parem_jarjekorras():
    plan = _plan(enabled=True, default_split_x=0.5)
    plan["pages"][1]["mode"] = "nosplit"
    plan["pages"][2]["excluded"] = True
    seq = pp.plan_to_sequence(plan, [100, 100, 100])
    assert seq == [
        {"src_page": 1, "x0": 0, "x1": 50, "out_index": 1},
        {"src_page": 1, "x0": 50, "x1": 100, "out_index": 2},
        {"src_page": 2, "x0": 0, "x1": 100, "out_index": 3},
    ]


def test_output_page_count_ei_vaja_laiusi():
    plan = _plan(enabled=True)
    plan["pages"][1]["mode"] = "nosplit"
    plan["pages"][2]["excluded"] = True
    assert pp.output_page_count(plan, 3) == 3
    assert pp.output_page_count(pp.default_plan(3), 3) == 3
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_prepress_plan.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'server.upload.prepress_plan'`

- [ ] **Step 3: Write the implementation**

Create `server/upload/prepress_plan.py`:

```python
"""Prepress-plaani puhas loogika: poolituse geomeetria ja plaani tõlgendus.

Siin EI ole failioperatsioone ega renderdust — kõik funktsioonid on puhtad ja
testitavad ilma PDF-ita. Renderdus elab prepress.py-s, pikslite hankimine
page_source.py-s.

Plaani kuju (state.json → "prepress"):

    {
      "enabled": False,
      "default_split_x": 0.5,
      "preview_status": "idle",     # idle | rendering | ready | error
      "preview_done": 0,
      "pages": [
        {"n": 1, "mode": "default", "split_x": None, "excluded": False, "ink": None}
      ]
    }

mode: "default" = kasuta globaalset joont, "custom" = oma joon,
"nosplit" = ära poolita.
"""
from typing import List, Optional, Tuple


def default_plan(page_count: int) -> dict:
    """Uue uploadi vaikeplaan. enabled=False — poolitamine on destruktiivne
    teisendus ja seda ei tohi saada kogemata 'Edasi' vajutusega."""
    return {
        "enabled": False,
        "default_split_x": 0.5,
        "preview_status": "idle",
        "preview_done": 0,
        "pages": [
            {"n": n, "mode": "default", "split_x": None, "excluded": False, "ink": None}
            for n in range(1, page_count + 1)
        ],
    }


def _page_entry(plan: Optional[dict], n: int) -> Optional[dict]:
    if not plan:
        return None
    for entry in plan.get("pages", []):
        if entry.get("n") == n:
            return entry
    return None


def effective_split_x(plan: Optional[dict], n: int) -> Optional[float]:
    """Kas ja kus leht n poolitatakse. None = ei poolitata.

    enabled=False → alati None, sõltumata mode väärtusest. custom väärtused
    jäävad plaani alles inertsena, et lüliti välja-sisse lülitamine ei
    kustutaks admini tehtud tööd.
    """
    if not plan or not plan.get("enabled"):
        return None
    entry = _page_entry(plan, n)
    if entry is None:
        return None
    mode = entry.get("mode", "default")
    if mode == "nosplit":
        return None
    if mode == "custom":
        x = entry.get("split_x")
        return float(x) if x is not None else None
    return float(plan.get("default_split_x", 0.5))


def is_excluded(plan: Optional[dict], n: int) -> bool:
    """Kas leht on OCR-ist välja jäetud."""
    entry = _page_entry(plan, n)
    return bool(entry and entry.get("excluded"))


def is_trivial_plan(plan: Optional[dict]) -> bool:
    """Kas plaan taandub tänasele PDF-teele (ükski leht ei poolitu).

    Väljajätmised EI mõjuta triviaalsust: ainult-väljajätmise plaan on
    triviaalne ja originaalfail saadetakse muutmata edasi. Põhjus mõõdetud
    spetsis — PDF-i ümberehitus maksab ~36 s ja ~800 MB, kallim kui eelvaade.
    """
    if not plan or not plan.get("enabled"):
        return True
    return all(
        effective_split_x(plan, entry.get("n")) is None
        for entry in plan.get("pages", [])
    )


def page_cuts(plan: Optional[dict], n: int, width: int) -> List[Tuple[int, int]]:
    """Ühe lähtelehe väljundlõiked [(x0, x1), ...] järjekorras vasak → parem.

    Invariandid:
      - cut_px = round(width * split_x)
      - vasak [0, cut_px), parem [cut_px, width)
      - ükski piksliveerg ei kao ega dubleeru: summa == width
      - mõlemad pooled jäävad vähemalt 1 px laiuseks
      - väljajäetud leht annab tühja listi

    `width` on RENDERDATUD lehe laius, mitte PDF-i MediaBox. pdftoppm on
    /Rotate ja CropBox juba rakendanud; x_frac käib renderdatud
    orientatsioonile. Iga leht arvutab oma cut_px oma laiusest — skaneeringute
    laius kõigub päriselt.
    """
    if is_excluded(plan, n):
        return []
    x = effective_split_x(plan, n)
    if x is None:
        return [(0, width)]
    cut = int(round(width * x))
    cut = max(1, min(width - 1, cut))
    return [(0, cut), (cut, width)]


def plan_to_sequence(plan: Optional[dict], page_widths: List[int]) -> List[dict]:
    """Kogu väljundjärjend. page_widths[i] = lehe (i+1) renderdatud laius.

    Tagastab kirjed {"src_page", "x0", "x1", "out_index"}, kus out_index on
    1-põhine lõplik lehenumber. apply_and_transfer voogedastab lehthaaval ja
    kasutab page_cuts'i otse; see funktsioon on tervikvaate ja testide jaoks.
    """
    out: List[dict] = []
    for src_page, width in enumerate(page_widths, start=1):
        for (x0, x1) in page_cuts(plan, src_page, width):
            out.append({
                "src_page": src_page,
                "x0": x0,
                "x1": x1,
                "out_index": len(out) + 1,
            })
    return out


def output_page_count(plan: Optional[dict], page_count: int) -> int:
    """Mitu lehte OCR-i läheb. Ei sõltu laiustest — UI kokkuvõtte jaoks."""
    total = 0
    for n in range(1, page_count + 1):
        if is_excluded(plan, n):
            continue
        total += 2 if effective_split_x(plan, n) is not None else 1
    return total
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_prepress_plan.py -v`
Expected: PASS, kõik ~18 testi.

- [ ] **Step 5: Commit**

```bash
git add server/upload/prepress_plan.py tests/test_prepress_plan.py
git commit -m "feat(prepress): plaanimudel — poolitusgeomeetria puhta funktsioonina"
```

---

### Task 2: Lehepikslite allikas — PDF ja pildikaust ühe liidese taga

Ilma selle abstraktsioonita dubleeruks kogu plaaniloogika PDF- ja mitmepildi-teekonna vahel.

**Files:**
- Create: `server/upload/page_source.py`
- Test: `tests/test_page_source.py`

**Interfaces:**
- Consumes: midagi Task 1-st (sõltumatu)
- Produces:
  - konstandid `PREVIEW_DPI = 100`, `FULL_DPI = 300`, `JPEG_QUALITY = 95`
  - `class PageSource` meetoditega `page_count() -> int`, `full_width(n: int) -> int`, `render_preview(n: int, dst: str) -> None`, `render_full(n: int, dst: str) -> None`, `render_region(n: int, x_px: int, w_px: int, dst: str) -> None`
  - `PdfPageSource(pdf_path: str)`, `ImageDirPageSource(dir_path: str)`
  - `open_page_source(source_path: str) -> PageSource` — valib teostuse tee järgi
  - `nice_run(cmd: List[str], timeout: int) -> None`

- [ ] **Step 1: Write the failing test**

Create `tests/test_page_source.py`:

```python
"""Lehepikslite allikas: käsurea koostamine (PDF) ja PIL-tee (pildikaust)."""
import os

import pytest
from PIL import Image

from server.upload import page_source as ps


# --- PDF: käsurida, mitte päris renderdus ---

def _capture_cmds(monkeypatch):
    """Asendab nice_run'i koguja funktsiooniga; tagastab kogutud käsud."""
    calls = []
    monkeypatch.setattr(ps, "nice_run", lambda cmd, timeout=0: calls.append(cmd))
    return calls


def test_render_preview_kasutab_100_dpi_ja_uhte_lehte(monkeypatch, tmp_path):
    calls = _capture_cmds(monkeypatch)
    src = ps.PdfPageSource(str(tmp_path / "x.pdf"))
    src.render_preview(7, str(tmp_path / "out.jpg"))
    cmd = calls[0]
    assert "pdftoppm" in cmd[0]
    assert "-r" in cmd and cmd[cmd.index("-r") + 1] == "100"
    assert cmd[cmd.index("-f") + 1] == "7"
    assert cmd[cmd.index("-l") + 1] == "7"
    assert "-jpeg" in cmd


def test_render_full_kasutab_300_dpi_ja_quality_95(monkeypatch, tmp_path):
    """Peab kattuma OCR-serveri PDF_DPI=300 / quality=95 väärtustega."""
    calls = _capture_cmds(monkeypatch)
    src = ps.PdfPageSource(str(tmp_path / "x.pdf"))
    src.render_full(3, str(tmp_path / "out.jpg"))
    cmd = calls[0]
    assert cmd[cmd.index("-r") + 1] == "300"
    assert "quality=95" in cmd[cmd.index("-jpegopt") + 1]


def test_render_region_annab_x_y_w_h(monkeypatch, tmp_path):
    calls = _capture_cmds(monkeypatch)
    src = ps.PdfPageSource(str(tmp_path / "x.pdf"))
    src.render_region(2, x_px=1000, w_px=240, dst=str(tmp_path / "s.jpg"))
    cmd = calls[0]
    assert cmd[cmd.index("-x") + 1] == "1000"
    assert cmd[cmd.index("-W") + 1] == "240"
    assert cmd[cmd.index("-y") + 1] == "0"
    assert cmd[cmd.index("-H") + 1] == "0"   # 0 = kuni lehe lõpuni


def test_page_count_ei_kustuta_lahtefaili(monkeypatch, tmp_path):
    """file_detection.count_pdf_pages teeb vigase PDF-i korral safe_unlink'i.
    Salvestatud lähtefail peab alles jääma — kasutame kõrvalmõjuta lugejat."""
    pdf = tmp_path / "x.pdf"
    pdf.write_bytes(b"%PDF-1.4\n")
    monkeypatch.setattr(ps, "_pdfinfo_page_count", lambda path: 42)
    assert ps.PdfPageSource(str(pdf)).page_count() == 42
    assert pdf.exists()


def test_full_width_teisendab_punktid_300_dpi_pikslitesse(monkeypatch, tmp_path):
    monkeypatch.setattr(
        ps, "_pdfinfo_page_size_pts", lambda path, n: (299.52, 538.74)
    )
    src = ps.PdfPageSource(str(tmp_path / "x.pdf"))
    assert src.full_width(1) == round(299.52 * 300 / 72)


# --- Pildikaust: päris PIL ---

@pytest.fixture
def image_dir(tmp_path):
    d = tmp_path / "source"
    d.mkdir()
    for n, (w, h) in enumerate([(400, 300), (500, 300)], start=1):
        Image.new("RGB", (w, h), "white").save(d / f"pg_{n:03d}.jpg", "JPEG")
    return str(d)


def test_pildikaust_loeb_lehed_jarjekorras(image_dir):
    src = ps.ImageDirPageSource(image_dir)
    assert src.page_count() == 2
    assert src.full_width(1) == 400
    assert src.full_width(2) == 500


def test_pildikaust_render_preview_vahendab(image_dir, tmp_path):
    dst = str(tmp_path / "p.jpg")
    ps.ImageDirPageSource(image_dir).render_preview(1, dst)
    with Image.open(dst) as im:
        assert max(im.size) <= ps.PREVIEW_MAX_EDGE


def test_pildikaust_render_region_loikab_natiivselt(image_dir, tmp_path):
    dst = str(tmp_path / "s.jpg")
    ps.ImageDirPageSource(image_dir).render_region(1, x_px=100, w_px=60, dst=dst)
    with Image.open(dst) as im:
        assert im.size == (60, 300)


def test_open_page_source_valib_teostuse(image_dir, tmp_path):
    pdf = tmp_path / "x.pdf"
    pdf.write_bytes(b"%PDF-1.4\n")
    assert isinstance(ps.open_page_source(str(pdf)), ps.PdfPageSource)
    assert isinstance(ps.open_page_source(image_dir), ps.ImageDirPageSource)


def test_puuduv_leht_toustab_indexerror(image_dir):
    with pytest.raises(IndexError):
        ps.ImageDirPageSource(image_dir).full_width(99)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_page_source.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'server.upload.page_source'`

- [ ] **Step 3: Write the implementation**

Create `server/upload/page_source.py`:

```python
"""Lehepikslite allikas: PDF (pdftoppm) või pildikaust (PIL).

prepress.py ei tea, kumb on all — nii ei dubleeru plaaniloogika PDF- ja
mitmepildi-teekonna vahel.

DPI ja JPEG-kvaliteet PEAVAD kattuma OCR-serveri valvurskripti väärtustega
(~/Dokumendid/LLM/qwen3.5/kataloogi-jalgimine-ja-ocr.py: PDF_DPI = 300,
img.save(..., quality=95)). Kui need seal muutuvad, tuleb muuta ka siin.
"""
import glob
import os
import re
import subprocess
from typing import List, Optional, Tuple

from ..config import get_logger

logger = get_logger(__name__)

PREVIEW_DPI = 100          # kontaktlehe pisipilt — odav, ~0,05 s/lk
FULL_DPI = 300             # = OCR-serveri PDF_DPI
JPEG_QUALITY = 95          # = OCR-serveri img.save(quality=95)
PREVIEW_MAX_EDGE = 700     # pildikausta eelvaate pikim külg
RENDER_TIMEOUT = 120       # ühe lehe renderduse ülempiir sekundites
NICE_LEVEL = 10            # taustatöö ei tohi veebipäringuid näljutada


def nice_run(cmd: List[str], timeout: int = RENDER_TIMEOUT) -> None:
    """Käivitab alamprotsessi madala prioriteediga. Tõstab RuntimeError vea korral."""
    try:
        result = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout,
            preexec_fn=lambda: os.nice(NICE_LEVEL),
        )
    except subprocess.TimeoutExpired:
        raise RuntimeError("Renderdus aegus: {}".format(" ".join(cmd[:2])))
    except FileNotFoundError:
        raise RuntimeError("poppler-utils pole paigaldatud ({})".format(cmd[0]))
    if result.returncode != 0:
        raise RuntimeError(
            "Renderdus ebaõnnestus (exit={}): {}".format(
                result.returncode, result.stderr.decode("utf-8", "replace")[:300]
            )
        )


class PageSource:
    """Liides: anna leht N pikslitena."""

    def page_count(self) -> int:
        raise NotImplementedError

    def full_width(self, n: int) -> int:
        """Lehe laius pikslites FULL_DPI juures."""
        raise NotImplementedError

    def render_preview(self, n: int, dst: str) -> None:
        raise NotImplementedError

    def render_full(self, n: int, dst: str) -> None:
        raise NotImplementedError

    def render_region(self, n: int, x_px: int, w_px: int, dst: str) -> None:
        """Renderdab vertikaalse riba [x_px, x_px + w_px) kogu lehe kõrguses."""
        raise NotImplementedError


# --- PDF ---

_PAGE_SIZE_RE = re.compile(r"size:\s*([0-9.]+)\s*x\s*([0-9.]+)\s*pts")


def _pdfinfo_page_count(pdf_path: str) -> int:
    """Lehtede arv KÕRVALMÕJUTA.

    file_detection.count_pdf_pages kustutab vigase PDF-i (safe_unlink) — see
    sobib üleslaadimise valideerimiseks, aga mitte juba salvestatud lähtefaili
    lugemiseks.
    """
    result = subprocess.run(
        ["pdfinfo", pdf_path],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30,
    )
    for line in result.stdout.decode("utf-8", "replace").splitlines():
        if line.startswith("Pages:"):
            return int(line.split(":", 1)[1].strip())
    raise RuntimeError("pdfinfo ei andnud lehtede arvu: {}".format(pdf_path))


def _pdfinfo_page_size_pts(pdf_path: str, n: int) -> Tuple[float, float]:
    """Lehe mõõdud punktides. Eraldi funktsioon, et testid saaksid patchida."""
    result = subprocess.run(
        ["pdfinfo", "-f", str(n), "-l", str(n), pdf_path],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30,
    )
    for line in result.stdout.decode("utf-8", "replace").splitlines():
        if line.startswith("Page") and "size:" in line:
            match = _PAGE_SIZE_RE.search(line)
            if match:
                return float(match.group(1)), float(match.group(2))
    raise RuntimeError("pdfinfo ei andnud lehe {} mõõtu".format(n))


class PdfPageSource(PageSource):
    """pdftoppm-põhine allikas. `-x -y -W -H` võimaldab renderdada ainult
    piirkonda — see on see, mis teeb natiivse lahutusega köitevahe-riba odavaks."""

    def __init__(self, pdf_path: str):
        self.pdf_path = pdf_path
        self._count: Optional[int] = None

    def page_count(self) -> int:
        # EI kasuta file_detection.count_pdf_pages — see kutsub vigase PDF-i
        # korral safe_unlink(tmp_path) ja kustutaks salvestatud lähtefaili.
        # Siin on allikas juba valideeritud ja peab alles jääma.
        if self._count is None:
            self._count = _pdfinfo_page_count(self.pdf_path)
        return self._count

    def full_width(self, n: int) -> int:
        width_pts, _ = _pdfinfo_page_size_pts(self.pdf_path, n)
        return int(round(width_pts * FULL_DPI / 72.0))

    def _base(self, dst: str) -> str:
        """pdftoppm lisab ise -NNN.jpg — anname talle prefiksi."""
        return dst[:-4] if dst.endswith(".jpg") else dst

    def _finish(self, base: str, n: int, dst: str) -> None:
        """pdftoppm väljund on {base}-{n}.jpg (nulliga polsterdatud lehearvu järgi)."""
        matches = sorted(glob.glob(base + "-*.jpg"))
        if not matches:
            raise RuntimeError("pdftoppm ei loonud faili: {}".format(base))
        os.replace(matches[0], dst)
        for leftover in matches[1:]:
            os.unlink(leftover)

    def render_preview(self, n: int, dst: str) -> None:
        base = self._base(dst)
        nice_run([
            "pdftoppm", "-jpeg", "-jpegopt", "quality=80",
            "-r", str(PREVIEW_DPI), "-f", str(n), "-l", str(n),
            self.pdf_path, base,
        ])
        self._finish(base, n, dst)

    def render_full(self, n: int, dst: str) -> None:
        base = self._base(dst)
        nice_run([
            "pdftoppm", "-jpeg", "-jpegopt", "quality={}".format(JPEG_QUALITY),
            "-r", str(FULL_DPI), "-f", str(n), "-l", str(n),
            self.pdf_path, base,
        ])
        self._finish(base, n, dst)

    def render_region(self, n: int, x_px: int, w_px: int, dst: str) -> None:
        base = self._base(dst)
        nice_run([
            "pdftoppm", "-jpeg", "-jpegopt", "quality=88",
            "-r", str(FULL_DPI), "-f", str(n), "-l", str(n),
            "-x", str(x_px), "-y", "0", "-W", str(w_px), "-H", "0",
            self.pdf_path, base,
        ])
        self._finish(base, n, dst)


# --- Pildikaust (mitmepildi-upload) ---

class ImageDirPageSource(PageSource):
    """Pildid on juba pikslid — rasteriseerimist ei ole, ainult PIL."""

    def __init__(self, dir_path: str):
        self.dir_path = dir_path
        self._files: Optional[List[str]] = None

    def _list(self) -> List[str]:
        if self._files is None:
            self._files = sorted(
                f for f in os.listdir(self.dir_path)
                if f.lower().endswith((".jpg", ".jpeg", ".png"))
            )
        return self._files

    def _path(self, n: int) -> str:
        files = self._list()
        if n < 1 or n > len(files):
            raise IndexError("Lehte {} ei ole ({} lehte)".format(n, len(files)))
        return os.path.join(self.dir_path, files[n - 1])

    def page_count(self) -> int:
        return len(self._list())

    def full_width(self, n: int) -> int:
        from PIL import Image
        with Image.open(self._path(n)) as im:
            return im.size[0]

    def render_preview(self, n: int, dst: str) -> None:
        from PIL import Image
        with Image.open(self._path(n)) as im:
            thumb = im.convert("RGB")
            thumb.thumbnail((PREVIEW_MAX_EDGE, PREVIEW_MAX_EDGE), Image.LANCZOS)
            thumb.save(dst, "JPEG", quality=80)

    def render_full(self, n: int, dst: str) -> None:
        from PIL import Image
        with Image.open(self._path(n)) as im:
            im.convert("RGB").save(dst, "JPEG", quality=JPEG_QUALITY)

    def render_region(self, n: int, x_px: int, w_px: int, dst: str) -> None:
        from PIL import Image
        with Image.open(self._path(n)) as im:
            rgb = im.convert("RGB")
            box = (x_px, 0, min(x_px + w_px, rgb.size[0]), rgb.size[1])
            rgb.crop(box).save(dst, "JPEG", quality=88)


def open_page_source(source_path: str) -> PageSource:
    """Valib teostuse tee järgi: kaust → pildid, fail → PDF."""
    if os.path.isdir(source_path):
        return ImageDirPageSource(source_path)
    return PdfPageSource(source_path)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_page_source.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/upload/page_source.py tests/test_page_source.py
git commit -m "feat(prepress): lehepikslite allikas — PDF ja pildikaust ühe liidese taga"
```

---

### Task 3: Oleku turvaline muutmine — `mutate_prepress` ja apply-CAS

Eelvaate lõim uuendab edenemist samal ajal, kui admin POST-ib plaani. Olemasolev `set_upload_state(**extra)` seab **terveid ülemise taseme võtmeid** luku all — see hoiab ära rebenenud kirjutuse, aga mitte kadunud uuenduse.

**Files:**
- Modify: `server/upload/state.py` (lisa funktsioonid faili lõppu)
- Modify: `server/upload/thumbs.py:60` (varajase väljumise staatuste loend)
- Test: `tests/test_prepress_state.py`

**Interfaces:**
- Consumes: `prepress_plan.default_plan` (Task 1)
- Produces:
  - `init_prepress(upload_id: str, page_count: int) -> Optional[dict]`
  - `mutate_prepress(upload_id: str, fn: Callable[[dict], None]) -> Optional[dict]`
  - `try_begin_applying(upload_id: str) -> bool`
  - konstant `PREPRESS_IDLE_STATUSES = ("awaiting_split", "prepping", "applying")`

- [ ] **Step 1: Write the failing test**

Create `tests/test_prepress_state.py`:

```python
"""Prepress-oleku samaaegne muutmine ja apply-CAS."""
import json
import os
import threading

import pytest

from server.upload import state as upload_state
from server.upload import prepress_plan as pp


@pytest.fixture
def upload(tmp_path, monkeypatch):
    """Loob päris state.json ajutisse UPLOADS_DIR-i."""
    monkeypatch.setattr(upload_state, "UPLOADS_DIR", str(tmp_path), raising=False)
    monkeypatch.setattr(
        upload_state, "upload_dir", lambda uid: os.path.join(str(tmp_path), uid)
    )
    uid = "abc123"
    os.makedirs(os.path.join(str(tmp_path), uid))
    upload_state.write_state(uid, {"id": uid, "status": "awaiting_split", "files": []})
    return uid


def _read(upload, key):
    with open(upload_state.state_path(upload), encoding="utf-8") as f:
        return json.load(f).get(key)


def test_init_prepress_loob_vaikeplaani(upload):
    plan = upload_state.init_prepress(upload, 3)
    assert plan["enabled"] is False
    assert len(plan["pages"]) == 3
    assert _read(upload, "prepress")["default_split_x"] == 0.5


def test_init_prepress_on_idempotentne(upload):
    upload_state.init_prepress(upload, 3)
    upload_state.mutate_prepress(upload, lambda p: p.update(enabled=True))
    again = upload_state.init_prepress(upload, 3)
    assert again["enabled"] is True   # ei lähtesta olemasolevat


def test_mutate_prepress_ilma_plaanita_tagastab_none(upload):
    assert upload_state.mutate_prepress(upload, lambda p: None) is None


def test_eelvaate_edenemine_ei_kaota_samal_ajal_salvestatud_custom_plaani(upload):
    """KRIITILINE: preview-lõim ja plaani POST kirjutavad sama state.json-i.
    Kumbki ei tohi teise välju üle kirjutada."""
    upload_state.init_prepress(upload, 3)

    def set_custom(plan):
        plan["enabled"] = True
        plan["pages"][1].update(mode="custom", split_x=0.459)

    def bump_progress(plan):
        plan["preview_status"] = "rendering"
        plan["preview_done"] = plan.get("preview_done", 0) + 1

    barrier = threading.Barrier(2)
    errors = []

    def worker(fn, times):
        try:
            barrier.wait()
            for _ in range(times):
                upload_state.mutate_prepress(upload, fn)
        except Exception as e:  # pragma: no cover
            errors.append(e)

    t1 = threading.Thread(target=worker, args=(set_custom, 20))
    t2 = threading.Thread(target=worker, args=(bump_progress, 20))
    t1.start(); t2.start(); t1.join(); t2.join()

    assert errors == []
    final = _read(upload, "prepress")
    assert final["pages"][1]["mode"] == "custom"       # plaan alles
    assert final["pages"][1]["split_x"] == 0.459
    assert final["preview_done"] == 20                  # edenemine alles
    assert pp.effective_split_x(final, 2) == 0.459


def test_try_begin_applying_esimene_saab_loa(upload):
    assert upload_state.try_begin_applying(upload) is True
    assert _read(upload, "status") == "applying"


def test_try_begin_applying_teine_kutse_ei_saa(upload):
    """Topeltklikk, retry või brauseri refresh ei tohi käivitada teist
    paralleelset 300 DPI renderdust."""
    assert upload_state.try_begin_applying(upload) is True
    assert upload_state.try_begin_applying(upload) is False


def test_try_begin_applying_valest_staatusest_ei_saa(upload):
    upload_state.set_upload_state(upload, status="processing")
    assert upload_state.try_begin_applying(upload) is False


def test_try_begin_applying_on_voistlusekindel(upload):
    """20 lõime, täpselt üks võidab."""
    results = []
    barrier = threading.Barrier(20)

    def attempt():
        barrier.wait()
        results.append(upload_state.try_begin_applying(upload))

    threads = [threading.Thread(target=attempt) for _ in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert results.count(True) == 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_prepress_state.py -v`
Expected: FAIL — `AttributeError: module 'server.upload.state' has no attribute 'init_prepress'`

- [ ] **Step 3: Write the implementation**

Append to `server/upload/state.py` (pärast `set_upload_state`):

```python
# Staatused, mille korral OCR-serveri SFTP-pollimist ei ole vaja: fail on
# VUTT-i poolel ja OCR pole veel alanud.
PREPRESS_IDLE_STATUSES = ("awaiting_split", "prepping", "applying")


def init_prepress(upload_id: str, page_count: int) -> Optional[dict]:
    """Loob prepress-plaani, kui seda veel pole. Idempotentne: olemasolevat
    plaani EI lähtestata (admin võib olla juua jõudnud jooni seada)."""
    from . import prepress_plan

    lock = get_upload_lock(upload_id)
    with lock:
        s = read_state(upload_id)
        if not s:
            return None
        if s.get("prepress") is None:
            s["prepress"] = prepress_plan.default_plan(page_count)
            write_state(upload_id, s)
        return s["prepress"]


def mutate_prepress(upload_id: str, fn) -> Optional[dict]:
    """AINUS lubatud viis prepress-alamvälju muuta.

    fn saab praeguse prepress-dikti ja muudab seda KOHAPEAL; lugemine,
    muutmine ja kirjutamine käivad sama luku sees.

    Miks mitte set_upload_state(prepress=...): see seab terve ülemise taseme
    võtme. Kui eelvaate lõim kirjutaks eelarvutatud prepress-dikti tervikuna,
    pühiks see admini äsja salvestatud custom joone maha (lost update).
    """
    lock = get_upload_lock(upload_id)
    with lock:
        s = read_state(upload_id)
        if not s:
            return None
        prepress = s.get("prepress")
        if prepress is None:
            return None
        fn(prepress)
        s["prepress"] = prepress
        write_state(upload_id, s)
        return prepress


def try_begin_applying(upload_id: str) -> bool:
    """CAS: awaiting_split → applying. Tagastab False, kui töö juba käib.

    Tagab, et topeltklikk, retry või brauseri refresh ei käivita teist
    paralleelset 300 DPI renderdust ega SFTP-d.
    """
    lock = get_upload_lock(upload_id)
    with lock:
        s = read_state(upload_id)
        if not s or s.get("status") != "awaiting_split":
            return False
        s["status"] = "applying"
        write_state(upload_id, s)
        return True
```

- [ ] **Step 4: Add the new statuses to the thumbs early return**

Modify `server/upload/thumbs.py`. Leia rida:

```python
    if current_status in ("pending", "uploading", "error", "imported", "collecting_images"):
```

Asenda:

```python
    # PREPRESS_IDLE_STATUSES: fail on VUTT-i poolel, OCR-serveris pole veel midagi
    if current_status in (
        "pending", "uploading", "error", "imported", "collecting_images",
    ) + upload_state.PREPRESS_IDLE_STATUSES:
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/bin/pytest tests/test_prepress_state.py tests/test_upload_background_sync.py -v`
Expected: PASS. `test_upload_background_sync.py` peab jääma roheliseks — `_uploads_needing_sync` valib ainult `processing`/`reviewing`, nii et uued staatused ei satu taustasünki.

- [ ] **Step 6: Commit**

```bash
git add server/upload/state.py server/upload/thumbs.py tests/test_prepress_state.py
git commit -m "feat(prepress): mutate_prepress ja apply-CAS — kadunud uuenduse vastu"
```

---

### Task 4: Eelvaate renderdus ja tindiskoor

100 DPI kontaktleht, taustalõimes, `Semaphore(1)` + `nice`. Tindiskoor arvutatakse eelvaatelt — statistikale piisab ja tasuta renderdust juurde ei tule.

**Files:**
- Create: `server/upload/prepress.py`
- Test: `tests/test_prepress_ink.py`

**Interfaces:**
- Consumes: `page_source.open_page_source`, `state.mutate_prepress`, `state.init_prepress`, `prepress_plan`
- Produces:
  - `RENDER_SEMAPHORE: threading.Semaphore`
  - `preview_dir(upload_id) -> str`, `strips_dir(upload_id) -> str`, `source_path(upload_id, state) -> str`
  - `percentile_from_hist(hist: List[int], q: float) -> int`
  - `ink_score(preview_path: str, x_frac: float, half_px: int = 2) -> float`
  - `start_preview(upload_id: str) -> None`

- [ ] **Step 1: Write the failing test**

Create `tests/test_prepress_ink.py`:

```python
"""Tindiskoor: kas joon lõikab kirja. Usaldusväärne AINULT kõrge väärtuse suunas."""
from PIL import Image, ImageDraw

from server.upload import prepress


def _page(tmp_path, name, draw_fn=None):
    """Valge A4-laadne leht; draw_fn saab joonistada musta."""
    im = Image.new("L", (400, 600), 255)
    if draw_fn:
        draw_fn(ImageDraw.Draw(im))
    path = str(tmp_path / name)
    im.convert("RGB").save(path, "JPEG", quality=95)
    return path


# --- percentile_from_hist (puhas) ---

def test_percentile_from_hist_uhtlane():
    hist = [0] * 256
    for v in range(256):
        hist[v] = 1
    assert percentile := prepress.percentile_from_hist(hist, 0.5)
    assert 120 <= percentile <= 135


def test_percentile_from_hist_tyhi():
    assert prepress.percentile_from_hist([0] * 256, 0.35) == 0


# --- ink_score ---

def test_puhas_veerg_annab_madala_skoori(tmp_path):
    path = _page(tmp_path, "clean.jpg")
    assert prepress.ink_score(path, 0.5) < 0.05


def test_must_tulp_teadaoleval_x_il_annab_korge_skoori(tmp_path):
    """Sünteetiline vaste lehele 003: joon jookseb mööda tumedat murdevarju."""
    path = _page(tmp_path, "bar.jpg", lambda d: d.rectangle([196, 0, 204, 600], fill=0))
    assert prepress.ink_score(path, 0.5) > 0.85


def test_skoor_langeb_tulbast_eemale(tmp_path):
    path = _page(tmp_path, "bar2.jpg", lambda d: d.rectangle([196, 0, 204, 600], fill=0))
    assert prepress.ink_score(path, 0.5) > 0.85
    assert prepress.ink_score(path, 0.30) < 0.05


def test_skoor_ignoreerib_lehe_ylemist_ja_alumist_serva(tmp_path):
    """Ülemine/alumine 6% on lehenumbrid ja servad — need ei tohi skoori tõsta."""
    path = _page(tmp_path, "edges.jpg", lambda d: (
        d.rectangle([196, 0, 204, 20], fill=0),
        d.rectangle([196, 580, 204, 600], fill=0),
    ))
    assert prepress.ink_score(path, 0.5) < 0.10


def test_skoor_on_alati_vahemikus_0_1(tmp_path):
    path = _page(tmp_path, "full.jpg", lambda d: d.rectangle([0, 0, 400, 600], fill=0))
    score = prepress.ink_score(path, 0.5)
    assert 0.0 <= score <= 1.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_prepress_ink.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'server.upload.prepress'`

- [ ] **Step 3: Write the implementation**

Create `server/upload/prepress.py`:

```python
"""Prepress: eelvaade, tindiskoor, köitevahe-riba ja 300 DPI läbikäik.

Plaani puhas loogika on prepress_plan.py-s, pikslite hankimine
page_source.py-s. Siin on I/O, taustalõimed ja oleku uuendamine.

CPU-kaitse: RENDER_SEMAPHORE lubab ühe rasteriseerimistöö korraga.
NB — see kaitse on PROTSESSI-LOKAALNE. Praeguse single-worker uvicorni juures
piisav; mitme workeri peale minnes ei ole threading.Semaphore enam globaalne
piirang.
"""
import os
import threading
from typing import List, Optional

from ..config import get_logger
from . import page_source, prepress_plan
from . import state as upload_state

logger = get_logger(__name__)

RENDER_SEMAPHORE = threading.Semaphore(1)

# Kui suur osa lehe laiusest köitevahe-ribal näidatakse (±5% joonest).
STRIP_FRAC = 0.05

# Mitu ribakaadrit lehe kohta vahemälus hoitakse (LRU).
STRIP_CACHE_PER_PAGE = 6

# Tindiskoori lävi: mis on "tint" selle lehe enda tonaalsuses.
INK_PERCENTILE = 0.35


def preview_dir(upload_id: str) -> str:
    return os.path.join(upload_state.upload_dir(upload_id), "preview")


def strips_dir(upload_id: str) -> str:
    return os.path.join(upload_state.upload_dir(upload_id), "strips")


def preview_path(upload_id: str, n: int) -> str:
    return os.path.join(preview_dir(upload_id), "pg_{:04d}.jpg".format(n))


def source_path(upload_id: str) -> Optional[str]:
    """Salvestatud lähteallikas: source.pdf (fail) või source/ (pildikaust)."""
    base = upload_state.upload_dir(upload_id)
    pdf = os.path.join(base, "source.pdf")
    if os.path.isfile(pdf):
        return pdf
    images = os.path.join(base, "source")
    if os.path.isdir(images):
        return images
    return None


# --- Tindiskoor ---

def percentile_from_hist(hist: List[int], q: float) -> int:
    """q-kvantiil 256-lahtrilisest halltooni histogrammist. Puhas funktsioon.

    Kasutame histogrammi, mitte numpy'd — numpy ei ole requirements.txt-is.
    """
    total = sum(hist)
    if total == 0:
        return 0
    target = total * q
    running = 0
    for value, count in enumerate(hist):
        running += count
        if running >= target:
            return value
    return 255


def ink_score(preview_path_: str, x_frac: float, half_px: int = 2) -> float:
    """Tindi osakaal veerus x_frac (±half_px), lehe keskmises 88% kõrguses.

    Usaldusväärne AINULT kõrge väärtuse suunas: kõrge skoor = joon lõikab
    kindlasti midagi; madal skoor EI tähenda õiget kohta (tühi veeris skoorib
    samuti 0). Vt spetsi mõõtmisi.
    """
    from PIL import Image

    with Image.open(preview_path_) as im:
        gray = im.convert("L")
        width, height = gray.size
        y0, y1 = int(height * 0.06), int(height * 0.94)
        if y1 <= y0 or width == 0:
            return 0.0

        core = gray.crop((0, y0, width, y1))
        threshold = percentile_from_hist(core.histogram(), INK_PERCENTILE)

        x = int(round(width * x_frac))
        bx0 = max(0, x - half_px)
        bx1 = min(width, x + half_px + 1)
        band = core.crop((bx0, y0 - y0, bx1, y1 - y0))
        pixels = list(band.getdata())
        if not pixels:
            return 0.0
        return sum(1 for p in pixels if p < threshold) / float(len(pixels))


# --- Eelvaate renderdus ---

def _render_previews(upload_id: str) -> None:
    """Taustalõime siht: renderdab kõik eelvaated ja arvutab tindiskoorid."""
    src_path = source_path(upload_id)
    if not src_path:
        upload_state.mutate_prepress(
            upload_id, lambda p: p.update(preview_status="error")
        )
        return

    with RENDER_SEMAPHORE:
        try:
            source = page_source.open_page_source(src_path)
            count = source.page_count()
            os.makedirs(preview_dir(upload_id), exist_ok=True)

            upload_state.mutate_prepress(
                upload_id,
                lambda p: p.update(preview_status="rendering", preview_done=0),
            )

            for n in range(1, count + 1):
                dst = preview_path(upload_id, n)
                if not os.path.isfile(dst):
                    source.render_preview(n, dst)

                default_x = 0.5
                score = round(ink_score(dst, default_x), 3)

                def _bump(plan, n=n, score=score):
                    for entry in plan.get("pages", []):
                        if entry.get("n") == n:
                            entry["ink"] = score
                            break
                    plan["preview_done"] = n

                upload_state.mutate_prepress(upload_id, _bump)

            upload_state.mutate_prepress(
                upload_id, lambda p: p.update(preview_status="ready")
            )
            upload_state.set_upload_state(upload_id, status="awaiting_split")
            logger.info("Prepress eelvaade valmis: {} ({} lk)".format(upload_id, count))

        except Exception as e:
            logger.error("Prepress eelvaade {}: {}".format(upload_id, e))
            upload_state.mutate_prepress(
                upload_id, lambda p: p.update(preview_status="error")
            )
            upload_state.set_upload_state(upload_id, status="awaiting_split")


def start_preview(upload_id: str) -> None:
    """Käivitab eelvaate taustalõimes. Idempotentne: juba käiv töö jäetakse rahule."""
    lock = upload_state.get_upload_lock(upload_id)
    with lock:
        s = upload_state.read_state(upload_id)
        if not s:
            return
        plan = s.get("prepress") or {}
        if plan.get("preview_status") == "rendering":
            return
        s["status"] = "prepping"
        plan["preview_status"] = "rendering"
        s["prepress"] = plan
        upload_state.write_state(upload_id, s)

    threading.Thread(
        target=_render_previews, args=(upload_id,),
        daemon=True, name="prepress-preview-{}".format(upload_id),
    ).start()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_prepress_ink.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/upload/prepress.py tests/test_prepress_ink.py
git commit -m "feat(prepress): 100 DPI eelvaade taustal + tindiskoor histogrammist"
```

---

### Task 5: Köitevahe-riba — kvantimine ja vahemälu

Ilma kvantimiseta tekitaks joone lohistamine (`x = 0.5001, 0.5002, …`) sadu peaaegu identseid ribafaile.

**Files:**
- Modify: `server/upload/prepress.py` (lisa funktsioonid faili lõppu)
- Test: `tests/test_prepress_strip.py`

**Interfaces:**
- Consumes: `page_source.PageSource`, `prepress.strips_dir`, `prepress.source_path`
- Produces:
  - `quantize_x(x_frac: float, full_width: int) -> int`
  - `strip_cache_path(upload_id: str, n: int, x_px: int) -> str`
  - `get_gutter_strip(upload_id: str, n: int, x_frac: float) -> str`
  - `prune_strip_cache(upload_id: str, n: int, keep: int = STRIP_CACHE_PER_PAGE) -> None`

- [ ] **Step 1: Write the failing test**

Create `tests/test_prepress_strip.py`:

```python
"""Köitevahe-riba: x kvantimine ja vahemälu LRU."""
import os
import time

import pytest

from server.upload import prepress


# --- quantize_x ---

def test_kvantimine_annab_pikslikoordinaadi():
    assert prepress.quantize_x(0.5, 4960) == 2480


def test_labilaskvad_x_vaartused_kvantuvad_samaks():
    """0.5001 ja 0.5002 peavad andma SAMA cache-võtme — muidu tekib
    lohistamisel sadu peaaegu identseid faile."""
    assert prepress.quantize_x(0.50001, 4960) == prepress.quantize_x(0.50002, 4960)


def test_kvantimine_ei_luba_serva():
    assert prepress.quantize_x(0.0, 1000) == 1
    assert prepress.quantize_x(1.0, 1000) == 999


def test_erineva_laiusega_lehed_annavad_erineva_pikslikoordinaadi():
    assert prepress.quantize_x(0.5, 2280) == 1140
    assert prepress.quantize_x(0.5, 2344) == 1172


# --- cache ---

@pytest.fixture
def upload(tmp_path, monkeypatch):
    uid = "u1"
    base = tmp_path / uid
    (base / "strips").mkdir(parents=True)
    monkeypatch.setattr(prepress.upload_state, "upload_dir", lambda i: str(base))
    return uid


def test_strip_cache_path_sisaldab_lehte_ja_kvantitud_x_i(upload):
    path = prepress.strip_cache_path(upload, 7, 2480)
    assert os.path.basename(path) == "0007_2480.jpg"


def test_prune_hoiab_ainult_viimased_keep_faili(upload):
    d = prepress.strips_dir(upload)
    for i in range(10):
        p = os.path.join(d, "0003_{}.jpg".format(1000 + i))
        with open(p, "wb") as f:
            f.write(b"x")
        os.utime(p, (time.time() + i, time.time() + i))
    prepress.prune_strip_cache(upload, 3, keep=4)
    remaining = sorted(os.listdir(d))
    assert len(remaining) == 4
    assert remaining[-1] == "0003_1009.jpg"   # uusim alles


def test_prune_ei_puutu_teiste_lehtede_ribasid(upload):
    d = prepress.strips_dir(upload)
    for name in ["0003_1000.jpg", "0003_1001.jpg", "0009_1000.jpg"]:
        with open(os.path.join(d, name), "wb") as f:
            f.write(b"x")
    prepress.prune_strip_cache(upload, 3, keep=1)
    assert "0009_1000.jpg" in os.listdir(d)


def test_get_gutter_strip_kasutab_vahemalu_teisel_kutsel(upload, monkeypatch):
    renders = []

    class FakeSource:
        def full_width(self, n):
            return 4960

        def render_region(self, n, x_px, w_px, dst):
            renders.append((n, x_px, w_px))
            with open(dst, "wb") as f:
                f.write(b"jpg")

    monkeypatch.setattr(prepress, "source_path", lambda uid: "/fake/source.pdf")
    monkeypatch.setattr(
        prepress.page_source, "open_page_source", lambda p: FakeSource()
    )

    first = prepress.get_gutter_strip(upload, 2, 0.5)
    second = prepress.get_gutter_strip(upload, 2, 0.5)
    assert first == second
    assert len(renders) == 1                       # teine kutse tuli vahemälust
    assert renders[0] == (2, 2480 - 248, 2 * 248)  # ±5% laiusest
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_prepress_strip.py -v`
Expected: FAIL — `AttributeError: module 'server.upload.prepress' has no attribute 'quantize_x'`

- [ ] **Step 3: Write the implementation**

Append to `server/upload/prepress.py`:

```python
# --- Köitevahe-riba ---

def quantize_x(x_frac: float, full_width: int) -> int:
    """x → tegelik FULL_DPI pikslikoordinaat.

    See on AINUS koht, kus x normaliseeritakse, ja sama väärtus on nii
    renderduse argument kui vahemälu võti. Ilma selleta tekitaks joone
    lohistamine (0.5001, 0.5002, …) sadu peaaegu identseid ribafaile.
    """
    x_px = int(round(full_width * x_frac))
    return max(1, min(full_width - 1, x_px))


def strip_cache_path(upload_id: str, n: int, x_px: int) -> str:
    return os.path.join(strips_dir(upload_id), "{:04d}_{}.jpg".format(n, x_px))


def prune_strip_cache(upload_id: str, n: int, keep: int = STRIP_CACHE_PER_PAGE) -> None:
    """LRU: hoiab lehe kohta ainult `keep` uusimat riba.

    Ilma selleta koguneksid strips/ failid uploads/ alla märkamatult, eriti
    kui admin joont pikalt nihutab.
    """
    prefix = "{:04d}_".format(n)
    directory = strips_dir(upload_id)
    try:
        entries = [f for f in os.listdir(directory) if f.startswith(prefix)]
    except FileNotFoundError:
        return
    if len(entries) <= keep:
        return
    entries.sort(key=lambda f: os.path.getmtime(os.path.join(directory, f)))
    for name in entries[:-keep]:
        try:
            os.unlink(os.path.join(directory, name))
        except OSError:
            pass


def get_gutter_strip(upload_id: str, n: int, x_frac: float) -> str:
    """Tagastab natiivse FULL_DPI riba tee, renderdades ainult vajadusel.

    Riba on ±STRIP_FRAC joonest. Renderdatakse AINULT see piirkond
    (pdftoppm -x -y -W -H), mitte terve leht — mõõdetuna 0,09 s/lk vs 0,47.
    """
    src = source_path(upload_id)
    if not src:
        raise FileNotFoundError("Uploadi lähteallikat ei leitud: {}".format(upload_id))

    source = page_source.open_page_source(src)
    full_width = source.full_width(n)
    x_px = quantize_x(x_frac, full_width)

    dst = strip_cache_path(upload_id, n, x_px)
    if os.path.isfile(dst):
        return dst

    os.makedirs(strips_dir(upload_id), exist_ok=True)
    half = max(1, int(round(full_width * STRIP_FRAC)))
    region_x = max(0, x_px - half)
    region_w = min(full_width - region_x, 2 * half)

    tmp = dst + ".tmp"
    with RENDER_SEMAPHORE:
        source.render_region(n, region_x, region_w, tmp)
    os.replace(tmp, dst)

    prune_strip_cache(upload_id, n)
    return dst
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_prepress_strip.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/upload/prepress.py tests/test_prepress_strip.py
git commit -m "feat(prepress): köitevahe-riba nõudmisel, kvantitud x + LRU vahemälu"
```

---

Plaani ülejäänud osa (Task 6–14) kirjutan järgmisena samasse faili.
