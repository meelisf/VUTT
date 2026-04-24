"""
Rikastab places.json koordinaatidega Wikidata P625 põhjal.

Vaikimisi dry-run:
    python3 scripts/enrich_place_coordinates.py

Kirjutamiseks:
    python3 scripts/enrich_place_coordinates.py --apply

Config:
    VUTT_DATA_DIR=/path/to/data  -> /path/to/data/config/places.json
"""
import argparse
import json
import os
import re
import time
import urllib.parse
import urllib.request


REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(os.getenv("VUTT_DATA_DIR", os.path.join(REPO_ROOT, "data")), "config")
PLACES_FILE = os.path.join(DATA_DIR, "places.json")

WD_HEADERS = {
    "User-Agent": "VUTT-Historical-Archive/1.0 (https://vutt.utlib.ut.ee; vutt@utlib.ut.ee)"
}


def parse_wikidata_point(value: str) -> dict | None:
    match = re.match(r"^Point\(([-0-9.]+)\s+([-0-9.]+)\)$", (value or "").strip())
    if not match:
        return None
    lon = float(match.group(1))
    lat = float(match.group(2))
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    return {
        "lat": lat,
        "lon": lon,
        "source": "wikidata",
        "wikidata_property": "P625",
    }


def chunked(items: list[str], size: int):
    for i in range(0, len(items), size):
        yield items[i:i + size]


def fetch_coordinates_batch(qids: list[str]) -> dict[str, dict]:
    if not qids:
        return {}

    values = " ".join(f"wd:{qid}" for qid in qids)
    sparql = f"""
SELECT ?place ?coord WHERE {{
  VALUES ?place {{ {values} }}
  ?place wdt:P625 ?coord.
}}
"""
    url = "https://query.wikidata.org/sparql?" + urllib.parse.urlencode({
        "query": sparql,
        "format": "json",
    })
    req = urllib.request.Request(url, headers=WD_HEADERS)
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    result: dict[str, dict] = {}
    for binding in data.get("results", {}).get("bindings", []):
        qid = (binding.get("place") or {}).get("value", "").split("/")[-1]
        coord = parse_wikidata_point((binding.get("coord") or {}).get("value", ""))
        if qid and coord:
            result[qid] = coord
    return result


def has_coordinates(entry: dict) -> bool:
    coordinates = entry.get("coordinates")
    if not isinstance(coordinates, dict):
        return False
    return isinstance(coordinates.get("lat"), (int, float)) and isinstance(coordinates.get("lon"), (int, float))


def main() -> int:
    parser = argparse.ArgumentParser(description="Lisa places.json kirjetele Wikidata P625 koordinaadid.")
    parser.add_argument("--apply", action="store_true", help="Kirjuta muudatused places.json faili.")
    parser.add_argument("--batch-size", type=int, default=50, help="Q-koodide arv ühes SPARQL VALUES päringus.")
    parser.add_argument("--sleep", type=float, default=0.2, help="Paus partiide vahel sekundites.")
    args = parser.parse_args()

    with open(PLACES_FILE, encoding="utf-8") as f:
        places = json.load(f)

    qid_to_keys: dict[str, list[str]] = {}
    skipped_existing = 0
    skipped_no_qid = 0
    for key, entry in places.items():
        if has_coordinates(entry):
            skipped_existing += 1
            continue
        qid = entry.get("id")
        if not isinstance(qid, str) or not re.match(r"^Q\d+$", qid):
            skipped_no_qid += 1
            continue
        qid_to_keys.setdefault(qid, []).append(key)

    found: dict[str, dict] = {}
    errors: list[str] = []
    qids = sorted(qid_to_keys)
    for batch in chunked(qids, max(1, args.batch_size)):
        try:
            found.update(fetch_coordinates_batch(batch))
        except Exception as exc:
            errors.append(f"{','.join(batch)}: {exc}")
        if args.sleep > 0:
            time.sleep(args.sleep)

    updated_keys: list[str] = []
    missing_keys: list[str] = []
    for qid, keys in qid_to_keys.items():
        coord = found.get(qid)
        if not coord:
            missing_keys.extend(keys)
            continue
        for key in keys:
            places[key]["coordinates"] = coord
            updated_keys.append(key)

    print(f"Kohti kokku: {len(places)}")
    print(f"Juba koordinaatidega: {skipped_existing}")
    print(f"Q-koodita vahele jäetud: {skipped_no_qid}")
    print(f"Wikidatast lisatavad: {len(updated_keys)}")
    print(f"P625 puudub / ei leitud: {len(missing_keys)}")
    if updated_keys:
        print("Lisatavad:", ", ".join(sorted(updated_keys)))
    if missing_keys:
        print("Käsitsi ülevaatamiseks:", ", ".join(sorted(missing_keys)))
    if errors:
        print("Päringuvead:")
        for err in errors:
            print(f"  {err}")

    if args.apply and updated_keys:
        with open(PLACES_FILE, "w", encoding="utf-8") as f:
            json.dump(places, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print(f"Kirjutatud: {PLACES_FILE}")
    elif not args.apply:
        print("Dry-run. Kirjutamiseks käivita --apply.")

    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
