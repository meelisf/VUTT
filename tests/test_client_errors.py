"""Kliendipoolsete vigade kogumine (#133).

Eesmärk: vead, mida kasutaja kunagi ei raporteeri, jõuavad ise kohale.
2026-09-15 tuli kaks tootmisviga välja ainult sellepärast, et kasutaja mainis
neid — kaardi `setFeatureState` tabas iga klikkijat ja `y5fcky` seisis tunde.
"""
import json
import re
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import client_errors


@pytest.fixture
def logi(tmp_path, monkeypatch):
    monkeypatch.setattr(client_errors, "CLIENT_ERRORS_FILE",
                        str(tmp_path / "client_errors.json"))
    client_errors.invalidate_cache()
    return tmp_path / "client_errors.json"


def test_kirje_salvestub_ja_loetakse_tagasi(logi):
    client_errors.record_error({
        "message": "can't access property setFeatureState",
        "url": "/persons?view=map",
        "stack": "fe@PersonsMap.js:803",
    }, ip="10.0.0.1", username="mari")

    kirjed = client_errors.list_errors()
    assert len(kirjed) == 1
    assert kirjed[0]["message"].startswith("can't access property")
    assert kirjed[0]["username"] == "mari"
    assert kirjed[0]["url"] == "/persons?view=map"
    assert kirjed[0]["received_at"], "ajatempli paneb server, mitte klient"


def test_uusim_on_ees(logi):
    for i in range(3):
        client_errors.record_error({"message": f"viga {i}"}, ip="10.0.0.1")

    kirjed = client_errors.list_errors()
    assert [k["message"] for k in kirjed] == ["viga 2", "viga 1", "viga 0"]


def test_ring_ei_kasva_ule_lae(logi, monkeypatch):
    """Logi on kaetud ring: ketas ei tohi kasvada ilma ülemise piirita.

    Vea-agregaator, mis ise ketta täis kirjutab, on hullem kui mitte ükski.
    """
    monkeypatch.setattr(client_errors, "MAX_ERRORS", 5)
    for i in range(12):
        client_errors.record_error({"message": f"viga {i}"}, ip="10.0.0.1")

    kirjed = client_errors.list_errors()
    assert len(kirjed) == 5
    assert kirjed[0]["message"] == "viga 11", "uusim säilib"
    assert kirjed[-1]["message"] == "viga 7", "vanim on välja langenud"


def test_pikad_valjad_loigatakse(logi):
    """Üks hull stack ei tohi tervet faili täita."""
    client_errors.record_error({
        "message": "x" * 10_000,
        "stack": "y" * 100_000,
        "url": "z" * 5_000,
    }, ip="10.0.0.1")

    kirje = client_errors.list_errors()[0]
    assert len(kirje["message"]) <= client_errors.MAX_MESSAGE_LEN
    assert len(kirje["stack"]) <= client_errors.MAX_STACK_LEN
    assert len(kirje["url"]) <= client_errors.MAX_URL_LEN


def test_tundmatud_valjad_ei_paase_sisse(logi):
    """Kliendi saadetu on ANDMED, mitte skeem.

    Ilma valge nimekirjata saaks igaüks kirjutada suvalise struktuuri admini
    vaatesse — ja `auth_token`-i nimelise välja sinna kõrvale.
    """
    client_errors.record_error({
        "message": "päris viga",
        "auth_token": "salajane",
        "kuri": {"midagi": "muud"},
    }, ip="10.0.0.1")

    kirje = client_errors.list_errors()[0]
    assert "auth_token" not in kirje
    assert "kuri" not in kirje
    assert kirje["message"] == "päris viga"


def test_tyhi_teade_ei_salvestu(logi):
    """Teateta kirje ei ütle midagi ja ainult ujutab logi üle."""
    assert client_errors.record_error({"url": "/x"}, ip="10.0.0.1") is False
    assert client_errors.record_error({"message": "   "}, ip="10.0.0.1") is False
    assert client_errors.list_errors() == []


def test_anonuumne_kasutaja_on_lubatud(logi):
    """Kaardiviga tabas `/persons` lehel ka välja logimata kasutajaid."""
    client_errors.record_error({"message": "anon viga"}, ip="10.0.0.1",
                               username=None)
    assert client_errors.list_errors()[0]["username"] is None


def test_katkine_fail_ei_kukuta_lugemist(logi):
    """Loetamatu logi EI TOHI admini lehte katki teha.

    Vea-agregaator on diagnostika, mitte andmed: tema kadu on talutav, tema
    tõttu kukkuv admin-vaade ei ole.
    """
    logi.write_text("see ei ole json", encoding="utf-8")
    client_errors.invalidate_cache()

    assert client_errors.list_errors() == []

    # Uus kirje peab katkise faili üle kirjutama, mitte igavesti kukkuma.
    assert client_errors.record_error({"message": "pärast"}, ip="10.0.0.1") is True
    assert [k["message"] for k in client_errors.list_errors()] == ["pärast"]


