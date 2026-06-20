"""POST /prosopography/work-titles — kaitstud kollektsiooni teoste pealkirjad.

Anonüümne kasutaja ei saa Meilisearchist kaitstud teose pealkirja; see endpoint
tagastab pealkirja ikkagi, markeerides `restricted: true` (frontend keelab lingi).
"""

WORKS = {
    "work-public": {"title": "Avalik teos", "year": 1650, "collections": ["col-public"]},
    "work-restricted": {"title": "Kaitstud teos", "year": 1700, "collections": ["col-restricted"]},
}

COLLECTIONS = {
    "col-public": {"visibility": "public"},
    "col-restricted": {"visibility": "restricted"},
}


def _patch(monkeypatch):
    import server.prosopography.router as router
    import server.access_ops as ao
    monkeypatch.setattr(router, "_load_work_meta", lambda wid: WORKS.get(wid))
    monkeypatch.setattr(ao, "get_cached_collections", lambda: COLLECTIONS)


def test_work_titles_returns_title_and_restricted_flag(client, monkeypatch):
    _patch(monkeypatch)
    resp = client.post(
        "/prosopography/work-titles",
        json={"work_ids": ["work-public", "work-restricted"]},
    )
    assert resp.status_code == 200
    titles = resp.json()["titles"]
    assert titles["work-public"] == {"title": "Avalik teos", "year": 1650, "restricted": False}
    assert titles["work-restricted"] == {"title": "Kaitstud teos", "year": 1700, "restricted": True}


def test_work_titles_skips_unknown_work(client, monkeypatch):
    _patch(monkeypatch)
    resp = client.post("/prosopography/work-titles", json={"work_ids": ["puudub"]})
    assert resp.status_code == 200
    assert resp.json()["titles"] == {}


def test_work_titles_empty_list(client, monkeypatch):
    _patch(monkeypatch)
    resp = client.post("/prosopography/work-titles", json={"work_ids": []})
    assert resp.status_code == 200
    assert resp.json()["titles"] == {}


def test_work_titles_rejects_non_list(client, monkeypatch):
    _patch(monkeypatch)
    resp = client.post("/prosopography/work-titles", json={"work_ids": "x"})
    assert resp.status_code == 400


def test_work_titles_anonymous_allowed(client, monkeypatch):
    """Pealkiri pole salajane — endpoint töötab ilma autentimiseta."""
    _patch(monkeypatch)
    resp = client.post(
        "/prosopography/work-titles",
        json={"work_ids": ["work-restricted"]},
    )
    assert resp.status_code == 200
    assert resp.json()["titles"]["work-restricted"]["title"] == "Kaitstud teos"
