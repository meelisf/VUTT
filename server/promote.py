"""Transkriptsiooni aluse vahetus teise eksemplari vastu (ADR 0089 p 6, PR 2).

Eelvaade (lehtede sõrmejäljed, päritolu, toimetatud lehed, salvestatavus), vahetuse algus
(asendusrežiimis üleslaadimine eksemplari piltidest) ja lõpetamine asenduse järelsammuna.
Disain: `docs/superpowers/specs/2026-11-25-transkriptsiooni-aluse-vahetus-design.md`,
plaan: `docs/superpowers/plans/2026-11-26-aluse-vahetus.md`.
"""
import hashlib
import json
import os
from typing import Optional

from . import exemplar_images, work_exemplars as we
from .config import get_logger
from .meili_doc import enumerate_page_images
from .page_merge import _kanooniline, read_page_view

logger = get_logger(__name__)


class PromoteError(Exception):
    def __init__(self, status: int, code: str, detail=None):
        super().__init__(f"{code}: {detail}" if detail else code)
        self.status = status
        self.code = code
        self.detail = detail


def _view(work_dir: str, stem: str) -> dict:
    return read_page_view(os.path.join(work_dir, f"{stem}.txt"), os.path.join(work_dir, f"{stem}.json"))


def page_fingerprint(work_dir: str, stem: str) -> str:
    """Lehe kogu toimetatava seisu räsi (tekst + seisund, märgendid, kommentaarid,
    annotatsioonid) — sama projektsioon mis `meili_doc`/`/save` (`read_page_view`)."""
    return hashlib.sha256(_kanooniline(_view(work_dir, stem)).encode("utf-8")).hexdigest()


def is_edited(view: dict) -> bool:
    """Toimetatud = seisund ≠ Toores või on märgendeid/kommentaare/annotatsioone."""
    return (view.get("status") or "Toores") != "Toores" or bool(
        view.get("page_tags") or view.get("comments") or view.get("text_annotations"))


def _meta(work_dir: str) -> dict:
    with open(os.path.join(work_dir, "_metadata.json"), "r", encoding="utf-8") as f:
        return json.load(f) or {}


def page_list(work_dir: str) -> list[dict]:
    """Teose lehed järjekorras: tüvi, number, pildifail (sama reegel mis leheloend)."""
    return [{"stem": os.path.splitext(f)[0], "page": i + 1, "image": f}
            for i, f in enumerate(enumerate_page_images(work_dir))]


def preview(work_dir: str, eid: str) -> dict:
    """Vahetuse eelvaade. Viskab `PromoteError`, kui vahetust ei saa alustada."""
    from .exemplar_image_files import storable_reason
    meta = _meta(work_dir)
    exemplars = meta.get("exemplars") or []
    target = next((x for x in exemplars if x.get("id") == eid), None)
    if target is None:
        raise PromoteError(404, "no_exemplar")
    if target.get("text_witness"):
        raise PromoteError(409, "is_witness")
    images = exemplar_images.read_manifest(work_dir, eid).get("images") or []
    if not images:
        raise PromoteError(409, "no_images")
    lehed = page_list(work_dir)
    origins = we.page_origins(meta, [l["stem"] for l in lehed])
    pages, edited, unknown, unstorable = [], {}, [], []
    for l in lehed:
        view = _view(work_dir, l["stem"])
        fp = hashlib.sha256(_kanooniline(view).encode("utf-8")).hexdigest()
        ed = is_edited(view)
        org = origins.get(l["stem"])
        pages.append({"stem": l["stem"], "page": l["page"], "status": view.get("status") or "Toores",
                      "origin": org, "edited": ed, "fingerprint": fp})
        if ed:
            edited[l["stem"]] = fp
        if org is None:
            unknown.append(l["stem"])
        reason = storable_reason(os.path.join(work_dir, l["image"]))
        if reason:
            unstorable.append({"stem": l["stem"], "reason": reason})
    witness = next((x["id"] for x in exemplars if x.get("text_witness")), None)
    return {"pages": pages, "edited": edited, "unknown": unknown, "unstorable": unstorable,
            "images": len(images), "witness": witness, "parts": len(meta.get("parts") or [])}


# ── Vahetuse algus ────────────────────────────────────────────────────────────

def _staging_root() -> str:
    from . import upload_ops
    return os.path.join(upload_ops.UPLOADS_DIR, ".staging")


def cleanup_staging() -> None:
    """Serveri käivitusel: pooleli jäänud (avaldamata) vahetuse üleslaadimised ära."""
    import shutil
    root = _staging_root()
    if not os.path.isdir(root):
        return
    for name in os.listdir(root):
        try:
            shutil.rmtree(os.path.join(root, name))
            logger.warning("Aluse vahetus: pooleli üleslaadimine koristatud (%s)", name)
        except OSError:
            logger.exception("Aluse vahetus: pooleli üleslaadimise koristus ebaõnnestus (%s)", name)


