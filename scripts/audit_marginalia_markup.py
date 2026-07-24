#!/usr/bin/env python3
"""Raporteerib vigase marginaalia-märgenduse, kuid EI muuda ühtegi faili.

Kasutus serveris:
  docker exec vutt-backend python3 scripts/audit_marginalia_markup.py
  docker exec vutt-backend python3 scripts/audit_marginalia_markup.py --examples 30

Andmejuur tuleb ``VUTT_DATA_DIR`` muutujast (Dockeris ``/data``).
"""
import argparse
from collections import Counter, defaultdict
import os
import sys
import types


_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if "server" not in sys.modules:
    _server_pkg = types.ModuleType("server")
    _server_pkg.__path__ = [os.path.join(_PROJECT_ROOT, "server")]
    _server_pkg.__package__ = "server"
    sys.modules.setdefault("server", _server_pkg)
sys.path.insert(0, _PROJECT_ROOT)

from server.marginalia_audit import audit_marginalia


DATA_ROOT = os.getenv("VUTT_DATA_DIR", os.path.join(_PROJECT_ROOT, "data"))
KINDS = ("nested", "unbalanced", "multiline", "inline", "crossing")
LABELS = {
    "nested": "pesastatud <m>",
    "unbalanced": "tasakaalustamata <m>",
    "multiline": "mitut rida kattev <m>",
    "inline": "rea keskel olev <m>",
    "crossing": "teise tägiga ristuv <m>",
}


def find_txt_files(root: str):
    for directory, _, files in os.walk(root):
        parts = set(os.path.relpath(directory, root).split(os.sep))
        if ".git" in parts or "config" in parts:
            continue
        for filename in files:
            if filename.endswith(".txt"):
                yield os.path.join(directory, filename)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--examples", type=int, default=5,
                        help="Mitu näidet iga vealiigi kohta kuvada (vaikimisi 5)")
    parser.add_argument("--limit", type=int, default=0,
                        help="Skanni ainult N esimest .txt faili (0 = kõik)")
    parser.add_argument("--fail-on-findings", action="store_true",
                        help="Tagasta leidude korral exit code 1")
    args = parser.parse_args()

    scanned = 0
    with_marginalia = 0
    occurrences = Counter()
    affected_files: dict[str, set[str]] = defaultdict(set)
    examples: dict[str, list[tuple[str, int, str]]] = defaultdict(list)

    for path in find_txt_files(DATA_ROOT):
        if args.limit and scanned >= args.limit:
            break
        scanned += 1
        try:
            with open(path, "r", encoding="utf-8") as handle:
                text = handle.read()
        except (OSError, UnicodeError) as exc:
            print(f"LUGEMISVIGA {path}: {exc}", file=sys.stderr)
            continue
        if "<m>" not in text and "</m>" not in text:
            continue
        with_marginalia += 1
        relpath = os.path.relpath(path, DATA_ROOT)
        for finding in audit_marginalia(text):
            occurrences[finding.kind] += 1
            affected_files[finding.kind].add(relpath)
            if len(examples[finding.kind]) < args.examples:
                examples[finding.kind].append((relpath, finding.line, finding.excerpt))

    print(f"Andmejuur: {DATA_ROOT}")
    print(f"Skanniti: {scanned} .txt faili; marginaaliaga: {with_marginalia}.")
    print("\nLeiud (esinemusi / faile):")
    for kind in KINDS:
        print(f"  {LABELS[kind]}: {occurrences[kind]} / {len(affected_files[kind])}")

    if any(examples.values()):
        print("\nNäited vealiikide kaupa:")
        for kind in KINDS:
            if not examples[kind]:
                continue
            print(f"  {LABELS[kind]}:")
            for relpath, line, excerpt in examples[kind]:
                print(f"    {relpath}:{line} {excerpt}")
    else:
        print("\nStruktuurivigu ei leitud.")

    total = sum(occurrences.values())
    return 1 if args.fail_on_findings and total else 0


if __name__ == "__main__":
    raise SystemExit(main())
