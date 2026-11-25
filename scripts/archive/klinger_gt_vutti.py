#!/usr/bin/env python3
"""Klingeri treening-GT kontroll (2026-11-25): kahtlased kohad annotatsioonidena ALGSETELE lehtedele.

Taust: kurrendi v7 halvenes Klingeri holdoutil (t9zd42, +3…8 pp lehe kohta) ja vead olid usutavad,
aga valed sõnad. Treeningallikas `klinger_vutt` (138 treeninglehte) on Riegeri editsiooni klapitusest
ja VUTT-is „Valmis", aga GT-sse on jäänud Riegeri kujusid (pildi järgi kontrollitud szbnsm-005:
„July" ← pildil „Juny", „Müssen" ← „Müsten", „und" ← „u", „friedlichen" ← „freundlichen", …).

Märgendaja (LOSS `qwen3.5/scripts/klinger_gt_margi.py`) võrdles lehe VUTT-i teksti mudeli lugemiga,
mis seda lehte treeningus ei näinud (szbnsm: v5 lugem; Morgenstern: VUTT-i git-i „Originaal OCR"), ja
märkis kohad, kus GT kuju tuleb positsiooniliselt Riegerist (naabersõnad + segment Riegeri tekstis
järjest) ning ümbrus klapib. 120 lehte / 1017 kohta (szbnsm 51, t9zd42 47, 671arc 17, ffqg7z 5).

Iga koht läheb algse lehe tekstisiseseks annotatsiooniks `<annN>` + `text_annotations` kirje (ADR 0041)
autoriga „Klingeri GT kontroll". Treeningu ehitaja (`ehita_gt_vutt.clean_markup`) võtab `<ann>` maha.
Salvestus käib `/save` kaudu baasseisuga (ADR 0054): märgendaja nägi teksti `tekst`, kettal võib nüüdseks
olla uuem — server liidab kolmesuunaliselt; konflikt → leht jäetakse vahele ja loetletakse.
Seisund jääb samaks; `--toos` paneb lehe „Töös" (siis on ta treeningust väljas kuni uue „Valmis"-ini).

Sisend ~/klinger_gt/klinger_margitud.json (LOSS `data/klinger_gt_kontroll/`):
  {leht: {tekst (märgendaja nähtud), tekst_ann, ann: [...], kohad: [...], fail (tee data/ suhtes)}}
Olek ~/klinger_gt/olek.json (jätkatav: tehtud lehed jäetakse vahele).

    python3 scripts/archive/klinger_gt_vutti.py                     # kuivkäivitus
    python3 scripts/archive/klinger_gt_vutti.py --kirjuta [--toos]  # admin
"""
import getpass
import json
import os
import sys
import unicodedata
import urllib.error
import urllib.request

DATA = os.path.expanduser("~/VUTT/data")
API = "http://127.0.0.1:8002"
SISEND = os.path.expanduser("~/klinger_gt")
OLEK = os.path.join(SISEND, "olek.json")
AUTOR = "Klingeri GT kontroll"


def paring(meetod, tee, keha=None, token=None, timeout=300):
    req = urllib.request.Request(API + tee, method=meetod,
                                 headers={"Content-Type": "application/json",
                                          **({"Authorization": f"Bearer {token}"} if token else {})},
                                 data=json.dumps(keha).encode() if keha is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, {}


def lae_olek():
    return json.load(open(OLEK, encoding="utf-8")) if os.path.exists(OLEK) else {"tehtud": {}, "vahele": {}}


def salvesta_olek(o):
    tmp = OLEK + ".tmp"
    json.dump(o, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    os.replace(tmp, OLEK)


def main():
    lehed = json.load(open(os.path.join(SISEND, "klinger_margitud.json"), encoding="utf-8"))
    toos = "--toos" in sys.argv
    o = lae_olek()
    plaan, muutunud, juba = [], [], []
    for leht in sorted(lehed):
        x = lehed[leht]
        tee = os.path.join(DATA, x["fail"])
        if leht in o["tehtud"]:
            continue
        if not os.path.exists(tee):
            sys.exit(f"{leht}: faili {x['fail']} ei ole")
        tekst = open(tee, encoding="utf-8").read()
        meta = json.load(open(tee[:-4] + ".json", encoding="utf-8"))
        if any(a.get("author") == AUTOR for a in meta.get("text_annotations") or []):
            juba.append(leht); continue
        if tekst != x["tekst"]:
            muutunud.append(leht)                     # liidetakse serveris baasseisu vastu
        plaan.append((leht, x, tee, tekst, meta))
    kohti = sum(len(x["kohad"]) for _, x, *_ in plaan)
    print(f"lehti {len(plaan)} (tehtud varem {len(o['tehtud'])}, juba annoteeritud {len(juba)}), kohti {kohti}")
    print(f"tekst muutunud pärast eksporti: {len(muutunud)} {muutunud[:10]}")
    print(f"seisund: {'Töös' if toos else 'jääb samaks'}")
    if "--kirjuta" not in sys.argv:
        print("\nKuivkäivitus. Kirjutamiseks: --kirjuta [--toos]")
        return
    kasutaja = input("Kasutajanimi: ").strip()
    kood, v = paring("POST", "/login", {"username": kasutaja, "password": getpass.getpass("Parool: ")})
    token = v.get("token")
    if kood != 200 or not token:
        sys.exit(f"Sisselogimine ebaõnnestus: {kood} {v.get('message')}")

    for leht, x, tee, tekst, meta in plaan:
        kd, fail = x["fail"].split("/", 1)
        # baas = märgendaja nähtud tekst + praegused metaväljad; server liidab vahepealse muudatuse
        base = {"text_content": x["tekst"], **{k: meta.get(k) for k in ("status", "page_tags", "comments", "text_annotations")}}
        m = dict(meta)
        m["text_annotations"] = x["ann"]           # sisaldab lehe varasemaid kirjeid + uued
        if toos:
            m["status"] = "Töös"
        kood, v = paring("POST", "/save", {"original_path": kd, "file_name": fail,
                                           "text_content": unicodedata.normalize("NFC", x["tekst_ann"]),
                                           "meta_content": m, "base": base}, token=token)
        if kood >= 400 or (isinstance(v, dict) and v.get("status") == "error"):
            o["vahele"][leht] = f"{kood} {v}"[:300]; salvesta_olek(o)
            print(f"  VAHELE {leht}: {kood} {str(v)[:120]}")
            continue
        o["tehtud"][leht] = len(x["kohad"]); o["vahele"].pop(leht, None); salvesta_olek(o)
        print(f"  {leht}: {len(x['kohad'])} kohta")
    print(f"\nTehtud {len(o['tehtud'])} lehte, vahele {len(o['vahele'])}: {list(o['vahele'])}")


if __name__ == "__main__":
    main()
