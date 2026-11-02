#!/usr/bin/env python3
"""Koopia märkus → `reproduction` väli (ADR 0076 §11).

Jaansoni import ja ESTERi ettepanekud kirjutasid koopia liigi eksemplari märkusesse
(„Paberkoopia", „Koopia", „Koopia (Skarast)", „Fotokoopia"). Nüüd on see struktureeritud:
`reproduction: {kind}`. `of` (mille koopia) jääb täitmata — märkus seda ei ütle.

Teisendatakse ainult märkus, mis koosneb TERVIKUNA koopia liigist (ja sulgudes
täpsustusest, mis jääb märkuseks). Muu märkus, kus „koopia" esineb, läheb raportisse.
Kirjel, millel `reproduction` on juba olemas, ei muudeta midagi. Üks commit.

  python3 scripts/migrate_reproduction.py            # kuivkäivitus
  python3 scripts/migrate_reproduction.py --apply
"""
import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

_KINDS = {"paberkoopia": "paberkoopia", "koopia": "koopia", "fotokoopia": "fotokoopia",
          "mikrofilm": "mikrofilm", "digikoopia": "digikoopia"}
_NOTE = re.compile(r"^\s*(paberkoopia|fotokoopia|digikoopia|mikrofilm|koopia)\s*(?:\((.*)\))?\s*\.?\s*$",
                   re.IGNORECASE)


def convert(x: dict):
    """Eksemplar → (uus eksemplar | None, raporti rida | None). Puhas funktsioon."""
    notes = x.get("notes") or ""
    low = notes.casefold()
    if x.get("reproduction") or not ("koopia" in low or "mikrofilm" in low):
        return None, None
    m = _NOTE.match(notes)
    if not m:
        return None, f"{x.get('holder')} {x.get('shelfmark') or ''}: märkus jääb ({notes[:80]!r})"
    out = {**x, "reproduction": {"kind": _KINDS[m.group(1).casefold()]}}
    rest = (m.group(2) or "").strip()
    if rest:
        out["notes"] = rest
    else:
        out.pop("notes", None)
    return out, None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="kirjuta (vaikimisi kuivkäivitus)")
    ap.add_argument("--data-dir", help="andmekaust (vaikimisi server.config)")
    args = ap.parse_args()
    if args.data_dir:
        os.environ["VUTT_DATA_DIR"] = os.path.abspath(args.data_dir)
    from server.config import BASE_DIR

    items, kinds, report, n = [], {}, [], 0
    for entry in sorted(os.scandir(BASE_DIR), key=lambda e: e.name):
        meta_path = os.path.join(entry.path, "_metadata.json")
        if not entry.is_dir() or not os.path.exists(meta_path):
            continue
        with open(meta_path, encoding="utf-8") as f:
            meta = json.load(f)
        changed = False
        for x in meta.get("exemplars") or []:
            if not isinstance(x, dict):
                continue
            new, line = convert(x)
            if line:
                report.append(f"{meta.get('id')}: {line}")
            if new:
                changed = True
                n += 1
                kinds[new["reproduction"]["kind"]] = kinds.get(new["reproduction"]["kind"], 0) + 1
        if not changed:
            continue

        def transform(m: dict) -> dict:
            return {"exemplars": [convert(x)[0] or x if isinstance(x, dict) else x
                                  for x in m.get("exemplars") or []]}

        items.append((meta_path, transform))

    print(f"Teoseid: {len(items)}; eksemplare: {n}; liigid: {kinds}")
    if report:
        print("ÜLEVAATUSEKS (märkuses „koopia“, aga ei teisendata):")
        for r in report:
            print(f"  - {r}")
    if not args.apply:
        print("Kuivkäivitus — --apply kirjutab.")
        return 0
    if items:
        from server.metadata_ops import bulk_update_works
        res = bulk_update_works(items, "Automaatne",
                                f"Eksemplarid: koopia märkus → reproduction ({n} eksemplari, ADR 0076 §11)",
                                all_or_nothing=True)
        print(f"→ {res}")
        if res.get("failed") or not res.get("git_committed"):
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
