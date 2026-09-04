#!/usr/bin/env python3
"""Parandab ADA-imporditud teoste `creators` kirjed (#293).

Kaks viga, mõlemad enne 2026-09-04 imporditud teostes:

1. ADA-import kirjutas `{"label": <nimi>}`, aga VUTT kasutab `{"name": ...}`.
   Vale võtmega kirje ei jõua UI-sse ja admin peab isiku käsitsi uuesti siduma.
2. `role` jäi määramata. `dc.contributor.author` ON definitsiooni järgi autor,
   seega õige roll on `auctor` (vt `CreatorRole` loend `src/types.ts`-is).

Mõõdetud tootmises 2026-09-04: 18 rollita kirjet, kõik sama isik (Klinger),
kes on nende kirjade autor. Segatud rolle EI OLE, seega hulgimuutus on ohutu.

Skript EI puuduta:
  - mitte-ADA teoseid (`external_url` ilma `hdl.handle.net`-ita)
  - kirjeid, millel roll juba on (ka siis, kui see EI OLE `auctor`)
  - `id`/`source` välju — prosopograafia-sidumine jääb nagu on

Kasutus (SERVERIS, konteineris — `data/` git commitib root'ina ja hostist
annab „Permission denied"):

  docker exec vutt-backend python3 scripts/fix_ada_creators_role.py            # kuivkäivitus
  docker exec vutt-backend python3 scripts/fix_ada_creators_role.py --apply

Idempotentne: kordusjooks ei muuda midagi. `save_work_metadata` on ADR 0012
järgi muutusteta salvestusel no-op — ei kirjuta, ei commiti, ei indekseeri.
"""
import argparse
import json
import os
import sys

_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _PROJECT_ROOT)

from server.config import BASE_DIR  # noqa: E402
from server.metadata_ops import save_work_metadata  # noqa: E402

ROLL = "auctor"
GIT_SONUM = "fix(ada): creators name-kuju ja auctor-roll (#293)"


def on_ada_teos(meta: dict) -> bool:
    return "hdl.handle.net" in str(meta.get("external_url") or "")


def paranda_creators(creators):
    """Tagastab `(uus_list, muudetud_arv)`. Ei puuduta kirjeid, millel roll on."""
    uus = []
    muudetud = 0
    for c in creators or []:
        if not isinstance(c, dict):
            uus.append(c)
            continue
        if c.get("role"):
            uus.append(c)
            continue
        parandatud = dict(c)
        # `label` → `name`, kui `name` puudub. Vana võti eemaldatakse, et ei jääks
        # kahte tõeallikat samale nimele.
        if "label" in parandatud and not parandatud.get("name"):
            parandatud["name"] = parandatud.pop("label")
        elif "label" in parandatud:
            parandatud.pop("label")
        parandatud["role"] = ROLL
        uus.append(parandatud)
        muudetud += 1
    return uus, muudetud


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="kirjuta päriselt (vaikimisi kuivkäivitus)")
    args = ap.parse_args()

    teoseid = kirjeid = 0
    for kaust in sorted(os.listdir(BASE_DIR)):
        meta_path = os.path.join(BASE_DIR, kaust, "_metadata.json")
        if not os.path.isfile(meta_path):
            continue
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
        except Exception as e:
            print("  VAHELE {}: {}".format(kaust, e))
            continue
        if not on_ada_teos(meta):
            continue
        uus, n = paranda_creators(meta.get("creators"))
        if not n:
            continue
        teoseid += 1
        kirjeid += n
        print("{}\n  enne: {}\n  pärast: {}".format(
            kaust, json.dumps(meta.get("creators"), ensure_ascii=False),
            json.dumps(uus, ensure_ascii=False)))
        if args.apply:
            # save_work_metadata, MITTE otsene kirjutus: git-commit + Meili sünk
            # käivad ainult sealt (CLAUDE.md). call_ptw=True, sest person_to_works
            # ehitatakse metaandmete ROLLIDEST — ilma selleta jääks indeks vanaks.
            save_work_metadata(
                meta_path, {"creators": uus},
                username="ada-migration", git_message=GIT_SONUM,
                sync_meili=True, call_ptw=True,
            )

    print("\n{} teost, {} creators-kirjet".format(teoseid, kirjeid))
    if not args.apply:
        print("KUIVKÄIVITUS — päriselt kirjutamiseks lisa --apply")


if __name__ == "__main__":
    main()
