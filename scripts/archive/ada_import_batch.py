#!/usr/bin/env python3
"""ADA säilikute hulgiimport VUTT-i — kordab /upload viisardi samme API kaudu.

Iga rida sisendfailis: `<säilik> <handle> <kogu-id>`.
Samm-sammult: lookup → create (ADA-plokk, käsikiri, kogu) → ada-fetch →
prepress (vaikeplaan = kõik `nosplit`) → apply → OCR (`hand`) → import.
Järjestikku, üks säilik korraga. Olek `progress.json`-is — korduskäivitus
jätkab poolelijäänud uploadist, juba imporditud jäetakse vahele.

Token: VUTT_TOKEN keskkonnamuutuja või fail --token-file (admini sessioon).

Trükised (`--trukis --json`): sisend on JSON-list {shelfmark, handle, collection,
overrides}; `overrides` kirjutab ADA metaandmete üle. ADA `dc.description.uri`
ESTERi number on vanemates TÜR-i trükistes VANA Tartu kataloogi number
(tartu.ester.ee, sama mis ESTERi 035 „(Tartu)") ja avab praeguses ESTERis vale
kirje või mitte midagi — anna kontrollitud number (ESTERi 907, ilma
kontrollmärgita) `overrides.ester_id`-s. Näide: ada_paber_trukised/items.json
(paber.ut.ee vesimärgiga eksemplarid, mida VUTT-is polnud; ESTER Z39.50 kirje
856 viitab samale ADA handle'ile).
"""
import argparse
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8002"
TYPE_HAND = {"id": "Q87167", "label": "käsikiri", "source": "wikidata",
             "labels": {"et": "käsikiri", "en": "manuscript"}}
TYPE_PRINT = {"id": "Q1261026", "label": "trükis", "source": "wikidata",
              "labels": {"et": "trükis", "en": "printed matter"}}

# Profiil = tüüp + OCR-mudel + kas pealkiri on koostatud. Vaikimisi käsikiri (algne kasutus).
KASIKIRI = {"type": TYPE_HAND, "ocr_model": "hand", "title_devised": True}
TRUKIS = {"type": TYPE_PRINT, "ocr_model": "print", "title_devised": False}
# Ingliskeelne pealkirjatõlge (Gemini) on mõeldud koostatud pealkirjale (käsikiri);
# trükise pealkiri on allika oma ja tõlget ei lisata.
KASIKIRI["translate_title"] = True
TRUKIS["translate_title"] = False


def log(*a):
    print(time.strftime("%Y-%m-%d %H:%M:%S"), *a, flush=True)


class Api:
    def __init__(self, token):
        self.token = token

    def call(self, method, path, body=None, timeout=600):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(BASE + path, data=data, method=method)
        req.add_header("Authorization", "Bearer " + self.token)
        if data is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.status, json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            try:
                return e.code, json.loads(e.read() or b"{}")
            except ValueError:
                return e.code, {}


def slugify(s):
    # Sama kuju nagu frontendi sanitizeSlug: server saniteerib niikuinii üle
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s[:80].rstrip("-")


def wait_status(api, uid, ok, bad=("error", "ada_error"), interval=20, label=""):
    viimane = None
    while True:
        code, st = api.call("GET", f"/admin/upload/{uid}/status")
        if code == 401:
            raise SystemExit("Token aegus (401) — uuenda token ja käivita uuesti")
        s = st.get("status")
        if s != viimane or label == "ocr":
            if s != viimane:
                log(f"  {uid}: {s} {st.get('ready', '')}/{st.get('total', '')}")
            viimane = s
        if s in ok:
            return st
        if s in bad:
            raise RuntimeError(f"{uid} staatus {s}: {st.get('ada_error') or st.get('error') or ''}")
        time.sleep(interval)


