"""Lehestiku asenduse taastamine ja katkestuse tuvastus (ADR 0089 p 3).

Asendus kirjutab enne esimest failimuutust upload state'i `replace_progress`-i
(`phase`, `old_head`, `trash_dir`, `old_jpgs`, `new_files`) ja asendusmärgi
(`replace_marker`). Siin:

- `restore_replace` — vana seisu taastamine (tõrge või katkestus enne commit'i);
- `find_replace_commit` — kas treileriga `Upload: <id>` commit on tehtud;
- `recover` / `recover_all` — serveri käivitusel märkide järgi pooleli asenduste lõpetus.

JPG-d on gitist väljas ja vana ning uus leht kasutavad sama failinime: JPG
kustutatakse ainult siis, kui tema vana vaste on kindlasti prügikastis.
"""
import os
import shutil
from typing import Optional

from ..config import get_logger
from .. import replace_marker

logger = get_logger(__name__)


def commit_trailer(upload_id: str) -> str:
    return f"Upload: {upload_id}"


class ReplaceCommitUnknown(Exception):
    """Git-ajalugu ei saanud lugeda — commit'i olemasolu on ebaselge."""


def find_replace_commit(repo, old_head: str, slug: str, upload_id: str) -> Optional[str]:
    """Treileriga asenduse commit `old_head..HEAD` vahemikus (teose kaustas) või None.

    Lugemisviga ei ole „commit'i pole": viskab `ReplaceCommitUnknown`, sest valesti
    otsustatud rollback taastaks vanad failid juba commititud asenduse peale (PR #881).
    """
    try:
        for c in repo.iter_commits(f"{old_head}..HEAD", paths=slug):
            if commit_trailer(upload_id) in (c.message or ""):
                return c.hexsha
    except Exception as e:
        logger.exception("Asenduse commit'i otsing ebaõnnestus (%s)", upload_id)
        raise ReplaceCommitUnknown(str(e)) from e
    return None


class RestoreError(Exception):
    """Taastamine jäi pooleli — märk ja taasteinfo PEAVAD alles jääma."""


def _page_paths(paths, slug: str) -> list[str]:
    """Teose lehefailid (mitte `_metadata.json`, mitte eksemplaride kaust)."""
    return sorted(p for p in paths
                  if p.startswith(f"{slug}/") and "/" not in p[len(slug) + 1:]
                  and not p.endswith("/_metadata.json"))


def restore_replace(work_dir: str, progress: dict, repo) -> None:
    """Taastab asenduse-eelse seisu AINULT vanadel lehefailidel (metaandmeid ei puutu:
    neid võidi asenduse ajal salvestada). Iga samm proovitakse; kui mõni ebaõnnestub,
    visatakse lõpus `RestoreError` — kutsuja ei tohi siis märki ega taasteinfot kustutada.
    """
    from ..git_ops import git_write_lock

    slug = os.path.basename(os.path.normpath(work_dir))
    old_head = progress.get("old_head")
    trash_dir = progress.get("trash_dir") or ""
    old_jpgs = list(progress.get("old_jpgs") or [])
    new_files = list(progress.get("new_files") or [])
    vead = []

    try:
        with git_write_lock:
            in_old = set(filter(None, repo.git.ls_tree("-r", "--name-only", old_head, slug).splitlines()))
    except Exception:
        logger.exception("Taastamine: old_head lugemine ebaõnnestus (%s)", slug)
        raise RestoreError("old_head")
    old_tracked = progress.get("old_tracked")
    if old_tracked is not None:
        targets = sorted(f"{slug}/{n}" for n in old_tracked if f"{slug}/{n}" in in_old)
    else:
        targets = _page_paths(in_old, slug)

    # 1. Uued jälgitavad lehefailid, mida vanas ei olnud (stage'itud lõpliku commit'i eel).
    try:
        with git_write_lock:
            in_index = set(filter(None, repo.git.ls_files(slug).splitlines()))
            for path in _page_paths(in_index - in_old, slug):
                repo.git.rm("-f", "--cached", "--", path)
                full = os.path.join(os.path.dirname(os.path.normpath(work_dir)), path)
                if os.path.isfile(full):
                    os.remove(full)
    except Exception:
        logger.exception("Taastamine: uute jälgitavate failide eemaldus ebaõnnestus (%s)", slug)
        vead.append("uued jälgitavad")

    # 2. Jälgimata uued .txt/.json, mida vanas ei olnud.
    try:
        for name in new_files:
            if name.endswith((".txt", ".json")) and f"{slug}/{name}" not in in_old:
                pth = os.path.join(work_dir, name)
                if os.path.isfile(pth):
                    os.remove(pth)
    except Exception:
        logger.exception("Taastamine: uute jälgimata failide eemaldus ebaõnnestus (%s)", slug)
        vead.append("uued jälgimata")

    # 3. Vanad lehefailid tagasi (indeks + töökaust) — ainult need, mitte kogu kaust.
    try:
        if targets:
            with git_write_lock:
                repo.git.checkout(old_head, "--", *targets)
    except Exception:
        logger.exception("Taastamine: git checkout ebaõnnestus (%s)", slug)
        vead.append("checkout")

    # 4. JPG-d prügikasti oleku järgi.
    try:
        for name in old_jpgs:
            in_trash = os.path.join(trash_dir, name)
            here = os.path.join(work_dir, name)
            if os.path.isfile(in_trash):
                if os.path.exists(here):
                    os.remove(here)   # samanimeline fail algses kohas on uus
                shutil.move(in_trash, here)
            # muidu ei jõudnud vana fail liikuda → algses kohas on vana original
        old_set = set(old_jpgs)
        for name in new_files:
            if name.endswith(".jpg") and name not in old_set:
                pth = os.path.join(work_dir, name)
                if os.path.isfile(pth):
                    os.remove(pth)
    except Exception:
        logger.exception("Taastamine: JPG-de taastamine ebaõnnestus (%s)", slug)
        vead.append("jpg")

    if vead:
        raise RestoreError(", ".join(vead))


