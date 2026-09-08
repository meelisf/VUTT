"""Muudetud piltide loend teose kohta (#325).

Allikas on `._originals/{work_id}/` (mis lehel ON pristine originaal alles) ja
`data/transform_image.log` (kes, millal, mida tegi). Parsimine käib SIIN, mitte
frontendis: logivorming on serveri asi ja klient saab juba tuletatud väljad.
"""
import os
import re
from typing import Optional

from .config import BASE_DIR, get_logger
from .trash_reason import SPLIT_PREFIXES_AJALUGU
from .utils import find_directory_by_id

logger = get_logger(__name__)

LOGI_NIMI = "transform_image.log"

# Eraldaja git-logi commitide vahel. Ei tohi olla NULL-bait (subprocess argv ei
# luba embedded null'i) ega midagi, mis päris commit-sõnumis ette tuleks.
_GIT_LOG_DELIM = "\x01VUTT_SPLIT_LOG\x01"

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


def _splitust_sundinud_alused(work_id: str, folder_name: str) -> set:
    """Baasnimed (ilma laiendita), mille LISAMISE commit on poolituse commit.

    Positiivne tõend gitist: `split_page` kirjutab MÕLEMA poole ._originals
    kirje, ilma et transform_image.log'is oleks rida — logirea puudumine üksi
    ei tõesta midagi (vt `muudetud_pildid`). Siin loeme, kes faili LISAS
    (`--diff-filter=A`), mitte kes seda viimati muutis — nii ei sega
    hilisemad tavalised commitid (nt ümberjärjestus) tõendit.

    ÜKS git-käsk terve teose kohta, mitte üks faili kohta: teosel võib olla
    sadu ._originals kirjeid ja per-faili git log teeks admin-paneeli
    aeglaseks.
    """
    from .git_ops import get_or_init_repo

    tulemus = set()
    try:
        repo = get_or_init_repo()
        valjund = repo.git.log(
            '--all', '--diff-filter=A', '--name-only',
            f'--pretty=format:{_GIT_LOG_DELIM}%s',
            '--', folder_name + '/',
        )
        for plokk in valjund.split(_GIT_LOG_DELIM):
            if not plokk.strip():
                continue
            read = plokk.split('\n')
            sonum = read[0]
            if not sonum.startswith(SPLIT_PREFIXES_AJALUGU):
                continue
            for failitee in read[1:]:
                failitee = failitee.strip()
                if not failitee:
                    continue
                base = os.path.splitext(os.path.basename(failitee))[0]
                tulemus.add(base)
    except Exception as e:
        # Git-viga ei tohi prügikasti/ajaloopaneeli kukutada — kirjed jäävad
        # lihtsalt filtreerimata (neutraalne, mitte vale-negatiivne suund).
        logger.warning(f"AJALUGU: poolituse tuvastus git-logist ebaõnnestus ({work_id}): {e}")
        return set()
    return tulemus


def muudetud_pildid(work_id: str) -> list:
    """Lehed, millel on pristine originaal alles JA mis on veel teoses olemas.

    Poolituse mõlemad pooled JÄETAKSE VÄLJA (vt `_splitust_sundinud_alused`):
    neil on ._originals kirje, aga „Taasta originaal" tooks tagasi terve
    poolitamata topeltlehe, samal ajal kui tekst on juba poolitatud lehe
    järgi kahte kohta jagatud.
    """
    from .admin_page_ops import get_sorted_images

    kaust = os.path.join(BASE_DIR, "._originals", work_id)
    if not os.path.isdir(kaust):
        return []
    tee = find_directory_by_id(work_id)
    if not tee:
        return []

    jarjekord = {nimi: i + 1 for i, nimi in enumerate(get_sorted_images(tee))}
    logi = _viimased_logikirjed(work_id)
    folder_name = os.path.basename(tee)
    splitud_alused = _splitust_sundinud_alused(work_id, folder_name)

    kirjed = []
    for nimi in sorted(os.listdir(kaust)):
        allikas = os.path.join(kaust, nimi)
        # `.thumbs` cache ja muu kataloogi-sisu ei ole kirjed.
        if not os.path.isfile(allikas) or not nimi.lower().endswith(('.jpg', '.jpeg', '.png')):
            continue
        # Kadunud leht: originaal kuulub hiljem kustutatud või poolitatud lehele.
        if nimi not in jarjekord:
            continue
        # Poolituse jääk: positiivselt tõestatud gitist, mitte logirea puudumisest.
        if os.path.splitext(nimi)[0] in splitud_alused:
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
