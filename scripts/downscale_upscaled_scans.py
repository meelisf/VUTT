#!/usr/bin/env python3
"""Vähendab 72 ppi skannist 300 ppi-ga üles venitatud lehepildid tagasi (#666, ADR 0073).

Taust: BSB jt märgivad skanni 72 ppi-ks, `pdftoppm -r 300` venitas iga
allikapikseli ~4,17 × 4,17 pikslile (13 MB lehed). Lähte-PDF-i enam ei ole, seega
ümberrenderdus ei ole võimalik — ADR 0073 lubab ainult vähendamist **tõendatud
sihtmõõdule**.

Tõend tuleb digiteerija IIIF-manifestist (praegu ainult BSB): VUTT-i lehe mõõt ×
72/300 peab langema kokku vastava IIIF-lõuendi mõõduga. Lehti võib alguses või
lõpus olla eemaldatud (tühjad lehed), keskelt mitte — seega otsitakse ÜKS
konstantne nihe failinumbri ja lõuendi vahel. Üksikud lehed erinevad mõne %
(BSB PDF-i kaader ≠ IIIF-i kaader, kärped); need vähendatakse sama teguriga, sest
tegur on teose omadus (kogu PDF renderdati sama `-r 300`-ga).

Vähendamine ei muuda kaadrit (kärbe, poolitus, pööre jäävad), seega tekst ja
pisipildid jäävad kehtima. Pildid ei ole gitis — commit'i ei teki.

Kasutus (serveris, Dockeris — seal on PIL ja /data):
  docker exec vutt-backend python3 scripts/downscale_upscaled_scans.py lzogr0          # kuivkäivitus
  docker exec vutt-backend python3 scripts/downscale_upscaled_scans.py lzogr0 --apply
  ... 63y11m --bsb bsb10959131     # external_url ei ole BSB

Idempotentne: juba vähendatud leht (pikk serv < MIN_LONG_EDGE) jäetakse vahele.
"""
import argparse
import glob
import json
import os
import re
import statistics
import sys
import urllib.request

SCALE = 72 / 300
JPEG_QUALITY = 95          # = server/upload/page_source.py JPEG_QUALITY
MIN_LONG_EDGE = 4000       # väiksem leht ei ole venitatud (või on juba vähendatud)
PAGE_TOL = 0.10            # lehe mõõdu lubatud erinevus lõuendist nihke hindamisel
MIN_MATCH_SHARE = 0.8      # nii suur osa lehti peab parima nihkega klappima
MEDIAN_TOL = 0.03          # mõõtude suhte mediaan peab olema 1 ± see
MAX_OFFSET = 10

MANIFEST_URL = "https://api.digitale-sammlungen.de/iiif/presentation/v3/{}/manifest"
PAGE_RE = re.compile(r"-(\d{3,4})([a-z]?)\.jpg$")


def _data_root() -> str:
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from server.config import BASE_DIR
    return BASE_DIR


def find_work_dir(root: str, work_id: str) -> str:
    """Kaustanimi ei pruugi work_id-d sisaldada — autoriteet on `_metadata.json`."""
    hits = []
    for mp in glob.glob(os.path.join(root, "*", "_metadata.json")):
        try:
            with open(mp, encoding="utf-8") as f:
                meta = json.load(f)
                if work_id in (meta.get("id"), meta.get("work_id")):
                    hits.append(os.path.dirname(mp))
        except (OSError, ValueError):
            continue
    if len(hits) != 1:
        raise SystemExit(f"{work_id}: kaust ei ole üheselt leitav ({len(hits)} vastet)")
    return hits[0]


def bsb_id(external_url: str):
    m = re.search(r"bsb\d{8}", external_url or "")
    return m.group(0) if m else None


def fetch_canvases(bsb: str):
    with urllib.request.urlopen(MANIFEST_URL.format(bsb), timeout=30) as r:
        manifest = json.load(r)
    return [(c["width"], c["height"]) for c in manifest["items"]]


def jpeg_size(path: str):
    from PIL import Image
    with Image.open(path) as im:
        return im.size


def target_size(w: int, h: int):
    return round(w * SCALE), round(h * SCALE)


def ratios(page, canvases, offset):
    """(laiuse suhe, kõrguse suhe) lehe sihtmõõdu ja lõuendi vahel või None."""
    num, (w, h) = page
    i = num + offset - 1  # failinumber on 1-põhine nagu lõuend
    if not 0 <= i < len(canvases):
        return None
    tw, th = target_size(w, h)
    cw, ch = canvases[i]
    return tw / cw, th / ch


def choose_offset(pages, canvases):
    """Leiab konstantse nihke, millega kõige rohkem lehti klapib.

    `pages` = [(failinumber, (w, h))] — ainult poolitamata lehed.
    Tagastab (nihe, klappinud lehti, mediaan-kõrgussuhe).
    """
    best = None
    for off in range(-MAX_OFFSET, MAX_OFFSET + 1):
        rs = [r for r in (ratios(p, canvases, off) for p in pages) if r]
        ok = [r for r in rs if abs(r[0] - 1) <= PAGE_TOL and abs(r[1] - 1) <= PAGE_TOL]
        med = statistics.median(r[1] for r in rs) if rs else 0
        cand = (len(ok), -abs(med - 1), off, med)
        if best is None or cand > best:
            best = cand
    n_ok, _, off, med = best
    return off, n_ok, med


