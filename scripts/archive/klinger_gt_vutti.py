#!/usr/bin/env python3
"""Klingeri treening-GT kontroll VUTT-i (2026-11-25): teos „Klingeriana – GT", seisund „Töös".

Taust: kurrendi v7 halvenes Klingeri holdoutil (t9zd42, +3…8 pp lehe kohta) ja vead olid usutavad,
aga valed sõnad. Treeningallikas `klinger_vutt` (138 treeninglehte) on Riegeri editsiooni klapitusest
ja VUTT-is „Valmis", aga GT-sse on jäänud Riegeri kujusid (pildi järgi kontrollitud szbnsm-005:
„July" ← pildil „Juny", „Müssen" ← „Müsten", „und" ← „u", „friedlichen" ← „freundlichen", …).

Märgendaja (LOSS `qwen3.5/scripts/klinger_gt_margi.py`) võrdles lehe praegust VUTT-i teksti mudeli
lugemiga, mis seda lehte treeningus ei näinud (szbnsm: v5 lugem; Morgenstern: VUTT-i git-i
„Originaal OCR"), ja märkis kohad, kus GT kuju tuleb positsiooniliselt Riegerist (naabersõnad +
segment Riegeri tekstis järjest) ning ümbrus klapib. 120 lehte / 1017 kohta, iga koht tekstisisese
annotatsioonina `<annN>` + `text_annotations` kirje (ADR 0041).

See skript loob ÜHE uue teose kogusse `klingeriana`: lehed = märgitud lehtede pildid (kettalt, algsest
teosest), tekst = annoteeritud GT, seisund „Töös", lehe kommentaaris viide algsele lehele.

NB! Algsed lehed jäävad „Valmis" ja treeningusse (VUTT Valmis = treeningus). Kontrolli parandused tuleb
kanda algsetele lehtedele (või ehitada klinger_vutt sellest teosest) — muidu topelt / parandus kaob.

Sisend ~/klinger_gt/klinger_margitud.json (LOSS `data/klinger_gt_kontroll/`):
  {leht: {tekst_ann, ann: [...], kohad: [...], jpg, fail, kiri}}   (jpg/fail = tee data/ suhtes)
Olek ~/klinger_gt/olek.json (jätkatav).

    python3 scripts/archive/klinger_gt_vutti.py             # kuivkäivitus
    python3 scripts/archive/klinger_gt_vutti.py --kirjuta   # admin
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
SISEND = os.path.expanduser("~/klinger_gt")
OLEK = os.path.join(SISEND, "olek.json")
KOGU = "klingeriana"
PEALKIRI = "Klingeriana – GT"
SEISUND = "Töös"
AUTOR = "Klingeri GT kontroll"
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
    return json.load(open(OLEK, encoding="utf-8")) if os.path.exists(OLEK) else {}


def salvesta_olek(o):
    tmp = OLEK + ".tmp"
    json.dump(o, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    os.replace(tmp, OLEK)


def kaust(work_id):
    for d in os.listdir(DATA):
        if d.endswith("-" + work_id) and os.path.isdir(os.path.join(DATA, d)):
            return d
    sys.exit(f"teose {work_id} kausta ei leitud")


def algne_viide(fail):
    """data/<kaust>/<tüvi>.txt → (work_id, lehe nr) algse lehe viiteks."""
    k, f = fail.split("/", 1)
    return k.rsplit("-", 1)[1], f.rsplit("-", 1)[1].split(".")[0]


def main():
    lehed = json.load(open(os.path.join(SISEND, "klinger_margitud.json"), encoding="utf-8"))
    jarjestus = sorted(lehed)                         # 671arc…, ffqg7z…, szbnsm…, t9zd42…
    puudu = [k for k in jarjestus if not os.path.exists(os.path.join(DATA, lehed[k]["jpg"]))]
    kohti = sum(len(lehed[k]["ann"]) for k in jarjestus)
    print(f"lehti {len(jarjestus)}, annotatsioone {kohti}, pilte puudu {len(puudu)}")
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

    # 1. upload → OCR → import (lehe nr = järjekord `jarjestus`-es)
    if not o.get("upload_id"):
        meta = {"title": PEALKIRI, "type": KASIKIRI, "collections": [KOGU]}
        up = kindel(*paring("POST", "/admin/upload/create", meta, token=token), "upload create")["upload"]
        o.update(upload_id=up["id"], work_id=up["meta"]["work_id"], faas="uploading", jarjestus=jarjestus)
        salvesta_olek(o)
    jarjestus = o["jarjestus"]
    if o.get("faas") == "uploading":
        for nr, leht in enumerate(jarjestus, 1):
            baidid = open(os.path.join(DATA, lehed[leht]["jpg"]), "rb").read()
            kindel(*paring("POST", f"/admin/upload/{o['upload_id']}/files", token=token, toores=baidid,
                           paised={"X-Filename": f"klinger_{leht}.jpg", "X-Page-Number": str(nr),
                                   "X-Total-Pages": str(len(jarjestus))}), f"leht {nr}")
        kindel(*paring("POST", f"/admin/upload/{o['upload_id']}/prepress/apply", token=token, timeout=600), "apply")
        o["faas"] = "ocr"; salvesta_olek(o); print("üles laaditud, OCR-is")
    while o.get("faas") == "ocr":
        st = kindel(*paring("GET", f"/admin/upload/{o['upload_id']}/status", token=token), "status")
        if st.get("status") == "error":
            sys.exit(f"upload {o['upload_id']} viga: {st.get('error')}")
        if st.get("status") == "done":
            kindel(*paring("POST", f"/admin/upload/{o['upload_id']}/import", token=token, timeout=900), "import")
            o["faas"] = "imported"; salvesta_olek(o); print(f"imporditud → {o['work_id']}")
            break
        print(f"  {st.get('status')} …"); time.sleep(20)

    # 2. annoteeritud GT lehe tekstiks, seisund Töös, kommentaaris algne leht
    if o.get("faas") == "imported":
        uued = kindel(*paring("GET", f"/admin/work/{o['work_id']}/pages", token=token), "lehed")["pages"]
        if len(uued) != len(jarjestus):
            sys.exit(f"lehti {len(uued)}, oodati {len(jarjestus)}")
        kd = kaust(o["work_id"]); vastavus = {}
        for uus, leht in zip(uued, jarjestus):
            x = lehed[leht]
            fail = uus["base_name"] + ".txt"
            tee = os.path.join(DATA, kd, fail)
            tekst = open(tee, encoding="utf-8").read() if os.path.exists(tee) else ""
            meta = json.load(open(tee[:-4] + ".json", encoding="utf-8"))
            base = {"text_content": tekst, **{k: meta.get(k) for k in ("status", "page_tags", "comments", "text_annotations")}}
            wid, lk = algne_viide(x["fail"])
            kommentaar = {
                "id": f"klgt-{leht}", "author": AUTOR, "created_at": "2026-11-25T12:00:00Z",
                "text": (f"Algne leht: /work/{wid}/{int(lk)} (Riegeri kiri {x['kiri']}). "
                         f"{len(x['ann'])} märgitud kohta; parandus kanna ka algsele lehele."),
            }
            m = dict(meta)
            m.update(status=SEISUND, text_annotations=x["ann"], comments=list(meta.get("comments") or []) + [kommentaar])
            kindel(*paring("POST", "/save", {"original_path": kd, "file_name": fail,
                                             "text_content": unicodedata.normalize("NFC", x["tekst_ann"]),
                                             "meta_content": m, "base": base}, token=token), f"save {fail}")
            vastavus[uus["base_name"]] = leht
        o.update(faas="valmis", vastavus=vastavus); salvesta_olek(o)
        print(f"GT peal ({len(uued)} lk)")
    print(f"\nValmis: teos {o['work_id']} kogus {KOGU}. Leht ↔ algne: {OLEK}")


if __name__ == "__main__":
    main()
