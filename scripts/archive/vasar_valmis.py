#!/usr/bin/env python3
"""jbc88t (Vasari klapitus) järelkontroll: käsikirja „&" tagasi + kindlad lehed „Valmis" (2026-11-22).

Vasar ja v5 mudel kirjutasid käsikirja „&" lahti („et"). Iga eraldiseisva „et"/„etc" kohta
otsustas Gemini 3.8 Flash lehe pildi järgi, kas käsikirjas on „&"/„&c" (LOSS
qwen3.5/data/vasar/kontroll/ampersand.py; pilootlehed 28 ja 33 kontrollitud pildi järgi,
kõik otsused õiged — lk 27–30 teine käsi kirjutab tõesti „et"). Mudel tekstisisu ei muutnud.

„Valmis" saavad 32 klapitud lehte, mis on 03.11 üle vaadatud ja v5 mudeliga kooskõlas
(lehe keskmine lahknevus ≤ 5,4 %). Lehed 36, 38, 39 (wpfud0, 021, 022: teine käsi, suurem
lahknevus, käsikirjast puudub lõik) saavad ainult „&"-parandused, seisund jääb.
Kasutaja kiitis heaks skriptiga „Valmis"-märkimise (ADR järgi automaatselt ei märgita).

Sisend ~/vasar_valmis.json: leht, mudel (kettal olnud tekst), uus, valmis.
Leht kirjutatakse ainult siis, kui kettal on endiselt sama tekst. Salvestus /save kaudu
baasseisuga (ADR 0054); kommentaari `vasar-*` lõppu lisatakse üks rida.

    python3 scripts/archive/vasar_valmis.py             # kuivkäivitus
    python3 scripts/archive/vasar_valmis.py --kirjuta
"""
import copy
import getpass
import json
import os
import sys
import unicodedata
import urllib.error
import urllib.request

DATA = os.path.expanduser("~/VUTT/data")
KAUST = "1632-tartu-ulikooli-academia-gustaviana-pohikiri-17-saj-2-pool-umber-kirjutanud"
TUVI = KAUST + "-jbc88t-"
API = "http://127.0.0.1:8002"
SISEND = os.path.expanduser("~/vasar_valmis.json")
LISA_VALMIS = "\n\nKäsikirja „&\" taastatud ja leht märgitud „Valmis\" järelkontrolli skriptiga 2026-11-22."
LISA_AMP = "\n\nKäsikirja „&\" taastatud 2026-11-22; seisund jäi (teine käsi / puuduv lõik — vaata üle)."


def nfc(s):
    return unicodedata.normalize("NFC", s)


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


def uus_meta(meta, valmis):
    m = copy.deepcopy(meta)
    lisa = LISA_VALMIS if valmis else LISA_AMP
    for c in m.get("comments") or []:
        if str(c.get("id", "")).startswith("vasar-") and lisa.strip() not in c.get("text", ""):
            c["text"] = c.get("text", "") + lisa
    if valmis:
        m["status"] = "Valmis"
    return m


def main():
    tood, vahele = [], []
    for o in json.load(open(SISEND, encoding="utf-8")):
        fail = f"{TUVI}{o['leht']}.txt"
        tee = os.path.join(DATA, KAUST, fail)
        if not os.path.exists(tee):
            vahele.append((o["leht"], "faili ei leitud")); continue
        tekst = open(tee, encoding="utf-8").read()
        if nfc(tekst).strip() not in (nfc(o["mudel"]).strip(), nfc(o["uus"]).strip()):
            vahele.append((o["leht"], "kettal muu tekst (toimetatud?)")); continue
        meta = json.load(open(tee[:-4] + ".json", encoding="utf-8"))
        tood.append((o, fail, tekst, meta, uus_meta(meta, o["valmis"])))
    for leht, pohj in vahele:
        print(f"VAHELE {leht}: {pohj}")
    print(f"Lehti {len(tood)} (Valmis {sum(1 for t in tood if t[0]['valmis'])}), "
          f"&-asendusi {sum(t[0]['asendusi'] for t in tood)}, vahele {len(vahele)}.")
    if "--kirjuta" not in sys.argv:
        print("\nKuivkäivitus. Kirjutamiseks: --kirjuta")
        return
    kasutaja = input("Kasutajanimi: ").strip()
    kood, vastus = paring("POST", "/login", {"username": kasutaja, "password": getpass.getpass("Parool: ")})
    token = vastus.get("token")
    if kood != 200 or not token:
        sys.exit(f"Sisselogimine ebaõnnestus: {kood} {vastus.get('message')}")
    vead = 0
    for o, fail, tekst, meta, m in tood:
        base = {"text_content": tekst, **{k: meta.get(k) for k in
                                          ("status", "page_tags", "comments", "text_annotations")}}
        kood, vastus = paring("POST", "/save", {"original_path": KAUST, "file_name": fail,
                                                 "text_content": o["uus"], "meta_content": m,
                                                 "base": base}, token=token)
        ok = kood == 200 and vastus.get("git_committed") is not False
        vead += not ok
        print(f"{'OK  ' if ok else 'VIGA'} {o['leht']}  {kood} {'' if ok else vastus}"
              f"{' (muutusteta)' if ok and not vastus.get('changed') else ''}")
    print(f"\nValmis, vigu {vead}.")


if __name__ == "__main__":
    main()
