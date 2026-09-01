"""Gemini OCR-kliendi leping: päringu kuju, usage normaliseerimine, vead, pildi lagi."""
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


def test_payload_kannab_store_false():
    """Interactions API salvestab VAIKIMISI. Skanne ei tohi Google'isse seisma jääda."""
    from server.ocr_providers.gemini import build_payload
    payload = build_payload(_jpeg(), "JUHIS", (), "gemini-3.7-flash", "low")
    assert payload["store"] is False


def test_payload_ei_sisalda_sampling_parameetreid():
    """temperature/top_p/top_k on Gemini 3.x-il deprecated."""
    from server.ocr_providers.gemini import build_payload
    import json
    payload = build_payload(_jpeg(), "JUHIS", (), "gemini-3.7-flash", "low")
    serialiseeritud = json.dumps(payload).lower()
    for key in ("temperature", "top_p", "top_k", "topp", "topk"):
        assert key not in serialiseeritud


def test_payload_kannab_thinking_level_ja_mudelit():
    from server.ocr_providers.gemini import build_payload
    payload = build_payload(_jpeg(), "JUHIS", (), "gemini-3.7-flash", "low")
    assert payload["model"] == "gemini-3.7-flash"
    assert payload["thinking_level"] == "low"


def test_payload_ei_sisalda_model_rolli_samme():
    """Näited on ÜKS user-input, mitte sünteetiline vestlusajalugu (dokumenteerimata)."""
    from server.ocr_providers.gemini import build_payload
    payload = build_payload(_jpeg(), "JUHIS", ((_jpeg(), "näite tekst"),),
                            "gemini-3.7-flash", "low")
    def roles(node):
        if isinstance(node, dict):
            for k, v in node.items():
                if k == "role":
                    yield v
                for r in roles(v):
                    yield r
        elif isinstance(node, list):
            for item in node:
                for r in roles(item):
                    yield r
    assert "model" not in set(roles(payload))


def test_payload_lopeb_tekstiga_mitte_pildiga():
    """Sihtpilt ei tohi olla viimane element — API-versioonide kindlus."""
    from server.ocr_providers.gemini import build_payload
    payload = build_payload(_jpeg(), "JUHIS", (), "gemini-3.7-flash", "low")
    last = payload["input"][-1]
    assert last.get("type") == "text"
    assert last.get("text", "").strip()


def test_naited_tulevad_enne_sihtpilti():
    """Stabiilne prefiks: juhis → näited → sihtpilt. Implicit caching sõltub sellest."""
    from server.ocr_providers.gemini import build_payload
    payload = build_payload(_jpeg(), "JUHIS", ((_jpeg(), "NÄITETEKST"),),
                            "gemini-3.7-flash", "low")
    blob = payload["input"]
    naite_idx = next(i for i, b in enumerate(blob)
                     if b.get("type") == "text" and "NÄITETEKST" in b.get("text", ""))
    pilte = [i for i, b in enumerate(blob) if b.get("type") == "image"]
    assert pilte[-1] > naite_idx      # sihtpilt on viimane pilt, näite teksti järel


def test_transcribe_normaliseerib_usage(monkeypatch):
    """reocr_ops ei tohi kunagi näha API enda väljanimesid."""
    import server.ocr_providers.gemini as gem

    class Resp:
        status_code = 200
        headers = {"content-type": "application/json"}
        def json(self):
            return {
                "output": [{"content": [{"type": "text", "text": "Mus. 1309"}]}],
                "usage": {"total_input_tokens": 11, "total_output_tokens": 22,
                          "total_thought_tokens": 3, "total_cached_tokens": 4,
                          "total_tokens": 40},
            }
        text = ""

    monkeypatch.setattr(gem.requests, "post", lambda *a, **kw: Resp())
    monkeypatch.setattr(gem, "_api_key", lambda: "x")
    text, usage = gem.transcribe(_jpeg(), "JUHIS")
    assert text == "Mus. 1309"
    assert usage == {"input_tokens": 11, "output_tokens": 22, "thought_tokens": 3,
                     "cached_tokens": 4, "total_tokens": 40}


