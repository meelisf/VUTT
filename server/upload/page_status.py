"""Lehe seisund: ÜKS koht, kus otsustatakse „mis seisus see leht on" (#261).

Kolm eri küsimust, mida enne seda moodulit vastati käsitsi seitsmes kohas — ja
kahes neist valesti:

- ``is_ready``      — lehel ON tekst
- ``is_resolved``   — OCR on selle lehega LÕPETANUD (valmis VÕI lõplikult läbi)
- ``is_importable`` — leht kuulub teosesse (tühjana käsitsi täidetav)

Need EI OLE sünonüümid. `is_resolved` on `is_importable`-ist LAIEM: pildi veaga
leht on OCR-i jaoks lõpetatud, aga teda ei saa importida, sest skaneeringut ei
ole olemas ja inimene ei saa teda täita. Iga kord, kui need kaks on kokku
sulatatud, on tulemus olnud viga (#250, #294).

`deleted` EI OLE osa üheski predikaadis — ta on kutsuja poliitika, mille
``count`` nõuab välja öelda. Vaikeväärtus tähendaks, et uus kutsekoht pärib
poliitika, mille üle keegi ei otsustanud; täpselt see on #261 muster.
"""
from typing import Callable, List, Optional

from .. import ocr_err


def is_ready(entry: dict) -> bool:
    """Lehel on OCR-tekst."""
    return bool(entry.get("has_ocr"))


def is_resolved(entry: dict) -> bool:
    """OCR ei ole selle lehega enam ootel: kas tekst või lõplik vea-märgend.

    ADR 0025: `.err` märgend on LÕPLIK, vigane leht on edenemine. Ainult
    `has_ocr` lugemine jättis vigadega töö igaveseks „OCR seisab" märgi alla —
    kõrvuti teatega „Valmis", mis on vastuoluline (#250).
    """
    return is_ready(entry) or bool(entry.get("ocr_error"))


def is_importable(entry: dict) -> bool:
    """Leht kuulub teosesse.

    Tekstiga leht alati; tekstita leht siis, kui viga on `mudel`-kategooriast —
    skaneering on korras ja inimene kirjutab teksti Workspace'is. Kategooriate
    sõnavara elab ainult `ocr_err`-is (#294).
    """
    if is_ready(entry):
        return True
    return ocr_err.on_imporditav_tuhjana(entry.get("ocr_error"))


def count(files: Optional[List[dict]], pred: Callable[[dict], bool], *,
          skip_deleted: bool) -> int:
    """Mitu lehte vastab predikaadile.

    `skip_deleted` on nimeline JA kohustuslik: kutsuja peab kustutatud lehtede
    poliitika välja ütlema. Kaks õiget vastust elavad koodis kõrvuti —
    upload'i staatuse tee loeb kustutatud lehed kaasa (muidu ei jõuaks
    `resolved >= expected_pages` kunagi täis ja upload jääks „reviewing"
    olekusse), impordi- ja loendurite tee mitte.
    """
    return sum(1 for f in (files or [])
               if not (skip_deleted and f.get("deleted")) and pred(f))
