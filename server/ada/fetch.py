"""ADA failide allalaadimine ja liitmine. Taustalõim, restartitav.

Tõde on FAILIDES, mitte mälus: `017.pdf` olemasolu tähendab „see tükk on terve".
Poolik allalaadimine elab `.part`-failina ja ei näe kunagi välja nagu valmis fail.
"""
import os
import subprocess
import threading
from typing import Optional

import requests

from ..config import get_logger, UPLOADS_DIR
from ..upload import state as upload_state
from . import client as ada_client

logger = get_logger(__name__)

CHUNK = 1024 * 256
ALLALAADIMISE_TIMEOUT = 300
LIITMISE_TIMEOUT = 600

# CAS: nendest olekutest tohib fetch alata. `awaiting_split` EI KUULU siia —
# seal on source.pdf juba kohal ja kordus kirjutaks selle üle.
FETCH_START_STATUSES = ("pending", "ada_error")


class AdaFetchViga(Exception):
    pass


def ada_kaust(upload_id: str) -> str:
    return os.path.join(upload_state.upload_dir(upload_id), "ada")


def tohib_jatkata(upload_id: str) -> bool:
    """F3: kas upload on veel olemas. Kontrollitakse IGA tüki alguses.

    `Katkesta` kustutab staging-kausta; kirjutav lõim tekitaks selle uuesti.
    """
    return os.path.isdir(upload_state.upload_dir(upload_id))


def alusta_fetchi(upload_id: str) -> bool:
    """F1: CAS + taustalõim. False = töö juba käib (topeltklikk, retry, kaks tabi)."""
    lock = upload_state.get_upload_lock(upload_id)
    with lock:
        s = upload_state.read_state(upload_id)
        if not s or s.get("status") not in FETCH_START_STATUSES:
            return False
        s["status"] = "ada_fetching"
        upload_state.write_state(upload_id, s)
    threading.Thread(
        target=_toota, args=(upload_id,), daemon=True,
        name="ada-fetch-{}".format(upload_id),
    ).start()
    return True


def laadi_tykk(url: str, sihtfail: str, oodatud_baite: int) -> None:
    """F2: laeb `.part`-i ja nimetab ümber alles pärast suuruse kontrolli.

    Juba olemasolev sihtfail on VALMIS tükk — seda ei tõmmata uuesti.
    """
    if os.path.exists(sihtfail):
        return
    ajutine = sihtfail + ".part"
    saadud = 0
    try:
        with requests.get(url, stream=True, timeout=ALLALAADIMISE_TIMEOUT) as vastus:
            if vastus.status_code != 200:
                raise AdaFetchViga("ADA vastas veaga (HTTP {})".format(vastus.status_code))
            with open(ajutine, "wb") as f:
                for tykk in vastus.iter_content(chunk_size=CHUNK):
                    if tykk:
                        f.write(tykk)
                        saadud += len(tykk)
    except AdaFetchViga:
        raise
    except Exception:
        # `.part` jääb alles; järgmine katse kirjutab selle üle. Valmis nime
        # ta EI saa, seega poolik sisu ei jõua kunagi pdfunite'i.
        raise
    if oodatud_baite and saadud != oodatud_baite:
        raise AdaFetchViga(
            "Fail jäi pooleli: saadud {} baiti, oodatud {}".format(saadud, oodatud_baite)
        )
    os.replace(ajutine, sihtfail)


def liida_pdfid(kaust: str, sihtfail: str) -> None:
    """`pdfunite` — AINUS lubatud tööriist. qpdf/pdftk/pypdf ei ole konteineris."""
    failid = sorted(
        os.path.join(kaust, n) for n in os.listdir(kaust) if n.endswith(".pdf")
    )
    if not failid:
        raise AdaFetchViga("Liidetavaid PDF-e ei ole")
    cmd = ["pdfunite"] + failid + [sihtfail]
    tulemus = subprocess.run(cmd, capture_output=True, timeout=LIITMISE_TIMEOUT)
    if tulemus.returncode != 0:
        raise AdaFetchViga("pdfunite kukkus: {}".format(
            (getattr(tulemus, "stderr", b"") or b"")[:400].decode("utf-8", "replace")
        ))


