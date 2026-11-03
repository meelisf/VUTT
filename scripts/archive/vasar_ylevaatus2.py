#!/usr/bin/env python3
"""jbc88t (Vasari klapitus), osa 2: lippudeta lehtede (6, 7, 11, 12, 18–20, 27–30, 34) parandused.

Koopia skriptist vasar_ylevaatus.py, ainult PARANDUSED erineb; kommentaarid on juba korras.

Parandused on tehtud skaneeringu järgi (2026-11-03). Põhimõte: tekst nagu käsikirjas,
interlineaarne lisandus on `<add>` oma kohas (ADR 0067), ridadevaheline sõna ei ole
omaette rida; püüdsõna on `<catch>`. Vasari laienduste eemaldamine jättis lühendid
punktita („v", „n", „I M D") — punkt tagasi nagu käsikirjas.

Kommentaaridest (id `vasar-*`) eemaldatakse „Üle vaadata" loend; asemele üks rida.
Salvestus /save kaudu koos meta_content'i ja base'iga (kolmesuunaline liitmine,
ADR 0054): leht kirjutatakse ainult siis, kui kettal on sama seis, mis kuivkäivitusel.

    python3 scripts/archive/vasar_ylevaatus2.py            # kuivkäivitus
    python3 scripts/archive/vasar_ylevaatus2.py --kirjuta
"""
import copy
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
KAUST = "1632-tartu-ulikooli-academia-gustaviana-pohikiri-17-saj-2-pool-umber-kirjutanud"
API = "http://127.0.0.1:8002"
SILT = "Vasari klapitus"
KOMMENTAARI_LOPP = "\n\nLipuga read skaneeringu järgi üle vaadatud 2026-11-03; ligatuurid (æ, œ) lahti kirjutatud."

# (lehe id, vana, uus) — vana peab failis esinema TÄPSELT üks kord
PARANDUSED = [
    # lk 6
    ("005", "Dicastarium", "Dicasterium"),
    ("005", "latas, si sit", "latas, <add>si</add> sit"),
    # lk 7
    ("006", "indulisit", "indulsit"),
    ("006", "Inspecere", "Inspicere"),
    ("006", "negligentiore, vel neqviore sunt", "negligentiores, vel neqviores sunt"),
    ("006", "certioreni", "certiorem"),
    ("006", "praesenté publice", "praesente publice"),
    # lk 11
    ("w7fej1", "concurrent.", "concurrant."),
    ("w7fej1", "Graviore lites", "Graviores lites"),
    ("w7fej1", "Sacrosanctus sit.", "Sacrosanctus sit.\n<catch>3.</catch>"),
    # lk 12
    ("vcfr18", "idqve facent", "idqve faciant"),
    # lk 18
    ("ri7cuq", "praesenté", "praesente"),
    # lk 19
    ("wrzl8o", "aliquid utilitatis", "aliqvid utilitatis"),
    ("wrzl8o", "praesent\u0435 Decano", "praesente Decano"),  # kirillitsa „е"
    ("wrzl8o", "ad Rectorem duce.", "ad Rectorem ducet."),
    # lk 20
    ("nwyopw", "per ministerum publicum", "per ministrum publicum"),
    ("nwyopw", "Candidatis instituuntur", "Candidatis instituentur"),
    # lk 27 (hilisem käsi)
    ("uu36ax", "aut ejus P-\nraeses, facent id", "aut ejus\nPraeses, facient id"),
    # lk 29
    ("65sayd", "V T libros", "V. T. libros"),
    ("65sayd", "Libros N T hora", "Libros N. T. hora"),
    ("65sayd", "Locos s Articulos", "Locos s. Articulos"),
    ("65sayd", "Leget a ante", "Leget a. ante"),
    # lk 30
    ("vtb1mb", "Uterque a tam", "Uterque a. tam"),
    ("vtb1mb", "sores tn gratis", "sores tn. gratis"),
    ("vtb1mb", "Hippocrate\nvel\nGaleno", "Hippocrate\n<add>vel</add> Galeno"),
    # lk 34
    ("7etk59", "Usum a praeceptorum", "Usum a. praeceptorum"),
]

