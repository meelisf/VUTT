# server/work_parts.py
"""Teose osad (#464, ADR 0057): kirjad, luuletused, kõned, istungid ja lisad.

Osa on teose sees olev iseseisev üksus. Lehed on lehefailide tüvede HULK (võib olla
katkendlik; leht võib kuuluda mitmesse osasse). Salvestus: `_metadata.json` väli
`parts`, muudetakse AINULT selle mooduli toimingutega (mitte üldise metaandmete
salvestusega), et samaaegsed toimetajad ei kirjutaks teineteise osi üle.
"""
from __future__ import annotations

import json
import os
import re
from typing import Optional

from .config import get_logger
from .utils import generate_nanoid
from .work_dating import clean_dating

logger = get_logger(__name__)

# Liik on teksti VORM, mitte ülesanne: gratulatsioon, leinaluuletus ja pühendus
# tulevad rollipaarist (auctor → subject), ADR 0057.
KINDS = frozenset({"letter", "poem", "prose", "speech", "session", "section", "attachment"})
ROLES = frozenset({"auctor", "addressee", "praeses", "participant", "subject"})
# `abstract_*` = avalik sisukokkuvõte, keel väljanimes (ADR 0039 muster, ADR 0063).
# `notes` = toimetaja märkus: API annab ta kõigile, avalik vaade teda ei näita.
_TEXT_FIELDS = ("title", "incipit", "notes", "abstract_et", "abstract_en")
# Ankur: eestikeelse kokkuvõtte räsi, mille pealt ingliskeelne kinnitati. Kirjutab AINULT
# server ja ainult selgesõnalise kinnituse peale; kliendi saadetud ankur visatakse ära.
ANCHOR = "abstract_en_src"
CONFIRM = "confirm_abstract_translation"
_ANCHOR_RE = re.compile(r"^[0-9a-f]{12}$")


class PartError(ValueError):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _place(value) -> Optional[dict]:
    if value in (None, ""):
        return None
    if not isinstance(value, dict) or not (value.get("id") or value.get("label")):
        raise PartError("Vigane koht")
    return {"id": value.get("id") or None, "label": (value.get("label") or "").strip()}


def _creators(value) -> list:
    out = []
    for c in value or []:
        if not isinstance(c, dict) or c.get("role") not in ROLES:
            raise PartError(f"Lubamatu roll: {c.get('role') if isinstance(c, dict) else c!r}")
        if not (c.get("id") or c.get("name")):
            raise PartError("Isikul peab olema id või nimi")
        out.append({k: c[k] for k in ("id", "name", "role", "source") if c.get(k) not in (None, "")})
    return out


def _normalize(p: dict, page_stems: set[str]) -> dict:
    if not isinstance(p, dict):
        raise PartError("Osa peab olema objekt")
    kind = p.get("kind")
    if kind not in KINDS:
        raise PartError(f"Tundmatu liik: {kind!r}")
    pages = p.get("pages") or []
    if not isinstance(pages, list) or any(not isinstance(s, str) for s in pages):
        raise PartError("Vigane lehtede loend")
    missing = [s for s in pages if s not in page_stems]
    if missing:
        raise PartError(f"Lehti pole teoses: {', '.join(missing[:5])}")
    needs_review = bool(p.get("needs_review"))
    if not pages and not needs_review:
        raise PartError("Osal peab olema vähemalt üks leht")
    place_to = _place(p.get("place_to"))
    if place_to and kind != "letter":
        raise PartError("Sihtkoht on lubatud ainult kirjal")
    try:
        dating = clean_dating(p.get("dating")) if p.get("dating") else None
    except ValueError as e:
        raise PartError(f"Vigane dateering: {e}")
    out = {
        "id": p.get("id"),
        "kind": kind,
        "pages": list(dict.fromkeys(pages)),
        "creators": _creators(p.get("creators")),
        "attached_to": p.get("attached_to") or None,
        "needs_review": needs_review,
    }
    for f in _TEXT_FIELDS:
        v = p.get(f)
        if isinstance(v, str) and v.strip():
            out[f] = v.strip()
    anchor = p.get(ANCHOR)
    if out.get("abstract_en") and isinstance(anchor, str) and _ANCHOR_RE.fullmatch(anchor):
        out[ANCHOR] = anchor
    if dating:
        out["dating"] = dating
    if _place(p.get("place")):
        out["place"] = _place(p.get("place"))
    if place_to:
        out["place_to"] = place_to
    langs = p.get("languages")
    if isinstance(langs, list) and langs:
        out["languages"] = [l for l in langs if isinstance(l, str)]
    return out


