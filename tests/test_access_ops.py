import pytest

COLLECTIONS_PUBLIC = {
    "col-public": {"name": {"et": "Avalik"}, "visibility": "public"},
    "col-restricted": {"name": {"et": "Piiratud"}, "visibility": "restricted"},
}


@pytest.fixture(autouse=True)
def mock_collections(monkeypatch):
    import server.access_ops as ao
    monkeypatch.setattr(ao, "get_cached_collections", lambda: COLLECTIONS_PUBLIC)


def test_no_collections_is_public():
    from server.access_ops import is_work_public
    assert is_work_public({"collections": []}) is True
    assert is_work_public({}) is True


def test_public_collection_wins():
    from server.access_ops import is_work_public
    assert is_work_public({"collections": ["col-public"]}) is True


def test_restricted_collection_is_not_public():
    from server.access_ops import is_work_public
    assert is_work_public({"collections": ["col-restricted"]}) is False


def test_public_wins_over_restricted():
    from server.access_ops import is_work_public
    assert is_work_public({"collections": ["col-restricted", "col-public"]}) is True


def test_unknown_collection_defaults_to_public():
    from server.access_ops import is_work_public
    assert is_work_public({"collections": ["col-unknown"]}) is True


def test_can_read_public_work_anonymous():
    from server.access_ops import can_read_work
    assert can_read_work({"collections": ["col-public"]}, user=None) is True


def test_can_read_shareable_work_anonymous():
    from server.access_ops import can_read_work
    assert can_read_work({"collections": ["col-restricted"], "shareable": True}, user=None) is True


def test_cannot_read_restricted_anonymous():
    from server.access_ops import can_read_work
    assert can_read_work({"collections": ["col-restricted"]}, user=None) is False


def test_admin_reads_restricted():
    from server.access_ops import can_read_work
    user = {"role": "admin", "allowed_collections": []}
    assert can_read_work({"collections": ["col-restricted"]}, user=user) is True


def test_user_with_allowed_collection_reads_restricted():
    from server.access_ops import can_read_work
    user = {"role": "contributor", "allowed_collections": ["col-restricted"]}
    assert can_read_work({"collections": ["col-restricted"]}, user=user) is True


def test_user_without_allowed_collection_cannot_read_restricted():
    from server.access_ops import can_read_work
    user = {"role": "editor", "allowed_collections": []}
    assert can_read_work({"collections": ["col-restricted"]}, user=user) is False


def test_user_without_matching_collection_cannot_read():
    from server.access_ops import can_read_work
    user = {"role": "contributor", "allowed_collections": ["other-col"]}
    assert can_read_work({"collections": ["col-restricted"]}, user=user) is False


# ---- can_write_work (Leid G) ----

def test_editor_can_write_public_work():
    """Avalik teos on editorile alati kirjutatav (töölaua normaaljuht)."""
    from server.access_ops import can_write_work
    user = {"role": "editor", "allowed_collections": []}
    assert can_write_work({"collections": ["col-public"]}, user=user) is True
    assert can_write_work({"collections": []}, user=user) is True


def test_editor_cannot_write_restricted_without_collection():
    """Piiratud teosesse ei saa editor ilma allowed_collections kattuvuseta kirjutada."""
    from server.access_ops import can_write_work
    user = {"role": "editor", "allowed_collections": []}
    assert can_write_work({"collections": ["col-restricted"]}, user=user) is False


def test_editor_can_write_restricted_with_collection():
    from server.access_ops import can_write_work
    user = {"role": "editor", "allowed_collections": ["col-restricted"]}
    assert can_write_work({"collections": ["col-restricted"]}, user=user) is True


def test_admin_can_write_restricted():
    from server.access_ops import can_write_work
    user = {"role": "admin", "allowed_collections": []}
    assert can_write_work({"collections": ["col-restricted"]}, user=user) is True


def test_anonymous_cannot_write():
    from server.access_ops import can_write_work
    assert can_write_work({"collections": ["col-public"]}, user=None) is False


def test_generate_meili_token_anonymous(monkeypatch):
    import jwt
    from server.meilisearch_ops import generate_meili_token
    import server.config as cfg
    cfg.MEILI_SEARCH_KEY = "test-key-32-chars-long-padding-x"
    cfg.MEILI_SEARCH_KEY_UID = "test-uid-1234"

    token = generate_meili_token(user=None)
    payload = jwt.decode(token, "test-key-32-chars-long-padding-x", algorithms=["HS256"])
    assert payload["searchRules"] == {"teosed": {"filter": "is_public = true"}}
    assert payload["apiKeyUid"] == "test-uid-1234"
    assert payload["exp"] > 0


