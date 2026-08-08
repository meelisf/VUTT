"""300 DPI läbikäik: nimetamine, aatomiline avaldamine, voogedastus."""
import os

import pytest
from PIL import Image

from server.upload import prepress_apply


class FakeSftp:
    """Salvestab put/rename kutsed, et saaks kontrollida .tmp+rename mustrit.

    mkdir käitub nagu PÄRIS SFTP: vanemkaust peab eksisteerima, muidu ENOENT.
    Ilma selleta ei püüdnud test kinni seda, et prepress lõi ainult work-kausta
    ja jättis staging-vanema loomata (tootmisviga 2026-08-08).
    """

    def __init__(self, existing=()):
        self.puts = []
        self.renames = []
        self.dirs = set(existing)
        self.closed = False

    def put(self, local, remote, callback=None):
        parent = remote.rsplit("/", 1)[0]
        if parent not in self.dirs:
            raise FileNotFoundError(2, "No such file", remote)
        self.puts.append(remote)

    def rename(self, src, dst):
        self.renames.append((src, dst))

    def stat(self, path):
        if path not in self.dirs:
            raise FileNotFoundError(path)
        return object()

    def mkdir(self, path):
        parent = path.rsplit("/", 1)[0]
        if parent and parent not in self.dirs:
            raise FileNotFoundError(2, "No such file", path)
        self.dirs.add(path)

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
    sftp = FakeSftp(existing=["/remote"])
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
    sftp = FakeSftp(existing=["/remote"])
    monkeypatch.setattr(prepress_apply.ocr_client, "sftp_open", lambda i: sftp)
    prepress_apply._transfer_pages(
        uid, "kirik-abc", ("/remote", "/remote/w"), "/remote/w", _plan(enabled=True))

    assert sftp.renames == [
        ("/remote/w/kirik-abc_pg_001.jpg.tmp", "/remote/w/kirik-abc_pg_001.jpg"),
        ("/remote/w/kirik-abc_pg_002.jpg.tmp", "/remote/w/kirik-abc_pg_002.jpg"),
        ("/remote/w/kirik-abc_pg_003.jpg.tmp", "/remote/w/kirik-abc_pg_003.jpg"),
        ("/remote/w/kirik-abc_pg_004.jpg.tmp", "/remote/w/kirik-abc_pg_004.jpg"),
        ("/remote/w/kirik-abc_pg_005.jpg.tmp", "/remote/w/kirik-abc_pg_005.jpg"),
        ("/remote/w/kirik-abc_pg_006.jpg.tmp", "/remote/w/kirik-abc_pg_006.jpg"),
    ]


def test_valjajaetud_lehte_ei_renderdata_ega_saadeta(upload, monkeypatch):
    uid, base = upload
    sftp = FakeSftp(existing=["/remote"])
    monkeypatch.setattr(prepress_apply.ocr_client, "sftp_open", lambda i: sftp)
    plan = _plan(enabled=True)
    plan["pages"][1]["excluded"] = True
    prepress_apply._transfer_pages(uid, "s", ("/remote", "/remote/w"), "/remote/w", plan)
    assert len(sftp.renames) == 4     # lehed 1 ja 3 poolitatud, leht 2 välja


def test_ajutised_failid_kustutatakse_kohe(upload, monkeypatch):
    """Voogedastus: kogu teost ei materialiseerita lokaalselt."""
    uid, base = upload
    sftp = FakeSftp(existing=["/remote"])
    monkeypatch.setattr(prepress_apply.ocr_client, "sftp_open", lambda i: sftp)
    prepress_apply._transfer_pages(uid, "s", ("/remote", "/remote/w"), "/remote/w", _plan(enabled=True))
    work = base / "apply_tmp"
    assert not work.exists() or os.listdir(str(work)) == []


