#!/usr/bin/env python3
"""Kolib `biography` keelega väljadesse: `biography_et` või `aa_raw`.

KAKS PASSI (expand–migrate–contract, vt spekk „Avaliku API üleminek"):
  pass a — kirjutab uue välja, JÄTAB `biography` alles (vana kood loeb edasi)
  pass b — eemaldab `biography` (alles pärast tootmiskontrolli)

Kasutus (serveris, KONTEINERIST — `data/` git commitib root'ina):
  docker exec vutt-backend python3 scripts/migrate_biography_language_fields.py
  # → aruanne stdout'i + biography_mapping.json; inimene vaatab üle
  docker exec vutt-backend python3 scripts/migrate_biography_language_fields.py \
      --apply --pass a --mapping biography_mapping.json --commit

Kuivkäivitus on VAIKIMISI (nagu `scripts/detect_greek.py`) ega kirjuta midagi.
`--apply` loeb AINULT vastendusfaili, mitte oma klassifikaatorit — nii on
inimese ülevaatus tegelik värav, mitte formaalsus.
"""
import argparse
import json
import os
import subprocess
import sys
import types
from datetime import datetime, timezone
from typing import List, Optional

# Fake-package muster (vt `scripts/detect_greek.py`): registreerib `server`
# nimeruumi ILMA `server/__init__.py` käivitamiseta — muidu tõmbaks import
# kaasa FastAPI ja gitpythoni, mida hosti venv-is ei ole.
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if "server" not in sys.modules:
    _server_pkg = types.ModuleType("server")
    _server_pkg.__path__ = [os.path.join(_PROJECT_ROOT, "server")]
    _server_pkg.__package__ = "server"
    sys.modules.setdefault("server", _server_pkg)
sys.path.insert(0, _PROJECT_ROOT)

from server.prosopo_biography_fields import (  # noqa: E402
    AA_RAW, LEGACY_BIOGRAPHY, classify, suspicion_flags, text_hash,
)

PREVIEW_CHARS = 200
IMAGES_DIR_NAME = "images"


def _prosopo_dir() -> str:
    """Isikukaartide kaust. `server.config` on ainuõige allikas (CLAUDE.md)."""
    from server.config import PROSOPOGRAPHY_DIR
    return PROSOPOGRAPHY_DIR


def load_persons(prosopo_dir: str, skipped: Optional[List[str]] = None) -> List[dict]:
    """Laeb kõik isikukaardid. Pildikaust jäetakse vahele.

    Loetamatu/katkine JSON jäetakse samuti vahele, AGA mitte vaikides — see
    skript on migratsiooni inimülevaatuse värav ja spekk nõuab, et aruanne
    kataks KÕIK täidetud kirjed. Kui `skipped` on antud, lisatakse sinna
    vahelejäetud failinimed (aruanne saab siis näidata, et midagi puudu jäi).
    """
    persons = []
    for entry in sorted(os.scandir(prosopo_dir), key=lambda e: e.name):
        if not entry.is_file() or not entry.name.endswith(".json"):
            continue
        if IMAGES_DIR_NAME in entry.path.split(os.sep):
            continue
        try:
            with open(entry.path, encoding="utf-8") as f:
                doc = json.load(f)
        except Exception as e:
            # Ainult failinimi + veatüüp stderr'i — mitte sisu ega teed
            # (vt „Saladused tool-outputis" — isikuandmed ei kuulu logisse).
            print(f"HOIATUS: {entry.name} loetamatu ({type(e).__name__}), jäetakse vahele",
                  file=sys.stderr)
            if skipped is not None:
                skipped.append(entry.name)
            continue
        if isinstance(doc, dict) and doc.get("id"):
            persons.append(doc)
    return persons


