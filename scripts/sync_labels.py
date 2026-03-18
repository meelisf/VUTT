#!/usr/bin/env python3
"""
Kanooniilise Q-koodi labelite registri sünkroonimine.

Skannib kõik _metadata.json failid, kogub Q-koodid žanri/tüübi/märksõnade
väljadelt ja pärib Wikidatast kanoniseeritud labelid.

Olemasolevad 'manual: true' kirjed jäetakse muutmata.

Kasutus:
    python3 scripts/sync_labels.py           # fetch + salvesta
    python3 scripts/sync_labels.py --dry-run # näita muutusi ilma salvestamata
"""
import json
import os
import sys
import urllib.request
import urllib.parse

# Projekti juurkaust
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)

DATA_DIR = os.path.join(PROJECT_ROOT, "data")
LABELS_FILE = os.path.join(PROJECT_ROOT, "state", "labels.json")

WIKIDATA_API = "https://www.wikidata.org/w/api.php"
WIKIDATA_LANGS = ["et", "en", "la", "de"]
WIKIDATA_BATCH_SIZE = 50  # max ids per request


def load_labels():
    """Laeb olemasoleva labels.json (kui olemas)."""
    if os.path.exists(LABELS_FILE):
        try:
            with open(LABELS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Hoiatus: labels.json lugemine ebaõnnestus: {e}")
    return {}


def save_labels(data):
    """Salvestab labels.json atomically."""
    tmp_path = LABELS_FILE + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, LABELS_FILE)
    print(f"Salvestatud: {LABELS_FILE}")


def extract_qcodes_from_value(value):
    """Kogub Q-koodid ühest metaandmete väljast (objekt, massiiv või string)."""
    qcodes = set()
    if not value:
        return qcodes
    items = value if isinstance(value, list) else [value]
    for item in items:
        if isinstance(item, dict):
            qid = item.get("id", "")
            if qid and qid.startswith("Q"):
                qcodes.add(qid)
    return qcodes


def collect_all_qcodes():
    """Skannib kõik _metadata.json failid ja kogub žanri/tüübi/märksõnade Q-koodid."""
    all_qcodes = set()
    count = 0

    if not os.path.isdir(DATA_DIR):
        print(f"Viga: andmekaust {DATA_DIR} ei leitud.")
        sys.exit(1)

    for entry in os.scandir(DATA_DIR):
        if not entry.is_dir():
            continue
        meta_path = os.path.join(entry.path, "_metadata.json")
        if not os.path.exists(meta_path):
            continue
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
        except Exception as e:
            print(f"Hoiatus: {meta_path} lugemine ebaõnnestus: {e}")
            continue

        count += 1
        all_qcodes |= extract_qcodes_from_value(meta.get("genre"))
        all_qcodes |= extract_qcodes_from_value(meta.get("type"))
        all_qcodes |= extract_qcodes_from_value(meta.get("tags", []))

    print(f"Skaneeritud {count} teost, leitud {len(all_qcodes)} unikaalset Q-koodi.")
    return all_qcodes


def fetch_wikidata_labels(qcodes):
    """Pärib Wikidatast labelid antud Q-koodidele.

    Returns:
        dict: {qcode: {lang: label, ...}, ...}
    """
    results = {}
    qcodes_list = sorted(qcodes)

    for i in range(0, len(qcodes_list), WIKIDATA_BATCH_SIZE):
        batch = qcodes_list[i:i + WIKIDATA_BATCH_SIZE]
        params = urllib.parse.urlencode({
            "action": "wbgetentities",
            "ids": "|".join(batch),
            "props": "labels",
            "languages": "|".join(WIKIDATA_LANGS),
            "format": "json",
        })
        url = f"{WIKIDATA_API}?{params}"

        try:
            req = urllib.request.Request(url, headers={"User-Agent": "VUTT-sync/1.0"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            print(f"Viga Wikidata päringul (batch {i//WIKIDATA_BATCH_SIZE + 1}): {e}")
            continue

        entities = data.get("entities", {})
        for qid, entity in entities.items():
            if entity.get("missing"):
                continue
            labels_raw = entity.get("labels", {})
            entry = {}
            for lang in WIKIDATA_LANGS:
                if lang in labels_raw:
                    entry[lang] = labels_raw[lang]["value"]
            if entry:
                results[qid] = entry
                print(f"  {qid}: {entry}")

    return results


def main():
    dry_run = "--dry-run" in sys.argv

    print("=== VUTT Labels sync ===")
    if dry_run:
        print("(--dry-run: muutusi ei salvestata)\n")

    # 1. Kogu Q-koodid
    all_qcodes = collect_all_qcodes()

    # 2. Lae olemasolev register
    existing = load_labels()
    print(f"Olemasolevaid kirjeid labels.json-is: {len(existing)}")

    # 3. Määra mis tuleb Wikidatast pärida (v.a. manual: true kirjed)
    manual_qcodes = {qid for qid, v in existing.items() if v.get("manual")}
    to_fetch = all_qcodes - manual_qcodes
    print(f"Käsitsi seatud (ei uuenda): {sorted(manual_qcodes)}")
    print(f"Päritakse Wikidatast: {len(to_fetch)} Q-koodi\n")

    if not to_fetch:
        print("Pole midagi pärida.")
        if not dry_run:
            save_labels(existing)
        return

    # 4. Päri Wikidatast
    fetched = fetch_wikidata_labels(to_fetch)
    print(f"\nSaadi Wikidatast {len(fetched)} kirjet.")

    # 5. Koosta uus register (manual kirjed säilivad)
    updated = dict(existing)  # koopia
    changed = 0
    for qid, labels in fetched.items():
        old = updated.get(qid, {})
        # Ära kirjuta üle manual kirjeid (topeltkontroll)
        if old.get("manual"):
            continue
        new_entry = dict(labels)  # ilma manual liputa
        if new_entry != {k: v for k, v in old.items() if k != "manual"}:
            changed += 1
            print(f"  Uuendatakse {qid}: {old} → {new_entry}")
        updated[qid] = new_entry

    print(f"\nMuutusi: {changed}")

    if dry_run:
        print("\n(--dry-run: salvestamata)")
    else:
        save_labels(updated)
        print("Valmis.")


if __name__ == "__main__":
    main()
