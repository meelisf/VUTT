#!/usr/bin/env python3
"""Rahvusarhiivi GT (ra_et) holdout VUTT-i kontrolliks (2026-11-24).

Kurrendi v7 eesti holdout = 5 dokumenti / 39 kärbet (LOSS qwen3.5/data/ra_et_v7, ehitaja scripts/ra_et_gt.py).
GT on Rahvusarhiivi Transkribuse transkriptsioon (CC0, HF Rahvusarhiiv/et_handwriting_complete), kontrollimata.
Iga dokument = üks VUTT-i teos (käsikiri, Q87167), leht = üks kärbe; lehe tekstiks pannakse GT (mitte OCR),
seisund „Töös". Üliõpilane võrdleb pildiga, parandab ja märgib „Valmis"; pärast ehitatakse ra_et holdout
VUTT-ist uuesti (VUTT „Valmis" = GT).

Kogu: uus piiratud kogu (kasutaja 24.11), töökollektsioon eraldi. Kõik käib tavalise API kaudu
(upload: create → /files → prepress/apply → OCR → import; tekst /save baasseisuga, ADR 0054), seepärast
jookseb SERVERIS (lehe JSON loetakse kettalt — lehe lugemise API-t ei ole).

Sisend ~/ra_et_holdout/: holdout.json [{dokument, pealkiri, ais: [...], karbed: [{fail, ais, lk, n, gt}]}]
+ images/<fail>. Olek ~/ra_et_holdout/olek.json (jätkatav; seal ka leht ↔ kärbe vastavus).

    python3 scripts/archive/ra_et_holdout_vutti.py                 # kuivkäivitus
    python3 scripts/archive/ra_et_holdout_vutti.py --kirjuta       # superadmin (kogu loomine)
"""
import getpass
import json
import os
import sys
import time
import unicodedata
import urllib.error
import urllib.request

DATA = os.path.expanduser("~/VUTT/data")
API = "http://127.0.0.1:8002"
SISEND = os.path.expanduser("~/ra_et_holdout")
OLEK = os.path.join(SISEND, "olek.json")
KOGU = "rahvusarhiiv-gt"
KOGU_NIMI = ("Rahvusarhiivi GT (kontroll)", "National Archives of Estonia GT (review)")
KOMPLEKT_NIMI = {"et": "Rahvusarhiivi GT holdout — kontroll", "en": "National Archives GT holdout — review"}
HF = "https://huggingface.co/datasets/Rahvusarhiiv/et_handwriting_complete"
SEISUND = "Töös"
KASIKIRI = {"id": "Q87167", "label": "käsikiri", "source": "wikidata",
            "labels": {"et": "käsikiri", "en": "manuscript"}}


def paring(meetod, tee, keha=None, token=None, toores=None, paised=None, timeout=300):
    p = {"Content-Type": "application/json"} if toores is None else {"Content-Type": "application/octet-stream"}
    p.update(paised or {})
    if token:
        p["Authorization"] = f"Bearer {token}"
    andmed = toores if toores is not None else (json.dumps(keha).encode() if keha is not None else None)
    req = urllib.request.Request(API + tee, method=meetod, headers=p, data=andmed)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, {}


def kindel(kood, vastus, mida):
    if kood >= 400 or (isinstance(vastus, dict) and vastus.get("status") == "error"):
        sys.exit(f"VIGA ({mida}): {kood} {vastus}")
    return vastus


def lae_olek():
    return json.load(open(OLEK, encoding="utf-8")) if os.path.exists(OLEK) else {"dok": {}}


