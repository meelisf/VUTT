# server/work_exemplars.py
"""Teose eksemplarid (#696, ADR 0076).

`_metadata.json` väli `exemplars[]` on eksemplaride AINUS salvestatud kuju;
`archive_refs` tuletatakse sellest lugemisel (`derive_archive_refs`). Väli muutub
AINULT selle mooduli toimingutega — üldine /update-work-metadata lükkab nii
`exemplars`-i kui `archive_refs`-i tagasi.

Lehe päritolu: eksemplar, mille `pages` sisaldab tüve → teadmata, kui tüvi on
`exemplar_unknown_pages`-is → tekstitunnistaja → teadmata. Väärtuseta võtit ei
salvestata (ADR 0076 p 2), muidu tekitaks `false` vs puuduv võti tühja commiti.
"""
from __future__ import annotations

import json
import os
import re
from datetime import date
from typing import Optional

from .config import get_logger
from .utils import generate_nanoid

logger = get_logger(__name__)

SOURCE_KINDS = frozenset({"ester", "ada", "upload", "migration", "manual"})
# Vabatekstiväljad, mida vorm ja ettepanek muudavad (holder eraldi: kohustuslik).
TEXT_FIELDS = ("shelfmark", "url", "condition", "binding", "provenance", "notes")
EDITABLE_FIELDS = ("holder", *TEXT_FIELDS, "convolute")
# Salvestatud võtmete järjekord — sama sisu annab sama JSON-i (ADR 0012).
_KEY_ORDER = ("id", "holder", "shelfmark", "url", "text_witness", "pages", "condition",
              "binding", "provenance", "convolute", "notes", "source", "needs_review")
UNKNOWN_FIELD = "exemplar_unknown_pages"
ORIGIN_SAME = "same"
ORIGIN_UNKNOWN = "unknown"
_MAX_TEXT = 4000


def is_manuscript(meta: dict) -> bool:
    """Käsikirjal on üks eksemplar — dokument ise (ADR 0076 täiendus 2026-11-01).
    Ärakiri või teine redaktsioon on eraldi teos variandiseosega (ADR 0075)."""
    from .prosopography.work_relations_ops import MANUSCRIPT_TYPE, _type_id
    return _type_id(meta or {}) == MANUSCRIPT_TYPE


class ExemplarError(ValueError):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def _text(value, field: str) -> Optional[str]:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ExemplarError(f"Väli {field} peab olema tekst")
    value = value.strip()
    if len(value) > _MAX_TEXT:
        raise ExemplarError(f"Väli {field} on liiga pikk")
    return value or None


def _count(value, field: str, minimum: int) -> Optional[int]:
    if value in (None, ""):
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum:
        raise ExemplarError(f"Väli {field} peab olema täisarv ≥ {minimum}")
    return value


def clean_convolute(value) -> Optional[dict]:
    """Konvoluudi väli (ADR 0076 p 6); tühi → None."""
    if value in (None, "", {}):
        return None
    if not isinstance(value, dict):
        raise ExemplarError("Konvoluut peab olema objekt")
    reference = _text(value.get("reference"), "convolute.reference")
    if not reference:
        raise ExemplarError("Konvoluudil peab olema kohaviit")
    position = _count(value.get("position"), "convolute.position", 0)
    total = _count(value.get("total"), "convolute.total", 1)
    if position is not None and total is not None and position >= total:
        # 0 = põhiteos, N = N. kaasköide → suurim koht on total - 1.
        raise ExemplarError("Konvoluudi koht peab olema väiksem kui trükiste arv")
    out = {"reference": reference}
    if position is not None:
        out["position"] = position
    if total is not None:
        out["total"] = total
    contents = _text(value.get("contents"), "convolute.contents")
    if contents:
        out["contents"] = contents
    return out


def clean_source(value) -> Optional[dict]:
    if value in (None, {}):
        return None
    if not isinstance(value, dict) or value.get("kind") not in SOURCE_KINDS:
        raise ExemplarError("Vigane allikas")
    out = {"kind": value["kind"]}
    for f in ("ref", "at"):
        v = _text(value.get(f), f"source.{f}")
        if v:
            out[f] = v
    return out


