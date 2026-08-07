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

### Task 6: 300 DPI läbikäik ja aatomiline avaldamine

Voogedastus lehthaaval: renderda → lõika → saada → kustuta. Kogu teost ei materialiseerita (300-leheline topeltlehtedega teos oleks ~1 GB).

**Files:**
- Create: `server/upload/prepress_apply.py`
- Test: `tests/test_prepress_apply.py`

**Interfaces:**
- Consumes: `prepress_plan.page_cuts`, `prepress_plan.is_trivial_plan`, `page_source.open_page_source`, `prepress.source_path`, `prepress.RENDER_SEMAPHORE`, `ocr_client.sftp_open`, `ocr_client.ensure_remote_dirs`
- Produces:
  - `remote_page_name(slug: str, out_index: int) -> str`
  - `publish_atomic(sftp, local_path: str, remote_path: str) -> None`
  - `apply_and_transfer(upload_id: str) -> None` (taustalõime siht)
  - `start_apply(upload_id: str) -> bool`

- [ ] **Step 1: Write the failing test**

Create `tests/test_prepress_apply.py`:

```python
"""300 DPI läbikäik: nimetamine, aatomiline avaldamine, voogedastus."""
import os

import pytest
from PIL import Image

from server.upload import prepress_apply


class FakeSftp:
    """Salvestab put/rename kutsed, et saaks kontrollida .tmp+rename mustrit."""

    def __init__(self):
        self.puts = []
        self.renames = []
        self.closed = False

    def put(self, local, remote, callback=None):
        self.puts.append(remote)

    def rename(self, src, dst):
        self.renames.append((src, dst))

    def stat(self, path):
        raise FileNotFoundError(path)

    def mkdir(self, path):
        pass

    def close(self):
        self.closed = True


# --- nimetamine ---

def test_remote_page_name_on_ocr_serveri_konventsioonis():
    """OCR-server leiab pildid rglob-iga; nimi peab järgima {slug}_pg_NNN.jpg."""
    assert prepress_apply.remote_page_name("kirik-abc", 1) == "kirik-abc_pg_001.jpg"
    assert prepress_apply.remote_page_name("kirik-abc", 42) == "kirik-abc_pg_042.jpg"
    assert prepress_apply.remote_page_name("kirik-abc", 1234) == "kirik-abc_pg_1234.jpg"


# --- aatomiline avaldamine ---

def test_publish_atomic_laeb_tmp_nimega_ja_nimetab_ymber(tmp_path):
    """OCR-serveri valvuril EI OLE piltidele stabiilsuskontrolli
    (wait_for_file_stable kutsutakse ainult PDF-ide peale). Poolik JPG satuks
    OCR-i. .jpg.tmp jääb valvuri EXTENSIONS filtrist välja."""
    local = tmp_path / "a.jpg"
    local.write_bytes(b"jpeg")
    sftp = FakeSftp()
    prepress_apply.publish_atomic(sftp, str(local), "/remote/x_pg_001.jpg")
    assert sftp.puts == ["/remote/x_pg_001.jpg.tmp"]
    assert sftp.renames == [("/remote/x_pg_001.jpg.tmp", "/remote/x_pg_001.jpg")]


# --- voogedastus ---

@pytest.fixture
def upload(tmp_path, monkeypatch):
    """Kolme lehega pildikaust lähteallikaks."""
    uid = "u1"
    base = tmp_path / uid
    src = base / "source"
    src.mkdir(parents=True)
    for n, width in enumerate([400, 500, 400], start=1):
        Image.new("RGB", (width, 300), "white").save(src / "pg_{:03d}.jpg".format(n))
    monkeypatch.setattr(
        prepress_apply.upload_state, "upload_dir", lambda i: str(base)
    )
    monkeypatch.setattr(prepress_apply.prepress, "source_path", lambda i: str(src))
    return uid, base


def _plan(**over):
    from server.upload import prepress_plan
    plan = prepress_plan.default_plan(3)
    plan.update(over)
    return plan


def test_poolitatud_lehed_saadetakse_vasak_parem_jarjekorras(upload, monkeypatch):
    uid, base = upload
    sftp = FakeSftp()
    monkeypatch.setattr(prepress_apply.ocr_client, "sftp_open", lambda i: sftp)
    prepress_apply._transfer_pages(uid, "kirik-abc", "/remote", _plan(enabled=True))

    assert sftp.renames == [
        ("/remote/kirik-abc_pg_001.jpg.tmp", "/remote/kirik-abc_pg_001.jpg"),
        ("/remote/kirik-abc_pg_002.jpg.tmp", "/remote/kirik-abc_pg_002.jpg"),
        ("/remote/kirik-abc_pg_003.jpg.tmp", "/remote/kirik-abc_pg_003.jpg"),
        ("/remote/kirik-abc_pg_004.jpg.tmp", "/remote/kirik-abc_pg_004.jpg"),
        ("/remote/kirik-abc_pg_005.jpg.tmp", "/remote/kirik-abc_pg_005.jpg"),
        ("/remote/kirik-abc_pg_006.jpg.tmp", "/remote/kirik-abc_pg_006.jpg"),
    ]


def test_valjajaetud_lehte_ei_renderdata_ega_saadeta(upload, monkeypatch):
    uid, base = upload
    sftp = FakeSftp()
    monkeypatch.setattr(prepress_apply.ocr_client, "sftp_open", lambda i: sftp)
    plan = _plan(enabled=True)
    plan["pages"][1]["excluded"] = True
    prepress_apply._transfer_pages(uid, "s", "/remote", plan)
    assert len(sftp.renames) == 4     # lehed 1 ja 3 poolitatud, leht 2 välja


def test_ajutised_failid_kustutatakse_kohe(upload, monkeypatch):
    """Voogedastus: kogu teost ei materialiseerita lokaalselt."""
    uid, base = upload
    sftp = FakeSftp()
    monkeypatch.setattr(prepress_apply.ocr_client, "sftp_open", lambda i: sftp)
    prepress_apply._transfer_pages(uid, "s", "/remote", _plan(enabled=True))
    work = base / "apply_tmp"
    assert not work.exists() or os.listdir(str(work)) == []


def test_poolituse_laius_tuleb_iga_lehe_enda_moodust(upload, monkeypatch):
    """Leht 1 on 400 px, leht 2 on 500 px — cut_px peab erinema."""
    uid, base = upload
    widths = []
    sftp = FakeSftp()
    monkeypatch.setattr(prepress_apply.ocr_client, "sftp_open", lambda i: sftp)
    orig = prepress_apply._write_cut

    def spy(src_img, x0, x1, dst):
        widths.append(x1 - x0)
        return orig(src_img, x0, x1, dst)

    monkeypatch.setattr(prepress_apply, "_write_cut", spy)
    prepress_apply._transfer_pages(uid, "s", "/remote", _plan(enabled=True))
    assert widths[:4] == [200, 200, 250, 250]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_prepress_apply.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'server.upload.prepress_apply'`

- [ ] **Step 3: Write the implementation**

Create `server/upload/prepress_apply.py`:

