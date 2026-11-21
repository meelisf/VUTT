#!/usr/bin/env python3
"""Kantiana „Briefe an Kant. Bd. 1" (65fgpj): osade parandus AA klapituse põhjal (#858 jätk).

1. Topeltosad: sama pealkiri + lehed + liik + märkus kahe eri id-ga (sisukord on kaks
   korda sisse läinud). Alles jääb rohkemate isikuseostega (`creators[].id`) osa,
   viigi korral varasem; lisad (`attached_to`) kustutatakse enne oma kirja.
2. AA numbrid: korpora.org AA X–XII (2. trükk) kirjateksti joondus näitas vale numbrit
   (kuupäev, kirjutaja ja lehekülg kontrollitud). Asendus ainult siis, kui vana tekst on
   osas endiselt olemas — vahepeal toimetatud osa jäetakse vahele.

Kõik muudatused käivad /works/{id}/parts otspunktide kaudu (ADR 0057): metadata_lock,
git-commit, Meili sünk.

    python3 kantiana_osad_parandus.py             # kuivkäivitus
    python3 kantiana_osad_parandus.py --kirjuta
"""
import getpass
import json
import sys
import urllib.error
import urllib.request

API = "http://127.0.0.1:8002"
TEOS = "65fgpj"

# osa id → [(vana, uus)] pealkirjas ja märkuses
PARANDUSED = {
    "1fv1ze": [("AA X, nr 270, lk 443", "AA X, nr 269, lk 443")],
    "2k2k1p": [("(AA X, nr 35/37, lk 60–65)", "(AA X, nr 37, lk 62–65)"),
               ("AA X, nr 35 (2. tr. nr 37), lk 60–65", "AA X, nr 37 (1. tr. nr 35), lk 62–65")],
    "6yh0oc": [("AA XI, nr 637, lk 506", "AA XI, nr 628, lk 506")],
    "d3d4rj": [("AA X, nr 203, lk 333", "AA X, nr 202, lk 333")],
    "djm5n1": [("AA X, nr 321, lk 528–529", "AA X, nr 320, lk 529")],
    "maqxmu": [("(AA vaste puudub)", "(AA XI, nr 416, lk 148)"),
               ("AA X–XII vastet ei leitud (AA XI, nr 364, lk 56 sisaldab Kosegarteni varasemat kirja "
                "07.06.1789, kuid 01.04.1790 kirja korpora.org/AA põhiköidetes ei leidu).",
                "AA XI, nr 416, lk 148 (AA XI, nr 364, lk 56 on Kosegarteni varasem kiri).")],
    "iwo2ef": [("AA XI, nr 395, lk 112", "AA XI, nr 394, lk 112")],
    "m74ek2": [("AA XI, nr 566, lk 418", "AA XI, nr 565, lk 418")],
    "nwmwj0": [("AA X, nr 248, lk 412", "AA X, nr 247, lk 412")],
    "to3z0r": [("AA XI, nr 592, lk 451", "AA XI, nr 591, lk 451")],
    "ts3srs": [("AA XI, nr 539, lk 378", "AA XI, nr 538, lk 378")],
    "ucu7m8": [("AA X, nr 55, lk 95–98", "AA X, nr 58, lk 99 jj")],
}


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


def seoseid(p):
    return sum(1 for c in p.get("creators") or [] if c.get("id"))


def plaan(osad):
    """(kustutatavad id-d lisad ees, {id: uus osa})"""
    pos = {p["id"]: i for i, p in enumerate(osad)}
    grupid = {}
    for p in osad:
        grupid.setdefault((p.get("title"), tuple(p.get("pages") or []), p.get("kind"), p.get("notes")), []).append(p)
    kustuta = []
    for g in grupid.values():
        if len(g) < 2:
            continue
        hoia = max(g, key=lambda p: (seoseid(p), -pos[p["id"]]))
        kustuta += [p["id"] for p in g if p is not hoia]
    viidatud = {p.get("attached_to") for p in osad}
    kustuta.sort(key=lambda i: i in viidatud)            # lisad (viitamata) enne kirja
    jaavad = {p["id"]: p for p in osad if p["id"] not in kustuta}
    for p in osad:                                        # ära jäta lisa kustutatud kirjale
        if p["id"] not in kustuta and p.get("attached_to") in kustuta:
            sys.exit(f"Osa {p['id']} viitab kustutatavale {p['attached_to']} — käsitsi üle vaadata")
    muuda = {}
    for pid, asendused in PARANDUSED.items():
        p = jaavad.get(pid)
        if not p:
            print(f"VAHELE {pid}: osa puudub või kustutatakse")
            continue
        uus = {k: v for k, v in p.items() if k not in ("id", "needs_review")}
        for vana, uus_t in asendused:
            leitud = False
            for vali in ("title", "notes"):
                if vana in (uus.get(vali) or ""):
                    uus[vali] = uus[vali].replace(vana, uus_t)
                    leitud = True
            if not leitud:
                print(f"VAHELE {pid}: „{vana[:50]}…“ ei leidu (toimetatud?)")
                break
        else:
            muuda[pid] = uus
    return kustuta, muuda, {p["id"]: p for p in osad}


def main():
    token = None
    if "--kirjuta" in sys.argv:
        kasutaja = input("Kasutajanimi: ").strip()
        kood, vastus = paring("POST", "/login", {"username": kasutaja, "password": getpass.getpass("Parool: ")})
        token = vastus.get("token")
        if kood != 200 or not token:
            sys.exit(f"Sisselogimine ebaõnnestus: {kood} {vastus.get('message')}")
    kood, vastus = paring("GET", f"/works/{TEOS}/parts", token=token)
    if kood != 200:
        sys.exit(f"Osade lugemine ebaõnnestus: {kood} {vastus}")
    osad = vastus["parts"] if isinstance(vastus, dict) else vastus
    kustuta, muuda, koik = plaan(osad)
    print(f"Osi {len(osad)}; kustutada {len(kustuta)}, parandada {len(muuda)}.\n")
    for pid in kustuta:
        p = koik[pid]
        print(f"KUSTUTA {pid}  lk {p['pages'][0]}–{p['pages'][-1]}  {p['title'][:70]}")
    for pid, uus in muuda.items():
        p = koik[pid]
        print(f"\nPARANDA {pid}")
        for vali in ("title", "notes"):
            if p.get(vali) != uus.get(vali):
                print(f"  {vali}: {p.get(vali)}\n     → {uus.get(vali)}")
    if not token:
        print("\nKuivkäivitus. Kirjutamiseks: --kirjuta")
        return
    vead = 0
    for pid in kustuta:
        kood, vastus = paring("DELETE", f"/works/{TEOS}/parts/{pid}", token=token)
        vead += kood != 204
        print(f"{'OK  ' if kood == 204 else 'VIGA'} kustuta {pid}  {kood} {'' if kood == 204 else vastus}")
    for pid, uus in muuda.items():
        kood, vastus = paring("PUT", f"/works/{TEOS}/parts/{pid}", uus, token=token)
        vead += kood != 200
        print(f"{'OK  ' if kood == 200 else 'VIGA'} paranda {pid}  {kood} {'' if kood == 200 else vastus}")
    print(f"\nValmis, vigu {vead}.")


if __name__ == "__main__":
    main()
