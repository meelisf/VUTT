"""Lehestiku asenduse taastamine ja katkestuse tuvastus (ADR 0089 p 3, täiendus 2026-11-25).

Mudel (PR #881 kolmanda ülevaatuse järel):

- **Vana seis on kettal, mitte gitis.** Asendus liigutab KÕIK vanad lehefailid
  (`.txt`, `.json`, `.jpg`, mitte `_metadata.json`) prügikasti kausta (`rename` faili
  kaupa). Taastamine liigutab need tagasi ja kustutab uued — `git checkout`-i ei ole,
  seega jääb alles ka kettale salvestatud, aga commitimata tekst.
- **Git on ainult avaldamise samm.** Ühist indeksit puudutatakse alles lõplikus
  commit'is; taastamine viib teose kausta indeksi tagasi HEAD-ile.
- Taasteinfo (`progress`) elab märgifailis (`replace_marker`) ja upload state'is.

Siin: `restore_replace`, `find_replace_commit`, `recover` / `recover_locked` /
`recover_all` (serveri käivitusel ENNE päringute vastuvõtmist).
"""
import os
import shutil
from typing import Optional

from ..config import get_logger
from .. import replace_marker

logger = get_logger(__name__)

# Tulemused, mille järel on teose seis kooskõlaline ja märk eemaldatud.
OK_RESULTS = frozenset({"replaced", "restored", "cleared"})


def commit_trailer(upload_id: str) -> str:
    return f"Upload: {upload_id}"


class ReplaceCommitUnknown(Exception):
    """Git-ajalugu ei saanud lugeda — commit'i olemasolu on ebaselge."""


class RestoreError(Exception):
    """Taastamine jäi pooleli — märk ja taasteinfo PEAVAD alles jääma."""


class AfterStepError(Exception):
    """Kohustuslik järelsamm (osade leheviited) ebaõnnestus — märk jääb, taaste kordab."""


def find_replace_commit(repo, old_head: str, slug: str, upload_id: str) -> Optional[str]:
    """Treileriga asenduse commit `old_head..HEAD` vahemikus (teose kaustas) või None.

    Lugemisviga ei ole „commit'i pole": viskab `ReplaceCommitUnknown`, sest valesti
    otsustatud rollback taastaks vanad failid juba commititud asenduse peale.
    """
    try:
        for c in repo.iter_commits(f"{old_head}..HEAD", paths=slug):
            if commit_trailer(upload_id) in (c.message or ""):
                return c.hexsha
    except Exception as e:
        logger.exception("Asenduse commit'i otsing ebaõnnestus (%s)", upload_id)
        raise ReplaceCommitUnknown(str(e)) from e
    return None


def restore_replace(work_dir: str, progress: dict, repo) -> None:
    """Taastab asenduse-eelse seisu prügikasti koopiast. Iga samm proovitakse; kui mõni
    ebaõnnestub, visatakse lõpus `RestoreError` — kutsuja ei tohi siis märki ega
    taasteinfot kustutada.

    Faili kaupa: vana fail prügikastis → algses kohas olev samanimeline fail on uus
    (kustuta, too vana tagasi); vana fail prügikastis ei ole → ta ei jõudnud liikuda,
    algses kohas on vana original (jäta). Uus fail, mille nime vanade hulgas pole → kustuta.
    """
    from ..git_ops import git_write_lock

    slug = os.path.basename(os.path.normpath(work_dir))
    trash_dir = progress.get("trash_dir") or ""
    old_files = list(progress.get("old_files") or [])
    new_files = list(progress.get("new_files") or [])
    vead = []

    try:
        old_set = set(old_files)
        for name in new_files:
            if name not in old_set:
                pth = os.path.join(work_dir, name)
                if os.path.lexists(pth):
                    os.remove(pth)
        for name in old_files:
            in_trash = os.path.join(trash_dir, name)
            here = os.path.join(work_dir, name)
            if os.path.lexists(in_trash):
                if os.path.lexists(here):
                    os.remove(here)
                shutil.move(in_trash, here)
    except Exception:
        logger.exception("Taastamine: failide taastamine prügikastist ebaõnnestus (%s)", slug)
        vead.append("failid")

    # Indeks: lõplik commit võis jõuda `git add`-ini (tõrge või katkestus) → teose kaust
    # tagasi HEAD-ile. Töökausta see ei puuduta.
    try:
        with git_write_lock:
            repo.git.reset("-q", "HEAD", "--", slug)
    except Exception:
        logger.exception("Taastamine: indeksi lähtestus ebaõnnestus (%s)", slug)
        vead.append("indeks")

    if vead:
        raise RestoreError(", ".join(vead))


