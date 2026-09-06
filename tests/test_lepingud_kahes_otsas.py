"""Väärtused, mis PEAVAD kahes otsas kokku langema (#261, punkt 4).

Siia kuuluvad ainult need paarid, kus **väljavõte ei ole võimalik**: pooled
elavad eri keeltes, eri protsessides või eri masinates, nii et ühist konstanti
ei saa olla. Kui väljavõte on võimalik, tee väljavõte — vt
`server/upload/page_status.py` (#261 punkt 1) ja `server/ocr_err.py`.

Dokumentatsioon („muuda MÕLEMAT") ei jõusta midagi — ta teeb inimesest lintri.
Iga siinne test on kontrollitud mutatsiooniga: mõlema poole muutmine eraldi
kukutab ta.
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

JUUR = Path(__file__).resolve().parents[1]


def _loe(suhteline: str) -> str:
    return (JUUR / suhteline).read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# 1. VUTT-i renderdus ↔ OCR-serveri renderdus
# ---------------------------------------------------------------------------

def test_dpi_ja_kvaliteet_kattuvad_ocr_serveriga():
    """VUTT materialiseerib lehed ise (ADR 0028) — pilt peab tulema SAMASUGUNE.

    Kui pooled lahknevad, ei ole tulemus viga, vaid kahe eri kvaliteediga
    pildiga korpus: sama teos näeb erinev välja sõltuvalt sellest, kumba teed
    ta tuli. Vaikne ja tagantjärele parandamatu ilma reOCR-ita.

    `tests/test_page_source.py` kontrollib, et VUTT käsurida KANNAB neid
    väärtusi; see test kontrollib, et need on OCR-serveri omadega SAMAD.
    """
    from server.upload import page_source

    loss = _loe("loss/kataloogi-jalgimine-ja-ocr.py")

    dpi = re.search(r"^PDF_DPI\s*=\s*(\d+)", loss, re.M)
    assert dpi, "loss-skriptist ei leitud PDF_DPI-d — kas konstant nimetati ümber?"
    assert page_source.FULL_DPI == int(dpi.group(1)), (
        "FULL_DPI={} vs OCR-serveri PDF_DPI={}".format(
            page_source.FULL_DPI, dpi.group(1)))

    kvaliteet = re.search(r"\.save\([^)]*quality\s*=\s*(\d+)", loss)
    assert kvaliteet, "loss-skriptist ei leitud JPEG kvaliteeti"
    assert page_source.JPEG_QUALITY == int(kvaliteet.group(1)), (
        "JPEG_QUALITY={} vs OCR-serveri quality={}".format(
            page_source.JPEG_QUALITY, kvaliteet.group(1)))


# ---------------------------------------------------------------------------
# 2. Kaanepildi versioon: server ↔ frontend
# ---------------------------------------------------------------------------

def test_cover_version_kattub_frontendiga():
    """Number on cache-buster: server nimetab faili, frontend küsib URL-i.

    Ainult ühe otsa tõstmine ei anna viga — annab vaikselt vale pildi.
    Kas server genereerib uue kaane, mida keegi ei küsi, või frontend küsib
    versiooni, mida serveril ei ole ja mis lahendub vanaks pildiks.
    """
    from server import image_server

    ts = _loe("src/services/workImageService.ts")
    m = re.search(r"const\s+COVER_VERSION\s*=\s*(\d+)", ts)
    assert m, "workImageService.ts-st ei leitud COVER_VERSION-it"
    assert image_server.COVER_VERSION == int(m.group(1)), (
        "image_server.COVER_VERSION={} vs workImageService.ts={}".format(
            image_server.COVER_VERSION, m.group(1)))


# ---------------------------------------------------------------------------
# 3. CSP kahel nginx-real
# ---------------------------------------------------------------------------

def test_csp_kaks_rida_on_identsed():
    """`add_header` ja `more_set_headers` peavad kandma SAMA poliitikat.

    Kaks rida on olemas sellepärast, et `add_header` kaob nginx-is ära niipea,
    kui alamblokk lisab oma `add_header`-i; `more_set_headers` katab need
    juhud. Lahknedes kehtib eri teedel eri poliitika — ja see, kumb kehtib,
    sõltub location-blokist, mitte kavatsusest.

    PIIR: see test võrdleb REPO KOOPIA kahte rida. Hostis olev aktiivne
    konfiguratsioon (`/etc/nginx/sites-available/vutt`) ei ole gitis ja siit
    näha ei ole — repo ja hosti lahknemine jääb inimese kanda (vt CLAUDE.md).
    """
    conf = _loe("nginx.host.conf")

    a = re.search(r'add_header\s+Content-Security-Policy\s+"(.*?)"\s+always;', conf, re.S)
    b = re.search(r'more_set_headers\s+"Content-Security-Policy:\s*(.*?)";', conf, re.S)
    assert a, "nginx.host.conf-ist ei leitud add_header CSP-d"
    assert b, "nginx.host.conf-ist ei leitud more_set_headers CSP-d"
    assert a.group(1).strip() == b.group(1).strip(), (
        "CSP read lahknevad:\n  add_header     : {}\n  more_set_headers: {}".format(
            a.group(1).strip(), b.group(1).strip()))
