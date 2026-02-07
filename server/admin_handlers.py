"""
Admin HTTP handlerid.

Eraldatud file_server.py-st. Sisaldab:
- /admin/registrations - ootel registreerimistaotlused
- /admin/registrations/approve - taotluse kinnitamine
- /admin/registrations/reject - taotluse tagasilükkamine
- /admin/users - kasutajate nimekiri
- /admin/users/update-role - rolli muutmine
- /admin/users/delete - kasutaja kustutamine
- /invite/set-password - parooli seadmine invite tokeniga
- /admin/git-health - git repo tervislikkuse kontroll
- /admin/git-failures - git commit ebaõnnestumised
"""
import json

from .http_helpers import send_json_response, read_request_data, require_auth
from .cors import send_cors_headers
from .rate_limit import get_client_ip, check_rate_limit, rate_limit_response
from .registration import (
    load_pending_registrations, get_registration_by_id,
    update_registration_status, create_invite_token,
    validate_invite_token, create_user_from_invite
)
from .auth import get_all_users, update_user_role, delete_user
from .git_ops import get_git_failures, clear_git_failures, run_git_fsck
from .people_ops import refresh_all_people_safe, get_refresh_status


def handle_admin_registrations(handler):
    """Tagastab ootel registreerimistaotlused (admin)."""
    try:
        data = read_request_data(handler)

        user = require_auth(handler, data, min_role='admin')
        if not user:
            return

        reg_data = load_pending_registrations()

        send_json_response(handler, 200, {
            "status": "success",
            "registrations": reg_data["registrations"]
        })

    except Exception as e:
        print(f"ADMIN REGISTRATIONS VIGA: {e}")
        handler.send_error(500, str(e))


def handle_admin_registrations_approve(handler):
    """Kinnitab registreerimistaotluse ja loob invite tokeni (admin)."""
    try:
        data = read_request_data(handler)

        user = require_auth(handler, data, min_role='admin')
        if not user:
            return

        reg_id = data.get('registration_id')
        if not reg_id:
            send_json_response(handler, 400, {"status": "error", "message": "registration_id puudub"})
            return

        # Leia taotlus
        reg = get_registration_by_id(reg_id)
        if not reg:
            send_json_response(handler, 404, {"status": "error", "message": "Taotlust ei leitud"})
            return

        if reg["status"] != "pending":
            send_json_response(handler, 400, {"status": "error", "message": "Taotlus on juba käsitletud"})
            return

        # Uuenda staatus
        update_registration_status(reg_id, "approved", user["username"])

        # Loo invite token
        token_data = create_invite_token(reg["email"], reg["name"], user["username"])

        # Genereeri link (kasutaja peab selle käsitsi saatma)
        invite_url = f"/set-password?token={token_data['token']}"

        send_json_response(handler, 200, {
            "status": "success",
            "message": "Taotlus kinnitatud",
            "invite_url": invite_url,
            "invite_token": token_data["token"],
            "expires_at": token_data["expires_at"],
            "email": reg["email"],
            "name": reg["name"]
        })

        print(f"Admin {user['username']} kinnitas taotluse: {reg['name']} ({reg['email']})")

    except Exception as e:
        print(f"APPROVE REGISTRATION VIGA: {e}")
        handler.send_error(500, str(e))


def handle_admin_registrations_reject(handler):
    """Lükkab registreerimistaotluse tagasi (admin)."""
    try:
        data = read_request_data(handler)

        user = require_auth(handler, data, min_role='admin')
        if not user:
            return

        reg_id = data.get('registration_id')
        if not reg_id:
            send_json_response(handler, 400, {"status": "error", "message": "registration_id puudub"})
            return

        reg = get_registration_by_id(reg_id)
        if not reg:
            send_json_response(handler, 404, {"status": "error", "message": "Taotlust ei leitud"})
            return

        if reg["status"] != "pending":
            send_json_response(handler, 400, {"status": "error", "message": "Taotlus on juba käsitletud"})
            return

        # Uuenda staatus
        update_registration_status(reg_id, "rejected", user["username"])

        send_json_response(handler, 200, {
            "status": "success",
            "message": "Taotlus tagasi lükatud"
        })

        print(f"Admin {user['username']} lükkas tagasi taotluse: {reg['name']} ({reg['email']})")

    except Exception as e:
        print(f"REJECT REGISTRATION VIGA: {e}")
        handler.send_error(500, str(e))


def handle_admin_users(handler):
    """Tagastab kõigi kasutajate nimekirja (admin)."""
    try:
        data = read_request_data(handler)

        user = require_auth(handler, data, min_role='admin')
        if not user:
            return

        users = get_all_users()

        send_json_response(handler, 200, {
            "status": "success",
            "users": users
        })

    except Exception as e:
        print(f"ADMIN USERS VIGA: {e}")
        handler.send_error(500, str(e))


def handle_admin_users_update_role(handler):
    """Muudab kasutaja rolli (admin)."""
    try:
        data = read_request_data(handler)

        user = require_auth(handler, data, min_role='admin')
        if not user:
            return

        username = data.get('username')
        new_role = data.get('new_role')

        if not username or not new_role:
            send_json_response(handler, 400, {"status": "error", "message": "username ja new_role on kohustuslikud"})
            return

        success, message = update_user_role(username, new_role, user)

        status_code = 200 if success else 400
        send_json_response(handler, status_code, {
            "status": "success" if success else "error",
            "message": message
        })

    except Exception as e:
        print(f"UPDATE USER ROLE VIGA: {e}")
        handler.send_error(500, str(e))


