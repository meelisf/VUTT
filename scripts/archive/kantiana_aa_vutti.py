#!/usr/bin/env python3
"""Kantiana „Briefe an Kant Bd. 1" (65fgpj) ↔ Akademie-Ausgabe X–XII segu-GT VUTT-i (#860, 22.11).

Sisend kantiana_vutti.json (LOSS qwen3.5/data/aa_kant/ekspordi_vutti.py): leht, kiri (AA viide),
mudel (kettal olnud toortekst), uus, lipud, valmis.
- valmis = True (420 lk): klapitus ilma ühegi lipureata → segu-GT tekst + seisund „Valmis" +
  kommentaar (märgitud skriptiga). Üks reegel: VUTT „Valmis" = treeningus (kasutaja 22.11).
- valmis = False (91 lk): lipuga read ja naabrid jäävad toorväljundiks, silt „Kantiana ülevaatus"
  + kommentaar lipuridadega; seisund jääb.
Tekst kirjutatakse ainult „Toores" lehele, millel on endiselt sama toortekst.

    python3 scripts/archive/kantiana_aa_vutti.py             # kuivkäivitus
    python3 scripts/archive/kantiana_aa_vutti.py --kirjuta

NB (22.11 õhtul): selle skripti tulemust parandas klapitus_uuendus.py (sõna kahel real, korpora „ß",
lõppkontroll, käsikirja ortograafia) — osa siin „Valmis"-iks märgitud lehti läks tagasi ülevaatusse.
Sisendfailid (serveri ~/ alt koristatud): LOSS qwen3.5/data/vutt_sisendid_20261122/ ja ekspordid
{aa_kant,parrot,morgenstern}/*.json. Töövoog: LOSS SPIKKER „Editsiooniga klapitus".
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
SISEND = os.path.expanduser("~/kantiana_vutti.json")
SILT = "Kantiana ülevaatus"
VALMIS_KOMMENTAAR = ("Märgitud „Valmis\" skriptiga 2026-11-22: klapitus Akademie-Ausgabega ({kiri}) andis lehele"
                     " ühegi lipureata vaste; read toorväljundist, sõnad AA-st (#860). Pistelise kontrolli järel"
                     " vajadusel paranda.")


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
    read = [f"Klapitus Akademie-Ausgabega ({o['kiri']}; #860). AA on lähtetekst, mitte tõde —"
            " ta normaliseerib õigekirja ja paigutab kirja lõpu (vormel, kuupäev, allkiri) vahel ümber.",
            "", "Üle vaadata (need read on lehel toorväljundis):"]
    for f in o["lipud"]:
        r = f["rieger"].strip()
        aa = f"AA: `{r}`" if r else "AA-s vastet pole"
        read.append(f"- rida {f['rida']}: {f['pohjus']} ({aa})")
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
          f"Valmis {sum(1 for t in tood if t[0].get('valmis'))}, "
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
        if o["lipud"] or o.get("valmis"):
            meta = json.load(open(os.path.join(DATA, kaust, fail[:-4] + ".json"), encoding="utf-8"))
            base = {"text_content": tekst, "status": meta.get("status"),
                    **{k: meta.get(k) or [] for k in ("page_tags", "comments", "text_annotations")}}
            uus_meta = dict(meta)
            if o.get("valmis"):
                uus_meta["status"] = "Valmis"
            else:
                tags = list(meta.get("page_tags") or [])
                if not any((t.get("label") if isinstance(t, dict) else t) == SILT for t in tags):
                    tags.append(SILT)
                uus_meta["page_tags"] = tags
            kid = f"klapitus-{o['leht']}"
            kommentaarid = list(meta.get("comments") or [])
            tekst_k = VALMIS_KOMMENTAAR.format(kiri=o["kiri"]) if o.get("valmis") else kommentaar(o)
            if not any(isinstance(c, dict) and c.get("id") == kid for c in kommentaarid):
                kommentaarid.append({"id": kid, "text": tekst_k, "author": nimi,
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
