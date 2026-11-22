#!/usr/bin/env python3
"""Klingeri Morgensterni-kirjade (671arc, ffqg7z, t9zd42) Riegeri vastega lehed, mis jäid #576
ülevaatusest välja: uus lugem (kurrent-20261013, Klingeri käega treenitud) + Riegeri tekst
(Kantiana/Parroti torustik, LOSS qwen3.5/data/morgenstern/). Sama tava nagu parrot_rieger_vutti.py.

Sisend morgenstern_vutti.json (LOSS ekspordi_vutti.py): leht, kiri, mudel (kettal olnud v4 tekst),
uus (v5 reajaotus, Riegeri sõnad; lipuga read ja nende naabrid jäävad v5 toorväljundiks), lipud.
Tekst kirjutatakse ainult „Toores" lehele, millel on endiselt sama tekst — vahepeal
toimetatud lehte ei puututa. Lipuga lehele lisatakse silt „Klingeri ülevaatus" (sama grupp, mis #576) ja
kommentaar lipuridadega. Salvestus /save kaudu baasseisuga (ADR 0054); korduskäivitus ei lisa
silti ega kommentaari teist korda.

    python3 klinger_morgenstern_vutti.py             # kuivkäivitus
    python3 klinger_morgenstern_vutti.py --kirjuta
    python3 klinger_morgenstern_vutti.py ~/morgenstern_v5.json [--kirjuta]   # vasteta lehed: ainult v5 lugem
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
SISEND = os.path.expanduser(next((a for a in sys.argv[1:] if a.endswith(".json")), "~/morgenstern_vutti.json"))
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
    read = [f"Klapitus Riegeri Briefbuchiga ({o['kiri']}; #576, uus lugem 22.11). Rieger on lähtetekst,"
            " mitte tõde — ta normaliseerib kuupäevi, kirjutab lühendeid lahti („N.\" → „Nummer\") ja jätab lõike välja.",
            "", "Üle vaadata (need read on lehel toorväljundis):"]
    for f in o["lipud"]:
        r = f["rieger"].replace("*", "").strip()
        rieger = f"Rieger: `{r}`" if r else "Riegeris vastet pole"
        # lipunimed tulevad Kantiana torustikust (AA = võrdlustekst, siin Rieger)
        read.append(f"- rida {f['rida']}: {f['pohjus'].replace('AA-ga', 'Riegeriga').replace('AA-s', 'Riegeris').replace('AA', 'Rieger')} ({rieger})")
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
    tood, vahele = [], []
    for o in json.load(open(SISEND, encoding="utf-8")):
        kaust, fail = lehe_fail(o["leht"])
        if not fail:
            vahele.append((o["leht"], "faili ei leitud")); continue
        tekst = open(os.path.join(DATA, kaust, fail), encoding="utf-8").read()
        staatus = json.load(open(os.path.join(DATA, kaust, fail[:-4] + ".json"), encoding="utf-8")).get("status")
        if staatus not in (None, "Toores") and norm(tekst) != norm(o["uus"]):
            vahele.append((o["leht"], f"seisund {staatus} (keegi töötab)")); continue
        if norm(tekst) == norm(o["mudel"]):
            uus = o["uus"]
        elif norm(tekst) == norm(o["uus"]):
            uus = None                                   # juba kirjutatud (korduskäivitus)
        else:
            vahele.append((o["leht"], "kettal muu tekst (toimetatud?)")); continue
        tood.append((o, kaust, fail, tekst, uus))
    return tood, vahele


def main():
    tood, vahele = kava()
    for leht, pohj in vahele:
        print(f"VAHELE {leht}: {pohj}")
    print(f"Lehti {len(tood)} (teksti kirjutamine {sum(1 for t in tood if t[4])}, "
          f"ülevaatusgruppi {sum(1 for t in tood if t[0]['lipud'])}), vahele {len(vahele)}.")
    if "--kirjuta" not in sys.argv:
        o = next((t[0] for t in tood if t[0]["lipud"]), None)
        if o:
            print(f"\nNäidiskommentaar ({o['leht']}):\n{kommentaar(o)}")
        print("\nKuivkäivitus. Kirjutamiseks: --kirjuta")
        return
    kasutaja = input("Kasutajanimi: ").strip()
    kood, vastus = paring("POST", "/login", {"username": kasutaja, "password": getpass.getpass("Parool: ")})
    token = vastus.get("token")
    if kood != 200 or not token:
        sys.exit(f"Sisselogimine ebaõnnestus: {kood} {vastus.get('message')}")
    nimi = (vastus.get("user") or {}).get("name") or kasutaja
    vead = 0
    for o, kaust, fail, tekst, uus in tood:
        keha = {"original_path": kaust, "file_name": fail, "text_content": uus if uus else tekst}
        if o["lipud"]:
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
                kommentaarid.append({"id": kid, "text": kommentaar(o), "author": nimi,
                                     "author_username": kasutaja,
                                     "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat()})
            uus_meta["comments"] = kommentaarid
            keha.update(meta_content=uus_meta, base=base)
        elif not uus:
            print(f"OK   {o['leht']}  (juba kirjutatud)"); continue
        kood, vastus = paring("POST", "/save", keha, token=token)
        ok = kood == 200 and vastus.get("git_committed") is not False
        vead += not ok
        print(f"{'OK  ' if ok else 'VIGA'} {o['leht']}  {kood} {'' if ok else vastus}"
              f"{' (muutusteta)' if ok and not vastus.get('changed') else ''}")
    print(f"\nValmis, vigu {vead}.")


if __name__ == "__main__":
    main()
