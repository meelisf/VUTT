#!/usr/bin/env python3
"""EMILi (utlib.ut.ee/emil, Piwigo) sedelkataloogi alajaotused VUTT-i teosteks.

Üks EMILi alamkategooria (teema, nt „filoloogia") = üks VUTT-i teos
„Filoloogia – Manuskriptide kogu süstemaatiline sedelkataloog" (teema ees:
kaardil on kogu niikuinii kohe näha). Tüüp käsikiri (Q87167) → upload valib
ise käsikirjamudeli (`ocr_model = 'hand'`). Teema märksõnad on Wikidata
Q-koodid (`TEEMAD`); piirkond on teemast eraldi märksõna (Baltimaad).

Kõik käib tavalise upload-API kaudu (sama tee mis viisard): create →
/files lehthaaval → prepress/apply → OCR → import. Kogu (`--collection`)
pannakse teose metaandmetesse juba create'is; kogu peab olemas olema.

Kasutatud 2026-11-10: kataloog 4397 → kogu `emil-manuskriptid` (ülemkogu
`sedelkataloog-emil`), 22 teost / 1332 lehte; „ajalugu" (996o7v) imporditi
varem käsitsi. Teiste EMILi kataloogide jaoks: `--parent <id>`, oma kogu ja
oma `TEEMAD` — NB! upload'i lehtede lagi on 999 (`pg_{:03d}`), suurte
kataloogide alajaotused on sellest suuremad.

Pildid: originaal-PNG (~3000×3500, ~10 MB) on OCR-iks ja vaatamiseks
ülearune — pikem külg `--max-side` pikslini, JPEG (~330 kB/leht). JPEG ilma
EXIF-ita kopeeritakse materialiseerimisel baithaaval (ADR 0028).

Jookseb LOKAALSELT (vajab .venv-i: requests + Pillow). Token: sisselogitud
admini `vutt_token` (brauseri localStorage) — VUTT_TOKEN või `--token-file`.

Jätkatav: olek `--state` failis (kategooria → upload_id, work_id, faas).
Faasid: uploading → uploaded (OCR käib) → imported → added. Pooleli jäänud
upload saadetakse samasse upload'i uuesti (server kirjutab lehe numbri järgi üle).

    # vaata, mida tehtaks (pealkirjad + märksõnad)
    .venv/bin/python scripts/archive/emil_import.py --dry-run
    # proov ühe väikese teemaga
    .venv/bin/python scripts/archive/emil_import.py upload --only 4400 --token-file tok
    # 1. faas: laadi üles ja saada OCR-i (ei oota OCR-i lõppu)
    .venv/bin/python scripts/archive/emil_import.py upload --token-file tok
    # 2. faas: oota OCR ära, impordi (valikuliselt ka --work-set <id>)
    .venv/bin/python scripts/archive/emil_import.py finish --token-file tok
"""
import argparse
import io
import json
import os
import re
import sys
import time

import requests
from PIL import Image

EMIL_WS = "https://utlib.ut.ee/emil/ws.php"
EMIL_CAT_URL = "https://utlib.ut.ee/emil/index.php?/category/{}"
# Manuskriptide kogu süstemaatiline sedelkataloog
VAIKIMISI_ULEMKATEGOORIA = 4397
# „ajalugu" (4403) imporditi 2026-09-01 käsitsi → teos 996o7v
VAIKIMISI_VAHELE = {4403}
VUTT_API = "https://vutt.utlib.ut.ee/api/files"

KASIKIRI = {
    "id": "Q87167",
    "label": "käsikiri",
    "source": "wikidata",
    "labels": {"et": "käsikiri", "en": "manuscript"},
}

KATALOOG = "Manuskriptide kogu süstemaatiline sedelkataloog"


def _wd(q, et, en, de=None, la=None):
    labels = {"et": et, "en": en}
    if de:
        labels["de"] = de
    if la:
        labels["la"] = la
    return {"id": q, "label": et, "source": "wikidata", "labels": labels}


AJALUGU = _wd("Q309", "ajalugu", "history", "Geschichte", "historia")
# Q805727 (Baltikum, ajalooline piirkond), MITTE Q39731 (Baltimaad = kolm
# tänapäeva riiki) — sedelid on Liivi-/Eestimaa aegsed. Wikidatas et-silt
# puudub; eesti üldtermin on „Baltimaad". Teema ja piirkond on eraldi märksõnad.
BALTI = _wd("Q805727", "Baltimaad", "Baltics", "Baltikum")
OIGUS = _wd("Q4932206", "õigusteadus", "jurisprudence", "Rechtswissenschaft", "Iurisprudentia")

