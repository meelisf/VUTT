#!/usr/bin/env python3
"""Märgistab teosed, mis sisaldavad olulist kreekakeelset osa (`languages += grc`).

Reegel (ADR 0019): teos saab `grc`, kui vähemalt ÜHEL leheküljel on kreeka
tähtede osakaal >= 20 % ja kreeka tähemärke >= 20. Mõõdetud 2026-08-11:
1322 teosest läbib reegli 112, praegu on märgitud 7.

Miks lehepõhine, mitte teosepõhine: teosepõhine 20 % annaks 42 teost ja jätaks
välja 70 ladinakeelset köidet, mille sees ON kreekakeelne gratulatsioon. Just
need on Helleno-Nordica põhimaterjal.

Kasutus (serveris, Dockeris):
  docker exec vutt-backend python3 scripts/detect_greek.py            # kuivkäivitus
  docker exec vutt-backend python3 scripts/detect_greek.py --apply
  docker exec vutt-backend python3 scripts/detect_greek.py --apply --commit

Pärast --apply --commit tuleb Meilisearch reindekseerida:
  ./scripts/server_seed_data.sh

Skript on idempotentne — kordusjooks ei muuda midagi ega tekita commiti.
Olemasolevaid keelemärgendeid ei eemaldata kunagi.
"""
import argparse
import json
import os
import subprocess
import sys
import types
from typing import Optional

# Fake-package muster: registreerib `server` nimeruumi ILMA `server/__init__.py`
# käivitamiseta. Muidu tõmbaks import kaasa FastAPI, gitpythoni ja kasutajate
# cache'i — serveri hosti venv-is neid ei ole ja skript kukuks `jwt` puudumise
# taha. `greek_detect` vajab ainult stdlib-i, `config` samuti.
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if "server" not in sys.modules:
    _server_pkg = types.ModuleType("server")
    _server_pkg.__path__ = [os.path.join(_PROJECT_ROOT, "server")]
    _server_pkg.__package__ = "server"
    sys.modules.setdefault("server", _server_pkg)
sys.path.insert(0, _PROJECT_ROOT)

from server.greek_detect import add_language, letter_counts, work_qualifies  # noqa: E402

LANGUAGE_CODE = "grc"


def _data_root() -> str:
    """Teoste juurkaust. server.config on ainuõige allikas."""
    from server.config import BASE_DIR
    return BASE_DIR


def _read_pages(work_dir: str) -> dict:
    """Loeb teose leheküljetekstid {failinimi: tekst}.

    Alakriipsuga algavad failid (nt _metadata.json, _notes.txt) EI ole
    leheküljetekstid ja jäetakse välja.
    """
    pages = {}
    for name in sorted(os.listdir(work_dir)):
        if not name.endswith(".txt") or name.startswith("_"):
            continue
        try:
            with open(os.path.join(work_dir, name), encoding="utf-8", errors="ignore") as f:
                pages[name] = f.read()
        except OSError as e:
            print(f"  HOIATUS: {name} lugemine ebaõnnestus: {e}", file=sys.stderr)
    return pages


def scan_work(work_dir: str) -> Optional[dict]:
    """Skaneerib ühe teose kausta. Tagastab None, kui metaandmeid ei ole/on katki."""
    meta_path = os.path.join(work_dir, "_metadata.json")
    if not os.path.exists(meta_path):
        return None
    try:
        with open(meta_path, encoding="utf-8") as f:
            meta = json.load(f)
    except (OSError, ValueError) as e:
        print(f"  HOIATUS: {work_dir} metaandmed katki: {e}", file=sys.stderr)
        return None

    pages = _read_pages(work_dir)
    qualifies, greek_pages = work_qualifies(pages)

    # Teose koguosakaal läheb AINULT aruandesse — otsust see ei mõjuta.
    # Nimetajas on KÕIGI lehtede tähed, ka nende, kus kreekat ei ole.
    greek_sum = 0
    letter_sum = 0
    for text in pages.values():
        greek, latin = letter_counts(text)
        greek_sum += greek
        letter_sum += greek + latin
    work_ratio = greek_sum / letter_sum if letter_sum else 0.0

    languages = meta.get("languages") or []
    if isinstance(languages, str):
        languages = [languages]

    return {
        "slug": os.path.basename(work_dir),
        "work_id": meta.get("work_id"),
        "title": meta.get("title"),
        "qualifies": qualifies,
        "greek_pages": greek_pages,
        "greek_page_count": len(greek_pages),
        "page_count": len(pages),
        "work_ratio": round(work_ratio, 4),
        "already_tagged": LANGUAGE_CODE in languages,
    }


