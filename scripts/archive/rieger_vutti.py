#!/usr/bin/env python3
"""Kirjutab Riegeri Briefbuchi klapitud teksti Klingeri kirjade lehtedele VUTT-is (#576).

Sisend rieger_vutti.json (klapituse prototüüp, LOSS data/rieger/klapitus/): leht, kiri,
mudel (joondamisel kasutatud OCR-tekst), uus (Riegeri tekst mudeli reajaotuses; lipuga
CER/tühjad read jäävad OCR-iks), lipud (käsitsi parandatavad read).
Leht kirjutatakse ainult siis, kui kettal on endiselt sama OCR-tekst — vahepeal
toimetatud lehte ei puututa. Salvestus käib /save kaudu (git-commit + Meili sünk);
JSON-i (staatus, kommentaarid) ei saadeta, see jääb puutumata.

    python3 rieger_vutti.py             # kuivkäivitus
    python3 rieger_vutti.py --kirjuta
    python3 rieger_vutti.py ~/rieger_vutti2.json [--kirjuta]   # teine partii (kirja kaupa ühisjoondus)
"""
import getpass
import glob
import json
import os
import sys
import unicodedata
import urllib.error
import urllib.request

DATA = os.path.expanduser("~/VUTT/data")
API = "http://127.0.0.1:8002"
SISEND = os.path.expanduser(next((a for a in sys.argv[1:] if a.endswith(".json")), "~/rieger_vutti.json"))


def lehe_fail(leht):
    teos, nr = leht.rsplit("-", 1)
    k = glob.glob(os.path.join(DATA, f"*-{teos}"))
    if len(k) != 1:
        return None, None
    f = glob.glob(os.path.join(k[0], f"*-{nr}.txt"))
    return (os.path.basename(k[0]), os.path.basename(f[0])) if len(f) == 1 else (None, None)


def norm(s):
    return unicodedata.normalize("NFC", s).strip()


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
    lehed = json.load(open(SISEND, encoding="utf-8"))
    tood, vahele = [], []
    for o in lehed:
        kaust, fail = lehe_fail(o["leht"])
        if not fail:
            vahele.append((o["leht"], "faili ei leitud")); continue
        olemas = open(os.path.join(DATA, kaust, fail), encoding="utf-8").read()
        if norm(olemas) != norm(o["mudel"]):
            vahele.append((o["leht"], "kettal muu tekst (toimetatud?)")); continue
        tood.append((o, kaust, fail, olemas))
    for leht, pohj in vahele:
        print(f"VAHELE {leht}: {pohj}")
    print(f"Kirjutada {len(tood)} lehte, vahele {len(vahele)}.")
    if "--kirjuta" not in sys.argv:
        o, *_ = tood[0]
        print(f"\nNäidis {o['leht']} (kiri {o['kiri']}):")
        for i, (a, b) in enumerate(zip(o["mudel"].split("\n"), o["uus"].split("\n")), 1):
            print(f"{i:3d} {'  ' if a == b else '≠ '}{b}")
        print("\nKuivkäivitus. Kirjutamiseks: --kirjuta")
        return
    kasutaja = input("Kasutajanimi: ").strip()
    kood, vastus = paring("POST", "/login", {"username": kasutaja, "password": getpass.getpass("Parool: ")})
    token = vastus.get("token")
    if kood != 200 or not token:
        sys.exit(f"Sisselogimine ebaõnnestus: {kood} {vastus.get('message')}")
    vead = 0
    for o, kaust, fail, _ in tood:
        kood, vastus = paring("POST", "/save", {"original_path": kaust, "file_name": fail,
                                                 "text_content": o["uus"]}, token=token)
        ok = kood == 200 and vastus.get("changed") and vastus.get("git_committed")
        vead += not ok
        print(f"{'OK  ' if ok else 'VIGA'} {o['leht']}  {kood} {'' if ok else vastus}")
    print(f"\nValmis, vigu {vead}.")


if __name__ == "__main__":
    main()
