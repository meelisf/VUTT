#!/usr/bin/env python3
"""ADR 0082 p 5: `name.qualifier` korrastus — väljast saab eristav täiend.

Seis 2026-11-12 (7 kaarti, kus väli oli täidetud):
- „von” (4×) on nimeosake, mitte eristav täiend. Perekonnanimesse teda EI viida
  (sort_name tuleb perekonnanimest, „von Pufendorf” sortuks V alla). Kui
  kanoonilises nimes osakest pole, lisatakse „Eesnimi von Perekonnanimi” aliaseks,
  et kuju jääks otsitavaks. Täiend tühjendatakse.
- „Gripenhielm” on Emundus Figreliuse aadlinimi (nimemuutus, #795), mitte täiend.
  Aliaste hulgas on ta juba olemas — täiend tühjendatakse.
- „Junior”, „noorem” jäävad (sisuliselt eristavad täiendid).

Kirjutus käib `PUT /prosopography/{id}` kaudu (updated_at kontroll,
`_save_person_locked`, git, indeksid). Kaart kirjutatakse ainult siis, kui
täiend on endiselt sama, mis ülal kirjas.

    python3 adr0082_taiendi_korrastus.py             # kuivkäivitus
    python3 adr0082_taiendi_korrastus.py --kirjuta
"""
import copy
import getpass
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

API = "http://127.0.0.1:8002"
OSAKE = "von"
NIMEMUUTUS = {"vutt:Psbfjxg": "Gripenhielm"}  # isik → täiend, mis on tegelikult hilisem nimi


def paring(meetod, tee, keha=None, token=None):
    paised = {"Content-Type": "application/json"}
    if token:
        paised["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(API + tee, method=meetod, headers=paised,
                                 data=json.dumps(keha).encode() if keha is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, {}


def uus_nimi(isik):
    """Tagastab (uus name-objekt, selgitus) või (None, põhjus), kui midagi ei muudeta."""
    nimi = isik.get("name") or {}
    q = (nimi.get("qualifier") or "").strip()
    if not q:
        return None, "täiend tühi"
    uus = copy.deepcopy(nimi)
    if q.lower() == OSAKE:
        uus["qualifier"] = None
        label = nimi.get("label") or ""
        if f" {OSAKE} " not in f" {label} ":
            kuju = " ".join(x for x in (nimi.get("first_name"), OSAKE, nimi.get("family_name")) if x)
            aliased = list(nimi.get("aliases") or [])
            if kuju not in aliased:
                aliased.append(kuju)
            uus["aliases"] = aliased
            return uus, f"„von” → alias „{kuju}”"
        return uus, "„von” on nimes juba olemas → täiend tühjaks"
    if NIMEMUUTUS.get(isik.get("id")) == q:
        return {**uus, "qualifier": None}, f"„{q}” on hilisem nimi (#795) → täiend tühjaks"
    return None, f"„{q}” jääb (eristav täiend)"


def main():
    kood, vastus = paring("GET", "/prosopography?limit=5000")
    if kood != 200:
        sys.exit(f"Isikute loend ebaõnnestus: {kood}")
    kandidaadid = [e["id"] for e in vastus.get("results", []) if e.get("qualifier")]
    tood = []
    for pid in kandidaadid:
        kood, isik = paring("GET", "/prosopography/" + urllib.parse.quote(pid, safe=""))
        if kood != 200:
            print(f"VIGA {pid}: {kood}")
            continue
        uus, selgitus = uus_nimi(isik)
        print(f"{'MUUDA' if uus else 'JÄTA '} {pid} {isik['name'].get('label')}: {selgitus}")
        if uus:
            tood.append((pid, isik["updated_at"], uus))

    if "--kirjuta" not in sys.argv:
        print(f"\nKuivkäivitus: muuta {len(tood)} kaarti. Kirjutamiseks: --kirjuta")
        return

    kasutaja = input("Kasutajanimi: ").strip()
    kood, vastus = paring("POST", "/login", {"username": kasutaja, "password": getpass.getpass("Parool: ")})
    token = vastus.get("token")
    if kood != 200 or not token:
        sys.exit(f"Sisselogimine ebaõnnestus: {kood} {vastus.get('message')}")
    vead = 0
    for pid, updated_at, nimi in tood:
        kood, vastus = paring("PUT", "/prosopography/" + urllib.parse.quote(pid, safe=""),
                              {"updated_at": updated_at, "name": nimi}, token=token)
        ok = kood == 200
        vead += not ok
        print(f"{'OK  ' if ok else 'VIGA'} {pid}  {kood} {'' if ok else vastus}")
    print(f"\nValmis, vigu {vead}.")


if __name__ == "__main__":
    main()
