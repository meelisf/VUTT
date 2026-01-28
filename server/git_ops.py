"""
Git versioonihalduse operatsioonid.
"""
import os
import json
import re
from git import Repo, Actor
from git.exc import InvalidGitRepositoryError, GitCommandError
from .config import BASE_DIR
from .utils import sanitize_id

# Git repo globaalne muutuja (initsialiseeritakse esimesel kasutamisel)
_git_repo = None

# Cache teose ID-de jaoks (kausta nimi -> (work_id, slug))
_work_ids_cache = {}

# Cache teose info jaoks (kausta nimi -> {work_id, slug, title, year, author})
_work_info_cache = {}


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
        'author': None
    }

    if os.path.exists(metadata_path):
        try:
            with open(metadata_path, 'r', encoding='utf-8') as f:
                meta = json.load(f)
                info['work_id'] = meta.get('id')
                info['slug'] = meta.get('slug') or info['slug']
                info['title'] = meta.get('title')
                info['year'] = meta.get('year')

                # Autor creators massiivist
                creators = meta.get('creators', [])
                if creators:
                    praeses = next((c for c in creators if c.get('role') == 'praeses'), None)
                    auctor = next((c for c in creators if c.get('role') == 'auctor'), None)
                    if praeses:
                        info['author'] = praeses.get('name')
                    elif auctor:
                        info['author'] = auctor.get('name')
                    elif creators:
                        info['author'] = creators[0].get('name')
        except (json.JSONDecodeError, IOError):
            pass

    _work_info_cache[folder_name] = info
    return info


# Cache piltide nimekirja jaoks (kausta nimi -> sorteeritud piltide nimekiri)
_images_cache = {}


def get_page_number_from_txt(folder_name, txt_filename):
    """
    Leiab lehekülje numbri txt-faili järgi.

    Meilisearch kasutab PILDI positsiooni sorteeritud nimekirjas (1-indekseeritud).
    See funktsioon tagastab sama numbri, et Review lehel ja Workspace'is
    oleksid samad leheküljenumbrid.

    Args:
        folder_name: Kausta nimi (nt "1632-1")
        txt_filename: Tekstifaili nimi (nt "lk_003.txt")

    Returns:
        int: Lehekülje number (1-indekseeritud) või 1 kui ei leia
    """
    # Kasuta cache'i
    if folder_name not in _images_cache:
        folder_path = os.path.join(BASE_DIR, folder_name)
        if os.path.exists(folder_path):
            images = sorted([f for f in os.listdir(folder_path)
                           if f.lower().endswith(('.jpg', '.jpeg', '.png'))])
            _images_cache[folder_name] = images
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
        print(f"Git repo leitud: {BASE_DIR}")
    except InvalidGitRepositoryError:
        _git_repo = Repo.init(BASE_DIR)
        print(f"Git repo initsialiseeritud: {BASE_DIR}")

        # Loome .gitignore, et ignoreerida pilte ja muid suuri faile
        gitignore_path = os.path.join(BASE_DIR, '.gitignore')
        if not os.path.exists(gitignore_path):
            with open(gitignore_path, 'w') as f:
                f.write("# VUTT Git versioonihaldus\n")
                f.write("# Jälgime ainult .txt faile\n")
                f.write("*.jpg\n")
                f.write("*.jpeg\n")
                f.write("*.png\n")
                f.write("*.backup.*\n")  # Vanad backup failid
                f.write("_metadata.json\n")  # Metaandmed eraldi
                f.write("*.json\n")  # Lehekülje metaandmed
            print("Loodud .gitignore")

    return _git_repo


def save_with_git(filepath, content, username, message=None):
    """
    Salvestab faili ja teeb Git commiti.

    Args:
        filepath: Absoluutne tee failini
        content: Faili sisu
        username: Kasutajanimi (commit author)
        message: Commit sõnum (valikuline, genereeritakse automaatselt)

    Returns:
        dict: {"success": bool, "commit_hash": str, "is_first_commit": bool}
    """
    repo = get_or_init_repo()
    relative_path = os.path.relpath(filepath, BASE_DIR)

    # Kontrolli, kas see fail on juba repos (st kas on esimene commit)
    is_first_commit = True
    try:
        # Kui faili ajalugu on olemas, pole esimene commit
        list(repo.iter_commits(paths=relative_path, max_count=1))
        is_first_commit = False
    except:
        is_first_commit = True

    # Kirjuta fail
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

    # Lisa fail indeksisse
    repo.index.add([relative_path])

    # Genereeri commit sõnum
    if not message:
        if is_first_commit:
            message = f"Originaal OCR: {relative_path}"
        else:
            message = f"Muuda: {relative_path}"

    # Tee commit
    author = Actor(username, f"{username}@vutt.local")
    try:
        commit = repo.index.commit(
            message,
            author=author,
            committer=author
        )
        print(f"Git commit: {commit.hexsha[:8]} - {message} (autor: {username})")
        return {
            "success": True,
            "commit_hash": commit.hexsha,
            "is_first_commit": is_first_commit
        }
    except GitCommandError as e:
        print(f"Git commit viga: {e}")
        return {"success": False, "error": str(e)}