def downscale(path: str) -> int:
    """Vähendab pildi kohapeal; tagastab uue faili suuruse.

    Kirjutab `.part`-faili ja asendab ainult siis, kui originaal vahepeal ei
    muutunud (nt pildiredaktor) — muidu kirjutaksime kasutaja muudatuse üle.
    """
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = None
    before = os.stat(path)
    tmp = path + ".part"
    with Image.open(path) as im:
        icc = im.info.get("icc_profile")
        out = im.convert("RGB").resize(target_size(*im.size), Image.LANCZOS)
    kwargs = {"icc_profile": icc} if icc else {}
    out.save(tmp, "JPEG", quality=JPEG_QUALITY, **kwargs)
    os.chmod(tmp, before.st_mode & 0o777)
    if os.stat(path).st_mtime_ns != before.st_mtime_ns:
        os.unlink(tmp)
        raise RuntimeError("originaal muutus töö ajal")
    os.replace(tmp, path)
    return os.path.getsize(path)


def process(root: str, work_id: str, apply: bool, median_tol: float = MEDIAN_TOL,
            bsb_override: str = None) -> bool:
    wd = find_work_dir(root, work_id)
    with open(os.path.join(wd, "_metadata.json"), encoding="utf-8") as f:
        meta = json.load(f)
    bsb = bsb_id(bsb_override) or bsb_id(meta.get("external_url"))
    print(f"== {work_id} {os.path.basename(wd)[:60]}")
    if not bsb:
        print(f"   VAHELE: external_url ei ole BSB ({meta.get('external_url')!r}) — tõendit ei ole")
        return False

    files = sorted(p for p in glob.glob(os.path.join(wd, "*.jpg"))
                   if not os.path.basename(p).startswith("_"))
    pages, todo = [], []
    for p in files:
        m = PAGE_RE.search(p)
        size = jpeg_size(p)
        if max(size) >= MIN_LONG_EDGE:
            todo.append((p, size))
        if m and not m.group(2):
            pages.append((int(m.group(1)), size))

    canvases = fetch_canvases(bsb)
    off, n_ok, med = choose_offset(pages, canvases)
    share = n_ok / len(pages) if pages else 0
    print(f"   {bsb}: {len(canvases)} lõuendit, {len(files)} lehte, venitatud {len(todo)}")
    print(f"   nihe {off:+d}: klapib {n_ok}/{len(pages)} ({share:.0%}), kõrgussuhte mediaan {med:.3f}")
    if share < MIN_MATCH_SHARE or abs(med - 1) > median_tol:
        print("   VAHELE: 72 ppi allikas ei ole tõendatud")
        return False

    off_pages = [(n, s) for n, s in pages
                 if (r := ratios((n, s), canvases, off)) is None
                 or abs(r[0] - 1) > PAGE_TOL or abs(r[1] - 1) > PAGE_TOL]
    for n, s in off_pages:
        r = ratios((n, s), canvases, off)
        print(f"   erinev kaader: {n:03d} {s[0]}x{s[1]} suhe {r and tuple(round(x, 3) for x in r)}")

    before = sum(os.path.getsize(p) for p, _ in todo)
    if not apply:
        print(f"   kuivkäivitus: {len(todo)} lehte, {before / 1e9:.2f} GB → ~{before / 8 / 1e9:.2f} GB")
        return True

    if not os.access(wd, os.W_OK):
        print(f"   VAHELE: kaust ei ole kirjutatav (omanik uid {os.stat(wd).st_uid}) — "
              "käivita konteineris (`docker exec -i vutt-backend python3 - ...`)")
        return False
    after, failed = 0, []
    for i, (p, _) in enumerate(todo, 1):
        try:
            after += downscale(p)
        except Exception as e:  # üks leht ei peata ülejäänuid
            # Ainult tekst: erindi traceback hoiaks dekodeeritud ~200 MB pildi
            # elus ja iga ebaõnnestunud leht kasvataks mälu (OOM 0arsyg peal).
            failed.append((os.path.basename(p), f"{type(e).__name__}: {e}"))
        if i % 20 == 0:
            print(f"   {i}/{len(todo)}", flush=True)
    print(f"   valmis: {len(todo) - len(failed)} lehte, {before / 1e9:.2f} GB → {after / 1e9:.2f} GB")
    for name, e in failed:
        print(f"   VIGA {name}: {e}")
    return not failed


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("work_ids", nargs="+")
    ap.add_argument("--apply", action="store_true", help="kirjuta pildid (vaikimisi kuivkäivitus)")
    ap.add_argument("--data", help="teoste juurkaust (vaikimisi server.config.BASE_DIR)")
    ap.add_argument("--median-tol", type=float, default=MEDIAN_TOL,
                    help="kõrgussuhte mediaani lubatud kõrvalekalle; BSB PDF-i kaader võib "
                         "IIIF-ist kõrguses mõne %% erineda (l6xrce: 0,969)")
    ap.add_argument("--bsb", help="BSB-ID või -link, kui external_url viitab mujale "
                                  "(63y11m: K10plus); lubatud ainult ühe teosega")
    args = ap.parse_args()
    if args.bsb and (len(args.work_ids) != 1 or not bsb_id(args.bsb)):
        ap.error("--bsb vajab täpselt üht teost ja kuju bsb12345678")
    root = args.data or _data_root()
    ok = all([process(root, w, args.apply, args.median_tol, args.bsb) for w in args.work_ids])
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