```python
"""300 DPI läbikäik: renderda → lõika → saada → kustuta, lehthaaval.

Eraldi moodul prepress.py-st, sest see on ainus koht, mis puudutab SFTP-d ja
OCR-serveri nimekonventsiooni.

Voogedastus, mitte materialiseerimine: 300-leheline topeltlehtedega teos annaks
~1 GB JPG-sid. Kõrvalefektina alustab OCR-server lehest 1 sel ajal, kui meie
alles renderdame lehte 50.
"""
import os
import shutil
import threading
from typing import Optional

from ..config import OCR_SERVER_PATH, get_logger
from . import ocr_client, page_source, prepress, prepress_plan
from . import state as upload_state

logger = get_logger(__name__)


def remote_page_name(slug: str, out_index: int) -> str:
    """OCR-serveri nimekonventsioon: valvur leiab pildid rglob-iga."""
    return "{}_pg_{:03d}.jpg".format(slug, out_index)


def publish_atomic(sftp, local_path: str, remote_path: str) -> None:
    """Laeb üles .tmp nimega ja nimetab alles siis ümber.

    OCR-serveri valvuril EI OLE piltide jaoks stabiilsuskontrolli —
    wait_for_file_stable() kutsutakse seal ainult PDF-ide peale. Pildid
    korjatakse rglob-iga, filtrina EXTENSIONS = {".jpg", ".jpeg", ...}.
    Poolik JPG satuks OCR-i; .jpg.tmp jääb filtrist välja.

    Kataloogi tervikuna EI varjata: valvur töötab pildi kaupa, nii et poolik
    kataloog on konveier, mille me tahame alles jätta.
    """
    tmp_remote = remote_path + ".tmp"
    sftp.put(local_path, tmp_remote)
    sftp.rename(tmp_remote, remote_path)


def _write_cut(src_img_path: str, x0: int, x1: int, dst: str) -> None:
    """Kirjutab lõike [x0, x1) eraldi JPG-na. x1 == laius → tervikleht."""
    from PIL import Image

    with Image.open(src_img_path) as im:
        rgb = im.convert("RGB")
        if x0 == 0 and x1 >= rgb.size[0]:
            rgb.save(dst, "JPEG", quality=page_source.JPEG_QUALITY)
            return
        rgb.crop((x0, 0, x1, rgb.size[1])).save(
            dst, "JPEG", quality=page_source.JPEG_QUALITY
        )


def _transfer_pages(upload_id: str, slug: str, remote_work: str,
                    plan: Optional[dict]) -> int:
    """Renderdab, lõikab ja saadab kõik lehed. Tagastab saadetud lehtede arvu."""
    src_path = prepress.source_path(upload_id)
    if not src_path:
        raise FileNotFoundError("Lähteallikat ei leitud: {}".format(upload_id))

    source = page_source.open_page_source(src_path)
    count = source.page_count()
    work_dir = os.path.join(upload_state.upload_dir(upload_id), "apply_tmp")
    os.makedirs(work_dir, exist_ok=True)

    sftp = ocr_client.sftp_open(upload_id)
    out_index = 0
    try:
        ocr_client.ensure_remote_dirs(sftp, (remote_work,))
        for n in range(1, count + 1):
            if prepress_plan.is_excluded(plan, n):
                continue

            full = os.path.join(work_dir, "full.jpg")
            source.render_full(n, full)
            try:
                from PIL import Image
                with Image.open(full) as im:
                    width = im.size[0]

                for (x0, x1) in prepress_plan.page_cuts(plan, n, width):
                    out_index += 1
                    name = remote_page_name(slug, out_index)
                    cut = os.path.join(work_dir, name)
                    try:
                        _write_cut(full, x0, x1, cut)
                        publish_atomic(sftp, cut, "{}/{}".format(remote_work, name))
                    finally:
                        if os.path.exists(cut):
                            os.unlink(cut)
            finally:
                if os.path.exists(full):
                    os.unlink(full)

            upload_state.mutate_prepress(
                upload_id, lambda p, n=n: p.update(applied_done=n)
            )
    finally:
        try:
            sftp.close()
        except Exception:
            pass
        shutil.rmtree(work_dir, ignore_errors=True)

    return out_index


def apply_and_transfer(upload_id: str) -> None:
    """Taustalõime siht. Eeldab, et try_begin_applying on juba loa andnud."""
    state = upload_state.read_state(upload_id)
    if not state:
        return
    slug = state["meta"]["slug"]
    remote_work = "{}/{}".format(OCR_SERVER_PATH, state["remote_work_path"])
    plan = state.get("prepress")

    try:
        with prepress.RENDER_SEMAPHORE:
            sent = _transfer_pages(upload_id, slug, remote_work, plan)
        upload_state.set_upload_state(
            upload_id, status="processing", expected_pages=sent
        )
        logger.info("Prepress apply valmis: {} → {} lehte".format(upload_id, sent))
    except Exception as e:
        logger.error("Prepress apply {}: {}".format(upload_id, e))
        upload_state.set_upload_state(
            upload_id, status="error", error_message=str(e)
        )


def start_apply(upload_id: str) -> bool:
    """CAS + taustalõim. False = töö juba käib (topeltklikk, retry, refresh)."""
    if not upload_state.try_begin_applying(upload_id):
        return False
    threading.Thread(
        target=apply_and_transfer, args=(upload_id,),
        daemon=True, name="prepress-apply-{}".format(upload_id),
    ).start()
    return True
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_prepress_apply.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/upload/prepress_apply.py tests/test_prepress_apply.py
git commit -m "feat(prepress): 300 DPI läbikäik, voogedastus ja .tmp+rename avaldamine"
```

---

### Task 7: Lähtefaili hoidmine VUTT-i poolel

Kõige riskantsem ülesanne: muudab olemasolevat üleslaadimise voogu. Fail ei lähe enam kohe OCR-serverisse — muidu on poolitamiseks hilja.

**Files:**
- Modify: `server/upload_ops.py:401-450` (`save_and_transfer_to_ocr`), `server/upload_ops.py:477-605` (`add_image_page`)
- Create: `server/upload/store_source.py`
- Test: `tests/test_store_source.py`

**Interfaces:**
- Consumes: `file_detection.detect_file_type`, `file_detection.count_pdf_pages`, `file_detection.validate_upload_image`, `state.init_prepress`
- Produces:
  - `store_pdf(upload_id: str, tmp_path: str) -> int`
  - `store_image_page(upload_id: str, tmp_path: str, page_number: int, total_pages: int) -> int`
  - `transfer_stored_source(upload_id: str) -> None` — tänane PDF-tee, aga salvestatud failist

- [ ] **Step 1: Write the failing test**

Create `tests/test_store_source.py`:

```python
"""Lähtefail jääb VUTT-i poolele, kuni admin on sammu 3 läbinud."""
import os

import pytest
from PIL import Image

from server.upload import store_source
from server.upload import state as upload_state


@pytest.fixture
def upload(tmp_path, monkeypatch):
    uid = "u1"
    base = tmp_path / uid
    base.mkdir(parents=True)
    monkeypatch.setattr(upload_state, "upload_dir", lambda i: str(base))
    monkeypatch.setattr(store_source.upload_state, "upload_dir", lambda i: str(base))
    upload_state.write_state(uid, {
        "id": uid, "status": "pending", "files": [],
        "meta": {"slug": "kirik-abc"},
        "remote_staging_path": "AUTO-OCR/print/u1",
        "remote_work_path": "AUTO-OCR/print/u1/kirik-abc",
    })
    return uid, base


def test_pdf_salvestatakse_lokaalselt_ja_ei_saadeta_kohe(upload, monkeypatch):
    uid, base = upload
    src = base / "incoming.pdf"
    src.write_bytes(b"%PDF-1.4\n")
    monkeypatch.setattr(store_source.file_detection, "detect_file_type", lambda p: "pdf")
    monkeypatch.setattr(store_source.file_detection, "count_pdf_pages", lambda p: 12)
    sent = []
    monkeypatch.setattr(store_source, "transfer_stored_source", lambda i: sent.append(i))

    pages = store_source.store_pdf(uid, str(src))

    assert pages == 12
    assert (base / "source.pdf").is_file()
    assert sent == []                                  # MIDAGI ei saadetud
    state = upload_state.read_state(uid)
    assert state["status"] == "awaiting_split"
    assert state["expected_pages"] == 12
    assert len(state["prepress"]["pages"]) == 12
    assert state["prepress"]["enabled"] is False       # opt-in


def test_pdf_salvestamine_kustutab_ajutise_faili(upload, monkeypatch):
    uid, base = upload
    src = base / "incoming.pdf"
    src.write_bytes(b"%PDF-1.4\n")
    monkeypatch.setattr(store_source.file_detection, "detect_file_type", lambda p: "pdf")
    monkeypatch.setattr(store_source.file_detection, "count_pdf_pages", lambda p: 3)
    store_source.store_pdf(uid, str(src))
    assert not src.exists()


def test_toetamata_formaat_toustab_valueerrori(upload, monkeypatch):
    uid, base = upload
    src = base / "x.bin"
    src.write_bytes(b"\x00\x01")
    monkeypatch.setattr(store_source.file_detection, "detect_file_type", lambda p: "unknown")
    with pytest.raises(ValueError, match="Toetamata"):
        store_source.store_pdf(uid, str(src))


def test_pildilehed_kogunevad_source_kausta(upload, monkeypatch):
    uid, base = upload
    monkeypatch.setattr(
        store_source.file_detection, "validate_upload_image", lambda p: (100, 200)
    )
    monkeypatch.setattr(store_source.file_detection, "detect_file_type", lambda p: "jpeg")
    for n in (1, 2, 3):
        tmp = base / "in_{}.jpg".format(n)
        Image.new("RGB", (100, 200), "white").save(tmp, "JPEG")
        store_source.store_image_page(uid, str(tmp), n, 3)

    files = sorted(os.listdir(str(base / "source")))
    assert files == ["pg_001.jpg", "pg_002.jpg", "pg_003.jpg"]
    state = upload_state.read_state(uid)
    assert state["status"] == "awaiting_split"          # viimane leht → valmis
    assert len(state["prepress"]["pages"]) == 3


def test_pildilehed_jaavad_kogumisolekusse_kuni_viimaseni(upload, monkeypatch):
    uid, base = upload
    monkeypatch.setattr(
        store_source.file_detection, "validate_upload_image", lambda p: (100, 200)
    )
    monkeypatch.setattr(store_source.file_detection, "detect_file_type", lambda p: "jpeg")
    tmp = base / "in_1.jpg"
    Image.new("RGB", (100, 200), "white").save(tmp, "JPEG")
    store_source.store_image_page(uid, str(tmp), 1, 3)
    assert upload_state.read_state(uid)["status"] == "collecting_images"


def test_png_konverteeritakse_jpeg_iks(upload, monkeypatch):
    uid, base = upload
    monkeypatch.setattr(
        store_source.file_detection, "validate_upload_image", lambda p: (100, 200)
    )
    monkeypatch.setattr(store_source.file_detection, "detect_file_type", lambda p: "png")
    tmp = base / "in.png"
    Image.new("RGB", (100, 200), "white").save(tmp, "PNG")
    store_source.store_image_page(uid, str(tmp), 1, 1)
    with Image.open(str(base / "source" / "pg_001.jpg")) as im:
        assert im.format == "JPEG"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_store_source.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'server.upload.store_source'`

