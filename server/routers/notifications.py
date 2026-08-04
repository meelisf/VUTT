"""
Teavituste (notifications) FastAPI router.

Tõstetud ``server/main.py``-st refaktoreeringu Faas 1-s
(``docs/_archive/REFACTOR_main_py_2026-06-25.md``). Äraloogika elab ``server/notifications_ops.py``-s;
siin on õhukesed endpoint'id, mis kasutavad ühiseid dependency'sid (``server/deps.py``).

Endpoint'id:
- ``POST /page-comments/reply`` — lisab kommentaarile vastuse (git commit + meilisearch
  sync) JA loob kommentaari autorile teatise. NB: cross-domain endpoint — puudutab
  comments/git/meilisearch/notifications domeene. Viidud siia, sest peamine "ära" on
  teatise loomine; kui kommentaaride domeen hiljem eraldatakse, saab selle ümber paigutada.
- ``GET /notifications`` — kasutaja enda teavitused (valikuline ?unread=true filter)
- ``GET /notification-recipients`` — kasutajate nimekiri teatise saatmiseks (editor+)
- ``POST /notifications/send`` — saada teatis (single/multiple/admins/all) — editor+,
  ``all`` režiim nõuab admin-i
- ``POST /notifications/{notification_id}/read`` — märgi teatis loetuks
"""
import os
import json
import unicodedata
import uuid
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request, Depends
from starlette.concurrency import run_in_threadpool

from ..config import BASE_DIR
from ..deps import get_user, require_role, get_json_data
from ..auth import get_all_users, role_level
from ..git_ops import save_with_git
from ..meilisearch_ops import sync_work_to_meilisearch_async
from ..notifications_ops import (
    load_notifications,
    save_notifications,
    create_notification,
    find_username_by_display_name,
    _notifications_lock,
)

router = APIRouter()


def _apply_reply_sync(catalog, filename, comment_id, reply_text, work_id, page_number, user):
    """Blokeeriv osa: faililugemine + git commit + teavitus. Jookseb threadpool'is,
    et event-loop ei külmuks (vt issue #111)."""
    txt_path = os.path.join(BASE_DIR, catalog, filename)
    json_path = os.path.join(BASE_DIR, catalog, os.path.splitext(filename)[0] + ".json")
    if not os.path.exists(txt_path) or not os.path.exists(json_path):
        raise HTTPException(status_code=404, detail="Lehekülje fail puudub")

    with open(json_path, 'r', encoding='utf-8') as f:
        meta_content = json.load(f)

    comments = meta_content.get('comments')
    if not isinstance(comments, list):
        comments = []
        meta_content['comments'] = comments

    target_comment = None
    for comment in comments:
        if isinstance(comment, dict) and str(comment.get('id')) == comment_id:
            target_comment = comment
            break
    if target_comment is None:
        raise HTTPException(status_code=404, detail="Kommentaari ei leitud")

    now = datetime.now().isoformat()
    reply = {
        "id": uuid.uuid4().hex,
        "text": reply_text,
        "author": user.get('name') or user['username'],
        "author_username": user['username'],
        "created_at": now,
    }
    replies = target_comment.get('replies')
    if not isinstance(replies, list):
        replies = []
        target_comment['replies'] = replies
    replies.append(reply)
    meta_content['updated_at'] = now

    with open(txt_path, 'r', encoding='utf-8') as f:
        text_content = f.read()

    git_result = save_with_git(
        txt_path,
        text_content,
        user['username'],
        message=f"Vasta kommentaarile: {os.path.relpath(json_path, BASE_DIR)}",
        additional_files=[(json_path, json.dumps(meta_content, indent=2, ensure_ascii=False))]
    )

    recipient = target_comment.get('author_username') or find_username_by_display_name(target_comment.get('author'))
    if recipient and recipient != user['username']:
        create_notification(
            recipient,
            "comment_reply",
            f"{user.get('name') or user['username']} vastas sinu kommentaarile",
            reply_text[:180],
            f"/work/{work_id or meta_content.get('work_id', '')}/{page_number}?comment={comment_id}",
            actor=user,
            metadata={
                "work_id": work_id or meta_content.get('work_id', ''),
                "page_number": page_number,
                "comment_id": comment_id,
                "reply_id": reply["id"],
                "text_preview": reply_text[:180],
            },
        )

    return {
        "status": "success",
        "comments": comments,
        "reply": reply,
        "commit_hash": git_result.get("commit_hash", "")[:8],
    }


def _deliver_notifications_sync(recipients, notification_type, title, body, link, user, users_by_username, recipient_mode):
    """Blokeeriv teavituste kirjutamine (file write per saaja). Jookseb threadpool'is."""
    created = [
        create_notification(
            recipient,
            notification_type,
            title,
            body,
            link,
            actor=user,
            metadata={"sent_by_role": user.get("role", "")},
        )
        for recipient in recipients
    ]
    recipient_names = [
        users_by_username[recipient].get("name") or recipient
        for recipient in recipients
        if recipient in users_by_username
    ]
    if user.get("username"):
        create_notification(
            user["username"],
            "sent_notification",
            title,
            body,
            link,
            actor=user,
            metadata={
                "sent_by_role": user.get("role", ""),
                "recipient_mode": recipient_mode,
                "recipient_usernames": recipients,
                "recipient_names": recipient_names,
                "delivered_count": len(created),
            },
        )
    return len(created)


