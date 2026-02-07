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
    validate_invite_token, use_invite_token, create_user_from_invite
)

# Pending edits (äriloogika)
from .pending_edits import (
    load_pending_edits, save_pending_edits, create_pending_edit,
    get_pending_edit_by_id, get_pending_edits_for_page,
    get_user_pending_edit_for_page, update_pending_edit_status,
    check_base_text_conflict
)

# Pending edits (HTTP handlerid)
from .pending_edits_handlers import (
    handle_save_pending, handle_pending_edits_list,
    handle_pending_edits_check, handle_pending_edits_approve,
    handle_pending_edits_reject
)

# Git operatsioonid
from .git_ops import (
    get_or_init_repo, save_with_git, get_file_git_history,
    get_file_at_commit, get_file_diff, get_commit_diff, commit_new_work_to_git,
    get_recent_commits, get_git_failures, clear_git_failures, run_git_fsck
)

# Meilisearch operatsioonid
from .meilisearch_ops import (
    send_to_meilisearch, sync_work_to_meilisearch,
    sync_work_to_meilisearch_async,
    index_new_work, metadata_watcher_loop
)

# Inimeste/autorite andmed
from .people_ops import (
    load_people_data, save_people_data, process_creators_metadata, update_person_async,
    refresh_all_people, refresh_all_people_safe, people_refresh_loop, get_refresh_status
)

# HTTP helperid
from .http_helpers import (
    send_json_response, read_request_data, require_auth as require_auth_handler
)

# Abifunktsioonid
from .utils import (
    atomic_write_json, metadata_lock, page_json_lock,
    sanitize_id, find_directory_by_id, generate_default_metadata,
    normalize_genre, calculate_work_status,
    get_label, get_id, get_all_labels, get_primary_labels, get_labels_by_lang, get_all_ids,
    build_work_id_cache
)

# Git HTTP handlerid
from .git_handlers import (
    handle_backups, handle_restore, handle_git_history,
    handle_git_restore, handle_git_diff, handle_commit_diff
)

# Admin HTTP handlerid
from .admin_handlers import (
    handle_admin_registrations, handle_admin_registrations_approve,
    handle_admin_registrations_reject, handle_admin_users,
    handle_admin_users_update_role, handle_admin_users_delete,
    handle_invite_set_password,
    handle_admin_git_failures, handle_admin_git_health,
    handle_admin_people_refresh, handle_admin_people_refresh_status
)

# Bulk operatsioonide HTTP handlerid
from .bulk_handlers import (
    handle_bulk_tags, handle_bulk_genre, handle_bulk_collection
)
