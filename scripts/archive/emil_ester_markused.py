#!/usr/bin/env python3
"""EMILi sedelitele ESTERi seose märkus (lehe kommentaar), vt docs/emil-esteri-kirjetega-sidumine.md.

Andmed: emil_ester_seosed.json (sama kaust) — {id, kaust, fail, b[], tekst}, koostatud
ESTERi Mscr-registri ja sedelite võrdlusest (2026-11-12, ülevaatus artefaktis).

Märkus lisatakse lehe `comments`-loendi lõppu /save kaudu sisselogitud kasutaja nimel:
lehe lukk, kolmesuunaline liitmine (base = kettal olev seis), git-commit ja Meili sünk
käivad serveri tavateed (üks commit lehe kohta). Lehe teksti ei muudeta.

Kordus on ohutu: leht, mille mõnes kommentaaris on juba „**ESTER” ja sama b-number,
jäetakse vahele.

    python3 emil_ester_markused.py             # kuivkäivitus
    python3 emil_ester_markused.py --kirjuta
"""
import copy
import getpass
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

DATA = os.path.expanduser("~/VUTT/data")
API = "http://127.0.0.1:8002"
ANDMED = os.path.join(os.path.dirname(os.path.abspath(__file__)), "emil_ester_seosed.json")


def paring(meetod, tee, keha=None, token=None):
    paised = {"Content-Type": "application/json"}
    if token:
        paised["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(API + tee, method=meetod, headers=paised,
                                 data=json.dumps(keha).encode() if keha is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, {}


def loe_leht(kaust, fail):
    """Tagastab (tekst, meta, base) või viskab ValueError-i, kui lehte ei saa ohutult kirjutada."""
    txt = os.path.join(DATA, kaust, fail)
    jsn = os.path.splitext(txt)[0] + ".json"
    if not os.path.exists(txt) or not os.path.exists(jsn):
        raise ValueError("lehe fail puudub")
    tekst = open(txt, encoding="utf-8").read()
    meta = json.load(open(jsn, encoding="utf-8"))
    if not isinstance(meta, dict):
        raise ValueError("lehe JSON ei ole objekt")
    # Vana meta_content-wrapper: /save kirjutaks kliendi meta faili juureks ja wrapper kaoks.
    if isinstance(meta.get("meta_content"), dict):
        raise ValueError("vana meta_content-kuju, käsitsi")
    # base = sama projektsioon mis server/page_merge.read_page_view
    base = {
        "text_content": tekst,
        "status": meta.get("status", "Toores"),
        "page_tags": meta.get("page_tags", meta.get("tags", [])) or [],
        "comments": meta.get("comments", []) or [],
        "text_annotations": meta.get("text_annotations", []) or [],
    }
    return tekst, meta, base


def juba_olemas(meta, b_numbrid):
    for c in meta.get("comments") or []:
        t = c.get("text", "") if isinstance(c, dict) else ""
        if t.startswith("**ESTER") and any(b in t for b in b_numbrid):
            return True
    return False


def main():
    kirjed = json.load(open(ANDMED, encoding="utf-8"))
    tood, vahele = [], []
    for k in kirjed:
        try:
            tekst, meta, base = loe_leht(k["kaust"], k["fail"])
        except ValueError as e:
            vahele.append((k["id"], str(e)))
            continue
        if juba_olemas(meta, k["b"]):
            vahele.append((k["id"], "märkus juba olemas"))
            continue
        tood.append(k)

    print(f"Kirjeid {len(kirjed)}, lisada {len(tood)}, vahele {len(vahele)}.")
    for i, pohjus in vahele:
        print(f"  VAHELE {i}: {pohjus}")
    for k in tood[:3]:
        print(f"\n{k['id']}  ({k['kaust']}/{k['fail']})\n{k['tekst']}")

    if "--kirjuta" not in sys.argv:
        print("\nKuivkäivitus. Kirjutamiseks: --kirjuta")
        return

    kasutaja = input("Kasutajanimi: ").strip()
    kood, vastus = paring("POST", "/login", {"username": kasutaja, "password": getpass.getpass("Parool: ")})
    token, user = vastus.get("token"), vastus.get("user") or {}
    if kood != 200 or not token:
        sys.exit(f"Sisselogimine ebaõnnestus: {kood} {vastus.get('message')}")
    nimi = user.get("name") or kasutaja

    vead = 0
    alus_id = int(time.time() * 1000)
    for n, k in enumerate(tood):
        # Loe uuesti vahetult enne saatmist: base peab olema kettal olev seis.
        try:
            tekst, meta, base = loe_leht(k["kaust"], k["fail"])
        except ValueError as e:
            print(f"VAHELE {k['id']}: {e}")
            vead += 1
            continue
        if juba_olemas(meta, k["b"]):
            print(f"VAHELE {k['id']}: märkus juba olemas")
            continue
        uus_meta = copy.deepcopy(meta)
        uus_meta["comments"] = list(meta.get("comments") or []) + [{
            "id": str(alus_id + n),
            "text": k["tekst"],
            "author": nimi,
            "author_username": user.get("username") or kasutaja,
            "created_at": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        }]
        kood, vastus = paring("POST", "/save", {
            "original_path": k["kaust"], "file_name": k["fail"],
            "text_content": tekst, "meta_content": uus_meta, "base": base,
        }, token=token)
        ok = kood == 200 and vastus.get("changed") and vastus.get("git_committed")
        vead += not ok
        print(f"{'OK  ' if ok else 'VIGA'} {k['id']}  {kood} {'' if ok else vastus}")
        time.sleep(0.3)
    print(f"\nValmis, vigu {vead}.")


if __name__ == "__main__":
    main()