def salvesta_olek(o):
    tmp = OLEK + ".tmp"
    json.dump(o, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    os.replace(tmp, OLEK)


def kaust(work_id):
    for d in os.listdir(DATA):
        if d.endswith("-" + work_id) and os.path.isdir(os.path.join(DATA, d)):
            return d
    sys.exit(f"teose {work_id} kausta ei leitud")


def main():
    doks = json.load(open(os.path.join(SISEND, "holdout.json"), encoding="utf-8"))
    puudu = [k["fail"] for d in doks for k in d["karbed"] if not os.path.exists(os.path.join(SISEND, "images", k["fail"]))]
    print(f"dokumente {len(doks)}, kärbet {sum(len(d['karbed']) for d in doks)}, pilte puudu {len(puudu)}")
    for d in doks:
        print(f"  {d['pealkiri']}: {len(d['karbed'])} lk ({', '.join(d['ais'])})")
    if puudu:
        sys.exit(f"puuduvad pildid: {puudu[:5]}")
    if "--kirjuta" not in sys.argv:
        print("\nKuivkäivitus. Kirjutamiseks: --kirjuta")
        return
    kasutaja = input("Kasutajanimi: ").strip()
    kood, v = paring("POST", "/login", {"username": kasutaja, "password": getpass.getpass("Parool: ")})
    token = v.get("token")
    if kood != 200 or not token:
        sys.exit(f"Sisselogimine ebaõnnestus: {kood} {v.get('message')}")
    o = lae_olek()

    # 1. piiratud kogu
    if not o.get("kogu"):
        kood, v = paring("GET", "/collections", token=token)
        if KOGU not in json.dumps(v):
            kindel(*paring("POST", "/admin/collections", {"id": KOGU, "name_et": KOGU_NIMI[0], "name_en": KOGU_NIMI[1]},
                           token=token), "kogu loomine")
        kindel(*paring("PUT", f"/admin/collections/{KOGU}", {"visibility": "restricted"}, token=token), "kogu nähtavus")
        o["kogu"] = KOGU; salvesta_olek(o); print(f"kogu {KOGU} (restricted)")

    # 2. töökollektsioon
    if not o.get("komplekt"):
        kirjeldus = {"et": "Kurrendi v7 eesti holdout (Rahvusarhiivi GT, 5 dokumenti / 39 kärbet): võrdle pildiga, "
                           "paranda, märgi Valmis.",
                     "en": "Handwriting model v7 Estonian holdout (National Archives GT, 5 documents / 39 crops): "
                           "compare with the image, correct, mark Done."}
        v = kindel(*paring("POST", "/work-sets", {"name": KOMPLEKT_NIMI, "description": kirjeldus},
                           token=token), "töökollektsioon")
        o["komplekt"] = v["work_set"]["id"]; salvesta_olek(o); print(f"töökollektsioon {o['komplekt']}")

    for d in doks:
        k = o["dok"].setdefault(d["dokument"], {})
        # 3. upload → OCR → import
        if not k.get("upload_id"):
            meta = {"title": d["pealkiri"], "type": KASIKIRI, "external_url": HF, "collections": [KOGU]}
            up = kindel(*paring("POST", "/admin/upload/create", meta, token=token), "upload create")["upload"]
            k.update(upload_id=up["id"], work_id=up["meta"]["work_id"], faas="uploading"); salvesta_olek(o)
        if k.get("faas") == "uploading":
            for nr, kb in enumerate(d["karbed"], 1):
                baidid = open(os.path.join(SISEND, "images", kb["fail"]), "rb").read()
                kindel(*paring("POST", f"/admin/upload/{k['upload_id']}/files", token=token, toores=baidid,
                               paised={"X-Filename": kb["fail"], "X-Page-Number": str(nr),
                                       "X-Total-Pages": str(len(d["karbed"]))}), f"leht {nr}")
            kindel(*paring("POST", f"/admin/upload/{k['upload_id']}/prepress/apply", token=token, timeout=600), "apply")
            k["faas"] = "ocr"; salvesta_olek(o); print(f"  {d['pealkiri']}: üles laaditud, OCR-is")
        while k.get("faas") == "ocr":
            st = kindel(*paring("GET", f"/admin/upload/{k['upload_id']}/status", token=token), "status")
            if st.get("status") == "error":
                sys.exit(f"upload {k['upload_id']} viga: {st.get('error')}")
            if st.get("status") == "done":
                kindel(*paring("POST", f"/admin/upload/{k['upload_id']}/import", token=token, timeout=900), "import")
                k["faas"] = "imported"; salvesta_olek(o); print(f"  {d['pealkiri']}: imporditud → {k['work_id']}")
                break
            print(f"  {d['pealkiri']}: {st.get('status')} …"); time.sleep(20)
        # 4. GT lehe tekstiks, seisund Töös (leht nr = kärbe nr üleslaadimise järjekorras)
        if k.get("faas") == "imported":
            lehed = kindel(*paring("GET", f"/admin/work/{k['work_id']}/pages", token=token), "lehed")["pages"]
            if len(lehed) != len(d["karbed"]):
                sys.exit(f"{d['pealkiri']}: lehti {len(lehed)}, kärbet {len(d['karbed'])}")
            kd = kaust(k["work_id"]); vastavus = {}
            for leht, kb in zip(lehed, d["karbed"]):
                fail = leht["base_name"] + ".txt"
                tee = os.path.join(DATA, kd, fail)
                tekst = open(tee, encoding="utf-8").read() if os.path.exists(tee) else ""
                meta = json.load(open(tee[:-4] + ".json", encoding="utf-8"))
                base = {"text_content": tekst, **{x: meta.get(x) for x in ("status", "page_tags", "comments", "text_annotations")}}
                m = dict(meta); m["status"] = SEISUND
                kindel(*paring("POST", "/save", {"original_path": kd, "file_name": fail,
                                                 "text_content": unicodedata.normalize("NFC", kb["gt"]),
                                                 "meta_content": m, "base": base}, token=token), f"save {fail}")
                vastavus[leht["base_name"]] = kb["fail"]
            k.update(faas="gt", vastavus=vastavus); salvesta_olek(o); print(f"  {d['pealkiri']}: GT peal ({len(lehed)} lk)")
        # 5. töökollektsiooni
        if k.get("faas") == "gt":
            ws = kindel(*paring("GET", f"/work-sets/{o['komplekt']}/works", token=token), "komplekt")
            kindel(*paring("POST", f"/work-sets/{o['komplekt']}/works", {"work_ids": [k["work_id"]],
                           "revision": ws.get("revision")}, token=token), "komplekti lisamine")
            k["faas"] = "valmis"; salvesta_olek(o); print(f"  {d['pealkiri']}: töökollektsioonis")
    print(f"\nValmis. Töökollektsioon {o['komplekt']}, kogu {KOGU}. Leht ↔ kärbe: {OLEK}")


if __name__ == "__main__":
    main()
