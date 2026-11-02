#!/usr/bin/env python3
"""Jaansoni leidumuse plaan → eksemplarid (SERVERI samm; ADR 0076 §9).

Plaani koostab lokaalselt `scripts/jaanson_plan.py`. Siin rakendatakse see ühe commitiga
(`bulk_update_works`), iga teose seisu loetakse `metadata_lock`-i all uuesti:

- uus eksemplar: `source = {kind: "jaanson", ref: "Jaanson N", at}`, `needs_review: true`
  (automaatselt loodud, ADR 0076 p 2), tekstitunnistajat EI märgita;
- teose märkustesse rida „Jaanson N", kui seda seal veel pole;
- juba olemas → jäetakse vahele (raportis):
  * kohaviidata kirje: teosel on sama hoidja eksemplar (Jaanson loetleb hoidjaid,
    mitte eksemplare);
  * kohaviidaga kirje: sama hoidja + kohaviit (`work_exemplars.duplicate_of`);
  * TÜR-i original: teosel on juba TÜR-i eksemplar, mis pole paberkoopia
    (kohaviit võib erineda kujult, nt „(konvoluut)");
- käsikirjale midagi ei lisata (Jaansoni kirjed on trükised; vaste on kahtlane).

Protsessidevahelist lukku ei ole: käivita backendi seisu ajal (nagu ADR 0076 p 8).

  python3 scripts/jaanson_apply.py jaanson_plan.json            # kuivkäivitus
  python3 scripts/jaanson_apply.py jaanson_plan.json --apply
"""
import argparse
import json
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

TUR = "Tartu TÜR"
COPY_PREFIX = "R Acad. Dorp."


def note_line(nr: int) -> str:
    return f"Jaanson {nr}"


def apply_to_meta(meta: dict, item: dict, today: str) -> tuple[dict, list[str]]:
    """Plaani rida teose seisule → (muudetavad väljad | {}, raporti read). Puhas funktsioon."""
    from server import work_exemplars as we
    if we.is_manuscript(meta):
        return {}, ["käsikiri — jäeti vahele"]
    existing = [x for x in meta.get("exemplars") or [] if isinstance(x, dict)]
    ids = {x.get("id") for x in existing}
    ref = note_line(item["nr"])
    added, skipped = [], []
    for p in item["exemplars"]:
        holder, shelf = p["holder"], p.get("shelfmark")
        current = existing + added
        same_holder = [x for x in current if x.get("holder") == holder]
        if not shelf and same_holder:
            skipped.append(f"{holder}: olemas")
            continue
        if shelf and we.duplicate_of({"holder": holder, "shelfmark": shelf}, current):
            skipped.append(f"{holder} {shelf}: olemas")
            continue
        if holder == TUR and shelf and not shelf.startswith(COPY_PREFIX) and any(
                not (x.get("shelfmark") or "").startswith(COPY_PREFIX) for x in same_holder):
            skipped.append(f"{holder} {shelf}: TÜR-i original olemas teise kohaviidaga "
                           f"({', '.join(x.get('shelfmark') or '—' for x in same_holder)})")
            continue
        ex_id = we._new_id(ids)
        ids.add(ex_id)
        added.append(we.normalize_exemplar({
            "id": ex_id, **p, "source": {"kind": "jaanson", "ref": ref, "at": today},
            "needs_review": True}))
    out = {}
    if added:
        out["exemplars"] = existing + added
    notes = meta.get("notes") or ""
    if ref not in notes:
        out["notes"] = f"{notes.rstrip()}\n\n{ref}".strip() if notes.strip() else ref
    report = [f"+ {x['holder']}" + (f" {x['shelfmark']}" if x.get("shelfmark") else "") for x in added]
    return out, report + [f"= {s}" for s in skipped]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("plan")
    ap.add_argument("--apply", action="store_true", help="kirjuta (vaikimisi kuivkäivitus)")
    ap.add_argument("--data-dir", help="andmekaust (vaikimisi server.config)")
    ap.add_argument("--verbose", action="store_true", help="näita iga teose read")
    args = ap.parse_args()
    if args.data_dir:
        os.environ["VUTT_DATA_DIR"] = os.path.abspath(args.data_dir)

    from server.archives_registry import read_archives
    from server.config import ARCHIVES_FILE
    from server.utils import find_directory_by_id

    with open(args.plan, encoding="utf-8") as f:
        plan = json.load(f)
    archives = read_archives(ARCHIVES_FILE)
    unknown = sorted({x["holder"] for w in plan["works"] for x in w["exemplars"]} - set(archives))
    if unknown:
        # Hoidja on kohustuslik ja peab olema registris — ilma ümbernimetamiseta (PR #725) ei saa.
        print(f"PEATUS: hoidjad puuduvad registrist: {', '.join(unknown)}")
        return 2

    today = date.today().isoformat()
    items, missing, n_add, n_skip, n_notes, n_works = [], [], 0, 0, 0, 0
    for item in plan["works"]:
        work_dir = find_directory_by_id(item["work_id"])
        meta_path = os.path.join(work_dir, "_metadata.json") if work_dir else None
        if not meta_path or not os.path.exists(meta_path):
            missing.append(item["work_id"])
            continue
        with open(meta_path, encoding="utf-8") as f:
            changes, report = apply_to_meta(json.load(f), item, today)
        n_add += sum(1 for r in report if r.startswith("+"))
        n_skip += sum(1 for r in report if r.startswith("="))
        n_notes += "notes" in changes
        if args.verbose or any(r.startswith("=") or "käsikiri" in r for r in report):
            print(f"{item['work_id']} (Jaanson {item['nr']}): " + "; ".join(report))
        if not changes:
            continue
        n_works += 1

        def transform(m: dict, item=item) -> dict:
            # Kirjutusel uuesti elava seisu vastu (sama loogika, mis kuivkäivitusel).
            return apply_to_meta(m, item, today)[0]

        items.append((meta_path, transform))

    print(f"\nPlaanis teoseid: {len(plan['works'])}; muutub: {n_works}; uusi eksemplare: {n_add}; "
          f"vahele jäetud (olemas): {n_skip}; märkusesse „Jaanson N\": {n_notes}")
    if missing:
        print(f"HOIATUS: {len(missing)} teost ei leitud: {', '.join(missing[:10])}")
    print(f"Plaani ülevaatusnimekirjas: {len(plan.get('review') or [])} rida (ei rakendata)")
    if not args.apply:
        print("Kuivkäivitus — --apply kirjutab.")
        return 0
    if items:
        from server.metadata_ops import bulk_update_works
        res = bulk_update_works(items, "Automaatne",
                                f"Eksemplarid: Jaansoni leidumus ({n_works} teost, {n_add} eksemplari; "
                                f"Jaanson 2000, ADR 0076)", all_or_nothing=True)
        print(f"→ {res}")
        if res.get("failed") or not res.get("git_committed"):
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
