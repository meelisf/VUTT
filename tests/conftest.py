import hashlib
import importlib
import json
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


@pytest.fixture
def backend_env(tmp_path, monkeypatch):
    state_dir = tmp_path / "state"
    state_dir.mkdir()
    user_settings_dir = state_dir / "user_settings"
    user_settings_dir.mkdir()
    notifications_dir = state_dir / "notifications"
    notifications_dir.mkdir()
    uploads_dir = tmp_path / "uploads"
    uploads_dir.mkdir()

    users_file = state_dir / "users.json"
    pending_registrations_file = state_dir / "pending_registrations.json"
    invite_tokens_file = state_dir / "invite_tokens.json"
    collections_file = state_dir / "collections.json"

    users_file.write_text(
        json.dumps(
            {
                "admin": {
                    "password_hash": _sha256("adminpass"),
                    "name": "Admin User",
                    "email": "admin@example.test",
                    "role": "admin",
                    "created_at": "2026-01-01T00:00:00",
                },
                "editor": {
                    "password_hash": _sha256("editorpass"),
                    "name": "Editor User",
                    "email": "editor@example.test",
                    "role": "editor",
                    "created_at": "2026-01-01T00:00:00",
                },
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    pending_registrations_file.write_text('{"registrations": []}', encoding="utf-8")
    invite_tokens_file.write_text('{"tokens": []}', encoding="utf-8")
    collections_file.write_text(
        json.dumps(
            {
                "sample": {
                    "name": {"et": "Näidis", "en": "Sample"},
                    "color": "#cccccc",
                }
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    archives_file = state_dir / "archives.json"
    archives_file.write_text(
        json.dumps({"RA": {"name": "Rahvusarhiiv", "url": "https://ais.ra.ee"}}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    auth = importlib.import_module("server.auth")
    registration = importlib.import_module("server.registration")
    main = importlib.import_module("server.main")
    rate_limit = importlib.import_module("server.rate_limit")

    monkeypatch.setattr(auth, "USERS_FILE", str(users_file))
    monkeypatch.setattr(auth, "_users_cache", None)
    auth.sessions.clear()

    monkeypatch.setattr(registration, "USERS_FILE", str(users_file))
    monkeypatch.setattr(registration, "PENDING_REGISTRATIONS_FILE", str(pending_registrations_file))
    monkeypatch.setattr(registration, "INVITE_TOKENS_FILE", str(invite_tokens_file))

    # Refaktoreering Faas 0 (docs/REFACTOR_main_py_2026-06-25.md): ``main.py``-s
    # defineeritud konstandid (COLLECTIONS_FILE, ARCHIVES_FILE, ...) rändavad
    # faaside käigus routers/*.py-sse. ``_patch_config_const`` patchib neid
    # kõigis asjakohastes moodulites ühe helperiga JA nõuab, et vähemalt üks
    # moodul konstandi omaks (turvavõrk vaikse testi-katkemise vastu).
    #
    # NB: praegusel hetkel on reaalne omanik ``server.main`` (+ UPLOADS_DIR-i
    # jaoks ``server.upload_ops``) — need read on teadlik skafold: kui mõni faas
    # konstandi routerisse tõstab, lisatakse vastav moodul siia loetellu (main
    # jääb samuti, sest jätab re-eksporti kuni kõik viited uuenevad).
    # ``server.work_meta`` pole siin, sest see impordib ainult BASE_DIR (mitte
    # ühtegi neist konstantidest) — tõstaksime selle siia alles siis, kui work_meta
    # hakkaks mõnda neist importima.
    monkeypatch.setattr(main, "invalidate_cache", lambda: None)
    _patch_config_const(
        monkeypatch,
        {
            "COLLECTIONS_FILE": str(collections_file),
            "ARCHIVES_FILE": str(archives_file),
            "USER_SETTINGS_DIR": str(user_settings_dir),
            "NOTIFICATIONS_DIR": str(notifications_dir),
        },
        modules=["server.main", "server.notifications_ops"],
    )
    _patch_config_const(
        monkeypatch,
        {"UPLOADS_DIR": str(uploads_dir)},
        modules=["server.main", "server.upload_ops"],
    )

    upload_ops = importlib.import_module("server.upload_ops")
    upload_ops.upload_progress.clear()

    rate_limit._rate_limit_store.clear()

    @asynccontextmanager
    async def _noop_lifespan(_app):
        yield

    monkeypatch.setattr(main.app.router, "lifespan_context", _noop_lifespan)

    with TestClient(main.app) as client:
        yield {
            "client": client,
            "auth": auth,
            "registration": registration,
            "main": main,
            "state_dir": state_dir,
            "users_file": users_file,
            "invite_tokens_file": invite_tokens_file,
            "collections_file": collections_file,
            "archives_file": archives_file,
            "user_settings_dir": user_settings_dir,
            "notifications_dir": notifications_dir,
            "uploads_dir": uploads_dir,
            "upload_ops": upload_ops,
        }

    auth.sessions.clear()
    rate_limit._rate_limit_store.clear()
    upload_ops.upload_progress.clear()


def _patch_config_const(monkeypatch, name_value: dict, *, modules):
    """Patchib konstandi(d) vaid moodulites, mis seda TEGELIKULT impordivad.

    Refaktoreering Faas 0 infra (docs/REFACTOR_main_py_2026-06-25.md).
    ``modules`` on otsiruum: helper patchib ainult need moodulid, mis konstandi
    ``hasattr`` kaudu omavad (``raising=True`` vaikimisi — iga omanik peab ikka
    eksisteerima). Mitte-omanikke ignoreeritakse (nende jaoks ei looda
    fantoomatribuute).

    Turvavõrk (peamine): kui konstant on KÕIGIST loetletud moodulitest eemaldatud
    — nt keegi tõstis selle routerisse, aga unustas siia mooduli juurde lisada —
    viskab see ``AttributeError``. Ilma selleta patchituks vaikse no-op-ina ja
    testid jookseksid päris produktsiooni konstandi vastu. See on just see signaal,
    mida see refaktoreering lubab vältida (vaikne testi-katkemine).
    """
    for name, value in name_value.items():
        loaded = [importlib.import_module(m) for m in modules]
        owners = [m for m in loaded if hasattr(m, name)]
        if not owners:
            raise AttributeError(
                f"Konstant {name!r} puudub kõikidest moodulitest {modules!r} — "
                f"mingi refaktoreeringu faas on selle eemaldanud ilma conftesti "
                f"moodulite loetelu uuendamata (vaikse testi-katkemise kaitse)."
            )
        for mod in owners:
            monkeypatch.setattr(mod, name, value)


@pytest.fixture
def client(backend_env):
    return backend_env["client"]


@pytest.fixture
def login(client):
    def _login(username: str, password: str) -> str:
        response = client.post("/login", json={"username": username, "password": password})
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        return data["token"]

    return _login


@pytest.fixture
def make_upload(backend_env):
    def _make_upload(
        upload_id: str = "upl123",
        *,
        status: str = "pending",
        expected_pages: int = 2,
        files=None,
        meta=None,
    ):
        upload_dir = backend_env["uploads_dir"] / upload_id
        thumbs_dir = upload_dir / "thumbs"
        thumbs_dir.mkdir(parents=True, exist_ok=True)

        state = {
            "id": upload_id,
            "status": status,
            "meta": {
                "title": "Test Upload",
                "year": "1690",
                "slug": "test-upload",
            },
            "created_at": "2026-03-21T12:00:00",
            "expected_pages": expected_pages,
            "files": files or [],
        }
        if meta:
            state["meta"].update(meta)

        (upload_dir / "state.json").write_text(
            json.dumps(state, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return upload_dir, state

    return _make_upload
