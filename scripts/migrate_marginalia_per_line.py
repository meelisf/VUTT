#!/usr/bin/env python3
"""Migreerib ainult ohutud marginaaliad ADR 0009 rea-põhisele kujule.

Vaikimisi on skript dry-run ja ei kirjuta midagi:
  docker exec vutt-backend python3 scripts/migrate_marginalia_per_line.py
  docker exec vutt-backend python3 scripts/migrate_marginalia_per_line.py --show-diff 5

Kirjutamine on eraldi teadlik samm:
  docker exec vutt-backend python3 scripts/migrate_marginalia_per_line.py --apply
  docker exec vutt-backend python3 scripts/migrate_marginalia_per_line.py --apply --commit

Tasakaalustamata, rea-kesksed, ristuvad ning üle rea ulatuva annotatsiooniga
juhud jäetakse puutumata ja raporteeritakse.
"""
import argparse
from collections import Counter
import difflib
import os
import subprocess
import sys
import tempfile
import types


_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if "server" not in sys.modules:
    _server_pkg = types.ModuleType("server")
    _server_pkg.__path__ = [os.path.join(_PROJECT_ROOT, "server")]
    _server_pkg.__package__ = "server"
    sys.modules.setdefault("server", _server_pkg)
sys.path.insert(0, _PROJECT_ROOT)

from server.marginalia_audit import audit_marginalia
from server.marginalia_migrate import migrate_marginalia_per_line


DATA_ROOT = os.getenv("VUTT_DATA_DIR", os.path.join(_PROJECT_ROOT, "data"))


def find_txt_files(root: str):
    for directory, _, files in os.walk(root):
        parts = set(os.path.relpath(directory, root).split(os.sep))
        if ".git" in parts or "config" in parts:
            continue
        for filename in files:
            if filename.endswith(".txt"):
                yield os.path.join(directory, filename)


def atomic_write(path: str, content: str) -> None:
    directory = os.path.dirname(path)
    fd, temp_path = tempfile.mkstemp(prefix=".marginalia-", dir=directory, text=True)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, path)
    except Exception:
        try:
            os.unlink(temp_path)
        except OSError:
            pass
        raise


def finding_counts(text: str) -> Counter:
    return Counter(f.kind for f in audit_marginalia(text))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Kirjuta ohutud muudatused")
    parser.add_argument("--commit", action="store_true", help="Tee pärast --apply data git commit")
    parser.add_argument("--limit", type=int, default=0, help="Skanni ainult N esimest faili")
    parser.add_argument("--show-diff", type=int, default=0,
                        help="Kuva N esimese muudetava faili unified diff")
    args = parser.parse_args()
    if args.commit and not args.apply:
        parser.error("--commit nõuab ka --apply")

    scanned = 0
    marginalia_files = 0
    changed_paths: list[str] = []
    changed_regions = 0
    skipped = Counter()
    before_findings = Counter()
    after_findings = Counter()
    shown = 0

    for path in find_txt_files(DATA_ROOT):
        if args.limit and scanned >= args.limit:
            break
        scanned += 1
        try:
            with open(path, "r", encoding="utf-8") as handle:
                original = handle.read()
        except (OSError, UnicodeError) as exc:
            print(f"LUGEMISVIGA {path}: {exc}", file=sys.stderr)
            continue
        if "<m>" not in original and "</m>" not in original:
            continue
        marginalia_files += 1

        result = migrate_marginalia_per_line(original)
        skipped.update(result.skipped)
        before_findings.update(finding_counts(original))
        after_findings.update(finding_counts(result.text))
        if not result.changed:
            continue

        relpath = os.path.relpath(path, DATA_ROOT)
        changed_paths.append(relpath)
        changed_regions += result.regions_changed

        if shown < args.show_diff:
            print(f"\n--- DIFF: {relpath}")
            diff = difflib.unified_diff(
                original.splitlines(keepends=True),
                result.text.splitlines(keepends=True),
                fromfile=f"a/{relpath}",
                tofile=f"b/{relpath}",
                n=2,
            )
            sys.stdout.writelines(diff)
            if original and not original.endswith("\n"):
                print()
            shown += 1

        if args.apply:
            atomic_write(path, result.text)

    mode = "APPLY" if args.apply else "DRY-RUN"
    print(f"\nRežiim: {mode}")
    print(f"Andmejuur: {DATA_ROOT}")
    print(f"Skanniti {scanned} .txt faili; marginaaliaga {marginalia_files}.")
    print(f"{'Muudeti' if args.apply else 'Muudaks'} {len(changed_paths)} faili / {changed_regions} piirkonda.")
    print("\nAuditi muutus:")
    for kind in ("nested", "unbalanced", "multiline", "inline", "crossing"):
        print(f"  {kind}: {before_findings[kind]} -> {after_findings[kind]}")
    print("\nPuutumata jäetud põhjused:")
    if skipped:
        for reason, count in skipped.most_common():
            print(f"  {reason}: {count}")
    else:
        print("  puuduvad")

    if changed_paths:
        print("\nMuudetavad failid (esimesed 20):")
        for relpath in changed_paths[:20]:
            print(f"  {relpath}")
        if len(changed_paths) > 20:
            print(f"  ... ja veel {len(changed_paths) - 20}")

    if args.apply and args.commit and changed_paths:
        message = f"marginaalia: iga füüsiline rida eraldi ({len(changed_paths)} faili)"
        subprocess.run(["git", "-C", DATA_ROOT, "add", "--", *changed_paths], check=True)
        subprocess.run(["git", "-C", DATA_ROOT, "commit", "-m", message], check=True)
        print(f"\nGit commit tehtud: {message}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
