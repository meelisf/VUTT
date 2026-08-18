"""Väliste identifikaatorite pöördindeks: `scheme:id` → `vutt:P...` (#180).

Miks: `_find_by_external_id` skannis kuni ~2348 isikufaili IGA välise ID kohta.
Varakult leitud ID ~0,006 s, puuduv ID (täisskann) ~0,134 s — ja üks metaandmete
salvestus, kus on mitu uut seotud isikut, korrutab selle kulu.

Mudel: mälusisene read-model, mis EHITATAKSE LAISALT ühe kaustaskanniga ja mida
mutatsioonid hoiavad jooksvalt värskena (`update_for_person` / `remove_person`).
Kettale seda ei kirjutata — indeks on täielikult isikufailidest tuletatav, seega
restart taastab selle esimesel päringul. See hoiab ära neljanda tuletatud faili,
mida tuleks eraldi sünkroonis hoida.

Isoleerituse invariant: indeks on seotud kaustaga, mille pealt ta ehitati
(`PROSOPOGRAPHY_DIR`). Kausta vahetus (nt testide monkeypatch) ehitab ümber.
"""
from __future__ import annotations

import json
import os
import threading
from typing import Dict, Optional, Tuple

from . import state
from ._compat import sync_from_facade
from .ext_ids import normalize_ext_id
from ..config import get_logger

logger = get_logger(__name__)

_lock = threading.RLock()
_index: Optional[Dict[str, str]] = None      # "scheme:id" → "vutt:P..."
_index_dir: Optional[str] = None             # kaust, mille pealt ehitati


def _key(scheme: str, ext_id: str) -> str:
    """Võti kanoonilisel kujul (#240).

    Andmetes on sama identifikaator kahel kujul (`GND:123` ja `123`). Ilma
    normaliseerimiseta on need eri võtmed, mistõttu `_find_by_external_id` ei
    leidnud olemasolevat kaarti ja kirjutustee tegi selle asemel uue —
    dublikaat. Normaliseerimine SIIN tähendab, et vana andmestik on kaetud
    ilma migratsioonita: nii indeksi ehitus kui otsing käivad sama reegli alt.
    """
    return f"{scheme}:{normalize_ext_id(scheme, ext_id)}"


def _person_keys(person: dict) -> list:
    """Isiku väliste identifikaatorite võtmed. Tombstone/merged ei indekseerita —
    nende ID-d peavad viitama elavale kaardile (vt merge)."""
    if person.get("record_status") == "tombstone" or person.get("merged_into"):
        return []
    keys = []
    for ident in person.get("identifiers") or []:
        scheme = ident.get("scheme")
        ext_id = ident.get("id")
        if scheme and ext_id:
            keys.append(_key(scheme, ext_id))
    return keys


def _scan_dir(directory: str) -> Dict[str, str]:
    """Ehitab indeksi kaustast. AINUS koht, kus tehakse täisskann."""
    index: Dict[str, str] = {}
    try:
        fnames = sorted(os.listdir(directory))  # sorteeritud → duplikaat laheneb ühtmoodi
    except OSError:
        return index

    for fname in fnames:
        if not fname.endswith(".json"):
            continue
        path = os.path.join(directory, fname)
        try:
            with open(path, encoding="utf-8") as f:
                person = json.load(f)
        except Exception:
            continue
        person_id = person.get("id")
        if not person_id:
            continue
        for key in _person_keys(person):
            existing = index.get(key)
            if existing and existing != person_id:
                # Fail-closed: hoiame esimest (sorteeritud järjekorras → deterministlik)
                # ja logime, et duplikaat oleks leitav ja parandatav.
                logger.warning(
                    "Prosopo: väline ID %s viitab mitmele kaardile (%s ja %s); "
                    "kasutan %s", key, existing, person_id, existing
                )
                continue
            index[key] = person_id
    return index


def _current_dir() -> str:
    sync_from_facade()
    return state.PROSOPOGRAPHY_DIR


def _ensure(directory: str) -> Dict[str, str]:
    """Tagastab kehtiva indeksi, ehitades selle vajadusel."""
    global _index, _index_dir
    with _lock:
        if _index is None or _index_dir != directory:
            _index = _scan_dir(directory)
            _index_dir = directory
        return _index


def invalidate() -> None:
    """Sunnib järgmisel päringul täisskanni. Kutsu, kui isikufaile on muudetud
    indeksist mööda (bulk-migratsioon, git-taaste)."""
    global _index, _index_dir
    with _lock:
        _index = None
        _index_dir = None


def find_person_id(scheme: str, ext_id: str) -> Optional[str]:
    """`vutt:P...` välise identifikaatori järgi, või None."""
    index = _ensure(_current_dir())
    with _lock:
        return index.get(_key(scheme, ext_id))


def update_for_person(person: dict) -> None:
    """Sünkroniseerib ühe isiku kirjed indeksis (lisa/muuda/eemalda), ilma skannita."""
    person_id = person.get("id")
    if not person_id:
        return
    directory = _current_dir()
    index = _ensure(directory)
    with _lock:
        # Eemalda selle isiku vananenud võtmed (identifikaator võidi ära võtta)
        for key in [k for k, v in index.items() if v == person_id]:
            del index[key]
        for key in _person_keys(person):
            existing = index.get(key)
            if existing and existing != person_id:
                logger.warning(
                    "Prosopo: väline ID %s on juba kaardil %s, ei seo kaardiga %s",
                    key, existing, person_id
                )
                continue
            index[key] = person_id


def remove_person(person_id: str) -> None:
    """Eemaldab kõik selle isiku kirjed (kustutamine, merge'i lähteisik)."""
    if not person_id:
        return
    directory = _current_dir()
    index = _ensure(directory)
    with _lock:
        for key in [k for k, v in index.items() if v == person_id]:
            del index[key]


def rebuild_from(persons: list, directory: str) -> None:
    """Ehitab indeksi juba mällu laetud isikutest (rebuild_indices) — lisaskannita."""
    global _index, _index_dir
    index: Dict[str, str] = {}
    for person in sorted(persons, key=lambda p: p.get("id") or ""):
        person_id = person.get("id")
        if not person_id:
            continue
        for key in _person_keys(person):
            existing = index.get(key)
            if existing and existing != person_id:
                logger.warning(
                    "Prosopo: väline ID %s viitab mitmele kaardile (%s ja %s); "
                    "kasutan %s", key, existing, person_id, existing
                )
                continue
            index[key] = person_id
    with _lock:
        _index = index
        _index_dir = directory


def snapshot() -> Tuple[int, Optional[str]]:
    """(kirjete arv, kaust) — diagnostikaks."""
    with _lock:
        return (len(_index) if _index is not None else 0, _index_dir)


__all__ = [
    "find_person_id", "update_for_person", "remove_person", "invalidate",
    "rebuild_from", "snapshot",
]