def normalize_exemplar(x) -> dict:
    """Üks kirje salvestatavaks: tundmatud võtmed välja, väärtuseta võtmed välja."""
    if not isinstance(x, dict):
        raise ExemplarError("Eksemplar peab olema objekt")
    ex_id = x.get("id")
    if not isinstance(ex_id, str) or not ex_id:
        raise ExemplarError("Eksemplari id puudub")
    holder = _text(x.get("holder"), "holder")
    if not holder:
        raise ExemplarError("Eksemplaril peab olema hoidja")
    out: dict = {"id": ex_id, "holder": holder}
    for f in TEXT_FIELDS:
        v = _text(x.get(f), f)
        if v:
            out[f] = v
    if x.get("text_witness") is True:
        out["text_witness"] = True
    pages = x.get("pages") or []
    if not isinstance(pages, list) or any(not isinstance(s, str) or not s for s in pages):
        raise ExemplarError("Vigane lehtede loend")
    if pages:
        out["pages"] = list(dict.fromkeys(pages))
    convolute = clean_convolute(x.get("convolute"))
    if convolute:
        out["convolute"] = convolute
    source = clean_source(x.get("source"))
    if source:
        out["source"] = source
    if x.get("needs_review") is True:
        out["needs_review"] = True
    return {k: out[k] for k in _KEY_ORDER if k in out}


def validate_exemplars(exemplars, unknown_pages, stems: Optional[list] = None) -> tuple[list, list]:
    """Kogu loend: id-d unikaalsed, kuni üks tunnistaja (ilma `pages`-ita), leht
    ainult ühes kohas. `stems` antud → lehed peavad teoses olemas olema."""
    out = [normalize_exemplar(x) for x in exemplars or []]
    ids = [x["id"] for x in out]
    if len(ids) != len(set(ids)):
        raise ExemplarError("Eksemplari id kordub")
    witnesses = [x for x in out if x.get("text_witness")]
    if len(witnesses) > 1:
        raise ExemplarError("Teosel saab olla ainult üks tekstitunnistaja")
    if witnesses and witnesses[0].get("pages"):
        raise ExemplarError("Tekstitunnistajal ei ole erandlehti")
    if not isinstance(unknown_pages, (list, type(None))):
        raise ExemplarError("Vigane teadmata lehtede loend")
    unknown = list(dict.fromkeys(s for s in unknown_pages or [] if isinstance(s, str) and s))
    seen: set = set()
    for s in [s for x in out for s in x.get("pages") or []] + unknown:
        if s in seen:
            raise ExemplarError(f"Leht {s} on mitme eksemplari juures")
        seen.add(s)
    if stems is not None:
        missing = sorted(seen - set(stems))
        if missing:
            raise ExemplarError(f"Lehti pole teoses: {', '.join(missing[:5])}")
        order = {s: i for i, s in enumerate(stems)}
        for x in out:
            if x.get("pages"):
                x["pages"] = sorted(x["pages"], key=order.__getitem__)
        unknown = sorted(unknown, key=order.__getitem__)
    return out, unknown


def drop_empty_exemplar_fields(meta: dict) -> None:
    """„Eksemplare pole" = võtme puudumine (nagu `drop_empty_relations`, ADR 0075)."""
    if not meta.get("exemplars"):
        meta.pop("exemplars", None)
    if not meta.get(UNKNOWN_FIELD):
        meta.pop(UNKNOWN_FIELD, None)


# ── Tuletused ────────────────────────────────────────────────────────────────

def derive_archive_refs(meta: dict) -> list[dict]:
    """`archive_refs` lugemiskuju eksemplaridest (ADR 0076 p 1) — ÜKS tuletaja.

    Vana `archive_refs` võtit varuvariandina EI loeta: muidu oleks kaks tõeallikat.
    """
    out = []
    for x in (meta or {}).get("exemplars") or []:
        if not isinstance(x, dict) or not x.get("holder"):
            continue
        ref = {"archive_id": x["holder"], "reference": x.get("shelfmark") or ""}
        if x.get("url"):
            ref["url"] = x["url"]
        out.append(ref)
    return out


_KONVOLUUT_RE = re.compile(r"\(?\s*konvoluut\s*\)?")
_PUNKT_RE = re.compile(r"\s*([.\-])\s*")
_SULU_ROOMA_RE = re.compile(r"\s*\(\s*([ivx]+)\s*\)")
_LOPU_ROOMA_RE = re.compile(r"\s+([ivx]+)$")


