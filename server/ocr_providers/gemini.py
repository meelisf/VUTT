"""Google Gemini OCR-klient. OLEKUTA: sisse pildibaidid + juhis, välja tekst + usage.

Ei loe `_metadata.json`-it ega `state/`-i, ei tea `reocr_ops`-ist midagi — juhise
VALIK on kutsuja töö. Nii on klient testitav ilma failisüsteemita.

API kuju (tee, väljanimed) on TEOSTUSDETAIL. Leping on `transcribe()` signatuur ja
normaliseeritud usage-kuju — Google on API kuju vahetanud ja teeb seda uuesti.
"""
import base64
import io
import json
import time
from typing import Dict, List, Optional, Sequence, Tuple

import requests
from PIL import Image

from ..config import (
    GEMINI_API_KEY, GEMINI_MAX_REQUEST_BYTES, GEMINI_MAX_RETRIES,
    GEMINI_OCR_MODEL, GEMINI_REQUEST_TIMEOUT, GEMINI_THINKING_LEVEL, get_logger,
)
from ..ocr_prompts import strip_model_output

logger = get_logger(__name__)

API_URL = "https://generativelanguage.googleapis.com/v1beta/interactions"
MAX_REQUEST_BYTES = GEMINI_MAX_REQUEST_BYTES
TARGET_MAX_PX = 4000        # sihtpildi skaleerimislagi
EXAMPLE_MAX_PX = 2000       # näited on kontekst, mitte transkribeeritav objekt
SCALED_QUALITY = 90
LOPUJUHIS = "Transkribeeri ülalolev sihtpilt. Tagasta ainult transkriptsioon."


class GeminiError(Exception):
    """Kasutajale näidatav viga. Sõnum EI TOHI sisaldada võtit ega vastuse keha."""


def _api_key() -> str:
    """Eraldi funktsioon, et testid saaksid seda patchida ilma configi laadimata."""
    if not GEMINI_API_KEY:
        raise GeminiError("Gemini API võti puudub (GEMINI_API_KEY)")
    return GEMINI_API_KEY


def _scale(image_bytes: bytes, max_px: int) -> bytes:
    """Skaleerib pildi nii, et pikem külg on kuni max_px. Alati JPEG."""
    im = Image.open(io.BytesIO(image_bytes))
    im.thumbnail((max_px, max_px))
    buf = io.BytesIO()
    im.convert("RGB").save(buf, "JPEG", quality=SCALED_QUALITY)
    return buf.getvalue()


def _image_block(image_bytes: bytes) -> dict:
    return {"type": "image", "mime_type": "image/jpeg",
            "data": base64.b64encode(image_bytes).decode("ascii")}


def build_payload(image_bytes: bytes, instruction: str,
                  few_shot: Sequence[Tuple[bytes, str]],
                  model: str, thinking_level: str) -> dict:
    """Ehitab päringu keha. Järjekord on FIKSEERITUD (implicit caching sõltub sellest):
    juhis → näide 1 (pilt + tekst) → ... → sihtpilt → lõpujuhis.

    Näited on ÜHE user-inputi plokid, MITTE sünteetilised `model`-rolli sammud:
    stateless API nõuab, et mudeli sammud saadetaks tagasi täpselt sellisena, nagu
    need API-st tulid, ja meie `.txt` on inimese tekst, mitte Gemini varasem vastus.
    """
    blocks: List[dict] = [{"type": "text", "text": instruction}]
    for i, (naite_pilt, naite_tekst) in enumerate(few_shot, start=1):
        blocks.append({"type": "text", "text": "NÄIDE {}".format(i)})
        blocks.append(_image_block(naite_pilt))
        blocks.append({"type": "text",
                       "text": "Selle pildi korrektne transkriptsioon:\n{}\n"
                               "LÕPP NÄIDE {}".format(naite_tekst, i)})
    blocks.append({"type": "text", "text": "TRANSKRIBEERI JÄRGMINE PILT:"})
    blocks.append(_image_block(image_bytes))
    blocks.append({"type": "text", "text": LOPUJUHIS})
    return {
        "model": model,
        "store": False,                      # vaikimisi on True — vt ADR/spekk
        "thinking_level": thinking_level,
        "input": blocks,
    }


def _payload_size(payload: dict) -> int:
    return len(json.dumps(payload).encode("utf-8"))


