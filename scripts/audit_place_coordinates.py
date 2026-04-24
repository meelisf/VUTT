"""
Auditeerib ja täiendab places.json koordinaate käsitsi kontrollitud CSV kaudu.

Puuduvate koordinaatide nimekiri:
    python3 scripts/audit_place_coordinates.py

CSV mall käsitsi täitmiseks:
    python3 scripts/audit_place_coordinates.py --csv-template /tmp/place_coordinates.csv

Täidetud CSV rakendamine:
    python3 scripts/audit_place_coordinates.py --apply-csv /tmp/place_coordinates.csv

CSV veerud:
    key, id, label_et, label_en, parent_key, type, lat, lon, source, geonames_id, notes
"""
import argparse
import csv
import json
import os
import re
from collections import Counter


REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(os.getenv("VUTT_DATA_DIR", os.path.join(REPO_ROOT, "data")), "config")
PLACES_FILE = os.path.join(DATA_DIR, "places.json")

CSV_FIELDS = [
    "key",
    "id",
    "label_et",
    "label_en",
    "parent_key",
    "type",
    "lat",
    "lon",
    "source",
    "geonames_id",
    "notes",
]


def has_coordinates(entry: dict) -> bool:
    coordinates = entry.get("coordinates")
    return (
        isinstance(coordinates, dict)
        and isinstance(coordinates.get("lat"), (int, float))
        and isinstance(coordinates.get("lon"), (int, float))
    )


def label(entry: dict, lang: str) -> str:
    labels = entry.get("labels")
    if not isinstance(labels, dict):
        return ""
    return labels.get(lang) or ""


def load_places() -> dict:
    if not os.path.exists(PLACES_FILE):
        raise FileNotFoundError(
            f"places.json ei leitud: {PLACES_FILE}. "
            "Käivita repo juurest või määra VUTT_DATA_DIR=/path/to/data."
        )
    with open(PLACES_FILE, encoding="utf-8") as f:
        return json.load(f)


def write_places(places: dict) -> None:
    with open(PLACES_FILE, "w", encoding="utf-8") as f:
        json.dump(places, f, ensure_ascii=False, indent=2)
        f.write("\n")


def missing_entries(places: dict) -> list[tuple[str, dict]]:
    return sorted(
        ((key, entry) for key, entry in places.items() if not has_coordinates(entry)),
        key=lambda item: (item[1].get("type") or "", item[0].lower()),
    )


def print_missing(places: dict) -> None:
    missing = missing_entries(places)
    with_qid = sum(1 for _, entry in missing if isinstance(entry.get("id"), str) and re.match(r"^Q\d+$", entry["id"]))
    by_type = Counter(entry.get("type") or "(type puudub)" for _, entry in missing)

    print(f"places.json: {PLACES_FILE}")
    print(f"Kohti kokku: {len(places)}")
    print(f"Koordinaatideta: {len(missing)}")
    print(f"Koordinaatideta Q-koodiga: {with_qid}")
    print("Tüüpide kaupa:", ", ".join(f"{tp}={count}" for tp, count in sorted(by_type.items())))
    print()

    for key, entry in missing:
        qid = entry.get("id") or "-"
        label_et = label(entry, "et") or "-"
        label_en = label(entry, "en") or "-"
        parent = entry.get("parent_key") or "-"
        place_type = entry.get("type") or "-"
        wd_url = f"https://www.wikidata.org/wiki/{qid}" if isinstance(qid, str) and qid.startswith("Q") else "-"
        geonames_query = label(entry, "en") or label(entry, "et") or key
        geonames_url = "https://www.geonames.org/search.html?q=" + geonames_query.replace(" ", "+")
        print(f"{key}")
        print(f"  label: {label_et} / {label_en}")
        print(f"  id: {qid}; type: {place_type}; parent: {parent}")
        print(f"  Wikidata: {wd_url}")
        print(f"  GeoNames otsing: {geonames_url}")


def write_csv_template(places: dict, path: str) -> None:
    rows = []
    for key, entry in missing_entries(places):
        rows.append({
            "key": key,
            "id": entry.get("id") or "",
            "label_et": label(entry, "et"),
            "label_en": label(entry, "en"),
            "parent_key": entry.get("parent_key") or "",
            "type": entry.get("type") or "",
            "lat": "",
            "lon": "",
            "source": "",
            "geonames_id": "",
            "notes": "",
        })

    with open(path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    print(f"CSV mall kirjutatud: {path}")
    print(f"Ridu: {len(rows)}")


def parse_float(value: str, field: str, key: str) -> float:
    try:
        return float(value)
    except ValueError as exc:
        raise ValueError(f"{key}: {field} ei ole number: {value!r}") from exc


def apply_csv(places: dict, path: str) -> int:
    updated = 0
    skipped = 0
    with open(path, encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            key = (row.get("key") or "").strip()
            if not key:
                skipped += 1
                continue
            if key not in places:
                raise ValueError(f"CSV key puudub places.json-is: {key}")

            lat_raw = (row.get("lat") or "").strip()
            lon_raw = (row.get("lon") or "").strip()
            if not lat_raw and not lon_raw:
                skipped += 1
                continue
            if not lat_raw or not lon_raw:
                raise ValueError(f"{key}: lat ja lon peavad mõlemad olemas olema")

            lat = parse_float(lat_raw, "lat", key)
            lon = parse_float(lon_raw, "lon", key)
            if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                raise ValueError(f"{key}: koordinaadid on väljaspool lubatud vahemikku")

            source = (row.get("source") or "").strip() or "manual"
            coordinates = {"lat": lat, "lon": lon, "source": source}
            geonames_id = (row.get("geonames_id") or "").strip()
            if geonames_id:
                coordinates["geonames_id"] = geonames_id
            places[key]["coordinates"] = coordinates
            updated += 1

    write_places(places)
    print(f"Uuendatud kohti: {updated}")
    print(f"Vahele jäetud ridu: {skipped}")
    print(f"Kirjutatud: {PLACES_FILE}")
    return updated


def main() -> int:
    parser = argparse.ArgumentParser(description="Auditeeri ja täienda places.json koordinaate.")
    parser.add_argument("--csv-template", help="Kirjuta puuduvate koordinaatide CSV mall.")
    parser.add_argument("--apply-csv", help="Rakenda täidetud CSV places.json faili.")
    args = parser.parse_args()

    places = load_places()

    if args.csv_template:
        write_csv_template(places, args.csv_template)
        return 0
    if args.apply_csv:
        apply_csv(places, args.apply_csv)
        return 0

    print_missing(places)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