def run_one(api, sm, handle, coll, prog, profile=KASIKIRI, overrides=None):
    """`overrides` kirjutab ADA metaandmete peale (nt kontrollitud ESTERi number,
    täpne kohaviit, rollidega isikud) — ADA kirje annab konvoluudi tasemel kohaviida
    ja kõigile isikutele rolli `auctor`."""
    rec = prog.setdefault(handle, {"shelfmark": sm})
    if rec.get("stage") == "imported":
        log(f"{sm} juba imporditud → {rec['work_id']}")
        return
    uid = rec.get("upload_id")

    if not uid:
        log(f"{sm} {handle}: lookup")
        code, r = api.call("POST", "/admin/ada/lookup", {"handle": handle})
        if code != 200:
            raise RuntimeError(f"lookup {code}: {r}")
        ada = r["ada"]
        if ada.get("olemasolev"):
            raise RuntimeError(f"juba VUTT-is: {ada['olemasolev']}")
        meta = ada["meta"]
        title = (meta.get("title") or "").strip()
        year = str(meta.get("year") or "").strip()
        payload = {
            "title": title,
            "year": year,
            "slug": slugify((year + "-" if year else "") + title),
            "collections": [coll],
            "work_sets": [],
            "replace_work_id": None,
            "type": profile["type"],
            "title_devised": profile["title_devised"],
            "ada": {
                "handle": ada["handle"],
                "item_uuid": ada["item_uuid"],
                "sources": [{"name": f["name"], "bitstream_uuid": f["bitstream_uuid"],
                             "size_bytes": f["size_bytes"]} for f in ada["failid"]],
            },
            "languages": meta.get("languages"),
            "creators": meta.get("creators"),
            "year_display": meta.get("year_display"),
            "ester_id": meta.get("ester_id"),
            "archive_refs": meta.get("archive_refs"),
            "external_url": meta.get("external_url"),
        }
        for k, v in (overrides or {}).items():
            payload[k] = v
        if overrides and "title" in overrides:
            payload["slug"] = slugify((year + "-" if year else "") + overrides["title"])
            title = overrides["title"]
        if profile.get("translate_title") and ada.get("title_en_suggestion"):
            payload["title_en"] = ada["title_en_suggestion"]
        code, r = api.call("POST", "/admin/upload/create", payload)
        if code != 200:
            raise RuntimeError(f"create {code}: {r}")
        uid = r["upload"]["id"]
        rec.update(upload_id=uid, work_id=r["upload"].get("work_id"),
                   title=title, stage="created")
        save(prog)
        log(f"  loodud upload {uid} work_id={rec['work_id']} ({title[:60]} / {year})")

    code, st = api.call("GET", f"/admin/upload/{uid}/status")
    s = st.get("status")

    if s in ("pending", "ada_error"):
        code, r = api.call("POST", f"/admin/upload/{uid}/ada-fetch")
        if code not in (200, 409):
            raise RuntimeError(f"ada-fetch {code}: {r}")
        s = "ada_fetching"
    if s == "ada_fetching":
        wait_status(api, uid, ok=("awaiting_split",), interval=10)
        s = "awaiting_split"

    if s in ("awaiting_split", "prepping"):
        # Vaikeplaan tekib eelvaate käivitusel; apply katkestab eelvaate ise
        api.call("POST", f"/admin/upload/{uid}/prepress/start")
        for _ in range(60):
            code, pp = api.call("GET", f"/admin/upload/{uid}/prepress")
            if pp.get("page_count"):
                break
            time.sleep(5)
        modes = {p.get("mode") for p in pp.get("pages", [])}
        if pp.get("ocr_model") != profile["ocr_model"]:
            api.call("POST", f"/admin/upload/{uid}/ocr-model", {"model": profile["ocr_model"]})
        log(f"  plaan: {pp.get('page_count')} lk, režiimid {modes}, väljund {pp.get('output_page_count')}")
        code, r = api.call("POST", f"/admin/upload/{uid}/prepress/apply")
        if code not in (200, 409):
            raise RuntimeError(f"apply {code}: {r}")
        rec["stage"] = "applied"
        rec["pages"] = pp.get("output_page_count")
        save(prog)

    st = wait_status(api, uid, ok=("done", "importing", "imported"), interval=60)
    if st.get("status") != "imported":
        if st.get("status") == "done":
            log(f"  OCR valmis, import")
            code, r = api.call("POST", f"/admin/upload/{uid}/import", timeout=3600)
            if code != 200:
                raise RuntimeError(f"import {code}: {r}")
            rec["import"] = {k: r.get(k) for k in ("work_id", "pages", "page_count", "errors") if k in r}
            rec["work_id"] = r.get("work_id") or rec.get("work_id")
        else:
            wait_status(api, uid, ok=("imported",), interval=30)
    rec["stage"] = "imported"
    save(prog)
    log(f"{sm} IMPORDITUD → {rec.get('work_id')}")


PROG_PATH = None


def save(prog):
    tmp = PROG_PATH + ".tmp"
    with open(tmp, "w") as f:
        json.dump(prog, f, ensure_ascii=False, indent=1)
    os.replace(tmp, PROG_PATH)


def main():
    global PROG_PATH
    ap = argparse.ArgumentParser()
    ap.add_argument("items", help="read `<säilik> <handle> <kogu-id>` või --json korral JSON-list")
    ap.add_argument("--json", action="store_true",
                    help="items on JSON-list: {shelfmark, handle, collection, overrides}")
    ap.add_argument("--trukis", action="store_true", help="trükise profiil (tüüp + OCR-mudel print)")
    ap.add_argument("--progress", default="progress.json")
    ap.add_argument("--token-file")
    ap.add_argument("--only", help="ainult see säilik (nt F_7,s.23)")
    a = ap.parse_args()
    token = os.environ.get("VUTT_TOKEN") or open(a.token_file).read().strip()
    api = Api(token)
    PROG_PATH = a.progress
    prog = json.load(open(PROG_PATH)) if os.path.exists(PROG_PATH) else {}
    profile = TRUKIS if a.trukis else KASIKIRI
    if a.json:
        read = [(r["shelfmark"], r["handle"], r["collection"], r.get("overrides"))
                for r in json.load(open(a.items))]
    else:
        read = [tuple(line.split()[:3]) + (None,) for line in open(a.items) if line.strip()]
    vead = []
    for sm, handle, coll, overrides in read:
        if a.only and sm != a.only:
            continue
        try:
            run_one(api, sm, handle, coll, prog, profile, overrides)
        except SystemExit:
            raise
        except Exception as e:
            log(f"VIGA {sm} {handle}: {e}")
            prog.setdefault(handle, {})["error"] = str(e)
            save(prog)
            vead.append(sm)
    log(f"LÕPP. Vigu: {len(vead)} {vead}")


if __name__ == "__main__":
    main()
