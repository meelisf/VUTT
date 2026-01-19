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

# Cache teose_id jaoks (kausta nimi -> teose_id)
_teose_id_cache = {}


def get_teose_id_from_folder(folder_name):
    """
    Leiab teose_id kausta nime järgi.
    1. Loeb _metadata.json failist (kui olemas)
    2. Fallback: sanitize_id(folder_name)
    
    NB: Kasutab sanitize_id(), et tagada ühilduvus Meilisearchiga.
    Kasutab cache'i, et vältida korduvaid faililugemisi.
    """
    if folder_name in _teose_id_cache:
        return _teose_id_cache[folder_name]
    
    # Proovi lugeda _metadata.json
    metadata_path = os.path.join(BASE_DIR, folder_name, '_metadata.json')
    teose_id = None
    
    if os.path.exists(metadata_path):
        try:
            with open(metadata_path, 'r', encoding='utf-8') as f:
                meta = json.load(f)
                teose_id = meta.get('teose_id')
        except (json.JSONDecodeError, IOError):
            pass
    
    # Fallback: sanitize kausta nimi (sama loogika mis Meilisearch indekseerimisel)
    if not teose_id:
        teose_id = sanitize_id(folder_name)
    
    _teose_id_cache[folder_name] = teose_id
    return teose_id


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
    
    try:
        commit = repo.commit(commit_hash)
        
        if commit.parents:
            parent = commit.parents[0]
            if filepath:
                # Ainult konkreetne fail
                diff_text = repo.git.diff(parent.hexsha, commit.hexsha, '--', filepath)
            else:
                # Kõik failid commitis
                diff_text = repo.git.diff(parent.hexsha, commit.hexsha)
        else:
            # Esimene commit - võrdle tühja puuga
            if filepath:
                diff_text = repo.git.show(commit.hexsha, '--', filepath)
            else:
                diff_text = repo.git.show(commit.hexsha)
        
        # Loe statistika
        stat = repo.git.diff(parent.hexsha if commit.parents else '4b825dc642cb6eb9a060e54bf8d69288fbee4904', 
                             commit.hexsha, '--numstat')
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
            if commit.parents:
                # Võrdle parent commitiga
                diffs = commit.parents[0].diff(commit)
            else:
                # Esimene commit - kõik failid on uued
                diffs = commit.diff(None)
            
            for diff in diffs:
                filepath = diff.b_path or diff.a_path
                if not filepath or not filepath.endswith('.txt'):
                    continue
                
                # Parsi kausta nimi ja lehekylje_number failiteest
                parts = filepath.split('/')
                if len(parts) < 2:
                    continue
                
                folder_name = parts[0]
                filename = parts[-1]
                
                # Leia teose_id _metadata.json failist (või kasuta kausta nime)
                teose_id = get_teose_id_from_folder(folder_name)
                
                # Eralda lehekülje number failinimest (nt "lk_003.txt" → 3)
                page_num = 1
                name_without_ext = filename.rsplit('.', 1)[0]
                # Proovi leida number failinimest
                numbers = re.findall(r'\d+', name_without_ext)
                if numbers:
                    page_num = int(numbers[-1])
                
                # Unikaalne võti (et vältida duplikaate)
                file_key = f"{teose_id}/{page_num}"
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
                    "teose_id": teose_id,
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