def handle_admin_users_delete(handler):
    """Kustutab kasutaja (admin)."""
    try:
        data = read_request_data(handler)

        user = require_auth(handler, data, min_role='admin')
        if not user:
            return

        username = data.get('username')

        if not username:
            send_json_response(handler, 400, {"status": "error", "message": "username on kohustuslik"})
            return

        success, message = delete_user(username, user)

        status_code = 200 if success else 400
        send_json_response(handler, status_code, {
            "status": "success" if success else "error",
            "message": message
        })

    except Exception as e:
        print(f"DELETE USER VIGA: {e}")
        handler.send_error(500, str(e))


def handle_invite_set_password(handler):
    """Seab parooli invite tokeni abil (avalik, rate limited)."""
    try:
        # Rate limit kontroll
        client_ip = get_client_ip(handler)
        allowed, retry_after = check_rate_limit(client_ip, '/invite/set-password')
        if not allowed:
            print(f"RATE LIMIT: /invite/set-password blokeeritud IP-le {client_ip}")
            rate_limit_response(handler, retry_after)
            return

        data = read_request_data(handler)

        token = data.get('token', '').strip()
        password = data.get('password', '')

        if not token:
            send_json_response(handler, 400, {"status": "error", "message": "Token puudub"})
            return

        if not password or len(password) < 12:
            send_json_response(handler, 400, {"status": "error", "message": "Parool peab olema vähemalt 12 tähemärki"})
            return

        # Lihtsa parooli kontroll
        if len(set(password)) < 4:  # Liiga vähe erinevaid tähemärke
            send_json_response(handler, 400, {"status": "error", "message": "Parool on liiga lihtne - kasuta rohkem erinevaid tähemärke"})
            return

        # Keela numbrijadad, korduvad mustrid ja näidisparoolid
        simple_patterns = [
            '123456789012', '111111111111', 'aaaaaaaaaaaa', 'password1234', 'qwertyuiop12',
            'minukassarmastabkala', 'mycatloveseatingfish'  # Näidisparoolid vihjest
        ]
        if password.lower() in simple_patterns or password == password[0] * len(password):
            send_json_response(handler, 400, {"status": "error", "message": "Parool on liiga lihtne - vali tugevam parool"})
            return

        # Loo kasutaja
        new_user, error = create_user_from_invite(token, password)

        status_code = 200 if new_user else 400
        if new_user:
            response = {
                "status": "success",
                "message": "Kasutaja loodud",
                "username": new_user["username"],
                "name": new_user["name"]
            }
        else:
            response = {
                "status": "error",
                "message": error
            }

        send_json_response(handler, status_code, response)

    except Exception as e:
        print(f"SET PASSWORD VIGA: {e}")
        handler.send_error(500, str(e))


def handle_admin_git_failures(handler):
    """Tagastab viimased git commit ebaõnnestumised (admin)."""
    try:
        data = read_request_data(handler)

        user = require_auth(handler, data, min_role='admin')
        if not user:
            return

        action = data.get('action', 'list')

        if action == 'clear':
            clear_git_failures()
            send_json_response(handler, 200, {
                "status": "success",
                "message": "Ebaõnnestumiste nimekiri tühjendatud"
            })
        else:
            failures = get_git_failures()
            send_json_response(handler, 200, {
                "status": "success",
                "failures": failures,
                "count": len(failures)
            })

    except Exception as e:
        print(f"GIT FAILURES VIGA: {e}")
        handler.send_error(500, str(e))


def handle_admin_git_health(handler):
    """Käivitab git fsck ja tagastab tulemuse (admin)."""
    try:
        data = read_request_data(handler)

        user = require_auth(handler, data, min_role='admin')
        if not user:
            return

        result = run_git_fsck()

        send_json_response(handler, 200, {
            "status": "success",
            "git_ok": result["ok"],
            "output": result["output"],
            "errors": result["errors"]
        })

    except Exception as e:
        print(f"GIT HEALTH VIGA: {e}")
        handler.send_error(500, str(e))


def handle_admin_people_refresh(handler):
    """Käivitab isikute aliaste uuendamise taustalõimes (admin)."""
    try:
        data = read_request_data(handler)

        user = require_auth(handler, data, min_role='admin')
        if not user:
            return

        import threading
        thread = threading.Thread(target=refresh_all_people_safe, daemon=True)
        thread.start()

        print(f"Admin '{user['username']}' käivitas isikute aliaste uuendamise")

        send_json_response(handler, 200, {
            "status": "success",
            "message": "Uuendamine käivitatud"
        })

    except Exception as e:
        print(f"PEOPLE REFRESH VIGA: {e}")
        handler.send_error(500, str(e))


def handle_admin_people_refresh_status(handler):
    """Tagastab isikute aliaste uuendamise staatuse (admin)."""
    try:
        data = read_request_data(handler)

        user = require_auth(handler, data, min_role='admin')
        if not user:
            return

        status = get_refresh_status()
        send_json_response(handler, 200, {
            "status": "success",
            **status
        })

    except Exception as e:
        print(f"PEOPLE REFRESH STATUS VIGA: {e}")
        handler.send_error(500, str(e))
