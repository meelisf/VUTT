"""Automaatrikastuse puhas loogika (spekk §4.3, ADR 0048).

Siin ei ole võrku, lukke ega faile — `auto_enrich_runner` tegeleb nendega. Reeglid:
  * täidetakse ainult tühja; erandid (ainult lisamise suunas): `name.aliases`
    ühendatakse, seotud ID-d (`linked`) lisab runner;
  * allikatevaheline vastuolu jääb täitmata ja läheb `conflicts`-i;
  * kokkusobiv kuupäev (vähem täpne on täpsema eesliide) → täpsem.
"""
from __future__ import annotations

import unicodedata
from typing import Optional

from .enrichment import _ühenda_variandid

ENRICH_SCHEMES = ("wikidata", "gnd", "viaf", "album_academicum")

_PREC_LEN = {"year": 4, "month": 7, "day": 10}
_PREC_RANK = {"year": 0, "month": 1, "day": 2}


def _norm(v) -> str:
    return unicodedata.normalize("NFC", str(v)).strip().casefold()


def _list_key(item: dict) -> str:
    return item.get("id") or _norm(item.get("label", ""))


def _pad_date(date: str) -> str:
    """Täidab puuduva kuu/päeva "01"-ga — kaardiväli on ALATI YYYY-MM-DD.

    GND ja AA saadavad ainult aasta ("1592") või aasta-kuu ("1592-08"),
    Wikidata annab alati täiskuupäeva. Ilma padita jäid sama teadmise kaks
    kirjakuju (nt "1592" vs "1592-01-01") omavahel võrreldes erinevaks —
    tulemus sõltus allikate järjekorrast ja kaardile oleks jõudnud kuju,
    mida `buildDatePayload` (personForm) ei tunne.
    """
    osad = str(date).split("-")
    while len(osad) < 3:
        osad.append("01")
    return "-".join(osad[:3])


def _trunc_date(v: dict) -> tuple:
    """Kuupäev + täpsus, kärbitud täpsuse pikkuseni — kõrvalejäetud osa
    (nt kuu/päev "01"-täide aastatäpsuse taga) ei tohi vastuolu tekitada."""
    n = _PREC_LEN.get(v["precision"], 10)
    return v["date"][:n], v["precision"]


def _date_unit(remote: dict, prefix: str) -> Optional[dict]:
    date = remote.get(f"{prefix}.date")
    if not date:
        return None
    return {"date": _pad_date(date), "precision": remote.get(f"{prefix}.precision") or "day"}


def _dates_compatible(a: dict, b: dict) -> Optional[dict]:
    """Tagastab täpsema, kui kokkusobivad; None, kui vastuolus."""
    lo, hi = sorted((a, b), key=lambda d: _PREC_RANK.get(d["precision"], 2))
    n = _PREC_LEN.get(lo["precision"], 10)
    return hi if lo["date"][:n] == hi["date"][:n] else None


def _place(value: dict, scheme: str) -> dict:
    return {"id": value.get("id"), "label": value.get("label"),
            "labels": value.get("labels"), "source": scheme}


def aggregate(sources: list) -> dict:
    """Koondab kõigi vastanud allikate ettepanekud enne ühtegi kirjutust."""
    scalars: dict = {}   # rada → [(scheme, väärtus)]
    lists: dict = {"occupations": [], "confessions": [], "statuses": []}
    aliases: list = []
    linked: dict = {}    # skeem → [(allikas, id)]

    for s in sources:
        scheme, r = s["scheme"], s.get("remote") or {}
        if r.get("gender"):
            scalars.setdefault("gender", []).append((scheme, r["gender"]))
        for prefix in ("birth", "death"):
            unit = _date_unit(r, prefix)
            if unit:
                scalars.setdefault(prefix, []).append((scheme, unit))
            place = r.get(f"{prefix}.place")
            if isinstance(place, dict) and place.get("label"):
                scalars.setdefault(f"{prefix}.place", []).append((scheme, _place(place, scheme)))
        if r.get("aa_raw"):
            scalars.setdefault("aa_raw", []).append((scheme, r["aa_raw"]))
        for occ in r.get("_occupations") or []:
            lists["occupations"].append({k: v for k, v in (
                ("id", occ.get("id")), ("label", occ.get("label")), ("labels", occ.get("labels"))
            ) if v})
        if r.get("_occupation_label") and not r.get("_occupations"):
            lists["occupations"].append({"label": r["_occupation_label"]})
        for key, target in (("confession", "confessions"), ("status", "statuses")):
            v = r.get(key)
            if isinstance(v, dict) and v.get("label"):
                lists[target].append({k: v[k] for k in ("id", "label", "labels") if v.get(k)})
        aliases.extend(r.get("name.aliases") or [])
        for lk, ls in (("_linked_wikidata", "wikidata"), ("_linked_gnd", "gnd")):
            if r.get(lk):
                linked.setdefault(ls, []).append((scheme, str(r[lk])))

    fields: dict = {}
    conflicts: list = []

    for path, vals in scalars.items():
        chosen, clash = vals[0][1], False
        for _, v in vals[1:]:
            if path in ("birth", "death"):
                merged = _dates_compatible(chosen, v)
                if merged is None:
                    clash = True
                    break
                chosen = merged
            elif path.endswith(".place"):
                same = (chosen.get("id") and chosen.get("id") == v.get("id")) or \
                       _norm(chosen.get("label")) == _norm(v.get("label"))
                if not same:
                    clash = True
                    break
                # Sildid klapivad — eelista ID-ga väärtust, sõltumata sellest,
                # kumb allikas vastas enne (muidu jäi ID-ta esimene püsima).
                if not chosen.get("id") and v.get("id"):
                    chosen = v
            elif _norm(chosen) != _norm(v):
                clash = True
                break
        differs = path in ("birth", "death") and len({_trunc_date(v) for _, v in vals}) > 1
        if clash or differs:
            field = f"{path}.date" if path in ("birth", "death") else path
            shown = [{"scheme": sc, "value": (v["date"] if path in ("birth", "death") else v)} for sc, v in vals]
            conflicts.append({"field": field, "compatible": not clash, "values": shown})
        if not clash:
            fields[path] = chosen

    for path, items in lists.items():
        out, seen = [], set()
        for it in items:
            k = _list_key(it)
            if k and k not in seen:
                seen.add(k)
                out.append(it)
        if out:
            fields[path] = out

    if aliases:
        fields["name.aliases"] = _ühenda_variandid([], aliases) or []

    linked_out: dict = {}
    for ls, vals in linked.items():
        if len({v for _, v in vals}) == 1:
            linked_out[ls] = vals[0][1]
        else:
            conflicts.append({"field": f"identifiers.{ls}", "compatible": False,
                              "values": [{"scheme": sc, "value": v} for sc, v in vals]})
    return {"fields": fields, "conflicts": conflicts, "linked": linked_out}


