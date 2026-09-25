"""Lehekirjutuse failinime leping (R24-01, #422).

Kõik teed, mis kirjutavad kliendi antud `file_name` järgi lehe `.txt`/`.json`
paari (`/save`, `/git-restore`, kommentaaride ja annotatsioonide taaste,
kommentaarile vastamine), kontrollivad nime SIIN. Ilma selleta sai teose
kirjutamisõigusega kasutaja salvestada `_metadata.json`-i ja muuta nii teose
avalikkust — metaandmete muutmine on admini toiming.
"""
import os

from fastapi import HTTPException

# Failisüsteem on tõstutundlik: vanemates importides esineb ka `.JPG`.
LEHE_PILDI_LAIENDID = ('.jpg', '.jpeg', '.png', '.JPG', '.JPEG', '.PNG')


def check_page_filename(filename: str) -> None:
    """Lehe tekst on ALATI `{tüvi}.txt` ja kõrvalfail `{tüvi}.json`; `_`/`.`
    algusega tüvi on reserveeritud (`_metadata.json`, `_thumbs/` jne). Ainult
    laiendi kontroll ei piisa: `_metadata.txt` kõrvalfail oleks `_metadata.json`."""
    stem, ext = os.path.splitext(filename or '')
    if (not stem or ext != '.txt' or filename != os.path.basename(filename) or
            stem.startswith(('_', '.')) or '\\' in filename or '\x00' in filename):
        raise HTTPException(status_code=400, detail="Vigane lehe failinimi")


def require_existing_page(base_dir: str, catalog: str, filename: str) -> None:
    """Kirjutus tohib minna ainult olemasolevale lehele: `.txt` on olemas või
    on olemas sama tüvega lehepilt (tühja OCR-iga leht). Salvestus ei loo uut
    lehte — lehed tekivad impordi ja teose halduse kaudu.

    Kutsu PÄRAST õiguskontrolli, muidu reedaks 404/200 vahe piiratud teose lehti.
    """
    work_dir = os.path.join(base_dir, catalog)
    stem = os.path.splitext(filename)[0]
    for nimi in [filename] + [stem + e for e in LEHE_PILDI_LAIENDID]:
        tee = os.path.join(work_dir, nimi)
        if os.path.isfile(tee) and not os.path.islink(tee):
            return
    raise HTTPException(status_code=404, detail="Lehte ei leitud")
