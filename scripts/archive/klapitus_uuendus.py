#!/usr/bin/env python3
"""Segu-GT klapituse parandus VUTT-is (22.11, pärast kasutaja leitud vigu t9zd42-052/058).

Ehitajate parandused (LOSS aa_kant/parrot/morgenstern): teise ringi vaste ei haara enam naaberrea
sõna (t9zd42-058 „Kollegienrath" kaks korda), korpora.org kaotatud „ß" taastatakse toorväljundist
(51 kohta, „da" pro „daß"), lõppkontroll (rida toorrea vastu: CER > 0,45, kordab eelmist rida,
AA sulg, sõnatükk rea servas) → lipp.

Kasutatud kahes voorus: (1) kordus/ß/lõppkontroll — 126 lehte, 36 Valmis → ülevaatus; (2) käsikirja
ortograafia (mudelil ß ja editsioonil ss, märgiga lühend) — 126 lehte, ainult tekst. Sisend arhiveeritud:
LOSS qwen3.5/data/vutt_sisendid_20261122/.

Sisend ~/klapitus_uuendus.json: [{leht, kiri, eelmine, uus, valmis, oli_valmis, lipud, silt, allikas}].
Leht muudetakse AINULT siis, kui kettal on täpselt meie eelmine tekst (inimese parandust ei puututa).
- valmis: uus tekst, seisund „Valmis", silt maha, kommentaar „märgitud skriptiga".
- ülevaatus: uus tekst (lipuread toorväljundis), seisund „Toores" (kui oli skriptiga Valmis),
  silt peale, kommentaar lipuridadega.
Meie varasemad kommentaarid (id klapitus-<leht>, valmis-<leht>) asendatakse ühega.

    python3 scripts/archive/klapitus_uuendus.py             # kuivkäivitus
    python3 scripts/archive/klapitus_uuendus.py --kirjuta
"""
import copy
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
SISEND = os.path.expanduser("~/klapitus_uuendus.json")
ALLIKAD = {"aa": ("Akademie-Ausgabega", "AA", "#860", "AA normaliseerib õigekirja ja paigutab kirja lõpu vahel ümber; "
                  "korpora.org tekstist on kohati kadunud „ß\"."),
           "rieger_parrot": ("Riegeri Briefbuchiga (Anhang I)", "Rieger", "#664",
                             "Rieger kirjutab vahel „und\", kus käsikirjas on „u\", ja normaliseerib kuupäevi."),
           "rieger_morgenstern": ("Riegeri Briefbuchiga", "Rieger", "#576",
                                  "Rieger normaliseerib kuupäevi, kirjutab lühendeid lahti ja jätab lõike välja.")}


def norm(s):
    return unicodedata.normalize("NFC", s).strip()


def kommentaar(o):
    kellega, lyh, issue, hoiatus = ALLIKAD[o["allikas"]]
    if o["valmis"]:
        return (f"Märgitud „Valmis\" skriptiga 2026-11-22: klapitus {kellega} ({o['kiri']}, {issue}) andis lehele"
                f" ühegi lipureata vaste; read toorväljundist, sõnad {lyh}-st. Pistelise kontrolli järel vajadusel paranda.")
    read = [f"Klapitus {kellega} ({o['kiri']}; {issue}, parandatud 22.11). {lyh} on lähtetekst, mitte tõde — {hoiatus}",
            "", "Üle vaadata (need read on lehel toorväljundis):"]
    for f in o["lipud"]:
        r = (f.get("rieger") or "").replace("*", "").strip()
        vaste = f"{lyh}: `{r}`" if r else f"{lyh}-s vastet pole"
        pohjus = f["pohjus"] if lyh == "AA" else f["pohjus"].replace("AA-ga", "Riegeriga").replace("AA-s", "Riegeris").replace("AA", "Rieger")
        read.append(f"- rida {f['rida']}: {pohjus} ({vaste})")
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


def main():
    tood, vahele = [], []
    for o in json.load(open(SISEND, encoding="utf-8")):
        teos, nr = o["leht"].rsplit("-", 1)
        f = glob.glob(os.path.join(DATA, f"*-{teos}", f"*-{nr}.txt"))
        if len(f) != 1:
            vahele.append((o["leht"], "faili ei leitud")); continue
        tekst = open(f[0], encoding="utf-8").read()
        meta = json.load(open(f[0][:-4] + ".json", encoding="utf-8"))
        if norm(tekst) != norm(o["eelmine"]):
            vahele.append((o["leht"], "kettal muu tekst (inimese parandus?) — jäta nii")); continue
        if meta.get("status") not in ("Toores", "Valmis", None):
            vahele.append((o["leht"], f"seisund {meta.get('status')}")); continue
        tood.append((o, f[0], tekst, meta))
    for leht, pohj in vahele:
        print(f"VAHELE {leht}: {pohj}")
    print(f"Uuendada {len(tood)} (Valmis {sum(1 for t in tood if t[0]['valmis'])}, ülevaatus "
          f"{sum(1 for t in tood if not t[0]['valmis'])}, neist Valmis → Toores "
          f"{sum(1 for t in tood if not t[0]['valmis'] and t[3].get('status') == 'Valmis')}), vahele {len(vahele)}.")
    if "--kirjuta" not in sys.argv:
        o = next((t[0] for t in tood if not t[0]["valmis"]), None)
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
    for o, tee, tekst, meta in tood:
        m = copy.deepcopy(meta)
        m["status"] = "Valmis" if o["valmis"] else "Toores"
        tags = [t for t in (m.get("page_tags") or []) if (t.get("label") if isinstance(t, dict) else t) != o["silt"]]
        if not o["valmis"]:
            tags.append(o["silt"])
        m["page_tags"] = tags
        meie = {f"klapitus-{o['leht']}", f"valmis-{o['leht']}"}
        kk = [c for c in (m.get("comments") or []) if not (isinstance(c, dict) and c.get("id") in meie)]
        kk.append({"id": f"klapitus-{o['leht']}", "text": kommentaar(o), "author": nimi, "author_username": kasutaja,
                   "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat()})
        m["comments"] = kk
        base = {"text_content": tekst, **{k: meta.get(k) for k in ("status", "page_tags", "comments", "text_annotations")}}
        kood, vastus = paring("POST", "/save", {"original_path": os.path.basename(os.path.dirname(tee)),
                                                 "file_name": os.path.basename(tee), "text_content": o["uus"],
                                                 "meta_content": m, "base": base}, token=token)
        ok = kood == 200 and vastus.get("git_committed") is not False
        vead += not ok
        print(f"{'OK  ' if ok else 'VIGA'} {o['leht']}  {kood} {'' if ok else vastus}")
    print(f"\nValmis, vigu {vead}.")


if __name__ == "__main__":
    main()
