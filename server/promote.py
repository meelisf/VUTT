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