def test_generate_meili_token_admin(monkeypatch):
    import jwt
    from server.meilisearch_ops import generate_meili_token
    import server.config as cfg
    cfg.MEILI_SEARCH_KEY = "test-key-32-chars-long-padding-x"
    cfg.MEILI_SEARCH_KEY_UID = "test-uid-1234"

    token = generate_meili_token(user={"role": "admin", "allowed_collections": []})
    payload = jwt.decode(token, "test-key-32-chars-long-padding-x", algorithms=["HS256"])
    assert payload["searchRules"] == {"teosed": {}}


def test_auth_meili_token_ttl_matches_session_duration():
    from server.config import SESSION_DURATION
    from server.routers.auth import USER_MEILI_TOKEN_TTL_SECONDS
    assert USER_MEILI_TOKEN_TTL_SECONDS == int(SESSION_DURATION.total_seconds())


def test_generate_meili_token_with_collection(monkeypatch):
    import jwt
    from server.meilisearch_ops import generate_meili_token
    import server.config as cfg
    cfg.MEILI_SEARCH_KEY = "test-key-32-chars-long-padding-x"
    cfg.MEILI_SEARCH_KEY_UID = "test-uid-1234"

    user = {"role": "contributor", "allowed_collections": ["herrnhuter"]}
    token = generate_meili_token(user=user)
    payload = jwt.decode(token, "test-key-32-chars-long-padding-x", algorithms=["HS256"])
    assert 'collections_hierarchy IN ["herrnhuter"]' in payload["searchRules"]["teosed"]["filter"]
    assert "is_public = true" in payload["searchRules"]["teosed"]["filter"]


# ---- can_write_work: contributor'i kollektsiooni-ulatus (ADR 0031) ----

def _contributor(edit_collections, allowed_collections=None):
    return {
        "username": "contrib",
        "role": "contributor",
        "edit_collections": edit_collections,
        "allowed_collections": allowed_collections or [],
    }


def test_contributor_can_write_own_collection():
    from server.access_ops import can_write_work
    meta = {"collections": ["col-public"]}
    assert can_write_work(meta, _contributor(["col-public"])) is True


def test_contributor_cannot_write_other_collection():
    from server.access_ops import can_write_work
    meta = {"collections": ["col-public"]}
    assert can_write_work(meta, _contributor(["col-muu"])) is False


def test_contributor_cannot_write_work_without_collections():
    from server.access_ops import can_write_work
    assert can_write_work({"collections": []}, _contributor(["col-public"])) is False


def test_contributor_with_empty_scope_writes_nothing():
    from server.access_ops import can_write_work
    assert can_write_work({"collections": ["col-public"]}, _contributor([])) is False


def test_contributor_scope_does_not_grant_read_access():
    """Invariant 1: kirjutamisulatus EI muutu kaudseks lugemisõiguseks.
    edit_collections=["col-restricted"], aga allowed_collections=[] → keeld."""
    from server.access_ops import can_write_work
    meta = {"collections": ["col-restricted"]}
    user = _contributor(["col-restricted"], allowed_collections=[])
    assert can_write_work(meta, user) is False


def test_contributor_writes_restricted_with_both_fields():
    from server.access_ops import can_write_work
    meta = {"collections": ["col-restricted"]}
    user = _contributor(["col-restricted"], allowed_collections=["col-restricted"])
    assert can_write_work(meta, user) is True


def test_editor_ignores_edit_collections():
    from server.access_ops import can_write_work
    meta = {"collections": ["col-public"]}
    user = {"username": "ed", "role": "editor", "edit_collections": [], "allowed_collections": []}
    assert can_write_work(meta, user) is True


def test_contributor_without_field_writes_nothing():
    """Puuduv edit_collections = tühi ulatus (fail-closed)."""
    from server.access_ops import can_write_work
    meta = {"collections": ["col-public"]}
    assert can_write_work(meta, {"username": "c", "role": "contributor"}) is False


def test_decision_does_not_consult_derived_index(monkeypatch):
    """ADR 0031 invariant 2: õigusotsus ei tohi puudutada work_collections_index'it.
    Kui mõni tulevane muudatus paneb ta sellest sõltuma, kukub see test."""
    from server.access_ops import can_write_work
    import server.prosopography.indices as indices

    def _explode(*args, **kwargs):
        raise AssertionError("õigusotsus ei tohi tuletatud indeksit lugeda")

    monkeypatch.setattr(indices, "_load_work_collections", _explode)
    meta = {"collections": ["col-public"]}
    assert can_write_work(meta, _contributor(["col-public"])) is True
