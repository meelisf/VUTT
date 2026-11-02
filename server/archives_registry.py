# server/archives_registry.py
"""Hoidjate register `archives.json` (ADR 0076 täiendus 2026-11-02).

Kirje: `{võti: {"name": …, "url"?: …, "aliases"?: [ … ]}}`.

- **Võti** on „linn + asutuse praegune lühend" (`Tartu TÜR`, `Tallinn RR`). Eksemplari
  `holder` kannab AINULT võtit, mitte aliast.
- **Aliased** on teised nimekujud: ajaloolised (Jaansoni `Tallinn ERR`), vanad VUTT-i
  võtmed (`TÜR`), lakanud asutuse kuju, mille kogud on selle hoidja juures. Mitmetähenduslik
  kuju (`KB`) aliaseks ei sobi.
- **Ainulaadsus:** iga kuju (võti või alias, tähesuurus ja tühikud ühtlustatud) kuulub
  kogu registris ÜHELE kirjele. Nii ei teki samast asutusest teist kirjet ainult
  seepärast, et kasutati teist nimekuju.

Puhtad funktsioonid; failitee ja kirjutus (`save_config_with_git`) jäävad kutsujale.
"""
from __future__ import annotations

import json
from typing import Optional

MAX_ALIASES = 20
MAX_ALIAS_LEN = 120


def form_key(value) -> str:
    """Nimekuju võrdlusvõti: tühikud ühtlustatud, tähesuurus ei loe."""
    return " ".join(str(value or "").split()).casefold()


def read_archives(path: str) -> dict:
    """Register failist; puuduv või vigane fail = tühi register."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def clean_aliases(raw) -> list[str]:
    """Kliendi aliaste loend → puhastatud loend. Viskab ValueError vigase sisendi peale.

    Tühjad kujud jäetakse välja, korduvad (võrdlusvõtme järgi) üks kord, järjekord säilib.
    """
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ValueError("aliases peab olema loend")
    out, seen = [], set()
    for item in raw:
        if not isinstance(item, str):
            raise ValueError("alias peab olema tekst")
        s = " ".join(item.split())
        if not s:
            continue
        if len(s) > MAX_ALIAS_LEN:
            raise ValueError(f"alias on liiga pikk: {s[:40]}…")
        k = form_key(s)
        if k in seen:
            continue
        seen.add(k)
        out.append(s)
    if len(out) > MAX_ALIASES:
        raise ValueError(f"aliasi on üle {MAX_ALIASES}")
    return out


def find_conflict(archives: dict, archive_id: str, aliases: list[str]) -> Optional[tuple[str, str]]:
    """Esimene kuju, mis kuulub juba teisele kirjele: `(kuju, omaniku võti)` või None.

    Kirje enda kujud (`archive_id`) ei ole konflikt — muutmisel võrreldakse ainult teistega.
    Ka kirje enda võti ja alias ei tohi kattuda (see oleks mõttetu alias).
    """
    owners: dict[str, str] = {}
    for key, entry in (archives or {}).items():
        if key == archive_id:
            continue
        owners.setdefault(form_key(key), key)
        for a in (entry or {}).get("aliases") or []:
            owners.setdefault(form_key(a), key)
    own = form_key(archive_id)
    for form in (archive_id, *aliases):
        owner = owners.get(form_key(form))
        if owner is not None:
            return form, owner
    for a in aliases:
        if form_key(a) == own:
            return a, archive_id
    return None


def resolve_holder(archives: dict, form) -> Optional[str]:
    """Nimekuju → registri võti. Täpne võti, siis võrdlusvõtme järgi võti või alias."""
    if not isinstance(form, str) or not form.strip():
        return None
    if form in (archives or {}):
        return form
    k = form_key(form)
    for key, entry in (archives or {}).items():
        if form_key(key) == k:
            return key
        if any(form_key(a) == k for a in (entry or {}).get("aliases") or []):
            return key
    return None


def build_entry(name: str, url: str = "", aliases: Optional[list[str]] = None) -> dict:
    """Kirje kanoonilisel kujul: väärtuseta võtit ei salvestata."""
    entry: dict = {"name": name}
    if url:
        entry["url"] = url
    if aliases:
        entry["aliases"] = list(aliases)
    return entry
