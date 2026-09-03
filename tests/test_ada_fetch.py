"""ADA allalaadimise leping: idempotentsus, .part, katkestus, restart."""
import json
import os
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


# --- F1: idempotentsus ---

def test_teine_fetch_ei_kaivita_teist_toolim(upload, tmp_path):
    assert fetch.alusta_fetchi(upload) is True
    assert _status(tmp_path, upload) == "ada_fetching"
    assert fetch.alusta_fetchi(upload) is False


def test_fetch_saab_alata_ada_error_seisust(upload, tmp_path):
    upload_state.set_upload_state(upload, status="ada_error")
    assert fetch.alusta_fetchi(upload) is True


def test_fetch_ei_saa_alata_awaiting_split_seisust(upload):
    """Fail on juba kohal — kordus kirjutaks source.pdf-i üle."""
    upload_state.set_upload_state(upload, status="awaiting_split")
    assert fetch.alusta_fetchi(upload) is False


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
    fetch.liida_pdfid(str(kaust), str(tmp_path / "source.pdf"))
    cmd = kutsed[0]
    assert cmd[0] == "pdfunite"
    assert [os.path.basename(p) for p in cmd[1:-1]] == ["001.pdf", "002.pdf", "003.pdf"]


def test_liitmine_ei_kasuta_keelatud_tooriistu(tmp_path, monkeypatch):
    """qpdf / pdftk / pypdf EI OLE backend-konteineris olemas."""
    kaust = tmp_path / "ada"
    kaust.mkdir()
    (kaust / "001.pdf").write_bytes(b"%PDF-1.4\n")
    kutsed = []
    monkeypatch.setattr(fetch.subprocess, "run",
                        lambda cmd, **k: kutsed.append(cmd) or subprocess.CompletedProcess(cmd, 0))
    fetch.liida_pdfid(str(kaust), str(tmp_path / "source.pdf"))
    assert all(c[0] not in ("qpdf", "pdftk") for c in kutsed)


# --- F3 + restart ---

def test_katkestus_peatab_workeri(upload, tmp_path):
    """Staging kustutatud → worker EI TOHI kataloogi uuesti tekitada."""
    import shutil
    shutil.rmtree(tmp_path / upload)
    assert fetch.tohib_jatkata(upload) is False


def test_restardi_taaste_margib_rippuva_too_veaks(upload, tmp_path):
    upload_state.set_upload_state(upload, status="ada_fetching")
    fetch.taasta_rippuvad_fetchid()
    assert _status(tmp_path, upload) == "ada_error"
