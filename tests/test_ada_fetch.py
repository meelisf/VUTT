"""ADA allalaadimise leping: idempotentsus, .part, katkestus, restart."""
import json
import os
import shutil
import subprocess

import pytest

from server.ada import fetch
from server.upload import state as upload_state


@pytest.fixture
def upload(tmp_path, monkeypatch):
    monkeypatch.setattr(upload_state, "UPLOADS_DIR", str(tmp_path), raising=False)
    monkeypatch.setattr(fetch.upload_state, "UPLOADS_DIR", str(tmp_path), raising=False)
    # `taasta_rippuvad_fetchid` loeb UPLOADS_DIR-i fetch.py enda moodulitasandi
    # nimena (otse ..config-ist imporditud) — mitte upload_state'i kaudu.
    # Ilma selleta skaneeriks test PÄRIS uploads-kausta ja läbiks nii või naa.
    monkeypatch.setattr(fetch, "UPLOADS_DIR", str(tmp_path), raising=False)
    uid = "adaupl01"
    (tmp_path / uid).mkdir()
    state = {"id": uid, "status": "pending", "meta": {"slug": "test-abc"}, "files": [],
             "ada": {"handle": "10062/7822", "item_uuid": "u", "sources": []}}
    (tmp_path / uid / "state.json").write_text(json.dumps(state), encoding="utf-8")
    return uid


def _status(tmp_path, uid):
    return json.loads((tmp_path / uid / "state.json").read_text(encoding="utf-8"))["status"]


@pytest.fixture
def loimed(monkeypatch):
    """Püüab kinni käivitatud lõimed — päris töölõim kirjutaks tmp_path'ist VÄLJA."""
    kaivitatud = []

    class FakeThread:
        def __init__(self, *a, **k):
            kaivitatud.append(k)

        def start(self):
            pass

    monkeypatch.setattr(fetch.threading, "Thread", FakeThread)
    return kaivitatud


# --- F1: idempotentsus ---
# `loimed` asendab töölõime — need testid kontrollivad CAS-i, mitte workerit
# (`_toota` behaviour on eraldi testitud otsekutsega allpool). Ilma selleta
# jookseks päris taustalõim, väljuks monkeypatch'itud tmp_path'ist ja
# kirjutaks päris uploads-kausta pärast testi lõppu (vt task-6-report.md Fix 1).

def test_teine_fetch_ei_kaivita_teist_toolim(upload, tmp_path, loimed):
    assert fetch.alusta_fetchi(upload) is True
    assert _status(tmp_path, upload) == "ada_fetching"
    assert len(loimed) == 1
    assert fetch.alusta_fetchi(upload) is False
    assert len(loimed) == 1


def test_fetch_saab_alata_ada_error_seisust(upload, tmp_path, loimed):
    upload_state.set_upload_state(upload, status="ada_error")
    assert fetch.alusta_fetchi(upload) is True
    assert len(loimed) == 1


def test_fetch_ei_saa_alata_awaiting_split_seisust(upload, loimed):
    """Fail on juba kohal — kordus kirjutaks source.pdf-i üle."""
    upload_state.set_upload_state(upload, status="awaiting_split")
    assert fetch.alusta_fetchi(upload) is False
    assert len(loimed) == 0


def test_kaivitatud_loim_on_oige_sihtmark_ja_daemon(upload, tmp_path, loimed):
    """Loeb ainult `name`-argumenti kontrollimine ei märkaks, kui vale
    funktsioon käivitataks või lõim jääks ei-daemon'iks (protsess ei sureks)."""
    assert fetch.alusta_fetchi(upload) is True
    assert len(loimed) == 1
    kwargs = loimed[0]
    assert kwargs.get("target") is fetch._toota
    assert kwargs.get("daemon") is True
    assert kwargs.get("args") == (upload,)


# --- F2: .part ---

def test_katkenud_allalaadimine_ei_jata_valmis_naivat_faili(tmp_path, monkeypatch):
    siht = str(tmp_path / "017.pdf")

    class KatkevVastus:
        status_code = 200
        headers = {}

        def iter_content(self, chunk_size):
            yield b"x" * 10
            raise IOError("ühendus katkes")

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(fetch.requests, "get", lambda *a, **k: KatkevVastus())
    with pytest.raises(IOError):
        fetch.laadi_tykk("https://ada/x", siht, 100)
    assert not os.path.exists(siht)


def test_vale_suurus_ei_saa_valmis_nime(tmp_path, monkeypatch):
    """Sisu tuli lõpuni, aga baite on vähem kui bitstream lubas."""
    siht = str(tmp_path / "018.pdf")

    class LyhikeVastus:
        status_code = 200
        headers = {}

        def iter_content(self, chunk_size):
            yield b"x" * 10

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(fetch.requests, "get", lambda *a, **k: LyhikeVastus())
    with pytest.raises(fetch.AdaFetchViga):
        fetch.laadi_tykk("https://ada/x", siht, 100)
    assert not os.path.exists(siht)


