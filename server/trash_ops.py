"""
Prügikasti operatsioonid (kustutatud teosed).

Prügikast asub BASE_DIR/._trash/{work_id}/ — punkt-prefiks tagab, et
metadata_watcher_loop seda ignoreerib.
"""
import os
import re
import shutil

from git import Actor

from .config import BASE_DIR, get_logger
from .git_ops import get_or_init_repo
from .utils import WORK_ID_CACHE
from .meilisearch_ops import sync_work_to_meilisearch

logger = get_logger(__name__)

TRASH_DIR = os.path.join(BASE_DIR, '._trash')


def list_deleted_works():
    """Loetleb kõik prügikastis olevad teosed, ristviitab git logiga."""
    if not os.path.exists(TRASH_DIR):
        return []

    repo = get_or_init_repo()
    deleted_works = []

    for entry in os.scandir(TRASH_DIR):
        if not entry.is_dir():
            continue

        work_id = entry.name
        jpg_count = sum(
            1 for f in os.listdir(entry.path)
            if f.lower().endswith(('.jpg', '.jpeg', '.png'))
        )

        item = {
            'work_id': work_id,
            'title': work_id,
            'deleted_at': None,
            'deleted_by': None,
            'commit_hash': None,
            'jpg_count': jpg_count,
        }

        try:
            log_output = repo.git.log(
                '--all', '--oneline',
                '--grep', f'\\[{work_id}\\]'
            ).strip()
            if log_output:
                # Võta esimene rida (uusim commit)
                first_line = log_output.split('\n')[0]
                commit_hash = first_line.split(' ', 1)[0]
                commit_msg = first_line.split(' ', 1)[1] if ' ' in first_line else ''

                title_match = re.match(
                    r'Kustuta teos: (.+?) \[' + re.escape(work_id) + r'\]',
                    commit_msg
                )
                if title_match:
                    item['title'] = title_match.group(1)

                commit = repo.commit(commit_hash)
                item['commit_hash'] = commit_hash
                item['deleted_at'] = commit.committed_datetime.isoformat()
                item['deleted_by'] = commit.author.name
        except Exception as e:
            logger.warning(f"TRASH: Ei leidnud commiti teosel {work_id}: {e}")

        deleted_works.append(item)

    # Uuemad ees
    deleted_works.sort(key=lambda x: x['deleted_at'] or '', reverse=True)
    return deleted_works


def restore_deleted_work(work_id):
    """
    Taastab kustutatud teose prügikastist.

    Sammud:
    1. Leia git kustutamise commit (commit_msg sisaldab [work_id])
    2. Leia kausta nimi kustutatud failidest (commit.stats.files)
    3. git checkout {commit}^ -- {folder} → taastab txt/json/metadata
    4. Liiguta JPG-d prügikastist tagasi
    5. Git commit (taastamine)
    6. Meilisearch sync
    7. Cache uuendamine
    8. Kustuta prügikasti kaust
    """
    trash_dir = os.path.join(TRASH_DIR, work_id)
    if not os.path.exists(trash_dir):
        return {'ok': False, 'error': 'Prügikastis ei leitud'}

    repo = get_or_init_repo()

    # 1. Leia kustutamise commit
    try:
        log_output = repo.git.log(
            '--all', '--oneline',
            '--grep', f'\\[{work_id}\\]'
        ).strip()
        if not log_output:
            return {'ok': False, 'error': 'Git kustutamise commiti ei leitud'}
        first_line = log_output.split('\n')[0]
        commit_hash = first_line.split(' ', 1)[0]
        commit_msg = first_line.split(' ', 1)[1] if ' ' in first_line else work_id
    except Exception as e:
        return {'ok': False, 'error': f'Git otsing ebaõnnestus: {e}'}

    # 2. Leia kausta nimi kustutatud failidest
    try:
        commit = repo.commit(commit_hash)
        file_paths = list(commit.stats.files.keys())
        if not file_paths:
            return {'ok': False, 'error': 'Kustutatud faile ei leitud commitist'}
        folder_name = file_paths[0].split('/')[0]
    except Exception as e:
        return {'ok': False, 'error': f'Commiti failide lugemine ebaõnnestus: {e}'}

    folder_path = os.path.join(BASE_DIR, folder_name)

    # 3. Kontrolli et sihtkoht pole juba olemas
    if os.path.exists(folder_path):
        return {'ok': False, 'error': f'Kaust {folder_name} on juba olemas'}

    # 4. Git checkout — taasta txt/json/metadata parent commitist
    try:
        repo.git.checkout(f'{commit_hash}^', '--', folder_name)
    except Exception as e:
        return {'ok': False, 'error': f'Git checkout ebaõnnestus: {e}'}

    # 5. Liiguta JPG-d prügikastist tagasi
    try:
        for fname in os.listdir(trash_dir):
            if fname.lower().endswith(('.jpg', '.jpeg', '.png')):
                shutil.move(
                    os.path.join(trash_dir, fname),
                    os.path.join(folder_path, fname)
                )
    except Exception as e:
        return {'ok': False, 'error': f'JPG-de liigutamine ebaõnnestus: {e}'}

    # 6. Git commit — taastamise commit
    title = work_id
    try:
        title_match = re.match(r'Kustuta teos: (.+?) \[', commit_msg)
        if title_match:
            title = title_match.group(1)
        actor = Actor("VUTT Server", "vutt@server.local")
        restore_msg = f"Taasta teos: {title} [{work_id}]"
        repo.index.commit(restore_msg, author=actor, committer=actor)
        logger.info(f"TRASH: Taastatud teos {folder_name} [{work_id}]")
    except Exception as e:
        logger.warning(f"TRASH: Taastamise commit ebaõnnestus: {e}")

    # 7. Meilisearch sync
    try:
        sync_work_to_meilisearch(folder_name)
    except Exception as e:
        logger.warning(f"TRASH: Meilisearch sync ebaõnnestus: {e}")

    # 8. Cache uuendamine
    WORK_ID_CACHE[work_id] = folder_path

    # 9. Kustuta prügikasti kaust
    try:
        shutil.rmtree(trash_dir)
    except Exception as e:
        logger.warning(f"TRASH: Prügikasti kustutamine ebaõnnestus: {e}")

    return {'ok': True, 'folder_name': folder_name, 'title': title}
