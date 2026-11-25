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
