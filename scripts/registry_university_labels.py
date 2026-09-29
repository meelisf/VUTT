#!/usr/bin/env python3
"""
Ülikoolide registrinimed linnanimest asutuse nimeks (ADR 0059, 2026-09-29).

Migratsioon (#462) andis 21 ülikoolile nimeks linna („Rostock"), sest AA kirjutab
nii. Isikuvormi „Seo: Rostock" näis siis kohana. Nimi tuleb siit tabelist (inimese
kinnitatud, Wikidata et-nimed kontrollitud; puuduvad tehtud eesti käänamise järgi),
linnanimi jääb NIMEVARIANDIKS — registriotsing leiab AA kuju „Rostock" edasi.
Kirje, mille nimi ei ole enam linnanimi, jäetakse puutumata.

Vaikimisi kuivkäivitus. Kirjutus = üks git-commit, autor „Automaatne":
    docker exec -w /app vutt-backend python3 scripts/registry_university_labels.py
    docker exec -w /app vutt-backend python3 scripts/registry_university_labels.py --apply
"""
import argparse
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

from server.prosopography import registries  # noqa: E402

# võti → (et, en, lisavariandid)
LABELS = {
    "univ-abo": ("Turu Akadeemia", "Royal Academy of Turku", ["Academia Aboensis"]),
    "univ-altdorf": ("Altdorfi ülikool", "University of Altdorf", []),
    "univ-erfurt": ("Erfurdi ülikool", "University of Erfurt", []),
    "univ-franeker": ("Franekeri ülikool", "University of Franeker", []),  # + Q1293929 (QIDS)
    "univ-frankfurt-oder": ("Frankfurdi (Oderi) ülikool", "University of Frankfurt (Oder)", ["Alma Mater Viadrina", "Viadrina"]),
    "univ-giessen": ("Gießeni ülikool", "University of Giessen", []),
    "univ-greifswald": ("Greifswaldi ülikool", "University of Greifswald", []),
    "univ-groningen": ("Groningeni ülikool", "University of Groningen", []),
    "univ-halle": ("Halle ülikool", "University of Halle", []),
    "univ-helmstedt": ("Helmstedti ülikool", "University of Helmstedt", []),
    "univ-jena": ("Jena ülikool", "University of Jena", []),
    "univ-kiel": ("Kieli ülikool", "Kiel University", []),
    "univ-konigsberg": ("Königsbergi ülikool", "University of Königsberg", ["Albertina"]),
    "univ-kopenhagen": ("Kopenhaageni ülikool", "University of Copenhagen", []),  # + Q186285 (QIDS)
    "univ-leiden": ("Leideni ülikool", "Leiden University", []),
    "univ-leipzig": ("Leipzigi ülikool", "Leipzig University", []),
    "univ-lund": ("Lundi ülikool", "Lund University", []),
    "univ-rostock": ("Rostocki ülikool", "University of Rostock", []),
    "univ-tubingen": ("Tübingeni ülikool", "University of Tübingen", []),
    "univ-uppsala": ("Uppsala ülikool", "Uppsala University", []),
    "univ-wittenberg": ("Wittenbergi ülikool", "University of Wittenberg", []),
}

# Q-koodita kirjed, mille Wikidata vaste on kinnitatud (2026-09-29).
QIDS = {"univ-kopenhagen": "Q186285", "univ-franeker": "Q1293929"}


def plan(entries: dict) -> dict:
    """Uued kirjed neile, kelle nimi on veel linnanimi (et-silt = vana kuju)."""
    out = {}
    for key, (et, en, extra) in LABELS.items():
        entry = entries.get(key)
        if not isinstance(entry, dict):
            continue
        old = entry.get("labels") or {}
        qid = entry.get("id") or QIDS.get(key)
        if old.get("et") == et and entry.get("id") == qid:
            continue
        variants, seen = [], {et.casefold(), en.casefold()}
        for value in [*old.values(), *extra, *(entry.get("variants") or [])]:
            if value and value.casefold() not in seen:
                variants.append(value)
                seen.add(value.casefold())
        out[key] = {**entry, "id": qid, "labels": {**old, "et": et, "en": en}, "variants": variants}
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="kirjuta (vaikimisi kuivkäivitus)")
    args = parser.parse_args()
    entries = registries.load("institution")
    todo = plan(entries)
    for key, new in sorted(todo.items()):
        old = entries[key]["labels"].get("et")
        added = f" +{new['id']}" if new["id"] != entries[key].get("id") else ""
        print(f"{key:22} {old!s:18} → {new['labels']['et']:28} | {new['labels']['en']:32}{added} | {', '.join(new['variants'])}")
    print(f"\nMuuta {len(todo)} / {len(LABELS)}")
    if not args.apply:
        print("Kuivkäivitus — kirjutamiseks lisa --apply")
        return 0
    registries.put_many("institution", todo, "Automaatne",
                        f"Register institution: ülikoolide nimed linnanimest asutuse nimeks ({len(todo)})")
    print(f"Kirjutatud {len(todo)} kirjet, üks commit.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
