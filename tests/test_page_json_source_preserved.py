"""Lehe salvestus EI TOHI pühkida serveripoolseid võtmeid, mida klient ei tunne.

`editing.py` kirjutab meta_content'i kliendilt TERVIKUNA üle. `sequence` on
eraldi säilitatud; `source` (ADA provenance) peab käituma samamoodi.
"""
from server.routers.editing import merge_serveripoolsed_valjad


def test_source_sailib_kui_klient_ei_saada():
    olemasolev = {"sequence": 500, "status": "Toores",
                  "source": {"provider": "ada", "name": "07.03.1813.pdf"}}
    kliendilt = {"sequence": 500, "status": "Parandatud", "comments": []}
    tulemus = merge_serveripoolsed_valjad(olemasolev, kliendilt)
    assert tulemus["source"] == {"provider": "ada", "name": "07.03.1813.pdf"}
    assert tulemus["status"] == "Parandatud"


def test_sequence_sailib_endiselt():
    """Olemasolev käitumine ei tohi katkeda."""
    tulemus = merge_serveripoolsed_valjad({"sequence": 700}, {"status": "Töös"})
    assert tulemus["sequence"] == 700


def test_klient_tohib_source_i_muuta_kui_saadab():
    """Säilitamine täidab AUGU, ei lukusta välja."""
    tulemus = merge_serveripoolsed_valjad(
        {"source": {"provider": "ada"}}, {"source": {"provider": "kasitsi"}}
    )
    assert tulemus["source"] == {"provider": "kasitsi"}


def test_sequence_null_ei_kaota_nulli():
    """Falsy serv: sequence=0 on ÕIGE väärtus (esimene lehekülg), mitte
    'väärtus puudub'. Kood kontrollib `is None`, mitte truthiness'i — see
    test fikseerib selle, et tulevane 'lihtsustus' (`if not vana`) ei
    murraks vaikselt 0-indeksiga lehti.
    """
    tulemus = merge_serveripoolsed_valjad({"sequence": 0}, {"sequence": None})
    assert tulemus["sequence"] == 0


def test_meta_content_wrapper_kuju():
    """Vana kirjete kuju: väljad on meta_content-i sees."""
    tulemus = merge_serveripoolsed_valjad(
        {"meta_content": {"sequence": 300, "source": {"provider": "ada"}}}, {}
    )
    assert tulemus["sequence"] == 300
    assert tulemus["source"] == {"provider": "ada"}
