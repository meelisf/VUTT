# server/exemplar_import.py
"""ADA import eksemplari piltideks (ADR 0079 p 5).

Failipõhine taastatav taustatöö: tõde on `_imports/{import_id}/job.json`-is ja
failides, mitte mälus. Olekud: `fetching` → `rendering` → `publishing` →
`published` | `aborted` | `error`. Leheplaan (`image_id`-d) salvestatakse enne
renderdust, nii et kordus ja taastaja kasutavad samu ID-sid.

Avaldamine (`publish`) jookseb ühe `work_lock` → `metadata_lock` all ja iga samm
kontrollib oma tehtust eraldi. Lõpetatuse tunnus on `imports[import_id]` +
commit'itud manifest + `url_done` — pildikirjete olemasolu tunnusena EI kasutata,
sest kasutaja võib impordi pilte vahepeal kustutada.

PDF-e ei liideta: iga leht renderdatakse oma bitstreami PDF-ist. PDF-i ei hoita
alles — originaal on ADA-s ja `source.ref` + `bitstream` + `page` viitavad sellele.
"""
from __future__ import annotations

import contextlib
import json
import os
import re
import shutil
import threading
from datetime import date
from typing import Callable, Optional

from . import exemplar_images as ei
from .config import get_logger
from .utils import atomic_write_json, generate_nanoid

logger = get_logger(__name__)

IMPORTS_DIRNAME = "_imports"
JOB_NAME = "job.json"
DONE_STATES = frozenset({"published", "aborted"})
# Ei blokeeri uut importi: `error` katkestatakse uue POST-i juures.
IDLE_STATES = DONE_STATES | {"error"}
_UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
HANDLE_URL = "https://hdl.handle.net/{}"

_RUNNING: set = set()
_RUNNING_LOCK = threading.Lock()


class PublishError(RuntimeError):
    """Avaldamise samm ebaõnnestus; olek jääb `publishing`-uks ja kordus jätkab."""


# ── Asendatavad välised sammud (testid asendavad) ────────────────────────────

def _lookup(handle: str) -> dict:
    from .ada import client
    return client.lookup(handle)


def _fetch_source(src: dict, dst: str) -> None:
    from .ada import client, fetch
    if not _UUID_RE.match(str(src.get("bitstream_uuid") or "")):
        raise ValueError(f"Vigane bitstream_uuid: {src.get('bitstream_uuid')!r}")
    url = f"{client.BASE}/core/bitstreams/{src['bitstream_uuid']}/content"
    fetch.laadi_tykk(url, dst, int(src.get("size_bytes") or 0))


def _page_count(pdf_path: str) -> int:
    from .ada import fetch
    return fetch.lehtede_arv(pdf_path)


def _render_page(pdf_path: str, page: int, dst: str) -> None:
    # Sama renderdaja ja semafor mis upload'il (FULL_DPI/JPEG_QUALITY, ADR 0028/0074).
    from .upload.page_source import PdfPageSource
    from .upload.prepress import RENDER_SEMAPHORE
    with RENDER_SEMAPHORE:
        PdfPageSource(pdf_path).render_full(page, dst)


def _spawn(fn: Callable, *args) -> None:
    threading.Thread(target=fn, args=args, daemon=True).start()


def _checkpoint(step: str) -> None:
    """Protokolli sammu piir (testid katkestavad siin)."""


# ── Teed ja töö fail ─────────────────────────────────────────────────────────

def _check_import_id(import_id) -> str:
    if not isinstance(import_id, str) or not ei.ID_RE.match(import_id):
        raise ei.ExemplarImagesError(f"Importi pole: {import_id}", 404)
    return import_id


def imports_dir(work_dir: str, eid: str) -> str:
    return os.path.join(ei.exemplar_dir(work_dir, eid), IMPORTS_DIRNAME)


def staging_dir(work_dir: str, eid: str, import_id: str) -> str:
    return os.path.join(imports_dir(work_dir, eid), _check_import_id(import_id))


