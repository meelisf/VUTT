"""300 DPI läbikäik: nimetamine, aatomiline avaldamine, voogedastus."""
import os

import pytest
from PIL import Image

from server.upload import prepress_apply


class FakeSftp:
    """Salvestab put/rename kutsed, et saaks kontrollida .tmp+rename mustrit."""

    def __init__(self):
        self.puts = []
        self.renames = []
        self.closed = False

    def put(self, local, remote, callback=None):
        self.puts.append(remote)

    def rename(self, src, dst):
        self.renames.append((src, dst))

    def stat(self, path):
        raise FileNotFoundError(path)

    def mkdir(self, path):
        pass

    def close(self):
        self.closed = True


# --- nimetamine ---

def test_remote_page_name_on_ocr_serveri_konventsioonis():
    """OCR-server leiab pildid rglob-iga; nimi peab järgima {slug}_pg_NNN.jpg."""
    assert prepress_apply.remote_page_name("kirik-abc", 1) == "kirik-abc_pg_001.jpg"
    assert prepress_apply.remote_page_name("kirik-abc", 42) == "kirik-abc_pg_042.jpg"
    assert prepress_apply.remote_page_name("kirik-abc", 1234) == "kirik-abc_pg_1234.jpg"


# --- aatomiline avaldamine ---

def test_publish_atomic_laeb_tmp_nimega_ja_nimetab_ymber(tmp_path):
    """OCR-serveri valvuril EI OLE piltidele stabiilsuskontrolli
    (wait_for_file_stable kutsutakse ainult PDF-ide peale). Poolik JPG satuks
    OCR-i. .jpg.tmp jääb valvuri EXTENSIONS filtrist välja."""
    local = tmp_path / "a.jpg"
    local.write_bytes(b"jpeg")
    sftp = FakeSftp()
    prepress_apply.publish_atomic(sftp, str(local), "/remote/x_pg_001.jpg")
    assert sftp.puts == ["/remote/x_pg_001.jpg.tmp"]
    assert sftp.renames == [("/remote/x_pg_001.jpg.tmp", "/remote/x_pg_001.jpg")]


# --- voogedastus ---

@pytest.fixture
def upload(tmp_path, monkeypatch):
    """Kolme lehega pildikaust lähteallikaks."""
    uid = "u1"
    base = tmp_path / uid
    src = base / "source"
    src.mkdir(parents=True)
    for n, width in enumerate([400, 500, 400], start=1):
        Image.new("RGB", (width, 300), "white").save(src / "pg_{:03d}.jpg".format(n))
    monkeypatch.setattr(
        prepress_apply.upload_state, "upload_dir", lambda i: str(base)
    )
    monkeypatch.setattr(prepress_apply.prepress, "source_path", lambda i: str(src))
    return uid, base


def _plan(**over):
    from server.upload import prepress_plan
    plan = prepress_plan.default_plan(3)
    plan.update(over)
    return plan


def test_poolitatud_lehed_saadetakse_vasak_parem_jarjekorras(upload, monkeypatch):
    uid, base = upload
    sftp = FakeSftp()
    monkeypatch.setattr(prepress_apply.ocr_client, "sftp_open", lambda i: sftp)
    prepress_apply._transfer_pages(uid, "kirik-abc", "/remote", _plan(enabled=True))

    assert sftp.renames == [
        ("/remote/kirik-abc_pg_001.jpg.tmp", "/remote/kirik-abc_pg_001.jpg"),
        ("/remote/kirik-abc_pg_002.jpg.tmp", "/remote/kirik-abc_pg_002.jpg"),
        ("/remote/kirik-abc_pg_003.jpg.tmp", "/remote/kirik-abc_pg_003.jpg"),
        ("/remote/kirik-abc_pg_004.jpg.tmp", "/remote/kirik-abc_pg_004.jpg"),
        ("/remote/kirik-abc_pg_005.jpg.tmp", "/remote/kirik-abc_pg_005.jpg"),
        ("/remote/kirik-abc_pg_006.jpg.tmp", "/remote/kirik-abc_pg_006.jpg"),
    ]


def test_valjajaetud_lehte_ei_renderdata_ega_saadeta(upload, monkeypatch):
    uid, base = upload
    sftp = FakeSftp()
    monkeypatch.setattr(prepress_apply.ocr_client, "sftp_open", lambda i: sftp)
    plan = _plan(enabled=True)
    plan["pages"][1]["excluded"] = True
    prepress_apply._transfer_pages(uid, "s", "/remote", plan)
    assert len(sftp.renames) == 4     # lehed 1 ja 3 poolitatud, leht 2 välja


def test_ajutised_failid_kustutatakse_kohe(upload, monkeypatch):
    """Voogedastus: kogu teost ei materialiseerita lokaalselt."""
    uid, base = upload
    sftp = FakeSftp()
    monkeypatch.setattr(prepress_apply.ocr_client, "sftp_open", lambda i: sftp)
    prepress_apply._transfer_pages(uid, "s", "/remote", _plan(enabled=True))
    work = base / "apply_tmp"
    assert not work.exists() or os.listdir(str(work)) == []


def test_poolituse_laius_tuleb_iga_lehe_enda_moodust(upload, monkeypatch):
    """Leht 1 on 400 px, leht 2 on 500 px — cut_px peab erinema."""
    uid, base = upload
    widths = []
    sftp = FakeSftp()
    monkeypatch.setattr(prepress_apply.ocr_client, "sftp_open", lambda i: sftp)
    orig = prepress_apply._write_cut

    def spy(src_img, x0, x1, dst):
        widths.append(x1 - x0)
        return orig(src_img, x0, x1, dst)

    monkeypatch.setattr(prepress_apply, "_write_cut", spy)
    prepress_apply._transfer_pages(uid, "s", "/remote", _plan(enabled=True))
    assert widths[:4] == [200, 200, 250, 250]
