"""
Kaastööliste (contributor) ootel muudatuste haldus.

MÄRKUS: See moodul on implementeeritud, kuid PRAEGU EI OLE KASUTUSEL.

Algselt oli plaan, et contributor-rolli kasutajate muudatused läheksid
ülevaatusele (pending), kus editor/admin peaks need kinnitama. See tekitab
aga suure halduskoormuse ja ei ole praegu mõttekas.

Praegune lahendus: kõik registreeritud kasutajad saavad editor rolli
(vt registration.py) ja nende muudatused rakenduvad kohe.

Kui tulevikus on vaja suuremat kvaliteedikontrolli, saab selle süsteemi
uuesti aktiveerida, muutes registration.py-s uue kasutaja vaikerolli
tagasi 'contributor'-iks.
"""
import json
import os
import hashlib
import uuid
import threading
from datetime import datetime
from .config import PENDING_EDITS_FILE
from .utils import atomic_write_json

# Lukk failioperatsioonide jaoks
edits_lock = threading.RLock()


def load_pending_edits():
    """Laeb ootel muudatused."""
    with edits_lock:
        if not os.path.exists(PENDING_EDITS_FILE):
            return {"pending_edits": []}
        with open(PENDING_EDITS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)


def save_pending_edits(data):
    """Salvestab ootel muudatused (atomic write)."""
    with edits_lock:
        atomic_write_json(PENDING_EDITS_FILE, data)


def create_pending_edit(work_id, lehekylje_number, user, original_text, new_text):
    """
    Loob uue pending-edit kirje.
    Kontrollib konflikte ja tagastab (edit, error) tuple.
    """
    data = load_pending_edits()

    # Arvuta base_text_hash konfliktide tuvastamiseks
    base_text_hash = hashlib.sha256(original_text.encode('utf-8')).hexdigest()

    # Kontrolli, kas sama kasutaja on juba teinud muudatuse samale lehele
    # Kui jah, siis kirjuta see üle
    existing_idx = None
    other_pending = False

    for idx, edit in enumerate(data["pending_edits"]):
        if edit["work_id"] == work_id and edit["lehekylje_number"] == lehekylje_number:
            if edit["status"] == "pending":
                if edit["user"] == user["username"]:
                    # Sama kasutaja - kirjutame üle
                    existing_idx = idx
                else:
                    # Teine kasutaja on juba muudatuse teinud
                    other_pending = True

    # Konflikti tüüp
    conflict_type = None
    if other_pending:
        conflict_type = "other_pending"

    new_edit = {
        "id": str(uuid.uuid4()),
        "work_id": work_id,
        "lehekylje_number": lehekylje_number,
        "user": user["username"],
        "user_name": user["name"],
        "role_at_submission": user["role"],
        "submitted_at": datetime.now().isoformat(),
        "original_text": original_text,
        "new_text": new_text,
        "base_text_hash": base_text_hash,
        "status": "pending",
        "has_conflict": other_pending,
        "conflict_type": conflict_type,
        "reviewed_by": None,
        "reviewed_at": None,
        "review_comment": None
    }

    if existing_idx is not None:
        # Asenda olemasolev
        data["pending_edits"][existing_idx] = new_edit
        print(f"Uuendatud pending-edit: {user['username']} -> {work_id}/{lehekylje_number}")
    else:
        # Lisa uus
        data["pending_edits"].append(new_edit)
        print(f"Uus pending-edit: {user['username']} -> {work_id}/{lehekylje_number}")

    save_pending_edits(data)

    return new_edit, None


def get_pending_edit_by_id(edit_id):
    """Leiab pending-edit ID järgi."""
    data = load_pending_edits()
    for edit in data["pending_edits"]:
        if edit["id"] == edit_id:
            return edit
    return None


def get_pending_edits_for_page(work_id, lehekylje_number):
    """Tagastab kõik ootel muudatused konkreetse lehe jaoks."""
    data = load_pending_edits()
    return [
        edit for edit in data["pending_edits"]
        if edit["work_id"] == work_id
        and edit["lehekylje_number"] == lehekylje_number
        and edit["status"] == "pending"
    ]


def get_user_pending_edit_for_page(work_id, lehekylje_number, username):
    """Tagastab kasutaja ootel muudatuse konkreetse lehe jaoks."""
    data = load_pending_edits()
    for edit in data["pending_edits"]:
        if (edit["work_id"] == work_id
            and edit["lehekylje_number"] == lehekylje_number
            and edit["user"] == username
            and edit["status"] == "pending"):
            return edit
    return None


def update_pending_edit_status(edit_id, status, reviewed_by, comment=None):
    """Uuendab pending-edit staatust."""
    data = load_pending_edits()
    for edit in data["pending_edits"]:
        if edit["id"] == edit_id:
            edit["status"] = status
            edit["reviewed_by"] = reviewed_by
            edit["reviewed_at"] = datetime.now().isoformat()
            if comment:
                edit["review_comment"] = comment
            save_pending_edits(data)
            return edit
    return None


def check_base_text_conflict(edit, current_text):
    """
    Kontrollib, kas originaaltekst on vahepeal muutunud.
    Tagastab True kui on konflikt.
    """
    current_hash = hashlib.sha256(current_text.encode('utf-8')).hexdigest()
    return current_hash != edit["base_text_hash"]
