#!/usr/bin/env python3
"""VUTT tervikbackup rsync snapshot'idega.

Käivita see skript backup-sihtmasinas (nt OCR-serveris), mitte VUTT serveris.
Skript tõmbab SSH/rsync abil VUTT serverist `data/` ja `state/` kataloogid
kuupäevastatud snapshot'i. Eelmine snapshot antakse rsyncile `--link-dest`-ina,
nii et muutumata failid on hardlinkid ja iga snapshot on samas taastatav
tervikkoopia.
"""
from __future__ import annotations

import argparse
import fcntl
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


DEFAULT_SOURCE_HOST = "vutt"
DEFAULT_SOURCE_ROOT = "~/VUTT"
DEFAULT_DEST_ROOT = "~/vutt-backups"
LOCK_FILENAME = ".vutt_backup.lock"

# Tuletatud vahemälud, mida EI varundata. Need taastuvad ise ega ole andmed.
#
# `historical_regions_cache/` on lisaks LOETAMATU: backend kirjutab need Dockerist
# root'ina moodiga 0600, aga rsync jookseb `meelisf`-ina → "Permission denied" ja
# rsync exit 23 (2026-08-04 esimene backup kukkus täpselt selle taha).
#
# NB: see nimekiri on TAHTLIKULT lühike. Iga uus loetamatu fail state/-is peab
# backupi katki tegema, mitte vaikselt vahele jääma — muidu ei saa kunagi teada,
# et midagi jäi varundamata.
DEFAULT_EXCLUDES = [
    "historical_regions_cache/",
]


def _expand(path: str) -> Path:
    return Path(path).expanduser().resolve()


def _timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def log(message: str) -> None:
    print(f"[{datetime.now().isoformat(timespec='seconds')}] {message}", flush=True)


def ping(url: str | None, suffix: str = "", body: str | None = None) -> None:
    """Saadab healthchecks.io stiilis pingi; backup ei kuku pingivea tõttu läbi."""
    if not url:
        return
    ping_url = url.rstrip("/") + suffix
    data = body.encode("utf-8") if body else None
    try:
        urllib.request.urlopen(ping_url, data=data, timeout=10).read()
    except (urllib.error.URLError, TimeoutError) as exc:
        log(f"HOIATUS: healthcheck ping ebaõnnestus ({ping_url}): {exc}")


def remote_path(host: str, root: str, child: str) -> str:
    root = root.rstrip("/")
    return f"{host}:{root}/{child.rstrip('/')}/"


def latest_snapshot(snapshots_dir: Path) -> Path | None:
    if not snapshots_dir.exists():
        return None
    candidates = [p for p in snapshots_dir.iterdir() if p.is_dir() and not p.name.endswith(".partial")]
    return sorted(candidates)[-1] if candidates else None


def latest_partial(snapshots_dir: Path) -> Path | None:
    """Pooleli jäänud snapshot, mille pealt saab jätkata.

    Ebaõnnestunud jooksu `.partial` jäetakse tahtlikult alles: 40 GB uuesti
    tõmbamine mõne loetamatu faili pärast on ebaproportsionaalne. rsync võrdleb
    sihtkohas juba olemasolevaid faile ja jätab identsed vahele, seega jätkamine
    on odav.
    """
    if not snapshots_dir.exists():
        return None
    candidates = [p for p in snapshots_dir.iterdir() if p.is_dir() and p.name.endswith(".partial")]
    return sorted(candidates)[-1] if candidates else None


def run_rsync(
    *,
    source: str,
    destination: Path,
    previous_destination: Path | None,
    ssh_command: str | None,
    dry_run: bool,
    excludes: list[str] | None = None,
) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    cmd = [
        "rsync",
        "-aH",
        "--numeric-ids",
        "--delete",
        "--delete-excluded",
        "--info=stats2,progress2",
    ]
    for pattern in excludes or []:
        cmd.append(f"--exclude={pattern}")
    if dry_run:
        cmd.append("--dry-run")
    if ssh_command:
        cmd.extend(["-e", ssh_command])
    if previous_destination and previous_destination.exists():
        cmd.append(f"--link-dest={previous_destination}")
    cmd.extend([source, str(destination) + "/"])

    log("Käivitan: " + " ".join(cmd))
    subprocess.run(cmd, check=True)


def update_latest_symlink(dest_root: Path, snapshot: Path) -> None:
    latest = dest_root / "latest"
    tmp = dest_root / ".latest.tmp"
    if tmp.exists() or tmp.is_symlink():
        tmp.unlink()
    tmp.symlink_to(snapshot)
    tmp.replace(latest)


def chmod_state_private(state_dir: Path) -> None:
    if state_dir.exists():
        os.chmod(state_dir, 0o700)


