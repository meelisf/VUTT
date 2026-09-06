"""Upload'i staatuse valideerimine kirjutusteel (#314).

`ALL_STATUSES` on käsitsi hooldatav loend ja frontendi-katvuse valvur tõestab
ainult LOENDIS OLEVATE katvust. Uus staatus koodi, aga mitte loendisse → valvur
jääb roheliseks ja frontend ei klassifitseeri seda → upload muutub vaikselt
mittejätkatavaks.

PR #311-s proovitud lähtekoodi skann leidis 12-st ainult 5 (`status="x"` kuju
küll, `s["status"] = new_status` mitte). Kirjutustee näeb KÕIKI, sest ta on seal,
kus väärtus tegelikult tekib.
"""
import logging
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def test_tuntud_staatus_kirjutatakse_karata(make_upload, caplog):
    from server.upload import state as upload_state

    make_upload("u1", status="pending")
    with caplog.at_level(logging.ERROR):
        upload_state.set_upload_state("u1", status="reviewing")

    assert upload_state.read_state("u1")["status"] == "reviewing"
    assert "tundmatu" not in caplog.text.lower()


def test_tundmatu_staatus_viskab_testides(make_upload):
    """Testijooks on koht, kus vale staatus peab kukutama KOHE.

    Testid kirjutavad neid staatusi läbi samade teede sadu kordi, seega vale
    väärtus tuleb välja ilma, et keegi peaks logi lugema.
    """
    from server.upload import state as upload_state

    make_upload("u2", status="pending")
    with pytest.raises(ValueError) as exc:
        upload_state.set_upload_state("u2", status="uus_staatus")
    assert "uus_staatus" in str(exc.value)


def test_tootmises_logitakse_aga_kirjutus_LAHEB_LABI(make_upload, monkeypatch, caplog):
    """Erand kirjutusteel lõhuks upload'i KÕVEMINI kui probleem, mida ta lahendab.

    Kahju tundmatust staatusest on „upload muutub vaikselt mittejätkatavaks".
    Kui valideerimine keelduks kirjutamast, jääks upload hoopis vale oleku
    külge kinni — ja just siis, kui loend osutub puudulikuks, ehk halvimal
    hetkel. Kirjutus ise on õigustatud; vananenud on LOEND.
    """
    from server.upload import state as upload_state

    make_upload("u3", status="pending")
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)

    with caplog.at_level(logging.ERROR):
        upload_state.set_upload_state("u3", status="uus_staatus")

    assert upload_state.read_state("u3")["status"] == "uus_staatus", (
        "kirjutus PEAB läbi minema")
    assert "uus_staatus" in caplog.text
    assert "u3" in caplog.text, "logi peab ütlema, MILLINE upload"


def test_staatuseta_uuendus_ei_kaeba(make_upload, monkeypatch, caplog):
    """`write_state` kirjutab ka muid välju — puuduv `status` ei ole viga."""
    from server.upload import state as upload_state

    make_upload("u4", status="reviewing")
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)

    with caplog.at_level(logging.ERROR):
        upload_state.set_upload_state("u4", expected_pages=42)

    assert upload_state.read_state("u4")["expected_pages"] == 42
    assert caplog.text == ""


def test_preview_status_ei_sega(make_upload):
    """`preview_status` on ERI VÄLI oma sõnavaraga (rendering/ready/cancelled).

    Ta elab `prepress` sees, mitte ülemisel tasemel. Nende sulatamine oleks
    täpselt see viga, mis PR #311-s esimesel katsel peaaegu juhtus.
    """
    from server.upload import state as upload_state

    make_upload("u5", status="prepping")
    upload_state.set_upload_state(
        "u5", prepress={"pages": [], "preview_status": "rendering"})

    s = upload_state.read_state("u5")
    assert s["prepress"]["preview_status"] == "rendering"
    assert s["status"] == "prepping"