def test_puuduv_fail_on_tuhi_logi(logi):
    assert not os.path.exists(logi)
    assert client_errors.list_errors() == []


def test_kustutamine_tuhjendab(logi):
    client_errors.record_error({"message": "a"}, ip="10.0.0.1")
    client_errors.clear_errors()
    assert client_errors.list_errors() == []


def test_fail_on_kehtiv_json(logi):
    client_errors.record_error({"message": "a"}, ip="10.0.0.1")
    data = json.loads(logi.read_text(encoding="utf-8"))
    assert isinstance(data, list)


# --- Endpointide kaitse ----------------------------------------------------

def test_lugemistee_on_admini_taga():
    """`/api/files/` proksib KÕIK backend-teed avalikult (CLAUDE.md).

    Raporteerimine on tahtlikult avalik, LUGEMINE mitte: logi kannab teiste
    kasutajate URL-e, kasutajanimesid ja IP-sid. Valvur kontrollib mõlemat
    poolt korraga — avalik kirjutustee JA suletud lugemistee.
    """
    from server.routers import public

    teed = {}
    for route in public.router.routes:
        teed[(tuple(sorted(route.methods - {"HEAD", "OPTIONS"})), route.path)] = route

    raport = teed.get((("POST",), "/client-error"))
    assert raport is not None, "raporteerimise endpoint peab olemas olema"
    assert not raport.dependencies, "raport peab jääma avalikuks"

    for meetod in ("GET", "DELETE"):
        route = teed.get(((meetod,), "/admin/client-errors"))
        assert route is not None, f"{meetod} /admin/client-errors puudub"
        assert route.path.startswith("/admin/"), "lugemistee peab olema /admin/ all"
        # `require_role` tuleb sisse funktsiooni vaikeväärtusena (Depends).
        allkiri = str(route.endpoint.__defaults__)
        assert "require_role" in allkiri or route.dependencies, (
            f"{meetod} /admin/client-errors ei ole rolli taga")


# --- Volitused ei tohi logisse jõuda (#133 ülevaatus) ----------------------

def test_server_puhastab_tokeni_ka_siis_kui_klient_ei_puhastanud(logi):
    """Klient on ANDMED, mitte filter.

    Kliendipoolne puhastus on esimene kaitse, aga vana vahemälust laaditud
    bundle või käsitsi koostatud päring saadab mida tahes. Server EI TOHI
    salvestada seda, mida ta kuvada ei tohi — sama õppetund kui #237, kus
    kirjutustee-pop ei puhastanud juba salvestatud kirjeid.
    """
    client_errors.record_error({
        "message": "viga",
        "url": "/set-password?token=3f1a9c22-77bd-4e1a-9b3e-5c1d2e3f4a5b",
    }, ip="10.0.0.1")

    kirje = client_errors.list_errors()[0]
    assert "3f1a9c22" not in kirje["url"]
    assert "/set-password" in kirje["url"], "tee peab alles jääma"


def test_server_puhastab_tokeni_teatest_ja_stackist(logi):
    client_errors.record_error({
        "message": "Failed at /set-password?token=3f1a9c22-77bd-4e1a-9b3e-5c1d2e3f4a5b",
        "stack": "at x (/invite?invite=3f1a9c22-77bd-4e1a-9b3e-5c1d2e3f4a5b)",
    }, ip="10.0.0.1")

    kirje = client_errors.list_errors()[0]
    assert "3f1a9c22" not in kirje["message"]
    assert "3f1a9c22" not in kirje["stack"]


def test_server_sailitab_diagnostilise_paringu(logi):
    """Puhastus ei tohi diagnostikat ära süüa: `?view=map` ütles, MIS katki."""
    client_errors.record_error({
        "message": "viga",
        "url": "/persons?view=map&related_to=vutt:Pj1blexq",
    }, ip="10.0.0.1")

    kirje = client_errors.list_errors()[0]
    assert "view=map" in kirje["url"]
    assert "related_to=vutt:Pj1blexq" in kirje["url"]


def test_server_puhastab_tundmatu_votmenimega_uuidi(logi):
    """Denylist on nimekiri, mis jääb alati maha — kuju peab ka katma."""
    client_errors.record_error({
        "message": "viga",
        "url": "/x?k=3f1a9c22-77bd-4e1a-9b3e-5c1d2e3f4a5b",
    }, ip="10.0.0.1")

    assert "3f1a9c22" not in client_errors.list_errors()[0]["url"]