def convolute_key(holder: str, reference: str) -> str:
    """Konvoluudi rühma võti (ADR 0076 p 6) — ÜKS reegel serverile ja agendile.

    Rakendub `convolute.reference`-ile, kust liikme koht on juba eraldatud — mitte
    toorele kohaviidale, sest seal võivad sulud tähendada liikme numbrit
    (`R Bergm. 357(8)`). Märge „konvoluut" välja, tähesuurus ja tühikud (ka punkti
    ja sidekriipsu ümber) ühtlustatud, köite rooma number jääb kujul „(i)".
    """
    s = (reference or "").casefold()
    s = _KONVOLUUT_RE.sub(" ", s)
    s = _PUNKT_RE.sub(r"\1", s)
    s = _SULU_ROOMA_RE.sub(r" (\1)", s)
    s = re.sub(r"\s+", " ", s).strip()
    s = _LOPU_ROOMA_RE.sub(r" (\1)", s)
    return f"{(holder or '').strip().casefold()}:{s}"


def convolute_keys(meta: dict) -> list[str]:
    """Teose eksemplaride konvoluudivõtmed (`convolute_index.json` jaoks)."""
    keys = []
    for x in (meta or {}).get("exemplars") or []:
        c = x.get("convolute") if isinstance(x, dict) else None
        if isinstance(c, dict) and c.get("reference") and x.get("holder"):
            key = convolute_key(x["holder"], c["reference"])
            if key not in keys:
                keys.append(key)
    return keys


def page_origins(meta: dict, stems: list[str]) -> dict:
    """Tüvi → eksemplari id või None (teadmata), ADR 0076 p 4."""
    exemplars = (meta or {}).get("exemplars") or []
    by_page = {s: x["id"] for x in exemplars for s in x.get("pages") or []}
    unknown = set((meta or {}).get(UNKNOWN_FIELD) or [])
    witness = next((x["id"] for x in exemplars if x.get("text_witness")), None)
    return {s: by_page.get(s) or (None if s in unknown else witness) for s in stems}


def exemplars_from_archive_refs(refs, kind: str, ref: Optional[str] = None,
                                existing_ids: Optional[set] = None,
                                manuscript: bool = False) -> list[dict]:
    """Vana kuju → eksemplarid: teose loomisel ja migratsioonil (ADR 0076 p 5, 8).

    Automaatselt loodud kirje saab `needs_review` (üks viide ≠ üks füüsiline eksemplar)
    ja tekstitunnistajat EI märgita. `ref` puudub → algne kirje stringina.
    Käsikirja ainus viide ON eksemplar — lippu ei panda. Mitu viidet käsikirjal on
    vastuolu, mille lahendab inimene: kõik saavad lipu, midagi ei visata ära.
    """
    ids = set(existing_ids or ())
    usable = [r for r in refs or [] if isinstance(r, dict) and str(r.get("archive_id") or "").strip()]
    flag = not (manuscript and len(usable) + len(ids) == 1)
    out = []
    for r in refs or []:
        if not isinstance(r, dict):
            continue
        holder = str(r.get("archive_id") or "").strip()
        shelfmark = str(r.get("reference") or "").strip()
        if not holder:
            if shelfmark:
                logger.warning(f"Arhiiviviide ilma hoidjata jäeti välja: {shelfmark!r}")
            continue
        ex_id = _new_id(ids)
        ids.add(ex_id)
        x = {"id": ex_id, "holder": holder, "shelfmark": shelfmark,
             "url": str(r.get("url") or "").strip(),
             "source": {"kind": kind, "ref": ref or f"{holder}: {shelfmark}".rstrip(": "),
                        "at": date.today().isoformat()},
             "needs_review": flag}
        out.append(normalize_exemplar(x))
    return out


def _new_id(existing: set) -> str:
    ex_id = generate_nanoid(6)
    while ex_id in existing:
        ex_id = generate_nanoid(6)
    return ex_id


# ── Lehetoimingud ────────────────────────────────────────────────────────────

def _flag_emptied(before: list, after: list) -> list:
    """`pages` kadus täielikult → kirje vajab ülevaatust (seost ei kustutata)."""
    had = {x["id"] for x in before if x.get("pages")}
    for x in after:
        if x["id"] in had and not x.get("pages"):
            x.pop("pages", None)
            x["needs_review"] = True
    return after


