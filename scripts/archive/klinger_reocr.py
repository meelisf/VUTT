#!/usr/bin/env python3
"""Klingeriana käsikirjade batch re-OCR uue Kurrendi mudeliga (kurrent-20261009).

Valib kollektsiooni `klingeriana` käsikirjad (type Q87167) ja neist ainult
lehed staatusega „Toores“. Töös/Valmis lehti ei puututa. Pärast batchide
lõppu rakendab (`reocr-apply`, üks commit teose kohta) AINULT need valitud
lehed — teose muud ootel `.ocr`-id jäävad puutumata. Vana OCR jääb gitti.

Batch-tööd elavad serveriprotsessi mälus, seega käivitus käib HTTP API kaudu
(127.0.0.1:8002) admini sessiooniga. Parool küsitakse getpass-iga.

    python3 klinger_reocr.py              # kuivkäivitus: ainult nimekiri
    python3 klinger_reocr.py --kaivita    # käivitab, ootab, rakendab (~30 min, tmux-is)
    python3 klinger_reocr.py --teos t9zd42 [--kaivita]
                                          # ainult need teosed (kollektsioonist sõltumata)
"""
import getpass
import glob
import json
import os
import sys
import time
import urllib.request

DATA = os.path.expanduser("~/VUTT/data")
API = "http://127.0.0.1:8002"
KOGU = "klingeriana"
KASIKIRI = "Q87167"


def tyyp(meta):
    t = meta.get("type")
    return t.get("id") if isinstance(t, dict) else t


def valik(teosed=None):
    tood = []
    for m in sorted(glob.glob(os.path.join(DATA, "*", "_metadata.json"))):
        with open(m, encoding="utf-8") as f:
            meta = json.load(f)
        kogud = meta.get("collections") or ([meta["collection"]] if meta.get("collection") else [])
        wid = meta.get("work_id") or meta.get("id")
        if teosed:
            if wid not in teosed:
                continue
        elif KOGU not in kogud:
            continue
        if tyyp(meta) != KASIKIRI:
            continue
        kaust = os.path.dirname(m)
        lehed, vahele = [], []
        for pilt in sorted(glob.glob(os.path.join(kaust, "*.jpg"))):
            jsonfail = pilt[:-4] + ".json"
            staatus = "?"
            if os.path.exists(jsonfail):
                with open(jsonfail, encoding="utf-8") as f:
                    staatus = json.load(f).get("status", "?")
            (lehed if staatus == "Toores" else vahele).append((os.path.basename(pilt), staatus))
        tood.append((meta.get("work_id") or meta.get("id"), os.path.basename(kaust), lehed, vahele))
    return tood


def post(tee, keha, token=None):
    req = urllib.request.Request(API + tee, data=json.dumps(keha).encode(), method="POST",
                                 headers={"Content-Type": "application/json"})
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def get(tee, token):
    req = urllib.request.Request(API + tee, headers={"Authorization": "Bearer " + token})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def oota(kaivitatud, token):
    """Ootab, kuni ühelgi käivitatud teosel pole aktiivset batchi."""
    while True:
        aktiivsed = []
        for wid in kaivitatud:
            try:
                if get(f"/admin/work/{wid}/reocr-status", token).get("active"):
                    aktiivsed.append(wid)
            except Exception as e:      # ajutine võrguviga ei katkesta ootamist
                print(f"  seisu päring {wid}: {e}")
                aktiivsed.append(wid)
        if not aktiivsed:
            return
        print(f"{time.strftime('%H:%M')}  käib veel {len(aktiivsed)} teost")
        time.sleep(60)


def main():
    teosed = None
    if "--teos" in sys.argv:
        i = sys.argv.index("--teos")
        teosed = set(sys.argv[i + 1].split(","))
    tood = valik(teosed)
    kokku = sum(len(l) for _, _, l, _ in tood)
    for wid, kaust, lehed, vahele in tood:
        lisa = f"  (vahele: {', '.join(f'{p} [{s}]' for p, s in vahele)})" if vahele else ""
        print(f"{wid}  {len(lehed):4d} lk  {kaust}{lisa}")
    print(f"\nKokku {len(tood)} teost, {kokku} lehte.")
    if "--kaivita" not in sys.argv:
        print("Kuivkäivitus. Käivitamiseks: --kaivita")
        return

    kasutaja = input("Kasutajanimi: ").strip()
    parool = getpass.getpass("Parool: ")
    kood, vastus = post("/login", {"username": kasutaja, "password": parool})
    token = vastus.get("token")
    if kood != 200 or not token:
        sys.exit(f"Sisselogimine ebaõnnestus: {kood} {vastus.get('message')}")

    vead = 0
    kaivitatud = {}
    for wid, kaust, lehed, _ in tood:
        if not lehed:
            continue
        kood, vastus = post(f"/admin/work/{wid}/reocr-batch",
                            {"page_filenames": [p for p, _ in lehed], "material_type": "hand"},
                            token)
        if kood == 200:
            kaivitatud[wid] = [p for p, _ in lehed]
            print(f"OK   {wid}  {len(lehed):4d} lk  job {vastus.get('job_id')}")
        else:
            vead += 1
            print(f"VIGA {wid}  {kood} {vastus.get('detail') or vastus}")
        time.sleep(2)

    print("\nOotan batchide lõppu...")
    oota(kaivitatud, token)

    print("\nRakendan:")
    for wid, lehed in kaivitatud.items():
        valmis = set(get(f"/admin/work/{wid}/reocr-status", token).get("ocr_ready") or [])
        rakenda = [p for p in lehed if p[:-4] in valmis]
        if not rakenda:
            vead += 1
            print(f"VIGA {wid}  ühtki .ocr-i ei tulnud")
            continue
        kood, vastus = post(f"/admin/work/{wid}/reocr-apply", {"page_filenames": rakenda}, token)
        failed = vastus.get("failed") or []
        puudu = len(lehed) - len(rakenda)
        if kood != 200 or failed or puudu:
            vead += 1
        print(f"{'OK  ' if kood == 200 and not failed else 'VIGA'} {wid}  "
              f"rakendatud {len(vastus.get('applied') or [])}/{len(lehed)}"
              f"{f', OCR-ita jäi {puudu}' if puudu else ''}"
              f"{f', tõrked {failed}' if failed else ''}")

    post("/logout", {}, token)
    print(f"\nValmis, probleemseid teoseid {vead}.")


if __name__ == "__main__":
    main()
