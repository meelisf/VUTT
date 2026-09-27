"""#462/#471: isikufaktide registrivastete kuivkäivitus ja ülevaatustabel.

Ei kirjuta isikukaarte ega registreid. Tabeli `candidate` on ettepanek, mitte
kinnitatud seos; isegi ühene vaste nõuab toimetaja kontrolli.
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
import re
import unicodedata

FIELDS = ("person_id", "section", "index", "field", "raw", "legacy_id",
          "candidate", "alternatives", "match", "decision", "notes")
GROUP_FIELDS = ("field", "raw_variants", "legacy_ids", "count", "example_person_ids",
                "candidate", "suggested_new_key", "alternatives", "match", "decision", "notes")


def _norm(value: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", value).casefold().split())


def _slug(value: str) -> str:
    folded = "".join(char for char in unicodedata.normalize("NFKD", value.casefold())
                     if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]+", "-", folded).strip("-")[:90]


def candidates(raw: str, qid: str | None, registry: dict) -> tuple[str, str, str]:
    by_id = [key for key, entry in registry.items() if qid and entry.get("id") == qid]
    by_name = [key for key, entry in registry.items()
               if _norm(raw) in {_norm(text) for text in
                                 list((entry.get("labels") or {}).values()) + (entry.get("variants") or [])
                                 if isinstance(text, str)}]
    matches = sorted(set(by_id or by_name))
    if len(matches) == 1:
        return matches[0], "", "qid" if by_id else "name"
    if matches:
        return "", " | ".join(matches), "ambiguous"
    return "", "", "unmatched"


def report_rows(persons_dir: Path, occupations: dict, institutions: dict, places: dict) -> list[dict]:
    place_ids = {entry.get("id"): key for key, entry in places.items()
                 if isinstance(entry, dict) and entry.get("id")}
    rows = []
    for path in sorted(persons_dir.glob("*.json")):
        person = json.loads(path.read_text(encoding="utf-8"))
        person_id = person.get("id") or path.stem
        for section in ("occupations", "education"):
            for index, fact in enumerate(person.get(section) or []):
                if not isinstance(fact, dict):
                    continue
                targets = [("occupation", fact.get("label") or "", fact.get("id"), occupations)] if section == "occupations" else []
                targets.append(("institution", fact.get("institution") or "", fact.get("institution_id"), institutions))
                for field, raw, qid, registry in targets:
                    if not raw and not qid:
                        continue
                    candidate, alternatives, match = candidates(raw, qid, registry)
                    institution_qid = any(isinstance(entry, dict) and entry.get("id") == qid
                                          for entry in institutions.values()) if qid else False
                    if field == "institution" and section == "occupations" and qid in place_ids and not institution_qid:
                        candidate, alternatives, match = place_ids[qid], "", "place_qid"
                        field = "place"
                    rows.append({"person_id": person_id, "section": section, "index": index,
                                 "field": field, "raw": raw, "legacy_id": qid or "",
                                 "candidate": candidate, "alternatives": alternatives,
                                 "match": match, "decision": "", "notes": ""})
    return rows


def review_groups(rows: list[dict]) -> list[dict]:
    """Sama kinnitatud kandidaat koondab lühendid; kahtlane vaste jääb lahku."""
    grouped: dict[tuple, dict] = {}
    for row in rows:
        identity = row["candidate"] or (row["legacy_id"] or _norm(row["raw"]))
        key = (row["field"], identity)
        group = grouped.setdefault(key, {
            "field": row["field"], "raw_variants": [], "legacy_ids": [], "count": 0,
            "example_person_ids": [], "candidate": row["candidate"],
            "suggested_new_key": "" if row["candidate"] or row["alternatives"] else
                (_slug(row["raw"]) or row["legacy_id"].casefold()),
            "alternatives": row["alternatives"], "match": row["match"],
            "decision": "", "notes": "",
        })
        group["count"] += 1
        if row["raw"] not in group["raw_variants"]:
            group["raw_variants"].append(row["raw"])
        if row["legacy_id"] and row["legacy_id"] not in group["legacy_ids"]:
            group["legacy_ids"].append(row["legacy_id"])
        if row["person_id"] not in group["example_person_ids"] and len(group["example_person_ids"]) < 5:
            group["example_person_ids"].append(row["person_id"])
    result = []
    for group in grouped.values():
        result.append({**group, **{name: " | ".join(group[name]) for name in
                                  ("raw_variants", "legacy_ids", "example_person_ids")}})
    return sorted(result, key=lambda group: (group["field"], -group["count"], group["raw_variants"]))


def _read(path: Path) -> dict:
    if not path.exists():
        return {}
    result = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(result, dict):
        raise ValueError(f"Register pole objekt: {path}")
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, required=True,
                        help="data/ juur koos config/prosopography ja config/*.json failidega")
    parser.add_argument("--output", type=Path, required=True, help="CSV ülevaatustabel")
    parser.add_argument("--details", type=Path, help="Valikuline iga isikufakti detailne CSV")
    args = parser.parse_args()
    config = args.data_dir / "config"
    persons = config / "prosopography"
    if not persons.is_dir():
        parser.error(f"Isikukaust puudub: {persons}")
    rows = report_rows(persons, _read(config / "occupations.json"),
                       _read(config / "institutions.json"), _read(config / "places.json"))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=GROUP_FIELDS)
        writer.writeheader()
        writer.writerows(review_groups(rows))
    if args.details:
        args.details.parent.mkdir(parents=True, exist_ok=True)
        with args.details.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=FIELDS)
            writer.writeheader()
            writer.writerows(rows)
    print(f"{len(rows)} fakti, {len(review_groups(rows))} ülevaatusrühma; "
          f"{sum(row['match'] == 'ambiguous' for row in rows)} mitmetähenduslikku fakti; "
          f"ülevaatus: {args.output}")


if __name__ == "__main__":
    main()
