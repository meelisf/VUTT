"""Taustarikastus (spekk §4.3, ADR 0048): võrk ja lukud; loogika on auto_enrich-is.

Järjekord: allikad VÄLJASPOOL lukke → ID-lukk + person_lock → kaart uuesti,
ID-de kehtivus, rakendamine, review, üks salvestus. `enrich_pending` märge on
töö püsiv jälg: iga lõppenud katse eemaldab selle, käivitusel korratakse
pooleli jäänud katseid.
"""
from __future__ import annotations

import glob
import json
import logging
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Optional

from . import state
from ._compat import sync_from_facade
from .auto_enrich import ENRICH_SCHEMES, aggregate, apply_to_card, finish_review
from .enrichment import fetch_remote
from .ext_ids import normalize_ext_id
from .locks import ext_id_claim_lock, person_lock

logger = logging.getLogger(__name__)

# Kaks lõime: välisallikad on aeglased, aga koormus on väike (loomise tempo).
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="auto-enrich")


def _crud():
    from . import person_crud
    return person_crud


def _is_dead(card: Optional[dict]) -> bool:
    return card is None or bool(card.get("merged_into")) or card.get("record_status") == "tombstone"


def _is_pending(card: Optional[dict]) -> bool:
    """Kas kaart ootab veel automaatrikastust (`enrich_pending` reasons-loendis).

    Teine käivitus samal kaardil (nt käivitustaaste, mis jookseb paralleelselt
    värske loomise ajastatud katsega) EI TOHI review-välja uuesti kirjutada —
    esimene katse on kaardi juba lõppolekusse viinud (ja admin võib olla selle
    vahepeal kinnitanud, spekk §3.1: kinnitust ei avata uuesti)."""
    reasons = ((card or {}).get("review") or {}).get("reasons") or []
    return "enrich_pending" in reasons


def _pairs(card: dict) -> list:
    """Kaardi väliste ID-de (skeem, id) paarid kaardi järjekorras, dubleeringuteta.

    Loend, mitte hulk — sihtide ja ebaõnnestunud allikate järjekord (ja seega
    `review.failed_sources` sisu) ei tohi sõltuda Pythoni hulga sisemisest
    (hash-põhisest) järjestusest."""
    return list(dict.fromkeys(
        (i.get("scheme"), normalize_ext_id(i.get("scheme"), i.get("id")))
        for i in card.get("identifiers") or [] if isinstance(i, dict)
    ))


