#!/usr/bin/env python3
"""
Tagantjärele täitmine (#427, ADR 0052): kaartide sünni-/surmakohad kohtade
registrisse ja tühi päritolu sünnikohast.

Sama tee mis automaatrikastusel (`auto_enrich_runner.run_place_fill`): registrisse
lähevad ainult kohad, millele ahel või ankur annab grupi; grupita kohad ja
nimevasted Q-koodita registrikirjega lähevad kaardi ülevaatusse
(`review.place_proposals`). Olemasolevat päritolu ei kirjutata üle.

Vaikimisi kuivkäivitus (ei kirjuta midagi). Käivitus serveris:
    docker exec -w /app vutt-backend python3 scripts/backfill_places_from_birth.py
    docker exec -w /app vutt-backend python3 scripts/backfill_places_from_birth.py --apply
"""
import argparse
import collections
import glob
import json
import os
import sys
import types

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if "server" not in sys.modules:
    _server_pkg = types.ModuleType("server")
    _server_pkg.__path__ = [os.path.join(BASE_DIR, "server")]
    _server_pkg.__package__ = "server"
    sys.modules.setdefault("server", _server_pkg)
sys.path.insert(0, BASE_DIR)

from server.config import PROSOPOGRAPHY_DIR  # noqa: E402
from server.prosopography import place_resolve as pr  # noqa: E402
from server.prosopography import places_ops as po  # noqa: E402
from server.prosopography.auto_enrich import PLACE_FIELDS, card_place_qid  # noqa: E402


def _cards():
    for path in sorted(glob.glob(os.path.join(PROSOPOGRAPHY_DIR, "*.json"))):
        try:
            with open(path, encoding="utf-8") as f:
                card = json.load(f)
        except Exception:
            continue
        if card.get("merged_into") or card.get("record_status") == "tombstone":
            continue
        if any(card_place_qid(card, p) for p in PLACE_FIELDS):
            yield card


def dry_run() -> None:
    places = po._load_places_cache(force_reload=True)
    anchors = pr.load_anchors()
    cache: dict = {}

    def fetch(q):
        if q not in cache:
            cache[q] = po.fetch_place_wikidata(q)
        return cache[q]

    stats = collections.Counter()
    origin_fill = 0
    for card in _cards():
        for prefix in PLACE_FIELDS:
            q = card_place_qid(card, prefix)
            if not q:
                continue
            res = pr.resolve_place(q, places=places, anchors=anchors, fetch=fetch)
            plan = pr.plan_register_entry(res, places)
            stats[(prefix, plan["action"])] += 1
            origin_empty = not (card.get("origin") or {}).get("place")
            if prefix == "birth" and origin_empty and plan["action"] in ("exists", "create"):
                origin_fill += 1
            if plan["action"] != "exists":
                detail = plan.get("key") or ""
                if plan["action"] == "create":
                    e = plan["entry"]
                    detail = f'{plan["key"]} → parent={e["parent_key"]} group={e["group"]}'
                print(f'{card["id"]} {prefix} {q} {plan["action"]}: {detail}')
    print()
    for (prefix, action), n in sorted(stats.items()):
        print(f"{n:4} {prefix} {action}")
    print(f"{origin_fill:4} kaardil täituks päritolu sünnikohast")


def apply() -> None:
    from server.prosopography import auto_enrich_runner as runner
    from server.prosopography.ops import rebuild_indices
    changed = 0
    for card in _cards():
        if runner.run_place_fill(card["id"]) is not None:
            changed += 1
            print("muudetud:", card["id"])
    print(f"{changed} kaarti muudetud; taastan indeksid…")
    rebuild_indices()
    print("valmis")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--apply", action="store_true", help="kirjuta (vaikimisi kuivkäivitus)")
    (apply if ap.parse_args().apply else dry_run)()
