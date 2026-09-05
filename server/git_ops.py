"""
Git versioonihalduse operatsioonid.
"""
import os
import json
import re
import subprocess
import threading
import time
from collections import deque
from datetime import datetime
from git import Repo, Actor
from git.exc import InvalidGitRepositoryError, GitCommandError
from .config import BASE_DIR, get_logger
from .utils import atomic_write_text, sanitize_id

logger = get_logger(__name__)


def _parse_person_name_from_message(message: str) -> str:
    """Parsib isiku nime commit-sõnumist.
    'Prosopo muudatus: Hans Ludenius [vutt:Pabc]' → 'Hans Ludenius'
    'Prosopo liitmine: A → B' → 'A → B'
    """
    m = re.search(r':\s*(.+?)(?:\s*\[vutt:P[^\]]+\])?$', message.strip())
    return m.group(1).strip() if m else message.strip()


# Git repo globaalne muutuja (initsialiseeritakse esimesel kasutamisel)
_git_repo = None

# Git commit ebaõnnestumiste jälgimine (viimased 100)
_git_failures = deque(maxlen=100)
_git_failures_lock = threading.Lock()

# Gitil on kogu repo kohta üks index.lock. Kuuma salvestustee write+add+commit
# peab olema protsessi sees järjestatud, et samaaegsed salvestused ei saaks
# teineteise sisu vale autori commiti sisse stage'ida.
_git_write_lock = threading.RLock()

# Cache teose ID-de jaoks (kausta nimi -> (work_id, slug))
_work_ids_cache = {}

# Cache teose info jaoks (kausta nimi -> {work_id, slug, title, year, author})
_work_info_cache = {}


def _decode_git_path(fp: str) -> str:
    """Dekodeerib git-i tsiteeritud tee.

    Git tsiteerib non-ASCII tähemärke sisaldavad teed jutumärkidega ja kodeerib
    need oktal-escape'idena (nt å → \\303\\245). Ilma dekodeerimiseta lõpeb
    fname jutumärgiga ja .txt/.json kontrollid ebaõnnestuvad.
    """
    if not (fp.startswith('"') and fp.endswith('"')):
        return fp
    raw = re.sub(r'\\([0-7]{3})', lambda m: chr(int(m.group(1), 8)), fp[1:-1])
    try:
        return raw.encode('latin-1').decode('utf-8')
    except (UnicodeDecodeError, UnicodeEncodeError):
        return raw


def get_work_ids_from_folder(folder_name):
    """
    Leiab teose ID-d kausta nime järgi.

    Tagastab: (work_id, slug)
    - work_id: nanoid _metadata.json `id` väljast
    - slug: _metadata.json `slug` väljast

    Kasutab cache'i, et vältida korduvaid faililugemisi.
    """
    if folder_name in _work_ids_cache:
        return _work_ids_cache[folder_name]

    metadata_path = os.path.join(BASE_DIR, folder_name, '_metadata.json')
    work_id = None
    slug = None

    if os.path.exists(metadata_path):
        try:
            with open(metadata_path, 'r', encoding='utf-8') as f:
                meta = json.load(f)
                work_id = meta.get('id')
                slug = meta.get('slug')
        except (json.JSONDecodeError, IOError):
            pass

    # Fallback slug: sanitize kausta nimi (uute kaustade jaoks)
    if not slug:
        slug = sanitize_id(folder_name)

    _work_ids_cache[folder_name] = (work_id, slug)
    return work_id, slug


def get_work_info_from_folder(folder_name):
    """
    Tagastab teose põhiinfo kausta nime järgi.

    Tagastab dict:
    - work_id: nanoid
    - slug: human-readable ID
    - title: pealkiri
    - year: aasta
    - author: autor (praeses või auctor)
    - collections: teose kollektsioonide ID-d

    Kasutab cache'i.
    """
    if folder_name in _work_info_cache:
        return _work_info_cache[folder_name]

    metadata_path = os.path.join(BASE_DIR, folder_name, '_metadata.json')
    info = {
        'work_id': None,
        'slug': sanitize_id(folder_name),
        'title': None,
        'year': None,
        'author': None,
        'collections': []
    }

    if os.path.exists(metadata_path):
        try:
            with open(metadata_path, 'r', encoding='utf-8') as f:
                meta = json.load(f)
                info['work_id'] = meta.get('id')
                info['slug'] = meta.get('slug') or info['slug']
                info['title'] = meta.get('title')
                info['year'] = meta.get('year')
                info['collections'] = meta.get('collections') or []

                # Autor creators massiivist
                creators = meta.get('creators', [])
                if creators:
                    praeses = next((c for c in creators if c.get('role') == 'praeses'), None)
                    auctor = next((c for c in creators if c.get('role') == 'auctor'), None)
                    if auctor:
                        info['author'] = auctor.get('name')
                    elif praeses:
                        info['author'] = praeses.get('name')
                    elif creators:
                        info['author'] = creators[0].get('name')
        except (json.JSONDecodeError, IOError):
            pass

    _work_info_cache[folder_name] = info
    return info


