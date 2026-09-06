"""Rippuva `applying` taaste käivitusel (#256).

`start_apply` teeb CAS-i `awaiting_split → applying` ja käivitab taustalõime.
Konteineri restart tapab lõime enne, kui `apply_and_transfer` except-haru
jõuab staatust muuta — upload jääb IGAVESEKS `applying`-usse ja kasutaja näeb
„OCR server töötleb…". Sama muster nagu `reocr_recovery.py` ja
`ada.fetch.taasta_rippuvad_fetchid`.

**Otsus sünnib LOKAALSEST state'ist, mitte kaugkataloogist.** `page_map` ja
`applied_done` kirjutatakse iga avaldatud lehe kohta (ADR 0030), seega on juba
teada, kas midagi välja läks. SSH käivitusel oleks siin vale tee: blokeeriv
SSH `async` kontekstis külmutas 2026-06-13 kogu event-loopi (ADR 0002).

Taaste tohib joosta AINULT käivitusel, enne kui uusi apply-sid saab alustada —
muidu lähtestaks ta päriselt käimasoleva töö.
"""
import os
from typing import Optional

from ..config import get_logger
from . import state as upload_state

logger = get_logger(__name__)


def _avaldatud_lehti(prepress: Optional[dict]) -> int:
    """Mitu VÄLJUNDLEHTE jõudis OCR-serverisse enne katkemist.

    `page_map` on autoriteet: ta kaardistab iga lähtelehe temast tekkinud
    väljundlehtedeks ja teda kirjutatakse mõlemas kohas, kus `out_index`
    kasvab. `applied_done` loeb LÄHTElehti ja poolitatud töö puhul alahindaks.
    """
    kaart = (prepress or {}).get("page_map") or {}
    return sum(len(v) for v in kaart.values() if isinstance(v, list))


def _lahtelehti(prepress: Optional[dict]) -> Optional[int]:
    """Lähte-lehtede arv plaanist. Üks kirje lehe kohta (`default_plan`)."""
    lehed = (prepress or {}).get("pages")
    return len(lehed) if isinstance(lehed, list) and lehed else None


def _taasta_uks(upload_id: str) -> None:
    s = upload_state.read_state(upload_id)
    if not s or s.get("status") != "applying":
        return

    prepress = s.get("prepress")
    avaldatud = _avaldatud_lehti(prepress)

    if avaldatud:
        # Poolik partii EI TOHI vaikselt „valmis" paista: OCR-server näeks
        # vähem lehti kui teoses on ja lehed nihkuksid. Otsus jääb inimesele.
        upload_state.set_upload_state(
            upload_id, status="error",
            error_message=(
                "Backend taaskäivitus avaldamise ajal: {} lehekülge jõudis "
                "OCR-serverisse, ülejäänud mitte. Vajuta „Rakenda\" uuesti — "
                "kaugkaust puhastatakse enne uut katset.".format(avaldatud)),
        )
        logger.warning("Apply taastatud veaks (%s lehte avaldatud): %s",
                       avaldatud, upload_id)
        return

    # Midagi ei jõudnud välja: plaan ja eelvaade on alles, kasutaja vajutab
    # „Rakenda" uuesti. `expected_pages` PEAB tulema tagasi lähte-lehtede
    # arvule — `try_begin_applying` kirjutas ta väljundarvuga üle, ja kui see
    # jääks, arvutaks järgmine apply väljundarvu VÄLJUNDARVUST.
    lisad = {}
    lahtelehti = _lahtelehti(prepress)
    if lahtelehti:
        lisad["expected_pages"] = lahtelehti
    upload_state.set_upload_state(upload_id, status="awaiting_split", **lisad)
    logger.info("Apply taastatud awaiting_split'iks: %s", upload_id)


def taasta_rippuvad_applyd() -> None:
    """Käivitusel: iga `applying` upload saab otsuse. Ei viska."""
    if not os.path.isdir(upload_state.UPLOADS_DIR):
        return
    for uid in sorted(os.listdir(upload_state.UPLOADS_DIR)):
        # Erand ÜHE upload'i pealt ei tohi ülejäänuid taastamata jätta: see
        # jookseb daemon-lõimes, kus lekkinud erand kaob logisse ja kõik
        # hilisemad uploadid jääksid rippu, ilma et keegi märkaks.
        try:
            _taasta_uks(uid)
        except Exception:
            logger.warning("Apply taaste ebaõnnestus: %s", uid, exc_info=True)
