"""
Server moodulid.
Eraldatud file_server.py-st parema hallatavuse jaoks.
"""

# Konfiguratsioon
from .config import (
    BASE_DIR, PORT, USERS_FILE, PENDING_REGISTRATIONS_FILE,
    INVITE_TOKENS_FILE, PENDING_EDITS_FILE, ALLOWED_ORIGINS,
    RATE_LIMITS, SESSION_DURATION, MEILI_URL, MEILI_KEY, INDEX_NAME
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

# Pending edits
from .pending_edits import (
    load_pending_edits, save_pending_edits, create_pending_edit,
    get_pending_edit_by_id, get_pending_edits_for_page,
    get_user_pending_edit_for_page, update_pending_edit_status,
    check_base_text_conflict
)

# Git operatsioonid
from .git_ops import (
    get_or_init_repo, save_with_git, get_file_git_history,
    get_file_at_commit, get_file_diff, commit_new_work_to_git,
    get_recent_commits
)

# Meilisearch operatsioonid
from .meilisearch_ops import (
    send_to_meilisearch, sync_work_to_meilisearch,
    index_new_work, metadata_watcher_loop
)

# Abifunktsioonid
from .utils import (
    sanitize_id, find_directory_by_id, generate_default_metadata,
    normalize_genre, calculate_work_status
)
