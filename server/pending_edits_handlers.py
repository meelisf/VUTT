"""
Pending-edits HTTP handlerid.

Eraldatud file_server.py-st. Äriloogika on server/pending_edits.py-s,
siin on ainult HTTP request/response käsitlus.
"""
import json
import os
import glob

from .cors import send_cors_headers
from .auth import require_token
from .pending_edits import (
    load_pending_edits, create_pending_edit, get_pending_edit_by_id,
    get_pending_edits_for_page, get_user_pending_edit_for_page,
    update_pending_edit_status, check_base_text_conflict
)
from .git_ops import save_with_git
from .utils import find_directory_by_id


def send_json_response(handler, status_code, data):
    """Saadab JSON-vastuse koos CORS päistega."""
    handler.send_response(status_code)
    handler.send_header('Content-type', 'application/json')
    send_cors_headers(handler)
    handler.end_headers()
    handler.wfile.write(json.dumps(data).encode('utf-8'))


def _read_request_data(handler):
    """Loeb ja parsib POST body JSON-ina."""
    content_length = int(handler.headers['Content-Length'])
    post_data = handler.rfile.read(content_length)
    return json.loads(post_data)


def handle_save_pending(handler):
    """Salvestab kaastöölise muudatuse pending-olekusse."""
    try:
        data = _read_request_data(handler)

        # Nõuab vähemalt contributor õigusi
        user, auth_error = require_token(data, min_role='contributor')
        if auth_error:
            send_json_response(handler, 401, auth_error)
            return

        work_id = data.get('work_id') or data.get('teose_id')  # work_id eelistatud
        lehekylje_number = data.get('lehekylje_number')
        original_text = data.get('original_text', '')
        new_text = data.get('new_text', '')

        if not work_id or lehekylje_number is None:
            send_json_response(handler, 400, {
                "status": "error",
                "message": "work_id ja lehekylje_number on kohustuslikud"
            })
            return

        # Kontrolli, kas teised kasutajad on juba muudatusi teinud
        other_edits = get_pending_edits_for_page(work_id, lehekylje_number)
        other_users_edits = [e for e in other_edits if e["user"] != user["username"]]
        has_other_pending = len(other_users_edits) > 0

        # Loo pending-edit
        edit, error = create_pending_edit(
            work_id=work_id,
            lehekylje_number=lehekylje_number,
            user=user,
            original_text=original_text,
            new_text=new_text
        )

        send_json_response(handler, 200, {
            "status": "success",
            "message": "Muudatus salvestatud ülevaatusele",
            "edit_id": edit["id"],
            "has_other_pending": has_other_pending
        })

    except Exception as e:
        print(f"SAVE-PENDING VIGA: {e}")
        handler.send_error(500, str(e))


def handle_pending_edits_list(handler):
    """Tagastab ootel muudatused (toimetaja+)."""
    try:
        data = _read_request_data(handler)

        user, auth_error = require_token(data, min_role='editor')
        if auth_error:
            send_json_response(handler, 401, auth_error)
            return

        edits_data = load_pending_edits()

        # Filtreeri ainult pending-staatusega
        pending = [e for e in edits_data["pending_edits"] if e["status"] == "pending"]

        # Sorteeri kuupäeva järgi (uuemad ees)
        pending.sort(key=lambda x: x["submitted_at"], reverse=True)

        send_json_response(handler, 200, {
            "status": "success",
            "pending_edits": pending
        })

    except Exception as e:
        print(f"PENDING-EDITS VIGA: {e}")
        handler.send_error(500, str(e))


def handle_pending_edits_check(handler):
    """Kontrollib, kas lehel on ootel muudatusi (contributor näeb oma muudatust)."""
    try:
        data = _read_request_data(handler)

        user, auth_error = require_token(data, min_role='contributor')
        if auth_error:
            send_json_response(handler, 401, auth_error)
            return

        work_id = data.get('work_id') or data.get('teose_id')  # work_id eelistatud
        lehekylje_number = data.get('lehekylje_number')

        if not work_id or lehekylje_number is None:
            send_json_response(handler, 400, {
                "status": "error",
                "message": "work_id ja lehekylje_number on kohustuslikud"
            })
            return

        # Kasutaja enda muudatus
        user_edit = get_user_pending_edit_for_page(work_id, lehekylje_number, user["username"])

        # Kas on teiste muudatusi (ainult toimetaja näeb)
        all_edits = get_pending_edits_for_page(work_id, lehekylje_number)
        other_edits_count = len([e for e in all_edits if e["user"] != user["username"]])

        send_json_response(handler, 200, {
            "status": "success",
            "has_own_pending": user_edit is not None,
            "own_pending_edit": user_edit,
            "other_pending_count": other_edits_count if user["role"] in ['editor', 'admin'] else 0
        })

    except Exception as e:
        print(f"PENDING-EDITS CHECK VIGA: {e}")
        handler.send_error(500, str(e))