def active_replace_upload(work_id: str) -> Optional[str]:
    """Pooleli asendusega üleslaadimine sellele teosele (mitte imporditud ega veaga)."""
    from .upload import state as upload_state
    for s in upload_state.list_upload_states():
        if s.get("replace_work_id") == work_id and s.get("status") not in ("imported", "error"):
            return s.get("id")
    return None


def _source_file(work_dir: str, eid: str, img: dict) -> str:
    """Lähtefail, kui see on kohapeal (`{id}.orig.{ext}`); muidu vaatamiskuju `{id}.jpg`
    (ADA impordil PDF-i ei hoita — `original_path` annab URL-i)."""
    d = exemplar_images.exemplar_dir(work_dir, eid)
    orig = img.get("original")
    if orig and os.path.isfile(os.path.join(d, orig)):
        return os.path.join(d, orig)
    return os.path.join(d, f"{img['id']}.jpg")


def start(work_dir: str, work_id: str, eid: str, unknown_target: Optional[str],
          confirmed_edited: dict, username: str) -> str:
    """Asendusrežiimis üleslaadimine eksemplari piltidest. Teost EI muudeta.

    Kaust ehitatakse `UPLOADS_DIR/.staging/{id}` alla ja avaldatakse ÜHE ümbernimetusega:
    pooleli üleslaadimine ei ole kunagi loendis ega avatav (käivitus koristab `.staging`-u).
    """
    import shutil
    import tempfile
    from datetime import datetime, timezone
    from . import upload_ops, replace_marker
    from .admin_page_ops import work_lock
    from .upload import prepress_plan

    slug = os.path.basename(os.path.normpath(work_dir))
    if replace_marker.read_marker(slug):
        raise PromoteError(409, "replace_in_progress")
    with work_lock(slug, work_dir):
        pv = preview(work_dir, eid)
        if pv["unstorable"]:
            raise PromoteError(400, "old_page_unstorable", pv["unstorable"])
        if pv["unknown"]:
            exemplars = {x["id"] for x in (_meta(work_dir).get("exemplars") or [])}
            if not unknown_target or unknown_target == eid or unknown_target not in exemplars:
                raise PromoteError(400, "unknown_target_required", pv["unknown"])
        if (confirmed_edited or {}) != pv["edited"]:
            raise PromoteError(409, "edited_pages_changed", pv)
        if replace_marker.read_marker(slug) or active_replace_upload(work_id):
            raise PromoteError(409, "replace_in_progress")

        meta = _meta(work_dir)
        target = next(x for x in meta.get("exemplars") or [] if x.get("id") == eid)
        images = exemplar_images.read_manifest(work_dir, eid)
        upload_id, state = upload_ops.build_upload_state({
            "title": meta.get("title") or "", "year": meta.get("year") or "",
            "slug": slug, "type": meta.get("type"), "replace_work_id": work_id,
        }, username)
        root = _staging_root()
        staging = os.path.join(root, upload_id)
        try:
            os.makedirs(os.path.join(staging, "thumbs"))
            src_dir = os.path.join(staging, "source")
            source_images = []
            for n, img in enumerate(images.get("images") or [], 1):
                # `write_source_image` liigutab/kustutab sisendi → AJUTINE koopia.
                fd, tmp = tempfile.mkstemp(dir=staging, prefix="src-")
                os.close(fd)
                shutil.copy2(_source_file(work_dir, eid, img), tmp)
                upload_ops.write_source_image(src_dir, tmp, n)
                source_images.append({"page": n, "image_id": img["id"]})
            count = len(source_images)
            origins = {p["stem"]: (p["origin"] or unknown_target) for p in pv["pages"]}
            state.update({
                "status": "awaiting_split",
                "expected_pages": count,
                "prepress": prepress_plan.default_plan(count),
                "promote": {
                    "exemplar_id": eid, "holder": target.get("holder"),
                    "shelfmark": target.get("shelfmark"),
                    "source_images": source_images,
                    "manifest_revision": images.get("revision"),
                    "origins": origins, "unknown_target": unknown_target,
                    "confirmed_edited": dict(confirmed_edited or {}),
                    "requested_by": username,
                    "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                },
            })
            from .utils import atomic_write_json
            atomic_write_json(os.path.join(staging, "state.json"), state)
            os.rename(staging, os.path.join(upload_ops.UPLOADS_DIR, upload_id))
        except BaseException:
            shutil.rmtree(staging, ignore_errors=True)
            raise
    logger.info("Aluse vahetus alustatud: %s → teos %s, eksemplar %s", upload_id, work_id, eid)
    return upload_id


# ── Asenduse konksud ja lõpetamine ─────────────────────────────────────────────

def recheck_locked(work_dir: str, pr: dict) -> None:
    """Lõppkontroll asenduses (vanade lehtede lukud käes, ENNE ühtki muutust): lähteeksemplar ja
    kõik sihid olemas, toimetatud lehed ja päritolu nagu kinnitatud, vanad pildid salvestatavad."""
    exemplars = {x.get("id") for x in (_meta(work_dir).get("exemplars") or [])}
    targets = {t for t in (pr.get("origins") or {}).values()}
    missing = {"missing": sorted(t or "?" for t in targets - exemplars)}
    if pr.get("exemplar_id") not in exemplars:
        # Lähteeksemplar ise kadunud: uut kinnitust ei saa anda (eelvaade puudub).
        raise PromoteError(409, "target_missing", missing)
    pv = preview(work_dir, pr["exemplar_id"])
    if None in targets or not targets <= exemplars:
        # Värske eelvaade kaasa: viisard pakub sama üleslaadimise juures uue sihi valikut
        # (PR #883 ülevaatus) — ilma selleta jäi ainus väljapääs üleslaadimise tühistus.
        raise PromoteError(409, "target_missing", {**pv, **missing})
    if pv["unstorable"]:
        raise PromoteError(409, "old_page_unstorable", pv)
    current = {p["stem"]: (p["origin"] or pr.get("unknown_target")) for p in pv["pages"]}
    if current != (pr.get("origins") or {}):
        raise PromoteError(409, "origins_changed", pv)
    if pv["edited"] != (pr.get("confirmed_edited") or {}):
        raise PromoteError(409, "edited_pages_changed", pv)


def progress_extras(work_dir: str, state: dict, importable: list, upload_id: str) -> dict:
    """Taasteinfo lisad (märki): kogu lõpetamiseks vajalik — üleslaadimise kaust võib kaduda."""
    pr = state.get("promote") or {}
    committed = sorted(int(f["page"]) for f in importable)
    page_map = (state.get("prepress") or {}).get("page_map") or {}
    remove = []
    for si in pr.get("source_images") or []:
        outs = page_map.get(str(si["page"])) or []
        if outs and set(int(o) for o in outs) <= set(committed):
            remove.append(si["image_id"])
    return {
        "promote": {"exemplar_id": pr.get("exemplar_id"), "origins": pr.get("origins") or {},
                    "upload_id": upload_id},
        "committed_outputs": committed,
        "remove_source_ids": remove,
        # Eelvaate leheloendist (`_thumb_*` ei ole lehed; kõik pildilaiendid).
        "old_pages": [{"stem": l["stem"], "page": l["page"], "images": [l["image"]]}
                      for l in page_list(work_dir)],
    }


def finish_locked(upload_id: str, work_dir: str, progress: dict, username: str) -> None:
    """Kohustuslik järelsamm (`_after_replace_commit`, kutsuja hoiab `work_lock`-i). Korratav."""
    pr = progress.get("promote") or {}
    eid = pr.get("exemplar_id")
    trash = progress.get("trash_dir") or ""
    by_target: dict = {}
    for op in progress.get("old_pages") or []:
        target = (pr.get("origins") or {}).get(op["stem"])
        for img in op.get("images") or []:
            path = os.path.join(trash, img)
            if os.path.isfile(path):
                by_target.setdefault(target, []).append((path, {
                    "kind": "former_pages", "ref": progress.get("old_head"), "page": op["page"],
                    "stem": op["stem"], "upload_id": pr.get("upload_id") or upload_id}))
    for target, files in by_target.items():
        exemplar_images.add_internal(work_dir, target, files, username)

    def mutate(exemplars, unknown, _stems):
        out = we.make_witness(exemplars, eid)
        for x in out:
            if x.get("id") == eid:
                x.pop("needs_review", None)
        return out, unknown, None

    we._bulk(work_dir, username, f"Eksemplarid: transkriptsiooni alus → {eid}", mutate,
             require_commit=True)
    if progress.get("remove_source_ids"):
        exemplar_images.remove_images_internal(work_dir, eid, set(progress["remove_source_ids"]), username)


def confirm(upload_id: str, unknown_target: Optional[str], confirmed_edited: dict) -> None:
    """Lõppkontrolli 409 järel uus kinnitus sama üleslaadimise juures (ADR 0089 p 6)."""
    from . import upload_ops
    from .utils import find_directory_by_id
    with upload_ops._get_upload_lock(upload_id):
        state = upload_ops._read_state(upload_id) or {}
    pr = state.get("promote")
    if not pr:
        raise PromoteError(404, "no_promote")
    work_dir = find_directory_by_id(state.get("replace_work_id") or "")
    if not work_dir:
        raise PromoteError(404, "no_work")
    pv = preview(work_dir, pr["exemplar_id"])
    if pv["unknown"]:
        exemplars = {x["id"] for x in (_meta(work_dir).get("exemplars") or [])}
        if not unknown_target or unknown_target == pr["exemplar_id"] or unknown_target not in exemplars:
            raise PromoteError(400, "unknown_target_required", pv["unknown"])
    if (confirmed_edited or {}) != pv["edited"]:
        raise PromoteError(409, "edited_pages_changed", pv)
    if pv["unstorable"]:
        raise PromoteError(400, "old_page_unstorable", pv["unstorable"])

    def fn(s):
        s["promote"].update({"unknown_target": unknown_target,
                             "confirmed_edited": dict(confirmed_edited or {}),
                             "origins": {p["stem"]: (p["origin"] or unknown_target) for p in pv["pages"]}})
    upload_ops._update_replace_state(upload_id, fn)
