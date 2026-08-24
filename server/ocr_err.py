"""OCR-serveri `.err` märgendi tõlgendus (#250, #227).

Märgendi sisu kuju on `{kategooria}: {ErandiTüüp}: {sõnum}`, nt::

    mudel: KordusLoop: periood 1, 40 kordust — genereerimine peatatud 96 tokeni järel
    pilt: UnidentifiedImageError: cannot identify image file '…'

Kategooria on esimene väli, sest **kasutaja otsus sõltub vea liigist, mitte
sõnumist**:

- ``mudel``    — pilt on korras, mudel ei andnud kasutatavat teksti (kordusloop,
                 CUDA OOM, tühi lehekülg). Leht ON imporditav tühja tekstiga:
                 skaneering on olemas ja inimene kirjutab teksti Workspace'is.
- ``pilt``     — skaneeringut ei saa avada. Lehte EI SAA käsitsi transkribeerida,
                 sest pilti ennast ei ole → vaja uut faili.
- ``kirjutus`` — tekst valmis, aga salvestus ebaõnnestus. Tulemus on olemas, aga
                 kadunud; tühjana importimine viskaks korras transkriptsiooni ära.

Tundmatu kategooria (vana märgend ilma prefiksita, tulevikus lisanduv liik) EI
ole imporditav — vaikimisi suund on ettevaatlik.
"""
from typing import Optional, Tuple

KAT_PILT = "pilt"
KAT_MUDEL = "mudel"
KAT_KIRJUTUS = "kirjutus"

# Ainult mudeli viga tähendab, et skaneering on korras ja leht on käsitsi täidetav.
IMPORDITAVAD_KATEGOORIAD = frozenset({KAT_MUDEL})
TEADAOLEVAD_KATEGOORIAD = frozenset({KAT_PILT, KAT_MUDEL, KAT_KIRJUTUS})


def parse_err(sisu: Optional[str]) -> Tuple[str, str]:
    """Tükeldab märgendi (kategooria, sõnum). Tundmatu kuju → ("", kogu sisu)."""
    tekst = (sisu or "").strip()
    if not tekst:
        return "", ""
    esimene, eraldaja, saba = tekst.partition(":")
    kat = esimene.strip().lower()
    if eraldaja and kat in TEADAOLEVAD_KATEGOORIAD:
        return kat, saba.strip()
    return "", tekst


def on_imporditav_tuhjana(sisu: Optional[str]) -> bool:
    """Kas selle veaga lehe tohib teosesse importida tühja tekstiga?"""
    kat, _ = parse_err(sisu)
    return kat in IMPORDITAVAD_KATEGOORIAD