def remap_exemplars(exemplars: list, unknown: list, stems: list,
                    renamed: Optional[dict] = None) -> tuple[list, list, bool]:
    """Lehetoimingu järel: poolitatud tüvi → mõlemad pooled (pärivad päritolu),
    kustutatud tüvi välja, tühjaks jäänud `pages` → `needs_review`."""
    live = set(stems)
    order = {s: i for i, s in enumerate(stems)}

    def remap(pages):
        out: list = []
        for s in pages or []:
            out.extend((renamed or {}).get(s, [s]))
        return sorted(dict.fromkeys(s for s in out if s in live), key=order.__getitem__)

    after = []
    for x in exemplars:
        nx = dict(x)
        pages = remap(x.get("pages"))
        if pages:
            nx["pages"] = pages
        else:
            nx.pop("pages", None)
        after.append(nx)
    after = _flag_emptied(exemplars, after)
    new_unknown = remap(unknown)
    return after, new_unknown, (after != exemplars or new_unknown != list(unknown or []))


def make_witness(exemplars: list, ex_id: Optional[str]) -> list:
    """Uus tunnistaja kaotab oma `pages`-i, eelmine kaotab märke (ADR 0076 p 3).
    `ex_id=None` → tunnistajat pole."""
    out = []
    for x in exemplars:
        nx = dict(x)
        if x["id"] == ex_id:
            nx["text_witness"] = True
            nx.pop("pages", None)
        else:
            nx.pop("text_witness", None)
        out.append(nx)
    return out


def assign_origin(exemplars: list, unknown: list, stems: list[str], origin: str) -> tuple[list, list]:
    """Märgib lehtede päritolu: `same` → muutust pole; `unknown` → teadmata;
    eksemplari id → selle eksemplari leht (tunnistajal: lihtsalt erandist välja)."""
    if origin == ORIGIN_SAME or not stems:
        return exemplars, unknown
    target = set(stems)
    by_id = {x["id"]: x for x in exemplars}
    if origin != ORIGIN_UNKNOWN and origin not in by_id:
        raise ExemplarError(f"Eksemplari pole: {origin}", 404)
    after = []
    for x in exemplars:
        nx = dict(x)
        pages = [s for s in x.get("pages") or [] if s not in target]
        if x["id"] == origin and not x.get("text_witness"):
            pages += list(stems)
        if pages:
            nx["pages"] = pages
        else:
            nx.pop("pages", None)
        after.append(nx)
    new_unknown = [s for s in unknown or [] if s not in target]
    if origin == ORIGIN_UNKNOWN:
        new_unknown += list(stems)
    return _flag_emptied(exemplars, after), new_unknown


def reset_origins(exemplars: list) -> list:
    """Kogu lehestiku asendus (ADR 0076 p 3): kogu päritolu nullitakse ja iga
    mõjutatud eksemplar läheb ülevaatusele."""
    out = []
    for x in exemplars:
        nx = dict(x)
        if nx.pop("text_witness", None) or nx.pop("pages", None):
            nx["needs_review"] = True
        out.append(nx)
    return out


def check_origin(meta: dict, origin: Optional[str]) -> Optional[str]:
    """Uue pildi kirjutaja (asendus, lisamine) päritolu kontroll ENNE kirjutamist.

    Eksemplarideta teosel pole küsimust (None). Eksemplaridega teosel on päritolu
    kohustuslik ja vaikimisi valikut ei ole (ADR 0076 p 4).
    """
    exemplars = (meta or {}).get("exemplars") or []
    if not exemplars:
        return None
    if not origin:
        raise ExemplarError("Teosel on eksemplarid: vali uue pildi päritolu", 400)
    if origin not in (ORIGIN_SAME, ORIGIN_UNKNOWN) and origin not in {x.get("id") for x in exemplars}:
        raise ExemplarError(f"Eksemplari pole: {origin}", 400)
    return origin


# ── Kirjutamine ──────────────────────────────────────────────────────────────

def page_stems(work_dir: str) -> list[str]:
    from .work_parts import page_stems as _stems
    return _stems(work_dir)