def validate_parts(parts: list, page_stems: set[str]) -> list[dict]:
    out = [_normalize(p, page_stems) for p in parts or []]
    ids = [p["id"] for p in out]
    if any(not i for i in ids) or len(ids) != len(set(ids)):
        raise PartError("Osa id puudub või kordub")
    by_id = {p["id"]: p for p in out}
    for p in out:
        a = p["attached_to"]
        if a is None:
            continue
        if p["kind"] != "attachment":
            raise PartError("attached_to on lubatud ainult lisal")
        if a == p["id"] or a not in by_id or by_id[a]["kind"] == "attachment":
            raise PartError("Lisa peab viitama olemasolevale osale, mis ise ei ole lisa")
    return out


def _with_anchor(data: dict, previous: Optional[dict] = None) -> dict:
    """Kliendi osa → salvestatav: ankur ainult kinnitusest, muidu jääb eelmine alles.

    Ingliskeelse kirjavea parandus EI kustuta hoiatust (ADR 0039 p 2): ankur uueneb
    ainult siis, kui toimetaja kinnitab, et tõlge vastab eestikeelsele tekstile.
    """
    from .prosopo_biography_fields import text_hash
    out = {k: v for k, v in (data or {}).items() if k not in (ANCHOR, CONFIRM)}
    if (data or {}).get(CONFIRM) and (out.get("abstract_en") or "").strip():
        out[ANCHOR] = text_hash(out.get("abstract_et"))
    elif previous and previous.get(ANCHOR):
        out[ANCHOR] = previous[ANCHOR]
    return out


def new_part(data: dict, existing_ids: set[str]) -> dict:
    """Uus osa: server annab id; kliendi id ja needs_review ignoreeritakse."""
    pid = generate_nanoid(6)
    while pid in existing_ids:
        pid = generate_nanoid(6)
    return {**{k: v for k, v in _with_anchor(data).items() if k not in ("id", "needs_review")},
            "id": pid, "needs_review": False}


def page_stems(work_dir: str) -> list[str]:
    """Teose lehtede tüved teose järjekorras (sama järjekord mis /work/{id}/{nr})."""
    from .meili_doc import enumerate_page_images
    return [os.path.splitext(n)[0] for n in enumerate_page_images(work_dir)]


def _ordered(pages: list[str], order: list[str]) -> list[str]:
    pos = {s: i for i, s in enumerate(order)}
    return sorted(dict.fromkeys(pages), key=lambda s: pos.get(s, len(pos)))


def _write(work_dir: str, username: str, message: str, mutate, background_tasks=None) -> object:
    """Loe–muuda–kirjuta metadata_lock'i all. `mutate(parts, stems)` tagastab
    (uued_osad, tulemus) või viskab PartError'i.

    `background_tasks` (FastAPI) viib Meili sünk'i ja person_to_works'i taustale:
    57-leheline teos indekseerus sünkroonselt ~0,7 s osa kohta (mõõdetud 2026-10-05)."""
    from .metadata_ops import bulk_update_works
    from . import admin_page_ops
    box: dict = {}

    def transform(meta: dict) -> dict:
        try:
            # Vananenud tüved (ebaõnnestunud sünk, käsitsi muudatus) parandatakse enne
            # muutust — muidu blokeeriks üks vigane osa kõik selle teose osade muudatused.
            current, _ = remap_parts(list(meta.get("parts") or []), stems, None)
            parts, result = mutate(current, stems)
            parts = validate_parts(parts, set(stems))
            for p in parts:
                p["pages"] = _ordered(p["pages"], stems)
            box["result"] = result
            return {"parts": parts}
        except PartError as e:
            box["error"] = e
            raise

    # Tüvede lugemine ja kirjutus teose luku all: sama järjekord mis lehetoimingutel
    # (work_lock → metadata_lock), muidu võib samaaegne poolitus tüve vahepeal asendada.
    with admin_page_ops.work_lock(os.path.basename(work_dir), work_dir):
        stems = page_stems(work_dir)
        # call_ptw: osa isikud person_to_works'i `part_id`-ga (#464 PR 3).
        res = bulk_update_works([(os.path.join(work_dir, "_metadata.json"), transform)], username, message,
                                call_ptw=True, background_tasks=background_tasks)
    if "error" in box:
        raise box["error"]
    if res.get("failed"):
        raise PartError("Teose metaandmeid ei saanud kirjutada", 500)
    if res.get("updated"):
        _refresh_mention_parts(work_dir)
    return box.get("result")


