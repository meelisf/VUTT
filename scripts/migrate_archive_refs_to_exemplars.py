#!/usr/bin/env python3
"""Arhiiviviited → eksemplarid (ADR 0076 p 8, #710).

Iga `archive_refs` kirje → üks eksemplar: `source.kind: "migration"`, `source.ref` =
algne kirje stringina, `needs_review: true`, tekstitunnistajat EI märgita (üks viide ei
tõesta üht füüsilist eksemplari). Seejärel eemaldatakse `archive_refs`. Kõik teosed
ühe commitiga.

Kasutuselevõtt (ADR 0076 p 8): vana ja uus server ei tohi kumbki näha teise kuju.
  1. docker stop vutt-backend
  2. uue image'iga: kuivkäivitus, siis --apply
  3. server_update.sh --no-cache + frontendi rsync
  4. server_seed_data.sh (täisreindeks) + kontroll

Kasutus:
  python3 scripts/migrate_archive_refs_to_exemplars.py            # kuivkäivitus
  python3 scripts/migrate_archive_refs_to_exemplars.py --apply
  python3 scripts/migrate_archive_refs_to_exemplars.py --data-dir /koopia   # proov koopial
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def migrate_meta(meta: dict) -> tuple[list, list]:
    """Teose uued eksemplarid + hoiatused. Puhas funktsioon (testitav).

    Olemasolevad eksemplarid jäävad ette (kordus ei tekita duplikaate: sama hoidja +
    kohaviidaga kirje jäetakse vahele).
    """
    from server.work_exemplars import exemplars_from_archive_refs, is_manuscript
    existing = list(meta.get("exemplars") or [])
    have = {(x.get("holder"), x.get("shelfmark") or "") for x in existing}
    refs, warnings = [], []
    for r in meta.get("archive_refs") or []:
        if not isinstance(r, dict):
            warnings.append(f"vigane kirje {r!r}")
            continue
        key = (str(r.get("archive_id") or "").strip(), str(r.get("reference") or "").strip())
        if not key[0]:
            warnings.append(f"hoidjata viide jäeti välja: {key[1]!r}")
            continue
        if key in have:
            continue
        have.add(key)
        refs.append(r)
    manuscript = is_manuscript(meta)
    if manuscript and len(existing) + len(refs) > 1:
        warnings.append("käsikirjal on mitu viidet — kõik saavad needs_review, inimene jätab ühe")
    new = exemplars_from_archive_refs(refs, "migration", existing_ids={x.get("id") for x in existing},
                                      manuscript=manuscript)
    return existing + new, warnings


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="kirjuta (vaikimisi kuivkäivitus)")
    ap.add_argument("--data-dir", help="andmekaust (vaikimisi server.config)")
    args = ap.parse_args()
    if args.data_dir:
        os.environ["VUTT_DATA_DIR"] = os.path.abspath(args.data_dir)

    from server.config import ARCHIVES_FILE, BASE_DIR
    try:
        with open(ARCHIVES_FILE, encoding="utf-8") as f:
            archives = json.load(f) or {}
    except (OSError, ValueError):
        archives = None
        print(f"HOIATUS: hoidjate registrit ei saa lugeda ({ARCHIVES_FILE})")

    items, works, empty, total, unknown_holders, holderless = [], 0, 0, 0, {}, []
    for entry in sorted(os.scandir(BASE_DIR), key=lambda e: e.name):
        meta_path = os.path.join(entry.path, "_metadata.json")
        if not entry.is_dir() or not os.path.exists(meta_path):
            continue
        with open(meta_path, encoding="utf-8") as f:
            meta = json.load(f)
        if "archive_refs" not in meta:
            continue
        exemplars, warnings = migrate_meta(meta)
        added = len(exemplars) - len(meta.get("exemplars") or [])
        # Tühi loend on samuti migreerimata: võti eemaldatakse, eksemplari ei teki.
        if meta.get("archive_refs"):
            works += 1
        else:
            empty += 1
        total += added
        for w in warnings:
            print(f"HOIATUS {meta.get('id')}: {w}")
            holderless.append(meta.get("id"))
        for x in exemplars:
            if archives is not None and x["holder"] not in archives:
                unknown_holders.setdefault(x["holder"], []).append(meta.get("id"))

        def transform(m: dict, exemplars=exemplars) -> dict:
            # `archive_refs` ei ole enam lubatud väli, nii et teda ei saa tagastada
            # tühjana — eemaldame otse loetud seisust (bulk_update_works annab sama objekti).
            m.pop("archive_refs", None)
            return {"exemplars": exemplars}

        items.append((meta_path, transform))

    print(f"Teoseid sisuga archive_refs-iga: {works}; tühja archive_refs-iga (võti eemaldatakse): {empty}; "
          f"uusi eksemplare: {total}")
    for holder, ids in sorted(unknown_holders.items()):
        print(f"HOIATUS: hoidja {holder!r} puudub registrist ({len(ids)} teost: {', '.join(ids[:5])})")
    if holderless:
        # Hoidja on eksemplari kohustuslik väli: hoidjata viide kaoks migratsioonil.
        # Paranda enne (vanas vormis hoidja juurde), siis käivita uuesti.
        print(f"PEATUS: {len(set(holderless))} teosel on hoidjata või vigane viide — paranda enne --apply'd.")
        if args.apply:
            return 2
    if not args.apply:
        print("Kuivkäivitus — --apply kirjutab.")
        return 0
    if items:
        from server.metadata_ops import bulk_update_works
        res = bulk_update_works(items, "Automaatne", f"Eksemplarid: archive_refs → exemplars ({works} teost, {empty} tühja võtit, ADR 0076)")
        print(f"→ {res}")
        if res.get("failed") or not res.get("git_committed"):
            return 1
    from server.work_exemplars import check_unmigrated
    left = len(check_unmigrated())
    print(f"archive_refs-iga teoseid järel: {left}")
    return 0 if left == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
