"""ADA (dspace.ut.ee) REST-klient. DSpace 7.6.6, autentimist ei vaja.

API kuju on TEOSTUSDETAIL. Leping on `lookup()` tagastuskuju — DSpace on
versioonide vahel teid muutnud ja teeb seda uuesti.
"""
import re
from typing import Dict, List, Optional

import requests

from ..config import get_logger
from . import mapping

logger = get_logger(__name__)

BASE = "https://dspace.ut.ee/server/api"
TIMEOUT = 30

# ORIGINAL on ainus kimp, milles on skaneeringud. TEXT sisaldab OCR-i
# (mitte meie oma), THUMBNAIL pisipilte, LICENSE litsentsiteksti.
LUBATUD_KIMP = "ORIGINAL"

_HANDLE = re.compile(r"(\d+/\d+)\s*$")
_UUID = re.compile(r"/items/([0-9a-f-]{36})")
_PALJAS_UUID = re.compile(r"^[0-9a-f-]{36}$")


class AdaViga(Exception):
    """Viga, mille sõnum on mõeldud kasutajale näitamiseks."""

    def __init__(self, kasutaja_sonum: str):
        super().__init__(kasutaja_sonum)
        self.kasutaja_sonum = kasutaja_sonum


def on_item_uuid(sisend: str) -> Optional[str]:
    """Tagastab item UUID, kui sisend on /items/{uuid} kujul."""
    m = _UUID.search(sisend or "")
    return m.group(1) if m else None


def normaliseeri_handle(sisend: str) -> str:
    """Viis sisendkuju → `10062/7822`.

    Aktsepteerib: paljas handle, `hdl:`-prefiks, hdl.handle.net URL,
    dspace.ut.ee/handle/ URL. Tühikud lõigatakse.
    """
    tekst = (sisend or "").strip()
    m = _HANDLE.search(tekst)
    if not m:
        raise AdaViga(
            "Ei tundnud handle'it ära. Oodatud kuju: 10062/7822, "
            "hdl:10062/7822 või http://hdl.handle.net/10062/7822"
        )
    return m.group(1)


def _get(url: str) -> dict:
    try:
        vastus = requests.get(url, timeout=TIMEOUT, allow_redirects=True)
    except requests.RequestException as e:
        logger.warning("ADA päring ebaõnnestus: %s (%s)", url, e)
        raise AdaViga("ADA server ei vasta. Proovi hiljem või täida vorm käsitsi.")
    if vastus.status_code == 404:
        raise AdaViga("Sellist kirjet ADA-s ei ole.")
    if not getattr(vastus, "ok", vastus.status_code == 200):
        raise AdaViga("ADA vastas veaga (HTTP {}).".format(vastus.status_code))
    return vastus.json()


def lookup(sisend: str) -> Dict[str, object]:
    """Handle VÕI item-UUID → metaandmed + sorditud PDF-failide plaan. EI KIRJUTA midagi.

    Kaks sisendteed, sest admin kleebib sageli brauseri aadressiriba: ADA
    handle-URL suunab lõpuks `/items/{uuid}`-le.
    """
    item_uuid = on_item_uuid(sisend) or (sisend if _PALJAS_UUID.match(sisend or "") else None)
    if item_uuid:
        item = _get("{}/core/items/{}".format(BASE, item_uuid))
    else:
        handle = normaliseeri_handle(sisend)
        item = _get("{}/pid/find?id=hdl:{}".format(BASE, handle))
    item_uuid = item.get("uuid")
    if not item_uuid:
        raise AdaViga("Sellist kirjet ADA-s ei ole.")

    kimbud = _get("{}/core/items/{}/bundles".format(BASE, item_uuid))
    original = None
    for k in (kimbud.get("_embedded") or {}).get("bundles") or []:
        if k.get("name") == LUBATUD_KIMP:
            original = k.get("uuid")
            break
    if not original:
        raise AdaViga("Kirjel ei ole ORIGINAL-kimpu — faile ei ole millest importida.")

    kimbu_sisu = _get("{}/core/bundles/{}/bitstreams?size=1000".format(BASE, original))
    koik = (kimbu_sisu.get("_embedded") or {}).get("bitstreams") or []

    pdfid = [b for b in koik if (b.get("name") or "").lower().endswith(".pdf")]
    vahele_jaetud = [b.get("name") or "?" for b in koik if b not in pdfid]
    if not pdfid:
        raise AdaViga("ORIGINAL-kimbus ei ole ühtki PDF-i.")

    failid = []
    for b in mapping.sordi_bitstreamid(pdfid):
        nimi = b.get("name") or ""
        failid.append({
            "name": nimi,
            "bitstream_uuid": b.get("uuid"),
            "size_bytes": int(b.get("sizeBytes") or 0),
            "tapsus": mapping.parse_failinime_kuupaev(nimi)[3],
        })

    return {
        "handle": sisend,
        "item_uuid": item_uuid,
        "meta": mapping.dc_vuttiks(item),
        "failid": failid,
        "kogu_baite": sum(f["size_bytes"] for f in failid),
        "vahele_jaetud": vahele_jaetud,
    }
