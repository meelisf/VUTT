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