- [ ] **Step 3: Write the implementation**

Create `server/upload/store_source.py`:

```python
"""Lähtefaili salvestamine VUTT-i poolele.

MUUDATUS TÄNASE VOO SUHTES: fail EI lähe enam kohe OCR-serverisse. Ta jääb
uploads/{id}/source.pdf-i (või source/ kausta), kuni admin on sammu 3 läbinud.
Muidu oleks poolitamiseks hilja — OCR oleks juba alanud.

Tegelik edastus toimub prepress/apply endpointist:
  - triviaalne plaan → transfer_stored_source() (tänane PDF-tee)
  - poolitusi on   → prepress_apply.start_apply() (300 DPI JPG-d)
"""
import os
import shutil
import threading
from typing import Optional

from ..config import get_logger
from . import file_detection, ocr_client
from . import state as upload_state

logger = get_logger(__name__)


def source_pdf_path(upload_id: str) -> str:
    return os.path.join(upload_state.upload_dir(upload_id), "source.pdf")


def source_images_dir(upload_id: str) -> str:
    return os.path.join(upload_state.upload_dir(upload_id), "source")


def store_pdf(upload_id: str, tmp_path: str) -> int:
    """Salvestab üleslaaditud PDF-i lokaalselt ja loob prepress-plaani.

    Tagastab lehtede arvu. Tõstab ValueError vigase või toetamata faili korral.
    """
    file_type = file_detection.detect_file_type(tmp_path)
    if file_type != "pdf":
        file_detection.safe_unlink(tmp_path)
        raise ValueError(
            "Toetamata failivorming. Palun laadi üles PDF, JPG, PNG või TIFF fail."
        )

    # count_pdf_pages kustutab vigase PDF-i ise — see on siin õige käitumine.
    pages = file_detection.count_pdf_pages(tmp_path)

    dst = source_pdf_path(upload_id)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.move(tmp_path, dst)
    os.chmod(dst, 0o644)

    upload_state.set_upload_state(
        upload_id, status="awaiting_split", expected_pages=pages
    )
    upload_state.init_prepress(upload_id, pages)
    logger.info("Lähte-PDF salvestatud: {} ({} lk)".format(upload_id, pages))
    return pages


def store_image_page(upload_id: str, tmp_path: str, page_number: int,
                     total_pages: int) -> int:
    """Salvestab ühe pildilehe source/ kausta. Rasteriseerimist ei ole."""
    file_detection.validate_upload_image(tmp_path)
    file_type = file_detection.detect_file_type(tmp_path)

    directory = source_images_dir(upload_id)
    os.makedirs(directory, exist_ok=True)
    dst = os.path.join(directory, "pg_{:03d}.jpg".format(page_number))

    if file_type in ("png", "tiff"):
        from PIL import Image
        with Image.open(tmp_path) as im:
            im.convert("RGB").save(dst, "JPEG", quality=95)
        file_detection.safe_unlink(tmp_path)
    else:
        shutil.move(tmp_path, dst)
    os.chmod(dst, 0o644)

    if page_number >= total_pages:
        upload_state.set_upload_state(
            upload_id, status="awaiting_split", expected_pages=total_pages
        )
        upload_state.init_prepress(upload_id, total_pages)
    else:
        upload_state.set_upload_state(
            upload_id, status="collecting_images", expected_pages=total_pages
        )
    return total_pages


def transfer_stored_source(upload_id: str) -> None:
    """Triviaalse plaani tee: saadab salvestatud originaali muutmata.

    See on TÄNANE käitumine, ainult lähtekoht on muutunud (uploads/{id}/ tmp
    faili asemel). Lähtefail jääb alles kuni impordini.
    """
    state = upload_state.read_state(upload_id)
    if not state:
        return

    pdf = source_pdf_path(upload_id)
    if os.path.isfile(pdf):
        _transfer_pdf_thread(upload_id, state, pdf)
        return

    directory = source_images_dir(upload_id)
    if os.path.isdir(directory):
        _transfer_images_thread(upload_id, state, directory)
        return

    upload_state.set_upload_state(
        upload_id, status="error", error_message="Lähteallikat ei leitud"
    )


def _transfer_pdf_thread(upload_id: str, state: dict, pdf: str) -> None:
    from ..config import OCR_SERVER_PATH

    slug = state["meta"]["slug"]
    staging = "{}/{}".format(OCR_SERVER_PATH, state["remote_staging_path"])
    remote_tmp = "{}/{}.pdf.tmp".format(staging, slug)
    remote_dst = "{}/{}.pdf".format(staging, slug)

    def _run():
        sftp = None
        try:
            sftp = ocr_client.sftp_open(upload_id)
            ocr_client.ensure_remote_dirs(sftp, (staging,))
            sftp.put(pdf, remote_tmp)
            sftp.rename(remote_tmp, remote_dst)
            upload_state.set_upload_state(upload_id, status="processing")
            logger.info("Lähte-PDF edastatud OCR-serverisse: {}".format(upload_id))
        except Exception as e:
            logger.error("PDF edastus {}: {}".format(upload_id, e))
            upload_state.set_upload_state(
                upload_id, status="error", error_message=str(e)
            )
        finally:
            if sftp:
                try:
                    sftp.close()
                except Exception:
                    pass

    upload_state.set_upload_state(upload_id, status="uploading")
    threading.Thread(
        target=_run, daemon=True, name="store-pdf-{}".format(upload_id)
    ).start()


def _transfer_images_thread(upload_id: str, state: dict, directory: str) -> None:
    from ..config import OCR_SERVER_PATH
    from .prepress_apply import publish_atomic

    slug = state["meta"]["slug"]
    remote_work = "{}/{}".format(OCR_SERVER_PATH, state["remote_work_path"])

    def _run():
        sftp = None
        try:
            sftp = ocr_client.sftp_open(upload_id)
            ocr_client.ensure_remote_dirs(sftp, (remote_work,))
            for i, name in enumerate(sorted(os.listdir(directory)), start=1):
                publish_atomic(
                    sftp,
                    os.path.join(directory, name),
                    "{}/{}_pg_{:03d}.jpg".format(remote_work, slug, i),
                )
            upload_state.set_upload_state(upload_id, status="processing")
        except Exception as e:
            logger.error("Piltide edastus {}: {}".format(upload_id, e))
            upload_state.set_upload_state(
                upload_id, status="error", error_message=str(e)
            )
        finally:
            if sftp:
                try:
                    sftp.close()
                except Exception:
                    pass

    upload_state.set_upload_state(upload_id, status="uploading")
    threading.Thread(
        target=_run, daemon=True, name="store-img-{}".format(upload_id)
    ).start()
```

- [ ] **Step 4: Rewire the existing entry points**

Modify `server/upload_ops.py`. Asenda `save_and_transfer_to_ocr` keha (read 401–450) sellega — vana SFTP-loogika on nüüd `store_source`-is:

```python
def save_and_transfer_to_ocr(upload_id: str, tmp_path: str) -> int:
    """Salvestab üleslaaditud faili VUTT-i poolele.

    NIMI ON AJALOOLINE: fail EI lähe enam kohe OCR-serverisse (vt
    server/upload/store_source.py). Edastus toimub prepress/apply
    endpointist, kui admin on sammu 3 läbinud.

    JPG/PNG/TIFF üksikpilt käsitletakse ühelehelise pildikaustana.
    """
    from .upload import store_source

    with _get_upload_lock(upload_id):
        state = _read_state(upload_id)
    if not state:
        raise ValueError(f"Upload {upload_id} ei leitud")

    file_type = _detect_file_type(tmp_path)
    if file_type in ('jpeg', 'png', 'tiff'):
        return store_source.store_image_page(upload_id, tmp_path, 1, 1)
    return store_source.store_pdf(upload_id, tmp_path)
```

Ja `add_image_page` keha (read 477–605) → delegeeri:

```python
def add_image_page(upload_id: str, tmp_path: str, page_number: int, total_pages: int) -> int:
    """Lisab ühe pildilehe multi-image üleslaadimisse.

    Pildid kogutakse uploads/{id}/source/ kausta, mitte enam otse
    OCR-serverisse — muidu oleks poolitamiseks hilja.
    """
    from .upload import store_source

    return store_source.store_image_page(upload_id, tmp_path, page_number, total_pages)
```

- [ ] **Step 5: Run the tests**

Run: `.venv/bin/pytest tests/test_store_source.py tests/test_upload_ssh_timeout.py tests/test_upload_background_sync.py -v`
Expected: PASS. Kui `test_upload_ssh_timeout.py` viitab eemaldatud sisemistele funktsioonidele, kohanda test uuele teele — SSH timeout'i kate peab jääma.

- [ ] **Step 6: Commit**

```bash
git add server/upload/store_source.py server/upload_ops.py tests/test_store_source.py
git commit -m "feat(prepress): lähtefail jääb VUTT-i poolele kuni sammu 3 otsuseni"
```

---

### Task 8: Endpointid

Kõik `/admin/` all JA `require_role("admin")` — nginx `/api/files/` proksib kogu backendi avalikult.