def _aa_median(persons: List[dict]) -> int:
    """AA-ks liigituvate tekstide mediaanpikkus — `pikkus_kahtlane` lipu alus.

    Arvutatakse ANDMETEST, mitte konstandist: korpus kasvab ja sisse kirjutatud
    number vananeks vaikselt.
    """
    pikkused = sorted(
        len(p[LEGACY_BIOGRAPHY])
        for p in persons
        if p.get(LEGACY_BIOGRAPHY) and classify(p[LEGACY_BIOGRAPHY]) == AA_RAW
    )
    if not pikkused:
        return 0
    return pikkused[len(pikkused) // 2]


def build_mapping(persons: List[dict]) -> dict:
    """Kõik täidetud `biography` kirjed → vastendusfaili kuju."""
    mediaan = _aa_median(persons)
    entries = []
    for person in persons:
        tekst = person.get(LEGACY_BIOGRAPHY)
        target = classify(tekst)
        if target is None:
            continue
        entries.append({
            "id": person["id"],
            "name": (person.get("name") or {}).get("label") or "",
            "length": len(tekst),
            "target": target,
            "source_hash": text_hash(tekst),
            "flags": suspicion_flags(tekst, target, mediaan),
            "preview": tekst[:PREVIEW_CHARS],
        })
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "aa_median_length": mediaan,
        "entries": entries,
    }


def format_report(mapping: dict) -> str:
    """Inimloetav aruanne. LIPUGA READ ON ALGUSES — need vajavad otsust."""
    entries = mapping["entries"]
    lipuga = [e for e in entries if e["flags"]]
    puhtad = [e for e in entries if not e["flags"]]

    read = [
        "MIGRATSIOONI KUIVKÄIVITUS",
        f"  kirjeid kokku: {len(entries)}",
        f"  → {AA_RAW}: {sum(1 for e in entries if e['target'] == AA_RAW)}",
        f"  → elulugu:    {sum(1 for e in entries if e['target'] != AA_RAW)}",
        f"  lipuga:       {len(lipuga)}",
        f"  AA mediaanpikkus: {mapping['aa_median_length']}",
    ]
    vahele_jaetud = mapping.get("skipped_count", 0)
    if vahele_jaetud:
        read.append(f"  vahele jäetud (loetamatu): {vahele_jaetud}")
    read.append("")
    for pealkiri, grupp in (("LIPUGA (vaata üle)", lipuga), ("PUHTAD", puhtad)):
        read.append(f"── {pealkiri} ──")
        for e in grupp:
            lipud = (" [" + ", ".join(e["flags"]) + "]") if e["flags"] else ""
            read.append(f"{e['id']}  {e['name']}  {e['length']} märki  → {e['target']}{lipud}")
            read.append("    " + e["preview"].replace("\n", " ⏎ "))
        read.append("")
    return "\n".join(read)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mapping", default="biography_mapping.json",
                        help="Vastendusfaili tee (kuivkäivitus kirjutab, --apply loeb)")
    parser.add_argument("--apply", action="store_true", help="Kirjuta muudatused kaartidele")
    parser.add_argument("--pass", dest="pass_", choices=("a", "b"),
                        help="a = kirjuta uus väli; b = eemalda `biography`")
    parser.add_argument("--commit", action="store_true", help="Tee data/ git commit")
    args = parser.parse_args()

    prosopo_dir = _prosopo_dir()
    if not os.path.isdir(prosopo_dir):
        print(f"VIGA: kausta ei ole: {prosopo_dir}", file=sys.stderr)
        return 1

    if not args.apply:
        skipped: List[str] = []
        mapping = build_mapping(load_persons(prosopo_dir, skipped=skipped))
        mapping["skipped_count"] = len(skipped)
        with open(args.mapping, "w", encoding="utf-8") as f:
            json.dump(mapping, f, ensure_ascii=False, indent=2)
        print(format_report(mapping))
        print(f"Vastendus kirjutatud: {args.mapping}")
        print("Vaata lipuga read üle, paranda vajadusel `target`, siis --apply --pass a")
        return 0

    if not args.pass_:
        print("VIGA: --apply nõuab --pass a või --pass b", file=sys.stderr)
        return 1
    print("VIGA: --apply ei ole veel teostatud (ülesanded 3–4)", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
