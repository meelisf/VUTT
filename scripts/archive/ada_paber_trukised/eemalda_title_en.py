#!/usr/bin/env python3
"""Eemaldab ADA hulgiimpordi trükistelt automaattõlke (`title_en`).

ada_import_batch.py lisas kuni trükiseprofiili parandamiseni Gemini
pealkirjatõlke ka trükistele; trükise pealkiri on allika oma ja tõlget ei
vajata. Loeb imporditud work_id-d progressifailist ja saadab igaühele
`title_en: ""` — server eemaldab tühja pealkirja lisavälja võtmena
(`normalize_title_fields`), üks commit teose kohta, muutuseta = no-op.

Kasutus serveris:
  python3 scripts/archive/ada_paber_trukised/eemalda_title_en.py \
      ~/ada_paber_progress.json --token-file ~/.vutt_token [--kirjuta]
Ilma --kirjuta'ta ainult loetleb.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from ada_import_batch import Api  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("progress")
    ap.add_argument("--token-file", required=True)
    ap.add_argument("--kirjuta", action="store_true")
    a = ap.parse_args()
    api = Api(open(a.token_file).read().strip())
    prog = json.load(open(a.progress))
    for handle, rec in prog.items():
        wid = rec.get("work_id")
        if rec.get("stage") != "imported" or not wid:
            continue
        code, r = api.call("POST", "/get-work-metadata", {"work_id": wid})
        title_en = (r.get("metadata") or {}).get("title_en") if code == 200 else None
        if code != 200:
            print(f"{wid} {handle}: lugemine {code} {r}")
            continue
        if not title_en:
            print(f"{wid} {handle}: title_en puudub")
            continue
        if not a.kirjuta:
            print(f"{wid} {handle}: eemaldataks „{title_en[:70]}”")
            continue
        code, r = api.call("POST", "/update-work-metadata",
                           {"work_id": wid, "metadata": {"title_en": ""}})
        print(f"{wid} {handle}: {code} changed={r.get('changed')} git={r.get('git_committed')}")


if __name__ == "__main__":
    main()