def relabel_person(work_dir: str, person_id: str, new_label: str, username: str) -> bool:
    """Isikukaardi nimemuutus osade `creators`-isse (#526: nimi on kirjaindeksis).

    Käib `_write` kaudu (work_lock + metadata_lock, ADR 0057), mitte otsekirjutusena.
    Tagastab False, kui teose osades pole seda isikut vana nimega — siis ei kirjutata.
    """
    try:
        with open(os.path.join(work_dir, "_metadata.json"), encoding="utf-8") as f:
            parts = json.load(f).get("parts") or []
    except (OSError, ValueError):
        return False
    if not any(c.get("id") == person_id and c.get("name") != new_label
               for p in parts for c in p.get("creators") or []):
        return False

    def mutate(current: list, _stems: list) -> tuple[list, bool]:
        for p in current:
            for c in p.get("creators") or []:
                if c.get("id") == person_id:
                    c["name"] = new_label
        return current, True

    _write(work_dir, username, f"Prosopo nime uuendus osades ({person_id}): {new_label}", mutate)
    return True


def _refresh_mention_parts(work_dir: str) -> None:
    """Mainimiste `part_ids` sõltub osade lehtedest → osa muutuse järel uuesti.

    refresh_work_mentions'i asemel otse: lehehulk ei muutunud, osade ühtlustus oleks tühi.
    Viga logitakse: osa on juba kettal ja commititud.
    """
    import json
    try:
        with open(os.path.join(work_dir, "_metadata.json"), "r", encoding="utf-8") as f:
            work_id = (json.load(f) or {}).get("id")
        # Moodulile viitamine, et testide patch jõuaks kohale.
        from .prosopography import relations
        relations.update_page_person_mentions(work_id, work_dir)
    except Exception:
        logger.exception(f"Osa järel mainimiste uuendus ebaõnnestus ({work_dir})")


def _find(parts: list, part_id: str) -> int:
    for i, p in enumerate(parts):
        if p.get("id") == part_id:
            return i
    raise PartError(f"Osa puudub: {part_id}", 404)


def create_part(work_dir: str, data: dict, username: str, background_tasks=None) -> dict:
    def mutate(parts, _stems):
        part = new_part(data, {p.get("id") for p in parts})
        return parts + [part], part["id"]
    pid = _write(work_dir, username, f"Osa: lisa ({(data or {}).get('kind')})", mutate, background_tasks)
    return _read_part(work_dir, pid)


def _replace_part(parts: list, part_id: str, data: dict) -> list:
    i = _find(parts, part_id)
    keep = {"id": part_id, "needs_review": parts[i].get("needs_review", False)}
    data = _with_anchor(data, parts[i])
    parts[i] = {**{k: v for k, v in data.items() if k not in ("id", "needs_review")}, **keep}
    return parts


def update_part(work_dir: str, part_id: str, data: dict, username: str, background_tasks=None) -> dict:
    def mutate(parts, _stems):
        return _replace_part(parts, part_id, data), part_id
    _write(work_dir, username, f"Osa: muuda [{part_id}]", mutate, background_tasks)
    return _read_part(work_dir, part_id)