def recover_locked(upload_id: str, slug: str, work_dir: str) -> str:
    """Pooleli asendus märgi järgi — kutsuja hoiab teose `work_lock`-i (ja on märgi omanik).

    `"replaced"` (commit tehtud, järelsammud tehtud), `"restored"` (vana seis taastatud),
    `"cleared"` (taastada polnud midagi), `"restore_failed"`, `"commit_unknown"`,
    `"after_failed"` (märk ja taasteinfo jäävad; teos jääb kirjutamiseks lukku) või
    `"index_failed"` (ühist indeksit ei saanud HEAD-iga sünkroonida — ohtlik kõigile teostele).
    """
    from .. import upload_ops
    from ..git_ops import get_or_init_repo

    # Ainult SELLE asenduse aktiivne märk annab õiguse midagi teha: kui teine päring jõudis
    # taaste lõpetada ja märgi eemaldada, ei tohi hilinenud taaste (vana state'i faasi
    # põhjal) pärast seda tehtud muudatusi tagasi pöörata (PR #881, 4. voor).
    marker = replace_marker.read_marker(slug)
    if not marker or marker.get("upload_id") != upload_id:
        return "cleared"
    with upload_ops._get_upload_lock(upload_id):
        state = upload_ops._read_state(upload_id) or {}
    # Märgi koopia on autoriteetne: üleslaadimise kaust võib olla kadunud.
    progress = marker.get("progress") or state.get("replace_progress")

    def _jarelsammud() -> str:
        try:
            upload_ops._after_replace_commit(upload_id, state, work_dir, slug,
                                             state.get("replace_work_id") or "",
                                             state.get("username") or "Automaatne",
                                             progress=progress)
        except AfterStepError as e:
            logger.error("Asenduse kohustuslik järelsamm ebaõnnestus (%s): %s — märk jääb", upload_id, e)
            return "after_failed"
        except Exception:
            # Mittekohustuslik järelsamm (mainimised, Meili, OCR koristus): lehestik ja osad
            # on kooskõlas — teost ei jäeta lukku.
            logger.exception("Asenduse järelsamm ebaõnnestus taastel (%s)", upload_id)
        replace_marker.remove_marker(slug)
        return "replaced"

    if progress and progress.get("phase") == "replaced":
        return _jarelsammud()
    if not progress or progress.get("phase") != "replacing":
        # Märk kirjutati, aga failimuutused ei alanud.
        replace_marker.remove_marker(slug)
        return "cleared"
    repo = get_or_init_repo()
    # Esimesena: teose kausta indeks HEAD-ile. Katkestus võis jätta lõpliku commit'i
    # `git add`-i ühisesse indeksisse; see peab kaduma ka siis, kui commit'i olemasolu jääb
    # ebaselgeks (indeks == HEAD → ükski teine commit ei muuda seda teost). Töökausta ei puuduta.
    from ..git_ops import git_write_lock
    try:
        with git_write_lock:
            repo.git.reset("-q", "HEAD", "--", slug)
    except Exception:
        logger.exception("Asenduse taaste: indeksi lähtestus ebaõnnestus (%s, %s)", slug, upload_id)
        return "index_failed"
    try:
        leitud = find_replace_commit(repo, progress["old_head"], slug, upload_id)
    except ReplaceCommitUnknown:
        logger.error("Asenduse commit ebaselge (%s, %s) — märk ja taasteinfo jäävad", slug, upload_id)
        return "commit_unknown"
    if leitud:
        upload_ops._set_replace_phase(upload_id, "replaced", slug=slug)
        progress = {**progress, "phase": "replaced"}
        return _jarelsammud()
    try:
        restore_replace(work_dir, progress, repo)
    except RestoreError as e:
        logger.error("Asenduse taaste ebaõnnestus (%s, %s): %s — märk jääb", slug, upload_id, e)
        return "restore_failed"
    upload_ops._clear_replace_progress(upload_id)
    replace_marker.remove_marker(slug)
    return "restored"


def recover(upload_id: str, slug: str) -> str:
    """`recover_locked` teose luku all (käivitusaegne taaste, kohene taaste erindi järel)."""
    from .. import upload_ops
    from ..admin_page_ops import work_lock

    work_dir = os.path.join(upload_ops.BASE_DIR, slug)
    with replace_marker.marker_owner(upload_id):
        with work_lock(slug, work_dir):
            return recover_locked(upload_id, slug, work_dir)


def recover_all() -> None:
    """Serveri käivitusel, ENNE päringute vastuvõtmist: iga asendusmärgi kohta `recover`.

    Sünkroonne, sest pärast katkestust võib ühises indeksis olla asenduse `git add`:
    ükski teine commit ei tohi seda kaasa võtta enne, kui taaste on indeksi puhastanud.
    Ei kuku — taastamata teos jääb märgi tõttu kirjutamiseks lukku.
    """
    indeks_katki = []
    for slug, m in replace_marker.list_markers():
        uid = m.get("upload_id")
        try:
            tulemus = recover(uid, slug)
            logger.warning("Asenduse taaste käivitusel: %s (%s) → %s", slug, uid, tulemus)
            if tulemus == "index_failed":
                indeks_katki.append(slug)
        except Exception as e:
            logger.exception("Asenduse taaste käivitusel ebaõnnestus: %s (%s)", slug, uid)
            try:
                from ..client_errors import record_server_error
                record_server_error("server:thread", e)
            except Exception:
                pass
    if indeks_katki:
        # Fail-fast (PR #881 5. voor): ühises indeksis võib olla asendusega seotud vananenud
        # või stage'itud seis — ükski päring ei tohi enne commit'ida. Server ei käivitu.
        raise RuntimeError(
            f"Lehestiku asenduse taaste: git-indeksit ei saanud sünkroonida ({', '.join(indeks_katki)}). "
            "Server ei käivitu, et ükski commit ei võtaks asenduse seisu kaasa. Kontrolli /data git-repot.")
