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


def find_replace_commit(repo, old_head: str, slug: str, upload_id: str) -> Optional[str]:
    """Treileriga asenduse commit `old_head..HEAD` vahemikus (teose kaustas) või None."""
    try:
        for c in repo.iter_commits(f"{old_head}..HEAD", paths=slug):
            if commit_trailer(upload_id) in (c.message or ""):
                return c.hexsha
    except Exception:
        logger.exception("Asenduse commit'i otsing ebaõnnestus (%s)", upload_id)
    return None


def restore_replace(work_dir: str, progress: dict, repo) -> None:
    """Taastab asenduse-eelse seisu. Iga samm eraldi: üks tõrge ei jäta teisi tegemata."""
    from ..git_ops import git_write_lock

    slug = os.path.basename(os.path.normpath(work_dir))
    old_head = progress.get("old_head")
    trash_dir = progress.get("trash_dir") or ""
    old_jpgs = list(progress.get("old_jpgs") or [])
    new_files = list(progress.get("new_files") or [])

    # 1. Jälgitavad failid, mida `old_head`-is ei ole (uued, juba stage'itud) — checkout
    #    neid ei eemaldaks (ADR 0089 p 3).
    try:
        with git_write_lock:
            in_index = set(filter(None, repo.git.ls_files(slug).splitlines()))
            in_old = set(filter(None, repo.git.ls_tree("-r", "--name-only", old_head, slug).splitlines()))
            for path in sorted(in_index - in_old):
                repo.git.rm("-f", "--cached", "--", path)
                full = os.path.join(os.path.dirname(os.path.normpath(work_dir)), path)
                if os.path.isfile(full):
                    os.remove(full)
    except Exception:
        logger.exception("Taastamine: uute jälgitavate failide eemaldus ebaõnnestus (%s)", slug)

    # 2. Jälgimata uued .txt/.json (alla laaditud, veel `git add`-ita), mida vanas ei olnud.
    try:
        with git_write_lock:
            in_old = set(filter(None, repo.git.ls_tree("-r", "--name-only", old_head, slug).splitlines()))
        for name in new_files:
            if name.endswith((".txt", ".json")) and f"{slug}/{name}" not in in_old:
                p = os.path.join(work_dir, name)
                if os.path.isfile(p):
                    os.remove(p)
    except Exception:
        logger.exception("Taastamine: uute jälgimata failide eemaldus ebaõnnestus (%s)", slug)

    # 3. Vanad jälgitavad failid tagasi.
    try:
        with git_write_lock:
            repo.git.checkout(old_head, "--", slug)
    except Exception:
        logger.exception("Taastamine: git checkout ebaõnnestus (%s)", slug)

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
                p = os.path.join(work_dir, name)
                if os.path.isfile(p):
                    os.remove(p)
    except Exception:
        logger.exception("Taastamine: JPG-de taastamine ebaõnnestus (%s)", slug)


def recover(upload_id: str, slug: str) -> str:
    """Pooleli asendus märgi järgi: `"replaced"` (commit tehtud, järelsammud tehtud),
    `"restored"` (vana seis taastatud) või `"cleared"` (taastada polnud midagi)."""
    from .. import upload_ops
    from ..admin_page_ops import work_lock
    from ..git_ops import get_or_init_repo

    work_dir = os.path.join(upload_ops.BASE_DIR, slug)
    with replace_marker.marker_owner(upload_id):
        with work_lock(slug, work_dir):
            with upload_ops._get_upload_lock(upload_id):
                state = upload_ops._read_state(upload_id) or {}
            progress = state.get("replace_progress")
            if not progress or progress.get("phase") != "replacing":
                # Märk kirjutati, aga failimuutused ei alanud (või asendus jõudis lõpuni).
                replace_marker.remove_marker(slug)
                return "cleared"
            repo = get_or_init_repo()
            if find_replace_commit(repo, progress["old_head"], slug, upload_id):
                upload_ops._set_replace_phase(upload_id, "replaced")
                work_id = state.get("replace_work_id") or ""
                upload_ops._after_replace_commit(upload_id, state, work_dir, slug, work_id,
                                                 state.get("username") or "Automaatne")
                replace_marker.remove_marker(slug)
                return "replaced"
            restore_replace(work_dir, progress, repo)
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
