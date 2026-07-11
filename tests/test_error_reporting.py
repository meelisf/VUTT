"""Vea-aggregatsiooni privaatsusfiltri testid."""
from server.error_reporting import init_error_reporting, scrub_event


def test_scrub_event_removes_sensitive_request_data():
    event = {
        "user": {"username": "editor"},
        "request": {
            "url": "https://vutt.ut.ee/api/files/save?token=secret",
            "method": "POST",
            "headers": {"authorization": "Bearer secret"},
            "data": {"text": "transkriptsioon"},
            "cookies": {"session": "secret"},
        },
        "breadcrumbs": {"values": [{"category": "fetch", "data": {"url": "?token=secret"}}]},
    }

    result = scrub_event(event, {})

    assert "user" not in result
    assert result["request"] == {
        "url": "https://vutt.ut.ee/api/files/save",
        "method": "POST",
    }
    assert "data" not in result["breadcrumbs"]["values"][0]


def test_error_reporting_is_disabled_without_dsn(monkeypatch):
    monkeypatch.delenv("ERROR_REPORTING_DSN", raising=False)
    assert init_error_reporting() is False
