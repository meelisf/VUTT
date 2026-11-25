"""Asendusmärk: teose lehestik on asendamisel (ADR 0089 p 2).

`work_lock` on protsessi lukk ja kaob koos protsessiga. Kui asendus katkeb keset
failitööd, peab taastamine saama töötada seisu peal, mida keegi pole vahepeal
muutnud. Seepärast kirjutab asendus enne esimest failimuutust püsiva märgi
`state/work_replacing/{slug}.json` ja eemaldab selle alles pärast edukat avaldamist
või taastamise lõppu. Märgi olemasolul lükkavad `page_lock` ja `work_lock` tagasi
kõik peale märgi omaniku (`marker_owner`), vt `check_not_replacing`.
"""
import json
import os
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Optional

from .config import BASE_DIR, STATE_DIR
from .utils import atomic_write_json

MARKER_DIR = os.path.join(STATE_DIR, "work_replacing")

_owner = threading.local()


class WorkReplacingError(Exception):
    """Teose lehestik on asendamisel → 409 (main.py käsitleja)."""

    def __init__(self, slug: str):
        super().__init__(f"Teose {slug} lehestik on asendamisel")
        self.slug = slug


def _path(slug: str) -> str:
    return os.path.join(MARKER_DIR, f"{slug}.json")


def write_marker(slug: str, upload_id: str) -> None:
    os.makedirs(MARKER_DIR, exist_ok=True)
    atomic_write_json(_path(slug), {"upload_id": upload_id,
                                    "at": datetime.now(timezone.utc).isoformat()})


def read_marker(slug: str) -> Optional[dict]:
    try:
        with open(_path(slug), encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, ValueError):
        return None


def remove_marker(slug: str) -> None:
    try:
        os.remove(_path(slug))
    except FileNotFoundError:
        pass


def list_markers() -> list[tuple[str, dict]]:
    try:
        names = sorted(os.listdir(MARKER_DIR))
    except FileNotFoundError:
        return []
    out = []
    for name in names:
        if name.endswith(".json"):
            slug = name[:-5]
            m = read_marker(slug)
            if m:
                out.append((slug, m))
    return out


@contextmanager
def marker_owner(upload_id: str):
    """Selle lõime kirjutused kuuluvad asendusele `upload_id` (pääsevad märgist läbi)."""
    prev = getattr(_owner, "upload_id", None)
    _owner.upload_id = upload_id
    try:
        yield
    finally:
        _owner.upload_id = prev


def check_not_replacing(slug: str) -> None:
    if not slug or not os.path.exists(_path(slug)):
        return
    m = read_marker(slug)
    if m and m.get("upload_id") != getattr(_owner, "upload_id", None):
        raise WorkReplacingError(slug)


def slug_for_page_path(path: str) -> Optional[str]:
    """Lehe faili tee → teose slug; None, kui fail ei ole `BASE_DIR/{slug}/` otse all."""
    d = os.path.dirname(os.path.realpath(path))
    if os.path.dirname(d) != os.path.realpath(BASE_DIR):
        return None
    return os.path.basename(d)