# Vasari „v[ero]" / „n[am]" → käsikirja „v." / „n." (üksiktäht sõnana, punktita)
LUHEND = re.compile(r"(?<= )([vn])(?=[ ,]|$)", re.MULTILINE)


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


def teisenda_tekst(leht, tekst):
    uus = nfc(tekst)
    for lid, vana, asendus in PARANDUSED:
        if lid != leht:
            continue
        vana, asendus = nfc(vana), nfc(asendus)
        n = uus.count(vana)
        if n != 1:
            sys.exit(f"VIGA {leht}: {vana!r} esineb {n} korda (oodatud 1)")
        uus = uus.replace(vana, asendus)
    return LUHEND.sub(r"\1.", uus)


def koristatud_kommentaarid(kommentaarid):
    uued = copy.deepcopy(kommentaarid or [])
    muutus = False
    for c in uued:
        if not str(c.get("id", "")).startswith("vasar-"):
            continue
        tekst = c.get("text", "")
        for marker in ("\n\nÜle vaadata:", "\n\nMärgitud ridu pole"):
            i = tekst.find(marker)
            if i != -1:
                tekst = tekst[:i]
        if KOMMENTAARI_LOPP.strip() not in tekst:
            tekst += KOMMENTAARI_LOPP
        if tekst != c.get("text"):
            c["text"] = tekst
            muutus = True
    return uued, muutus


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
        leht = os.path.basename(tf).rsplit("jbc88t-", 1)[1][:-4]
        vana = open(tf, encoding="utf-8").read()
        uus = teisenda_tekst(leht, vana)
        kommentaarid, k_muutus = koristatud_kommentaarid(meta.get("comments"))
        if uus != nfc(vana) or k_muutus:
            uus_meta = dict(meta, comments=kommentaarid)
            tood.append((leht, os.path.basename(tf), vana, uus, meta, uus_meta))

    lehed = {lid for lid, *_ in PARANDUSED}
    puudu = lehed - {t[0] for t in tood}
    if puudu:
        sys.exit(f"VIGA: parandatavad lehed puuduvad: {sorted(puudu)}")

    luhendeid = sum(len(LUHEND.findall(nfc(t[2]))) for t in tood)
    print(f"Lehti {len(tood)}, käsitsi parandusi {len(PARANDUSED)}, lühendipunkte {luhendeid}.")
    for leht, fail, vana, uus, meta, uus_meta in tood:
        va, ua = nfc(vana).split("\n"), uus.split("\n")
        if va != ua:
            print(f"\n== {leht}")
            import difflib
            for rida in difflib.unified_diff(va, ua, lineterm="", n=0):
                if not rida.startswith(("---", "+++")):
                    print("  " + rida)

    if "--kirjuta" not in sys.argv:
        print("\nKuivkäivitus. Kirjutamiseks: --kirjuta")
        return

    kasutaja = input("Kasutajanimi: ").strip()
    kood, vastus = paring("POST", "/login", {"username": kasutaja, "password": getpass.getpass("Parool: ")})
    token = vastus.get("token")
    if kood != 200 or not token:
        sys.exit(f"Sisselogimine ebaõnnestus: {kood} {vastus.get('message')}")
    vead = 0
    for leht, fail, vana, uus, meta, uus_meta in tood:
        if open(os.path.join(kaust, fail), encoding="utf-8").read() != vana or \
                json.load(open(os.path.join(kaust, fail[:-4] + ".json"), encoding="utf-8")) != meta:
            print(f"VAHELE {leht}: leht muutunud pärast lugemist")
            vead += 1
            continue
        base = {"text_content": vana, **{k: meta.get(k) for k in
                                         ("status", "page_tags", "comments", "text_annotations")}}
        kood, vastus = paring("POST", "/save", {"original_path": KAUST, "file_name": fail,
                                                 "text_content": uus, "meta_content": uus_meta,
                                                 "base": base}, token=token)
        ok = kood == 200 and vastus.get("changed") and vastus.get("git_committed")
        vead += not ok
        print(f"{'OK  ' if ok else 'VIGA'} {leht}  {kood} {'' if ok else vastus}")
    print(f"\nValmis, vigu {vead}.")


if __name__ == "__main__":
    main()