def handle_pending_edits_approve(handler):
    """Kinnitab pending-edit (toimetaja+)."""
    try:
        data = _read_request_data(handler)

        user, auth_error = require_token(data, min_role='editor')
        if auth_error:
            send_json_response(handler, 401, auth_error)
            return

        edit_id = data.get('edit_id')
        comment = data.get('comment', '')

        if not edit_id:
            send_json_response(handler, 400, {
                "status": "error", "message": "edit_id puudub"
            })
            return

        edit = get_pending_edit_by_id(edit_id)
        if not edit:
            send_json_response(handler, 404, {
                "status": "error", "message": "Muudatust ei leitud"
            })
            return

        if edit["status"] != "pending":
            send_json_response(handler, 400, {
                "status": "error", "message": "Muudatus on juba käsitletud"
            })
            return

        # Leia fail
        dir_path = find_directory_by_id(edit["work_id"])
        if not dir_path:
            send_json_response(handler, 404, {
                "status": "error", "message": "Teost ei leitud"
            })
            return

        # Leia .txt fail
        txt_files = sorted(glob.glob(os.path.join(dir_path, '*.txt')))
        if edit["lehekylje_number"] < 1 or edit["lehekylje_number"] > len(txt_files):
            send_json_response(handler, 404, {
                "status": "error", "message": "Lehekülge ei leitud"
            })
            return

        txt_path = txt_files[edit["lehekylje_number"] - 1]

        # Loe praegune tekst konfliktide kontrolliks
        with open(txt_path, 'r', encoding='utf-8') as f:
            current_text = f.read()

        base_changed = check_base_text_conflict(edit, current_text)

        # Salvesta uus tekst Git commiti abil
        # Autor = kaastööline, kes muudatuse tegi
        author_name = edit.get("user_name", edit["user"])
        commit_message = f"Muuda: {os.path.basename(txt_path)} (kinnitatud {user['username']} poolt)"

        git_result = save_with_git(
            filepath=txt_path,
            content=edit["new_text"],
            username=author_name,
            message=commit_message
        )

        # Uuenda Meilisearch (taustal)
        # Hiline import, et vältida ringviiteid (funktsioon on file_server.py-s, mis käivitatakse __main__-ina)
        import __main__ as _main
        _main.sync_work_to_meilisearch_async(os.path.basename(dir_path))

        # Märgi muudatus kinnitatuks
        update_pending_edit_status(edit_id, "approved", user["username"], comment)

        send_json_response(handler, 200, {
            "status": "success",
            "message": "Muudatus kinnitatud",
            "base_changed": base_changed,
            "git_commit": git_result.get("commit_hash", "")[:8] if git_result.get("success") else None
        })

        print(f"Toimetaja {user['username']} kinnitas muudatuse: {edit['user']} -> {edit['work_id']}/{edit['lehekylje_number']}")

    except Exception as e:
        print(f"APPROVE PENDING VIGA: {e}")
        handler.send_error(500, str(e))


def handle_pending_edits_reject(handler):
    """Lükkab pending-edit tagasi (toimetaja+)."""
    try:
        data = _read_request_data(handler)

        user, auth_error = require_token(data, min_role='editor')
        if auth_error:
            send_json_response(handler, 401, auth_error)
            return

        edit_id = data.get('edit_id')
        comment = data.get('comment', '')

        if not edit_id:
            send_json_response(handler, 400, {
                "status": "error", "message": "edit_id puudub"
            })
            return

        edit = get_pending_edit_by_id(edit_id)
        if not edit:
            send_json_response(handler, 404, {
                "status": "error", "message": "Muudatust ei leitud"
            })
            return

        if edit["status"] != "pending":
            send_json_response(handler, 400, {
                "status": "error", "message": "Muudatus on juba käsitletud"
            })
            return

        # Märgi muudatus tagasilükatuks
        update_pending_edit_status(edit_id, "rejected", user["username"], comment)

        send_json_response(handler, 200, {
            "status": "success",
            "message": "Muudatus tagasi lükatud"
        })

        print(f"Toimetaja {user['username']} lükkas tagasi muudatuse: {edit['user']} -> {edit['work_id']}/{edit['lehekylje_number']}")

    except Exception as e:
        print(f"REJECT PENDING VIGA: {e}")
        handler.send_error(500, str(e))
