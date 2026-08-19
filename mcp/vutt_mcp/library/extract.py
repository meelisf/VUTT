"""PDF → lehekülgede tekst + otsingunormaliseerimine.

Kaks tekstikuju, sama muster mis VUTT-is (ADR 0006): toores `text` on ainus
tagastatav, normaliseeritud kuju elab ainult otsinguindeksis.
"""
import re
import subprocess
import unicodedata
from pathlib import Path

LEHEERALDAJA = "\f"


class ExtractError(Exception):
    """PDF-ist ei saanud teksti."""


def extract_pages(pdf_path: Path) -> list[str]:
    """pdftotext -layout, lehekülg kaupa. Pikslit ei renderdata, OCR-i ei puutu."""
    pdf_path = Path(pdf_path)
    if not pdf_path.exists():
        raise ExtractError(f"faili ei ole: {pdf_path}")
    try:
        tulem = subprocess.run(
            ["pdftotext", "-layout", str(pdf_path), "-"],
            capture_output=True, text=True, check=True,
        )
    except FileNotFoundError as e:
        raise ExtractError("pdftotext puudub (paigalda poppler-utils)") from e
    except subprocess.CalledProcessError as e:
        raise ExtractError(f"pdftotext kukkus: {e.stderr[:200]}") from e

    lehed = tulem.stdout.split(LEHEERALDAJA)
    if lehed and not lehed[-1].strip():
        lehed.pop()  # pdftotext lisab lõppu tühja saba
    return lehed


def normalize_for_search(text: str) -> str:
    """Konservatiivne: reavahetuse poolitused kokku, tühikud ühtlaseks, NFC.

    Rea SEES olevat sidekriipsu (Gustavo-Carolina) EI puutu.
    """
    text = unicodedata.normalize("NFC", text)
    text = re.sub(r"(\w)[-­]\s*\n\s*(\w)", r"\1\2", text)
    return re.sub(r"\s+", " ", text).strip()