def recover(upload_id: str, slug: str) -> str:
    """Pooleli asendus märgi järgi: `"replaced"` (commit tehtud, järelsammud tehtud),
    `"restored"` (vana seis taastatud), `"cleared"` (taastada polnud midagi) või
    `"restore_failed"` (märk ja taasteinfo jäävad; teos jääb kirjutamiseks lukku)."""
    from .. import upload_ops
    from ..admin_page_ops import work_lock
    from ..git_ops import get_or_init_repo

    work_dir = os.path.join(upload_ops.BASE_DIR, slug)
    with replace_marker.marker_owner(upload_id):
        with work_lock(slug, work_dir):
            with upload_ops._get_upload_lock(upload_id):
                state = upload_ops._read_state(upload_id) or {}
            # Märgi koopia on autoriteetne: üleslaadimise kaust võib olla kadunud.
            progress = (replace_marker.read_marker(slug) or {}).get("progress") \
                or state.get("replace_progress")
            if progress and progress.get("phase") == "replaced":
                # Commit tehtud, järelsammud võisid pooleli jääda: korda (korratavad). Nende
                # tõrge ei tohi teost lukku jätta — lehestik on juba kooskõlaline.
                try:
                    upload_ops._after_replace_commit(upload_id, state, work_dir, slug,
                                                     state.get("replace_work_id") or "",
                                                     state.get("username") or "Automaatne",
                                                     progress=progress)
                except Exception:
                    logger.exception("Asenduse järelsammud ebaõnnestusid taastel (%s)", upload_id)
                replace_marker.remove_marker(slug)
                return "replaced"
            if not progress or progress.get("phase") != "replacing":
                # Märk kirjutati, aga failimuutused ei alanud.
                replace_marker.remove_marker(slug)
                return "cleared"
            repo = get_or_init_repo()
            try:
                leitud = find_replace_commit(repo, progress["old_head"], slug, upload_id)
            except ReplaceCommitUnknown:
                logger.error("Asenduse commit ebaselge (%s, %s) — märk ja taasteinfo jäävad", slug, upload_id)
                return "commit_unknown"
            if leitud:
                upload_ops._set_replace_phase(upload_id, "replaced", slug=slug)
                try:
                    upload_ops._after_replace_commit(upload_id, state, work_dir, slug,
                                                     state.get("replace_work_id") or "",
                                                     state.get("username") or "Automaatne",
                                                     progress=progress)
                except Exception:
                    logger.exception("Asenduse järelsammud ebaõnnestusid taastel (%s)", upload_id)
                replace_marker.remove_marker(slug)
                return "replaced"
            try:
                restore_replace(work_dir, progress, repo)
            except RestoreError as e:
                logger.error("Asenduse taaste ebaõnnestus (%s, %s): %s — märk jääb", slug, upload_id, e)
                return "restore_failed"
            upload_ops._clear_replace_progress(upload_id)
            replace_marker.remove_marker(slug)
            return "restored"


def recover_all() -> None:
    """Serveri käivitusel: iga asendusmärgi kohta `recover`. Ei kuku."""
    for slug, m in replace_marker.list_markers():
        uid = m.get("upload_id")
        try:
            tulemus = recover(uid, slug)
            logger.warning("Asenduse taaste käivitusel: %s (%s) → %s", slug, uid, tulemus)
        except Exception as e:
            logger.exception("Asenduse taaste käivitusel ebaõnnestus: %s (%s)", slug, uid)
            try:
                from ..client_errors import record_server_error
                record_server_error("server:thread", e)
            except Exception:
                pass
