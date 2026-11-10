# server/exemplar_images.py
"""Eksemplari pildid (ADR 0079): manifest `_exemplars/{eid}/images.json`.

Manifest muutub AINULT selle mooduli kaudu (ja impordi avaldamisel
`exemplar_import`-is), alati luku `work_lock` → `metadata_lock` all, nii et
eksemplar ei saa kaduda manifesti kirjutamise ajal ega manifest tekkida
kustutatud eksemplarile. `revision` on optimistlik lukk kliendi kirjutustele.
Pilditoimingud ei puuduta `_metadata.json`-i ega Meilisearchi.
"""
from __future__ import annotations

import contextlib
import json
import os
import re
import shutil
from datetime import date
from typing import Optional

from .config import get_logger
from .exemplar_image_files import ImageFileError, store_image
from .utils import generate_nanoid, metadata_lock
from .work_parts import page_stems

logger = get_logger(__name__)

ID_RE = re.compile(r"^[a-z0-9]{6}$")
EXEMPLARS_DIRNAME = "_exemplars"
MANIFEST_NAME = "images.json"
SERVER_FIELDS = ("import_id", "added_by", "at")
# Impordipildil on `source`-ist muudetav ainult litsents: viide originaalile ei tohi kaduda.
IMPORT_IMMUTABLE_SOURCE = True
UPLOAD_KINDS = frozenset({"url", "photo", "other"})
# Käsitsi lisatud pildi allika liik, mida toimetaja võib hiljem valida.
EDIT_KINDS = frozenset({"ada", "url", "photo", "other"})
_MAX = {"label": 500, "page": 200, "ref": 2000, "license": 500}
_IMAGE_KEYS = ("id", "original", "label", "page", "source")
_SOURCE_KEYS = ("kind", "ref", "bitstream", "page", "import_id", "license", "added_by", "at")


class ExemplarImagesError(ValueError):
    def __init__(self, message: str, status: int = 400, current: Optional[dict] = None):
        super().__init__(message)
        self.status = status
        self.current = current


# ── Teed ja lugemine ─────────────────────────────────────────────────────────

def _check_id(value, what: str) -> str:
    if not isinstance(value, str) or not ID_RE.match(value):
        raise ExemplarImagesError(f"{what} pole: {value}", 404)
    return value


def exemplar_dir(work_dir: str, eid: str) -> str:
    return os.path.join(work_dir, EXEMPLARS_DIRNAME, _check_id(eid, "Eksemplari"))


def manifest_path(work_dir: str, eid: str) -> str:
    return os.path.join(exemplar_dir(work_dir, eid), MANIFEST_NAME)


def empty_manifest() -> dict:
    return {"revision": 0, "images": [], "imports": {}}


def read_manifest(work_dir: str, eid: str) -> dict:
    try:
        with open(manifest_path(work_dir, eid), "r", encoding="utf-8") as f:
            data = json.load(f) or {}
    except FileNotFoundError:
        return empty_manifest()
    return {"revision": int(data.get("revision") or 0),
            "images": list(data.get("images") or []),
            "imports": dict(data.get("imports") or {})}


PREVIEW_COUNT = 6


def image_previews(work_dir: str, exemplar_ids) -> dict:
    """Eksemplari kaardi pildiriba: `{eid: {count, preview: [id ≤ 6]}}`, ainult piltidega."""
    out = {}
    for eid in exemplar_ids:
        if not isinstance(eid, str) or not ID_RE.match(eid):
            continue
        images = read_manifest(work_dir, eid)["images"]
        if images:
            out[eid] = {"count": len(images), "preview": [i["id"] for i in images[:PREVIEW_COUNT]]}
    return out


def _read_meta(work_dir: str) -> dict:
    with open(os.path.join(work_dir, "_metadata.json"), "r", encoding="utf-8") as f:
        return json.load(f) or {}


@contextlib.contextmanager
def exemplar_locks(work_dir: str):
    """`work_lock` → `metadata_lock` (sama järjekord mis eksemplaride kirjutusteel)."""
    from . import admin_page_ops
    with admin_page_ops.work_lock(os.path.basename(work_dir), work_dir):
        with metadata_lock:
            yield


