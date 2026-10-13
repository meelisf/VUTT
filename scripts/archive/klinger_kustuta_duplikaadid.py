#!/usr/bin/env python3
"""Kustutab 1816. a Klingeri üksikkirjade teosed, mis on köite t9zd42 (ADA 10062/7822) duplikaadid.

Sama skaneering: üksikkirjad (ADA 10062/7852–7869) = t9zd42 lk 73–116, 149–151 (tekstisarnasus
0,84–1,00, kontrollitud 11.10). Kustutus käib admini API kaudu (DELETE /admin/work/{id}):
pildid → ._trash/<id>, tekstid jäävad gitti, Meili + indeksid puhastatakse, taastatav
/admin/trash/{id}/restore kaudu.

    python3 klinger_kustuta_duplikaadid.py             # kuivkäivitus
    python3 klinger_kustuta_duplikaadid.py --kustuta
"""
import getpass
import glob
import json
import os
import sys
import urllib.error
import urllib.request

DATA = os.path.expanduser("~/VUTT/data")
API = "http://127.0.0.1:8002"
KOIDE = "t9zd42"
# üksikkiri → köite lehed
DUPLIKAADID = {
    "o40y5h": "73–75", "m3rk1w": "76", "n0zcqu": "77–78", "ysjk67": "79–80",
    "05nctg": "81–84", "wl7ocj": "85–87", "t3oczp": "88", "l7dp90": "89–92",
    "mlkwgl": "93", "tkzjnu": "94–97", "xcqbk3": "98–101", "9vmaug": "108–110",
    "yssfb6": "111–112", "4bq8ta": "113–114", "irhk00": "115–116", "k1kdxh": "149–151",
}


def kaust(wid):
    k = glob.glob(os.path.join(DATA, f"*-{wid}"))
    return k[0] if len(k) == 1 else None


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
    if not kaust(KOIDE):
        sys.exit(f"Köidet {KOIDE} ei leitud — katkestan.")
    olemas = {w: kaust(w) for w in DUPLIKAADID}
    for w, k in olemas.items():
        nimi = os.path.basename(k) if k else "(juba kustutatud)"
        print(f"{w}  → {KOIDE} lk {DUPLIKAADID[w]:8s}  {nimi}")
    tood = [w for w, k in olemas.items() if k]
    print(f"\nKustutada {len(tood)} teost.")
    if "--kustuta" not in sys.argv:
        print("Kuivkäivitus. Kustutamiseks: --kustuta")
        return
    kasutaja = input("Kasutajanimi: ").strip()
    kood, vastus = paring("POST", "/login", {"username": kasutaja, "password": getpass.getpass("Parool: ")})
    token = vastus.get("token")
    if kood != 200 or not token:
        sys.exit(f"Sisselogimine ebaõnnestus: {kood} {vastus.get('message')}")
    vead = 0
    for w in tood:
        kood, vastus = paring("DELETE", f"/admin/work/{w}", token=token)
        ok = kood == 200 and not kaust(w)
        vead += not ok
        print(f"{'OK  ' if ok else 'VIGA'} {w}  {kood} {'' if ok else vastus}")
    print(f"\nValmis, vigu {vead}.")


if __name__ == "__main__":
    main()
