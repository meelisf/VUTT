"""Serveripoolsed vead samasse kaetud ringi (#133, serveripool).

Kaks katmata allikat: taustalõime surm (`threading.excepthook`) ja FastAPI
käsitlemata erind. Mõlemad kirjutavad `client_errors` ringi sisemise teega,
mitte avaliku `POST /client-error` kaudu. Konks EI TOHI ise visata — lõime
konks, mis viskab, peidaks algse vea.
"""
import threading

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from server import client_errors, server_errors


@pytest.fixture
def logi(tmp_path, monkeypatch):
    monkeypatch.setattr(client_errors, "CLIENT_ERRORS_FILE",
                        str(tmp_path / "client_errors.json"))
    client_errors.invalidate_cache()
    monkeypatch.setattr(client_errors, "_server_viimati", {})
    return tmp_path / "client_errors.json"


def _visatud(exc):
    """Tagastab erindi koos traceback'iga (nagu päriselt püütud)."""
    try:
        raise exc
    except Exception as e:
        return e


def test_serveri_kirje_salvestub_samasse_ringi(logi):
    exc = _visatud(ValueError("katki"))

    assert client_errors.record_server_error("server:thread", exc, thread="meili-keepwarm")

    [kirje] = client_errors.list_errors()
    assert kirje["source"] == "server:thread"
    assert "ValueError: katki" in kirje["message"]
    assert "meili-keepwarm" in kirje["message"]
    assert "Traceback" in kirje["stack"]
    assert kirje["username"] is None and kirje["ip"] is None


def test_sama_koha_kordus_ei_ujuta_ringi_ule(logi):
    """Iga päringuga korduv viga ei tohi kliendivigu ringist välja tõrjuda."""
    for i in range(5):
        client_errors.record_server_error("server:http", _visatud(KeyError(f"id-{i}")))

    assert len(client_errors.list_errors()) == 1


def test_eri_koht_salvestub_eraldi(logi):
    client_errors.record_server_error("server:http", _visatud(KeyError("a")))
    client_errors.record_server_error("server:http", _visatud(ValueError("b")))

    assert len(client_errors.list_errors()) == 2


def test_serveri_kirje_puhastatakse(logi):
    exc = _visatud(RuntimeError(
        "fetch /set-password?token=0f8fad5b-d9cb-469f-a165-70867728950e ebaõnnestus"))

    client_errors.record_server_error("server:http", exc, url="GET /x?token=abc")

    [kirje] = client_errors.list_errors()
    assert "0f8fad5b" not in kirje["message"]
    assert "0f8fad5b" not in kirje["stack"]
    assert "abc" not in (kirje["url"] or "")


def test_raportoor_ei_viska_kunagi(logi, monkeypatch):
    def katki(*a, **k):
        raise OSError("ketas täis")
    monkeypatch.setattr(client_errors, "atomic_write_json", katki)

    assert client_errors.record_server_error("server:thread", _visatud(ValueError("x"))) is False


def test_raportoor_ei_viska_ka_vigase_sisendi_peal(logi):
    assert client_errors.record_server_error("server:thread", None) is False


def test_loime_surm_jouab_logisse_ja_eelmine_konks_jookseb(logi, monkeypatch):
    eelmised = []
    monkeypatch.setattr(threading, "excepthook", lambda args: eelmised.append(args.exc_type))
    server_errors.install_thread_excepthook()
    server_errors.install_thread_excepthook()  # idempotentne

    def sureb():
        raise ZeroDivisionError("lõim suri")
    t = threading.Thread(target=sureb, name="testi-loim")
    t.start()
    t.join()

    [kirje] = client_errors.list_errors()
    assert "ZeroDivisionError" in kirje["message"] and "testi-loim" in kirje["message"]
    # Vaikimisi konks (traceback docker logs'i) peab edasi jooksma.
    assert eelmised == [ZeroDivisionError]


def test_loime_konks_ei_viska_kui_salvestus_viskab(logi, monkeypatch):
    eelmised = []
    monkeypatch.setattr(threading, "excepthook", lambda args: eelmised.append(args.exc_type))
    monkeypatch.setattr(client_errors, "record_server_error",
                        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("raportöör katki")))
    server_errors.install_thread_excepthook()

    t = threading.Thread(target=lambda: 1 / 0)
    t.start()
    t.join()

    assert eelmised == [ZeroDivisionError]


def _app():
    app = FastAPI()
    server_errors.install_http_handler(app)

    @app.get("/boom")
    def boom():
        raise LookupError("päringu viga")

    @app.get("/puudub")
    def puudub():
        raise HTTPException(status_code=404, detail="ei ole")

    return app


def test_kasitlemata_http_erind_jouab_logisse(logi):
    klient = TestClient(_app(), raise_server_exceptions=False)

    vastus = klient.get("/boom?token=0f8fad5b-d9cb-469f-a165-70867728950e")

    assert vastus.status_code == 500
    assert vastus.text == "Internal Server Error"
    [kirje] = client_errors.list_errors()
    assert kirje["source"] == "server:http"
    assert "LookupError: päringu viga" in kirje["message"]
    assert kirje["url"].startswith("GET /boom")
    assert "0f8fad5b" not in kirje["url"]


def test_http_exception_ei_ole_viga(logi):
    klient = TestClient(_app(), raise_server_exceptions=False)

    assert klient.get("/puudub").status_code == 404
    assert client_errors.list_errors() == []
