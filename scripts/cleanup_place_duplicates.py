"""
Puhastab places.json duplikaadid (sama Q-kood, eri nimekuju).
Kanooniline võti = ajalooline nimi; duplikaadid eemaldatakse.
Isikukaardid mis kasutavad duplikaadi võtit → uuendatakse kanonoolisele.

Käivita: python3 scripts/cleanup_place_duplicates.py [--dry-run]
"""
import glob, json, os, sys, types
from datetime import datetime, timezone

# Teed tulevad server/config.py-st (#221). PROSOPO_DIR osutas varem state/-i,
# kus kaardid on külmunud 2026-05-25 seisus — puhastus oleks parandanud
# kohanimesid kaartidel, mida keegi ei loe.
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if "server" not in sys.modules:
    _server_pkg = types.ModuleType("server")
    _server_pkg.__path__ = [os.path.join(_PROJECT_ROOT, "server")]
    _server_pkg.__package__ = "server"
    sys.modules.setdefault("server", _server_pkg)
sys.path.insert(0, _PROJECT_ROOT)

from server.config import PLACES_FILE, PROSOPOGRAPHY_DIR as PROSOPO_DIR

# (kanooniline võti, duplikaadi võti)
DUPLICATES = [
    ("Reval",      "Tallinn"),
    ("Riga",       "Riia"),
    ("Finnland",   "Soome"),
    ("Åbo",        "Turu"),
    ("Wiborg",     "Viiburi"),
    ("Goldingen",  "Kuldīga"),
    ("Norrvidinge", "Norrvidinge hundred"),
    ("Tērvete",    "Tērvete piirkond"),
]

# dup_võti → kanoon_võti
DUP_TO_CANON = {dup: canon for canon, dup in DUPLICATES}


def merge_labels(canon_entry: dict, dup_entry: dict) -> dict:
    """Ühendab duplikaadi labelid kanoonilistesse (ei kirjuta üle)."""
    merged = dict(canon_entry.get("labels") or {})
    for lang, label in (dup_entry.get("labels") or {}).items():
        if lang not in merged:
            merged[lang] = label
    return merged


def merge_historical_names(canon_entry: dict, dup_entry: dict) -> list:
    """Ühendab historical_names listid."""
    names = set(canon_entry.get("historical_names") or [])
    names.update(dup_entry.get("historical_names") or [])
    # Lisa duplikaadi võti kui historical_name
    return sorted(names) if names else None


def main():
    dry_run = "--dry-run" in sys.argv
    if dry_run:
        print("DRY-RUN — faile ei kirjutata\n")

    places = json.load(open(PLACES_FILE))

    # 1. Uuenda kanoonilistele puuduvad labelid + historical_names
    print("Kanoonilistele lisatakse duplikaatide labelid:")
    for canon, dup in DUPLICATES:
        if dup not in places:
            print(f"  {dup!r} puudub places.json-ist, vahele jäetud")
            continue
        canon_entry = places[canon]
        dup_entry = places[dup]

        new_labels = merge_labels(canon_entry, dup_entry)
        new_hist = merge_historical_names(canon_entry, dup_entry)

        # Lisa duplikaadi võti historical_names-i
        hist_set = set(new_hist or [])
        hist_set.add(dup)
        new_hist = sorted(hist_set)

        print(f"  {canon!r} ← {dup!r}: labels={new_labels}, hist_names={new_hist}")
        if not dry_run:
            places[canon]["labels"] = new_labels
            places[canon]["historical_names"] = new_hist
            del places[dup]

    if not dry_run:
        tmp = PLACES_FILE + ".tmp"
        with open(tmp, "w") as f:
            json.dump(places, f, ensure_ascii=False, indent=2)
        os.replace(tmp, PLACES_FILE)
        print(f"\nplaces.json uuendatud ({len(places)} kohta)\n")

    # 2. Uuenda isikukaardid
    updated = 0
    for fpath in sorted(glob.glob(os.path.join(PROSOPO_DIR, "*.json"))):
        try:
            person = json.load(open(fpath))
        except Exception as e:
            print(f"VIGA lugemisel {fpath}: {e}")
            continue
        if person.get("record_status") == "tombstone":
            continue

        origin = person.get("origin") or {}
        place = origin.get("place")
        if place and place in DUP_TO_CANON:
            canon = DUP_TO_CANON[place]
            pid = person.get("id", os.path.basename(fpath))
            print(f"  {pid}: place={place!r} → {canon!r}")
            updated += 1
            if not dry_run:
                # Uuenda place võti ja place_labels kanoonilistest
                canon_entry = places[canon]
                person["origin"]["place"] = canon
                person["origin"]["place_labels"] = canon_entry.get("labels")
                person["updated_at"] = datetime.now(timezone.utc).isoformat()
                tmp = fpath + ".tmp"
                with open(tmp, "w") as f:
                    json.dump(person, f, ensure_ascii=False, indent=2)
                os.replace(tmp, fpath)

    print(f"\nIsikukaarte uuendatud: {updated}")
    if not dry_run and updated > 0:
        print("\nKäivita rebuild_indices:")
        print("  POST /prosopography/admin/rebuild-indices")


if __name__ == "__main__":
    main()
