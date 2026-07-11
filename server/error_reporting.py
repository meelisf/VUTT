"""Valikuline Sentry/GlitchTip vea-aggregatsioon ilma kasutajaandmeteta."""
from __future__ import annotations

import os
from typing import Any
from urllib.parse import urlsplit, urlunsplit


def scrub_event(event: dict[str, Any], _hint: dict[str, Any]) -> dict[str, Any]:
    """Eemaldab päringukehad, päised, kasutaja ja URL-i query parameetrid."""
    event.pop("user", None)
    request = event.get("request")
    if isinstance(request, dict):
        url = request.get("url")
        clean_request: dict[str, Any] = {}
        if isinstance(url, str):
            try:
                parts = urlsplit(url)
                clean_request["url"] = urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))
            except ValueError:
                pass
        method = request.get("method")
        if isinstance(method, str):
            clean_request["method"] = method
        event["request"] = clean_request

    for breadcrumb in (event.get("breadcrumbs") or {}).get("values", []):
        if isinstance(breadcrumb, dict):
            breadcrumb.pop("data", None)
    return event


def init_error_reporting() -> bool:
    """Käivitab SDK ainult ERROR_REPORTING_DSN olemasolul.

    Sentry vaikeintegratsioonid hõlmavad FastAPI/Starlette'i ning uncaught
    ``threading.Thread`` erindeid, sealhulgas daemon-thread'e.
    """
    dsn = os.getenv("ERROR_REPORTING_DSN", "").strip()
    if not dsn:
        return False

    import sentry_sdk

    sentry_sdk.init(
        dsn=dsn,
        environment=os.getenv("ERROR_REPORTING_ENVIRONMENT") or os.getenv("VUTT_ENV", "dev"),
        release=os.getenv("ERROR_REPORTING_RELEASE") or None,
        send_default_pii=False,
        before_send=scrub_event,
        traces_sample_rate=0.0,
    )
    return True
