"""Kaugkoristus ei tohi kukutada OCR-teenust (#225).

OCR-serveri `process_batch` kirjutab .txt ilma veakäsitluseta ja `main_loop` ei
püüa seda — kataloogi kustutamine lennusoleva batchi alt annab FileNotFoundError,
mis propageerub mooduli tasemel `sys.exit(1)`-ni. Seepärast: failid kohe,
kataloog hiljem.
"""
import pytest

from server import ocr_reaper
from server.upload import ocr_client


class FakeSftp:
    def __init__(self, tree):
        self.tree = dict(tree)      # {kaust: [failinimed]}
        self.removed = []
        self.rmdirs = []

    def listdir(self, path):
        if path not in self.tree:
            raise FileNotFoundError(path)
        return list(self.tree[path])

    def remove(self, path):
        self.removed.append(path)

    def rmdir(self, path):
        self.rmdirs.append(path)


def test_koristus_kustutab_failid():
    sftp = FakeSftp({"/o/run1": ["a.jpg", "a.txt", "b.jpg"]})
    assert ocr_client.cleanup_run_files(sftp, "/o/run1") is True
    assert sorted(sftp.removed) == ["/o/run1/a.jpg", "/o/run1/a.txt", "/o/run1/b.jpg"]


def test_koristus_EI_KUSTUTA_kataloogi():
    """KRIITILINE (#225): rmdir lennusoleva batchi alt kukutab OCR-teenuse."""
    sftp = FakeSftp({"/o/run1": ["a.jpg"]})
    ocr_client.cleanup_run_files(sftp, "/o/run1")
    assert sftp.rmdirs == [], "kataloogi ei tohi siin eemaldada"


def test_puuduv_kataloog_ei_ole_viga():
    """Intsidendi kuju: kaust on juba kadunud."""
    sftp = FakeSftp({})
    assert ocr_client.cleanup_run_files(sftp, "/o/puudub") is True


def test_uksiku_faili_torge_annab_false():
    class Torkuv(FakeSftp):
        def remove(self, path):
            raise OSError("permission denied")

    sftp = Torkuv({"/o/run1": ["a.jpg"]})
    assert ocr_client.cleanup_run_files(sftp, "/o/run1") is False


# --- reaper ---

@pytest.fixture(autouse=True)
def reaps_fail(tmp_path, monkeypatch):
    monkeypatch.setattr(ocr_reaper, "OCR_RUN_REAPS_FILE", str(tmp_path / "reaps.json"))


def test_ajastatud_kataloog_eemaldatakse_alles_armuaja_jarel():
    ocr_reaper.schedule_reap("/o/run1", now=1000.0)
    kustutatud = []

    # Armuaeg pole täis
    n = ocr_reaper.reap_due(lambda p: kustutatud.append(p), now=1000.0 + 599)
    assert n == 0 and kustutatud == []

    # Armuaeg täis
    n = ocr_reaper.reap_due(lambda p: kustutatud.append(p), now=1000.0 + 601)
    assert n == 1 and kustutatud == ["/o/run1"]


def test_eemaldatud_kataloogi_ei_proovita_uuesti():
    ocr_reaper.schedule_reap("/o/run1", now=1000.0)
    ocr_reaper.reap_due(lambda p: None, now=2000.0)
    assert ocr_reaper.reap_due(lambda p: pytest.fail("teist korda ei tohi"), now=3000.0) == 0


def test_torge_jatab_kirje_alles_uueks_katseks():
    ocr_reaper.schedule_reap("/o/run1", now=1000.0)

    def _boom(path):
        raise RuntimeError("SSH maas")

    assert ocr_reaper.reap_due(_boom, now=2000.0) == 0
    kustutatud = []
    assert ocr_reaper.reap_due(lambda p: kustutatud.append(p), now=3000.0) == 1
    assert kustutatud == ["/o/run1"]


def test_sama_tee_ei_dubleeru():
    ocr_reaper.schedule_reap("/o/run1", now=1000.0)
    ocr_reaper.schedule_reap("/o/run1", now=1010.0)
    kustutatud = []
    ocr_reaper.reap_due(lambda p: kustutatud.append(p), now=5000.0)
    assert kustutatud == ["/o/run1"]


def test_ajastatud_kataloog_on_markitud_kuni_eemaldamiseni():
    """Taastereaper peab ajastatud katalooge vahele jätma: sinna maandunud .txt
    kuulub KATKESTATUD tööle, mitte orvule."""
    ocr_reaper.schedule_reap("/o/AUTO-OCR/print/job1", now=1000.0)
    assert ocr_reaper.is_scheduled("/o/AUTO-OCR/print/job1") is True
    assert ocr_reaper.is_scheduled("/o/AUTO-OCR/print/job2") is False

    ocr_reaper.reap_due(lambda p: None, now=5000.0)
    assert ocr_reaper.is_scheduled("/o/AUTO-OCR/print/job1") is False
