#!/usr/bin/env python3
"""Ühekordne eelsamm: vanade töökollektsiooni access-kaartide tundmatud
kasutajanimed kustutatud nimede registrisse (ADR 0043 p8).

Uus register ei tea tagasiulatuvalt, kes varem kustutati. Ilma selle impordita
saaks uus konto vana surnud access-kirje kaudu pärida kustutatud inimese õigusi.

Jooksutatakse PEATATUD kontokirjutustega (hooldusaknas): konto loomine ja
kustutamine käivad sama registri kallal.

Kogufaile EI muudeta. Katkine kogufail KATKESTAB impordi — vaikne vahelejätmine
jätaks surnud nime registreerimata ja nime taaskasutatavaks.

Kasutus (serveris, konteinerist):
    docker exec -it vutt-backend python scripts/import_deleted_usernames.py
    docker exec -it vutt-backend python scripts/import_deleted_usernames.py --apply
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server.auth import load_users, reserve_username  # noqa: E402
from server.config import WORK_SETS_DIR  # noqa: E402


def load_all_work_sets(kaust):
    """Loeb kõik kogufailid. Katkine fail VISKAB."""
    kogud = []
    if not os.path.isdir(kaust):
        return kogud
    for nimi in sorted(os.listdir(kaust)):
        if not nimi.endswith(".json"):
            continue
        tee = os.path.join(kaust, nimi)
        try:
            with open(tee, "r", encoding="utf-8") as f:
                kogud.append(json.load(f))
        except (json.JSONDecodeError, OSError) as e:
            raise ValueError(f"Katkine kogufail {nimi}: {e}")
    return kogud


def collect_unknown_access_usernames(kogud, users):
    """Access-kaartides esinevad nimed, mida `users.json`-is EI OLE."""
    tundmatud = set()
    for ws in kogud:
        for kasutaja in (ws.get("access") or {}):
            if kasutaja not in users:
                tundmatud.add(kasutaja)
    return sorted(tundmatud)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--apply", action="store_true",
                   help="kirjuta registrisse (ilma selleta on kuivkäivitus)")
    args = p.parse_args()

    kogud = load_all_work_sets(WORK_SETS_DIR)
    users = load_users()
    tundmatud = collect_unknown_access_usernames(kogud, users)

    print(f"Kogusid: {len(kogud)}; tundmatuid access-nimesid: {len(tundmatud)}")
    for nimi in tundmatud:
        print(f"  {nimi}")

    if not args.apply:
        print("\nKuivkäivitus. Kirjutamiseks lisa --apply.")
        return 0

    for nimi in tundmatud:
        reserve_username(nimi)
    print(f"Registrisse lisatud: {len(tundmatud)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
