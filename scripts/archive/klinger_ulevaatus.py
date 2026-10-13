#!/usr/bin/env python3
"""Klingeri lehed ühte ülevaatusgruppi (#576): lehesilt „Klingeri ülevaatus" + kommentaar
käsitsi parandatavate ridadega; 3. partii lehtedele ka Riegeri tekst.

Sisend klinger_ulevaatus.json (91 lehte: partiid 1–3, LOSS data/rieger/klapitus/).
Tekst kirjutatakse ainult 3. partii lehele ja ainult siis, kui kettal on veel OCR-tekst;
1.–2. partii lehe tekst jääb selliseks, nagu kettal on (ka kasutaja parandused).
Salvestus /save kaudu baasseisuga (kolmesuunaline liitmine, ADR 0054). Korduskäivitus
ei lisa silti ega kommentaari teist korda.

Gruppi näeb: https://vutt.utlib.ut.ee/search?pageTags=Klingeri%20%C3%BClevaatus

    python3 klinger_ulevaatus.py             # kuivkäivitus
    python3 klinger_ulevaatus.py --kirjuta
"""
import datetime
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
SISEND = os.path.expanduser("~/klinger_ulevaatus.json")
SILT = "Klingeri ülevaatus"


def lehe_fail(leht):
    teos, nr = leht.rsplit("-", 1)
    k = glob.glob(os.path.join(DATA, f"*-{teos}"))
    if len(k) != 1:
        return None, None
    f = glob.glob(os.path.join(k[0], f"*-{nr}.txt"))
    return (os.path.basename(k[0]), os.path.basename(f[0])) if len(f) == 1 else (None, None)


def norm(s):
    return unicodedata.normalize("NFC", s).strip()


def kommentaar(o):
    read = [f"Klapitus Riegeri Briefbuchiga (#576, {o['kiri']}). Rieger on lähtetekst, mitte tõde —"
            " ta kirjutab vahel „und\", kus käsikirjas on „u\", ja normaliseerib kuupäevi.", ""]
    if not o["lipud"]:
        read.append("Märgitud ridu pole — vaata leht lihtsalt üle.")
    else:
        read.append("Üle vaadata:")
        for f in o["lipud"]:
            teine = f"Rieger: `{f['rieger']}`" if f["kirjutatud"] == "ocr" else f"OCR: `{f['ocr']}`"
            read.append(f"- rida {f['rida']}: {f['pohjus']} (lehel {f['kirjutatud']}; {teine})")
    return "\n".join(read)


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


def kava():
    """(o, kaust, fail, uus_tekst | None) kõigile lehtedele + vahelejäetud."""
    tood, vahele = [], []
    for o in json.load(open(SISEND, encoding="utf-8")):
        kaust, fail = lehe_fail(o["leht"])
        if not fail:
            vahele.append((o["leht"], "faili ei leitud")); continue
        tekst = open(os.path.join(DATA, kaust, fail), encoding="utf-8").read()
        uus = None
        if o["partii"] == "rieger_vutti3.json":
            if norm(tekst) == norm(o["mudel"]):
                uus = o["uus"]
            elif norm(tekst) != norm(o["uus"]):
                vahele.append((o["leht"], "3. partii: kettal muu tekst")); continue
        tood.append((o, kaust, fail, tekst, uus))
    return tood, vahele


def main():
    tood, vahele = kava()
    for leht, pohj in vahele:
        print(f"VAHELE {leht}: {pohj}")
    print(f"Lehti {len(tood)} (neist teksti kirjutamine {sum(1 for t in tood if t[4])}), vahele {len(vahele)}.")
    if "--kirjuta" not in sys.argv:
        o = next(t[0] for t in tood if t[0]["lipud"])
        print(f"\nNäidiskommentaar ({o['leht']}):\n{kommentaar(o)}\n\nKuivkäivitus. Kirjutamiseks: --kirjuta")
        return
    kasutaja = input("Kasutajanimi: ").strip()
    kood, vastus = paring("POST", "/login", {"username": kasutaja, "password": getpass.getpass("Parool: ")})
    token = vastus.get("token")
    if kood != 200 or not token:
        sys.exit(f"Sisselogimine ebaõnnestus: {kood} {vastus.get('message')}")
    nimi = (vastus.get("user") or {}).get("name") or kasutaja
    vead = 0
    for o, kaust, fail, tekst, uus in tood:
        meta = json.load(open(os.path.join(DATA, kaust, fail[:-4] + ".json"), encoding="utf-8"))
        base = {"text_content": tekst, "status": meta.get("status"),
                **{k: meta.get(k) or [] for k in ("page_tags", "comments", "text_annotations")}}
        uus_meta = dict(meta)
        tags = list(meta.get("page_tags") or [])
        if not any((t.get("label") if isinstance(t, dict) else t) == SILT for t in tags):
            tags.append(SILT)
        uus_meta["page_tags"] = tags
        kid = f"klapitus-{o['leht']}"
        kommentaarid = list(meta.get("comments") or [])
        if not any(isinstance(c, dict) and c.get("id") == kid for c in kommentaarid):
            kommentaarid.append({"id": kid, "text": kommentaar(o), "author": nimi, "author_username": kasutaja,
                                 "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat()})
        uus_meta["comments"] = kommentaarid
        kood, vastus = paring("POST", "/save", {"original_path": kaust, "file_name": fail,
                                                 "text_content": uus if uus else tekst,
                                                 "meta_content": uus_meta, "base": base}, token=token)
        ok = kood == 200 and vastus.get("git_committed")
        vead += not ok
        print(f"{'OK  ' if ok else 'VIGA'} {o['leht']}  {kood} {'' if ok else vastus}"
              f"{' (muutusteta)' if ok and not vastus.get('changed') else ''}")
    print(f"\nValmis, vigu {vead}.")


if __name__ == "__main__":
    main()
