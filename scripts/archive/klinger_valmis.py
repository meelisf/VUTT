#!/usr/bin/env python3
"""Klingeri kirjade edukalt klapitud lehed „Valmis" (22.11.2026): szbnsm (Parrot) 60 + Morgenstern 7.

Lehed, mille Riegeri klapitus andis ilma ühegi lipureata (LOSS segu-GT: parrot/gt, morgenstern/gt).
Eesmärk: üks reegel — VUTT „Valmis" = treeningus; LOSSi segu-GT allikad asendab klinger_vutt
(VUTT-ist ehitatud). Kasutaja kiitis skriptiga märkimise heaks (ADR järgi automaatselt ei märgita).

Sisend ~/klinger_valmis.json: [{leht, gt}]. Leht märgitakse ainult siis, kui seisund on „Toores"
ja kettal olev tekst (ilma <fw>/<catch> märgendita, tühikud ühtlustatud) = GT. Tekst ei muutu;
lisatakse kommentaar. Salvestus /save kaudu baasseisuga (ADR 0054).

    python3 scripts/archive/klinger_valmis.py             # kuivkäivitus
    python3 scripts/archive/klinger_valmis.py --kirjuta
"""
import copy
import datetime
import getpass
import glob
import json
import os
import re
import sys
import unicodedata
import urllib.error
import urllib.request

DATA = os.path.expanduser("~/VUTT/data")
API = "http://127.0.0.1:8002"
SISEND = os.path.expanduser("~/klinger_valmis.json")
KOMMENTAAR = ("Märgitud „Valmis\" skriptiga 2026-11-22: Riegeri Briefbuchi klapitus andis lehele ühegi"
              " lipureata vaste (tekst = treeningu GT). Pistelise kontrolli järel vajadusel paranda.")


def n(t):
    return re.sub(r"\s+", " ", re.sub(r"</?(?:fw|catch)>", "", unicodedata.normalize("NFC", t))).strip()


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


def main():
    tood, vahele = [], []
    for o in json.load(open(SISEND, encoding="utf-8")):
        teos, nr = o["leht"].rsplit("-", 1)
        f = glob.glob(os.path.join(DATA, f"*-{teos}", f"*-{nr}.txt"))
        if len(f) != 1:
            vahele.append((o["leht"], "faili ei leitud")); continue
        tekst = open(f[0], encoding="utf-8").read()
        meta = json.load(open(f[0][:-4] + ".json", encoding="utf-8"))
        if meta.get("status") == "Valmis":
            vahele.append((o["leht"], "juba Valmis")); continue
        if meta.get("status") not in (None, "Toores"):
            vahele.append((o["leht"], f"seisund {meta.get('status')}")); continue
        if n(tekst) != n(o["gt"]):
            vahele.append((o["leht"], "tekst erineb GT-st (toimetatud?)")); continue
        tood.append((o, f[0], tekst, meta))
    for leht, pohj in vahele:
        print(f"VAHELE {leht}: {pohj}")
    print(f"Märkida Valmis {len(tood)}, vahele {len(vahele)}.")
    if "--kirjuta" not in sys.argv:
        print("\nKuivkäivitus. Kirjutamiseks: --kirjuta")
        return
    kasutaja = input("Kasutajanimi: ").strip()
    kood, vastus = paring("POST", "/login", {"username": kasutaja, "password": getpass.getpass("Parool: ")})
    token = vastus.get("token")
    if kood != 200 or not token:
        sys.exit(f"Sisselogimine ebaõnnestus: {kood} {vastus.get('message')}")
    nimi = (vastus.get("user") or {}).get("name") or kasutaja
    vead = 0
    for o, tee, tekst, meta in tood:
        m = copy.deepcopy(meta)
        m["status"] = "Valmis"
        kid = f"valmis-{o['leht']}"
        kommentaarid = list(m.get("comments") or [])
        if not any(isinstance(c, dict) and c.get("id") == kid for c in kommentaarid):
            kommentaarid.append({"id": kid, "text": KOMMENTAAR, "author": nimi, "author_username": kasutaja,
                                 "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat()})
        m["comments"] = kommentaarid
        base = {"text_content": tekst, **{k: meta.get(k) for k in ("status", "page_tags", "comments", "text_annotations")}}
        kood, vastus = paring("POST", "/save", {"original_path": os.path.basename(os.path.dirname(tee)),
                                                 "file_name": os.path.basename(tee), "text_content": tekst,
                                                 "meta_content": m, "base": base}, token=token)
        ok = kood == 200 and vastus.get("git_committed") is not False
        vead += not ok
        print(f"{'OK  ' if ok else 'VIGA'} {o['leht']}  {kood} {'' if ok else vastus}")
    print(f"\nValmis, vigu {vead}.")


if __name__ == "__main__":
    main()
