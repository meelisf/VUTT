"""
Täidab place_coordinates.csv koordinaadikandidaatidega välisest geokooderist.

Vaikimisi kasutab Nominatimi ja kirjutab uue CSV, mida tuleb käsitsi üle vaadata:
    python3 scripts/suggest_place_coordinates.py reference_data/place_coordinates.csv \
      --output reference_data/place_coordinates_suggested.csv

GeoNamesi kasutamiseks on vaja kasutajanime:
    python3 scripts/suggest_place_coordinates.py reference_data/place_coordinates.csv \
      --provider geonames --geonames-username USER \
      --output reference_data/place_coordinates_suggested.csv

Skript täidab ainult tühjad lat/lon väljad ning paneb resulti allika ja märkuse notes veergu.
"""
import argparse
import csv
import json
import time
import urllib.parse
import urllib.request


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

USER_AGENT = "VUTT-Historical-Archive/1.0 (https://vutt.utlib.ut.ee; vutt@utlib.ut.ee)"


def best_label(row: dict) -> str:
    return (row.get("label_en") or row.get("label_et") or row.get("key") or "").strip()


def build_query(row: dict) -> str:
    label = best_label(row)
    parent = (row.get("parent_key") or "").strip()
    if parent and parent.lower() not in label.lower():
        return f"{label}, {parent}"
    return label


def fetch_json(url: str) -> dict | list:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.loads(resp.read().decode("utf-8"))


def suggest_nominatim(row: dict) -> dict | None:
    query = build_query(row)
    if not query:
        return None
    url = "https://nominatim.openstreetmap.org/search?" + urllib.parse.urlencode({
        "q": query,
        "format": "jsonv2",
        "limit": "1",
        "accept-language": "en",
    })
    data = fetch_json(url)
    if not isinstance(data, list) or not data:
        return None
    hit = data[0]
    lat = hit.get("lat")
    lon = hit.get("lon")
    if lat is None or lon is None:
        return None
    return {
        "lat": lat,
        "lon": lon,
        "source": "nominatim",
        "geonames_id": "",
        "notes": f"nominatim: {hit.get('display_name', '')}",
    }


def suggest_geonames(row: dict, username: str) -> dict | None:
    query = build_query(row)
    if not query:
        return None
    url = "http://api.geonames.org/searchJSON?" + urllib.parse.urlencode({
        "q": query,
        "maxRows": "1",
        "style": "LONG",
        "username": username,
    })
    data = fetch_json(url)
    hits = data.get("geonames") if isinstance(data, dict) else None
    if not hits:
        return None
    hit = hits[0]
    lat = hit.get("lat")
    lon = hit.get("lng")
    if lat is None or lon is None:
        return None
    return {
        "lat": lat,
        "lon": lon,
        "source": "geonames",
        "geonames_id": str(hit.get("geonameId") or ""),
        "notes": "geonames: " + ", ".join(
            str(v) for v in [
                hit.get("toponymName") or hit.get("name"),
                hit.get("adminName1"),
                hit.get("countryName"),
            ] if v
        ),
    }


def should_process(row: dict, types: set[str] | None) -> bool:
    if row.get("lat") and row.get("lon"):
        return False
    if types is None:
        return True
    return (row.get("type") or "") in types


def main() -> int:
    parser = argparse.ArgumentParser(description="Lisa CSV-sse koordinaadikandidaadid.")
    parser.add_argument("input", help="Sisend CSV, nt reference_data/place_coordinates.csv")
    parser.add_argument("--output", required=True, help="Väljund CSV ülevaatamiseks.")
    parser.add_argument("--provider", choices=["nominatim", "geonames"], default="nominatim")
    parser.add_argument("--geonames-username", help="GeoNames username, kui --provider geonames.")
    parser.add_argument("--types", default="city,region,province", help="Komaga eraldatud tüübid; tühi string = kõik.")
    parser.add_argument("--sleep", type=float, default=1.1, help="Paus päringute vahel sekundites.")
    args = parser.parse_args()

    if args.provider == "geonames" and not args.geonames_username:
        raise SystemExit("--provider geonames nõuab --geonames-username")

    types = None if args.types == "" else {item.strip() for item in args.types.split(",") if item.strip()}

    with open(args.input, encoding="utf-8", newline="") as f:
        rows = list(csv.DictReader(f))

    updated = 0
    missing = 0
    skipped = 0
    for row in rows:
        if not should_process(row, types):
            skipped += 1
            continue

        try:
            suggestion = (
                suggest_geonames(row, args.geonames_username)
                if args.provider == "geonames"
                else suggest_nominatim(row)
            )
        except Exception as exc:
            suggestion = None
            row["notes"] = f"{args.provider} error: {exc}"

        if suggestion:
            row["lat"] = str(suggestion["lat"])
            row["lon"] = str(suggestion["lon"])
            row["source"] = suggestion["source"]
            row["geonames_id"] = suggestion["geonames_id"]
            row["notes"] = suggestion["notes"]
            updated += 1
        else:
            missing += 1

        if args.sleep > 0:
            time.sleep(args.sleep)

    with open(args.output, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Sisend: {args.input}")
    print(f"Väljund: {args.output}")
    print(f"Täidetud kandidaate: {updated}")
    print(f"Ei leitud: {missing}")
    print(f"Vahele jäetud: {skipped}")
    print("Kontrolli väljund käsitsi üle enne audit_place_coordinates.py --apply-csv kasutamist.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