def _bulk(work_dir: str, username: str, message: str, mutate, background_tasks=None):
    """Loe–muuda–kirjuta `metadata_lock`-i all. `mutate(exemplars, unknown, stems)`
    tagastab (eksemplarid, teadmata, tulemus). Kutsuja hoiab `work_lock`-i."""
    from .metadata_ops import bulk_update_works
    box: dict = {}
    stems = page_stems(work_dir)

    def transform(meta: dict) -> dict:
        try:
            # Vananenud tüved parandatakse enne muutust (nagu osadel).
            current, unknown, _ = remap_exemplars(list(meta.get("exemplars") or []),
                                                  list(meta.get(UNKNOWN_FIELD) or []), stems)
            exemplars, unknown, result = mutate(current, unknown, stems)
            # Ainult kasv on keelatud: varasem vastuolu (nt tüüp muudeti hiljem
            # käsikirjaks) ei tohi lukustada muutmist ega kustutamist.
            if is_manuscript(meta) and len(exemplars) > max(1, len(current)):
                raise ExemplarError("Käsikirjal on üks eksemplar. Ärakiri või teine redaktsioon "
                                    "on eraldi teos, seo see variandiseosega.")
            exemplars, unknown = validate_exemplars(exemplars, unknown, stems)
            box["result"] = result
            return {"exemplars": exemplars, UNKNOWN_FIELD: unknown}
        except ExemplarError as e:
            box["error"] = e
            raise

    res = bulk_update_works([(os.path.join(work_dir, "_metadata.json"), transform)], username,
                            message, background_tasks=background_tasks)
    if "error" in box:
        raise box["error"]
    if res.get("failed"):
        raise ExemplarError("Teose metaandmeid ei saanud kirjutada", 500)
    return box.get("result")


def _write(work_dir: str, username: str, message: str, mutate, background_tasks=None):
    # Tüvede lugemine ja kirjutus teose luku all: sama järjekord mis lehetoimingutel
    # (work_lock → metadata_lock), muidu võib samaaegne poolitus tüve vahepeal asendada.
    from . import admin_page_ops
    with admin_page_ops.work_lock(os.path.basename(work_dir), work_dir):
        return _bulk(work_dir, username, message, mutate, background_tasks)


def _find(exemplars: list, ex_id: str) -> int:
    for i, x in enumerate(exemplars):
        if x.get("id") == ex_id:
            return i
    raise ExemplarError(f"Eksemplari pole: {ex_id}", 404)


def _check_holder(holder) -> None:
    """Uus/muudetud hoidja peab olema registris (archives.json)."""
    from .config import ARCHIVES_FILE
    try:
        with open(ARCHIVES_FILE, "r", encoding="utf-8") as f:
            archives = json.load(f) or {}
    except (OSError, ValueError):
        raise ExemplarError("Hoidjate registrit ei saa lugeda", 503)
    if holder not in archives:
        raise ExemplarError(f"Tundmatu hoidja: {holder}")


def _apply_fields(x: dict, data: dict) -> dict:
    nx = dict(x)
    for f in EDITABLE_FIELDS:
        if f in data:
            nx[f] = data[f]
    if "holder" in data and data["holder"] != x.get("holder"):
        _check_holder(data["holder"])
    # Lipu võtab maha ainult selgesõnaline väärtus (ADR 0076 p 2).
    if data.get("needs_review") is False:
        nx.pop("needs_review", None)
    elif data.get("needs_review") is True:
        nx["needs_review"] = True
    return nx


def _witness_change(exemplars: list, ex_id: str, data: dict) -> list:
    if data.get("text_witness") is True:
        return make_witness(exemplars, ex_id)
    if data.get("text_witness") is False and exemplars[_find(exemplars, ex_id)].get("text_witness"):
        return make_witness(exemplars, None)
    return exemplars


def _read(work_dir: str) -> dict:
    with open(os.path.join(work_dir, "_metadata.json"), "r", encoding="utf-8") as f:
        return json.load(f) or {}


def _read_exemplar(work_dir: str, ex_id: str) -> dict:
    exemplars = _read(work_dir).get("exemplars") or []
    return exemplars[_find(exemplars, ex_id)]


