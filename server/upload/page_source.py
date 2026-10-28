"""Lehepikslite allikas: PDF (pdftoppm) või pildikaust (PIL).

prepress.py ei tea, kumb on all — nii ei dubleeru plaaniloogika PDF- ja
mitmepildi-teekonna vahel.

DPI ja JPEG-kvaliteet PEAVAD kattuma OCR-serveri valvurskripti väärtustega
(~/Dokumendid/LLM/qwen3.5/kataloogi-jalgimine-ja-ocr.py: PDF_DPI = 300,
img.save(..., quality=95)). Kui need seal muutuvad, tuleb muuta ka siin.
`FULL_DPI` on lagi: kogu lehte katvat skannipilti ei venitata üle tema enda
ppi (ADR 0073).
"""
import glob
import os
import subprocess
from typing import List, Optional

from ..config import get_logger

logger = get_logger(__name__)

PREVIEW_DPI = 100          # ülevaatuse pisipilt — ~0,58 s/lk (mõõdetud 2026-08-24, 143 lk / 82,6 s)
FULL_DPI = 300             # = OCR-serveri PDF_DPI
JPEG_QUALITY = 95          # = OCR-serveri img.save(quality=95)
PREVIEW_MAX_EDGE = 700     # pildikausta eelvaate pikim külg
RENDER_TIMEOUT = 120       # ühe lehe renderduse ülempiir sekundites
SCAN_COVER_MIN = 0.9       # pilt katab ≥ 90 % lehest → skannileht (ADR 0073)
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

    def render_preview(self, n: int, dst: str) -> None:
        raise NotImplementedError

    def render_full(self, n: int, dst: str) -> Optional[dict]:
        """Kirjutab lehe täismõõdus. PDF tagastab `{"dpi", "reason"}` (diagnostika)."""
        raise NotImplementedError

    def source_file(self, n: int) -> Optional[str]:
        """Lähtefaili tee, kui leht ON juba fail. PDF-il ei ole — tagastab None.

        Võimaldab baithaaval kopeerimist seal, kus teisendust ei ole vaja
        (vt prepress_apply.can_copy_source_bytes).
        """
        return None



# --- PDF ---


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


def _run_text(cmd: List[str]) -> str:
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
    if result.returncode != 0:
        raise RuntimeError("{} exit={}".format(cmd[0], result.returncode))
    return result.stdout.decode("utf-8", "replace")


def parse_pdfimages_list(text: str) -> List[tuple]:
    """`pdfimages -list` → [(laius, kõrgus, x_ppi, y_ppi)] ainult `image`-tüüpi ridadest.

    `mask`/`smask`/`stencil` on läbipaistvuse kirjeldus, mitte omaette pilt.
    Veerud: page num type width height color comp bpc enc interp object ID
    x-ppi y-ppi size ratio (object ID on kaks veergu).
    """
    rows = []
    for line in text.splitlines():
        f = line.split()
        if len(f) < 14 or not f[0].isdigit() or f[2] != "image":
            continue
        try:
            rows.append((int(f[3]), int(f[4]), float(f[12]), float(f[13])))
        except ValueError:
            continue
    return rows


def parse_page_size(text: str, n: int) -> Optional[tuple]:
    """`pdfinfo -f n -l n` → lehe suurus punktides (laius, kõrgus)."""
    prefix = "Page {:>4} size:".format(n)
    for line in text.splitlines():
        if line.startswith(prefix) or line.startswith("Page {} size:".format(n)):
            parts = line.split(":", 1)[1].split()
            try:
                return float(parts[0]), float(parts[2])
            except (IndexError, ValueError):
                return None
    return None


def scan_render_dpi(images: List[tuple], page_pt: tuple) -> tuple:
    """Renderduse ppi ja põhjus (ADR 0073).

    Ainult ühe kogu lehte katva skannipildiga lehel `min(300, x_ppi, y_ppi)` —
    PDF-i deklareeritud lehe suurus võib valetada (BSB märgib skanni 72 ppi-ks,
    leht „on" 62 × 81 cm) ja 300 ppi venitaks skanni ~4× üles. Kõik muu jääb
    300 peale: digitaalsel lehel on lehe suurus päris ja väikese foto ppi ei
    tohi teksti renderdust alla tõmmata.
    """
    if not images:
        return FULL_DPI, "pilti ei ole"
    if len(images) > 1:
        return FULL_DPI, "mitu pilti"
    w, h, xppi, yppi = images[0]
    if xppi <= 0 or yppi <= 0:
        return FULL_DPI, "ppi puudub"
    page_area = (page_pt[0] / 72.0) * (page_pt[1] / 72.0)
    if page_area <= 0 or (w / xppi) * (h / yppi) < SCAN_COVER_MIN * page_area:
        return FULL_DPI, "pilt katab osa lehest"
    if abs(xppi - yppi) > 0.1 * max(xppi, yppi):
        logger.warning("Skanni telgede ppi erineb: x=%s y=%s", xppi, yppi)
    return max(1, min(FULL_DPI, int(min(xppi, yppi)))), "skann"


class PdfPageSource(PageSource):
    """pdftoppm-põhine allikas."""

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

    def _scan_dpi(self, n: int) -> tuple:
        """Lehe renderduse ppi. Tuvastuse tõrge → 300 nagu enne, mitte apply viga."""
        try:
            images = parse_pdfimages_list(_run_text(
                ["pdfimages", "-f", str(n), "-l", str(n), "-list", self.pdf_path]))
            page_pt = parse_page_size(_run_text(
                ["pdfinfo", "-f", str(n), "-l", str(n), self.pdf_path]), n)
        except Exception as e:
            logger.warning("Lehe %s pilditüübi tuvastus ebaõnnestus: %s", n, e)
            return FULL_DPI, "tuvastus ebaõnnestus"
        if not page_pt:
            return FULL_DPI, "lehe suurus puudub"
        return scan_render_dpi(images, page_pt)

    def render_full(self, n: int, dst: str) -> dict:
        dpi, reason = self._scan_dpi(n)
        base = self._base(dst)
        nice_run([
            "pdftoppm", "-jpeg", "-jpegopt", "quality={}".format(JPEG_QUALITY),
            "-r", str(dpi), "-f", str(n), "-l", str(n),
            self.pdf_path, base,
        ])
        self._finish(base, n, dst)
        return {"dpi": dpi, "reason": reason}


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

    def source_file(self, n: int) -> Optional[str]:
        try:
            return self._path(n)
        except IndexError:
            return None

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


def open_page_source(source_path: str) -> PageSource:
    """Valib teostuse tee järgi: kaust → pildid, fail → PDF."""
    if os.path.isdir(source_path):
        return ImageDirPageSource(source_path)
    return PdfPageSource(source_path)
