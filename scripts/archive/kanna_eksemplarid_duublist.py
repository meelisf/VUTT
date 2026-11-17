#!/usr/bin/env python3
"""Kannab duublist eksemplarid ja märkuse üle säilitatavasse teosesse.

Taust (2026-11-17): „Asenda leheküljed" upload kaotas jätkamisel asendusrežiimi
ja „Impordi" lõi duubli — uus teos `bgxmdx` (toimetatud tekst) vs vana
`jpmek8` (Jaansoni eksemplarid, märkus „Jaanson 305"). Vana kustutatakse UI-st
alles pärast seda skripti.

Eksemplarid kopeeritakse muutmata kujul (id, `source`, `needs_review` jäävad),
välja jäävad ainult lehega seotud väljad (`pages`, `text_witness`): vana teose
lehetüvesid uues teoses ei ole. Hoidja+kohaviida järgi juba olemas olev
eksemplar jäetakse vahele (ja loetletakse). Kirjutus käib
`work_exemplars._write` kaudu (work_lock → metadata_lock, valideerimine, üks
commit); märkus `save_work_metadata` kaudu.

    docker exec vutt-backend python3 scripts/archive/kanna_eksemplarid_duublist.py jpmek8 bgxmdx
    docker exec vutt-backend python3 scripts/archive/kanna_eksemplarid_duublist.py jpmek8 bgxmdx --kirjuta
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from server import work_exemplars  # noqa: E402
from server.metadata_ops import save_work_metadata  # noqa: E402
from server.utils import find_directory_by_id  # noqa: E402

# Lehega seotud väljad — kehtivad ainult lähteteose lehtedele.
LEHE_VALJAD = ("pages", "text_witness")


def loe(work_dir):
    with open(os.path.join(work_dir, "_metadata.json"), encoding="utf-8") as f:
        return json.load(f)


def ylekantavad(vanad, olemas):
    """(kantavad, vahelejäetud). Uus id ainult kokkupõrkel."""
    ids = {x.get("id") for x in olemas}
    kantavad, vahele = [], []
    for x in vanad:
        if work_exemplars.duplicate_of(x, olemas + kantavad):
            vahele.append(x)
            continue
        uus = {k: v for k, v in x.items() if k not in LEHE_VALJAD}
        if uus["id"] in ids:
            uus["id"] = work_exemplars._new_id(ids)
        ids.add(uus["id"])
        kantavad.append(uus)
    return kantavad, vahele


def uus_markus(vana, uus):
    vana, uus = (vana or "").strip(), (uus or "").strip()
    if not vana or vana in uus:
        return None
    return f"{uus}\n\n{vana}" if uus else vana


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("allikas", help="duubli work_id (kustutatakse hiljem)")
    ap.add_argument("siht", help="säilitatava teose work_id")
    ap.add_argument("--kirjuta", action="store_true", help="kirjuta (vaikimisi kuivkäivitus)")
    ap.add_argument("--kasutaja", default="Automaatne", help="git-commiti autor")
    a = ap.parse_args()

    allikas_dir, siht_dir = find_directory_by_id(a.allikas), find_directory_by_id(a.siht)
    if not allikas_dir or not siht_dir:
        sys.exit(f"Teost ei leitud: {a.allikas if not allikas_dir else a.siht}")
    vana, uus = loe(allikas_dir), loe(siht_dir)

    kantavad, vahele = ylekantavad(list(vana.get("exemplars") or []), list(uus.get("exemplars") or []))
    markus = uus_markus(vana.get("notes"), uus.get("notes"))

    print(f"{a.allikas} → {a.siht}")
    for x in kantavad:
        print("  + ", json.dumps(x, ensure_ascii=False))
    for x in vahele:
        print("  = olemas, vahele:", x.get("holder"), x.get("shelfmark") or "")
    print("  märkus:", repr(markus) if markus else "muutmata")
    if not a.kirjuta:
        print("Kuivkäivitus — kirjutamiseks lisa --kirjuta")
        return

    if kantavad:
        work_exemplars._write(
            siht_dir, a.kasutaja,
            f"Eksemplarid duublist {a.allikas} → {a.siht} ({len(kantavad)})",
            lambda ex, unknown, stems: (ex + kantavad, unknown, None),
        )
    if markus:
        save_work_metadata(
            os.path.join(siht_dir, "_metadata.json"), {"notes": markus}, a.kasutaja,
            f"Märkus duublist {a.allikas} → {a.siht}", sync_meili=True, call_ptw=False,
        )
    print("Valmis.")


if __name__ == "__main__":
    main()