def test_teadmata_suurusega_tykki_ei_aktsepteerita(tmp_path, monkeypatch):
    """I1: ADA ei andnud sizeBytes'i (0 või puudu — client.py teeb sellest 0).
    Suuruse kontroll EI TOHI seda vaikimisi läbi lasta — tundmatu suurus
    tähendab, et terviklikkust ei saa kontrollida, mitte et kontroll on OK."""
    siht = str(tmp_path / "021.pdf")

    class Vastus:
        status_code = 200
        headers = {}

        def iter_content(self, chunk_size):
            yield b"x" * 100  # sisu tuli täies mahus — ainult suurus on teadmata

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(fetch.requests, "get", lambda *a, **k: Vastus())
    with pytest.raises(fetch.AdaFetchViga):
        fetch.laadi_tykk("https://ada/x", siht, 0)
    assert not os.path.exists(siht)


def test_terve_allalaadimine_saab_valmis_nime(tmp_path, monkeypatch):
    siht = str(tmp_path / "019.pdf")

    class TerveVastus:
        status_code = 200
        headers = {}

        def iter_content(self, chunk_size):
            yield b"x" * 100

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    monkeypatch.setattr(fetch.requests, "get", lambda *a, **k: TerveVastus())
    fetch.laadi_tykk("https://ada/x", siht, 100)
    assert os.path.getsize(siht) == 100
    assert not os.path.exists(siht + ".part")


def test_juba_olemas_olevat_tykki_ei_tommata_uuesti(tmp_path, monkeypatch):
    siht = tmp_path / "020.pdf"
    siht.write_bytes(b"y" * 100)
    monkeypatch.setattr(fetch.requests, "get",
                        lambda *a, **k: pytest.fail("ei tohi uuesti tõmmata"))
    fetch.laadi_tykk("https://ada/x", str(siht), 100)


# --- liitmine ---

def test_liida_pdfid_kutsub_pdfunite_sorditud_jarjekorras(tmp_path, monkeypatch):
    kaust = tmp_path / "ada"
    kaust.mkdir()
    for n in ("003.pdf", "001.pdf", "002.pdf"):
        (kaust / n).write_bytes(b"%PDF-1.4\n")
    kutsed = []
    monkeypatch.setattr(fetch.subprocess, "run",
                        lambda cmd, **k: kutsed.append(cmd) or subprocess.CompletedProcess(cmd, 0))
    fetch.liida_pdfid(str(kaust), str(tmp_path / "source.pdf"), 3)
    cmd = kutsed[0]
    assert cmd[0] == "pdfunite"
    assert [os.path.basename(p) for p in cmd[1:-1]] == ["001.pdf", "002.pdf", "003.pdf"]


def test_liida_pdfid_ei_kaasa_vanema_katse_jaanukit(tmp_path, monkeypatch):
    """Kõrgema numbriga tükk eelmisest (rohkem allikatega) katsest ei tohi
    dokumenti sattuda — nimekiri tuleb ALLIKATE ARVUST, mitte kausta sisust."""
    kaust = tmp_path / "ada"
    kaust.mkdir()
    for n in ("001.pdf", "002.pdf", "004.pdf"):
        (kaust / n).write_bytes(b"%PDF-1.4\n")
    kutsed = []
    monkeypatch.setattr(fetch.subprocess, "run",
                        lambda cmd, **k: kutsed.append(cmd) or subprocess.CompletedProcess(cmd, 0))
    fetch.liida_pdfid(str(kaust), str(tmp_path / "source.pdf"), 2)
    cmd = kutsed[0]
    assert [os.path.basename(p) for p in cmd[1:-1]] == ["001.pdf", "002.pdf"]


def test_liitmine_ei_kasuta_keelatud_tooriistu(tmp_path, monkeypatch):
    """qpdf / pdftk / pypdf EI OLE backend-konteineris olemas."""
    kaust = tmp_path / "ada"
    kaust.mkdir()
    (kaust / "001.pdf").write_bytes(b"%PDF-1.4\n")
    kutsed = []
    monkeypatch.setattr(fetch.subprocess, "run",
                        lambda cmd, **k: kutsed.append(cmd) or subprocess.CompletedProcess(cmd, 0))
    fetch.liida_pdfid(str(kaust), str(tmp_path / "source.pdf"), 1)
    assert all(c[0] not in ("qpdf", "pdftk") for c in kutsed)


# --- F3 + restart ---

def test_tohib_jatkata_valeks_kui_staging_kustutatud(upload, tmp_path):
    """Puhas ühiku-test primitiivile endale (ei kutsu workerit)."""
    shutil.rmtree(tmp_path / upload)
    assert fetch.tohib_jatkata(upload) is False


