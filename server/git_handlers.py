"""
Git ja backup HTTP handlerid.

Eraldatud file_server.py-st. Sisaldab:
- /backups - varukoopiate loetelu
- /restore - varukoopia taastamine
- /git-history - Git ajaloo päring
- /git-restore - Git versiooni taastamine
- /git-diff - Kahe commiti diff
- /commit-diff - Ühe commiti diff
"""
import os
import glob
import json
import shutil
from datetime import datetime

from .http_helpers import send_json_response, read_request_data, require_auth
from .git_ops import (
    get_file_git_history, get_file_at_commit, get_file_diff, get_commit_diff
)
from .cors import send_cors_headers
from .config import BASE_DIR


def handle_backups(handler):
    """Varukoopiate loetelu päring (admin)."""
    try:
        data = read_request_data(handler)

        user = require_auth(handler, data, min_role='admin')
        if not user:
            return

        original_catalog = data.get('original_path')
        target_filename = data.get('file_name')

        if not original_catalog or not target_filename:
            handler.send_error(400, "Puudub 'original_path' või 'file_name'")
            return

        safe_catalog = os.path.basename(original_catalog)
        safe_filename = os.path.basename(target_filename)
        txt_path = os.path.join(BASE_DIR, safe_catalog, safe_filename)

        # Leiame kõik varukoopiad
        backups = sorted(glob.glob(f"{txt_path}.backup.*"), reverse=True)

        backup_list = []
        original_backup_path = f"{txt_path}.backup.ORIGINAL"
        has_original_backup = os.path.exists(original_backup_path)

        for backup_path in backups:
            # ORIGINAL käsitleme eraldi lõpus
            if backup_path.endswith('.backup.ORIGINAL'):
                continue

            # Eraldame timestampi failinimest
            parts = backup_path.rsplit('.backup.', 1)
            if len(parts) == 2:
                timestamp_str = parts[1]
                try:
                    dt = datetime.strptime(timestamp_str, "%Y%m%d_%H%M%S")
                    backup_list.append({
                        "filename": os.path.basename(backup_path),
                        "timestamp": timestamp_str,
                        "formatted_date": dt.strftime("%d.%m.%Y %H:%M:%S"),
                        "is_original": False
                    })
                except ValueError:
                    pass

        # Originaali käsitlemine - nüüd kasutame .backup.ORIGINAL faili
        if has_original_backup:
            file_mtime = os.path.getmtime(original_backup_path)
            file_dt = datetime.fromtimestamp(file_mtime)
            backup_list.append({
                "filename": os.path.basename(original_backup_path),
                "timestamp": "ORIGINAL",
                "formatted_date": f"Originaal (OCR) - {file_dt.strftime('%d.%m.%Y')}",
                "is_original": True
            })
        elif os.path.exists(txt_path) and not backup_list:
            # Pole ühtegi backupi - praegune .txt ON originaal (pole veel muudetud)
            file_mtime = os.path.getmtime(txt_path)
            file_dt = datetime.fromtimestamp(file_mtime)
            backup_list.append({
                "filename": safe_filename,
                "timestamp": "original",
                "formatted_date": f"Originaal (OCR) - {file_dt.strftime('%d.%m.%Y')}",
                "is_original": True
            })

        send_json_response(handler, 200, {
            "status": "success",
            "backups": backup_list,
            "total": len(backup_list)
        })

    except Exception as e:
        print(f"BACKUPS VIGA: {e}")
        handler.send_error(500, str(e))


def handle_restore(handler):
    """Varukoopia taastamine (admin)."""
    try:
        data = read_request_data(handler)

        user = require_auth(handler, data, min_role='admin')
        if not user:
            return

        original_catalog = data.get('original_path')
        target_filename = data.get('file_name')
        backup_filename = data.get('backup_filename')

        # Turvakontroll: backup_filename peab olema ainult failinimi
        backup_filename = os.path.basename(backup_filename) if backup_filename else ''

        if not original_catalog or not target_filename or not backup_filename:
            handler.send_error(400, "Puudub 'original_path', 'file_name' või 'backup_filename'")
            return

        safe_catalog = os.path.basename(original_catalog)
        safe_filename = os.path.basename(target_filename)
        txt_path = os.path.join(BASE_DIR, safe_catalog, safe_filename)

        # Kui backup_filename on sama mis safe_filename, siis tahetakse taastada originaali
        if backup_filename == safe_filename:
            if not os.path.exists(txt_path):
                send_json_response(handler, 404, {"status": "error", "message": "Originaalfaili ei leitud"})
                return
            backup_path = txt_path
        else:
            backup_path = os.path.join(BASE_DIR, safe_catalog, backup_filename)

        # Kontrollime, et backup fail eksisteerib
        if not os.path.exists(backup_path):
            send_json_response(handler, 404, {"status": "error", "message": "Varukoopiat ei leitud"})
            return

        # Loeme taastamise faili sisu
        with open(backup_path, 'r', encoding='utf-8') as f:
            restored_content = f.read()

        # Teeme praegusest versioonist varukoopia enne taastamist
        if os.path.exists(txt_path):
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            pre_restore_backup = f"{txt_path}.backup.{timestamp}"
            shutil.copy2(txt_path, pre_restore_backup)
            print(f"Loodud varukoopia enne taastamist: {pre_restore_backup}")

        # Kirjutame taastatud sisu
        with open(txt_path, 'w', encoding='utf-8') as f:
            f.write(restored_content)
        os.chmod(txt_path, 0o644)

        print(f"Taastatud versioon: {backup_filename} -> {safe_filename}")

        send_json_response(handler, 200, {
            "status": "success",
            "message": "Versioon taastatud",
            "restored_content": restored_content
        })

    except Exception as e:
        print(f"RESTORE VIGA: {e}")
        handler.send_error(500, str(e))