@router.post("/page-comments/reply")
async def reply_to_page_comment(
    request: Request,
    background_tasks: BackgroundTasks,
    user=Depends(require_role("editor")),
):
    """Lisab lehekülje kommentaarile vastuse ja loob kommentaari autorile teavituse."""
    data = await get_json_data(request)
    catalog = os.path.basename(data.get('original_path', ''))
    filename = os.path.basename(data.get('file_name', ''))
    comment_id = str(data.get('comment_id', '')).strip()
    reply_text = unicodedata.normalize('NFC', str(data.get('text', '')).strip())
    work_id = str(data.get('work_id', '')).strip()
    page_number = int(data.get('page_number') or 0)

    if not catalog or not filename or not comment_id or not reply_text:
        raise HTTPException(status_code=400, detail="Puudulikud vastuse andmed")

    result = await run_in_threadpool(
        _apply_reply_sync, catalog, filename, comment_id, reply_text, work_id, page_number, user
    )
    background_tasks.add_task(sync_work_to_meilisearch_async, catalog)
    return result


@router.get("/notifications")
def get_notifications(request: Request, user=Depends(get_user)):
    """Kasutaja enda teavitused. ``?unread=true`` filtreerib loetud teatised välja."""
    unread_only = request.query_params.get('unread') == 'true'
    with _notifications_lock:
        notifications = load_notifications(user['username'])
    if unread_only:
        notifications = [n for n in notifications if not n.get('read_at')]
    return {"status": "success", "notifications": notifications}


@router.get("/notification-recipients")
async def get_notification_recipients(user=Depends(require_role("editor"))):
    """Kasutajate nimekiri teatise saatmise UI jaoks (editor+)."""
    users = [
        {
            "username": account.get("username"),
            "name": account.get("name") or account.get("username"),
            "role": account.get("role", "contributor"),
        }
        for account in get_all_users()
        if account.get("username")
    ]
    users.sort(key=lambda account: (account.get("name") or account.get("username") or "").lower())
    return {"status": "success", "users": users}


@router.post("/notifications/send")
async def send_notification(request: Request, user=Depends(require_role("editor"))):
    """Saada teatis ühele, mitmele, kõikidele admin-idele või kõigile.

    ``recipient_mode``:
    - ``single`` (vaikimisi): üks ``recipient_username``
    - ``multiple``: ``recipient_usernames`` list
    - ``admins``: kõik admin rolliga kasutajad
    - ``all``: kõik kasutajad (NB: nõuab admin rolli)

    Saatja saab alati koopia (``sent_notification`` tüüp) oma saadetud sõnumi kohta.
    """
    data = await get_json_data(request)
    recipient_mode = str(data.get("recipient_mode") or "single")
    recipient_username = str(data.get("recipient_username") or "").strip()
    recipient_usernames = data.get("recipient_usernames") or []
    title = unicodedata.normalize("NFC", str(data.get("title") or "").strip())
    body = unicodedata.normalize("NFC", str(data.get("body") or "").strip())
    link = str(data.get("link") or "").strip()

    if not title:
        raise HTTPException(status_code=400, detail="Pealkiri on kohustuslik")
    if len(title) > 160:
        raise HTTPException(status_code=400, detail="Pealkiri on liiga pikk")
    if len(body) > 2000:
        raise HTTPException(status_code=400, detail="Sõnum on liiga pikk")
    if link and not link.startswith("/"):
        raise HTTPException(status_code=400, detail="Link peab olema rakenduse-sisene")

    users_by_username = {
        account.get("username"): account
        for account in get_all_users()
        if account.get("username")
    }

    if recipient_mode == "all":
        if role_level(user.get("role", "contributor")) < role_level("admin"):
            raise HTTPException(status_code=403, detail="Kõigile teavitamine on lubatud ainult administraatorile")
        recipients = sorted(users_by_username.keys())
        notification_type = "system"
    elif recipient_mode == "admins":
        recipients = sorted([
            account.get("username")
            for account in get_all_users()
            if role_level(account.get("role", "contributor")) >= role_level("admin") and account.get("username")
        ])
        notification_type = "review_request"
    elif recipient_mode == "multiple":
        if not isinstance(recipient_usernames, list) or not recipient_usernames:
            raise HTTPException(status_code=400, detail="Saajad on kohustuslikud")
        recipients = [u for u in recipient_usernames if isinstance(u, str) and u in users_by_username]
        if not recipients:
            raise HTTPException(status_code=400, detail="Ühtegi kehtivat saajat ei leitud")
        notification_type = "review_request"
    else:
        if not recipient_username or recipient_username not in users_by_username:
            raise HTTPException(status_code=400, detail="Saajat ei leitud")
        recipients = [recipient_username]
        notification_type = "review_request"

    delivered = await run_in_threadpool(
        _deliver_notifications_sync,
        recipients, notification_type, title, body, link, user, users_by_username, recipient_mode
    )
    return {"status": "success", "created": delivered}


@router.post("/notifications/{notification_id}/read")
def mark_notification_read(notification_id: str, user=Depends(get_user)):
    """Märgib teatise loetuks (idempotentne: juba loetud teatis jääb loetuks)."""
    with _notifications_lock:
        notifications = load_notifications(user['username'])
        now = datetime.now().isoformat()
        for notification in notifications:
            if notification.get('id') == notification_id:
                notification['read_at'] = notification.get('read_at') or now
                break
        save_notifications(user['username'], notifications)
    return {"status": "success"}