# EMILi kategooria-ID → (VUTT-i teema pealkirjas, märksõnad). Pealkirja teema
# on EMILi nimi suure algustähega; „X balti" → „X (Balti)" nagu EMILis endas
# „õigusteadus (Balti)".
TEEMAD = {
    4403: ("Ajalugu", [AJALUGU]),
    4406: ("Ajalugu (Balti)", [AJALUGU, BALTI]),
    4412: ("Arstiteadus", [_wd("Q11190", "meditsiin", "medicine", "Medizin", "Medicina")]),
    4418: ("Autograafid ja kirjad", [_wd("Q9026959", "autograaf", "autograph", "Autograph"),
                                     _wd("Q133492", "kiri", "letter", "Brief", "epistula")]),
    4419: ("Belletristika", [_wd("Q8253972", "ilukirjandus", "fiction", "Schöne Literatur")]),
    4405: ("Bibliograafia", [_wd("Q1631107", "bibliograafia", "bibliography", "Bibliographie", "bibliographia")]),
    4411: ("Biograafia", [_wd("Q36279", "biograafia", "biography", "Biografie", "biographia")]),
    4404: ("Dorpatensia universitas", [_wd("Q204181", "Tartu Ülikool", "University of Tartu",
                                           "Universität Tartu", "Universitas Tartuensis")]),
    4398: ("Filoloogia", [_wd("Q40634", "filoloogia", "philology", "Philologie", "philologia")]),
    4410: ("Filosoofia", [_wd("Q5891", "filosoofia", "philosophy", "Philosophie", "philosophia")]),
    4408: ("Kasvatusteadus", [_wd("Q7922", "kasvatusteadus", "pedagogy", "Pädagogik", "paedagogia")]),
    4416: ("Keeleteadus", [_wd("Q8162", "keeleteadus", "linguistics", "Sprachwissenschaft", "linguistica")]),
    4400: ("Kokaraamatud", [_wd("Q605076", "kokaraamat", "cookbook", "Kochbuch")]),
    4402: ("Loodusteadus", [_wd("Q7991", "loodusteadused", "natural science", "Naturwissenschaft",
                                "scientia naturalis")]),
    # Vana raamatukoguklassifikatsiooni „maateadus" = geograafia (Erdkunde),
    # mitte Q8008 (Earth science).
    4414: ("Maateadus", [_wd("Q1071", "geograafia", "geography", "Geographie", "geographia")]),
    4413: ("Matemaatika ja astronoomia", [_wd("Q395", "matemaatika", "mathematics", "Mathematik", "mathematica"),
                                          _wd("Q333", "astronoomia", "astronomy", "Astronomie", "astronomia")]),
    4409: ("Õigusteadus", [OIGUS]),
    4399: ("Õigusteadus (Balti)", [OIGUS, BALTI]),
    4417: ("Orientalistika", [_wd("Q476294", "orientalistika", "oriental studies", "Orientalistik")]),
    4415: ("Tööstus", [_wd("Q8148", "tööstus", "industry", "Industriesektor", "Industria")]),
    4407: ("Usuteadus", [_wd("Q34178", "teoloogia", "theology", "Theologie", "theologia")]),
    4401: ("Varia", [_wd("Q1295240", "varia", "miscellany", la="miscellanea")]),
}

# Upload'i lõppstaatused (server/upload/thumbs.py): import on lubatud neist.
IMPORDITAV = ("done",)
VIGA = ("error",)


def emil(method, **params):
    r = requests.get(EMIL_WS, params={"format": "json", "method": method, **params}, timeout=60)
    r.raise_for_status()
    d = r.json()
    if d.get("stat") != "ok":
        raise RuntimeError(f"EMIL {method}: {d}")
    return d["result"]


def alamkategooriad(ulem_id):
    """Otsesed alamkategooriad (ilma ülemkategooriata endata)."""
    cats = emil("pwg.categories.getList", cat_id=ulem_id)["categories"]
    return [c for c in cats if str(c["id"]) != str(ulem_id)]


