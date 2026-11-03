#!/usr/bin/env python3
"""jbc88t (Vasari klapitus): ligatuurid lahti + pistelise kontrolli parandused.

- æ → ae, Æ → Ae, œ → oe, Œ → Oe (ligatuur on käsikirjas visuaalselt mitmetähenduslik;
  qv jääb — nähtav tähevalik on diplomaatiline).
- Viis käsitsi parandust pildi järgi (lk 5 ja lk 21).
Ainult märksõnaga „Vasari klapitus" lehed. Salvestus /save kaudu (git-commit + Meili sünk);
JSON-i ei saadeta. Leht kirjutatakse ainult siis, kui kettal on sama tekst, mis kuivkäivitusel.

    python3 vasar_ligatuurid.py             # kuivkäivitus
    python3 vasar_ligatuurid.py --kirjuta
"""
import getpass
import glob
import json
import os
import sys
import urllib.error
import urllib.request

DATA = os.path.expanduser("~/VUTT/data")
KAUST = "1632-tartu-ulikooli-academia-gustaviana-pohikiri-17-saj-2-pool-umber-kirjutanud"
API = "http://127.0.0.1:8002"
SILT = "Vasari klapitus"

LIGATUURID = {"æ": "ae", "Æ": "Ae", "œ": "oe", "Œ": "Oe"}

# (faili sufiks, vana, uus) — vana peab failis esinema TÄPSELT üks kord (pärast ligatuure)
PARANDUSED = [
    ("jbc88t-004.txt", "ut vocant Jcti\n", "ut vocant J.C.T.I.\n"),
    ("jbc88t-xzb6ai.txt", "ejusqve profectum in iis", "ejusqve profectumqve in iis"),
    ("jbc88t-xzb6ai.txt", "\nsectatutum ac in", "\nsectaturum ac in"),
    ("jbc88t-xzb6ai.txt", "examen diebus, instituuntur more", "examen diebus, instituentur more"),
    # ridadevaheline „secunda" oli omaette real ja „sep-/tima" poolitus katki → <add> (ADR 0067)
    ("jbc88t-xzb6ai.txt",
     "disputatio à sep-\nsecunda\nseptima matutina in horam undecimam et à secunda pomeridiana\n",
     "disputatio à sep-\ntima matutina in horam undecimam et à <add>secunda</add> pomeridiana\n"),
]


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


def teisenda(fail, tekst):
    uus = tekst
    for a, b in LIGATUURID.items():
        uus = uus.replace(a, b)
    for suf, vana, asendus in PARANDUSED:
        if not fail.endswith(suf):
            continue
        n = uus.count(vana)
        if n != 1:
            sys.exit(f"VIGA {fail}: parandus {vana!r} esineb {n} korda (oodatud 1)")
        uus = uus.replace(vana, asendus)
    return uus


def main():
    kaust = os.path.join(DATA, KAUST)
    tood = []
    for jf in sorted(glob.glob(os.path.join(kaust, "*.json"))):
        if os.path.basename(jf).startswith("_"):
            continue
        meta = json.load(open(jf, encoding="utf-8"))
        sildid = [t if isinstance(t, str) else t.get("label") for t in meta.get("page_tags") or []]
        if SILT not in sildid:
            continue
        tf = jf[:-5] + ".txt"
        vana = open(tf, encoding="utf-8").read()
        uus = teisenda(os.path.basename(tf), vana)
        if uus != vana:
            tood.append((os.path.basename(tf), vana, uus))

    kasutatud = {suf for suf, *_ in PARANDUSED}
    puudu = [s for s in kasutatud if not any(f.endswith(s) for f, *_ in tood)]
    if puudu:
        sys.exit(f"VIGA: parandatavad failid puuduvad töönimekirjast: {puudu}")

    lig = sum(v.count(c) for _, v, _ in tood for c in LIGATUURID)
    print(f"Muuta {len(tood)} lehte, ligatuure {lig}, käsitsi parandusi {len(PARANDUSED)}.")
    for f, vana, uus in tood:
        if any(f.endswith(s) for s in kasutatud):
            print(f"\n{f}:")
            for i, (a, b) in enumerate(zip(vana.split("\n"), uus.split("\n")), 1):
                if a != b:
                    print(f"  {i:3d} - {a}\n      + {b}")
            if vana.count("\n") != uus.count("\n"):
                print(f"  (ridu {vana.count(chr(10))} → {uus.count(chr(10))}; võrdlus ülal nihkes pärast muutunud rida)")

    if "--kirjuta" not in sys.argv:
        print("\nKuivkäivitus. Kirjutamiseks: --kirjuta")
        return

    kasutaja = input("Kasutajanimi: ").strip()
    kood, vastus = paring("POST", "/login", {"username": kasutaja, "password": getpass.getpass("Parool: ")})
    token = vastus.get("token")
    if kood != 200 or not token:
        sys.exit(f"Sisselogimine ebaõnnestus: {kood} {vastus.get('message')}")
    vead = 0
    for f, vana, uus in tood:
        if open(os.path.join(kaust, f), encoding="utf-8").read() != vana:
            print(f"VAHELE {f}: kettal muu tekst (toimetatud vahepeal?)")
            vead += 1
            continue
        kood, vastus = paring("POST", "/save", {"original_path": KAUST, "file_name": f,
                                                 "text_content": uus}, token=token)
        ok = kood == 200 and vastus.get("changed") and vastus.get("git_committed")
        vead += not ok
        print(f"{'OK  ' if ok else 'VIGA'} {f}  {kood} {'' if ok else vastus}")
    print(f"\nValmis, vigu {vead}.")


if __name__ == "__main__":
    main()