def _fit_payload(image_bytes: bytes, instruction: str,
                 few_shot: Sequence[Tuple[bytes, str]],
                 model: str, thinking_level: str) -> dict:
    """Mahutab päringu eelarvesse. Kolm astet: nagu on → näited alla → sihtpilt alla.

    Mõõdetakse VALMIS serialiseeritud payload'i, mitte pildibaitide summat: API 20 MB
    lagi katab kogu request'i (pildid + juhis + näidete tekstid + JSON overhead).
    """
    payload = build_payload(image_bytes, instruction, few_shot, model, thinking_level)
    if _payload_size(payload) <= MAX_REQUEST_BYTES:
        return payload

    if few_shot:
        few_shot = [(_scale(p, EXAMPLE_MAX_PX), t) for p, t in few_shot]
        payload = build_payload(image_bytes, instruction, few_shot, model, thinking_level)
        logger.info("Gemini: näited skaleeritud (%d px)", EXAMPLE_MAX_PX)
        if _payload_size(payload) <= MAX_REQUEST_BYTES:
            return payload

    scaled = _scale(image_bytes, TARGET_MAX_PX)
    payload = build_payload(scaled, instruction, few_shot, model, thinking_level)
    logger.info("Gemini: sihtpilt skaleeritud %d → %d baiti",
                len(image_bytes), len(scaled))
    if _payload_size(payload) <= MAX_REQUEST_BYTES:
        return payload

    raise GeminiError(
        "request_too_large: päring ei mahu {} baiti ka pärast skaleerimist".format(
            MAX_REQUEST_BYTES))


def _error_summary(response) -> str:
    """Vea kokkuvõte LOGIMISEKS ja kasutajale. Vastuse keha EI dumbita.

    200-vastus ootamatu kujuga võib sisaldada transkribeeritud teksti; veakeha
    lõikamine logisse muutub aastatega vaikselt sisulekkeks.
    """
    try:
        err = (response.json() or {}).get("error") or {}
        osad = [str(err.get(k)) for k in ("code", "status", "message") if err.get(k)]
        if osad:
            return "HTTP {}: {}".format(response.status_code, " ".join(osad))
    except (ValueError, AttributeError):
        pass
    return "HTTP {} (vastus ei ole parsitav JSON, {} baiti)".format(
        response.status_code, len(getattr(response, "text", "") or ""))


def _normalize_usage(raw: Optional[dict]) -> Dict[str, int]:
    """API usage → VUTT-i kuju. reocr_ops ei tohi API väljanimesid kunagi näha."""
    raw = raw or {}
    return {
        "input_tokens": int(raw.get("total_input_tokens") or 0),
        "output_tokens": int(raw.get("total_output_tokens") or 0),
        "thought_tokens": int(raw.get("total_thought_tokens") or 0),
        "cached_tokens": int(raw.get("total_cached_tokens") or 0),
        "total_tokens": int(raw.get("total_tokens") or 0),
    }


def _extract_text(data: dict) -> str:
    osad = []
    for step in data.get("output") or []:
        for block in step.get("content") or []:
            if block.get("type") == "text" and block.get("text"):
                osad.append(block["text"])
    return "\n".join(osad)


def transcribe(image_bytes: bytes, instruction: str,
               few_shot: Sequence[Tuple[bytes, str]] = ()) -> Tuple[str, Dict[str, int]]:
    """Pilt + juhis (+ (pilt, tekst) näited) → (tekst, normaliseeritud usage)."""
    payload = _fit_payload(image_bytes, instruction, few_shot,
                           GEMINI_OCR_MODEL, GEMINI_THINKING_LEVEL)
    headers = {"x-goog-api-key": _api_key(), "Content-Type": "application/json"}

    viimane = ""
    for katse in range(GEMINI_MAX_RETRIES + 1):
        try:
            response = requests.post(API_URL, json=payload, headers=headers,
                                     timeout=GEMINI_REQUEST_TIMEOUT)
        except requests.RequestException as e:
            viimane = "ühenduse viga: {}".format(type(e).__name__)
            logger.warning("Gemini päring ebaõnnestus: %s", viimane)
        else:
            if response.status_code == 200:
                data = response.json()
                return (strip_model_output(_extract_text(data)),
                        _normalize_usage(data.get("usage")))
            viimane = _error_summary(response)
            logger.warning("Gemini päring ebaõnnestus: %s", viimane)
            if response.status_code not in (429, 500, 502, 503, 504):
                break
        if katse < GEMINI_MAX_RETRIES:
            time.sleep(2 ** katse)
    raise GeminiError("Gemini päring ebaõnnestus: {}".format(viimane))
