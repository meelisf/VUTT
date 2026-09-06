"""Lehe seisundi predikaadid: üks koht, kus otsustatakse „mis seisus see leht on" (#261).

Kolm eri küsimust, mida on varem käsitsi korratud seitsmes kohas ja kaks korda
valesti vastatud:

- `is_ready`      — kas lehel ON tekst
- `is_resolved`   — kas OCR on selle lehega LÕPETANUD (valmis või lõplikult läbi)
- `is_importable` — kas leht kuulub teosesse

Need EI OLE sünonüümid ja iga sulatamine on olnud viga.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server.upload import page_status


VALMIS = {"page": 1, "has_ocr": True}
MUDELI_VIGA = {"page": 2, "has_ocr": False,
               "ocr_error": "mudel: KordusLoop: periood 1 sõna, 780 kordust"}
PILDI_VIGA = {"page": 3, "has_ocr": False,
              "ocr_error": "pilt: UnidentifiedImageError: cannot identify image file"}
OOTEL = {"page": 4, "has_ocr": False}


def test_tekstiga_leht_on_koigis_kolmes_motes_korras():
    assert page_status.is_ready(VALMIS)
    assert page_status.is_resolved(VALMIS)
    assert page_status.is_importable(VALMIS)


def test_ootel_leht_ei_ole_uheski_motes_lahendatud():
    assert not page_status.is_ready(OOTEL)
    assert not page_status.is_resolved(OOTEL)
    assert not page_status.is_importable(OOTEL)


def test_mudeli_viga_on_lahendatud_ja_imporditav_aga_mitte_valmis():
    """ADR 0025: mudeli viga = leht on LAHENDATUD, mitte ootel.

    Skaneering on korras, inimene kirjutab teksti Workspace'is. Ainult
    `has_ocr` lugemine jättis vigadega töö igaveseks „OCR seisab" märgi alla.
    """
    assert not page_status.is_ready(MUDELI_VIGA)
    assert page_status.is_resolved(MUDELI_VIGA)
    assert page_status.is_importable(MUDELI_VIGA)


def test_pildi_viga_on_lahendatud_aga_EI_OLE_imporditav():
    """Eristav test: `is_resolved` ja `is_importable` ei ole sama funktsioon.

    Pildi viga tähendab, et skaneeringut ei saa avada — lehte ei saa ka käsitsi
    täita, seega uus fail on vaja. OCR on temaga siiski lõpetanud.
    Kood, mis need kaks sulataks, läbiks kõik ülejäänud testid.
    """
    assert page_status.is_resolved(PILDI_VIGA)
    assert not page_status.is_importable(PILDI_VIGA)


def test_count_noiab_deleted_poliitika_valjaytlemist():
    """`skip_deleted` on KOHUSTUSLIK — vaikeväärtus oleks vaikne pärimine.

    Täpselt see vaikne pärimine on #261 muster: uus kutsekoht saab poliitika,
    mille üle keegi ei otsustanud.
    """
    with pytest.raises(TypeError):
        page_status.count([VALMIS], page_status.is_ready)


def test_count_arvestab_deleted_lippu_moelmat_pidi():
    files = [VALMIS, dict(MUDELI_VIGA, deleted=True)]
    assert page_status.count(files, page_status.is_resolved, skip_deleted=False) == 2
    assert page_status.count(files, page_status.is_resolved, skip_deleted=True) == 1


def test_kustutatud_leht_loeb_lahendatuks_kui_poliitika_nii_utleb():
    """Miks `resolved` kustutatud lehti kaasa loeb (upload'i staatuse tee).

    `expected_pages` on väljundlehtede arv. Kui kustutatud leht ei loeks
    lahendatuks, ei jõuaks `resolved >= expected_pages` kunagi täis ja upload
    jääks igaveseks „reviewing" olekusse.
    """
    files = [dict(VALMIS, deleted=True), dict(MUDELI_VIGA, deleted=True)]
    assert page_status.count(files, page_status.is_resolved, skip_deleted=False) == 2


def test_has_ocr_i_ei_loeta_valjaspool_seda_moodulit():
    """Valvur: `has_ocr` KIRJUTAMINE on lubatud, LUGEMINE ainult siin (#261).

    Kolm viga ühel päeval tekkisid täpselt nii: reegel „lahendatud = valmis või
    ebaõnnestunud" oli igas kutsekohas käsitsi kirjutatud, ja üks koht jäi
    parandamata. Väljavõte üksi ei hoia seda ära — järgmine arendaja kirjutab
    `f.get("has_ocr")` uuesti, sest see töötab. Test jõuab sinna, kuhu
    abstraktsioon ei ulatu.

    Kirje EHITAMINE (`"has_ocr": ...`) jääb lubatuks: keegi peab välja täitma.
    """
    import re

    juur = Path(__file__).resolve().parents[1] / "server"
    lugemine = re.compile(r"""\.get\(\s*["']has_ocr|\[\s*["']has_ocr["']\s*\]""")
    leiud = []
    for fail in juur.rglob("*.py"):
        if fail.name == "page_status.py":
            continue
        for nr, rida in enumerate(fail.read_text(encoding="utf-8").splitlines(), 1):
            if rida.strip().startswith("#"):
                continue
            if lugemine.search(rida):
                leiud.append("{}:{}: {}".format(fail.relative_to(juur.parent), nr, rida.strip()))
    assert not leiud, (
        "`has_ocr` lugemine väljaspool page_status.py-d — kasuta is_ready / "
        "is_resolved / is_importable:\n" + "\n".join(leiud))