**Files:**
- Modify: `server/routers/upload.py` (lisa endpointid pärast `admin_upload_thumb`)
- Test: `tests/test_prepress_endpoints.py`

**Interfaces:**
- Consumes: `prepress.start_preview`, `prepress.get_gutter_strip`, `prepress.preview_path`, `prepress_apply.start_apply`, `prepress_plan.is_trivial_plan`, `prepress_plan.output_page_count`, `store_source.transfer_stored_source`, `state.mutate_prepress`
- Produces: kuus endpointi (vt allpool). Vastuse kujud on frontendi lepingu alus (Task 9).

- [ ] **Step 1: Write the failing test**

Create `tests/test_prepress_endpoints.py`:

```python
"""Prepress-endpointid: rollikontroll, valideerimine, idempotentsus."""
import pytest


@pytest.fixture
def client_admin(backend_env):
    """backend_env fixture on tests/conftest.py-s: TestClient + admin token."""
    return backend_env


def test_koik_prepress_teed_on_admin_all(client_admin):
    """nginx proksib /api/files/ kaudu KÕIK backend-teed avalikult."""
    from server.routers import upload as upload_router
    prepress_routes = [
        r.path for r in upload_router.router.routes if "prepress" in r.path
        or "/preview/" in r.path or "/strip/" in r.path
    ]
    assert prepress_routes, "prepress-endpointe ei leitud"
    assert all(p.startswith("/admin/") for p in prepress_routes)


def test_strip_valideerib_x_vahemiku(client_admin):
    client, headers, upload_id = client_admin
    for bad in ("0", "1", "-0.5", "1.5", "abc"):
        resp = client.get(
            "/admin/upload/{}/strip/1?x={}".format(upload_id, bad), headers=headers
        )
        assert resp.status_code == 400, "x={} oleks pidanud 400 andma".format(bad)


def test_strip_valideerib_lehenumbri(client_admin):
    client, headers, upload_id = client_admin
    assert client.get(
        "/admin/upload/{}/strip/0?x=0.5".format(upload_id), headers=headers
    ).status_code == 400
    assert client.get(
        "/admin/upload/{}/strip/9999?x=0.5".format(upload_id), headers=headers
    ).status_code == 404


def test_apply_teine_kutse_annab_409(client_admin):
    """Topeltklikk, retry või brauseri refresh ei tohi käivitada teist tööd."""
    client, headers, upload_id = client_admin
    first = client.post(
        "/admin/upload/{}/prepress/apply".format(upload_id), headers=headers
    )
    assert first.status_code == 200
    second = client.post(
        "/admin/upload/{}/prepress/apply".format(upload_id), headers=headers
    )
    assert second.status_code == 409
    assert "status" in second.json()


def test_plaani_salvestamine_ei_luba_vigast_mode_i(client_admin):
    client, headers, upload_id = client_admin
    resp = client.post(
        "/admin/upload/{}/prepress".format(upload_id),
        json={"enabled": True, "default_split_x": 0.5,
              "pages": [{"n": 1, "mode": "kustuta_koik"}]},
        headers=headers,
    )
    assert resp.status_code == 400


def test_plaani_salvestamine_ei_luba_vigast_split_x_i(client_admin):
    client, headers, upload_id = client_admin
    resp = client.post(
        "/admin/upload/{}/prepress".format(upload_id),
        json={"enabled": True, "default_split_x": 1.5, "pages": []},
        headers=headers,
    )
    assert resp.status_code == 400


def test_get_prepress_annab_kokkuvotte(client_admin):
    client, headers, upload_id = client_admin
    data = client.get(
        "/admin/upload/{}/prepress".format(upload_id), headers=headers
    ).json()
    assert set(["enabled", "default_split_x", "preview_status", "preview_done",
                "pages", "page_count", "output_page_count", "trivial"]) <= set(data)
```

> **Märkus testi kirjutajale:** `tests/conftest.py` `backend_env` fixture ei tagasta praegu upload'i. Laienda seda või kirjuta kohalik fixture, mis loob `create_upload`-iga uploadi, kirjutab `uploads/{id}/source.pdf` kohatäitefaili ja seab `status="awaiting_split"` + `init_prepress(uid, 3)`. Muster: vaata `tests/test_notifications_endpoints.py`.

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_prepress_endpoints.py -v`
Expected: FAIL — 404 kõigile prepress-teedele

- [ ] **Step 3: Write the implementation**

Modify `server/routers/upload.py`. Lisa importidesse:

```python
from ..upload import prepress, prepress_apply, prepress_plan, store_source
from ..upload import state as upload_state
```

Lisa endpointid pärast `admin_upload_thumb`:

```python
def _load_prepress(upload_id: str) -> tuple:
    """Ühine eeltöö: valideeri upload_id, loe state ja plaan."""
    if not _valid_upload_id(upload_id):
        raise HTTPException(status_code=400, detail="Vigane upload_id")
    state = upload_state.read_state(upload_id)
    if not state:
        raise HTTPException(status_code=404, detail="Uploadi ei leitud")
    return state, state.get("prepress")


def _validate_split_x(value) -> float:
    try:
        x = float(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Vigane x")
    if not (0.0 < x < 1.0):
        raise HTTPException(status_code=400, detail="x peab olema vahemikus (0, 1)")
    return x


@router.get("/admin/upload/{upload_id}/prepress")
def admin_prepress_get(upload_id: str, user=Depends(require_role("admin"))):
    """Plaan + tindiskoorid + eelvaate edenemine. Sync def — loeb ainult ketast."""
    state, plan = _load_prepress(upload_id)
    page_count = len((plan or {}).get("pages", []))
    result = dict(plan or prepress_plan.default_plan(0))
    result["page_count"] = page_count
    result["output_page_count"] = prepress_plan.output_page_count(plan, page_count)
    result["trivial"] = prepress_plan.is_trivial_plan(plan)
    result["status"] = state.get("status")
    return result


@router.post("/admin/upload/{upload_id}/prepress/start")
def admin_prepress_start(upload_id: str, user=Depends(require_role("admin"))):
    """Lülitab prepressi sisse ja käivitab 100 DPI eelvaate.

    Kuni seda ei kutsuta, EI renderdata ühtki pikslit — kogu prepress on opt-in.
    """
    state, plan = _load_prepress(upload_id)
    if state.get("status") not in ("awaiting_split", "prepping"):
        raise HTTPException(status_code=409, detail="Upload ei ole poolitamise ootel")
    upload_state.mutate_prepress(upload_id, lambda p: p.update(enabled=True))
    prepress.start_preview(upload_id)
    return {"status": "started"}


@router.get("/admin/upload/{upload_id}/preview/{page_num}")
def admin_prepress_preview(upload_id: str, page_num: int,
                           user=Depends(require_role("admin"))):
    """100 DPI kontaktlehe pisipilt."""
    _load_prepress(upload_id)
    path = prepress.preview_path(upload_id, page_num)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404)
    return FileResponse(path, media_type="image/jpeg")


@router.get("/admin/upload/{upload_id}/strip/{page_num}")
def admin_prepress_strip(upload_id: str, page_num: int, x: str = "0.5",
                         user=Depends(require_role("admin"))):
    """300 DPI köitevahe-riba. Sync def — pdftoppm on blokeeriv (ADR 0002)."""
    state, plan = _load_prepress(upload_id)
    x_frac = _validate_split_x(x)
    page_count = len((plan or {}).get("pages", []))
    if page_num < 1:
        raise HTTPException(status_code=400, detail="Vigane lehenumber")
    if page_num > page_count:
        raise HTTPException(status_code=404, detail="Lehte ei ole")
    try:
        path = prepress.get_gutter_strip(upload_id, page_num, x_frac)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Lähteallikat ei leitud")
    except RuntimeError as e:
        logger.error("Riba renderdus {} lk {}: {}".format(upload_id, page_num, e))
        raise HTTPException(status_code=500, detail="Riba renderdamine ebaõnnestus")
    return FileResponse(path, media_type="image/jpeg")


@router.post("/admin/upload/{upload_id}/prepress")
async def admin_prepress_save(upload_id: str, request: Request,
                              user=Depends(require_role("admin"))):
    """Salvestab plaani. Kirjutab AINULT plaani välju (mutate_prepress)."""
    data = await get_json_data(request)
    _load_prepress(upload_id)

    default_x = _validate_split_x(data.get("default_split_x", 0.5))
    incoming = data.get("pages") or []
    if not isinstance(incoming, list):
        raise HTTPException(status_code=400, detail="pages peab olema list")

    clean = {}
    for entry in incoming:
        if not isinstance(entry, dict):
            raise HTTPException(status_code=400, detail="Vigane lehekirje")
        mode = entry.get("mode", "default")
        if mode not in ("default", "custom", "nosplit"):
            raise HTTPException(status_code=400, detail="Vigane mode: {}".format(mode))
        split_x = entry.get("split_x")
        if mode == "custom":
            split_x = _validate_split_x(split_x)
        clean[entry.get("n")] = {
            "mode": mode,
            "split_x": split_x if mode == "custom" else None,
            "excluded": bool(entry.get("excluded")),
        }

    enabled = bool(data.get("enabled"))

    def _apply(plan):
        plan["enabled"] = enabled
        plan["default_split_x"] = default_x
        for page in plan.get("pages", []):
            update = clean.get(page.get("n"))
            if update:
                page.update(update)

    plan = await run_in_threadpool(upload_state.mutate_prepress, upload_id, _apply)
    if plan is None:
        raise HTTPException(status_code=404, detail="Plaani ei leitud")
    page_count = len(plan.get("pages", []))
    return {
        "status": "saved",
        "output_page_count": prepress_plan.output_page_count(plan, page_count),
        "trivial": prepress_plan.is_trivial_plan(plan),
    }