def apply_to_card(card: dict, agg: dict) -> list:
    """Rakendab koondatud ettepanekud VÄRSKELE kaardile; ainult tühja. Muteerib."""
    f = agg.get("fields") or {}
    applied: list = []
    if "gender" in f and not card.get("gender"):
        card["gender"] = f["gender"]
        applied.append("gender")
    for prefix in ("birth", "death"):
        obj = card.get(prefix) if isinstance(card.get(prefix), dict) else {}
        if prefix in f and not obj.get("date"):
            obj = {**obj, "date": f[prefix]["date"], "precision": f[prefix]["precision"]}
            applied.append(f"{prefix}.date")
        # Vana kaart võib kanda kohta lihtstringina — see loetakse täidetuks,
        # mitte üle ei kirjutata (paljal stringil pole `.get`-meetodit).
        existing_place = obj.get("place")
        place_filled = (isinstance(existing_place, str) and existing_place.strip()) or \
            (isinstance(existing_place, dict) and existing_place.get("label"))
        if f"{prefix}.place" in f and not place_filled:
            obj = {**obj, "place": f[f"{prefix}.place"]}
            applied.append(f"{prefix}.place")
        if obj:
            card[prefix] = obj
    for path in ("occupations", "confessions", "statuses"):
        if path in f and not card.get(path):
            card[path] = f[path]
            applied.append(path)
    if "aa_raw" in f and not (card.get("aa_raw") or "").strip():
        card["aa_raw"] = f["aa_raw"]
        applied.append("aa_raw")
    if f.get("name.aliases"):
        name = card.setdefault("name", {})
        uus = _ühenda_variandid(name.get("aliases") or [], f["name.aliases"])
        if uus is not None:
            name["aliases"] = uus
            applied.append("name.aliases")
    return applied


def new_review(*, created_via: str, context: Optional[dict],
               has_enrichable_ids: bool, possible_duplicate: bool) -> dict:
    reasons = ["enrich_pending"] if has_enrichable_ids else ["no_source"]
    if possible_duplicate:
        reasons.append("possible_duplicate")
    return {"state": "pending", "reasons": reasons, "context": context,
            "created_via": created_via, "auto_filled": [], "source_conflicts": [],
            "failed_sources": [], "done_by": None, "done_at": None}


def finish_review(review: dict, *, ids_left: bool, answered: list, failed: list,
                  applied: list, conflicts: list, possible_duplicate: bool) -> dict:
    """Lõppolek (spekk §4.3 tabel). `enrich_pending` eemaldub ALATI.

    Kui kaardil ei ole enam ühtegi rikastatavat ID-d (`ids_left=False`), ei
    loe ükski teine parameeter — ainus muutus on `enrich_pending` kadumine
    (spekk §4.3 tabeli viimane rida). See juhtub nt kui kasutaja kustutas
    kõik ID-d enne, kui runner jõudis lõpetada.
    """
    r = {**review}
    reasons = [x for x in r.get("reasons") or [] if x != "enrich_pending"]
    if not ids_left:
        r["reasons"] = reasons
        return r
    if possible_duplicate and "possible_duplicate" not in reasons:
        reasons.append("possible_duplicate")
    if answered:
        reasons.append("auto_enriched" if applied else "nothing_to_fill")
    if failed:
        reasons.append("enrich_failed")
        r["failed_sources"] = list(dict.fromkeys((r.get("failed_sources") or []) + failed))
    r["reasons"] = reasons
    r["auto_filled"] = list(dict.fromkeys((r.get("auto_filled") or []) + applied))
    r["source_conflicts"] = (r.get("source_conflicts") or []) + conflicts
    return r
