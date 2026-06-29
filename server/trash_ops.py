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

    # ÜKS git log läbi kogu ajaloo kõigi teose-kustutamise commitide kohta.
    # (Varem: eraldi git log iga prügikasti kausta kohta → O(N × täisajalugu);
    #  139 kausta ~10.6s, mis ületas kliendi 10s timeout'i. Nüüd üks pass ~0.1s.)
    delete_commits = {}  # work_id -> (commit_hash, title)
    try:
        log_output = repo.git.log('--all', '--oneline', '--grep', 'Kustuta teos:').strip()
        for line in log_output.split('\n'):
            if not line:
                continue
            commit_hash, _, commit_msg = line.partition(' ')
            # Greedy pealkiri + lõpuankur, et brackets pealkirjas ei segaks work_id parsimist
            m = re.match(r'Kustuta teos: (.+) \[([^\]]+)\]\s*$', commit_msg)
            if not m:
                continue
            work_id = m.group(2)
            # git log on uusim-ees: hoia esimene (uusim) kirje work_id kohta
            if work_id not in delete_commits:
                delete_commits[work_id] = (commit_hash, m.group(1))
    except Exception as e:
        logger.warning(f"TRASH: git log ebaõnnestus: {e}")

    deleted_works = []
    for entry in os.scandir(TRASH_DIR):
        if not entry.is_dir():
            continue

        work_id = entry.name
        if work_id not in delete_commits:
            # Ei leitud teose kustutamise committi — ainult leheküljed kustutati, mitte teos
            continue

        commit_hash, title = delete_commits[work_id]
        jpg_count = sum(
            1 for f in os.listdir(entry.path)
            if f.lower().endswith(('.jpg', '.jpeg', '.png'))
        )

        item = {
            'work_id': work_id,
            'title': title,
            'deleted_at': None,
            'deleted_by': None,
            'commit_hash': commit_hash,
            'jpg_count': jpg_count,
        }

        try:
            commit = repo.commit(commit_hash)
            item['deleted_at'] = commit.committed_datetime.isoformat()
            item['deleted_by'] = commit.author.name
        except Exception as e:
            logger.warning(f"TRASH: commit {commit_hash} lugemine ebaõnnestus teosel {work_id}: {e}")

        deleted_works.append(item)

    # Uuemad ees
    deleted_works.sort(key=lambda x: x['deleted_at'] or '', reverse=True)
    return deleted_works


def restore_deleted_work(work_id, username="VUTT Server"):
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
        actor = Actor(username, f"{username}@vutt.local")
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


def list_deleted_pages(work_id, folder_name):
    """Loetleb teose kustutatud leheküljed (._trash/{work_id}/pages/)."""
    trash_pages_dir = os.path.join(TRASH_DIR, work_id, 'pages')
    if not os.path.exists(trash_pages_dir):
        return []

    repo = get_or_init_repo()
    pages = []

    for fname in sorted(os.listdir(trash_pages_dir)):
        if not fname.lower().endswith(('.jpg', '.jpeg', '.png')):
            continue
        base = os.path.splitext(fname)[0]

        item = {
            'filename': fname,
            'base_name': base,
            'deleted_at': None,
            'deleted_by': None,
            'commit_hash': None,
        }

        try:
            log_output = repo.git.log(
                '--all', '--oneline',
                '--grep', f'{folder_name}/{base}'
            ).strip()
            if log_output:
                first_line = log_output.split('\n')[0]
                commit_hash = first_line.split(' ', 1)[0]
                commit = repo.commit(commit_hash)
                item['commit_hash'] = commit_hash
                item['deleted_at'] = commit.committed_datetime.isoformat()
                item['deleted_by'] = commit.author.name
        except Exception as e:
            logger.warning(f"TRASH: Ei leidnud leheküljecommiti {folder_name}/{base}: {e}")

        pages.append(item)

    return pages


def restore_deleted_page(work_id, folder_name, filename, username="VUTT Server"):
    """
    Taastab kustutatud lehekülje prügikastist.

    1. Leia kustutamise commit gitist
    2. git checkout {commit}^ -- folder/base.txt .json
    3. Liiguta JPG tagasi teose kausta
    4. Git commit
    5. Meilisearch sync
    """
    base = os.path.splitext(filename)[0]
    trash_pages_dir = os.path.join(TRASH_DIR, work_id, 'pages')
    img_path = os.path.join(trash_pages_dir, filename)

    if not os.path.exists(img_path):
        return {'ok': False, 'error': 'Kustutatud faili ei leitud prügikastis'}

    work_path = os.path.join(BASE_DIR, folder_name)
    if not os.path.exists(work_path):
        return {'ok': False, 'error': 'Teose kataloog ei leitud'}

    repo = get_or_init_repo()

    # 1. Leia kustutamise commit
    try:
        log_output = repo.git.log(
            '--all', '--oneline',
            '--grep', f'{folder_name}/{base}'
        ).strip()
        if not log_output:
            return {'ok': False, 'error': 'Git kustutamise committi ei leitud'}
        first_line = log_output.split('\n')[0]
        commit_hash = first_line.split(' ', 1)[0]
    except Exception as e:
        return {'ok': False, 'error': f'Git otsing ebaõnnestus: {e}'}

    # 2. Taasta .txt ja .json parent commitist
    restored = []
    for ext in ['.txt', '.json']:
        rel_path = f"{folder_name}/{base}{ext}"
        try:
            repo.git.checkout(f'{commit_hash}^', '--', rel_path)
            restored.append(ext)
        except Exception as e:
            logger.warning(f"TRASH: Ei saanud taastada {rel_path}: {e}")

    if not restored:
        return {'ok': False, 'error': 'Faile ei õnnestunud gitist taastada'}

    # 3. Liiguta JPG tagasi teose kausta
    try:
        shutil.move(img_path, os.path.join(work_path, filename))
    except Exception as e:
        return {'ok': False, 'error': f'Pildi liigutamine ebaõnnestus: {e}'}

    # 4. Git commit
    try:
        actor = Actor(username, f"{username}@vutt.local")
        repo.index.commit(
            f"Taasta leht: {folder_name}/{base} [{work_id}]",
            author=actor, committer=actor
        )
        logger.info(f"TRASH: Taastatud leht {folder_name}/{base}")
    except Exception as e:
        logger.warning(f"TRASH: Taastamise commit ebaõnnestus: {e}")

    # 5. Meilisearch sync
    try:
        sync_work_to_meilisearch(folder_name)
    except Exception as e:
        logger.warning(f"TRASH: Meilisearch sync ebaõnnestus: {e}")

    return {'ok': True}