def require_exemplar(work_dir: str, eid: str) -> dict:
    """Eksemplar `_metadata.json`-ist (kutsuja hoiab lukke). Puudub → 404."""
    _check_id(eid, "Eksemplari")
    try:
        meta = _read_meta(work_dir)
    except (OSError, ValueError):
        raise ExemplarImagesError("Teost ei leitud", 404)
    for x in meta.get("exemplars") or []:
        if x.get("id") == eid:
            return x
    raise ExemplarImagesError(f"Eksemplari pole: {eid}", 404)


def trash_root(work_dir: str, work_id: str, eid: str) -> str:
    # Prügikast on BASE_DIR/._trash (trash_ops); BASE_DIR = teose kausta vanem.
    return os.path.join(os.path.dirname(os.path.abspath(work_dir)), "._trash", work_id,
                        EXEMPLARS_DIRNAME, eid)


# ── Kirjutus ─────────────────────────────────────────────────────────────────

def _ordered(d: dict, keys: tuple) -> dict:
    """Stabiilne võtmejärjekord ja väärtuseta võtmeteta (ADR 0076 p 2, ADR 0012)."""
    return {k: d[k] for k in keys if d.get(k) not in (None, "", [], {})}


def clean_manifest(manifest: dict) -> dict:
    images = []
    for img in manifest.get("images") or []:
        img = dict(img)
        img["source"] = _ordered(img.get("source") or {}, _SOURCE_KEYS)
        images.append(_ordered(img, _IMAGE_KEYS))
    return {"revision": int(manifest.get("revision") or 0), "imports": dict(manifest.get("imports") or {}),
            "images": images}


def manifest_json(manifest: dict) -> str:
    return json.dumps(clean_manifest(manifest), ensure_ascii=False, indent=2)


def write_manifest_locked(work_dir: str, eid: str, manifest: dict, username: str, message: str) -> bool:
    """Kirjutab ja commit'ib manifesti. Kutsuja hoiab lukke. Tagastab `git_committed`."""
    from .git_ops import save_with_git
    path = manifest_path(work_dir, eid)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    res = save_with_git(path, manifest_json(manifest), username, message=message)
    ok = not (isinstance(res, dict) and res.get("success") is False)
    if not ok:
        logger.error("Eksemplari pildid: commit ebaõnnestus (%s): %s", path, res)
    return ok


def _text(value, field: str) -> Optional[str]:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ExemplarImagesError(f"Väli {field} peab olema tekst")
    value = value.strip()
    if len(value) > _MAX[field]:
        raise ExemplarImagesError(f"Väli {field} on liiga pikk")
    return value or None


def _page_number(value) -> Optional[int]:
    if value in (None, ""):
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ExemplarImagesError("Allika lehenumber peab olema positiivne täisarv")
    return value


def _client_source(src, kinds: frozenset) -> dict:
    if not isinstance(src, dict):
        raise ExemplarImagesError("Allikas puudub")
    kind = src.get("kind")
    if kind not in kinds:
        raise ExemplarImagesError(f"Vigane allika liik: {kind}")
    return {"kind": kind, "ref": _text(src.get("ref"), "ref"),
            "page": _page_number(src.get("page")), "license": _text(src.get("license"), "license")}


def _new_image_id(work_dir: str, eid: str, taken: set) -> str:
    d = exemplar_dir(work_dir, eid)
    while True:
        i = generate_nanoid()
        if i not in taken and not os.path.exists(os.path.join(d, f"{i}.jpg")):
            taken.add(i)
            return i


def _with_commit_flag(manifest: dict, ok: bool) -> dict:
    return {**clean_manifest(manifest), "git_committed": ok}


def _check_revision(current: dict, revision) -> None:
    if revision != current["revision"]:
        raise ExemplarImagesError("Pildiloendit on vahepeal muudetud", 409, clean_manifest(current))