def lehtede_arv(pdf_path: str) -> int:
    """`pdfinfo` — sama pakett mis pdfunite."""
    tulemus = subprocess.run(["pdfinfo", pdf_path], capture_output=True, timeout=60)
    for rida in (tulemus.stdout or b"").decode("utf-8", "replace").splitlines():
        if rida.startswith("Pages:"):
            return int(rida.split(":", 1)[1].strip())
    raise AdaFetchViga("pdfinfo ei andnud lehtede arvu")


def taasta_rippuvad_fetchid() -> None:
    """Käivitusel: `ada_fetching` → `ada_error`.

    `upload_progress` on mälupõhine — restart kaotab progressi. Ilma selle
    taasteta jääks töö igaveseks `ada_fetching`-usse ja „Laen uuesti" oleks
    blokeeritud CAS-i poolt. Sama muster nagu `reocr_recovery.py`.
    """
    if not os.path.isdir(UPLOADS_DIR):
        return
    for uid in os.listdir(UPLOADS_DIR):
        try:
            s = upload_state.read_state(uid)
            if s and s.get("status") == "ada_fetching":
                upload_state.set_upload_state(
                    uid, status="ada_error",
                    ada_error="Backend taaskäivitus allalaadimise ajal. Vajuta „Laen uuesti“.",
                )
                logger.info("ADA fetch taastatud veaks: %s", uid)
        except Exception:
            logger.warning("ADA fetch taaste ebaõnnestus: %s", uid, exc_info=True)


def _toota(upload_id: str) -> None:
    """Taustalõim: tükid alla, liida, olek edasi."""
    kaust = ada_kaust(upload_id)
    try:
        os.makedirs(kaust, exist_ok=True)
        s = upload_state.read_state(upload_id)
        allikad = ((s or {}).get("ada") or {}).get("sources") or []
        kogu = sum(int(a.get("size_bytes") or 0) for a in allikad)
        upload_state.upload_progress[upload_id] = {
            "bytes_sent": 0, "bytes_total": kogu, "error": None,
        }
        saadud = 0
        for jrk, allikas in enumerate(allikad, start=1):
            if not tohib_jatkata(upload_id):
                logger.info("ADA fetch katkestatud (staging kadus): %s", upload_id)
                return
            siht = os.path.join(kaust, "{:03d}.pdf".format(jrk))
            url = "{}/core/bitstreams/{}/content".format(
                ada_client.BASE, allikas["bitstream_uuid"]
            )
            laadi_tykk(url, siht, int(allikas.get("size_bytes") or 0))
            saadud += int(allikas.get("size_bytes") or 0)
            upload_state.upload_progress[upload_id] = {
                "bytes_sent": saadud, "bytes_total": kogu, "error": None,
                "files_done": jrk, "files_total": len(allikad),
            }

        if not tohib_jatkata(upload_id):
            return
        source_pdf = os.path.join(upload_state.upload_dir(upload_id), "source.pdf")
        liida_pdfid(kaust, source_pdf)
        lehti = lehtede_arv(source_pdf)

        # Täida lähtekaardi lehepiirid: mitmes leht liidetud PDF-is iga tükk algab.
        nihe = 1
        uued = []
        for jrk, allikas in enumerate(allikad, start=1):
            tyki_lehti = lehtede_arv(os.path.join(kaust, "{:03d}.pdf".format(jrk)))
            uus = dict(allikas)
            uus["first_src_page"] = nihe
            uus["page_count"] = tyki_lehti
            uued.append(uus)
            nihe += tyki_lehti

        s = upload_state.read_state(upload_id) or {}
        ada = dict(s.get("ada") or {})
        ada["sources"] = uued
        # ADR 0028: kuni `applying`-uni on `expected_pages` LÄHTE-lehtede arv.
        upload_state.set_upload_state(
            upload_id, status="awaiting_split", expected_pages=lehti, ada=ada,
            ada_error=None,
        )
        upload_state.init_prepress(upload_id, lehti)

        for n in os.listdir(kaust):
            os.unlink(os.path.join(kaust, n))
        os.rmdir(kaust)
        logger.info("ADA fetch valmis: %s (%s lk)", upload_id, lehti)
    except Exception as e:
        logger.error("ADA fetch kukkus: %s (%s)", upload_id, e, exc_info=True)
        if tohib_jatkata(upload_id):
            # Tükid JÄÄVAD alles — „Laen uuesti" jätkab sealt, kus pooleli jäi.
            upload_state.set_upload_state(upload_id, status="ada_error", ada_error=str(e))