def apply_parts(work_dir: str, ops: list, username: str, message: str, background_tasks=None) -> list:
    """Mitu loomist/parandust ÜHE kirjutusega: üks lukk, üks commit, üks Meili sünk.

    `ops`: `{"op": "create"|"update", "data", "part_id"?, "key"?, "attach_key"?, "label"?}`.
    `attach_key` viitab sama kogumi varasema op'i `key`-le (lisa oma kirjale, mis luuakse
    samas kogumis). Kogum on atomaarne: üks vigane osa → midagi ei kirjutata ja viga
    kannab selle op'i `label`-it. Tagastab osad `ops` järjekorras.
    """
    def mutate(parts, stems):
        ids, by_key = [], {}
        for op in ops:
            data = dict(op.get("data") or {})
            try:
                if op.get("attach_key") is not None:
                    if op["attach_key"] not in by_key:
                        raise PartError("Lisa viitab osale, mida pole")
                    data["attached_to"] = by_key[op["attach_key"]]
                if op.get("op") == "update":
                    parts = _replace_part(parts, op["part_id"], data)
                    pid = op["part_id"]
                else:
                    part = new_part(data, {p.get("id") for p in parts})
                    parts, pid = parts + [part], part["id"]
                # Valideerimine op'i kaupa: viga nimetab rea, mitte ainult kogu loendi.
                validate_parts(parts, set(stems))
            except PartError as e:
                raise PartError(f"{op.get('label') or op.get('op')}: {e}", e.status)
            if op.get("key") is not None:
                by_key[op["key"]] = pid
            ids.append(pid)
        return parts, ids
    ids = _write(work_dir, username, message, mutate, background_tasks)
    import json
    with open(os.path.join(work_dir, "_metadata.json"), "r", encoding="utf-8") as f:
        parts = (json.load(f) or {}).get("parts") or []
    return [parts[_find(parts, pid)] for pid in ids]


def delete_part(work_dir: str, part_id: str, username: str, background_tasks=None) -> None:
    def mutate(parts, _stems):
        _find(parts, part_id)
        if any(p.get("attached_to") == part_id for p in parts):
            raise PartError("Osale viitavad lisad; kustuta või sea need enne ümber", 409)
        return [p for p in parts if p.get("id") != part_id], None
    _write(work_dir, username, f"Osa: kustuta [{part_id}]", mutate, background_tasks)


def change_part_pages(work_dir: str, part_id: str, add: list[str], remove: list[str], username: str,
                      background_tasks=None) -> dict:
    def mutate(parts, _stems):
        i = _find(parts, part_id)
        pages = [s for s in parts[i].get("pages") or [] if s not in set(remove or [])] + list(add or [])
        if not pages:
            raise PartError("Osal peab jääma vähemalt üks leht; kustuta osa", 400)
        parts[i] = {**parts[i], "pages": pages, "needs_review": False}
        return parts, part_id
    _write(work_dir, username, f"Osa: lehed [{part_id}]", mutate, background_tasks)
    return _read_part(work_dir, part_id)


def _read_part(work_dir: str, part_id: str) -> dict:
    import json
    with open(os.path.join(work_dir, "_metadata.json"), "r", encoding="utf-8") as f:
        parts = (json.load(f) or {}).get("parts") or []
    return parts[_find(parts, part_id)]


def remap_parts(parts: list[dict], stems: list[str], renamed: Optional[dict] = None) -> tuple[list[dict], bool]:
    """Lehetoimingu järel: poolitatud tüvi → mõlemad pooled; puuduv tüvi välja;
    tühjaks jäänud osa → needs_review (ei kustutata). Järjekord teose järgi."""
    live = set(stems)
    changed = False
    out = []
    for p in parts:
        pages: list[str] = []
        for s in p.get("pages") or []:
            pages.extend((renamed or {}).get(s, [s]))
        pages = _ordered([s for s in pages if s in live], stems)
        np = {**p, "pages": pages}
        if not pages and p.get("pages"):
            np["needs_review"] = True
        if np != p:
            changed = True
        out.append(np)
    return out, changed


def sync_work_parts(work_dir: str, work_id: Optional[str] = None, renamed: Optional[dict] = None) -> None:
    """Kutsutakse refresh_work_mentions'i seest — kõik lehetoimingud katavad osad."""
    import json
    meta_path = os.path.join(work_dir, "_metadata.json")
    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            if not (json.load(f) or {}).get("parts"):
                return
    except FileNotFoundError:
        return
    from .metadata_ops import bulk_update_works
    stems = page_stems(work_dir)

    def transform(meta: dict) -> dict:
        parts, changed = remap_parts(list(meta.get("parts") or []), stems, renamed)
        return {"parts": parts} if changed else {}

    res = bulk_update_works([(meta_path, transform)], "Automaatne", "Osad: lehetoimingu järel ühtlustatud",
                            call_ptw=True)
    if not res.get("updated"):
        # Ümberjärjestus ei muuda tüvesid, aga nihutab numbreid: teose faktide osade
        # `first_page`/`pages` arvutatakse kirjutamisel, seega kirjutame need ise.
        from .prosopography import work_relations_ops
        with open(meta_path, "r", encoding="utf-8") as f:
            work_relations_ops.update_work_facts(json.load(f) or {}, work_dir)
