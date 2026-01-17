"""
Git versioonihalduse operatsioonid.
"""
import os
from git import Repo, Actor
from git.exc import InvalidGitRepositoryError, GitCommandError
from .config import BASE_DIR

# Git repo globaalne muutuja (initsialiseeritakse esimesel kasutamisel)
_git_repo = None


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
