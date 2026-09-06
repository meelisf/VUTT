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


# ---------------------------------------------------------------------------
# 4. Rollihierarhia: backend ↔ frontend
# ---------------------------------------------------------------------------

def test_rollihierarhia_kattub_frontendiga():
    """Sama järjestus kahes keeles. Frontend on MUGAVUS, backend on turve —
    aga lahknedes valetab UI: peidab nupu, mille backend lubaks, või näitab
    nuppu, mille backend keelab (kasutaja saab veateate, mitte selgituse).
    """
    from server.auth import ROLE_HIERARCHY

    ts = _loe("src/utils/roleUtils.ts")
    plokk = re.search(r"ROLE_LEVELS[^=]*=\s*\{(.*?)\}", ts, re.S)
    assert plokk, "roleUtils.ts-st ei leitud ROLE_LEVELS-i"
    fe = {m.group(1): int(m.group(2))
          for m in re.finditer(r"(\w+)\s*:\s*(\d+)", plokk.group(1))}
    assert fe == ROLE_HIERARCHY, (
        "rollihierarhiad lahknevad:\n  backend : {}\n  frontend: {}".format(
            ROLE_HIERARCHY, fe))


# ---------------------------------------------------------------------------
# 5. Upload'i staatuse sõnavara: kes kirjutab ↔ kes klassifitseerib
# ---------------------------------------------------------------------------

def test_frontend_klassifitseerib_iga_upload_staatuse():
    """Klassifitseerimata staatus = upload muutub VAIKSELT mittejätkatavaks.

    Ei viga, ei logi — „Jätka" nupp lihtsalt kaob ja töö jääb rippu. Just see
    vaikne kuju teeb sellest #261 juhtumi, mitte lärmaka failinime-konventsiooni.
    """
    from server.upload import state as upload_state

    ts = _loe("src/pages/upload/constants.ts")
    def loend(nimi):
        m = re.search(nimi + r"\s*(?::[^=]*)?=\s*\[(.*?)\]", ts, re.S)
        assert m, "constants.ts-st ei leitud loendit {}".format(nimi)
        return set(re.findall(r"['\"]([a-z_]+)['\"]", m.group(1)))

    kaetud = loend("RESUMABLE_STATUSES") | loend("ADA_TRANSFER_STATUSES") | {"error", "imported"}
    katmata = set(upload_state.ALL_STATUSES) - kaetud
    assert not katmata, (
        "backend võib kirjutada staatuse, mida frontend ei klassifitseeri: {}".format(
            sorted(katmata)))