@router.post("/admin/upload/{upload_id}/prepress/apply")
def admin_prepress_apply(upload_id: str, user=Depends(require_role("admin"))):
    """Lõpetab sammu 3. Valib teekonna plaani järgi.

    Sync def — try_begin_applying on blokeeriv faililukk (ADR 0002).
    """
    state, plan = _load_prepress(upload_id)

    if prepress_plan.is_trivial_plan(plan):
        # Tänane tee: originaalfail muutmata OCR-serverisse.
        if not upload_state.try_begin_applying(upload_id):
            return JSONResponse(
                status_code=409,
                content={"detail": "Töö juba käib", "status": state.get("status")},
            )
        store_source.transfer_stored_source(upload_id)
        return {"status": "transferring", "path": "original"}

    if not prepress_apply.start_apply(upload_id):
        return JSONResponse(
            status_code=409,
            content={"detail": "Töö juba käib", "status": state.get("status")},
        )
    return {"status": "applying", "path": "split"}
```

Lisa faili algusse import: `from fastapi.responses import FileResponse, JSONResponse`.

> **NB `transfer_stored_source` ja CAS:** `try_begin_applying` seab staatuse `applying`, seejärel `transfer_stored_source` seab `uploading` → `processing`. Nii saab ka triviaalne tee sama topeltkliki-kaitse.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_prepress_endpoints.py -v`
Expected: PASS

- [ ] **Step 5: Run the whole backend suite**

Run: `.venv/bin/pytest tests/ -q`
Expected: PASS. Kui `test_async_endpoint_offload.py` kaebab uute sync-marsruutide üle, kontrolli, et see test lubab sync `def`-i — ADR 0002 nõuab just seda blokeeriva I/O korral.

- [ ] **Step 6: Commit**

```bash
git add server/routers/upload.py tests/test_prepress_endpoints.py
git commit -m "feat(prepress): endpointid — plaan, eelvaade, riba, apply (409 korduskutsel)"
```

---

### Task 9: Frontend — tüübid, API-klient ja viisardi neljas samm

Ainult juhtmestik. Komponendid tulevad Task 10–13.

**Files:**
- Modify: `src/pages/upload/types.ts`, `src/pages/upload/uploadApi.ts`, `src/pages/upload/useUploadWizard.ts`, `src/pages/upload/UploadPage.tsx`, `src/pages/upload/components/StepIndicator.tsx`
- Modify: `src/locales/et/upload.json`, `src/locales/en/upload.json`
- Test: `src/pages/upload/__tests__/prepressPlan.test.ts`

**Interfaces:**
- Consumes: Task 8 endpointid
- Produces:
  - tüübid `PrepressMode`, `PrepressPage`, `PrepressPlan`, `PrepressSaveResult`
  - `getPrepress`, `startPrepress`, `savePrepress`, `applyPrepress`, `prepressPreviewUrl`, `prepressStripUrl`
  - reduktor `applyGlobalSplit(plan, x): PrepressPlan`
  - `StepIndicator` võtab nüüd `1|2|3|4` ja neli silti

- [ ] **Step 1: Write the failing test**

Create `src/pages/upload/__tests__/prepressPlan.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { applyGlobalSplit, countOutputPages } from '../prepressPlan';
import type { PrepressPlan } from '../types';

function plan(overrides: Partial<PrepressPlan> = {}): PrepressPlan {
  return {
    enabled: true,
    default_split_x: 0.5,
    preview_status: 'ready',
    preview_done: 3,
    page_count: 3,
    output_page_count: 6,
    trivial: false,
    status: 'awaiting_split',
    pages: [
      { n: 1, mode: 'default', split_x: null, excluded: false, ink: 0.08 },
      { n: 2, mode: 'custom', split_x: 0.459, excluded: false, ink: 0.99 },
      { n: 3, mode: 'nosplit', split_x: null, excluded: false, ink: 0.02 },
    ],
    ...overrides,
  };
}

describe('applyGlobalSplit', () => {
  it('muudab globaalset joont', () => {
    expect(applyGlobalSplit(plan(), 0.48).default_split_x).toBe(0.48);
  });

  it('EI kirjuta üle custom-lehti', () => {
    const next = applyGlobalSplit(plan(), 0.48);
    expect(next.pages[1].mode).toBe('custom');
    expect(next.pages[1].split_x).toBe(0.459);
  });

  it('EI muuda nosplit-lehti', () => {
    expect(applyGlobalSplit(plan(), 0.48).pages[2].mode).toBe('nosplit');
  });

  it('ei muteeri sisendit', () => {
    const original = plan();
    applyGlobalSplit(original, 0.48);
    expect(original.default_split_x).toBe(0.5);
  });
});

describe('countOutputPages', () => {
  it('loeb poolitatud lehed kaks korda', () => {
    // leht 1 default → 2, leht 2 custom → 2, leht 3 nosplit → 1
    expect(countOutputPages(plan())).toBe(5);
  });

  it('jätab väljajäetud lehed välja', () => {
    const p = plan();
    p.pages[0].excluded = true;
    expect(countOutputPages(p)).toBe(3);
  });

  it('enabled=false → iga leht üks', () => {
    expect(countOutputPages(plan({ enabled: false }))).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/upload/__tests__/prepressPlan.test.ts`
Expected: FAIL — `Cannot find module '../prepressPlan'`

- [ ] **Step 3: Add the types**

Append to `src/pages/upload/types.ts`:

```ts
export type PrepressMode = 'default' | 'custom' | 'nosplit';
export type PreviewStatus = 'idle' | 'rendering' | 'ready' | 'error';

export interface PrepressPage {
  n: number;
  mode: PrepressMode;
  split_x: number | null;
  excluded: boolean;
  /** Tindiosakaal joonel. Usaldusväärne AINULT kõrge väärtuse suunas. */
  ink: number | null;
}

export interface PrepressPlan {
  enabled: boolean;
  default_split_x: number;
  preview_status: PreviewStatus;
  preview_done: number;
  pages: PrepressPage[];
  page_count: number;
  output_page_count: number;
  trivial: boolean;
  status: string;
}

export interface PrepressSaveResult {
  status: string;
  output_page_count: number;
  trivial: boolean;
}
```

- [ ] **Step 4: Write the reducer**

Create `src/pages/upload/prepressPlan.ts`:

```ts
import type { PrepressPlan } from './types';

/**
 * Muudab globaalset poolitusjoont. `custom` ja `nosplit` lehti EI puutu —
 * admini käsitsi tehtud töö peab jääma alles.
 */
export function applyGlobalSplit(plan: PrepressPlan, x: number): PrepressPlan {
  return { ...plan, default_split_x: x, pages: plan.pages.map((p) => ({ ...p })) };
}

/** Mitu lehte OCR-i läheb. Peegeldab serveri output_page_count loogikat. */
export function countOutputPages(plan: PrepressPlan): number {
  return plan.pages.reduce((total, page) => {
    if (page.excluded) return total;
    if (!plan.enabled || page.mode === 'nosplit') return total + 1;
    if (page.mode === 'custom' && page.split_x == null) return total + 1;
    return total + 2;
  }, 0);
}
```

- [ ] **Step 5: Add the API client functions**

Append to `src/pages/upload/uploadApi.ts`:

```ts
export function getPrepress(uploadId: string, token: string | null): Promise<PrepressPlan> {
  return apiGet<PrepressPlan>(`/admin/upload/${uploadId}/prepress`, { token });
}

export function startPrepress(uploadId: string, token: string | null): Promise<{ status: string }> {
  return apiPost<{ status: string }>(`/admin/upload/${uploadId}/prepress/start`, {}, { token });
}

export function savePrepress(
  uploadId: string,
  plan: Pick<PrepressPlan, 'enabled' | 'default_split_x' | 'pages'>,
  token: string | null,
): Promise<PrepressSaveResult> {
  return apiPost<PrepressSaveResult>(`/admin/upload/${uploadId}/prepress`, plan, { token });
}

export function applyPrepress(
  uploadId: string,
  token: string | null,
): Promise<{ status: string; path: string }> {
  return apiPost<{ status: string; path: string }>(
    `/admin/upload/${uploadId}/prepress/apply`, {}, { token },
  );
}

/** Pildipäringud lähevad <img src>-ina, mitte fetchiga — auth käib küpsise/tokeniga URL-is. */
export function prepressPreviewUrl(uploadId: string, n: number): string {
  return `${FILE_API_URL}/admin/upload/${uploadId}/preview/${n}`;
}

export function prepressStripUrl(uploadId: string, n: number, x: number): string {
  return `${FILE_API_URL}/admin/upload/${uploadId}/strip/${n}?x=${x.toFixed(5)}`;
}
```

