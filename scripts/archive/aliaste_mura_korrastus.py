#!/usr/bin/env python3
"""Rikastuse müra isikukaartide aliastest (helilooja Fischer, 2026-11-12).

Sama reegel mis `server/prosopography/enrichment.py::_allika_variant` (siin koopia:
skript jookseb hostis ilma serveri sõltuvusteta):
- mitteladina kirjasüsteemi kujud → välja;
- sulgudes eristus („Johann (1646-1716/17) Fischer”) → eemaldatakse;
- paljas nimeosa („Fischer”) ja kanoonilise nime kordus → välja.

Mõõdetud 2026-11-12: 24 mitteladina kuju + 2 sulukuju, kokku 12 isikut.
Kirjutus `PUT /prosopography/{id}` kaudu (updated_at kontroll, git, indeksid).

    python3 aliaste_mura_korrastus.py             # kuivkäivitus
    python3 aliaste_mura_korrastus.py --kirjuta
"""
import copy
import getpass
import json
import re
import sys
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

API = "http://127.0.0.1:8002"
SULUD = re.compile(r"\s*\([^()]*\)")


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


def ladina(t):
    return all(not c.isalpha() or "LATIN" in unicodedata.name(c, "") for c in t)


def puhastatud(aliases, label):
    """Tagastab puhastatud aliaste loendi (järjekord säilib)."""
    voti = lambda v: unicodedata.normalize("NFC", v).strip().casefold()
    tokens = {t.casefold() for t in label.split()}
    out, nahtud = [], {voti(label)}
    for a in aliases:
        t = unicodedata.normalize("NFC", str(a)).strip()
        if not t or not ladina(t):
            continue
        t = " ".join(SULUD.sub(" ", t).split())
        if not t or (" " not in t and t.casefold() in tokens):
            continue
        if voti(t) in nahtud:
            continue
        nahtud.add(voti(t))
        out.append(t)
    return out


def main():
    kood, vastus = paring("GET", "/prosopography?limit=100000")
    if kood != 200:
        sys.exit(f"Isikute loend ebaõnnestus: {kood}")
    tood = []
    for e in vastus.get("results", []):
        vanad = e.get("aliases") or []
        if not vanad:
            continue
        # Kuivkäivitus ainult müraga kaartidel: mitteladina või sulukuju.
        if all(ladina(a) and not SULUD.search(a) for a in vanad):
            continue
        kood, isik = paring("GET", "/prosopography/" + urllib.parse.quote(e["id"], safe=""))
        if kood != 200:
            print(f"VIGA {e['id']}: {kood}")
            continue
        nimi = isik.get("name") or {}
        uued = puhastatud(nimi.get("aliases") or [], nimi.get("label") or "")
        if uued == (nimi.get("aliases") or []):
            continue
        eemaldatud = [a for a in nimi.get("aliases") or [] if a not in uued]
        print(f"MUUDA {e['id']} {nimi.get('label')}: −{len(eemaldatud)} {eemaldatud}")
        uus_nimi = copy.deepcopy(nimi)
        uus_nimi["aliases"] = uued
        tood.append((e["id"], isik["updated_at"], uus_nimi))

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
