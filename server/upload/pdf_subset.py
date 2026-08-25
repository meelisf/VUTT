"""PDF-i alamhulga ehitamine poppleriga (pdfseparate + pdfunite).

Miks üldse PDF, kui OCR-server võtab ka üksikpilte vastu? Võtab — aga siis
peaksime lehed ise 300 DPI-l välja renderdama (~6 min / 143 lk). Alamhulga
ehitamine jätab rasterdamise OCR-serveri poolele, kus see niikuinii toimub:
~36 s sama töö kohta.

Sõltuvus: poppler-utils (Dockerfile'is olemas, sama pakett mis pdftoppm).
"""
import os
import shutil
import tempfile
from typing import List

from ..config import get_logger
from .page_source import nice_run

logger = get_logger(__name__)

SUBSET_TIMEOUT = 600      # 143 lk mahub ~36 s sisse; varu katab suuremad tööd


def build_subset_pdf(src_pdf: str, keep_pages: List[int], dst_pdf: str) -> int:
    """Kirjutab dst_pdf-i ainult keep_pages (1-põhised) lehed, samas järjekorras.

    Tagastab kirjutatud lehtede arvu. Tõstab RuntimeError, kui poppler kukub —
    kutsuja peab sellest tegema varutee-otsuse, mitte laskma erandil välja.
    """
    if not keep_pages:
        raise ValueError("keep_pages on tühi — kogu töö oleks väljajäetud")

    tmp_dir = tempfile.mkdtemp(prefix="pdfsubset-", dir=os.path.dirname(dst_pdf))
    try:
        # pdfseparate kirjutab %d-mustri järgi ühe faili lehe kohta.
        pattern = os.path.join(tmp_dir, "pg-%d.pdf")
        nice_run(["pdfseparate", src_pdf, pattern], timeout=SUBSET_TIMEOUT)

        parts = []
        for n in keep_pages:
            part = os.path.join(tmp_dir, "pg-{}.pdf".format(n))
            if not os.path.isfile(part):
                raise RuntimeError("pdfseparate ei loonud lehte {}".format(n))
            parts.append(part)

        out_tmp = os.path.join(tmp_dir, "united.pdf")
        nice_run(["pdfunite"] + parts + [out_tmp], timeout=SUBSET_TIMEOUT)
        shutil.move(out_tmp, dst_pdf)
        os.chmod(dst_pdf, 0o644)
        return len(parts)
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