def test_transcribe_rakendab_strip_model_output(monkeypatch):
    import server.ocr_providers.gemini as gem

    class Resp:
        status_code = 200
        headers = {"content-type": "application/json"}
        def json(self):
            return {"output": [{"content": [{"type": "text",
                                             "text": "```\nMus. 1309\n```"}]}],
                    "usage": {}}
        text = ""

    monkeypatch.setattr(gem.requests, "post", lambda *a, **kw: Resp())
    monkeypatch.setattr(gem, "_api_key", lambda: "x")
    text, _ = gem.transcribe(_jpeg(), "JUHIS")
    assert text == "Mus. 1309"


def test_429_korratakse_ja_onnestub(monkeypatch):
    import server.ocr_providers.gemini as gem
    calls = {"n": 0}

    class Resp:
        def __init__(self, status):
            self.status_code = status
            self.headers = {"content-type": "application/json"}
            self.text = "{}"
        def json(self):
            return {"output": [{"content": [{"type": "text", "text": "ok"}]}],
                    "usage": {}}

    def fake_post(*a, **kw):
        calls["n"] += 1
        return Resp(429 if calls["n"] == 1 else 200)

    monkeypatch.setattr(gem.requests, "post", fake_post)
    monkeypatch.setattr(gem, "_api_key", lambda: "x")
    monkeypatch.setattr(gem.time, "sleep", lambda _s: None)
    text, _ = gem.transcribe(_jpeg(), "JUHIS")
    assert text == "ok"
    assert calls["n"] == 2


def test_429_ammendumisel_viskab_geminierrori(monkeypatch):
    import server.ocr_providers.gemini as gem

    class Resp:
        status_code = 429
        headers = {"content-type": "application/json"}
        text = '{"error": {"code": 429, "status": "RESOURCE_EXHAUSTED", "message": "liiga palju"}}'
        def json(self):
            return {"error": {"code": 429, "status": "RESOURCE_EXHAUSTED",
                              "message": "liiga palju"}}

    monkeypatch.setattr(gem.requests, "post", lambda *a, **kw: Resp())
    monkeypatch.setattr(gem, "_api_key", lambda: "x")
    monkeypatch.setattr(gem.time, "sleep", lambda _s: None)
    with pytest.raises(gem.GeminiError) as exc:
        gem.transcribe(_jpeg(), "JUHIS")
    assert "RESOURCE_EXHAUSTED" in str(exc.value)


def test_veateade_ei_sisalda_api_votit(monkeypatch):
    import server.ocr_providers.gemini as gem

    class Resp:
        status_code = 500
        headers = {"content-type": "application/json"}
        text = '{"error": {"message": "sisemine viga"}}'
        def json(self):
            return {"error": {"message": "sisemine viga"}}

    monkeypatch.setattr(gem.requests, "post", lambda *a, **kw: Resp())
    monkeypatch.setattr(gem, "_api_key", lambda: "SALAJANE-VOTI-123")
    monkeypatch.setattr(gem.time, "sleep", lambda _s: None)
    with pytest.raises(gem.GeminiError) as exc:
        gem.transcribe(_jpeg(), "JUHIS")
    assert "SALAJANE-VOTI-123" not in str(exc.value)


def test_vaike_pilt_saadetakse_muutmata():
    """Pariteet LOSS-iga: tema saab sama 300 DPI faili."""
    import base64
    from server.ocr_providers.gemini import build_payload
    raw = _jpeg(100, 100)
    payload = build_payload(raw, "JUHIS", (), "gemini-3.7-flash", "low")
    pildid = [b for b in payload["input"] if b.get("type") == "image"]
    assert base64.b64decode(pildid[0]["data"]) == raw


def test_liiga_suur_paring_ei_lahe_apisse(monkeypatch):
    """Terminaltingimus: kui skaleerimine ei aita, kutset EI tehta."""
    import server.ocr_providers.gemini as gem
    monkeypatch.setattr(gem, "MAX_REQUEST_BYTES", 10)   # kõik on liiga suur
    monkeypatch.setattr(gem, "_api_key", lambda: "x")

    def ei_tohi_kutsuda(*a, **kw):
        raise AssertionError("API-kutset ei tohi teha")

    monkeypatch.setattr(gem.requests, "post", ei_tohi_kutsuda)
    with pytest.raises(gem.GeminiError) as exc:
        gem.transcribe(_jpeg(4000, 4000), "JUHIS")
    assert "request_too_large" in str(exc.value)