def _job_path(work_dir: str, eid: str, import_id: str) -> str:
    return os.path.join(staging_dir(work_dir, eid, import_id), JOB_NAME)


def read_job(work_dir: str, eid: str, import_id: str) -> Optional[dict]:
    try:
        with open(_job_path(work_dir, eid, import_id), "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _write_job(work_dir: str, eid: str, job: dict) -> None:
    atomic_write_json(_job_path(work_dir, eid, job["import_id"]), job)


def _update_job(work_dir: str, eid: str, import_id: str, **fields) -> Optional[dict]:
    job = read_job(work_dir, eid, import_id)
    if job is None:
        return None
    job.update(fields)
    _write_job(work_dir, eid, job)
    return job


def _jobs(work_dir: str, eid: str) -> list[dict]:
    d = imports_dir(work_dir, eid)
    out = []
    if os.path.isdir(d):
        for name in sorted(os.listdir(d)):
            if ei.ID_RE.match(name):
                job = read_job(work_dir, eid, name)
                if job:
                    out.append(job)
    return out


# ── Leheplaan (puhas) ────────────────────────────────────────────────────────

def build_page_plan(bitstream_pages: list, page_from: Optional[int], page_to: Optional[int],
                    new_id: Callable[[], str]) -> list[dict]:
    """`[(bitstream, lehti)]` + 1-põhine vahemik liidetud järjestuses →
    `[{image_id, pdf_page, bitstream, bitstream_page}]`. `bitstream_page` on leht
    SELLES bitstreamis, mitte liidetud PDF-is."""
    total = sum(n for _, n in bitstream_pages)
    lo = 1 if page_from is None else page_from
    hi = total if page_to is None else page_to
    if total < 1 or lo < 1 or hi < lo or hi > total:
        raise ei.ExemplarImagesError(f"Lehevahemik {lo}–{hi} ei mahu kirje {total} lehe sisse")
    plan = []
    offset = 0
    for bitstream, count in bitstream_pages:
        for local in range(1, count + 1):
            pdf_page = offset + local
            if lo <= pdf_page <= hi:
                plan.append({"image_id": new_id(), "pdf_page": pdf_page,
                             "bitstream": bitstream, "bitstream_page": local})
        offset += count
    return plan


def _range(value, name: str) -> Optional[int]:
    if value in (None, ""):
        return None
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ei.ExemplarImagesError(f"{name} peab olema positiivne täisarv")
    return value


# ── Alustamine ja olek ───────────────────────────────────────────────────────

def start_import(work_dir: str, eid: str, handle: str, page_from, page_to, username: str,
                 set_url: bool = True) -> str:
    page_from, page_to = _range(page_from, "from"), _range(page_to, "to")
    if page_from and page_to and page_to < page_from:
        raise ei.ExemplarImagesError("Vahemiku lõpp on enne algust")
    if not isinstance(handle, str) or not handle.strip():
        raise ei.ExemplarImagesError("Handle puudub")
    from .ada.client import AdaViga
    try:
        found = _lookup(handle.strip())
    except AdaViga as e:
        raise ei.ExemplarImagesError(str(e), 400)
    sources = [{"name": f.get("name"), "bitstream_uuid": f.get("bitstream_uuid"),
                "size_bytes": int(f.get("size_bytes") or 0)} for f in found.get("failid") or []]
    if not sources:
        raise ei.ExemplarImagesError("Kirjel ei ole PDF-faile")

    with ei.exemplar_locks(work_dir):
        ei.require_exemplar(work_dir, eid)
        for job in _jobs(work_dir, eid):
            if job.get("state") not in IDLE_STATES or job["import_id"] in _RUNNING:
                raise ei.ExemplarImagesError("Sellel eksemplaril juba käib import", 409)
        for job in _jobs(work_dir, eid):
            if job.get("state") == "error":
                _abort_locked(work_dir, eid, job)
            elif job.get("state") in DONE_STATES:
                _cleanup(work_dir, eid, job["import_id"])
        import_id = generate_nanoid()
        while os.path.exists(staging_dir(work_dir, eid, import_id)):
            import_id = generate_nanoid()
        os.makedirs(staging_dir(work_dir, eid, import_id))
        _write_job(work_dir, eid, {
            "import_id": import_id, "eid": eid, "kind": "ada", "handle": found["handle"],
            "page_from": page_from, "page_to": page_to, "username": username,
            "set_url": bool(set_url), "sources": sources, "plan": None,
            "state": "fetching", "pages_total": None, "pages_done": 0, "error": None,
            "url_done": False, "created": date.today().isoformat(),
        })
    _spawn(_run, work_dir, eid, import_id)
    return import_id


def import_status(work_dir: str, eid: str, import_id: str) -> dict:
    job = read_job(work_dir, eid, import_id)
    if job is None:
        if import_id in ei.read_manifest(work_dir, eid)["imports"]:
            return {"state": "published"}
        raise ei.ExemplarImagesError(f"Importi pole: {import_id}", 404)
    # Korduspäring: commit'i tõrke järel jätkab avaldamist uus katse.
    if job.get("state") == "publishing" and job.get("error") and import_id not in _RUNNING:
        _spawn(_run, work_dir, eid, import_id)
    return {k: job.get(k) for k in ("state", "pages_total", "pages_done", "error")}


# ── Taustatöö ────────────────────────────────────────────────────────────────

def _claim(import_id: str) -> bool:
    with _RUNNING_LOCK:
        if import_id in _RUNNING:
            return False
        _RUNNING.add(import_id)
        return True


def _release(import_id: str) -> None:
    with _RUNNING_LOCK:
        _RUNNING.discard(import_id)


def _pdf_path(staging: str, index: int) -> str:
    return os.path.join(staging, f"{index + 1:03d}.pdf")


def _taken_ids(work_dir: str, eid: str) -> set:
    return {i.get("id") for i in ei.read_manifest(work_dir, eid)["images"]}


def _prepare(work_dir: str, eid: str, import_id: str) -> None:
    """Allalaadimine, leheplaan ja renderdus staging'usse (manifest ei muutu)."""
    staging = staging_dir(work_dir, eid, import_id)
    job = read_job(work_dir, eid, import_id)
    sources = job["sources"]
    for i, src in enumerate(sources):
        dst = _pdf_path(staging, i)
        if not os.path.exists(dst):
            _fetch_source(src, dst)
    if job.get("plan") is None:
        counts = [(src["bitstream_uuid"], _page_count(_pdf_path(staging, i))) for i, src in enumerate(sources)]
        taken = _taken_ids(work_dir, eid)
        exdir = ei.exemplar_dir(work_dir, eid)

        def new_id() -> str:
            while True:
                x = generate_nanoid()
                if x not in taken and not os.path.exists(os.path.join(exdir, f"{x}.jpg")):
                    taken.add(x)
                    return x
        plan = build_page_plan(counts, job.get("page_from"), job.get("page_to"), new_id)
        job = _update_job(work_dir, eid, import_id, plan=plan, pages_total=len(plan), state="rendering")
    index = {src["bitstream_uuid"]: i for i, src in enumerate(sources)}
    done = 0
    for entry in job["plan"]:
        dst = os.path.join(staging, f"{entry['image_id']}.jpg")
        if not os.path.exists(dst):
            _render_page(_pdf_path(staging, index[entry["bitstream"]]), entry["bitstream_page"], dst)
        done += 1
        _update_job(work_dir, eid, import_id, pages_done=done)


def _run(work_dir: str, eid: str, import_id: str, publish_after: bool = True) -> None:
    if not _claim(import_id):
        return
    try:
        job = read_job(work_dir, eid, import_id)
        if job is None:
            return
        state = job.get("state")
        if state in DONE_STATES:
            _cleanup(work_dir, eid, import_id)
            return
        if state != "publishing":
            _update_job(work_dir, eid, import_id, state=job.get("state") if state in ("fetching", "rendering")
                        else "fetching", error=None)
            _prepare(work_dir, eid, import_id)
            _update_job(work_dir, eid, import_id, state="publishing", error=None)
        if publish_after:
            _publish_claimed(work_dir, eid, import_id)
    except Exception as e:
        logger.warning("Eksemplari import %s ebaõnnestus: %s", import_id, e)
        with contextlib.suppress(Exception):
            job = read_job(work_dir, eid, import_id)
            if job is not None:
                # Avaldamise tõrge jätab oleku `publishing`-uks: kordus jätkab sealt.
                state = "publishing" if job.get("state") == "publishing" else "error"
                _update_job(work_dir, eid, import_id, state=state, error=str(e)[:500])
    finally:
        _release(import_id)


# ── Avaldamisprotokoll ───────────────────────────────────────────────────────

def _cleanup(work_dir: str, eid: str, import_id: str) -> None:
    with contextlib.suppress(OSError, ei.ExemplarImagesError):
        shutil.rmtree(staging_dir(work_dir, eid, import_id))
    with contextlib.suppress(OSError):
        os.rmdir(imports_dir(work_dir, eid))
    # Kustutatud eksemplari kaust (ainult staging jäi) ära.
    if not os.path.exists(ei.manifest_path(work_dir, eid)):
        with contextlib.suppress(OSError):
            os.rmdir(ei.exemplar_dir(work_dir, eid))
        with contextlib.suppress(OSError):
            os.rmdir(os.path.dirname(ei.exemplar_dir(work_dir, eid)))


def _abort_locked(work_dir: str, eid: str, job: dict) -> None:
    """`aborted` + staging prügikasti (kutsuja hoiab lukke)."""
    import_id = job["import_id"]
    job = {**job, "state": "aborted"}
    _write_job(work_dir, eid, job)
    try:
        work_id = ei._read_meta(work_dir).get("id")
    except (OSError, ValueError):
        work_id = None
    src = staging_dir(work_dir, eid, import_id)
    dst = os.path.join(ei.trash_root(work_dir, work_id or os.path.basename(work_dir), eid),
                       IMPORTS_DIRNAME, import_id)
    try:
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if os.path.exists(dst):
            shutil.rmtree(dst)
        shutil.move(src, dst)
    except OSError as e:
        logger.warning("Katkestatud impordi staging prügikasti ebaõnnestus (%s): %s", src, e)
    _cleanup(work_dir, eid, import_id)


def publish(work_dir: str, eid: str, import_id: str) -> None:
    """Idempotentne avaldamine (spetsi sammud 1–5). Viga → olek jääb `publishing`."""
    if not _claim(import_id):
        return
    try:
        _publish_claimed(work_dir, eid, import_id)
    except Exception as e:
        with contextlib.suppress(Exception):
            _update_job(work_dir, eid, import_id, state="publishing", error=str(e)[:500])
        raise
    finally:
        _release(import_id)


def _publish_claimed(work_dir: str, eid: str, import_id: str) -> None:
    from . import git_ops
    from . import work_exemplars as we

    # 1. Teos olemas? `work_lock` avab {work_dir}/.vutt-lock — ilma kaustata ei saa lukku võtta.
    if not os.path.isdir(work_dir):
        return
    with ei.exemplar_locks(work_dir):
        job = read_job(work_dir, eid, import_id)
        if job is None:
            return
        if job.get("state") in DONE_STATES:
            _cleanup(work_dir, eid, import_id)
            return
        try:
            ei.require_exemplar(work_dir, eid)
        except ei.ExemplarImagesError:
            _abort_locked(work_dir, eid, job)
            return
        staging = staging_dir(work_dir, eid, import_id)
        exdir = ei.exemplar_dir(work_dir, eid)
        mpath = ei.manifest_path(work_dir, eid)
        username = job.get("username") or "Automaatne"

        # 2. Failid ja manifest koos, imporditunnuse järgi.
        manifest = ei.read_manifest(work_dir, eid)
        if import_id not in manifest["imports"]:
            plan = job.get("plan") or []
            for entry in plan:
                dst = os.path.join(exdir, f"{entry['image_id']}.jpg")
                if os.path.exists(dst):
                    continue
                src = os.path.join(staging, f"{entry['image_id']}.jpg")
                if not os.path.exists(src):
                    raise PublishError(f"Renderdus puudub: {entry['image_id']}")
                os.replace(src, dst)
            _checkpoint("files_moved")
            today = date.today().isoformat()
            known = {i.get("id") for i in manifest["images"]}
            new_images = [{"id": e["image_id"], "source": {
                "kind": "ada", "ref": job["handle"], "bitstream": e["bitstream"],
                "page": e["bitstream_page"], "import_id": import_id,
                "added_by": username, "at": today}} for e in plan if e["image_id"] not in known]
            manifest = {**manifest, "revision": manifest["revision"] + 1,
                        "images": manifest["images"] + new_images,
                        "imports": {**manifest["imports"], import_id: {
                            "kind": "ada", "ref": job["handle"], "count": len(plan),
                            "by": username, "at": today}}}
            os.makedirs(exdir, exist_ok=True)
            atomic_write_json(mpath, ei.clean_manifest(manifest))
            _checkpoint("manifest_written")

        # 3. Manifesti commit, kui kettal olev erineb HEAD-ist.
        if git_ops.uncommitted_paths([mpath]):
            with open(mpath, "r", encoding="utf-8") as f:
                content = f.read()
            res = git_ops.save_with_git(mpath, content, username,
                                        message=f"Eksemplar: ADA import {job['handle']} [{eid}/{import_id}]")
            if (isinstance(res, dict) and res.get("success") is False) or git_ops.uncommitted_paths([mpath]):
                raise PublishError("Manifesti commit ebaõnnestus")
        _checkpoint("manifest_committed")

        # 4. URL lukustatud `update_exemplar`-iga; tühi muudatus commit'ib rippuva kirjutuse.
        if not job.get("url_done"):
            exemplar = ei.require_exemplar(work_dir, eid)
            data = {}
            if job.get("set_url") and not exemplar.get("url"):
                data = {"url": HANDLE_URL.format(job["handle"])}
            try:
                we.update_exemplar(work_dir, eid, data, username, locked=True, require_commit=True)
            except we.ExemplarError as e:
                raise PublishError(f"Eksemplari URL-i salvestus ebaõnnestus: {e}")
            meta_path = os.path.join(work_dir, "_metadata.json")
            if git_ops.uncommitted_paths([meta_path]):
                raise PublishError("Teose metaandmete commit ebaõnnestus")
            job = _update_job(work_dir, eid, import_id, url_done=True)
        _checkpoint("url_done")

        # 5. Lõpp: olek enne koristust — koristuse tõrge ei ole viga.
        _update_job(work_dir, eid, import_id, state="published", error=None)
        _cleanup(work_dir, eid, import_id)


# ── Taastaja (serveri stardil) ───────────────────────────────────────────────

def recover_imports(background: bool = True) -> None:
    """Iga `_imports/*/job.json`: valmis/katkestatud → koristus, muu → jätka."""
    # Andmejuur sama, mida kasutab git (`git_ops.BASE_DIR`), loetud kutsehetkel.
    from . import git_ops
    base = git_ops.BASE_DIR
    if not os.path.isdir(base):
        return
    for name in os.listdir(base):
        if name.startswith((".", "_")):
            continue
        work_dir = os.path.join(base, name)
        root = os.path.join(work_dir, ei.EXEMPLARS_DIRNAME)
        if not os.path.isdir(root):
            continue
        for eid in os.listdir(root):
            if not ei.ID_RE.match(eid):
                continue
            try:
                for job in _jobs(work_dir, eid):
                    if job.get("state") == "error":
                        continue        # kasutaja otsustab: uus import katkestab selle
                    if background:
                        _spawn(_run, work_dir, eid, job["import_id"])
                    else:
                        _run(work_dir, eid, job["import_id"])
            except Exception:
                logger.warning("Eksemplari impordi taaste ebaõnnestus: %s/%s", name, eid, exc_info=True)