def kategooria_pildid(cat_id):
    """Kõik kategooria pildid failinime järjekorras (EMILi vaikejärjestus on
    lisamisaja järgi kahanev — sedelite järjestus elab failinimes)."""
    pildid, leht = [], 0
    while True:
        res = emil("pwg.categories.getImages", cat_id=cat_id, per_page=500, page=leht)
        pildid.extend(res["images"])
        if len(pildid) >= int(res["paging"]["total_count"]) or not res["images"]:
            break
        leht += 1
    # Naturaalne järjestus: osa kategooriaid on `page_1 … page_10` ilma nullideta.
    pildid.sort(key=lambda p: [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", p["file"])])
    return pildid


def _lae_alla(url, katseid=6):
    """EMIL annab aeg-ajalt ajutise 5xx-i (nt 525 TLS) — proovi uuesti."""
    for katse in range(katseid):
        try:
            r = requests.get(url, timeout=300)
            if r.status_code < 500:
                r.raise_for_status()
                return r.content
            viga = f"HTTP {r.status_code}"
        except requests.ConnectionError as e:
            viga = str(e)
        oota = min(5 * 2 ** katse, 120)
        print(f"    ! {url}: {viga}, uus katse {oota} s pärast", flush=True)
        time.sleep(oota)
    raise RuntimeError(f"Allalaadimine ebaõnnestus: {url}")


def jpeg_baidid(url, max_side, quality):
    sisu = _lae_alla(url)
    with Image.open(io.BytesIO(sisu)) as im:
        im = im.convert("RGB")
        im.thumbnail((max_side, max_side), Image.LANCZOS)
        out = io.BytesIO()
        # EXIF-it ei kirjutata → materialiseerimine kopeerib baithaaval.
        im.save(out, "JPEG", quality=quality, optimize=True)
    return out.getvalue()


class Vutt:
    def __init__(self, token, base=VUTT_API):
        self.base = base
        self.s = requests.Session()
        self.s.headers["Authorization"] = f"Bearer {token}"

    def _ok(self, r):
        if r.status_code >= 400:
            raise RuntimeError(f"{r.request.method} {r.url} → {r.status_code}: {r.text[:500]}")
        return r.json()

    def post(self, path, json_body=None, **kw):
        return self._ok(self.s.post(self.base + path, json=json_body, timeout=kw.pop("timeout", 120), **kw))

    def get(self, path):
        return self._ok(self.s.get(self.base + path, timeout=300))

    def upload_page(self, upload_id, data, name, nr, kokku):
        r = self.s.post(
            f"{self.base}/admin/upload/{upload_id}/files", data=data, timeout=300,
            headers={"X-Filename": name, "X-Page-Number": str(nr), "X-Total-Pages": str(kokku),
                     "Content-Type": "application/octet-stream"},
        )
        return self._ok(r)


def lae_olek(path):
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    return {}


def salvesta_olek(path, olek):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(olek, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def teema(c):
    """(teema, märksõnad); tundmatu kategooria → EMILi nimi, märksõnadeta."""
    nimi = c["name"].strip()
    return TEEMAD.get(int(c["id"]), (nimi[:1].upper() + nimi[1:], []))


def pealkiri(c):
    # Teema ees: kaardil on kogu niikuinii kohe näha, pealkiri eristab teosed.
    return f"{teema(c)[0]} – {KATALOOG}"


def laadi_lehed(args, vutt, upload_id, pildid):
    for nr, p in enumerate(pildid, 1):
        data = jpeg_baidid(p["element_url"], args.max_side, args.quality)
        nimi = os.path.splitext(p["file"])[0] + ".jpg"
        vutt.upload_page(upload_id, data, nimi, nr, len(pildid))
        print(f"    {nr}/{len(pildid)} {nimi} {len(data)//1024} kB", flush=True)


def faas_upload(args, vutt, olek, kategooriad):
    for c in kategooriad:
        cid = str(c["id"])
        if olek.get(cid, {}).get("phase") in ("uploaded", "imported", "added"):
            print(f"  {c['name']}: juba üles laaditud, vahele")
            continue
        pildid = kategooria_pildid(c["id"])
        print(f"  {c['name']}: {len(pildid)} pilti")
        if olek.get(cid, {}).get("upload_id"):
            # Pooleli jäänud upload (`collecting_images`): server salvestab lehe
            # numbri järgi (`pg_NNN.jpg`), kordus kirjutab sama lehe üle ja
            # alles viimane leht lülitab `awaiting_split`-i → saadame kõik uuesti.
            upload_id = olek[cid]["upload_id"]
            print(f"    jätkan pooleli upload'i {upload_id}")
            laadi_lehed(args, vutt, upload_id, pildid)
            vutt.post(f"/admin/upload/{upload_id}/prepress/apply", timeout=600)
            olek[cid].update(phase="uploaded", pages=len(pildid))
            salvesta_olek(args.state, olek)
            print(f"    → upload {upload_id}, teos {olek[cid]['work_id']}, OCR-i saadetud")
            continue
        meta = {
            "title": pealkiri(c),
            "tags": teema(c)[1],
            "type": KASIKIRI,
            "external_url": EMIL_CAT_URL.format(c["id"]),
            "collections": [args.collection] if args.collection else [],
        }
        up = vutt.post("/admin/upload/create", meta)["upload"]
        upload_id, work_id = up["id"], up["meta"]["work_id"]
        olek[cid] = {"name": c["name"], "upload_id": upload_id, "work_id": work_id, "phase": "uploading"}
        salvesta_olek(args.state, olek)
        laadi_lehed(args, vutt, upload_id, pildid)
        # Kõik lehed `nosplit` (vaikeplaan) — materialiseeri ja saada OCR-i.
        vutt.post(f"/admin/upload/{upload_id}/prepress/apply", timeout=600)
        olek[cid].update(phase="uploaded", pages=len(pildid))
        salvesta_olek(args.state, olek)
        print(f"    → upload {upload_id}, teos {work_id}, OCR-i saadetud")


def faas_finish(args, vutt, olek):
    ootel = {cid: k for cid, k in olek.items() if k.get("phase") in ("uploaded", "imported")}
    while ootel:
        for cid, k in list(ootel.items()):
            if k["phase"] == "uploaded":
                st = vutt.get(f"/admin/upload/{k['upload_id']}/status")
                staatus = st.get("status")
                if staatus in VIGA:
                    print(f"  {k['name']}: VIGA {st.get('error')}")
                    del ootel[cid]
                    continue
                if staatus not in IMPORDITAV:
                    valmis = sum(1 for f in st.get("files", []) if f.get("has_ocr"))
                    print(f"  {k['name']}: {staatus} ({valmis}/{k.get('pages')})")
                    continue
                vutt.post(f"/admin/upload/{k['upload_id']}/import", timeout=900)
                k["phase"] = "imported"
                salvesta_olek(args.state, olek)
                print(f"  {k['name']}: imporditud → teos {k['work_id']}")
            if k["phase"] == "imported":
                if args.work_set:
                    ws = vutt.get(f"/work-sets/{args.work_set}/works")
                    vutt.post(f"/work-sets/{args.work_set}/works",
                              {"work_ids": [k["work_id"]], "revision": ws.get("revision")})
                    print(f"  {k['name']}: lisatud töökollektsiooni {args.work_set}")
                k["phase"] = "added"
                salvesta_olek(args.state, olek)
                del ootel[cid]
        if ootel:
            time.sleep(args.poll)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("phase", nargs="?", choices=["upload", "finish"])
    ap.add_argument("--dry-run", action="store_true", help="näita märksõnu ja pildiarvu, ära kirjuta")
    ap.add_argument("--parent", type=int, default=VAIKIMISI_ULEMKATEGOORIA)
    ap.add_argument("--skip", type=int, nargs="*", default=sorted(VAIKIMISI_VAHELE))
    ap.add_argument("--only", type=int, nargs="*", help="ainult need kategooria-ID-d (nt proovi jaoks)")
    ap.add_argument("--work-set", help="töökollektsiooni id, kuhu teosed lisada (nt ws_77c5m1)")
    ap.add_argument("--collection", default="emil-manuskriptid",
                    help="kogu id, mis pannakse teose `collections`-isse")
    ap.add_argument("--max-side", type=int, default=2000)
    ap.add_argument("--quality", type=int, default=88)
    ap.add_argument("--poll", type=int, default=60)
    ap.add_argument("--state", default="emil_import_state.json")
    ap.add_argument("--token-file", help="fail, milles on ainult token (VUTT_TOKEN-i asemel)")
    args = ap.parse_args()

    kategooriad = [c for c in alamkategooriad(args.parent)
                   if c["id"] not in set(args.skip) and (not args.only or c["id"] in set(args.only))]
    if args.dry_run or not args.phase:
        kokku = 0
        for c in kategooriad:
            print(f"{c['id']:>6} {c['nb_images']:>4}  {pealkiri(c)}  "
                  f"[{', '.join(t['id'] + ' ' + t['label'] for t in teema(c)[1])}]")
            kokku += int(c["nb_images"])
        print(f"{len(kategooriad)} teost, {kokku} lehte")
        return

    token = os.environ.get("VUTT_TOKEN")
    if args.token_file:
        with open(args.token_file, encoding="utf-8") as f:
            token = f.read().strip()
    if not token:
        sys.exit("VUTT_TOKEN puudub")
    vutt = Vutt(token)
    olek = lae_olek(args.state)
    if args.phase == "upload":
        faas_upload(args, vutt, olek, kategooriad)
    else:
        faas_finish(args, vutt, olek)


if __name__ == "__main__":
    main()