def create_exemplar(work_dir: str, data: dict, username: str, background_tasks=None) -> dict:
    data = data or {}
    _check_holder(data.get("holder"))

    def mutate(exemplars, unknown, _stems):
        x = _apply_fields({"id": _new_id({e["id"] for e in exemplars})}, data)
        # Käsitsi loodud kirje: allikas `manual`, lipuga ainult selgesõnalisel soovil.
        x["source"] = {"kind": "manual", "at": date.today().isoformat()}
        exemplars = exemplars + [x]
        return _witness_change(exemplars, x["id"], data), unknown, x["id"]

    ex_id = _write(work_dir, username, f"Eksemplar: lisa ({data.get('holder')})", mutate, background_tasks)
    return _read_exemplar(work_dir, ex_id)


def update_exemplar(work_dir: str, ex_id: str, data: dict, username: str, background_tasks=None) -> dict:
    data = data or {}

    def mutate(exemplars, unknown, _stems):
        i = _find(exemplars, ex_id)
        exemplars = list(exemplars)
        exemplars[i] = _apply_fields(exemplars[i], data)
        return _witness_change(exemplars, ex_id, data), unknown, ex_id

    _write(work_dir, username, f"Eksemplar: muuda [{ex_id}]", mutate, background_tasks)
    return _read_exemplar(work_dir, ex_id)


def delete_exemplar(work_dir: str, ex_id: str, username: str, background_tasks=None) -> None:
    def mutate(exemplars, unknown, _stems):
        _find(exemplars, ex_id)
        return [x for x in exemplars if x["id"] != ex_id], unknown, None

    _write(work_dir, username, f"Eksemplar: kustuta [{ex_id}]", mutate, background_tasks)


def reorder_exemplars(work_dir: str, ids: list, username: str, background_tasks=None) -> list:
    def mutate(exemplars, unknown, _stems):
        if not isinstance(ids, list) or sorted(ids) != sorted(x["id"] for x in exemplars):
            raise ExemplarError("Järjestus peab sisaldama kõiki eksemplare täpselt üks kord")
        by_id = {x["id"]: x for x in exemplars}
        return [by_id[i] for i in ids], unknown, None

    _write(work_dir, username, "Eksemplarid: järjestus", mutate, background_tasks)
    return _read(work_dir).get("exemplars") or []


def set_page_origin(work_dir: str, stems: list, origin: str, username: str,
                    background_tasks=None, *, locked: bool = False) -> dict:
    """Lehtede päritolu (ADR 0076 p 4). `locked=True`: kutsuja hoiab juba
    `work_lock`-i (pildi asendus, lehtede lisamine)."""
    if not isinstance(stems, list) or any(not isinstance(s, str) for s in stems):
        raise ExemplarError("Vigane lehtede loend")
    if not isinstance(origin, str) or not origin:
        raise ExemplarError("Päritolu puudub")

    def mutate(exemplars, unknown, all_stems):
        missing = [s for s in stems if s not in set(all_stems)]
        if missing:
            raise ExemplarError(f"Lehti pole teoses: {', '.join(missing[:5])}")
        exemplars, unknown = assign_origin(exemplars, unknown, stems, origin)
        return exemplars, unknown, None

    message = f"Eksemplarid: lehtede päritolu → {origin} ({len(stems)} lehte)"
    if locked:
        _bulk(work_dir, username, message, mutate, background_tasks)
    else:
        _write(work_dir, username, message, mutate, background_tasks)
    meta = _read(work_dir)
    return {"exemplars": meta.get("exemplars") or [], "unknown_pages": meta.get(UNKNOWN_FIELD) or []}


def reset_page_origins(work_dir: str, username: str) -> None:
    """Kogu lehestiku asendus (`replace_work_content`, kutsuja hoiab `work_lock`-i)."""
    from .metadata_ops import bulk_update_works
    meta_path = os.path.join(work_dir, "_metadata.json")
    try:
        meta = _read(work_dir)
    except FileNotFoundError:
        return
    if not meta.get("exemplars") and not meta.get(UNKNOWN_FIELD):
        return

    def transform(meta: dict) -> dict:
        return {"exemplars": reset_origins(list(meta.get("exemplars") or [])), UNKNOWN_FIELD: []}

    bulk_update_works([(meta_path, transform)], username,
                      "Eksemplarid: lehestik asendati, päritolu nullitud")