def handle_git_history(handler):
    """Git ajaloo päring - kõik sisselogitud kasutajad näevad ajalugu."""
    try:
        data = read_request_data(handler)

        user = require_auth(handler, data, min_role='editor')
        if not user:
            return

        original_catalog = data.get('original_path')
        target_filename = data.get('file_name')

        if not original_catalog or not target_filename:
            handler.send_error(400, "Puudub 'original_path' või 'file_name'")
            return

        safe_catalog = os.path.basename(original_catalog)
        safe_filename = os.path.basename(target_filename)

        # Jälgi nii .txt kui .json faile
        txt_path = os.path.join(safe_catalog, safe_filename)
        json_filename = os.path.splitext(safe_filename)[0] + '.json'
        json_path = os.path.join(safe_catalog, json_filename)

        files_to_check = [txt_path, json_path]

        # Küsime Git ajaloo mõlema faili jaoks
        history = get_file_git_history(files_to_check, max_count=50)

        send_json_response(handler, 200, {
            "status": "success",
            "history": history,
            "total": len(history)
        })

    except Exception as e:
        print(f"GIT-HISTORY VIGA: {e}")
        handler.send_error(500, str(e))


def handle_git_restore(handler):
    """Git versiooni taastamine (admin)."""
    try:
        data = read_request_data(handler)

        user = require_auth(handler, data, min_role='admin')
        if not user:
            return

        original_catalog = data.get('original_path')
        target_filename = data.get('file_name')
        commit_hash = data.get('commit_hash')

        if not original_catalog or not target_filename or not commit_hash:
            handler.send_error(400, "Puudub 'original_path', 'file_name' või 'commit_hash'")
            return

        safe_catalog = os.path.basename(original_catalog)
        safe_filename = os.path.basename(target_filename)
        relative_path = os.path.join(safe_catalog, safe_filename)

        # Loe faili sisu kindlast commitist
        restored_content = get_file_at_commit(relative_path, commit_hash)

        if restored_content is None:
            send_json_response(handler, 404, {"status": "error", "message": "Versiooni ei leitud"})
            return

        print(f"Git restore: {commit_hash[:8]} -> {relative_path} (kasutaja: {user['username']})")

        send_json_response(handler, 200, {
            "status": "success",
            "message": "Versioon laaditud",
            "restored_content": restored_content,
            "from_commit": commit_hash
        })

    except Exception as e:
        print(f"GIT-RESTORE VIGA: {e}")
        handler.send_error(500, str(e))


def handle_git_diff(handler):
    """Git diff kahe commiti vahel (admin)."""
    try:
        data = read_request_data(handler)

        user = require_auth(handler, data, min_role='admin')
        if not user:
            return

        original_catalog = data.get('original_path')
        target_filename = data.get('file_name')
        hash1 = data.get('hash1')
        hash2 = data.get('hash2')

        if not original_catalog or not target_filename or not hash1 or not hash2:
            handler.send_error(400, "Puudub 'original_path', 'file_name', 'hash1' või 'hash2'")
            return

        safe_catalog = os.path.basename(original_catalog)
        safe_filename = os.path.basename(target_filename)
        relative_path = os.path.join(safe_catalog, safe_filename)

        # Genereeri diff
        diff = get_file_diff(relative_path, hash1, hash2)

        send_json_response(handler, 200, {
            "status": "success",
            "diff": diff or "",
            "hash1": hash1,
            "hash2": hash2
        })

    except Exception as e:
        print(f"GIT-DIFF VIGA: {e}")
        handler.send_error(500, str(e))


def handle_commit_diff(handler):
    """Ühe commiti diff (võrreldes parent commitiga)."""
    try:
        data = read_request_data(handler)

        user = require_auth(handler, data, min_role='viewer')
        if not user:
            return

        commit_hash = data.get('commit_hash')
        filepath = data.get('filepath')  # Valikuline

        if not commit_hash:
            handler.send_error(400, "Puudub 'commit_hash'")
            return

        # Kui filepath on antud, arvuta ka json fail
        filepaths = None
        if filepath:
            if filepath.endswith('.txt'):
                json_path = filepath.rsplit('.', 1)[0] + '.json'
                filepaths = [filepath, json_path]
            else:
                filepaths = [filepath]

        # Hangi diff (toetab nüüd listi)
        result = get_commit_diff(commit_hash, filepaths)

        if result:
            send_json_response(handler, 200, {
                "status": "success",
                "diff": result["diff"],
                "additions": result["additions"],
                "deletions": result["deletions"],
                "files": result["files"]
            })
        else:
            send_json_response(handler, 200, {
                "status": "error",
                "message": "Diff'i ei leitud"
            })

    except Exception as e:
        print(f"COMMIT-DIFF VIGA: {e}")
        handler.send_error(500, str(e))
