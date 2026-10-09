"""Taaste avaldamine ilma jooksvaid muudatusi üle kirjutamata (#417).

`rebuild_indices` loeb lähteandmed (kaardid, teosed), ehitab indeksid ja kirjutab
need lõpuks üle. Kõik see võtab aega ning API kirjutab vahepeal samu indekseid
võtmekaupa edasi. Lõpliku kirjutuse lukk ei tõenda, et taaste hetktõmmis oli
värske: ilma selleta asendaks taaste vahepeal kirjutatud kirje vanaga.

Protokoll: taaste loeb indeksi BAASSEISU enne lähteandmete lugemist. Avaldamisel
(indeksi luku all) on võti, mille kettaseis erineb baasseisust, vahepeal
kirjutatud — see kirje jääb kettalt, mitte taastest. Muud võtmed tulevad taastest.

Miks see on õige: jooksev kirjutaja muudab enne lähteandmeid, siis indeksit.
- Indeks kirjutati enne baasseisu lugemist → ka lähteandmed olid enne
  taaste lugemist kettal, taaste on värske.
- Indeks kirjutati baasseisu ja avaldamise vahel → võti erineb baasseisust ja
  kettaseis (värske) jääb.
- Indeks kirjutatakse pärast avaldamist → sama luku all taaste tulemuse peale.

Jääkoht: kirjutaja, kes kirjutab väärtuse, mis on täpselt võrdne baasseisuga,
jääb märkamata — siis oli baasseis juba õige ja taaste väärtus tuleb lähteandmetest,
mis on kas sama või uuem.
"""
from __future__ import annotations

from typing import Any, Callable, Hashable

_PUUDUB = object()


def merge_fresh(rebuilt: dict, baseline: dict, disk: dict) -> dict:
    """Taaste tulemus, kus vahepeal kirjutatud võtmed tulevad kettalt."""
    out = dict(rebuilt)
    for key in baseline.keys() | disk.keys():
        enne = baseline.get(key, _PUUDUB)
        nyyd = disk.get(key, _PUUDUB)
        if enne == nyyd:
            continue
        if nyyd is _PUUDUB:
            out.pop(key, None)
        else:
            out[key] = nyyd
    return out


def group_by(items: list, key: Callable[[Any], Hashable]) -> dict:
    """Loend → {võti: [kirjed]} (järjekord säilib), et loendeid võtmekaupa võrrelda."""
    out: dict = {}
    for item in items:
        out.setdefault(key(item), []).append(item)
    return out


def ptw_groups(ptw: dict) -> dict:
    """person_to_works → {(isik, teos): [kirjed]}.

    Kirjutajad töötavad TEOSE kaupa (`update_person_to_works`,
    `update_page_person_mentions`), seega võrdlusühik on paar (isik, teos):
    teose muutus ei lükka tagasi sama isiku teiste teoste taastet.
    """
    out: dict = {}
    for pid, entries in (ptw or {}).items():
        for entry in entries or []:
            out.setdefault((pid, entry.get("work_id")), []).append(entry)
    return out


def ptw_from_groups(groups: dict) -> dict:
    out: dict = {}
    for (pid, _wid), entries in groups.items():
        out.setdefault(pid, []).extend(entries)
    return out