def get_file_git_history(relative_path, max_count=50):
    """
    Tagastab faili Git ajaloo.

    Args:
        relative_path: Suhteline tee failini (BASE_DIR suhtes)
        max_count: Maksimaalne commitide arv

    Returns:
        list: Commitide nimekiri, iga element on dict
    """
    repo = get_or_init_repo()

    try:
        commits = list(repo.iter_commits(paths=relative_path, max_count=max_count))
    except:
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
        print(f"Git show viga: {e}")
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
        print(f"Git diff viga: {e}")
        return None


def get_commit_diff(commit_hash, filepath=None):
    """
    Tagastab ühe commiti diff'i (võrreldes parent commitiga).

    Args:
        commit_hash: Commit hash (täis- või lühike)
        filepath: Valikuline failirada, et näidata ainult selle faili muutused

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

        if filepath:
            diff_text = repo.git.diff(parent_hash, commit.hexsha, '--', filepath)
        else:
            diff_text = repo.git.diff(parent_hash, commit.hexsha)
        
        # Loe statistika
        stat = repo.git.diff(parent_hash, commit.hexsha, '--numstat')
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
        print(f"Git commit diff viga: {e}")
        return None
    except Exception as e:
        print(f"Commiti diff viga: {e}")
        return None


def commit_new_work_to_git(dir_name):
    """Lisab uue teose txt failid Git reposse originaal-OCR commitina."""
    try:
        repo = get_or_init_repo()
        dir_path = os.path.join(BASE_DIR, dir_name)

        # Leia kõik txt failid kaustas
        txt_files = []
        for f in os.listdir(dir_path):
            if f.endswith('.txt'):
                relative_path = os.path.join(dir_name, f)
                txt_files.append(relative_path)

        if not txt_files:
            return False

        # Lisa failid indeksisse
        repo.index.add(txt_files)

        # Tee commit
        author = Actor("Automaatne", "auto@vutt.local")
        repo.index.commit(
            f"Originaal OCR: {dir_name} ({len(txt_files)} lehekülge)",
            author=author,
            committer=author
        )
        print(f"GIT: Lisatud uus teos {dir_name} ({len(txt_files)} txt faili)")
        return True
    except Exception as e:
        print(f"GIT viga uue teose lisamisel ({dir_name}): {e}")
        return False


def get_recent_commits(username=None, limit=50):
    """
    Tagastab viimased commitid, valikuliselt filtreerituna kasutaja järgi.
    
    Args:
        username: Kui määratud, tagastab ainult selle kasutaja commitid
        limit: Maksimaalne commitide arv
    
    Returns:
        list: Commitide nimekiri koos teose ja lehekülje infoga
    """
    repo = get_or_init_repo()
    
    try:
        all_commits = list(repo.iter_commits(max_count=limit * 3))  # Võtame rohkem, et filtreerimise järel piisaks
    except:
        return []
    
    results = []
    seen_files = set()  # Vältimaks duplikaate sama faili kohta
    
    for commit in all_commits:
        # Filtreeri kasutaja järgi (kui määratud)
        if username and commit.author.name != username:
            continue
        
        # Jäta vahele automaatsed commitid
        if commit.author.name == "Automaatne":
            continue
        
        # Leia muudetud failid selles commitis
        try:
            # Optimeerimine: Kasutame stats.files, et saada ainult failinimed
            # See väldib kulukat sisu võrdlemist (diff)
            file_paths = list(commit.stats.files.keys())
            
            for filepath in file_paths:
                if not filepath or not filepath.endswith('.txt'):
                    continue
                
                # Parsi kausta nimi ja lehekylje_number failiteest
                parts = filepath.split('/')
                if len(parts) < 2:
                    continue
                
                folder_name = parts[0]
                filename = parts[-1]
                
                # Leia teose info _metadata.json failist
                work_info = get_work_info_from_folder(folder_name)

                # Leia lehekülje number pildi positsiooni järgi (sama loogika mis Meilisearchis)
                page_num = get_page_number_from_txt(folder_name, filename)

                # Unikaalne võti (et vältida duplikaate)
                file_key = f"{work_info['work_id']}/{page_num}"
                if file_key in seen_files:
                    continue
                seen_files.add(file_key)

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
                    "filepath": filepath
                })
                
                if len(results) >= limit:
                    break
            
            if len(results) >= limit:
                break
                
        except Exception as e:
            print(f"Viga commiti {commit.hexsha[:8]} töötlemisel: {e}")
            continue
    
    return results