def run_auto_enrichment(person_id: str) -> Optional[dict]:
    crud = _crud()
    sync_from_facade()
    card = crud.get_person(person_id)
    if _is_dead(card) or not _is_pending(card):
        return None
    targets = [(s, i) for s, i in _pairs(card) if s in ENRICH_SCHEMES and i]

    # 1. Võrk — ühegi luku all EI OLE.
    answered, failed = [], []
    for scheme, ext_id in targets:
        try:
            remote = fetch_remote(scheme, ext_id)
        except Exception:
            logger.warning("Automaatrikastus: %s %s:%s ebaõnnestus", person_id, scheme, ext_id, exc_info=True)
            remote = None
        if remote is None:
            failed.append((scheme, ext_id))
        else:
            answered.append({"scheme": scheme, "id": ext_id, "remote": remote})

    # 1b. Seotud ID-d (nt GND `sameAs` → Wikidata), mida kaardil veel pole:
    # küsime ka nende andmed kohe, samuti lukust väljas. Kas ID kaardile
    # tohib minna, otsustatakse alles luku all (ID võib olla teisel kaardil).
    have_schemes = {s for s, _ in targets}
    linked_results: dict = {}
    for scheme, ext_id in aggregate(answered)["linked"].items():
        key = (scheme, normalize_ext_id(scheme, ext_id))
        if scheme in have_schemes or scheme not in ENRICH_SCHEMES or key in linked_results:
            continue
        try:
            linked_results[key] = fetch_remote(*key)
        except Exception:
            logger.warning("Automaatrikastus: %s seotud %s:%s ebaõnnestus", person_id, *key, exc_info=True)
            linked_results[key] = None

    # 2–3. Lukkude all: värske kaart, kehtivus, rakendamine, üks salvestus.
    with ext_id_claim_lock, person_lock(person_id):
        card = crud.get_person(person_id)
        if _is_dead(card) or not _is_pending(card):
            return None
        alles = set(_pairs(card))
        answered = [a for a in answered if (a["scheme"], a["id"]) in alles]
        failed = [f for f in failed if f in alles]
        ids_left = any(p in alles for p in targets)

        # Seotud ID lisatakse ainult siis, kui ta ei ole teisel kaardil; ja AINULT
        # lisatud ID allika andmed lähevad koondamisse — teise isiku kaardile
        # kuuluva ID andmed ei tohi sellele kaardile jõuda.
        dup = False
        added_ids = False
        linked_sources = []
        have = {s for s, _ in alles}
        for scheme, ext_id in aggregate(answered)["linked"].items():
            if scheme in have:
                continue
            key = (scheme, normalize_ext_id(scheme, ext_id))
            found = crud._find_by_external_id(*key)
            owner = crud._resolve_owner(found["id"]) if found else None
            if owner and owner != person_id:
                dup = True
                continue
            card.setdefault("identifiers", []).append(
                {"scheme": key[0], "id": key[1], "checked_at": None})
            added_ids = True
            remote = linked_results.get(key)
            if remote is not None:
                linked_sources.append({"scheme": key[0], "id": key[1], "remote": remote})
            elif scheme in ENRICH_SCHEMES:
                failed.append(key)

        answered = answered + linked_sources
        agg = aggregate(answered)
        applied = apply_to_card(card, agg)
        if added_ids:
            applied.append("identifiers")

        review = card.get("review") or {}
        card["review"] = finish_review(
            review, ids_left=ids_left,
            answered=[a["scheme"] for a in answered], failed=[s for s, _ in failed],
            applied=applied, conflicts=agg["conflicts"], possible_duplicate=dup)
        author = card.get("created_by") or "Automaatne"
        card["updated_at"] = datetime.now(timezone.utc).isoformat()
        card["updated_by"] = author
        name = (card.get("name") or {}).get("label") or person_id
        crud._save_person_locked(card, author, f"Automaatne rikastus: {name} [{person_id}]")
    crud._indices()._update_index_entry(card)
    crud._indices()._update_aliases_entry(card)
    return card


def _run_safely(person_id: str) -> None:
    try:
        run_auto_enrichment(person_id)
    except Exception:
        # enrich_pending jääb alles → järgmine käivitus kordab.
        logger.error("Automaatrikastus kukkus: %s", person_id, exc_info=True)


def schedule_auto_enrichment(person_id: str) -> None:
    _executor.submit(_run_safely, person_id)


def recover_pending() -> int:
    """Ajastab kaardid, kuhu `enrich_pending` jäi alles (katse ei jõudnud lõpule)."""
    sync_from_facade()
    n = 0
    for path in glob.glob(os.path.join(state.PROSOPOGRAPHY_DIR, "*.json")):
        try:
            with open(path, encoding="utf-8") as f:
                card = json.load(f)
        except Exception:
            continue
        if _is_dead(card) or not _is_pending(card):
            continue
        schedule_auto_enrichment(card["id"])
        n += 1
    return n


def start() -> None:
    """Lifespan: registreeri planeerija ja käivita taaste taustalõimes."""
    _crud().set_enrichment_scheduler(schedule_auto_enrichment)

    def _taaste():
        try:
            n = recover_pending()
            if n:
                logger.info("Automaatrikastus: %d pooleliolevat kaarti järjekorda", n)
        except Exception:
            logger.error("Automaatrikastuse taaste ebaõnnestus", exc_info=True)

    threading.Thread(target=_taaste, daemon=True, name="auto-enrich-recover").start()
