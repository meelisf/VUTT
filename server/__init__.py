"""
Server moodulid.
Eraldatud file_server.py-st parema hallatavuse jaoks.
"""

# Konfiguratsioon
from .config import (
    BASE_DIR, PORT, USERS_FILE, PENDING_REGISTRATIONS_FILE,
    INVITE_TOKENS_FILE, PENDING_EDITS_FILE, ALLOWED_ORIGINS,
    RATE_LIMITS, SESSION_DURATION, MEILI_URL, MEILI_KEY, INDEX_NAME,
    COLLECTIONS_FILE, VOCABULARIES_FILE,
    UPLOAD_ENABLED,
    get_logger
)

# CORS
from .cors import get_cors_origin, send_cors_headers

# Rate limiting
from .rate_limit import get_client_ip, check_rate_limit, rate_limit_response

# Autentimine
from .auth import (
    sessions, load_users, save_users, verify_user,
    create_session, get_session, delete_session, require_token, require_auth,
    get_all_users, update_user_role, delete_user
)

# Registreerimine ja invite tokenid
from .registration import (
    load_pending_registrations, save_pending_registrations,
    add_registration, get_registration_by_id, update_registration_status,
    load_invite_tokens, save_invite_tokens, create_invite_token,
    validate_invite_token, create_user_from_invite
)

# Pending edits (äriloogika)
from .pending_edits import (
    load_pending_edits, save_pending_edits, create_pending_edit,
    get_pending_edit_by_id, get_pending_edits_for_page,
    get_user_pending_edit_for_page, update_pending_edit_status,
    check_base_text_conflict
)

# Git operatsioonid
from .git_ops import (
    get_or_init_repo, save_with_git, get_file_git_history,
    get_file_at_commit, get_file_diff, get_commit_diff, commit_new_work_to_git,
    get_recent_commits, get_git_failures, clear_git_failures, run_git_fsck,
    delete_work_from_git, delete_page_from_git
)

# Meilisearch operatsioonid
from .meilisearch_ops import (
    send_to_meilisearch, sync_work_to_meilisearch,
    sync_work_to_meilisearch_async,
    index_new_work, metadata_watcher_loop,
    delete_work_from_meilisearch
)

# Inimeste/autorite andmed
from .people_ops import (
    load_people_data, save_people_data, process_creators_metadata, update_person_async,
    refresh_all_people, refresh_all_people_safe, people_refresh_loop, get_refresh_status
)

# Abifunktsioonid
from .utils import (
    atomic_write_json, metadata_lock, page_json_lock,
    sanitize_id, find_directory_by_id, generate_default_metadata,
    normalize_genre, calculate_work_status,
    get_label, get_id, get_all_labels, get_primary_labels, get_labels_by_lang, get_all_ids,
    build_work_id_cache, WORK_ID_CACHE
)

# Upload operatsioonid (admin teose lisamine PDF/piltidest)
from .upload_ops import (
    sanitize_slug, check_slug_conflict,
    create_upload, list_uploads, get_upload,
    mark_page_deleted, cancel_upload,
    # Etapp 2: SFTP transport ja OCR jälgimine
    upload_progress,
    save_and_transfer_to_ocr, add_image_page, poll_and_sync_thumbs, get_ocr_status,
    # Etapp 4: import VUTT-i
    import_as_work,
)

# Re-OCR operatsioonid (olemasoleva lehekülje uuesti transkribeerimine)
from .reocr_ops import (
    start_reocr_job, poll_reocr_job, list_reocr_jobs,
    get_active_reocr_count, REOCR_MAX_CONCURRENT, get_reocr_log,
)