Lisa `types` importi: `PrepressPlan`, `PrepressSaveResult`.

> **NB autentimine piltidel:** `<img src>` ei saada `Authorization` päist. Kontrolli, kuidas `admin_upload_thumb` (olemasolev endpoint, `/admin/upload/{id}/thumb/{n}`) seda praegu lahendab, ja kasuta **sama mustrit** — ära leiuta uut. Kui olemasolev tee kasutab tokenit query-parameetrina, tee samuti; kui pildid laetakse `fetch` + `URL.createObjectURL` kaudu, siis samuti.

- [ ] **Step 6: Renumber the wizard to four steps**

Modify `src/pages/upload/useUploadWizard.ts`:

- `const [step, setStep] = useState<1 | 2 | 3>(1);` → `useState<1 | 2 | 3 | 4>(1)`
- Kõik olemasolevad `setStep(3)` kutsed (read ~202, ~457) viitavad **ülevaatusele** → `setStep(4)`
- Lisa olek: `const [prepress, setPrepress] = useState<PrepressPlan | null>(null);`
- Lisa üleminek: kui `pollResult.status === 'awaiting_split'` → `setStep(3)`
- Lisa tagastusse: `prepress`, `setPrepress`

Modify `src/pages/upload/UploadPage.tsx`:

- `stepLabels` → neli silti: `t('steps.metadata'), t('steps.upload'), t('steps.split'), t('steps.review')`
- `wizard.step === 3` → `<UploadStepSplit …>` (Task 10)
- `wizard.step === 3` (vana ülevaatus) → `wizard.step === 4`

Modify `src/pages/upload/components/StepIndicator.tsx`:

```tsx
const StepIndicator: React.FC<{
  step: 1 | 2 | 3 | 4;
  labels: [string, string, string, string];
}> = ({ step, labels }) => (
  <div className="flex items-center gap-0 mb-8">
    {labels.map((label, i) => {
      const num = (i + 1) as 1 | 2 | 3 | 4;
      const active = num === step;
      const done = num < step;
      return (
        <React.Fragment key={num}>
          {/* … muutmata sisu … */}
          {i < labels.length - 1 && <div className="flex-1 h-0.5 bg-gray-200 mx-3" />}
        </React.Fragment>
      );
    })}
  </div>
);
```

`i < 2` → `i < labels.length - 1` on kohustuslik: muidu jääb neljanda sammu ette joon puudu.

- [ ] **Step 7: Add the i18n keys**

`src/locales/et/upload.json` — `steps` alla `"split": "Poolitamine"`. Lisa uus plokk:

```json
"step3split": {
  "title": "Topeltlehtede poolitamine",
  "optIn": "Poolita topeltlehed enne OCR-i",
  "optInHint": "Lülita sisse ainult siis, kui skaneeringul on kaks lehekülge ühel pildil. Muidu vajuta lihtsalt Edasi — kõik käib nagu tavaliselt.",
  "rendering": "Eelvaadet valmistatakse: {{done}} / {{total}}",
  "renderError": "Eelvaate valmistamine ebaõnnestus",
  "globalLine": "Poolitusjoon (% laiusest)",
  "viewSheet": "Kontaktleht",
  "viewStrip": "Köitevahe-riba",
  "summary": "{{pages}} lehest {{split}} poolitatakse, {{excluded}} jäetakse välja → OCR-i läheb {{output}} lehte",
  "inkWarning": "Joon lõikab kirja",
  "exclude": "Jäta välja",
  "include": "Võta tagasi",
  "noSplit": "Ära poolita",
  "resetToGlobal": "Kasuta üldist joont",
  "openPage": "Ava leht",
  "applying": "Töötlen ja saadan OCR-i…",
  "continue": "Edasi"
}
```

