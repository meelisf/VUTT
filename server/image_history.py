"""Muudetud piltide loend teose kohta (#325).

Allikas on `._originals/{work_id}/` (mis lehel ON pristine originaal alles) ja
`data/transform_image.log` (kes, millal, mida tegi). Parsimine käib SIIN, mitte
frontendis: logivorming on serveri asi ja klient saab juba tuletatud väljad.
"""
import os
import re
from typing import Optional

from .config import BASE_DIR, get_logger
from .utils import find_directory_by_id

logger = get_logger(__name__)

LOGI_NIMI = "transform_image.log"

# 5 välja torudega: aeg | kasutaja | work_id | failinimi | parameetrid | -> tulemus
_RIDA = re.compile(r'^([^|]+)\|([^|]+)\|([^|]+)\|([^|]+)\|(.*)\|([^|]*)$')


def parsi_logirida(rida: str) -> Optional[dict]:
    """Üks logirida → kirje, või None kui rida ei ole loetav.

    Tegevus tuleb VÄÄRTUSEST: `angle=`, `crop=` ja `quad=` on igal teisendusreal
    kohal, ka `0.0` / `None`. Võtme olemasolu järgi otsustamine märgiks iga
    salvestuse kärpeks.
    """
    if not rida or not rida.strip():
        return None
    m = _RIDA.match(rida.strip())
    if not m:
        return None
    aeg, kasutaja, work_id, failinimi, param, _ = (o.strip() for o in m.groups())

    tegevused = []
    if "restore_original" in param:
        tegevused.append("restore")
    else:
        nurk = re.search(r'angle=([-\d.eE+]+)', param)
        if nurk:
            try:
                if abs(float(nurk.group(1))) > 0:
                    tegevused.append("rotate")
            except ValueError:
                pass
        if re.search(r'crop=(?!None)', param):
            tegevused.append("crop")
        if re.search(r'quad=(?!None)', param):
            tegevused.append("quad")
    return {"at": aeg, "by": kasutaja, "work_id": work_id,
            "filename": failinimi, "action": tegevused}


def _viimased_logikirjed(work_id: str) -> dict:
    """failinimi → viimane kirje. Puuduv või katkine logi ei kuku päringut."""
    tee = os.path.join(BASE_DIR, LOGI_NIMI)
    tulemus = {}
    try:
        with open(tee, "r", encoding="utf-8") as f:
            for rida in f:
                kirje = parsi_logirida(rida)
                if kirje and kirje["work_id"] == work_id:
                    tulemus[kirje["filename"]] = kirje
    except FileNotFoundError:
        pass
    except Exception as e:
        logger.warning(f"AJALUGU: {LOGI_NIMI} lugemine ebaõnnestus: {e}")
    return tulemus


def muudetud_pildid(work_id: str) -> list:
    """Lehed, millel on pristine originaal alles JA mis on veel teoses olemas."""
    from .admin_page_ops import get_sorted_images

    kaust = os.path.join(BASE_DIR, "._originals", work_id)
    if not os.path.isdir(kaust):
        return []
    tee = find_directory_by_id(work_id)
    if not tee:
        return []

    jarjekord = {nimi: i + 1 for i, nimi in enumerate(get_sorted_images(tee))}
    logi = _viimased_logikirjed(work_id)

    kirjed = []
    for nimi in sorted(os.listdir(kaust)):
        allikas = os.path.join(kaust, nimi)
        # `.thumbs` cache ja muu kataloogi-sisu ei ole kirjed.
        if not os.path.isfile(allikas) or not nimi.lower().endswith(('.jpg', '.jpeg', '.png')):
            continue
        # Kadunud leht: originaal kuulub hiljem kustutatud või poolitatud lehele.
        if nimi not in jarjekord:
            continue
        kirje = logi.get(nimi)
        praegune = os.path.join(tee, nimi)
        kirjed.append({
            "filename": nimi,
            "page": jarjekord[nimi],
            # Tühi loend = „muudetud" ilma täpsustuseta. `split_page` ei kirjuta
            # logisse, AGA sama seis tekib ka puuduva või katkise logi korral —
            # „poolitusest" vajaks positiivset tõendit, mida meil ei ole.
            "action": kirje["action"] if kirje else [],
            "at": kirje["at"] if kirje else None,
            "by": kirje["by"] if kirje else None,
            # Kaks versiooni: `v` = originaal („enne"), `v_current` = praegune
            # pilt („pärast"). Originaali taastamine muudab AINULT teist.
            "v": os.stat(allikas).st_mtime_ns,
            "v_current": os.stat(praegune).st_mtime_ns,
        })
    return kirjed