def test_toota_ei_tekita_kustutatud_stagingut_uuesti(upload, tmp_path):
    """F3, päris worker: staging kustutatud ENNE `_toota` esimest lauset —
    `os.makedirs(..., exist_ok=True)` ei tohi kaustu (koos vanemaga) uuesti
    tekitada. Ilma tohib_jatkata-kontrollita enne makedirs'i tekiks siia
    nähtamatu (state.json-ita) orb-kaust, kuhu allalaadimine jätkuks."""
    shutil.rmtree(tmp_path / upload)
    fetch._toota(upload)
    assert not os.path.exists(tmp_path / upload)


def test_restardi_taaste_margib_rippuva_too_veaks(upload, tmp_path):
    upload_state.set_upload_state(upload, status="ada_fetching")
    fetch.taasta_rippuvad_fetchid()
    assert _status(tmp_path, upload) == "ada_error"


# --- _toota otsetest (I3): FakeThread ei kutsu kunagi target'it ---

def test_toota_taidab_lehepiirid_ja_expected_pages_on_liidetud_arv(upload, tmp_path, monkeypatch):
    """first_src_page akumuleerub 1-baasiliselt ÜLE allikate ja expected_pages
    on LIIDETUD PDF-i lehtede arv — MITTE allikate (failide) arv. Fixture'i
    numbrid (4, 2, 3 → kokku 9) valitud nii, et need kaks tõesti erineksid ja
    väär implementatsioon (nt expected_pages=len(allikad)=3) jääks vahele."""
    allikad = [
        {"bitstream_uuid": "a", "size_bytes": 10, "name": "001.pdf"},
        {"bitstream_uuid": "b", "size_bytes": 20, "name": "002.pdf"},
        {"bitstream_uuid": "c", "size_bytes": 30, "name": "003.pdf"},
    ]
    upload_state.set_upload_state(
        upload, ada={"handle": "10062/7822", "item_uuid": "u", "sources": allikad}
    )

    tyki_lehed = {"001.pdf": 4, "002.pdf": 2, "003.pdf": 3}

    def fake_laadi_tykk(url, siht, oodatud):
        pass  # allalaadimine on eraldi testitud (F2) — siin ei minda võrku

    def fake_liida_pdfid(kaust, sihtfail, arv_tykke):
        pass  # liitmine on eraldi testitud

    def fake_lehtede_arv(pdf_path):
        nimi = os.path.basename(pdf_path)
        if nimi in tyki_lehed:
            return tyki_lehed[nimi]
        return sum(tyki_lehed.values())  # liidetud source.pdf küsimine

    monkeypatch.setattr(fetch, "laadi_tykk", fake_laadi_tykk)
    monkeypatch.setattr(fetch, "liida_pdfid", fake_liida_pdfid)
    monkeypatch.setattr(fetch, "lehtede_arv", fake_lehtede_arv)

    fetch._toota(upload)

    s = upload_state.read_state(upload)
    assert s["status"] == "awaiting_split"
    assert s["expected_pages"] == 9
    assert s["expected_pages"] != len(allikad)
    assert [a["first_src_page"] for a in s["ada"]["sources"]] == [1, 5, 7]
    assert [a["page_count"] for a in s["ada"]["sources"]] == [4, 2, 3]


def test_toota_katkestus_looke_ja_liitmise_vahel_ei_liida_ega_kirjuta(upload, tmp_path, monkeypatch):
    """F3: staging kustub PÄRAST allalaadimistsüklit, aga ENNE liitmist
    (nt kasutaja vajutab „Katkesta" täpselt siis). `_toota` peab selle
    kontrolli-punktis märkama ja mitte liitma ega olekut kirjutama."""
    allikad = [{"bitstream_uuid": "a", "size_bytes": 10, "name": "001.pdf"}]
    upload_state.set_upload_state(
        upload, ada={"handle": "10062/7822", "item_uuid": "u", "sources": allikad}
    )

    def fake_laadi_tykk(url, siht, oodatud):
        pass

    liida_kutsutud = []

    def fake_liida_pdfid(kaust, sihtfail, arv_tykke):
        liida_kutsutud.append(True)

    monkeypatch.setattr(fetch, "laadi_tykk", fake_laadi_tykk)
    monkeypatch.setattr(fetch, "liida_pdfid", fake_liida_pdfid)

    orig_tohib_jatkata = fetch.tohib_jatkata
    kutsete_arv = {"n": 0}

    def fake_tohib_jatkata(uid):
        kutsete_arv["n"] += 1
        # Kutsed: 1) enne makedirs'i, 2) tsükli sees (1 allikas), 3) TSÜKLI
        # JÄREL, ENNE liitmist. Kustutame just siin, et simuleerida katkestust
        # täpselt loogi-ja-liitmise vahelises aknas.
        if kutsete_arv["n"] == 3:
            shutil.rmtree(tmp_path / uid, ignore_errors=True)
        return orig_tohib_jatkata(uid)

    monkeypatch.setattr(fetch, "tohib_jatkata", fake_tohib_jatkata)

    fetch._toota(upload)

    assert liida_kutsutud == []
    assert not (tmp_path / upload).exists()