def sync_work_exemplars(work_dir: str, work_id: Optional[str] = None, renamed: Optional[dict] = None) -> None:
    """Kutsutakse `refresh_work_mentions`-i seest — kõik lehetoimingud katavad
    eksemplaride lehed (ADR 0076 p 4). Kutsuja võib hoida `work_lock`-i."""
    meta_path = os.path.join(work_dir, "_metadata.json")
    try:
        meta = _read(work_dir)
    except FileNotFoundError:
        return
    if not meta.get("exemplars") and not meta.get(UNKNOWN_FIELD):
        return
    from .metadata_ops import bulk_update_works
    stems = page_stems(work_dir)

    def transform(meta: dict) -> dict:
        exemplars, unknown, changed = remap_exemplars(list(meta.get("exemplars") or []),
                                                      list(meta.get(UNKNOWN_FIELD) or []), stems, renamed)
        return {"exemplars": exemplars, UNKNOWN_FIELD: unknown} if changed else {}

    bulk_update_works([(meta_path, transform)], "Automaatne", "Eksemplarid: lehetoimingu järel ühtlustatud")


# ── Lugemine ─────────────────────────────────────────────────────────────────

def _title_fields(meta: dict) -> dict:
    return {k: meta.get(k) for k in ("title", "title_en", "title_original", "title_devised",
                                     "year", "year_display", "dating")}


def resolve_convolutes(work_id: str, meta: dict, user: Optional[dict]) -> list[dict]:
    """Iga konvoluudis oleva eksemplari kohta plokk koos VUTT-is olevate kaaslastega.

    Kaaslased tulevad `convolute_index.json`-ist (read-model, ADR 0007); pealkiri
    loetakse kettalt. Piiratud kaaslane on `readable: False` (nagu seosed,
    ADR 0075). Vastus sõltub kasutajast → ei lähe `server/cache.py`-sse.
    """
    from .access_ops import can_read_work
    from .prosopography.work_relations_ops import load_convolute_index
    from .work_sets_access import load_work_metadata_by_id

    blocks = []
    keyed = [(x, convolute_key(x["holder"], x["convolute"]["reference"]))
             for x in meta.get("exemplars") or [] if (x.get("convolute") or {}).get("reference")]
    if not keyed:
        return blocks
    index = load_convolute_index()
    for x, key in keyed:
        members = []
        for other_id in index.get(key) or []:
            other = meta if other_id == work_id else load_work_metadata_by_id(other_id)
            if other is None:
                continue
            for ox in other.get("exemplars") or []:
                c = ox.get("convolute") or {}
                if not c.get("reference") or convolute_key(ox.get("holder"), c["reference"]) != key:
                    continue
                members.append({
                    "work_id": other_id,
                    "exemplar_id": ox["id"],
                    "position": c.get("position"),
                    **_title_fields(other),
                    "readable": other_id == work_id or can_read_work(other, user),
                    "current": other_id == work_id and ox["id"] == x["id"],
                })
        members.sort(key=lambda m: (m["position"] is None, m["position"] or 0, m.get("year") or 0))
        c = x["convolute"]
        blocks.append({"exemplar_id": x["id"], "key": key, "holder": x["holder"],
                       "reference": c["reference"], "total": c.get("total"),
                       "contents": c.get("contents"), "members": members})
    return blocks


def check_unmigrated() -> list[str]:
    """Stardikontroll (ADR 0076 p 8): `archive_refs` kettal = migreerimata teos.

    Uus server seda välja ei loe, nii et viited oleksid vaikselt kadunud. Leid läheb
    admini vealogisse; lugeja vana välja varuvariandina ei kasuta.
    """
    from .config import BASE_DIR
    found = []
    if not os.path.isdir(BASE_DIR):
        return found
    for entry in os.scandir(BASE_DIR):
        meta_path = os.path.join(entry.path, "_metadata.json")
        if not entry.is_dir() or not os.path.exists(meta_path):
            continue
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                if "archive_refs" in (json.load(f) or {}):
                    found.append(entry.name)
        except (OSError, ValueError):
            continue
    if found:
        message = (f"{len(found)} teosel on migreerimata archive_refs (ADR 0076): "
                   f"{', '.join(sorted(found)[:10])}")
        logger.error(message)
        from .client_errors import record_server_error
        record_server_error("server:thread", RuntimeError(message), thread="exemplars-check")
    return found