def test_kaks_keelt_uks_reegel():
    """TS- ja Python-pool peavad kandma SAMA tundlike võtmete nimekirja.

    Ainult ühte poolde lisatud võti tähendab, et klient saadab tokeni ära
    (kui puudu on TS-pool) või server salvestab ta (kui puudu on Python-pool).
    Kumbki üksi ei ole kaitse — vt `scrubSensitive.ts` päis.
    """
    ts = (Path(__file__).resolve().parents[1]
          / "src" / "services" / "scrubSensitive.ts").read_text(encoding="utf-8")
    plokk = ts.split("SENSITIVE_KEYS = new Set([")[1].split("]);")[0]
    ts_votmed = set(re.findall(r"'([^']+)'", plokk))

    assert ts_votmed == client_errors.SENSITIVE_KEYS, (
        "nimekirjad lahknesid — ainult TS-is: {} · ainult Pythonis: {}".format(
            sorted(ts_votmed - client_errors.SENSITIVE_KEYS),
            sorted(client_errors.SENSITIVE_KEYS - ts_votmed)))


SCRUB_CASES = json.loads((Path(__file__).parent / "fixtures" / "client_error_scrub.json").read_text())


@pytest.mark.parametrize("case", SCRUB_CASES, ids=lambda case: case["input"])
def test_uhine_puhastusleping(case):
    assert client_errors.scrub(case["input"]) == case["expected"]
    assert client_errors.scrub(case["expected"]) == case["expected"]


@pytest.mark.parametrize("case", [c for c in SCRUB_CASES if c["input"]])
def test_puhastus_jouab_kettale(logi, case):
    assert client_errors.record_error({"message": case["input"], "stack": case["input"],
                                       "url": case["input"], "user_agent": case["input"],
                                       "source": case["input"]})
    row = json.loads(logi.read_text())[0]
    for field in ("message", "stack", "url", "user_agent"):
        assert row[field] == case["expected"]
    assert row["source"] == case["expected"][:40]


def test_vana_logi_puhastub_ka_kettal_ja_tundmatud_valjad_kaovad(logi):
    logi.write_text(json.dumps([{"message": "/x?%74oken=synthetic-short",
                                "stack": "/x#token=synthetic-short",
                                "auth_token": "synthetic-short", "received_at": "2026-09-15"},
                               "vigane kirje"]))
    rows = client_errors.list_errors()
    assert len(rows) == 1
    assert rows[0]["message"] == "/x?token=<eemaldatud>"
    assert rows[0]["stack"] == "/x#token=<eemaldatud>"
    assert rows[0]["received_at"] == "2026-09-15"
    assert "synthetic-short" not in logi.read_text()
    assert "auth_token" not in rows[0]
    client_errors.invalidate_cache()
    assert client_errors.list_errors() == rows


def test_vana_logi_kirjutustorge_ei_tagasta_toorest_saladust(logi, monkeypatch):
    logi.write_text(json.dumps([{"message": "/x?%74oken=synthetic-short"}]))
    def fail(*args):
        raise OSError("synthetic write failure")
    monkeypatch.setattr(client_errors, "atomic_write_json", fail)
    assert client_errors.list_errors()[0]["message"] == "/x?token=<eemaldatud>"


def test_puhastus_toimub_enne_pikkusepiiri(logi):
    # Kui enne lõigata, säiliks tundmatu võtmega tokeni lühike algus.
    text = "x" * (client_errors.MAX_MESSAGE_LEN - 8) + " /x?k=" + "a" * 64
    client_errors.record_error({"message": text})
    assert "aaa" not in json.loads(logi.read_text())[0]["message"]


def test_kaivitus_puhastab_logi_enne_ulejaanud_lifespan_i(logi, monkeypatch):
    import asyncio
    import threading
    from server import main

    logi.write_text(json.dumps([{"message": "/x?%74oken=synthetic-short"}]))
    main_thread = threading.get_ident()
    threads = []
    def load():
        threads.append(threading.get_ident())
        return client_errors.list_errors()
    class StopStartup(Exception):
        pass
    def stop():
        raise StopStartup()
    monkeypatch.setattr(main, "load_client_errors", load)
    monkeypatch.setattr(main, "check_render_concurrency", stop)
    async def start():
        with pytest.raises(StopStartup):
            async with main.lifespan(main.app):
                pytest.fail("Taastele järgnev peatamispunkt peab enne yield-i rakenduma")
    asyncio.run(start())
    assert threads and threads[0] != main_thread
    assert "synthetic-short" not in logi.read_text()
