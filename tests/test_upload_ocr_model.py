"""OCR-mudel on töötlusotsus, mitte bibliograafiline väide (spekk §3)."""
import threading

import pytest

from server.upload import state as upload_state


@pytest.fixture
def upload(tmp_path, monkeypatch):
    uid = "u1"
    base = tmp_path / uid
    base.mkdir()
    monkeypatch.setattr(upload_state, "upload_dir", lambda i: str(base))
    upload_state.write_state(uid, {
        "id": uid, "status": "awaiting_split",
        "ocr_model": "print",
        "meta": {"slug": "kirik-abc", "type": {"id": "Q1261026", "label": "trükis"}},
        "remote_staging_path": "AUTO-OCR/print/u1",
        "remote_work_path": "AUTO-OCR/print/u1/kirik-abc",
    })
    return uid


def test_vahetus_muudab_molemad_kaugteed(upload):
    assert upload_state.try_set_ocr_model(upload, "hand") is True
    s = upload_state.read_state(upload)
    assert s["ocr_model"] == "hand"
    assert s["remote_staging_path"] == "AUTO-OCR/hand/u1"
    assert s["remote_work_path"] == "AUTO-OCR/hand/u1/kirik-abc"


def test_vahetus_EI_PUUDU_meta_tyupi(upload):
    """Vaikne tüübimuutus jõuaks impordiga _metadata.json-i ja sealt Meilisse."""
    upload_state.try_set_ocr_model(upload, "hand")
    assert upload_state.read_state(upload)["meta"]["type"]["id"] == "Q1261026"


def test_vahetus_on_lubatud_ka_eelvaate_ajal(upload):
    upload_state.set_upload_state(upload, status="prepping")
    assert upload_state.try_set_ocr_model(upload, "hand") is True


# `uploading` on siit VÄLJAS: backend ei kirjuta seda kunagi `state.json`-i
# (frontendi-sisene olek, #314). Ülejäänud neli on päris staatused ja kaitstav
# omadus on nagunii sama — `MODEL_CHANGE_STATUSES` lubab ainult kolme.
@pytest.mark.parametrize("status", ["applying", "processing",
                                    "reviewing", "imported"])
def test_vahetus_pole_lubatud_parast_apply_algust(upload, status):
    """Mudelit tohib muuta, kuni ükski OCR-input fail ei ole kaugserveris."""
    upload_state.set_upload_state(upload, status=status)
    assert upload_state.try_set_ocr_model(upload, "hand") is False


def test_tundmatu_mudel_ei_muuda_midagi(upload):
    assert upload_state.try_set_ocr_model(upload, "kuutõbi") is False
    assert upload_state.read_state(upload)["ocr_model"] == "print"


def test_apply_ja_vahetus_ei_saa_molemad_voita(upload):
    """TOCTOU: kaugteed ei tohi muutuda töötava ülekande alt."""
    tulemused = []
    start = threading.Barrier(2)

    def vaheta():
        start.wait()
        tulemused.append(("model", upload_state.try_set_ocr_model(upload, "hand")))

    def rakenda():
        start.wait()
        tulemused.append(("apply", upload_state.try_begin_applying(upload)))

    t1, t2 = threading.Thread(target=vaheta), threading.Thread(target=rakenda)
    t1.start()
    t2.start()
    t1.join()
    t2.join()

    s = upload_state.read_state(upload)
    # Lõppseis on ALATI sisemiselt kooskõlas — kaugteed vastavad mudelile.
    # See on tegelik invariant: kaks eraldi luku-akent („kontrolli, siis
    # kirjuta") laseks apply vahele ja kaugteed muutuksid lennus oleva
    # saatmise alt.
    assert s["remote_staging_path"] == "AUTO-OCR/{}/u1".format(s["ocr_model"])
    assert s["remote_work_path"] == "AUTO-OCR/{}/u1/kirik-abc".format(s["ocr_model"])
    # Apply õnnestub kummagi järjekorra korral: kas ta on esimene
    # (awaiting_split → applying) või tuleb mudelivahetuse järel, mis staatust
    # ei puutu. Mudelivahetus õnnestub AINULT siis, kui ta jõudis enne apply't.
    tulemus = dict(tulemused)
    assert tulemus["apply"] is True
    assert s["ocr_model"] == ("hand" if tulemus["model"] else "print")