def _invalidate_work_info(relative_paths):
    """Unustab teose info cache'i, kui `_metadata.json` muutus.

    Cache kannab nüüd ka `collections`-i (Review kollektsioonifilter), seega
    aegunud kirje ei näitaks enam ainult vana pealkirja, vaid paigutaks teose
    muudatuste vaates valesse kollektsiooni.
    """
    for rel in relative_paths:
        parts = rel.replace(os.sep, '/').split('/')
        if len(parts) >= 2 and parts[-1] == '_metadata.json':
            _work_info_cache.pop(parts[0], None)


# Cache piltide nimekirja jaoks (kausta nimi -> sorteeritud piltide nimekiri)
_images_cache = {}


def _get_page_sequence_for_img(folder_path, img_name):
    """Loeb sequence välja lehekülje JSON-failist (sama loogika nagu meilisearch_ops-is)."""
    json_path = os.path.join(folder_path, os.path.splitext(img_name)[0] + '.json')
    if os.path.exists(json_path):
        try:
            with open(json_path, 'r', encoding='utf-8') as f:
                d = json.load(f)
                seq = d.get('sequence') or d.get('meta_content', {}).get('sequence')
                if seq is not None:
                    return int(seq)
        except Exception:
            pass
    return float('inf')


def _build_images_list(folder_path):
    """Tagastab sorteeritud piltide nimekirja, kasutades sequence-põhist sortimist (nagu Meilisearch)."""
    raw = [f for f in os.listdir(folder_path)
           if f.lower().endswith(('.jpg', '.jpeg', '.png')) and not f.startswith('_thumb_')]
    return sorted(raw, key=lambda f: (_get_page_sequence_for_img(folder_path, f), f))


def get_page_number_from_txt(folder_name, txt_filename):
    """
    Leiab lehekülje numbri txt-faili järgi.

    Kasutab sequence-põhist sortimist (sama mis meilisearch_ops), et numbrid
    klapsaksid Workspace URL-iga.

    Args:
        folder_name: Kausta nimi (nt "1632-1")
        txt_filename: Tekstifaili nimi (nt "lk_003.txt")

    Returns:
        int: Lehekülje number (1-indekseeritud) või 1 kui ei leia
    """
    if folder_name not in _images_cache:
        folder_path = os.path.join(BASE_DIR, folder_name)
        if os.path.exists(folder_path):
            _images_cache[folder_name] = _build_images_list(folder_path)
        else:
            _images_cache[folder_name] = []

    images = _images_cache[folder_name]
    if not images:
        return 1

    # Leia vastav pilt (sama base name)
    txt_base = txt_filename.rsplit('.', 1)[0]  # "lk_003.txt" -> "lk_003"

    for i, img in enumerate(images):
        img_base = img.rsplit('.', 1)[0]  # "lk_003.jpg" -> "lk_003"
        if img_base == txt_base:
            return i + 1  # 1-indekseeritud

    # Fallback: proovi number failinimest
    numbers = re.findall(r'\d+', txt_base)
    if numbers:
        return int(numbers[-1])

    return 1


def get_or_init_repo():
    """
    Tagastab Git repo objekti andmekausta jaoks.
    Initsialiseerib repo, kui see puudub.
    """
    global _git_repo

    if _git_repo is not None:
        return _git_repo

    try:
        _git_repo = Repo(BASE_DIR)
        logger.info(f"Git repo leitud: {BASE_DIR}")
    except InvalidGitRepositoryError:
        _git_repo = Repo.init(BASE_DIR)
        logger.info(f"Git repo initsialiseeritud: {BASE_DIR}")

        # Loome .gitignore, et ignoreerida pilte ja muid suuri faile
        gitignore_path = os.path.join(BASE_DIR, '.gitignore')
        if not os.path.exists(gitignore_path):
            with open(gitignore_path, 'w') as f:
                f.write("# VUTT Git versioonihaldus\n")
                f.write("# Jälgime .txt ja .json faile, ignoreerime pilte\n")
                f.write("*.jpg\n")
                f.write("*.jpeg\n")
                f.write("*.png\n")
                f.write("*.backup.*\n")  # Vanad backup failid
            logger.info("Loodud .gitignore")

    return _git_repo


def _record_git_failure(filepath, username, error):
    """Salvestab git commit ebaõnnestumise info."""
    with _git_failures_lock:
        _git_failures.append({
            "timestamp": datetime.now().isoformat(),
            "filepath": filepath,
            "username": username,
            "error": str(error)
        })


def get_git_failures():
    """Tagastab viimased git commit ebaõnnestumised."""
    with _git_failures_lock:
        return list(_git_failures)


def clear_git_failures():
    """Tühjendab ebaõnnestumiste nimekirja."""
    with _git_failures_lock:
        _git_failures.clear()


