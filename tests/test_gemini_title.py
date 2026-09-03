"""Pealkirja tõlge: tekstipoolne Gemini-kutse, mis EI blokeeri importi."""
import pytest

from server.ocr_providers import gemini


def test_valja_lulitatud_gemini_annab_none(monkeypatch):
    monkeypatch.setattr(gemini, "GEMINI_API_KEY", "")
    assert gemini.translate_title("65 kirja Karl Morgensternile") is None


def test_vorgu_viga_annab_none_mitte_erandit(monkeypatch):
    monkeypatch.setattr(gemini, "GEMINI_API_KEY", "võti")

    def kukub(*a, **k):
        raise IOError("võrk maas")

    monkeypatch.setattr(gemini.requests, "post", kukub)
    assert gemini.translate_title("Pealkiri") is None


def test_juhis_keelab_parisnimede_tolkimise(monkeypatch):
    """Karl Morgenstern ja St. Petersburg EI OLE tõlgitavad."""
    monkeypatch.setattr(gemini, "GEMINI_API_KEY", "võti")
    saadetud = {}

    class Vastus:
        status_code = 200

        def json(self):
            return {"steps": [{"type": "model_output", "content": "65 letters"}]}

    def spioon(url, json=None, headers=None, timeout=None):
        saadetud["payload"] = json
        return Vastus()

    monkeypatch.setattr(gemini.requests, "post", spioon)
    gemini.translate_title("65 kirja")
    juhis = str(saadetud["payload"])
    assert "pärisnime" in juhis.lower() or "proper name" in juhis.lower()


def test_tyhi_sisend_ei_kutsu_apit(monkeypatch):
    monkeypatch.setattr(gemini, "GEMINI_API_KEY", "võti")
    monkeypatch.setattr(gemini.requests, "post",
                        lambda *a, **k: pytest.fail("ei tohi kutsuda"))
    assert gemini.translate_title("   ") is None
