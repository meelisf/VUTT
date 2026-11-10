"""Teose eksemplarid ja agendi eksemplari-ettepanek (#703, ADR 0076 §7).

Agent loeb teose olemasolevad eksemplarid (püsiva `id`-ga) ja hoidjate registri,
võrdleb neid ESTERi kirjega (oma veebivahendiga — MCP ESTERit ei puuduta) ja
esitab ettepaneku. VUTT talletab selle AINULT ootel ettepanekuna; superadmin
otsustab teose halduse „Eksemplarid" vahekaardil rea kaupa.
"""
from __future__ import annotations

import json
import re
from urllib.parse import quote

from .errors import VuttConfigError, VuttError, VuttNotFound

_WORK_ID = re.compile(r"^[A-Za-z0-9_-]{4,40}$")
MAX_ROWS = 30
# Väljad, mida agent näeb ja pakkuda tohib (+ id ja tunnistaja märk kontekstiks).
# Lehed, lipp ja allikas on serveri väljad — neid väljundis ei ole, et agent neid ei pakuks.
_SHOWN = ("id", "holder", "shelfmark", "url", "condition", "binding", "provenance", "notes",
          "convolute", "reproduction", "text_witness")


def _check_work_id(work_id: str) -> None:
    if not isinstance(work_id, str) or not _WORK_ID.fullmatch(work_id):
        raise VuttError("Vigane work_id; kasuta search_works'i tulemuse work_id-d.")


def _holders(client) -> tuple[dict, dict]:
    """Hoidjate register: (võti → nimi, nimekuju → võti)."""
    registry = client.api_get("/config/archives")
    archives = (registry or {}).get("archives") if isinstance(registry, dict) else None
    holders = {k: (v or {}).get("name") or k for k, v in (archives or {}).items()}
    # Teised nimekujud (ajaloolised, Jaansoni lühendid) → võti. Esitamisel lahendab server
    # aliase ise võtmeks, aga agent näeb nii, et „Tallinn ERR" on juba registris.
    aliases = {a: k for k, v in (archives or {}).items()
               for a in ((v or {}).get("aliases") or []) if isinstance(a, str)}
    return holders, aliases


def _rows(data: dict) -> list[dict]:
    return [{k: x[k] for k in _SHOWN if k in x} for x in data["exemplars"] if isinstance(x, dict)]


def work_exemplars(client, work_id: str) -> str:
    """Eksemplarid + hoidjate register (`holders`: võti → nimi, `holder_aliases`: kuju → võti)."""
    _check_work_id(work_id)
    try:
        data = client.api_get(f"/works/{quote(work_id, safe='')}/exemplars")
    except (VuttNotFound, VuttConfigError) as exc:
        # Avalik otspunkt annab piiratud teose kohta 403 — ilma `base`-ita ettepanekut ei tehta.
        raise VuttNotFound(f"Teost work_id={work_id} ei leitud või pole avalik (piiratud teose "
                           "eksemplare ei saa praegu pakkuda).") from exc
    if not isinstance(data, dict) or not isinstance(data.get("exemplars"), list):
        raise VuttError("VUTT ei tagastanud teose eksemplare.")
    holders, aliases = _holders(client)
    out = {"work_id": work_id, "exemplars": _rows(data), "holders": holders}
    if aliases:
        out["holder_aliases"] = aliases
    return json.dumps(out,
                      ensure_ascii=False, indent=1)


MAX_BATCH = 50   # = serveri BATCH_MAX_WORKS


def works_exemplars(client, work_ids: list) -> str:
    """Mitme teose eksemplarid ühe päringuga; hoidjate register ainult üks kord.

    Ühe teose tõrge (piiratud / ei leitud) läheb `errors`-i, ülejäänud tulevad ikka.
    """
    if not isinstance(work_ids, list) or not work_ids:
        raise VuttError("work_ids peab olema mittetühi loend.")
    ids = list(dict.fromkeys(work_ids))
    if len(ids) > MAX_BATCH:
        raise VuttError(f"Kuni {MAX_BATCH} teost korraga; jaga loend osadeks.")
    for wid in ids:
        _check_work_id(wid)
    data = client.api_get("/exemplars/batch", params={"work_ids": ",".join(ids)})
    results = data.get("results") if isinstance(data, dict) else None
    if not isinstance(results, dict):
        raise VuttError("VUTT ei tagastanud eksemplaride kogupäringu vastust.")
    holders, aliases = _holders(client)
    works, errors = {}, {}
    for wid in ids:
        r = results.get(wid)
        if isinstance(r, dict) and isinstance(r.get("exemplars"), list):
            works[wid] = {"exemplars": _rows(r)}
        else:
            status = ((r or {}).get("error") or {}).get("status")
            errors[wid] = ("ei leitud" if status == 404
                           else "pole avalik (piiratud teose eksemplare ei saa pakkuda)")
    out = {"works": works, "holders": holders}
    if errors:
        out["errors"] = errors
    if aliases:
        out["holder_aliases"] = aliases
    return json.dumps(out, ensure_ascii=False, indent=1)


def submit_exemplars(client, handoff_code: str, work_id: str, rows: list, note: str | None = None) -> str:
    _check_work_id(work_id)
    if not isinstance(rows, list) or not 1 <= len(rows) <= MAX_ROWS:
        raise VuttError(f"Ettepanekus peab olema 1–{MAX_ROWS} rida.")
    body = {"code": handoff_code, "work_id": work_id, "rows": rows}
    if note:
        body["note"] = note
    result = client.api_post_once("/works/exemplar-proposals/submit", body)
    return (f"Ettepanek talletatud teose {work_id} jaoks: {result.get('rows')} rida, "
            f"proposal_id={result.get('proposal_id')}. Toimetaja vaatab need üle teose halduse "
            "„Eksemplarid\" vahekaardil; teost ei muudetud.")