`src/locales/en/upload.json` — **samad võtmed, sama struktuur** (ADR 0011: `fallbackLng` on väljas, puuduv võti katkestab build'i):

```json
"step3split": {
  "title": "Split double pages",
  "optIn": "Split double pages before OCR",
  "optInHint": "Turn this on only if a single scan holds two book pages. Otherwise just press Continue — everything works as before.",
  "rendering": "Preparing preview: {{done}} / {{total}}",
  "renderError": "Preview generation failed",
  "globalLine": "Split line (% of width)",
  "viewSheet": "Contact sheet",
  "viewStrip": "Gutter strip",
  "summary": "{{split}} of {{pages}} pages will be split, {{excluded}} excluded → {{output}} pages go to OCR",
  "inkWarning": "The line cuts through writing",
  "exclude": "Exclude",
  "include": "Restore",
  "noSplit": "Don't split",
  "resetToGlobal": "Use the global line",
  "openPage": "Open page",
  "applying": "Processing and sending to OCR…",
  "continue": "Continue"
}
```

Ja `steps.split`: `"Splitting"`.

- [ ] **Step 8: Run the tests and gates**

Run:
```bash
npx vitest run src/pages/upload/__tests__/prepressPlan.test.ts
npm run typecheck
npm test
```
Expected: PASS. `localeParity.test.ts` peab olema roheline — see valvab et/en võtmestiku identsust.

- [ ] **Step 9: Commit**

```bash
git add src/pages/upload src/locales
git commit -m "feat(prepress): frontendi tüübid, API-klient ja viisardi neljas samm"
```

---

### Task 10: `UploadStepSplit` — opt-in värav ja kokkuvõte

Samm avaneb ilma midagi renderdamata. See ongi see, mis teeb invariandi „tühi plaan = tänane tee" tugevaks.

**Files:**
- Create: `src/pages/upload/components/UploadStepSplit.tsx`
- Modify: `src/pages/upload/UploadPage.tsx` (ühenda samm 3)
- Test: `src/pages/upload/__tests__/UploadStepSplit.test.tsx`

**Interfaces:**
- Consumes: `getPrepress`, `startPrepress`, `savePrepress`, `applyPrepress` (Task 9), `countOutputPages`
- Produces: `UploadStepSplit` propsidega `{ uploadId, token, onDone }`; alamkomponentide props-leping (Task 11–13):
  - `SplitContactSheet: { uploadId, plan, onPageChange(n, patch), onOpenPage(n) }`
  - `SplitGutterStrip: { uploadId, plan, onPageChange(n, patch), onOpenPage(n) }`
  - `SplitPageDetail: { uploadId, plan, pageNum, onPageChange(n, patch), onClose() }`
  - `patch: Partial<Pick<PrepressPage, 'mode' | 'split_x' | 'excluded'>>`

- [ ] **Step 1: Write the failing test**

Create `src/pages/upload/__tests__/UploadStepSplit.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import UploadStepSplit from '../components/UploadStepSplit';
import * as api from '../uploadApi';
import type { PrepressPlan } from '../types';

vi.mock('../uploadApi');
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

function plan(over: Partial<PrepressPlan> = {}): PrepressPlan {
  return {
    enabled: false, default_split_x: 0.5, preview_status: 'idle', preview_done: 0,
    page_count: 3, output_page_count: 3, trivial: true, status: 'awaiting_split',
    pages: [
      { n: 1, mode: 'default', split_x: null, excluded: false, ink: null },
      { n: 2, mode: 'default', split_x: null, excluded: false, ink: null },
      { n: 3, mode: 'default', split_x: null, excluded: false, ink: null },
    ],
    ...over,
  };
}

beforeEach(() => {
  vi.mocked(api.getPrepress).mockResolvedValue(plan());
  vi.mocked(api.startPrepress).mockResolvedValue({ status: 'started' });
  vi.mocked(api.savePrepress).mockResolvedValue({
    status: 'saved', output_page_count: 6, trivial: false,
  });
  vi.mocked(api.applyPrepress).mockResolvedValue({ status: 'transferring', path: 'original' });
});

it('EI renderda midagi enne, kui lüliti on sisse lülitatud', async () => {
  render(<UploadStepSplit uploadId="u1" token="t" onDone={vi.fn()} />);
  await screen.findByText('step3split.optIn');
  expect(api.startPrepress).not.toHaveBeenCalled();
  expect(screen.queryByTestId('split-contact-sheet')).toBeNull();
});

it('lüliti sisselülitamine käivitab eelvaate', async () => {
  render(<UploadStepSplit uploadId="u1" token="t" onDone={vi.fn()} />);
  await userEvent.click(await screen.findByRole('checkbox'));
  await waitFor(() => expect(api.startPrepress).toHaveBeenCalledWith('u1', 't'));
});

it('puutumata lülitiga Edasi saadab originaali ilma plaani muutmata', async () => {
  const onDone = vi.fn();
  render(<UploadStepSplit uploadId="u1" token="t" onDone={onDone} />);
  await userEvent.click(await screen.findByText('step3split.continue'));
  expect(api.startPrepress).not.toHaveBeenCalled();
  await waitFor(() => expect(api.applyPrepress).toHaveBeenCalledWith('u1', 't'));
  await waitFor(() => expect(onDone).toHaveBeenCalled());
});

it('kuvab eelvaate edenemist', async () => {
  vi.mocked(api.getPrepress).mockResolvedValue(
    plan({ enabled: true, preview_status: 'rendering', preview_done: 42, page_count: 300 }),
  );
  render(<UploadStepSplit uploadId="u1" token="t" onDone={vi.fn()} />);
  expect(await screen.findByText(/step3split.rendering/)).toBeTruthy();
});

it('apply 409 ei kutsu onDone ega jää igavesti laadima', async () => {
  vi.mocked(api.applyPrepress).mockRejectedValue(
    Object.assign(new Error('Töö juba käib'), { status: 409 }),
  );
  const onDone = vi.fn();
  render(<UploadStepSplit uploadId="u1" token="t" onDone={onDone} />);
  await userEvent.click(await screen.findByText('step3split.continue'));
  await waitFor(() => expect(screen.getByText('step3split.continue')).toBeTruthy());
  expect(onDone).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/upload/__tests__/UploadStepSplit.test.tsx`
Expected: FAIL — `Cannot find module '../components/UploadStepSplit'`

- [ ] **Step 3: Write the component**

Create `src/pages/upload/components/UploadStepSplit.tsx`:

```tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Grid3x3, Columns, AlertTriangle } from 'lucide-react';
import {
  applyPrepress, getPrepress, savePrepress, startPrepress,
} from '../uploadApi';
import { countOutputPages } from '../prepressPlan';
import type { PrepressPage, PrepressPlan } from '../types';
import SplitContactSheet from './SplitContactSheet';
import SplitGutterStrip from './SplitGutterStrip';
import SplitPageDetail from './SplitPageDetail';

const POLL_MS = 1500;

interface Props {
  uploadId: string;
  token: string | null;
  onDone: () => void;
}

/**
 * Viisardi 3. samm: topeltlehtede poolitamine enne OCR-i.
 *
 * Kogu prepress on OPT-IN. Kuni lülitit ei puututa, ei renderdata ühtki
 * pikslit ja "Edasi" käitub täpselt nagu enne selle featuuri lisamist.
 */
const UploadStepSplit: React.FC<Props> = ({ uploadId, token, onDone }) => {
  const { t } = useTranslation(['upload', 'common']);
  const [plan, setPlan] = useState<PrepressPlan | null>(null);
  const [view, setView] = useState<'sheet' | 'strip'>('sheet');
  const [detailPage, setDetailPage] = useState<number | null>(null);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPrepress(uploadId, token)
      .then((p) => { if (!cancelled) setPlan(p); })
      .catch(() => { if (!cancelled) setError(t('step3split.renderError')); });
    return () => { cancelled = true; };
  }, [uploadId, token, t]);

  // Eelvaate edenemise polling — ainult renderdamise ajal.
  useEffect(() => {
    if (plan?.preview_status !== 'rendering') return;
    const id = setInterval(() => {
      getPrepress(uploadId, token).then(setPlan).catch(() => undefined);
    }, POLL_MS);
    return () => clearInterval(id);
  }, [plan?.preview_status, uploadId, token]);

  /** Salvestab plaani debounce'itult — joone nihutamine ei tohi POST-e tulistada. */
  const persist = useCallback((next: PrepressPlan) => {
    setPlan(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      savePrepress(
        uploadId,
        { enabled: next.enabled, default_split_x: next.default_split_x, pages: next.pages },
        token,
      ).catch(() => setError(t('errors.networkError')));
    }, 400);
  }, [uploadId, token, t]);

  const handleOptIn = async () => {
    if (!plan) return;
    persist({ ...plan, enabled: true });
    try {
      await startPrepress(uploadId, token);
      setPlan(await getPrepress(uploadId, token));
    } catch {
      setError(t('step3split.renderError'));
    }
  };

  const handlePageChange = (n: number, patch: Partial<PrepressPage>) => {
    if (!plan) return;
    persist({
      ...plan,
      pages: plan.pages.map((p) => (p.n === n ? { ...p, ...patch } : p)),
    });
  };

  const handleGlobalLine = (percent: string) => {
    if (!plan) return;
    const value = Number(percent);
    if (!Number.isFinite(value) || value <= 0 || value >= 100) return;
    persist({ ...plan, default_split_x: value / 100 });
  };

  const handleContinue = async () => {
    setApplying(true);
    setError('');
    try {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (plan?.enabled) {
        await savePrepress(
          uploadId,
          { enabled: plan.enabled, default_split_x: plan.default_split_x, pages: plan.pages },
          token,
        );
      }
      await applyPrepress(uploadId, token);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('errors.networkError'));
      setApplying(false);
    }
  };

  if (!plan) return <div className="py-12 text-center text-gray-500">…</div>;

  const splitCount = plan.enabled
    ? plan.pages.filter((p) => !p.excluded && p.mode !== 'nosplit').length
    : 0;
  const excludedCount = plan.pages.filter((p) => p.excluded).length;
  const rendering = plan.preview_status === 'rendering';

  return (
    <div>
      <h2 className="text-lg font-semibold mb-1">{t('step3split.title')}</h2>

      <label className="flex items-start gap-3 p-4 mb-6 rounded border border-gray-200 bg-gray-50">
        <input
          type="checkbox"
          className="mt-1"
          checked={plan.enabled}
          onChange={(e) => (e.target.checked
            ? handleOptIn()
            : persist({ ...plan, enabled: false }))}
        />
        <span>
          <span className="font-medium block">{t('step3split.optIn')}</span>
          <span className="text-sm text-gray-600">{t('step3split.optInHint')}</span>
        </span>
      </label>

      {plan.enabled && (
        <>
          {rendering && (
            <div className="mb-4 text-sm text-gray-600">
              {t('step3split.rendering', {
                done: plan.preview_done, total: plan.page_count,
              })}
            </div>
          )}
          {plan.preview_status === 'error' && (
            <div className="mb-4 flex items-center gap-2 text-sm text-red-700">
              <AlertTriangle size={16} />{t('step3split.renderError')}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-4 mb-4">
            <label className="flex items-center gap-2 text-sm">
              {t('step3split.globalLine')}
              <input
                type="text"
                inputMode="numeric"
                className="w-20 px-2 py-1 border rounded"
                value={Math.round(plan.default_split_x * 1000) / 10}
                onChange={(e) => handleGlobalLine(e.target.value)}
              />
            </label>
            <div className="flex rounded border overflow-hidden">
              <button
                type="button"
                className={`px-3 py-1 text-sm flex items-center gap-1 ${view === 'sheet' ? 'bg-primary-600 text-white' : 'bg-white'}`}
                onClick={() => setView('sheet')}
              >
                <Grid3x3 size={14} />{t('step3split.viewSheet')}
              </button>
              <button
                type="button"
                className={`px-3 py-1 text-sm flex items-center gap-1 ${view === 'strip' ? 'bg-primary-600 text-white' : 'bg-white'}`}
                onClick={() => setView('strip')}
              >
                <Columns size={14} />{t('step3split.viewStrip')}
              </button>
            </div>
          </div>

          <p className="mb-4 text-sm text-gray-700">
            {t('step3split.summary', {
              pages: plan.page_count,
              split: splitCount,
              excluded: excludedCount,
              output: countOutputPages(plan),
            })}
          </p>

          {view === 'sheet' ? (
            <SplitContactSheet
              uploadId={uploadId}
              plan={plan}
              onPageChange={handlePageChange}
              onOpenPage={setDetailPage}
            />
          ) : (
            <SplitGutterStrip
              uploadId={uploadId}
              plan={plan}
              onPageChange={handlePageChange}
              onOpenPage={setDetailPage}
            />
          )}
        </>
      )}

      {error && <div className="mt-4 text-sm text-red-700">{error}</div>}

      <div className="mt-8">
        <button
          type="button"
          className="px-5 py-2 rounded bg-primary-600 text-white disabled:opacity-50"
          disabled={applying}
          onClick={handleContinue}
        >
          {applying ? t('step3split.applying') : t('step3split.continue')}
        </button>
      </div>

      {detailPage !== null && (
        <SplitPageDetail
          uploadId={uploadId}
          plan={plan}
          pageNum={detailPage}
          onPageChange={handlePageChange}
          onClose={() => setDetailPage(null)}
        />
      )}
    </div>
  );
};

export default UploadStepSplit;
```

- [ ] **Step 4: Wire it into UploadPage**

Modify `src/pages/upload/UploadPage.tsx` — lisa `wizard.step === 3` haru enne olemasolevat (nüüd `=== 4`) ülevaatuse haru:

```tsx
{wizard.step === 3 && wizard.uploadId && (
  <UploadStepSplit
    uploadId={wizard.uploadId}
    token={authToken}
    onDone={() => wizard.setStep(4)}
  />
)}
```

`useUploadWizard` peab tagastama `setStep`. Kui ta seda veel ei tee, lisa see tagastusobjekti.

- [ ] **Step 5: Create component stubs so the test can run**

Loo minimaalsed `SplitContactSheet.tsx`, `SplitGutterStrip.tsx` ja `SplitPageDetail.tsx`, mis renderdavad ainult `<div data-testid="split-contact-sheet" />` jms. Päris teostus tuleb Task 11–13. Ilma nendeta ei kompileeru import.

- [ ] **Step 6: Run tests and gates**

Run:
```bash
npx vitest run src/pages/upload/__tests__/UploadStepSplit.test.tsx
npm run typecheck
npm run lint:ci
```
Expected: PASS. `lint:ci` lävi on `--max-warnings 55` — parandades LANGETA arvu, ära tõsta.

- [ ] **Step 7: Commit**

```bash
git add src/pages/upload
git commit -m "feat(prepress): UploadStepSplit — opt-in värav, kokkuvõte, apply"
```

---

### Task 11: `SplitContactSheet` — peavaade tindihoiatusega

100 DPI pisipiltide ruudustik. Tindiskoor tõstab kahtlased esile; pisipilt ise ei tõesta midagi, seetõttu viib klikk ribale või üksiklehele.

**Files:**
- Create (asenda stub): `src/pages/upload/components/SplitContactSheet.tsx`
- Test: `src/pages/upload/__tests__/SplitContactSheet.test.tsx`

**Interfaces:**
- Consumes: `prepressPreviewUrl`, `PrepressPlan`, `PrepressPage`
- Produces: `SplitContactSheet` propsidega `{ uploadId, plan, onPageChange, onOpenPage }`; eksporditud puhas abifunktsioon `inkLevel(ink: number | null): 'ok' | 'warn' | 'bad'`

- [ ] **Step 1: Write the failing test**

Create `src/pages/upload/__tests__/SplitContactSheet.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import SplitContactSheet, { inkLevel } from '../components/SplitContactSheet';
import type { PrepressPlan } from '../types';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

const plan: PrepressPlan = {
  enabled: true, default_split_x: 0.5, preview_status: 'ready', preview_done: 3,
  page_count: 3, output_page_count: 6, trivial: false, status: 'awaiting_split',
  pages: [
    { n: 1, mode: 'default', split_x: null, excluded: false, ink: 0.08 },
    { n: 2, mode: 'default', split_x: null, excluded: false, ink: 0.48 },
    { n: 3, mode: 'default', split_x: null, excluded: false, ink: 0.99 },
  ],
};

describe('inkLevel', () => {
  it('mõõdetud väärtused päris materjalilt', () => {
    expect(inkLevel(0.08)).toBe('ok');
    expect(inkLevel(0.48)).toBe('warn');
    expect(inkLevel(0.99)).toBe('bad');
  });

  it('arvutamata skoor on ok, mitte hoiatus', () => {
    expect(inkLevel(null)).toBe('ok');
  });
});

describe('SplitContactSheet', () => {
  it('renderdab iga lehe kohta pisipildi', () => {
    render(
      <SplitContactSheet uploadId="u1" plan={plan} onPageChange={vi.fn()} onOpenPage={vi.fn()} />,
    );
    expect(screen.getAllByRole('img')).toHaveLength(3);
  });

  it('märgib kõrge tindiskooriga lehe', () => {
    render(
      <SplitContactSheet uploadId="u1" plan={plan} onPageChange={vi.fn()} onOpenPage={vi.fn()} />,
    );
    expect(screen.getByTestId('page-3')).toHaveAttribute('data-ink-level', 'bad');
    expect(screen.getByTestId('page-1')).toHaveAttribute('data-ink-level', 'ok');
  });

  it('poolitusjoont ei kuvata nosplit-lehel', () => {
    const p = { ...plan, pages: plan.pages.map((x) => (x.n === 2 ? { ...x, mode: 'nosplit' as const } : x)) };
    render(
      <SplitContactSheet uploadId="u1" plan={p} onPageChange={vi.fn()} onOpenPage={vi.fn()} />,
    );
    expect(screen.queryByTestId('line-2')).toBeNull();
    expect(screen.getByTestId('line-1')).toBeTruthy();
  });

  it('väljajätmise lüliti kutsub onPageChange', async () => {
    const onPageChange = vi.fn();
    render(
      <SplitContactSheet uploadId="u1" plan={plan} onPageChange={onPageChange} onOpenPage={vi.fn()} />,
    );
    await userEvent.click(screen.getByTestId('exclude-2'));
    expect(onPageChange).toHaveBeenCalledWith(2, { excluded: true });
  });

  it('pisipildil klikkimine avab üksiklehe', async () => {
    const onOpenPage = vi.fn();
    render(
      <SplitContactSheet uploadId="u1" plan={plan} onPageChange={vi.fn()} onOpenPage={onOpenPage} />,
    );
    await userEvent.click(screen.getByTestId('open-3'));
    expect(onOpenPage).toHaveBeenCalledWith(3);
  });

  it('väljajäetud leht on visuaalselt maha võetud', () => {
    const p = { ...plan, pages: plan.pages.map((x) => (x.n === 1 ? { ...x, excluded: true } : x)) };
    render(
      <SplitContactSheet uploadId="u1" plan={p} onPageChange={vi.fn()} onOpenPage={vi.fn()} />,
    );
    expect(screen.getByTestId('page-1')).toHaveAttribute('data-excluded', 'true');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/upload/__tests__/SplitContactSheet.test.tsx`
Expected: FAIL — stub ei ekspordi `inkLevel`-i ega renderda pisipilte

- [ ] **Step 3: Write the component**

Replace `src/pages/upload/components/SplitContactSheet.tsx`:

```tsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import { EyeOff, Eye, Maximize2 } from 'lucide-react';
import { prepressPreviewUrl } from '../uploadApi';
import type { PrepressPage, PrepressPlan } from '../types';

/**
 * Tindiskoori tase. Usaldusväärne AINULT kõrge väärtuse suunas: kõrge skoor
 * tähendab, et joon lõikab kindlasti midagi; madal skoor EI tõesta õiget
 * kohta (tühi veeris skoorib samuti 0). Läved on mõõdetud EAA 1253 materjalil.
 */
export function inkLevel(ink: number | null): 'ok' | 'warn' | 'bad' {
  if (ink == null) return 'ok';
  if (ink >= 0.8) return 'bad';
  if (ink >= 0.25) return 'warn';
  return 'ok';
}

const BORDER: Record<string, string> = {
  ok: 'border-green-500',
  warn: 'border-amber-500',
  bad: 'border-red-600',
};

interface Props {
  uploadId: string;
  plan: PrepressPlan;
  onPageChange: (n: number, patch: Partial<PrepressPage>) => void;
  onOpenPage: (n: number) => void;
}

const SplitContactSheet: React.FC<Props> = ({ uploadId, plan, onPageChange, onOpenPage }) => {
  const { t } = useTranslation(['upload']);

  return (
    <div
      data-testid="split-contact-sheet"
      className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(150px,1fr))]"
    >
      {plan.pages.map((page) => {
        const level = inkLevel(page.ink);
        const splits = plan.enabled && page.mode !== 'nosplit';
        const x = page.mode === 'custom' && page.split_x != null
          ? page.split_x
          : plan.default_split_x;
        return (
          <div
            key={page.n}
            data-testid={`page-${page.n}`}
            data-ink-level={level}
            data-excluded={page.excluded ? 'true' : 'false'}
            className={`relative ${page.excluded ? 'opacity-35' : ''}`}
          >
            <button
              type="button"
              data-testid={`open-${page.n}`}
              title={t('step3split.openPage')}
              className={`block w-full border-2 ${BORDER[level]}`}
              onClick={() => onOpenPage(page.n)}
            >
              <img
                src={prepressPreviewUrl(uploadId, page.n)}
                alt={`${page.n}`}
                loading="lazy"
                className="block w-full"
              />
            </button>

            {splits && !page.excluded && (
              <div
                data-testid={`line-${page.n}`}
                className="absolute top-0 bottom-0 w-px bg-rose-600 pointer-events-none"
                style={{ left: `${x * 100}%` }}
              />
            )}

            <div className="absolute top-1 left-1 flex gap-1">
              <span className="text-[10px] px-1 rounded bg-black/60 text-white">{page.n}</span>
              {level !== 'ok' && (
                <span
                  className="text-[10px] px-1 rounded bg-red-700 text-white"
                  title={t('step3split.inkWarning')}
                >
                  {page.ink?.toFixed(2)}
                </span>
              )}
            </div>

            <div className="absolute top-1 right-1 flex gap-1">
              <button
                type="button"
                data-testid={`exclude-${page.n}`}
                title={page.excluded ? t('step3split.include') : t('step3split.exclude')}
                className="p-1 rounded bg-black/60 text-white"
                onClick={() => onPageChange(page.n, { excluded: !page.excluded })}
              >
                {page.excluded ? <Eye size={12} /> : <EyeOff size={12} />}
              </button>
              <button
                type="button"
                data-testid={`nosplit-${page.n}`}
                title={t('step3split.noSplit')}
                className="p-1 rounded bg-black/60 text-white"
                onClick={() => onPageChange(page.n, {
                  mode: page.mode === 'nosplit' ? 'default' : 'nosplit',
                  split_x: null,
                })}
              >
                <Maximize2 size={12} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default SplitContactSheet;
```

- [ ] **Step 4: Run tests and gates**

Run:
```bash
npx vitest run src/pages/upload/__tests__/SplitContactSheet.test.tsx
npm run typecheck
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/pages/upload/components/SplitContactSheet.tsx src/pages/upload/__tests__/SplitContactSheet.test.tsx
git commit -m "feat(prepress): SplitContactSheet — pisipiltide ruudustik tindihoiatusega"
```

---

Plaani ülejäänud osa (Task 12–14) kirjutan järgmisena samasse faili.
