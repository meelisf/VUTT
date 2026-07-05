"""Taustatööde heartbeat-register.

Hoiab mälus daemon-thread'ide viimase õnnestumise/vea infot, et /health/background
saaks näidata, kas perioodilised tööd päriselt jooksevad.
"""
from __future__ import annotations

import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional

_lock = threading.Lock()
_jobs: Dict[str, Dict[str, Any]] = {}


def _iso(ts: Optional[float]) -> Optional[str]:
    if not ts:
        return None
    return datetime.fromtimestamp(ts, timezone.utc).isoformat()


def register_job(name: str, *, interval_seconds: Optional[int] = None, description: str = "") -> None:
    """Registreeri taustatöö; olemasolevat runtime-staatust ei nullita."""
    now = time.time()
    with _lock:
        job = _jobs.setdefault(name, {})
        job.setdefault("registered_at", now)
        job.update({
            "name": name,
            "interval_seconds": interval_seconds,
            "description": description,
        })


def mark_success(name: str, *, detail: Optional[Dict[str, Any]] = None) -> None:
    """Märgi töö pass õnnestunuks."""
    now = time.time()
    with _lock:
        job = _jobs.setdefault(name, {"name": name, "registered_at": now})
        job["last_success_at"] = now
        job["last_error_at"] = job.get("last_error_at")
        job["last_error"] = job.get("last_error")
        job["success_count"] = int(job.get("success_count") or 0) + 1
        if detail is not None:
            job["last_detail"] = detail


def mark_error(name: str, error: Exception | str, *, detail: Optional[Dict[str, Any]] = None) -> None:
    """Märgi töö pass veaga lõppenuks."""
    now = time.time()
    with _lock:
        job = _jobs.setdefault(name, {"name": name, "registered_at": now})
        job["last_error_at"] = now
        job["last_error"] = str(error)
        job["error_count"] = int(job.get("error_count") or 0) + 1
        if detail is not None:
            job["last_detail"] = detail


def snapshot() -> Dict[str, Any]:
    """Tagasta serialiseeritav hetkeseis."""
    now = time.time()
    with _lock:
        jobs = []
        for name in sorted(_jobs):
            item = dict(_jobs[name])
            item["registered_at"] = _iso(item.get("registered_at"))
            item["last_success_at"] = _iso(item.get("last_success_at"))
            item["last_error_at"] = _iso(item.get("last_error_at"))
            last_times = [
                ts for ts in (_jobs[name].get("last_success_at"), _jobs[name].get("last_error_at"))
                if ts
            ]
            last_seen = max(last_times) if last_times else None
            item["seconds_since_last_run"] = round(now - last_seen, 3) if last_seen else None
            jobs.append(item)
    return {"jobs": jobs}
