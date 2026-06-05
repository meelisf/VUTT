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
