"""Zotero Local API klient.

Miks API, mitte zotero.sqlite: jooksev Zotero hoiab baasi lukus nii, et isegi
mode=ro ühendus kukub. API annab värske seisu töötava Zotero kõrvalt, ei sõltu
sisemisest skeemiversioonist ja jätab prügikasti ise välja.

Hind: indekseerimise ajal peab Zotero jooksma ja Local API olema lubatud
(Settings → Advanced).
"""
import json
import urllib.error
import urllib.parse
import urllib.request

AJALIMIIT = 30
LEHE_SUURUS = 100


class ZoteroError(Exception):
    """Zoterost ei saa andmeid."""


def _get(base_url: str, path: str, params: dict) -> tuple:
    url = f"{base_url}{path}?{urllib.parse.urlencode(params)}"
    try:
        with urllib.request.urlopen(url, timeout=AJALIMIIT) as vastus:
            toores = vastus.read()
            paised = dict(vastus.headers)
    except urllib.error.URLError as e:
        raise ZoteroError(
            f"Zotero Local API ei vasta aadressil {base_url} ({e.reason}). "
            "Kas Zotero on avatud?"
        ) from e
    try:
        return json.loads(toores), paised
    except json.JSONDecodeError as e:
        # Väljalülitatud API vastab 200-ga, kehas „Local API is not enabled".
        raise ZoteroError(
            "Zotero Local API on välja lülitatud. Lülita sisse: "
            "Zotero → Settings → Advanced → luba teistel rakendustel "
            f"selles arvutis Zoteroga suhelda. (Vastus: {toores[:80]!r})"
        ) from e


def fetch_all(base_url: str, path: str, params: dict | None = None) -> list:
    """Kogub kõik lehed. Zotero annab Total-Results päise ja võtab `start`-i."""
    params = dict(params or {})
    params.setdefault("limit", LEHE_SUURUS)
    kogutud, algus = [], 0
    while True:
        params["start"] = algus
        tykk, paised = _get(base_url, path, params)
        kogutud.extend(tykk)
        kokku = int(paised.get("Total-Results", len(kogutud)))
        algus += len(tykk)
        if not tykk or algus >= kokku:
            return kogutud


def check_api(base_url: str) -> None:
    """Kukub selge juhisega, kui API ei ole kättesaadav või on välja lülitatud."""
    _get(base_url, "/collections", {"limit": 1})
