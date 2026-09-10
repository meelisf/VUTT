"""Olekuta tekstitõlge. Sisse tekst + keeled, välja tekst + normaliseeritud usage.

Ei impordi prosopograafiat, ei loe faile, ei tea ankrust midagi — sama vaim kui
`ocr_providers/gemini.py`.

Vastuseparserit siin EI OLE: `_extract_text`, `_normalize_usage`, `_error_status`
ja `_error_summary` tulevad `ocr_providers.gemini`-st, sest need on ELAVA API
vastu mõõdetud. Kaks koopiat lahkneksid vaikselt, kui Google API kuju muudab
(mida ta on juba korra teinud).
"""
from __future__ import annotations

import time
from typing import Dict, Tuple

import requests

from .config import (
    GEMINI_MAX_RETRIES, GEMINI_REQUEST_TIMEOUT, GEMINI_THINKING_LEVEL,
    GEMINI_TRANSLATE_MODEL, get_logger,
)
from .ocr_providers.gemini import (
    API_URL, CONTENT_BLOCKED, _api_key, _error_status, _error_summary,
    _extract_text, _normalize_usage,
)

logger = get_logger(__name__)


class TranslateError(Exception):
    """Kasutajale näidatav viga. Sõnum EI TOHI sisaldada võtit ega vastuse keha."""


SUPPORTED_LANGS = ("et", "en")
# Pikim olemasolev elulugu on 30 590 märki (mõõdetud 2026-09-10). Piir on selge
# viga, mitte vaikne lõikamine.
MAX_INPUT_CHARS = 50000

_LANG_NAMES = {"et": "eesti keelest", "en": "inglise keelest"}
_LANG_TO = {"et": "eesti keelde", "en": "inglise keelde"}

JUHIS = (
    "Tõlgi järgnev ajalooline elulookirjeldus {}{}.\n"
    "- Säilita Markdowni struktuur ja linkide sihtaadressid.\n"
    "- Kuupäevadel säilita tähendus ja täpsus; vorm kohandub sihtkeelele "
    "(„20. septembril 1634\" → „20 September 1634\"). Ligikaudsus jääb ligikaudsuseks.\n"
    "- Isiku- ja kohanimed jäävad allikas kirjutatud kujule — ei tõlgita ega "
    "moderniseerita.\n"
    "- Allikatsitaadid (jutumärkides või ploktsitaadis) jäävad tõlkimata.\n"
    "- Ära lisa midagi juurde. Tagasta ainult tõlge."
)


def _build_instruction(source_lang: str, target_lang: str) -> str:
    return JUHIS.format(_LANG_NAMES[source_lang], " " + _LANG_TO[target_lang])


def _validate(text: str, source_lang: str, target_lang: str) -> str:
    if source_lang not in SUPPORTED_LANGS or target_lang not in SUPPORTED_LANGS:
        raise TranslateError(
            "Toetatud keeled: {}".format(", ".join(SUPPORTED_LANGS)))
    if source_lang == target_lang:
        raise TranslateError("Lähte- ja sihtkeel peavad erinema")
    sisu = (text or "").strip()
    if not sisu:
        raise TranslateError("Tõlgitav tekst on tühi")
    if len(sisu) > MAX_INPUT_CHARS:
        raise TranslateError(
            "Tekst on liiga pikk: {} märki, lubatud {}".format(
                len(sisu), MAX_INPUT_CHARS))
    return sisu


def translate(text: str, source_lang: str, target_lang: str) -> Tuple[str, Dict[str, int]]:
    """Tekst + keeled → (tõlge, normaliseeritud usage). Viskab `TranslateError`-i.

    BLOKEERIV — kutsuja peab olema sünkroonne `def` route või `run_in_threadpool`
    (ADR 0002).
    """
    sisu = _validate(text, source_lang, target_lang)
    payload = {
        "model": GEMINI_TRANSLATE_MODEL,
        "store": False,                  # vaikimisi True — tekst ei tohi Google'isse jääda
        # `thinking_level` PEAB olema `generation_config` sees; ülemisel tasemel
        # annab API 400 „Unknown parameter" (mõõdetud 2026-09-01).
        "generation_config": {"thinking_level": GEMINI_THINKING_LEVEL},
        "input": [
            {"type": "text", "text": _build_instruction(source_lang, target_lang)},
            {"type": "text", "text": sisu},
        ],
    }
    headers = {"x-goog-api-key": _api_key(), "Content-Type": "application/json"}

    viimane = ""
    for katse in range(GEMINI_MAX_RETRIES + 1):
        try:
            response = requests.post(API_URL, json=payload, headers=headers,
                                     timeout=GEMINI_REQUEST_TIMEOUT)
        except requests.RequestException as e:
            viimane = "ühenduse viga: {}".format(type(e).__name__)
            logger.warning("Tõlkepäring ebaõnnestus: %s", viimane)
        else:
            if response.status_code == 200:
                try:
                    data = response.json()
                except ValueError as e:
                    raise TranslateError(
                        "Tõlkevastus (200) ei ole loetav JSON: {}".format(type(e).__name__))
                tolge = (_extract_text(data) or "").strip()
                if not tolge:
                    # Erinevalt OCR-ist (ADR 0025) EI OLE tühi tõlge kehtiv
                    # tulemus — tühi kast vormis näeks välja nagu õnnestunud töö.
                    raise TranslateError("Tõlkemudel tagastas tühja vastuse")
                return tolge, _normalize_usage(data.get("usage"))
            viimane = _error_summary(response)
            logger.warning("Tõlkepäring ebaõnnestus: %s", viimane)
            if _error_status(response) == CONTENT_BLOCKED:
                # Masinloetav prefiks — UI renderdab lugeja keeles suunava lause
                # (ADR 0033, #292 muster).
                raise TranslateError(
                    "{}: Gemini sisufilter keeldus sellest tekstist".format(CONTENT_BLOCKED))
            if response.status_code not in (429, 500, 502, 503, 504):
                break
        if katse < GEMINI_MAX_RETRIES:
            time.sleep(2 ** katse)
    raise TranslateError("Tõlkepäring ebaõnnestus: {}".format(viimane))


__all__ = ["TranslateError", "SUPPORTED_LANGS", "MAX_INPUT_CHARS", "translate"]