def test_poolituse_laius_tuleb_iga_lehe_enda_moodust(upload, monkeypatch):
    """Leht 1 on 400 px, leht 2 on 500 px — cut_px peab erinema."""
    uid, base = upload
    widths = []
    sftp = FakeSftp(existing=["/remote"])
    monkeypatch.setattr(prepress_apply.ocr_client, "sftp_open", lambda i: sftp)
    orig = prepress_apply._write_cut

    def spy(src_img, x0, x1, dst):
        widths.append(x1 - x0)
        return orig(src_img, x0, x1, dst)

    monkeypatch.setattr(prepress_apply, "_write_cut", spy)
    prepress_apply._transfer_pages(uid, "s", ("/remote", "/remote/w"), "/remote/w", _plan(enabled=True))
    assert widths[:4] == [200, 200, 250, 250]


def test_loob_koik_vanemkaustad_enne_saatmist(upload, monkeypatch):
    """REGRESSIOON: work-kaust on staging-kausta ALL. Kui vanemat ei looda,
    annab SFTP mkdir ENOENT ja kogu partii kukub läbi (tootmisviga 2026-08-08)."""
    uid, _base = upload
    # OCR-serveri jälgitav baaskaust on olemas; upload'i omad EI ole.
    sftp = FakeSftp(existing=["/o/AUTO-OCR/hand"])
    monkeypatch.setattr(prepress_apply.ocr_client, "sftp_open", lambda i: sftp)

    prepress_apply._transfer_pages(
        uid, "s", ("/o/AUTO-OCR/hand/u1", "/o/AUTO-OCR/hand/u1/s"),
        "/o/AUTO-OCR/hand/u1/s", _plan(enabled=True),
    )

    assert "/o/AUTO-OCR/hand/u1" in sftp.dirs      # vanem loodi esimesena
    assert "/o/AUTO-OCR/hand/u1/s" in sftp.dirs
    assert len(sftp.renames) == 6


# --- semafori ulatus (#219) ---

def _vaba() -> bool:
    """Kas RENDER_SEMAPHORE on HETKEL vaba? Ei jäta seda kinni hoidma."""
    from server.upload import prepress

    if prepress.RENDER_SEMAPHORE.acquire(blocking=False):
        prepress.RENDER_SEMAPHORE.release()
        return True
    return False


def test_semafor_vabaneb_lehtede_vahel(upload, monkeypatch):
    """REGRESSIOON (#219): semafor võeti varem terve partii ümber, mistõttu
    teise uploadi eelvaade seisis minuteid esimese 300 DPI läbikäigu taga.

    Kaitse eesmärk on üks rasteriseerimine korraga — renderduse AJAL kinni,
    lehtede VAHEL vaba."""
    uid, _base = upload
    sftp = FakeSftp(existing=["/remote"])
    monkeypatch.setattr(prepress_apply.ocr_client, "sftp_open", lambda i: sftp)

    renderdamise_ajal = []
    saatmise_ajal = []

    orig_render = prepress_apply.page_source.ImageDirPageSource.render_full

    def spy_render(self, n, dst):
        renderdamise_ajal.append(_vaba())
        return orig_render(self, n, dst)

    orig_publish = prepress_apply.publish_atomic

    def spy_publish(sftp_, local, remote):
        saatmise_ajal.append(_vaba())
        return orig_publish(sftp_, local, remote)

    monkeypatch.setattr(
        prepress_apply.page_source.ImageDirPageSource, "render_full", spy_render
    )
    monkeypatch.setattr(prepress_apply, "publish_atomic", spy_publish)

    prepress_apply._transfer_pages(
        uid, "s", ("/remote", "/remote/w"), "/remote/w", _plan(enabled=True)
    )

    assert renderdamise_ajal == [False, False, False], "renderduse ajal peab kinni olema"
    assert saatmise_ajal and all(saatmise_ajal), "SFTP ootel ei tohi semafori hoida"
    assert _vaba(), "semafor peab pärast partiid vaba olema"
