"""Gemini sisufiltri keeldumine (#292): eristatav kood, kordusteta, ilma eksitava proosata.

Varauusaegne materjal sisaldab meditsiini, anatoomiat, alkeemiat, usupoleemikat ja
kohtuprotsesside kirjeldusi. Google'i filter loeb osa neist poliitikarikkumiseks, nii
et see EI OLE servajuht — see tuleb korpuse iseloomu tõttu regulaarselt ette.
"""
import io
import sys
from pathlib import Path

import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def _jpeg(width=100, height=100) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (width, height), (128, 128, 128)).save(buf, "JPEG", quality=95)
    return buf.getvalue()


# Tootmises mõõdetud vastus (issue #292, leht work/zguvh4/417). `code` välja EI OLE,
# eristav info on `status`-es. Ära „paranda" seda keha oletatud kujule.
BLOKI_KEHA = {
    "error": {
        "status": "content_blocked",
        "message": ("Input blocked: This request was blocked by Gemini's filters. "
                    "They can occasionally trigger by mistake on safe coding, "
                    "security, or biology-related queries."),
    }
}


class _Resp:
    def __init__(self, status_code, keha):
        self.status_code = status_code
        self.headers = {"content-type": "application/json"}
        self._keha = keha
        self.text = "{}"

    def json(self):
        return self._keha


def _patch(monkeypatch, gem, resp_factory):
    monkeypatch.setattr(gem.requests, "post", resp_factory)
    monkeypatch.setattr(gem, "_api_key", lambda: "x")
    monkeypatch.setattr(gem.time, "sleep", lambda _s: None)


def test_sisufiltri_keeldumine_annab_eristatava_koodi(monkeypatch):
    """Kutsuja peab saama filtri keeldumist ERISTADA muust 400-st.

    Ilma koodita näevad „filter keeldus" ja „päring oli vigane" ühesugused välja,
    ja UI ei saa kasutajale öelda, mida teha (proovi LOSS-mudelit).
    """
    import server.ocr_providers.gemini as gem
    _patch(monkeypatch, gem, lambda *a, **kw: _Resp(400, BLOKI_KEHA))
    with pytest.raises(gem.GeminiError) as exc:
        gem.transcribe(_jpeg(), "JUHIS")
    # Sama masinloetava prefiksi konventsioon mis `request_too_large`.
    assert str(exc.value).startswith("content_blocked")


def test_sisufiltri_keeldumist_ei_korrata(monkeypatch):
    """Filter annab sama vastuse ka kordamisel — kordus kulutaks ainult kvooti."""
    import server.ocr_providers.gemini as gem
    kutsed = {"n": 0}

    def fake_post(*a, **kw):
        kutsed["n"] += 1
        return _Resp(400, BLOKI_KEHA)

    _patch(monkeypatch, gem, fake_post)
    with pytest.raises(gem.GeminiError):
        gem.transcribe(_jpeg(), "JUHIS")
    assert kutsed["n"] == 1


def test_muu_400_ei_ole_sisufiltri_keeldumine(monkeypatch):
    """Vigane päring EI TOHI kasutajale näidata „proovi LOSS-i" nõuannet.

    See on eristav test: kood, mis märgiks iga 400 blokeerituks, läbiks
    esimese testi, aga kukuks siin.
    """
    import server.ocr_providers.gemini as gem
    keha = {"error": {"code": 400, "status": "INVALID_ARGUMENT",
                      "message": "Invalid JSON payload"}}
    _patch(monkeypatch, gem, lambda *a, **kw: _Resp(400, keha))
    with pytest.raises(gem.GeminiError) as exc:
        gem.transcribe(_jpeg(), "JUHIS")
    assert "content_blocked" not in str(exc.value)
    assert "INVALID_ARGUMENT" in str(exc.value)


def test_veateade_ei_kanna_eksitavat_filtri_proosat(monkeypatch):
    """Google'i selgitus räägib koodist ja bioloogiast — meie kasutajale on see müra.

    Kasutaja loeb VUTT-i UI-s renderdatud lauset; toores API-proosa ei ütle,
    mida teha, ja saadab valele jäljele.
    """
    import server.ocr_providers.gemini as gem
    _patch(monkeypatch, gem, lambda *a, **kw: _Resp(400, BLOKI_KEHA))
    with pytest.raises(gem.GeminiError) as exc:
        gem.transcribe(_jpeg(), "JUHIS")
    assert "biology" not in str(exc.value)
    assert "safe coding" not in str(exc.value)


def test_diagnostika_jaab_logisse(monkeypatch, caplog):
    """Kasutaja teatest lühendamine EI TOHI diagnostikat kaotada.

    API täpne vastus on ainus jälg, mille põhjal saab hiljem aru saada, MIS
    täpselt keeldus — see peab jääma logisse ka siis, kui kasutaja seda ei näe.
    """
    import logging
    import server.ocr_providers.gemini as gem
    _patch(monkeypatch, gem, lambda *a, **kw: _Resp(400, BLOKI_KEHA))
    with caplog.at_level(logging.WARNING):
        with pytest.raises(gem.GeminiError):
            gem.transcribe(_jpeg(), "JUHIS")
    assert "content_blocked" in caplog.text


def test_frontend_tunneb_sama_koodi():
    """Kood on kirjutatud KAHES keeles — ilma valvurita triivivad nad lahku.

    Backend võib prefiksit muuta ilma ühtki Python-testi katki tegemata, ja
    kasutaja saaks jälle toore API-sõnumi. Sama muster mis
    `test_gemini_config.py` `.env.example` kontroll (ja #261 üldisemalt).
    """
    from server.ocr_providers.gemini import CONTENT_BLOCKED
    kaart = (Path(__file__).resolve().parents[1] / "src/utils/ocrErrorText.ts").read_text(
        encoding="utf-8")
    assert "'{}'".format(CONTENT_BLOCKED) in kaart, (
        "frontendi ocrErrorText.ts ei tunne koodi {!r}".format(CONTENT_BLOCKED))