def add_uploads(work_dir: str, eid: str, files: list, username: str) -> dict:
    """Lisab pildid manifesti lõppu. `files` = [(baidid, allikas)]. Revisjoni ei nõua.

    Pilditöötlus (dekodeerimine, pööre, vähendus) käib ENNE lukke: `metadata_lock` on
    protsessiülene ja suur TIFF-ide partii peataks muidu iga teose metaandmete
    salvestuse. Failid on nähtamatud, kuni ID on manifestis; luku all kontrollitakse
    eksemplar uuesti ja kadunud eksemplari korral failid eemaldatakse.
    """
    if not files:
        raise ExemplarImagesError("Faile pole")
    sources = [_client_source(src, UPLOAD_KINDS) for _, src in files]
    today = date.today().isoformat()
    with metadata_lock:
        require_exemplar(work_dir, eid)
    taken = {i.get("id") for i in read_manifest(work_dir, eid)["images"]}
    d = exemplar_dir(work_dir, eid)
    written: list[str] = []
    new_images = []

    def drop_written():
        for p in written:
            with contextlib.suppress(OSError):
                os.remove(p)

    try:
        for (content, _), src in zip(files, sources):
            image_id = _new_image_id(work_dir, eid, taken)
            original = store_image(content, d, image_id)
            written.append(os.path.join(d, f"{image_id}.jpg"))
            if original:
                written.append(os.path.join(d, original))
            new_images.append({"id": image_id, "original": original,
                               "source": {**src, "added_by": username, "at": today}})
    except ImageFileError as e:
        drop_written()
        raise ExemplarImagesError(str(e), e.status)
    except BaseException:
        drop_written()
        raise

    try:
        with exemplar_locks(work_dir):
            require_exemplar(work_dir, eid)
            current = read_manifest(work_dir, eid)
            if {i["id"] for i in new_images} & {i.get("id") for i in current["images"]}:
                raise ExemplarImagesError("Pildi ID kattus samaaegse lisamisega, proovi uuesti", 409)
            manifest = {**current, "revision": current["revision"] + 1,
                        "images": current["images"] + new_images}
            ok = write_manifest_locked(work_dir, eid, manifest, username,
                                       f"Eksemplar: lisa {len(new_images)} pilti [{eid}]")
            return _with_commit_flag(manifest, ok)
    except BaseException:
        # Manifesti ei kirjutatud (eksemplar kadus, ID kattus, kirjutus viskas): failid ära.
        drop_written()
        with contextlib.suppress(OSError):
            os.rmdir(d)
            os.rmdir(os.path.dirname(d))
        raise


def _merge_image(stored: dict, incoming: dict) -> dict:
    """Kliendi muudatus salvestatud kirjele: serveri väljad salvestatud kirjest."""
    if not isinstance(incoming, dict):
        raise ExemplarImagesError("Vigane pildikirje")
    out = {"id": stored["id"], "original": stored.get("original"),
           "label": _text(incoming.get("label"), "label"), "page": _text(incoming.get("page"), "page")}
    old = stored.get("source") or {}
    new = incoming.get("source") if isinstance(incoming.get("source"), dict) else {}
    if old.get("import_id") and IMPORT_IMMUTABLE_SOURCE:
        src = {**old, "license": _text(new.get("license"), "license")}
    else:
        src = {**_client_source(new, EDIT_KINDS), "bitstream": old.get("bitstream")}
        for f in SERVER_FIELDS:
            src[f] = old.get(f)
    out["source"] = src
    return out


