"""Kasutusstatistika lugemine admin-lehele (#855).

Päevakokkuvõtted kirjutab HOSTI cron `scripts/usage_stats.py` nginxi logist;
backend ainult loeb ja koondab valitud perioodi. Failis ei ole IP-sid ega
User-Agente — ainult arvud ja top-loendid (teose/isiku ID, viitaja domeen,
roboti nimi).

Teose pealkiri lisatakse ainult siis, kui kutsuja tohib teost lugeda
(`can_read_work`) — kogudega piiratud admin ei tohi statistika kaudu näha
talle nähtamatu teose pealkirja. ID ise ei ütle midagi.
"""
from __future__ import annotations

import json
from collections import Counter
from typing import Dict, List, Optional

from .config import USAGE_STATS_FILE, get_logger

logger = get_logger(__name__)

# Summeeritavad päevaväljad. `visitors`, `logged_in` ja `bot_ips` on päeva
# unikaalsed IP-d — perioodi summa ei ole unikaalsete arv, seepärast annab
# koond nende puhul päevakeskmise ja maksimumi, mitte summat.
SUM_FIELDS = ("requests", "page_loads", "meili_queries", "saves", "polling",
              "bot_requests", "monitoring")
DAILY_UNIQUE_FIELDS = ("visitors", "logged_in", "bot_ips")
TOP_FIELDS = ("top_works", "top_persons", "referrers", "bots")
TOP_N = 10
MAX_PERIOD_DAYS = 1100


def load_days(path: Optional[str] = None) -> List[dict]:
    try:
        with open(path or USAGE_STATS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        return []
    except (OSError, ValueError):
        logger.warning("usage_stats.json lugemine ebaõnnestus", exc_info=True)
        return []
    days = data.get("days") if isinstance(data, dict) else None
    if not isinstance(days, list):
        return []
    return sorted((d for d in days if isinstance(d, dict) and isinstance(d.get("date"), str)),
                  key=lambda d: d["date"])


def aggregate(days: List[dict], period: int) -> dict:
    """Viimased `period` päeva + koond. Puhas funktsioon."""
    period = max(1, min(int(period), MAX_PERIOD_DAYS))
    window = days[-period:]
    totals: Dict[str, int] = {f: sum(int(d.get(f) or 0) for d in window) for f in SUM_FIELDS}
    daily: Dict[str, dict] = {}
    for f in DAILY_UNIQUE_FIELDS:
        values = [int(d.get(f) or 0) for d in window]
        daily[f] = {
            "avg": round(sum(values) / len(values), 1) if values else 0,
            "max": max(values) if values else 0,
        }
    tops: Dict[str, List[list]] = {}
    for f in TOP_FIELDS:
        c: Counter = Counter()
        for d in window:
            for row in d.get(f) or []:
                if isinstance(row, list) and len(row) == 2 and isinstance(row[0], str):
                    c[row[0]] += int(row[1] or 0)
        tops[f] = [[k, n] for k, n in c.most_common(TOP_N)]
    return {
        "days": [{k: d.get(k) for k in ("date",) + SUM_FIELDS + DAILY_UNIQUE_FIELDS} for d in window],
        "totals": totals,
        "daily": daily,
        "tops": tops,
        "first_date": days[0]["date"] if days else None,
    }


def _work_title(work_id: str, user: dict) -> Optional[str]:
    from .access_ops import can_read_work
    from .work_sets_access import load_work_metadata_by_id
    try:
        meta = load_work_metadata_by_id(work_id)
    except (OSError, ValueError):
        return None
    if not meta or not can_read_work(meta, user):
        return None
    title = meta.get("title")
    return title if isinstance(title, str) and title else None


def _person_name(person_id: str) -> Optional[str]:
    from .prosopography.person_crud import get_person
    person = get_person(person_id)
    if not person:
        return None
    return (person.get("name") or {}).get("label") or None


def with_labels(agg: dict, user: dict) -> dict:
    """Lisab top-loenditele sildid: `[id, n]` → `{id, n, label}`. Tundmatu → label None."""
    tops = agg["tops"]
    tops["top_works"] = [{"id": k, "n": n, "label": _work_title(k, user)} for k, n in tops["top_works"]]
    tops["top_persons"] = [{"id": k, "n": n, "label": _person_name(k)} for k, n in tops["top_persons"]]
    for f in ("referrers", "bots"):
        tops[f] = [{"id": k, "n": n, "label": None} for k, n in tops[f]]
    return agg