GIT_COMMIT_GRAPH_INTERVAL = int(os.getenv("GIT_COMMIT_GRAPH_INTERVAL", "300"))


def update_git_commit_graph():
    """Uuendab failiajaloo Bloom-filtritega commit-graph'i.

    ``--changed-paths`` kiirendab ``git log -- <fail>`` päringuid suures data-repos
    kümneid kordi. Split-režiim lisab tavaliselt ainult vahepealsed commitid ega
    kirjuta iga kord kogu graafi uuesti.
    """
    repo = get_or_init_repo()
    started = time.monotonic()
    try:
        repo.git.commit_graph("write", "--reachable", "--changed-paths", "--split")
        elapsed = time.monotonic() - started
        logger.info(f"Git commit-graph uuendatud: {elapsed:.2f}s")
        return True
    except Exception as e:
        logger.warning(f"Git commit-graph uuendamine ebaõnnestus: {e}")
        return False


def _git_commit_graph_loop():
    while True:
        update_git_commit_graph()
        time.sleep(GIT_COMMIT_GRAPH_INTERVAL)


def start_git_commit_graph_loop():
    """Hoiab failipõhise Git-ajaloo indeksi taustal värskena."""
    threading.Thread(
        target=_git_commit_graph_loop,
        daemon=True,
        name="git-commit-graph",
    ).start()


def run_git_fsck():
    """
    Käivitab 'git fsck' repo terviklikkuse kontrolliks.

    Returns:
        dict: {"ok": bool, "output": str, "errors": str}
    """
    repo = get_or_init_repo()
    try:
        result = subprocess.run(
            ["git", "fsck", "--full"],
            cwd=repo.working_dir,
            capture_output=True,
            text=True,
            timeout=300  # 5 min max
        )
        ok = result.returncode == 0
        if not ok:
            logger.error(f"Git fsck leidis vigu: {result.stderr}")
        else:
            logger.info("Git fsck: repo terviklikkus OK")
        return {
            "ok": ok,
            "output": result.stdout,
            "errors": result.stderr
        }
    except subprocess.TimeoutExpired:
        logger.error("Git fsck aegus (>5 min)")
        return {"ok": False, "output": "", "errors": "Aegunud (timeout 5 min)"}
    except Exception as e:
        logger.error(f"Git fsck viga: {e}")
        return {"ok": False, "output": "", "errors": str(e)}


