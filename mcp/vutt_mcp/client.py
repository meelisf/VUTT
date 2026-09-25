"""AINUS moodul, mis räägib HTTP-d.

Kui tuleb autenditud kirjutustee (prosopograafia täiendamine agendi poolt),
laieneb see kiht — tööriistu ümber kirjutama ei pea.
"""
import logging
import time
from urllib.parse import quote

import httpx

from .config import Settings
from .errors import VuttConfigError, VuttError, VuttNotFound, VuttTemporaryError

logger = logging.getLogger(__name__)

MEILI_INDEX = "teosed"
TIMEOUT_SECONDS = 20.0
RETRY_STATUSES = {429, 500, 502, 503, 504}
MAX_RETRY_SLEEP = 5.0


class VuttClient:
    def __init__(self, settings: Settings, transport: httpx.BaseTransport | None = None):
        self._settings = settings
        self._http = httpx.Client(timeout=TIMEOUT_SECONDS, transport=transport)

    # ── avalik pind ────────────────────────────────────────────────────────
    def meili_search(self, body: dict) -> dict:
        url = f"{self._settings.base_url}/meili/indexes/{MEILI_INDEX}/search"
        headers = {"Authorization": f"Bearer {self._settings.meili_key}"}
        return self._request("POST", url, headers=headers, json=body)

    def api_get(self, path: str, params: dict | None = None) -> dict | list:
        url = f"{self._settings.base_url}/api/files{path}"
        return self._request("GET", url, params=params)

    def api_post(self, path: str, json_body: dict) -> dict | list:
        url = f"{self._settings.base_url}/api/files{path}"
        return self._request("POST", url, json=json_body)

    # ── sisemine ───────────────────────────────────────────────────────────
    def image_get(self, path: str) -> tuple[bytes, str]:
        """Loeb indeksi pilditee samast VUTT-ist, ilma otsinguvõtit saatmata."""
        path = path.lstrip("/")
        if not path or any(part in (".", "..", "") for part in path.split("/")) or "\\" in path:
            raise VuttError("Vigane leheküljepildi tee indeksis.")
        url = f"{self._settings.base_url}/api/images/{quote(path, safe='/')}"
        response = self._request("GET", url, raw=True)
        mime = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
        if mime not in {"image/jpeg", "image/png", "image/webp", "image/gif"}:
            raise VuttError(f"Pildiserver ei tagastanud toetatud pilti ({mime}).")
        if not response.content:
            raise VuttError("Pildiserver tagastas tühja pildi.")
        return response.content, mime

    def _request(self, method: str, url: str, *, raw: bool = False, **kwargs):
        """Üks kordusekatse 5xx / 429 / timeout / ühendusvea korral."""
        last_exc: Exception | None = None
        for attempt in (1, 2):
            try:
                response = self._http.request(method, url, **kwargs)
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                last_exc = exc
                if attempt == 1:
                    logger.warning("Võrgutõrge (%s), proovin uuesti: %s", url, exc)
                    continue
                raise VuttTemporaryError(
                    f"VUTT ei vasta ({exc.__class__.__name__}). Proovi hiljem uuesti."
                ) from exc

            if response.status_code in RETRY_STATUSES and attempt == 1:
                self._sleep_for_retry(response)
                continue
            if raw and response.status_code == 200:
                return response
            if raw and response.status_code in (401, 403):
                raise VuttError("Leheküljepildile puudub avalik ligipääs.")
            return self._handle(response)

        raise VuttTemporaryError("VUTT ei vasta.") from last_exc

    @staticmethod
    def _sleep_for_retry(response: httpx.Response) -> None:
        """Austab Retry-After päist, kui see on olemas ja mõistlik."""
        raw = response.headers.get("Retry-After")
        delay = 0.5
        if raw:
            try:
                delay = min(float(raw), MAX_RETRY_SLEEP)
            except ValueError:
                pass
        if delay > 0:
            time.sleep(delay)

    @staticmethod
    def _handle(response: httpx.Response) -> dict | list:
        code = response.status_code
        if code == 200:
            return response.json()
        if code in (401, 403):
            raise VuttConfigError(
                f"VUTT lükkas võtme tagasi (HTTP {code}). Kontrolli, kas "
                f"VUTT_MEILI_SEARCH_KEY on tootmisest ja kehtiv — server tuleb "
                f"kehtiva võtmega taaskäivitada."
            )
        if code == 404:
            raise VuttNotFound(f"Ressurssi ei leitud: {response.request.url.path}")
        if code in RETRY_STATUSES:
            raise VuttTemporaryError(f"VUTT vastas ajutise veaga (HTTP {code}).")
        raise VuttError(f"VUTT vastas veaga (HTTP {code}): {response.text[:200]}")