def apply_work(work_dir: str) -> bool:
    """Kirjutab `grc` teose metaandmetesse. Tagastab True, kui fail muutus."""
    meta_path = os.path.join(work_dir, "_metadata.json")
    with open(meta_path, encoding="utf-8") as f:
        meta = json.load(f)

    if not add_language(meta, LANGUAGE_CODE):
        return False

    with open(meta_path, "w", encoding="utf-8") as f:
        f.write(json.dumps(meta, indent=2, ensure_ascii=False))
    return True


def _git_commit(data_root: str, paths: list) -> bool:
    """Üks commit kogu partii kohta (ADR 0015 muster). Tagastab õnnestumise.

    Laval AINULT need failid, mida see jooks muutis. `git add -A` oleks vale:
    jooksev backend uuendab `data/config/` tuletatud indekseid pidevalt ja
    need satuksid vaikselt keelemuudatuse commiti sisse — tagasipööre võtaks
    siis maha ka midagi muud.
    """
    message = f"feat(keeled): grc märgend {len(paths)} teosele (automaattuvastus)"
    for cmd in (["git", "add", "--"] + paths, ["git", "commit", "-m", message]):
        result = subprocess.run(cmd, cwd=data_root, capture_output=True, text=True)
        if result.returncode != 0:
            print(f"VIGA: {' '.join(cmd[:3])} ebaõnnestus: {result.stderr}", file=sys.stderr)
            return False
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Kirjuta muudatused (vaikimisi kuivkäivitus)")
    parser.add_argument("--commit", action="store_true", help="Tee data/ git commit pärast --apply")
    parser.add_argument("--report", default=None, help="Aruande fail (vaikimisi state/greek_detection.json)")
    args = parser.parse_args()

    data_root = _data_root()
    if not os.path.isdir(data_root):
        print(f"VIGA: teoste kausta ei leitud: {data_root}", file=sys.stderr)
        return 1

    report = []
    written_paths = []
    failed = []

    for slug in sorted(os.listdir(data_root)):
        work_dir = os.path.join(data_root, slug)
        if not os.path.isdir(work_dir) or slug.startswith(".") or slug == "config":
            continue
        row = scan_work(work_dir)
        if row is None or not row["qualifies"]:
            continue
        report.append(row)

        if args.apply and not row["already_tagged"]:
            try:
                if apply_work(work_dir):
                    written_paths.append(os.path.join(slug, "_metadata.json"))
            except (OSError, ValueError) as e:
                print(f"VIGA: {slug} kirjutamine ebaõnnestus: {e}", file=sys.stderr)
                failed.append(slug)

    # Aruanne kirjutatakse ALATI, ka osalise ebaõnnestumise korral.
    # Lehefailinimed on tasuta ja on hiljem gratulatsioon↔isik sidumise sisend.
    from server.config import STATE_DIR
    report_path = args.report or os.path.join(STATE_DIR, "greek_detection.json")
    try:
        os.makedirs(os.path.dirname(report_path), exist_ok=True)
        with open(report_path, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        print(f"Aruanne: {report_path}")
    except OSError as e:
        print(f"HOIATUS: aruande kirjutamine ebaõnnestus: {e}", file=sys.stderr)

    already = sum(1 for r in report if r["already_tagged"])
    print(f"\n{'[KUIVKÄIVITUS] ' if not args.apply else ''}Kokkuvõte:")
    print(f"  Reegli läbib:       {len(report)} teost")
    print(f"  Juba märgitud:      {already}")
    print(f"  Kirjutatud:         {len(written_paths)}")
    print(f"  Ebaõnnestus:        {len(failed)}")
    if failed:
        print("  Ebaõnnestunud teosed: " + ", ".join(failed))

    if not args.apply:
        print("\n  Kirjutamiseks: --apply")
        return 0

    if args.commit and written_paths:
        if not _git_commit(data_root, written_paths):
            return 1
        print("  Git commit loodud.")
        print("\n  JÄRGMINE SAMM: ./scripts/server_seed_data.sh (Meili reindeks)")

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