def prune_old_snapshots(snapshots_dir: Path, keep_days: int, current_snapshot: Path) -> None:
    if keep_days <= 0 or not snapshots_dir.exists():
        return
    cutoff = time.time() - keep_days * 24 * 60 * 60
    for snap in snapshots_dir.iterdir():
        if not snap.is_dir() or snap == current_snapshot or snap.name.endswith(".partial"):
            continue
        if snap.stat().st_mtime < cutoff:
            log(f"Kustutan vana snapshot'i: {snap}")
            shutil.rmtree(snap)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Tõmba VUTT data/ ja state/ rsync --link-dest snapshot'ina backup-masinasse.",
    )
    parser.add_argument("--source-host", default=os.getenv("VUTT_BACKUP_SOURCE_HOST", DEFAULT_SOURCE_HOST))
    parser.add_argument("--source-root", default=os.getenv("VUTT_BACKUP_SOURCE_ROOT", DEFAULT_SOURCE_ROOT))
    parser.add_argument("--dest-root", default=os.getenv("VUTT_BACKUP_DEST_ROOT", DEFAULT_DEST_ROOT))
    parser.add_argument("--ssh-command", default=os.getenv("VUTT_BACKUP_SSH_COMMAND"))
    parser.add_argument("--healthcheck-url", default=os.getenv("VUTT_BACKUP_HEALTHCHECK_URL"))
    parser.add_argument("--keep-days", type=int, default=int(os.getenv("VUTT_BACKUP_KEEP_DAYS", "0")), help="0 = ära kustuta vanu snapshot'e")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--exclude",
        action="append",
        default=list(DEFAULT_EXCLUDES),
        # argparse append+default: antud mustrid LISANDUVAD vaikeväärtustele, ei asenda neid
        help="rsync exclude-muster; korratav, lisandub vaikeväärtustele (" + ", ".join(DEFAULT_EXCLUDES) + ")",
    )
    parser.add_argument(
        "--discard-partial",
        action="store_true",
        help="kustuta ebaõnnestunud .partial kataloog (vaikimisi jäetakse alles, et järgmine jooks saaks jätkata)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    dest_root = _expand(args.dest_root)
    snapshots_dir = dest_root / "snapshots"
    dest_root.mkdir(parents=True, exist_ok=True)
    snapshots_dir.mkdir(parents=True, exist_ok=True)

    lock_path = dest_root / LOCK_FILENAME
    with lock_path.open("w") as lock_file:
        try:
            fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            log("VIGA: teine vutt_backup.py protsess juba töötab")
            return 2

        previous = latest_snapshot(snapshots_dir)
        # Dry-run ei tohi päris pooleliolevat snapshot'i kaaperdada ega kustutada.
        resumed = None if args.dry_run else latest_partial(snapshots_dir)
        if resumed is not None:
            partial = resumed
            stamp = partial.name[: -len(".partial")]
        else:
            stamp = _timestamp()
            partial = snapshots_dir / f"{stamp}.partial"
        final = snapshots_dir / stamp

        ping(args.healthcheck_url, "/start")
        try:
            log(f"Alustan VUTT backup'i: {args.source_host}:{args.source_root} -> {final}")
            if previous:
                log(f"Eelmine snapshot (--link-dest): {previous}")
            else:
                log("Eelmist snapshot'i pole; teen täiskoopia")

            if resumed is not None:
                log(f"Jätkan pooleli jäänud snapshot'ist: {partial}")
            elif partial.exists():
                shutil.rmtree(partial)
            (partial / "data").mkdir(parents=True, exist_ok=True)
            (partial / "state").mkdir(parents=True, exist_ok=True)
            chmod_state_private(partial / "state")

            run_rsync(
                source=remote_path(args.source_host, args.source_root, "data"),
                destination=partial / "data",
                previous_destination=(previous / "data") if previous else None,
                ssh_command=args.ssh_command,
                dry_run=args.dry_run,
                excludes=args.exclude,
            )
            run_rsync(
                source=remote_path(args.source_host, args.source_root, "state"),
                destination=partial / "state",
                previous_destination=(previous / "state") if previous else None,
                ssh_command=args.ssh_command,
                dry_run=args.dry_run,
                excludes=args.exclude,
            )
            chmod_state_private(partial / "state")

            if args.dry_run:
                log(f"Dry-run valmis; eemaldan ajutise kataloogi {partial}")
                shutil.rmtree(partial)
            else:
                partial.rename(final)
                update_latest_symlink(dest_root, final)
                prune_old_snapshots(snapshots_dir, args.keep_days, final)
                log(f"Backup valmis: {final}")
            ping(args.healthcheck_url)
            return 0
        except Exception as exc:  # noqa: BLE001 - cronis tahame iga vea logida ja pingida
            log(f"VIGA: backup ebaõnnestus: {exc}")
            ping(args.healthcheck_url, "/fail", str(exc))
            if partial.exists():
                if args.discard_partial:
                    shutil.rmtree(partial, ignore_errors=True)
                else:
                    log(f"Pooleli jäänud snapshot jäetakse alles, järgmine jooks jätkab: {partial}")
            return 1


if __name__ == "__main__":
    raise SystemExit(main())
