#!/usr/bin/env python3
"""Lepitab tekstisiseste annotatsioonide ankrud ja kirjed kogu korpuses (ADR 0041).

`<annN>` täg `.txt`-s ja kirje `.json`-i `text_annotations`-is on ÜKS fakt
kahes failis. Kirjutusteed, mis redaktorist läbi ei käinud, viisid nad lahku:

  - kirje ilma ankruta (re-OCR kirjutas teksti üle) → muudetakse lehe
    kommentaariks, nii et toimetaja tähelepanek ei kao;
  - ankur ilma kirjeta (git-taaste võttis teksti ja kirjed kahest kohast) →
    täg eemaldatakse tekstist, sisu jääb. Kaotusvaba: kommentaari ei ole.

Mõõdetud tootmises 2026-09-13 (enne parandust): 6 ankruta kirjet 6 lehel ja
23 kirjeta ankrut 8 lehel, kokku 250 annotatsiooni 171 leheküljel.

Kasutus (serveris, Dockeris — `data/` git commitib root'ina):
  docker exec vutt-backend python3 scripts/reconcile_annotations.py           # kuivkäivitus
  docker exec vutt-backend python3 scripts/reconcile_annotations.py --apply
  docker exec vutt-backend python3 scripts/reconcile_annotations.py --apply --commit

Pärast --apply --commit tuleb Meilisearch reindekseerida:
  ./scripts/server_seed_data.sh

Skript on idempotentne — kordusjooks ei leia enam midagi.
"""
import argparse
import json
import os
import subprocess
import sys
import types

# Fake-package muster (vt scripts/detect_greek.py): registreerib `server`
# nimeruumi ILMA `server/__init__.py` käivitamiseta, muidu tõmbaks import
# kaasa FastAPI ja gitpythoni. `annotation_ops` vajab ainult stdlib-i.
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if "server" not in sys.modules:
    _server_pkg = types.ModuleType("server")
    _server_pkg.__path__ = [os.path.join(_PROJECT_ROOT, "server")]
    _server_pkg.__package__ = "server"
    sys.modules.setdefault("server", _server_pkg)
sys.path.insert(0, _PROJECT_ROOT)

from server.annotation_ops import (  # noqa: E402
    merge_page_json,
    reconcile_page_annotations,
    split_page_json,
)


def _data_root() -> str:
    """Teoste juurkaust. server.config on ainuõige allikas."""
    from server.config import BASE_DIR
    return BASE_DIR


def scan_page(txt_path: str, json_path: str):
    """Lepitab ühe lehe. Tagastab `None` või aruande-sõnastiku.

    Ei kirjuta midagi — kirjutamine on `main`-i otsus.
    """
    try:
        with open(txt_path, encoding="utf-8") as f:
            text = f.read()
    except OSError as e:
        return {"error": "txt: {}".format(e)}
    try:
        with open(json_path, encoding="utf-8") as f:
            page_json = json.load(f)
    except (OSError, ValueError) as e:
        return {"error": "json: {}".format(e)}
    if not isinstance(page_json, dict):
        return {"error": "json ei ole objekt"}

    meta, wrapped = split_page_json(page_json)
    enne_kirjeid = len(meta.get("text_annotations") or [])
    enne_kommentaare = len(meta.get("comments") or [])

    uus_text, uus_meta, changed = reconcile_page_annotations(text, meta)
    if not changed:
        return None

    return {
        "txt_path": txt_path,
        "json_path": json_path,
        "text": uus_text,
        "text_changed": uus_text != text,
        "page_json": merge_page_json(page_json, uus_meta, wrapped),
        # Mida lepitus tegi — kuivkäivituse aruande jaoks.
        "kirjeid_kommentaariks": enne_kirjeid - len(uus_meta.get("text_annotations") or []),
        "uusi_kommentaare": len(uus_meta.get("comments") or []) - enne_kommentaare,
    }