def patch_images(work_dir: str, eid: str, revision, images, username: str) -> dict:
    """Järjekord + `label`/`page`/`source`. Loend peab sisaldama täpselt praegused ID-d."""
    with exemplar_locks(work_dir):
        require_exemplar(work_dir, eid)
        current = read_manifest(work_dir, eid)
        _check_revision(current, revision)
        by_id = {i.get("id"): i for i in current["images"]}
        ids = [i.get("id") if isinstance(i, dict) else None for i in images or []] \
            if isinstance(images, list) else None
        if ids is None or len(ids) != len(set(ids)) or set(ids) != set(by_id):
            raise ExemplarImagesError("Loend peab sisaldama täpselt praegused pildid", 409,
                                      clean_manifest(current))
        merged = [_merge_image(by_id[i["id"]], i) for i in images]
        # Sihtlehe kontroll SAMA luku all (lehe kustutus hoiab sama work_lock-i): muudetud
        # paar peab osutama teose praegusele lehele. Muutmata väärtust ei kontrollita —
        # rippuv vana paar ei tohi blokeerida sildi muutmist, selle koristab sünk.
        changed = {m["page"] for m in merged
                   if m.get("page") and m["page"] != by_id[m["id"]].get("page")}
        if changed and not changed <= set(page_stems(work_dir)):
            raise ExemplarImagesError("Paar osutab lehele, mida teosel enam ei ole", 409,
                                      clean_manifest(current))
        new = clean_manifest({**current, "images": merged})
        if new["images"] == clean_manifest(current)["images"]:
            return _with_commit_flag(current, True)          # ADR 0012: no-op
        new["revision"] = current["revision"] + 1
        ok = write_manifest_locked(work_dir, eid, new, username, f"Eksemplar: muuda pilte [{eid}]")
        return _with_commit_flag(new, ok)


def _image_files(work_dir: str, eid: str, img: dict) -> list[str]:
    d = exemplar_dir(work_dir, eid)
    names = [f"{img['id']}.jpg", os.path.join("_thumbs", f"_thumb_{img['id']}.jpg")]
    if img.get("original"):
        names.append(img["original"])
    return [os.path.join(d, n) for n in names]


def _move_to_trash(paths: list[str], src_root: str, dst_root: str) -> None:
    for p in paths:
        if not os.path.exists(p):
            continue
        dst = os.path.join(dst_root, os.path.relpath(p, src_root))
        try:
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.move(p, dst)
        except OSError as e:
            logger.warning("Eksemplari pilt prügikasti ebaõnnestus (%s): %s", p, e)


def delete_image(work_dir: str, eid: str, image_id: str, revision, username: str) -> dict:
    """Kirje manifestist, failid `._trash`-i. `imports`-kirje jääb alles."""
    with exemplar_locks(work_dir):
        require_exemplar(work_dir, eid)
        current = read_manifest(work_dir, eid)
        img = next((i for i in current["images"] if i.get("id") == image_id), None)
        if img is None:
            raise ExemplarImagesError(f"Pilti pole: {image_id}", 404)
        _check_revision(current, revision)
        new = {**current, "revision": current["revision"] + 1,
               "images": [i for i in current["images"] if i.get("id") != image_id]}
        # Manifest enne faile: tõrke korral ei jää kirjet ilma failita.
        ok = write_manifest_locked(work_dir, eid, new, username, f"Eksemplar: kustuta pilt [{eid}/{image_id}]")
        work_id = _read_meta(work_dir).get("id") or os.path.basename(work_dir)
        d = exemplar_dir(work_dir, eid)
        _move_to_trash(_image_files(work_dir, eid, img), d, trash_root(work_dir, work_id, eid))
        return _with_commit_flag(new, ok)


def original_path(work_dir: str, eid: str, image_id: str) -> tuple[Optional[str], Optional[str]]:
    """(lähtefaili tee, None) või ADA pildi puhul (None, handle'i URL)."""
    img = next((i for i in read_manifest(work_dir, eid)["images"] if i.get("id") == image_id), None)
    if img is None:
        raise ExemplarImagesError(f"Pilti pole: {image_id}", 404)
    src = img.get("source") or {}
    # Impordipildi originaal on ADA-s (PDF-i ei hoita); käsitsi lisatud pildil on fail.
    if src.get("kind") == "ada" and src.get("import_id") and src.get("ref"):
        return None, f"https://hdl.handle.net/{src['ref']}"
    d = exemplar_dir(work_dir, eid)
    path = os.path.join(d, img.get("original") or f"{image_id}.jpg")
    if not os.path.isfile(path):
        raise ExemplarImagesError("Lähtefail puudub", 404)
    return path, None


