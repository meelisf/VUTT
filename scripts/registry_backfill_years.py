#!/usr/bin/env python3
"""
Asutuseregistri tegutsemisaeg Wikidatast (ADR 0059, täiendus 2026-09-29).

Täidab `active_from` / `active_to` Q-koodiga kirjetel, kus need puuduvad:
P571 (asutatud) ja P576 (lõpetatud). Ainult aastatäpsusega väärtus (precision ≥ 9 —
sajand „+1600" ei ole aasta 1600), aegunud väide jääb välja, mitu eri aastat →
jäetakse vahele ja inimene otsustab. Olemasolevat väärtust üle ei kirjutata.
Sama reegel on kliendis (`registryCreate.claimYear`).

Vaikimisi kuivkäivitus (ei kirjuta midagi). Kirjutus = üks git-commit, autor
„Automaatne". Käivitus serveris (data/ git kirjutab konteinerist):
    docker exec -w /app vutt-backend python3 scripts/registry_backfill_years.py
    docker exec -w /app vutt-backend python3 scripts/registry_backfill_years.py --apply
"""
import argparse
import json
import os
import re
import sys
import types
import urllib.parse
import urllib.request

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if "server" not in sys.modules:
    _server_pkg = types.ModuleType("server")
    _server_pkg.__path__ = [os.path.join(BASE_DIR, "server")]
    _server_pkg.__package__ = "server"
    sys.modules.setdefault("server", _server_pkg)
sys.path.insert(0, BASE_DIR)

from server.prosopography import registries  # noqa: E402

_API = "https://www.wikidata.org/w/api.php"
_UA = "VUTT/1.0 (https://vutt.utlib.ut.ee; registry backfill)"
_TIME = re.compile(r"^\+(\d{4})-")


def claim_year(entity: dict, prop: str):
    """(aasta | None, põhjus). Põhjus on tühi, kui väide puudub."""
    years = set()
    for claim in (entity.get("claims") or {}).get(prop, []):
        if claim.get("rank") == "deprecated":
            continue
        value = ((claim.get("mainsnak") or {}).get("datavalue") or {}).get("value") or {}
        m = _TIME.match(value.get("time") or "") if isinstance(value, dict) else None
        if m and (value.get("precision") or 9) >= 9:
            years.add(int(m.group(1)))
    if len(years) > 1:
        return None, f"{prop}: mitu aastat {sorted(years)}"
    return (years.pop() if years else None), ""


def fetch_entities(ids: list) -> dict:
    out = {}
    for start in range(0, len(ids), 50):
        query = urllib.parse.urlencode({"action": "wbgetentities", "ids": "|".join(ids[start:start + 50]),
                                        "props": "claims", "format": "json"})
        request = urllib.request.Request(f"{_API}?{query}", headers={"User-Agent": _UA})
        with urllib.request.urlopen(request, timeout=30) as response:
            out.update(json.load(response).get("entities") or {})
    return out


def plan(entries: dict, entities: dict) -> list:
    """Iga Q-koodiga kirje kohta rida: (võti, Q, silt, algus, lõpp, olek)."""
    rows = []
    for key, entry in sorted(entries.items()):
        qid = entry.get("id")
        if not qid:
            continue
        label = (entry.get("labels") or {}).get("et") or key
        if entry.get("active_from") is not None or entry.get("active_to") is not None:
            rows.append((key, qid, label, entry.get("active_from"), entry.get("active_to"), "olemas"))
            continue
        entity = entities.get(qid) or {}
        if "missing" in entity or not entity:
            rows.append((key, qid, label, None, None, "Wikidatas puudub"))
            continue
        start, why_start = claim_year(entity, "P571")
        end, why_end = claim_year(entity, "P576")
        problems = [why for why in (why_start, why_end) if why]
        if start is not None and end is not None and start > end:
            problems.append(f"algus {start} > lõpp {end}")
        if problems:
            rows.append((key, qid, label, start, end, "vahele: " + "; ".join(problems)))
        elif start is None and end is None:
            rows.append((key, qid, label, None, None, "aastaid pole"))
        else:
            rows.append((key, qid, label, start, end, "täida"))
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="kirjuta (vaikimisi kuivkäivitus)")
    args = parser.parse_args()

    entries = registries.load("institution")
    ids = sorted({entry["id"] for entry in entries.values() if entry.get("id")})
    rows = plan(entries, fetch_entities(ids))
    for key, qid, label, start, end, status in rows:
        years = "" if start is None and end is None else f"{start or ''}–{end or ''}"
        print(f"{key:32} {qid:11} {years:11} {status:18} {label}")
    todo = {key: {**entries[key], **({"active_from": start} if start is not None else {}),
                  **({"active_to": end} if end is not None else {})}
            for key, _q, _l, start, end, status in rows if status == "täida"}
    print(f"\nQ-koodiga {len(rows)}, täita {len(todo)}, Q-koodita {len(entries) - len(rows)}")
    if not args.apply:
        print("Kuivkäivitus — kirjutamiseks lisa --apply")
        return 0
    registries.put_many("institution", todo, "Automaatne",
                        f"Register institution: tegutsemisaeg Wikidatast ({len(todo)} kirjet)")
    print(f"Kirjutatud {len(todo)} kirjet, üks commit.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