def iter_pages(data_root: str):
    """Kõik lehepaarid (.txt + .json) korpuses.

    Alakriipsuga algavad failid (_metadata.json, _notes.txt) EI ole leheküljed.
    """
    for work in sorted(os.listdir(data_root)):
        work_dir = os.path.join(data_root, work)
        if not os.path.isdir(work_dir) or work.startswith((".", "_", "config")):
            continue
        try:
            names = sorted(os.listdir(work_dir))
        except OSError:
            continue
        for name in names:
            if not name.endswith(".txt") or name.startswith("_"):
                continue
            json_path = os.path.join(work_dir, os.path.splitext(name)[0] + ".json")
            if os.path.exists(json_path):
                yield work, os.path.join(work_dir, name), json_path


def _git_commit(data_root: str, paths: list, pages: int) -> bool:
    """Üks commit kogu partii kohta (ADR 0015 muster). Tagastab õnnestumise.

    Laval AINULT need failid, mida see jooks muutis — `git add -A` korjaks
    kaasa jooksva backendi kirjutatud tuletatud indeksid (ADR 0007).
    """
    message = (
        "fix(annotatsioonid): ankrute ja kirjete lepitus {} lehel (ADR 0041)"
    ).format(pages)
    for cmd in (["git", "add", "--"] + paths, ["git", "commit", "-m", message]):
        result = subprocess.run(cmd, cwd=data_root, capture_output=True, text=True)
        if result.returncode != 0:
            print("VIGA: {} ebaõnnestus: {}".format(" ".join(cmd[:3]), result.stderr),
                  file=sys.stderr)
            return False
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Kirjuta muudatused kettale")
    parser.add_argument("--commit", action="store_true",
                        help="Tee data/ git commit pärast --apply")
    args = parser.parse_args()

    data_root = _data_root()
    print("Andmejuur: {}".format(data_root))
    print("Režiim: {}\n".format("RAKENDAMINE" if args.apply else "kuivkäivitus"))

    lehti = 0
    leitud = []
    vead = []
    for work, txt_path, json_path in iter_pages(data_root):
        lehti += 1
        aruanne = scan_page(txt_path, json_path)
        if aruanne is None:
            continue
        if "error" in aruanne:
            vead.append((work, os.path.basename(txt_path), aruanne["error"]))
            continue
        aruanne["work"] = work
        leitud.append(aruanne)

    for a in leitud:
        osad = []
        if a["kirjeid_kommentaariks"]:
            osad.append("{} kirje → kommentaar".format(a["kirjeid_kommentaariks"]))
        if a["text_changed"]:
            osad.append("kirjeta ankur tekstist maha")
        print("  {}/{}: {}".format(
            a["work"], os.path.basename(a["txt_path"]), ", ".join(osad)))

    print("\nLehti kontrollitud: {}".format(lehti))
    print("Lepitada vaja:      {}".format(len(leitud)))
    print("Vigaseid faile:     {}".format(len(vead)))
    for work, name, err in vead:
        print("  VIGA {}/{}: {}".format(work, name, err), file=sys.stderr)

    if not leitud:
        print("\nKõik ankrud ja kirjed klapivad.")
        return 0

    if not args.apply:
        print("\nKuivkäivitus — midagi ei kirjutatud. Rakendamiseks: --apply")
        return 0

    written = []
    for a in leitud:
        try:
            if a["text_changed"]:
                with open(a["txt_path"], "w", encoding="utf-8") as f:
                    f.write(a["text"])
                written.append(os.path.relpath(a["txt_path"], data_root))
            with open(a["json_path"], "w", encoding="utf-8") as f:
                json.dump(a["page_json"], f, indent=2, ensure_ascii=False)
            written.append(os.path.relpath(a["json_path"], data_root))
        except OSError as e:
            print("VIGA kirjutamisel {}: {}".format(a["txt_path"], e), file=sys.stderr)
            return 1

    print("\nKirjutatud {} faili.".format(len(written)))
    if args.commit:
        if not _git_commit(data_root, written, len(leitud)):
            return 1
        print("Git commit tehtud.")
    else:
        print("Git commiti EI tehtud — lisa --commit.")
    print("\nÄra unusta reindeksit: ./scripts/server_seed_data.sh")
    return 0


if __name__ == "__main__":
    sys.exit(main())
