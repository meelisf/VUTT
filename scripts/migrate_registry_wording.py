#!/usr/bin/env python3
"""Seotud fakti sõnastus → registrile tuntud nimi (ADR 0059 täiendus 2026-10-05).

KAKS reeglit:
  1. Amet: `label`, mis ei ole registri nimi ega variant („Professore Ordinario"),
     saab registri nime; sõnastus läheb `notes`-i („Allikas: „…""). Reegel ise elab
     `registries.normalize_person_facts`-is ja kehtib igal salvestusel.
  2. Asutus (ainult see skript, ühekordne): TÕENDITA fakti `institution`, mis ei
     ole registrile tuntud nimi, saab registri nime ILMA märketa — see oli
     rikastuse vaiketekst („Academia Gustaviana" AGC võtmega, 594 fakti), mitte
     allika sõnastus.

Kaardid käivad läbi tavalise salvestustee (`update_person`: isikulukk,
versioonikontroll, git).

Kasutus (serveris, KONTEINERIST):
  docker exec vutt-backend python3 scripts/migrate_registry_wording.py          # kuivkäivitus
  docker exec vutt-backend python3 scripts/migrate_registry_wording.py --apply
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

AUTHOR = "Automaatne"


def fix_institutions(sections: dict, institutions: dict, known, name) -> dict:
    """Reegel 2: tõendita asutusefakti tundmatu sõnastus → registri nimi. Puhas."""
    out = {}
    for section, facts in sections.items():
        fixed = []
        for fact in facts:
            fact = dict(fact) if isinstance(fact, dict) else fact
            key = fact.get("institution_key") if isinstance(fact, dict) else None
            entry = institutions.get(key) if key else None
            text = str(fact.get("institution") or "").strip() if isinstance(fact, dict) else ""
            if entry and text and not fact.get("evidence") and text.casefold() not in known(entry):
                fact["institution"] = name(entry, key)
            fixed.append(fact)
        out[section] = fixed
    return out


def plan(person: dict, normalize, fix) -> tuple[dict, list[tuple[str, dict, dict]]]:
    """(saadetavad sektsioonid, [(sektsioon, enne, pärast)]). Puhas (testitav)."""
    before = {s: person.get(s) or [] for s in ("occupations", "education")}
    sent = fix(before)
    after = normalize(sent)
    return sent, [(s, a, b) for s in before for a, b in zip(before[s], after[s]) if a != b]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="kirjuta (vaikimisi kuivkäivitus)")
    args = ap.parse_args()

    import glob
    import json
    from server.config import PROSOPOGRAPHY_DIR
    from server.prosopography.person_crud import get_person, update_person
    from server.prosopography import registries
    from server.prosopography.registries import normalize_person_facts
    institutions = registries.load("institution")
    fix = lambda sections: fix_institutions(sections, institutions, registries._known_names, registries.registry_name)  # noqa: E731

    facts = cards = skipped = 0
    for path in sorted(glob.glob(os.path.join(PROSOPOGRAPHY_DIR, "*.json"))):
        try:
            with open(path, encoding="utf-8") as f:
                person_id = (json.load(f) or {}).get("id")   # failinimi ≠ id („folxea3" ↔ vutt:Pfolxea3)
        except (OSError, ValueError):
            continue
        person = get_person(person_id) if person_id else None
        if not person or person.get("merged_into"):
            continue
        sent, changes = plan(person, normalize_person_facts, fix)
        if not changes:
            continue
        cards += 1
        facts += len(changes)
        for section, before, after in changes:
            diff = {k: (before.get(k), after.get(k)) for k in set(before) | set(after) if before.get(k) != after.get(k)}
            print(f"{person['id']} {section}: {diff}")
        if args.apply:
            try:
                update_person(person["id"], {"updated_at": person.get("updated_at"), **sent}, AUTHOR)
            except ValueError as e:     # conflict: kaarti muudeti vahepeal → käivita uuesti
                skipped += 1
                print(f"  VAHELE ({e})")
    print(f"KOKKU {facts} fakti {cards} kaardil"
          + (f", vahele jäi {skipped}" if skipped else "")
          + ("" if args.apply else " (kuivkäivitus, --apply kirjutab)"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