# ── Eksemplari ja teose kustutus/taastamine (ADR 0079 tagajärjed) ───────────

def _non_git_files(ex_dir: str) -> list[str]:
    """Gitist väljas olevad failid: kõik peale manifesti ja impordi staging'u."""
    out = []
    for root, dirs, files in os.walk(ex_dir):
        dirs[:] = [x for x in dirs if not (root == ex_dir and x == "_imports")]
        out.extend(os.path.join(root, f) for f in files
                   if not (root == ex_dir and f == MANIFEST_NAME))
    return out


def trash_exemplar_files(work_dir: str, eid: str, work_id: str) -> None:
    """Eksemplari pildifailid `._trash/{work_id}/_exemplars/{eid}/`-i."""
    d = exemplar_dir(work_dir, eid)
    if os.path.isdir(d):
        _move_to_trash(_non_git_files(d), d, trash_root(work_dir, work_id, eid))


def trash_all_exemplar_files(work_dir: str, work_id: str) -> None:
    """Teose kustutus: kõigi eksemplaride pildifailid prügikasti (staging jääb maha)."""
    root = os.path.join(work_dir, EXEMPLARS_DIRNAME)
    if not os.path.isdir(root):
        return
    for eid in os.listdir(root):
        if ID_RE.match(eid) and os.path.isdir(os.path.join(root, eid)):
            trash_exemplar_files(work_dir, eid, work_id)


def remove_exemplar_images_locked(work_dir: str, eid: str, work_id: str, username: str) -> None:
    """Eksemplari kustutuse järel (kutsuja hoiab `work_lock`-i): failid prügikasti,
    `images.json` gitist eraldi commit'iga. `bulk_update_works` ei oska faili samas
    commit'is eemaldada; tõrke korral jääb gitti olematu eksemplari manifest, mida
    lugejad ignoreerivad. Pooleli import katkeb oma protokolli 1. sammus."""
    from .git_ops import delete_file_from_git
    d = exemplar_dir(work_dir, eid)
    path = os.path.join(d, MANIFEST_NAME)
    if not os.path.isdir(d):
        return
    trash_exemplar_files(work_dir, eid, work_id)
    if os.path.exists(path):
        if not delete_file_from_git(path, f"Eksemplar: kustuta pildid [{eid}]", username):
            logger.warning("Eksemplari %s manifesti ei saanud gitist eemaldada", eid)
            with contextlib.suppress(OSError):
                os.remove(path)
    # Tühjad kaustad ära; `_imports/` jääb, kuni import selle ise koristab.
    for sub in (os.path.join(d, "_thumbs"), d, os.path.dirname(d)):
        with contextlib.suppress(OSError):
            os.rmdir(sub)


def restore_exemplar_files(trash_dir: str, work_dir: str) -> None:
    """Teose taastamine: prügikastist tagasi ainult taastatud manifestis olevate
    piltide failid. Kustutatud pilt või kustutatud eksemplar orvuna tagasi ei tule."""
    root = os.path.join(trash_dir, EXEMPLARS_DIRNAME)
    if not os.path.isdir(root):
        return
    for eid in os.listdir(root):
        if not ID_RE.match(eid) or not os.path.isfile(manifest_path(work_dir, eid)):
            continue
        src_dir = os.path.join(root, eid)
        dst_dir = exemplar_dir(work_dir, eid)
        for img in read_manifest(work_dir, eid)["images"]:
            if not isinstance(img.get("id"), str) or not ID_RE.match(img["id"]):
                continue
            for dst in _image_files(work_dir, eid, img):
                src = os.path.join(src_dir, os.path.relpath(dst, dst_dir))
                if os.path.exists(src) and not os.path.exists(dst):
                    try:
                        os.makedirs(os.path.dirname(dst), exist_ok=True)
                        shutil.move(src, dst)
                    except OSError as e:
                        logger.warning("Eksemplari pildi taastamine ebaõnnestus (%s): %s", src, e)