def save_with_git(filepath, content, username, message=None, additional_files=None):
    """Salvestab failid ja teeb path-skoobitud native Git CLI commiti.

    GitPythoni ``repo.index.commit`` kirjutas suure repo indeksi puhtas Pythonis
    läbi ja võttis /data repos ~1,8 s. Native git teeb sama töö ~0,15 s-ga.
    Kogu write+stage+commit tsükkel on lukus, et samaaegsed salvestused ei saaks
    teineteise faili vale autori commiti sisse stage'ida.
    """
    get_or_init_repo()  # Initsialiseerib/valideerib repo nagu varem.
    relative_path = os.path.relpath(filepath, BASE_DIR)
    extra = additional_files or []
    files_to_add = [relative_path] + [os.path.relpath(path, BASE_DIR) for path, _ in extra]
    _invalidate_work_info(files_to_add)
    git_env = os.environ.copy()
    git_env.update({
        "GIT_AUTHOR_NAME": username,
        "GIT_AUTHOR_EMAIL": f"{username}@vutt.local",
        "GIT_COMMITTER_NAME": username,
        "GIT_COMMITTER_EMAIL": f"{username}@vutt.local",
    })

    with _git_write_lock:
        # HEAD-puu kontroll vastab otse küsimusele, kas fail on juba jälgitud.
        exists_result = subprocess.run(
            ["git", "cat-file", "-e", f"HEAD:{relative_path}"],
            cwd=BASE_DIR,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        is_first_commit = exists_result.returncode != 0

        if not message:
            message = (
                f"Originaal OCR: {relative_path}"
                if is_first_commit else f"Muuda: {relative_path}"
            )

        # Kirjutamine peab olema sama luku sees kui stage'imine: muidu võiks
        # teine lõim faili kahe sammu vahel üle kirjutada.
        atomic_write_text(filepath, content)
        for add_filepath, add_content in extra:
            atomic_write_text(add_filepath, add_content)

        max_retries = 3
        for attempt in range(max_retries):
            try:
                subprocess.run(
                    ["git", "add", "--", *files_to_add],
                    cwd=BASE_DIR,
                    env=git_env,
                    check=True,
                    capture_output=True,
                    text=True,
                )

                # Muutusteta Ctrl+S ei tekita tühja commiti.
                changed = subprocess.run(
                    ["git", "diff", "--cached", "--quiet", "--", *files_to_add],
                    cwd=BASE_DIR,
                    env=git_env,
                ).returncode
                if changed == 0:
                    head = subprocess.run(
                        ["git", "rev-parse", "HEAD"],
                        cwd=BASE_DIR,
                        check=True,
                        capture_output=True,
                        text=True,
                    ).stdout.strip()
                    logger.info(f"Git commit vahele jäetud (muutusteta): {relative_path}")
                    return {
                        "success": True,
                        "commit_hash": head,
                        "is_first_commit": is_first_commit,
                        "is_noop": True,
                    }
                if changed != 1:
                    raise RuntimeError(f"git diff --cached ebaõnnestus (exit {changed})")

                # --only jätab kõik varasemad mitteseotud staged failid indeksisse.
                subprocess.run(
                    [
                        "git", "commit", "--only", "--no-verify", "--no-gpg-sign",
                        "-m", message, "--", *files_to_add,
                    ],
                    cwd=BASE_DIR,
                    env=git_env,
                    check=True,
                    capture_output=True,
                    text=True,
                )
                commit_hash = subprocess.run(
                    ["git", "rev-parse", "HEAD"],
                    cwd=BASE_DIR,
                    check=True,
                    capture_output=True,
                    text=True,
                ).stdout.strip()
                logger.info(f"Git commit: {commit_hash[:8]} - {message} (autor: {username})")
                return {
                    "success": True,
                    "commit_hash": commit_hash,
                    "is_first_commit": is_first_commit,
                }
            except (subprocess.CalledProcessError, RuntimeError) as e:
                stderr = getattr(e, "stderr", "") or ""
                error_text = f"{e}: {stderr.strip()}".strip()
                if attempt < max_retries - 1 and "index.lock" in error_text:
                    logger.warning(
                        f"Git index lukus, proovin uuesti ({attempt + 1}/{max_retries}): {relative_path}"
                    )
                    time.sleep(0.15 * (attempt + 1))
                    continue
                logger.error(
                    f"Git commit EBAÕNNESTUS: {relative_path} (kasutaja: {username}): {error_text}"
                )
                _record_git_failure(relative_path, username, e)
                return {"success": False, "error": error_text}


def get_file_git_history(paths, max_count=50):
    """
    Tagastab faili(de) Git ajaloo.

    Args:
        paths: Suhteline tee failini või failide list (BASE_DIR suhtes)
        max_count: Maksimaalne commitide arv

    Returns:
        list: Commitide nimekiri, iga element on dict
    """
    repo = get_or_init_repo()

    try:
        commits = list(repo.iter_commits(paths=paths, max_count=max_count))
    except Exception:
        return []

    if not commits:
        return []

    # Esimene commit (kõige vanem) on originaal
    original_hash = commits[-1].hexsha if commits else None

    history = []
    for commit in commits:
        history.append({
            "hash": commit.hexsha[:8],
            "full_hash": commit.hexsha,
            "author": commit.author.name,
            "date": commit.committed_datetime.isoformat(),
            "formatted_date": commit.committed_datetime.strftime("%d.%m.%Y %H:%M"),
            "message": commit.message.strip(),
            "is_original": commit.hexsha == original_hash
        })

    return history


def get_file_at_commit(relative_path, commit_hash):
    """
    Tagastab faili sisu kindlas commitist.

    Args:
        relative_path: Suhteline tee failini
        commit_hash: Commiti hash (lühike või täispikk)

    Returns:
        str: Faili sisu või None kui ei leidnud
    """
    repo = get_or_init_repo()

    try:
        content = repo.git.show(f"{commit_hash}:{relative_path}")
        return content
    except GitCommandError as e:
        logger.error(f"Git show viga: {e}")
        return None


def get_file_diff(relative_path, hash1, hash2):
    """
    Tagastab diff kahe commiti vahel.

    Args:
        relative_path: Suhteline tee failini
        hash1: Esimene commit hash
        hash2: Teine commit hash

    Returns:
        str: Diff tekst
    """
    repo = get_or_init_repo()

    try:
        diff = repo.git.diff(hash1, hash2, '--', relative_path)
        return diff
    except GitCommandError as e:
        logger.error(f"Git diff viga: {e}")
        return None


def get_commit_diff(commit_hash, filepaths=None):
    """
    Tagastab ühe commiti diff'i (võrreldes parent commitiga).

    Args:
        commit_hash: Commit hash (täis- või lühike)
        filepaths: Valikuline failirada või list radadest, et näidata ainult nende muutusi

    Returns:
        dict: {"diff": str, "additions": int, "deletions": int, "files": list}
    """
    repo = get_or_init_repo()

    # Git "empty tree" hash - kasutatakse esimese commiti võrdluseks
    EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

    try:
        commit = repo.commit(commit_hash)

        # Määra parent (esimese commiti puhul tühi puu)
        parent_hash = commit.parents[0].hexsha if commit.parents else EMPTY_TREE

        # Koosta argumentide list
        args = [parent_hash, commit.hexsha, '--']
        if filepaths:
            if isinstance(filepaths, list):
                args.extend(filepaths)
            else:
                args.append(filepaths)
        
        # Käivita git diff
        diff_text = repo.git.diff(*args)
        
        # Loe statistika
        # numstat puhul peame samuti failid ette andma
        stat_args = [parent_hash, commit.hexsha, '--numstat', '--']
        if filepaths:
            if isinstance(filepaths, list):
                stat_args.extend(filepaths)
            else:
                stat_args.append(filepaths)
                
        stat = repo.git.diff(*stat_args)
        
        additions = 0
        deletions = 0
        files = []
        
        for line in stat.strip().split('\n'):
            if line:
                parts = line.split('\t')
                if len(parts) >= 3:
                    try:
                        additions += int(parts[0]) if parts[0] != '-' else 0
                        deletions += int(parts[1]) if parts[1] != '-' else 0
                        files.append(parts[2])
                    except ValueError:
                        pass
        
        return {
            "diff": diff_text,
            "additions": additions,
            "deletions": deletions,
            "files": files
        }
    except GitCommandError as e:
        logger.error(f"Git commit diff viga: {e}")
        return None
    except Exception as e:
        logger.error(f"Commiti diff viga: {e}")
        return None


def commit_new_work_to_git(dir_name, username=None):
    """Lisab uue teose txt ja json failid Git reposse originaal-OCR commitina.

    Args:
        dir_name: Kausta nimi (nt "1632-1")
        username: Commit'i autor. Kui None, kasutatakse "Automaatne" (automaatne import).
    """
    try:
        repo = get_or_init_repo()
        dir_path = os.path.join(BASE_DIR, dir_name)

        # Leia kõik txt ja json failid kaustas
        files_to_add = []
        txt_count = 0
        json_count = 0
        for f in os.listdir(dir_path):
            if f.endswith('.txt'):
                relative_path = os.path.join(dir_name, f)
                files_to_add.append(relative_path)
                txt_count += 1
            elif f.endswith('.json'):
                relative_path = os.path.join(dir_name, f)
                files_to_add.append(relative_path)
                json_count += 1

        if not files_to_add:
            return False

        # Lisa failid indeksisse
        repo.index.add(files_to_add)

        # Tee commit
        author_name = username if username else "Automaatne"
        author = Actor(author_name, f"{author_name}@vutt.local")
        repo.index.commit(
            f"Originaal OCR: {dir_name} ({txt_count} lehekülge, {json_count} json)",
            author=author,
            committer=author
        )
        logger.info(f"GIT: Lisatud uus teos {dir_name} ({txt_count} txt, {json_count} json)")
        return True
    except Exception as e:
        logger.error(f"GIT viga uue teose lisamisel ({dir_name}): {e}")
        _record_git_failure(dir_name, username or "Automaatne", e)
        return False


def delete_work_from_git(folder_name, work_title, work_id, username="VUTT Server"):
    """
    Eemaldab teose jälgitud failid gitist ja teeb commit.
    JPG-d peavad olema ENNE seda liigutatud prügikasti.
    Kasutab git add -u (ainult jälgitud failid: txt, json, _metadata.json).
    """
    try:
        repo = get_or_init_repo()
        # Stage deletions (ainult jälgitud failid)
        repo.git.add('-u', folder_name)
        # Kontrolli kas on midagi stageitud
        if not repo.index.diff('HEAD'):
            logger.info(f"GIT: Teosel {folder_name} polnud jälgitud faile, commit vahele jäetud")
            return False
        actor = Actor(username, f"{username}@vutt.local")
        msg = f"Kustuta teos: {work_title} [{work_id}]"
        repo.index.commit(msg, author=actor, committer=actor)
        logger.info(f"GIT: Kustutatud teos {folder_name} [{work_id}]")
        return True
    except Exception as e:
        logger.error(f"GIT viga teose kustutamisel ({folder_name}): {e}")
        return False


def delete_page_from_git(folder_name: str, base_name: str, commit_msg: str, username: str = "VUTT Server") -> bool:
    """
    Stage'ib lehe .txt ja .json kustutamise gitist ja teeb commit.
    .jpg peab olema ENNE seda liigutatud prügikasti (ei ole git-tracked).

    Args:
        folder_name: Kausta nimi (nt "1632-1")
        base_name: Faili põhinimi ilma laiendita (nt "lk_003")
        commit_msg: Commit sõnum
        username: Commit'i autor (vaikimisi "VUTT Server")

    Returns:
        bool: True kui õnnestus
    """
    try:
        repo = get_or_init_repo()
        # Stage ainult selle lehe failid (txt + json)
        files_to_remove = []
        for ext in ['.txt', '.json']:
            rel_path = os.path.join(folder_name, base_name + ext)
            abs_path = os.path.join(BASE_DIR, rel_path)
            if os.path.exists(abs_path):
                # Eemalda failisüsteemist ja stage kustutamine
                try:
                    repo.index.remove([rel_path])
                    os.remove(abs_path)
                    files_to_remove.append(rel_path)
                except Exception as e:
                    logger.warning(f"GIT: Ei saanud eemaldada {rel_path}: {e}")
                    # Proovi git rm otse
                    try:
                        repo.git.rm('--cached', rel_path)
                        os.remove(abs_path)
                        files_to_remove.append(rel_path)
                    except Exception as e2:
                        logger.error(f"GIT: Faili eemaldamine ebaõnnestus {rel_path}: {e2}")

        if not files_to_remove:
            logger.info(f"GIT: Teosel {folder_name}/{base_name} polnud jälgitud faile, commit vahele jäetud")
            return False

        actor = Actor(username, f"{username}@vutt.local")
        repo.index.commit(commit_msg, author=actor, committer=actor)
        logger.info(f"GIT: Kustutatud leht {folder_name}/{base_name}")
        return True
    except Exception as e:
        logger.error(f"GIT viga lehe kustutamisel ({folder_name}/{base_name}): {e}")
        return False


def delete_pages_from_git(folder_name, base_names, commit_msg, username="VUTT Server"):
    """Stage'ib mitme lehe .txt ja .json kustutamise ja teeb ÜHE commiti.

    .jpg-d peavad olema ENNE liigutatud prügikasti (ei ole git-tracked).
    Commiti ebaõnnestumisel lähtestab staging'u SKOOBITULT (ainult need teed),
    et repo ei jääks poolikusse seisu, ja viskab erindi edasi.

    Returns: eemaldatud relatiivsete teede list.
    """
    repo = get_or_init_repo()
    removed = []
    for base in base_names:
        for ext in ('.txt', '.json'):
            rel_path = os.path.join(folder_name, base + ext)
            abs_path = os.path.join(BASE_DIR, rel_path)
            if os.path.exists(abs_path):
                try:
                    repo.index.remove([rel_path])
                    os.remove(abs_path)
                    removed.append(rel_path)
                except Exception:
                    repo.git.rm('--cached', rel_path)
                    os.remove(abs_path)
                    removed.append(rel_path)

    if not removed:
        return []

    try:
        actor = Actor(username, f"{username}@vutt.local")
        repo.index.commit(commit_msg, author=actor, committer=actor)
    except Exception:
        # Skoobitud rollback: un-stage ainult need teed ja taasta tööpuu failid HEAD-ist.
        try:
            repo.git.reset('--', *removed)
            repo.git.checkout('HEAD', '--', *removed)
        except Exception as re:
            logger.error(f"GIT: batch-kustutuse rollback ebaõnnestus: {re}")
        raise

    logger.info(f"GIT: batch-kustutatud {len(removed)} faili kaustast {folder_name}")
    return removed


def delete_file_from_git(absolute_path: str, commit_msg: str, username: str = "VUTT Server") -> bool:
    """
    Eemaldab faili gitist ja teeb commit.
    Erinevalt delete_page_from_git()-st võtab absoluutse tee (mitte folder/base).
    """
    repo = get_or_init_repo()
    relative_path = os.path.relpath(absolute_path, BASE_DIR)
    staged = False
    try:
        if os.path.exists(absolute_path):
            try:
                repo.index.remove([relative_path])
                staged = True
            except Exception as e:
                logger.warning(f"GIT: index.remove ebaõnnestus ({relative_path}): {e}")
                try:
                    repo.git.rm("--cached", relative_path)
                    staged = True
                except Exception as e2:
                    logger.error(f"GIT: git rm --cached ebaõnnestus ({relative_path}): {e2}")
            if staged:
                os.remove(absolute_path)
        else:
            try:
                repo.git.rm("--cached", relative_path)
                staged = True
            except Exception:
                logger.info(f"GIT: Fail pole gitis jälgitud, kustutamine vahele jäetud: {relative_path}")
                return False

        if not staged:
            logger.info(f"GIT: Midagi ei staged, commit vahele jäetud: {relative_path}")
            return False

        actor = Actor(username, f"{username}@vutt.local")
        repo.index.commit(commit_msg, author=actor, committer=actor)
        logger.info(f"GIT: Kustutatud {relative_path} ({username})")
        return True
    except Exception as e:
        logger.error(f"GIT viga faili kustutamisel ({relative_path}): {e}")
        return False


def _get_changed_paths_by_commit(repo, max_commits, username=None):
    """Loeb commitite failiteed ühe git-protsessiga.

    ``Commit.stats`` käivitab iga commiti kohta eraldi ``git diff`` protsessi;
    Review-vaates tähendas see tavaliselt üle saja protsessi. NUL-eraldajaga
    log säilitab ka tühikute ja mitte-ASCII märkidega failinimed.

    ``username`` antakse gitile edasi (``--author``), et skanniaken loeks
    kasutaja ENDA commite, mitte kõiki. Vt ``get_recent_commits``.
    """
    marker = "VUTT_COMMIT:"
    args = [f"--format={marker}%H", "--name-only", "-z"]
    if max_commits is not None:
        args.insert(0, f"--max-count={max_commits}")
    args.extend(_author_log_args(username))
    output = repo.git.log(*args)
    paths_by_hash = {}
    current_hash = None
    for raw_part in output.split("\0"):
        part = raw_part.lstrip("\n")
        if not part:
            continue
        if part.startswith(marker):
            current_hash = part[len(marker):].strip()
            paths_by_hash[current_hash] = []
        elif current_hash is not None:
            paths_by_hash[current_hash].append(part)
    return paths_by_hash


def _author_log_args(username):
    """git log argumendid autori järgi filtreerimiseks.

    ``--fixed-strings`` on tahtlik: ``--author`` on muidu regex ja nimest
    tehtud muster võiks vaikselt MITTE sobituda (kasutaja näeks tühja ajalugu).
    Fikseeritud string sobitub alati üle, mitte alla — täpse nime kontrolli
    teeb niikuinii Python (``commit.author.name == username``).
    """
    if not username:
        return []
    return ["--fixed-strings", f"--author={username}"]


def _collection_scope_ids(collection_id):
    """Valitud kollektsioon + kõik selle alamkollektsioonid.

    Sama semantika mis Meili ``collections_hierarchy`` filtril: teos kuulub
    valikusse, kui mõni ta kollektsioonidest on valitu ise või selle järglane.
    Autoriteet teose kuuluvuse üle jääb ``_metadata.json``-ile (ADR 0007) —
    siin loetakse ainult kollektsioonipuu kuju.
    """
    # Laisk import: server.cache → meilisearch_ops → git_ops oleks tsükkel.
    from .cache import get_cached_collections

    scope = {collection_id}
    try:
        collections = get_cached_collections() or {}
    except Exception as e:
        logger.warning(f"Kollektsioonipuu lugemine ebaõnnestus: {e}")
        return scope

    changed = True
    while changed:  # puu on madal, praktikas paar iteratsiooni
        changed = False
        for cid, col in collections.items():
            if cid not in scope and (col or {}).get("parent") in scope:
                scope.add(cid)
                changed = True
    return scope


def _scan_commits(repo, window, username, collection_ids, limit, skip):
    """Skannib `window` commiti (None = kogu ajalugu) ja koostab tulemused.

    Tagastab (results, has_more, scanned), kus `scanned` on läbi vaadatud
    commitite arv — kutsuja järeldab sellest, kas ajalugu sai otsa.
    """
    try:
        iter_kwargs = {}
        if window is not None:
            iter_kwargs["max_count"] = window
        if username:
            iter_kwargs["fixed_strings"] = True
            iter_kwargs["author"] = username
        all_commits = list(repo.iter_commits(**iter_kwargs))
    except Exception:
        return [], False, 0

    try:
        changed_paths = _get_changed_paths_by_commit(repo, window, username)
    except Exception as e:
        # Ühilduvusfallback ebatavalise/vana git-versiooni jaoks.
        logger.warning(f"Git failiteede koondlugemine ebaõnnestus: {e}")
        changed_paths = None

    results = []
    seen_files = set()  # Vältimaks duplikaate sama faili kohta
    skipped = 0
    has_more = False

    for commit in all_commits:
        # Filtreeri kasutaja järgi (kui määratud). Git on juba kitsendanud,
        # aga --fixed-strings sobitub üle: siin käib täpne kontroll.
        if username and commit.author.name != username:
            continue

        # Jäta vahele automaatsed commitid
        if commit.author.name == "Automaatne":
            continue

        # Leia muudetud failid selles commitis
        try:
            # Tavatee kasutab ülal ühe git-protsessiga loetud failinimesid.
            # Fallback käivitab vana GitPythoni stats-päringu commiti kaupa.
            file_paths = (
                changed_paths.get(commit.hexsha, [])
                if changed_paths is not None
                else list(commit.stats.files.keys())
            )

            # Impordi commit: sisaldab kõiki lehe txt-faile + _metadata.json.
            # Näitame ainult ÜHT kirjet teose kohta (change_type="import").
            is_import_commit = commit.message.strip().startswith("Originaal OCR:")

            for filepath in file_paths:
                filepath = _decode_git_path(filepath)
                if not filepath:
                    continue

                # Parsi kausta nimi failiteest
                parts = filepath.split('/')
                if len(parts) < 2:
                    continue

                folder_name = parts[0]
                filename = parts[-1]

                # Käsitle erinevaid failitüüpe
                is_txt = filename.endswith('.txt')
                is_metadata = filename == '_metadata.json'

                # Prosopo failid: config/prosopography/{nanoid}.json
                is_prosopo = (
                    len(parts) >= 3
                    and parts[0] == "config"
                    and parts[1] == "prosopography"
                    and filename.endswith(".json")
                    and filename not in ("prosopography_index.json",)
                )

                if is_prosopo:
                    # Isikukaart ei kuulu ühtegi kollektsiooni — kollektsiooni
                    # valides jääb ta välja, „Kõik tööd" toob tagasi.
                    if collection_ids:
                        continue
                    nanoid = filename.removesuffix(".json")
                    person_id = f"vutt:P{nanoid}"
                    file_key = f"prosopo/{commit.hexsha[:8]}"  # üks kirje per commit (merge puhuks)
                    if file_key in seen_files:
                        continue
                    seen_files.add(file_key)
                    if skipped < skip:
                        skipped += 1
                        continue
                    results.append({
                        "commit_hash": commit.hexsha[:8],
                        "full_hash": commit.hexsha,
                        "author": commit.author.name,
                        "date": commit.committed_datetime.isoformat(),
                        "formatted_date": commit.committed_datetime.strftime("%d.%m.%Y %H:%M"),
                        "message": commit.message.strip(),
                        "work_id": None,
                        "title": None,
                        "year": None,
                        "work_author": None,
                        "lehekylje_number": None,
                        "filepath": filepath,
                        "change_type": "person",
                        "person_id": person_id,
                        "person_name": _parse_person_name_from_message(commit.message.strip()),
                    })
                    if len(results) >= limit:
                        has_more = True
                        break
                    continue

                if not is_txt and not is_metadata:
                    continue

                # Leia teose info _metadata.json failist
                work_info = get_work_info_from_folder(folder_name)

                # Kollektsioonifilter: teose praegune kuuluvus _metadata.json-is
                if collection_ids and not (set(work_info.get('collections') or ()) & collection_ids):
                    continue

                if is_import_commit:
                    # Impordi commit: emit ainult _metadata.json kirje, txt-failid vahele
                    if not is_metadata:
                        continue
                    page_num = None
                    file_key = f"{work_info['work_id']}/_import"
                    change_type = "import"
                elif is_txt:
                    # Lehekülje muudatus
                    page_num = get_page_number_from_txt(folder_name, filename)
                    file_key = f"{work_info['work_id']}/{page_num}"
                    change_type = "page"
                else:
                    # Metaandmete muudatus
                    page_num = None
                    file_key = f"{work_info['work_id']}/_metadata"
                    change_type = "metadata"

                # Unikaalne võti (et vältida duplikaate)
                if file_key in seen_files:
                    continue
                seen_files.add(file_key)

                # Jäta esimesed `skip` tulemust vahele
                if skipped < skip:
                    skipped += 1
                    continue

                results.append({
                    "commit_hash": commit.hexsha[:8],
                    "full_hash": commit.hexsha,
                    "author": commit.author.name,
                    "date": commit.committed_datetime.isoformat(),
                    "formatted_date": commit.committed_datetime.strftime("%d.%m.%Y %H:%M"),
                    "message": commit.message.strip(),
                    "work_id": work_info['work_id'],
                    "title": work_info['title'],
                    "year": work_info['year'],
                    "work_author": work_info['author'],  # NB: 'author' on juba commit author
                    "lehekylje_number": page_num,
                    "filepath": filepath,
                    "change_type": change_type  # "page", "metadata" või "import"
                })

                # Kui limit täis, proovi leida veel üks tulemus has_more jaoks
                if len(results) >= limit:
                    has_more = True
                    break

            if len(results) >= limit:
                break

        except Exception as e:
            logger.warning(f"Viga commiti {commit.hexsha[:8]} töötlemisel: {e}")
            continue

    return results, has_more, len(all_commits)


def get_recent_commits(username=None, limit=50, skip=0, collection=None):
    """
    Tagastab viimased commitid, valikuliselt filtreerituna kasutaja ja
    kollektsiooni järgi.

    Args:
        username: Kui määratud, tagastab ainult selle kasutaja commitid
        limit: Maksimaalne tulemuste arv
        skip: Mitu tulemust algusest vahele jätta (pagineerimine)
        collection: Kui määratud, ainult selle kollektsiooni (ja ta
            alamkollektsioonide) teoste muudatused; isikukaardid jäävad välja

    Returns:
        dict: {"commits": list, "has_more": bool}

    Skanniaken: alustame kitsalt (kiire tavajuht) ja laieneme, kuni tulemusi
    on `limit` jagu või ajalugu saab otsa. Ilma laienemiseta näeks filtriga
    kasutaja tühja nimekirja lihtsalt sellepärast, et ta muudatused jäid
    akna taha — täpselt see viga, mida see funktsioon parandab.
    """
    repo = get_or_init_repo()
    collection_ids = _collection_scope_ids(collection) if collection else None

    base_window = (skip + limit) * 3 + 50
    windows = [base_window, base_window * 4, base_window * 16, None]  # None = kogu ajalugu

    results, has_more = [], False
    for window in windows:
        results, has_more, scanned = _scan_commits(
            repo, window, username, collection_ids, limit, skip
        )
        if len(results) >= limit or has_more:
            break
        if window is None or scanned < window:
            break  # ajalugu otsas — laiem aken ei annaks midagi juurde

    return {"commits": results, "has_more": has_more}
