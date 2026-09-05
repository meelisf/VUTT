# Kasutaja keel-eelistus ja serveripoolne kasutajale nähtav tekst — teostusplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kasutaja keel-eelistus püütakse registreerimisel ja kandub kontoni; kirjatekst tuleb serveripoolsest mallist saaja keeles; teavituse masina-lause renderdatakse lugeja keeles lugemise hetkel.

**Architecture:** Uus valikuline väli `language` (`et`|`en`) kandub `pending_registrations.json` → `invite_tokens.json` → `users.json`. Kasutaja praegust keelt küsitakse ALATI ühest funktsioonist (`get_user_language`), mis eelistab `user_settings.language`-i. Kirjatekst elab repos tekstifailidena (`string.Template`), mida renderdab `server/mail_templates.py`; tarbija täna on admini `mailto:` nupp. Teavituste masina-teated renderdab frontend `type` + `actor_name` põhjal, salvestatud `title` jääb varuvõimaluseks.

**Tech Stack:** FastAPI (Python 3.9 ühilduvus!), pytest, React 19 + TypeScript, vitest, i18next.

**Spec:** `docs/superpowers/specs/2026-09-05-kasutaja-keel-ja-serveripoolne-tekst-design.md`

## Global Constraints

- **Python 3.9 ühilduvus:** `Optional[str]`, MITTE `str | None`. Ka `dict`/`list` tüübivihjed peavad tulema `typing`-ust (`Dict`, `List`), kui neid kasutatakse.
- **Blokeeriv I/O `async def` sees on keelatud (ADR 0002):** kas sync `def` route või `run_in_threadpool`.
- **i18n (ADR 0011):** `fallbackLng` on VÄLJAS — iga uus võti tuleb lisada `src/locales/et/*.json` JA `src/locales/en/*.json` **samas commitis**, muidu kukub `localeParity.test.ts`.
- **Koodikommentaarid eesti keeles.**
- **Keele normaliseerimise reegel (üks koht):** väiksed tähed → `-`-i eest osa → `et` | `en`, muidu `et`.
- **`users.json` keel on algväärtus, mitte autoriteet.** Ükski uus kood ei tohi lugeda `users.json`-i `language` välja otse — ainult `get_user_language()` kaudu.
- **`Template.substitute`, MITTE `safe_substitute`.** Puuduv platseholder peab andma `KeyError`.
- **Väravad iga taski lõpus:** `.venv/bin/pytest tests/ -q` (backend-taskid), `npm run typecheck && npm test` (frontend-taskid). `npm run lint:ci` lävi on 49 ja ei tohi tõusta.
- **Testid jooksevad ALATI projekti venv-ist:** `.venv/bin/pytest`, mitte süsteemi `python3`.

## Failistruktuur

| Fail | Vastutus | Task |
|---|---|---|
| `server/user_language.py` *(uus)* | `normalize_language` + `get_user_language` — ainuõige keeleallikas | 1 |
| `server/registration.py` *(muuda)* | `language` läbi taotluse, tokeni ja konto | 2 |
| `server/routers/auth.py` *(muuda)* | `/register` võtab `language` vastu | 2 |
| `server/routers/user_settings.py` *(muuda)* | puuduv `language` täidetakse `get_user_language`-ist | 3 |
| `server/email_templates/invite.{et,en}.txt` *(uus)* | kirjatekst, ainus allikas | 4 |
| `server/mail_templates.py` *(uus)* | malli laadimine + renderdus | 4 |
| `server/routers/admin.py` *(muuda)* | `approve` võtab `language`, tagastab `mail_subject`/`mail_body` | 5 |
| `src/pages/Register.tsx` *(muuda)* | nähtav keelevalik vormil | 6 |
| `src/pages/admin/Registrations.tsx` *(muuda)* | keele korrigeerimine + mailto serveri tekstist | 7 |
| `src/utils/notificationText.ts` *(uus)* | teavituse pealkirja ja liigi tuletamine, jagatud | 8 |
| `src/pages/Notifications.tsx`, `src/components/UserMenu.tsx` *(muuda)* | kasutavad jagatud moodulit | 8 |
| `docs/decisions/0033-*.md` *(uus)* | invariant kirja | 9 |

**Kõrvalekalle spekist (Task 8):** spekk ütleb, et `UserMenu.tsx` kuvab teavituse pealkirju. Kontrollitud — ei kuva, ainult loendab lugemata teateid (`UserMenu.tsx:80-83`). Jagatud moodulisse läheb seega mõlemast failist dubleeritud `isSentNotification` ja ainult `Notifications.tsx`-i vajatav `notificationTitle`. Spekki parandatakse Task 9-s koos ADR-iga.

---

### Task 1: Keele normaliseerimine ja ainuõige keeleallikas

**Files:**
- Create: `server/user_language.py`
- Test: `tests/test_user_language.py`

**Interfaces:**
- Consumes: `server.auth.load_users`, `server.user_settings_ops.load_user_settings` (olemas)
- Produces:
  - `DEFAULT_LANGUAGE = "et"`, `SUPPORTED_LANGUAGES = ("et", "en")`
  - `normalize_language(value) -> str` — alati `"et"` või `"en"`
  - `get_user_language(username) -> str`

- [ ] **Step 1: Write the failing test**

`tests/test_user_language.py`:

```python
"""Testid keele normaliseerimisele ja ainuõigele keeleallikale.

`users.json` kannab keelt, mille inimene registreerudes valis; Seadetes tehtud
muudatus kirjutatakse `user_settings`-i. Kaks kirjutuskohta lahkneksid ajas,
seega on lugemiskoht üks: `get_user_language`.
"""
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.user_language import normalize_language, get_user_language


@pytest.mark.parametrize("raw,expected", [
    ("et", "et"),
    ("en", "en"),
    ("EN", "en"),          # suurtähed
    ("en-GB", "en"),       # brauseri i18n.language võib olla piirkonnaga
    ("et-EE", "et"),
    ("  en  ", "en"),      # ümbritsevad tühikud
    ("de", "et"),          # toetamata keel → saidi vaikekeel
    ("", "et"),
    (None, "et"),
    (123, "et"),           # mitte-string ei tohi visata
])
def test_normalize_language(raw, expected):
    assert normalize_language(raw) == expected


def test_get_user_language_prefers_user_settings(monkeypatch):
    """Seadetes tehtud valik võidab registreerimisel valitut."""
    from server import user_language
    monkeypatch.setattr(user_language, "load_users", lambda: {"anne": {"language": "et"}})
    monkeypatch.setattr(user_language, "load_user_settings", lambda u: {"language": "en"})
    assert get_user_language("anne") == "en"


def test_get_user_language_falls_back_to_users_json(monkeypatch):
    """Kui kasutaja pole Seadetes keelt puutunud, kehtib registreerimisel valitu."""
    from server import user_language
    monkeypatch.setattr(user_language, "load_users", lambda: {"anne": {"language": "en"}})
    monkeypatch.setattr(user_language, "load_user_settings", lambda u: {})
    assert get_user_language("anne") == "en"


def test_get_user_language_defaults_when_nothing_set(monkeypatch):
    """Vana kasutaja ilma keeleta = et, ilma migratsioonita."""
    from server import user_language
    monkeypatch.setattr(user_language, "load_users", lambda: {"anne": {}})
    monkeypatch.setattr(user_language, "load_user_settings", lambda u: {})
    assert get_user_language("anne") == "et"


def test_get_user_language_unknown_user(monkeypatch):
    """Tundmatu kasutajanimi ei tohi visata — kiri läheb vaikekeeles."""
    from server import user_language
    monkeypatch.setattr(user_language, "load_users", lambda: {})
    monkeypatch.setattr(user_language, "load_user_settings", lambda u: {})
    assert get_user_language("pole-olemas") == "et"


def test_get_user_language_survives_broken_settings(monkeypatch):
    """Katkine seadetefail ei tohi keele küsimist kukutada."""
    from server import user_language

    def _raise(_username):
        raise OSError("katkine fail")

    monkeypatch.setattr(user_language, "load_users", lambda: {"anne": {"language": "en"}})
    monkeypatch.setattr(user_language, "load_user_settings", _raise)
    assert get_user_language("anne") == "en"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_user_language.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'server.user_language'`

- [ ] **Step 3: Write minimal implementation**

`server/user_language.py`:

```python
"""Kasutaja keel-eelistus: normaliseerimine ja ainuõige lugemiskoht.

`users.json` kannab keelt, mille inimene registreerudes valis. Kui ta hiljem
Seadetes keelt muudab, kirjutatakse `user_settings` — MITTE `users.json`.
Kaks kirjutuskohta lahkneksid ajas, seega on lugemiskohti täpselt üks:
`get_user_language`. Ükski saatja ei tohi lugeda `users.json` `language` välja
otse.
"""
from typing import Optional

from .auth import load_users
from .config import get_logger
from .user_settings_ops import load_user_settings

logger = get_logger(__name__)

DEFAULT_LANGUAGE = "et"
SUPPORTED_LANGUAGES = ("et", "en")


def normalize_language(value) -> str:
    """Viib keelekoodi kanoonilisele kujule. Tundmatu või puuduv → vaikekeel.

    Normaliseerimine käib nii kirjutus- kui lugemisteel, seega vanad kirjed
    ilma `language` väljata käituvad nagu `et` ilma migratsioonita.
    """
    if not isinstance(value, str):
        return DEFAULT_LANGUAGE
    code = value.strip().lower().split("-")[0]
    return code if code in SUPPORTED_LANGUAGES else DEFAULT_LANGUAGE


def get_user_language(username: Optional[str]) -> str:
    """Kasutaja praegune keel: user_settings → users.json → vaikekeel.

    Ainuõige allikas iga serveripoolse teksti jaoks, mis saadetakse
    KONKREETSELE kasutajale.
    """
    if not username:
        return DEFAULT_LANGUAGE

    try:
        settings = load_user_settings(username) or {}
        if settings.get("language"):
            return normalize_language(settings["language"])
    except Exception as e:
        # Katkine seadetefail ei tohi keele küsimist kukutada — kiri läheb ikka välja.
        logger.warning(f"Kasutaja seadete lugemine ebaõnnestus ({username}): {e}")

    user = (load_users() or {}).get(username) or {}
    return normalize_language(user.get("language"))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_user_language.py -q`
Expected: PASS (11 testi)

- [ ] **Step 5: Run the full backend suite**

Run: `.venv/bin/pytest tests/ -q`
Expected: PASS, uute vigadeta

- [ ] **Step 6: Commit**

```bash
git add server/user_language.py tests/test_user_language.py
git commit -m "feat(i18n): keele normaliseerimine ja get_user_language ainuõige allikana"
```

---

### Task 2: Keel kandub registreerimisest kontoni

**Files:**
- Modify: `server/registration.py` (`add_registration:41`, `create_invite_token:182`, `create_user_from_invite:319`)
- Modify: `server/routers/auth.py:124-143` (`/register`)
- Test: `tests/test_registration_language.py`

**Interfaces:**
- Consumes: `normalize_language` (Task 1)
- Produces:
  - `add_registration(name, email, affiliation, motivation, gdpr_consent=False, language=None)` → kirjel võti `"language"`
  - `create_invite_token(email, name, created_by, username=None, role="editor", edit_collections=None, language=None)` → tokenil võti `"language"`
  - `create_user_from_invite` kirjutab `users[username]["language"]`

- [ ] **Step 1: Write the failing test**

`tests/test_registration_language.py`:

```python
"""Keel kandub vormilt kontoni: taotlus → token → users.json.

Ahel on neljakihiline ja iga kiht on eraldi fail; kui üks lüli keele maha
jätab, ei ole seda hiljem kuskilt võtta — inimene ei ole veel sisse loginud.
"""
import json


def _patch_registration_collections(backend_env, monkeypatch, collections_config):
    """Vt tests/test_registration_flow.py — `registration.py` impordib
    `get_cached_collections` OTSE, seega patchitakse see nimi, mitte fail."""
    monkeypatch.setattr(backend_env["registration"], "get_cached_collections", lambda: collections_config)


def _register_and_approve(client, login, backend_env, monkeypatch, register_body, approve_body=None):
    _patch_registration_collections(backend_env, monkeypatch, {"sample": {"name": {"et": "Näidis", "en": "Sample"}}})
    client.post("/register", json=register_body)
    admin_token = login("admin", "adminpass")
    headers = {"Authorization": f"Bearer {admin_token}"}
    listing = client.post("/admin/registrations", headers=headers)
    reg = listing.json()["registrations"][0]
    body = {"registration_id": reg["id"], "role": "editor", "edit_collections": []}
    body.update(approve_body or {})
    approve = client.post("/admin/registrations/approve", json=body, headers=headers)
    assert approve.status_code == 200, approve.text
    return reg, approve.json()


def test_language_travels_from_form_to_account(client, login, backend_env, monkeypatch):
    """en registreerimisvormil → en users.json kirjel."""
    reg, approve = _register_and_approve(client, login, backend_env, monkeypatch, {
        "name": "New User", "email": "new@example.test",
        "motivation": "I would like to help", "gdpr_consent": True,
        "language": "en",
    })
    assert reg["language"] == "en"

    set_pw = client.post("/set-password", json={
        "token": approve["invite_token"], "password": "TugevParool123",
    })
    assert set_pw.status_code == 200, set_pw.text

    users = json.loads(backend_env["users_file"].read_text(encoding="utf-8"))
    assert users[approve["username"]]["language"] == "en"


def test_unknown_language_falls_back_to_estonian(client, login, backend_env, monkeypatch):
    """Toetamata keel ei tohi kirjet katki teha ega tundmatut koodi salvestada."""
    reg, _ = _register_and_approve(client, login, backend_env, monkeypatch, {
        "name": "Hans", "email": "hans@example.test",
        "motivation": "Ich möchte helfen", "gdpr_consent": True,
        "language": "de",
    })
    assert reg["language"] == "et"


def test_missing_language_defaults_to_estonian(client, login, backend_env, monkeypatch):
    """Vana klient ei saada keelt üldse — kirje peab jääma kehtivaks."""
    reg, _ = _register_and_approve(client, login, backend_env, monkeypatch, {
        "name": "Mari", "email": "mari@example.test",
        "motivation": "soovin aidata", "gdpr_consent": True,
    })
    assert reg["language"] == "et"


def test_legacy_token_without_language_creates_estonian_user(backend_env, monkeypatch):
    """Enne seda muudatust loodud tokenil `language` võtit ei ole."""
    registration = backend_env["registration"]
    monkeypatch.setattr(registration, "get_cached_collections", lambda: {})
    token_data = registration.create_invite_token("vana@example.test", "Vana Kasutaja", "admin")
    tokens = json.loads(backend_env["invite_tokens_file"].read_text(encoding="utf-8"))
    for token in tokens["tokens"]:
        token.pop("language", None)
    backend_env["invite_tokens_file"].write_text(json.dumps(tokens), encoding="utf-8")

    user, error = registration.create_user_from_invite(token_data["token"], "TugevParool123")
    assert error is None, error
    users = json.loads(backend_env["users_file"].read_text(encoding="utf-8"))
    assert users[token_data["username"]]["language"] == "et"
```

**NB:** kasutatud `backend_env` võtmed on olemas (kontrollitud
`tests/conftest.py:173-183`): `auth`, `registration`, `users_file`,
`invite_tokens_file`, `user_settings_dir`. Uut teed testis ei konstrueerita.

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_registration_language.py -q`
Expected: FAIL — `KeyError: 'language'`

- [ ] **Step 3: Write minimal implementation**

`server/registration.py` — lisa import:

```python
from .user_language import normalize_language
```

`add_registration` signatuur ja kirje:

```python
def add_registration(name, email, affiliation, motivation, gdpr_consent=False, language=None):
```

```python
    registration = {
        "id": str(uuid.uuid4()),
        "name": name,
        "email": email.lower(),
        "username": suggest_username_for_email(email),
        "affiliation": affiliation,
        "motivation": motivation,
        # Keel püütakse vormilt: enne esimest sisselogimist ei ole kasutajal
        # ühtki teist kohta, kus oma keelt öelda.
        "language": normalize_language(language),
        "gdpr_consent_at": datetime.now().isoformat() if gdpr_consent else None,
        ...
    }
```

`create_invite_token` signatuur ja token:

```python
def create_invite_token(email, name, created_by, username=None, role="editor",
                        edit_collections=None, language=None):
```

```python
    token_data = {
        ...
        "edit_collections": sanitize_edit_collections(edit_collections or [], collections_config),
        "language": normalize_language(language),
    }
```

`create_user_from_invite` — konto kirje:

```python
    users[username] = {
        "password_hash": password_hash,
        "name": name,
        "email": email,
        "role": role,
        "edit_collections": token_data.get("edit_collections", []),
        # Vanadel tokenitel võtit ei ole → normalize_language(None) = "et"
        "language": normalize_language(token_data.get("language")),
        "created_at": datetime.now().isoformat()
    }
```

`server/routers/auth.py` `/register`:

```python
    registration, error = await run_in_threadpool(
        add_registration,
        data.get("name", ""),
        data.get("email", ""),
        data.get("affiliation"),
        data.get("motivation", ""),
        gdpr_consent=bool(data.get("gdpr_consent")),
        language=data.get("language"),
    )
```

`server/routers/admin.py` `approve` — anna taotluse keel tokenile edasi (täielik `language` parameeter tuleb Task 5-s):

```python
        role=data.get("role"),
        edit_collections=data.get("edit_collections", []),
        language=reg.get("language"),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_registration_language.py -q`
Expected: PASS (4 testi)

- [ ] **Step 5: Run the full backend suite**

Run: `.venv/bin/pytest tests/ -q`
Expected: PASS — eriti `tests/test_registration_flow.py` ja `tests/test_registration_username.py` peavad jääma roheliseks (uus parameeter on valikuline)

- [ ] **Step 6: Commit**

```bash
git add server/registration.py server/routers/auth.py server/routers/admin.py tests/test_registration_language.py
git commit -m "feat(i18n): keel kandub registreerimisest kontoni"
```

---

### Task 3: `/user-settings` seemendab keele kontolt

**Files:**
- Modify: `server/routers/user_settings.py:11-15` (`get_user_settings`)
- Test: `tests/test_user_settings_language_seed.py`

**Interfaces:**
- Consumes: `get_user_language` (Task 1)
- Produces: `GET /user-settings` vastuses on `settings.language` alati olemas

- [ ] **Step 1: Write the failing test**

`tests/test_user_settings_language_seed.py`:

```python
"""Esimesel sisselogimisel tuleb keel kontolt, ilma faili kirjutamata.

Migratsiooni ei tehta: `user_settings` fail tekib alles siis, kui kasutaja
midagi päriselt salvestab.
"""
import json
import os


def test_language_seeded_from_account(client, login, backend_env, monkeypatch):
    """Kasutaja pole Seadetes käinud → keel tuleb users.json-ist."""
    users = json.loads(backend_env["users_file"].read_text(encoding="utf-8"))
    users["admin"]["language"] = "en"
    backend_env["users_file"].write_text(json.dumps(users), encoding="utf-8")
    backend_env["auth"].reload_users_cache()

    token = login("admin", "adminpass")
    res = client.get("/user-settings", headers={"Authorization": f"Bearer {token}"})

    assert res.status_code == 200
    assert res.json()["settings"]["language"] == "en"


def test_seeding_does_not_write_settings_file(client, login, backend_env, monkeypatch):
    """Lugemine ei tohi kirjutada — seeme on tuletatud väärtus, mitte salvestus."""
    users = json.loads(backend_env["users_file"].read_text(encoding="utf-8"))
    users["admin"]["language"] = "en"
    backend_env["users_file"].write_text(json.dumps(users), encoding="utf-8")
    backend_env["auth"].reload_users_cache()

    token = login("admin", "adminpass")
    client.get("/user-settings", headers={"Authorization": f"Bearer {token}"})

    settings_path = os.path.join(str(backend_env["user_settings_dir"]), "admin.json")
    assert not os.path.exists(settings_path)


def test_saved_setting_wins_over_account(client, login, backend_env, monkeypatch):
    """Seadetes tehtud valik võidab registreerimisel valitut."""
    users = json.loads(backend_env["users_file"].read_text(encoding="utf-8"))
    users["admin"]["language"] = "en"
    backend_env["users_file"].write_text(json.dumps(users), encoding="utf-8")
    backend_env["auth"].reload_users_cache()

    token = login("admin", "adminpass")
    headers = {"Authorization": f"Bearer {token}"}
    client.post("/user-settings", json={"language": "et"}, headers=headers)

    res = client.get("/user-settings", headers=headers)
    assert res.json()["settings"]["language"] == "et"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_user_settings_language_seed.py -q`
Expected: FAIL — `KeyError: 'language'` (esimeses testis)

- [ ] **Step 3: Write minimal implementation**

`server/routers/user_settings.py`:

```python
from ..user_language import get_user_language
```

```python
# sync def → threadpool: kasutaja seadete faililugemine ei blokeeri event-loopi
@router.get("/user-settings")
def get_user_settings(request: Request, user=Depends(get_user)):
    """Tagastab kasutaja kõik seaded.

    Puuduv `language` täidetakse kontolt (registreerimisel valitud keel) —
    seeme, MITTE migratsioon: faili siin ei kirjutata. Fail tekib alles siis,
    kui kasutaja midagi päriselt salvestab.
    """
    settings = load_user_settings(user["username"])
    if not settings.get("language"):
        settings["language"] = get_user_language(user["username"])
    return {"status": "success", "settings": settings}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_user_settings_language_seed.py -q`
Expected: PASS (3 testi)

- [ ] **Step 5: Run the full backend suite**

Run: `.venv/bin/pytest tests/ -q`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/routers/user_settings.py tests/test_user_settings_language_seed.py
git commit -m "feat(i18n): /user-settings seemendab keele kontolt, faili kirjutamata"
```

---

### Task 4: Kirjamallid ja renderdaja

**Files:**
- Create: `server/email_templates/invite.et.txt`, `server/email_templates/invite.en.txt`
- Create: `server/mail_templates.py`
- Test: `tests/test_mail_templates.py`

**Interfaces:**
- Consumes: `normalize_language` (Task 1), `INVITE_EXPIRY_HOURS` (uus konstant, vt allpool)
- Produces:
  - `server.registration.INVITE_EXPIRY_HOURS = 48`
  - `render_mail(template_name: str, lang, **context) -> Tuple[str, str]` → `(subject, body)`
  - `MAILTO_BUDGET = 1800`

- [ ] **Step 1: Write the failing test**

`tests/test_mail_templates.py`:

```python
"""Kirjamallide renderdus.

Mallid on repos tekstifailidena, sest need kirjad lähevad välja ülikooli nimel
ja tekstimuudatus väärib ülevaatust. Katkine mall peab kukkuma siin, mitte
kasutaja postkastis.
"""
import sys
from pathlib import Path
from urllib.parse import quote

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from server.mail_templates import MAILTO_BUDGET, render_mail
from server.registration import INVITE_EXPIRY_HOURS

INVITE_CONTEXT = {
    "name": "Mari Maasikas",
    "username": "mmaasikas",
    "url": "https://vutt.utlib.ut.ee/set-password?token=abc123",
    "expires_hours": INVITE_EXPIRY_HOURS,
}


@pytest.mark.parametrize("lang", ["et", "en"])
def test_invite_renders_in_both_languages(lang):
    subject, body = render_mail("invite", lang, **INVITE_CONTEXT)
    assert subject and body
    # Ükski platseholder ei tohi renderdamata jääda
    assert "$" not in subject
    assert "$" not in body
    assert INVITE_CONTEXT["url"] in body
    assert INVITE_CONTEXT["username"] in body
    assert str(INVITE_EXPIRY_HOURS) in body


def test_languages_differ():
    """Kaks keelt ei tohi olla sama fail kaks korda."""
    et_subject, et_body = render_mail("invite", "et", **INVITE_CONTEXT)
    en_subject, en_body = render_mail("invite", "en", **INVITE_CONTEXT)
    assert et_subject != en_subject
    assert et_body != en_body


def test_unknown_language_falls_back_to_estonian():
    assert render_mail("invite", "de", **INVITE_CONTEXT) == render_mail("invite", "et", **INVITE_CONTEXT)


def test_missing_placeholder_raises(tmp_path):
    """Puuduv võti peab andma KeyError, MITTE saatma kirja, milles on $username."""
    with pytest.raises(KeyError):
        render_mail("invite", "et", name="Mari")


def test_unknown_template_raises():
    with pytest.raises(FileNotFoundError):
        render_mail("pole-olemas", "et")


def test_crlf_template_gives_same_result_as_lf(tmp_path, monkeypatch):
    """Windowsis toimetatud mall jätaks pealkirja lõppu nähtamatu \\r-i,
    mis läheks otse kirja Subject: päisesse."""
    from server import mail_templates

    (tmp_path / "proov.et.txt").write_bytes(b"Pealkiri\r\n\r\nTere $name,\r\nAitah.\r\n")
    monkeypatch.setattr(mail_templates, "TEMPLATE_DIR", str(tmp_path))

    subject, body = mail_templates.render_mail("proov", "et", name="Mari")
    assert subject == "Pealkiri"
    assert "\r" not in subject
    assert "\r" not in body
    assert body.startswith("Tere Mari,")


def test_template_without_blank_line_raises(tmp_path, monkeypatch):
    """Tühja reata mall on viga, mitte pealkirjata kiri."""
    from server import mail_templates

    (tmp_path / "vigane.et.txt").write_text("Ainult üks rida", encoding="utf-8")
    monkeypatch.setattr(mail_templates, "TEMPLATE_DIR", str(tmp_path))

    with pytest.raises(ValueError):
        mail_templates.render_mail("vigane", "et")


@pytest.mark.parametrize("lang", ["et", "en"])
def test_invite_fits_mailto_budget(lang):
    """Outlook lõikab pika mailto: URL-i vaikselt — lävi on mõõdetav, mitte soovitus."""
    subject, body = render_mail("invite", lang, **INVITE_CONTEXT)
    encoded = len(quote(subject)) + len(quote(body))
    assert encoded < MAILTO_BUDGET, f"{lang}: {encoded} märki, eelarve {MAILTO_BUDGET}"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_mail_templates.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'server.mail_templates'`

- [ ] **Step 3: Write minimal implementation**

`server/registration.py` — tõsta 48h konstandiks (kutsutakse mallis ja testides):

```python
# Kutselingi eluiga. Mall viitab samale konstandile — kaks kohta lahkneksid.
INVITE_EXPIRY_HOURS = 48
```

ja `create_invite_token`-is:

```python
    expires_at = datetime.now() + timedelta(hours=INVITE_EXPIRY_HOURS)
```

`server/email_templates/invite.et.txt`:

```
VUTT – konto aktiveerimise link

Tere $name,

Teie juurdepääsutaotlus VUTT platvormile on kinnitatud.

Teie kasutajanimi on: $username

Palun seadistage oma parool alloleva lingi kaudu (link kehtib $expires_hours tundi):
$url

Lugupidamisega,
VUTT meeskonna nimel
```

`server/email_templates/invite.en.txt`:

```
VUTT – account activation link

Dear $name,

Your request for access to the VUTT platform has been approved.

Your username is: $username

Please set your password using the link below (the link is valid for $expires_hours hours):
$url

Kind regards,
On behalf of the VUTT team
```

`server/mail_templates.py`:

```python
"""Kirjamallide laadimine ja renderdus.

Mallid on repos tekstifailidena (`server/email_templates/{nimi}.{keel}.txt`):
esimene rida = pealkiri, tühi rida, ülejäänu = keha. Platseholderid on
`string.Template` kujul (`$name`), sest stdlib katab vajaduse ja uut sõltuvust
ei ole vaja.

Kuupäevi mallides ei ole — kuupäev on lokaaditundlik ja tekitaks küsimuse,
kas vormindada „05.09.2026 kell 18:00" või „Sep 5, 2026". Kui mall siiski
kunagi kuupäeva vajab, vormindab selle KUTSUJA saaja keeles ja annab mallile
valmis stringi; `render_mail` ei võta vastu `datetime`-i.
"""
import os
from string import Template
from typing import Tuple

from .config import get_logger
from .user_language import normalize_language

logger = get_logger(__name__)

TEMPLATE_DIR = os.path.join(os.path.dirname(__file__), "email_templates")

# mailto: URL-i eelarve. Outlook lõikab pika URL-i vaikselt katki, seega on
# see mõõdetav lävi (vt tests/test_mail_templates.py), mitte soovitus.
MAILTO_BUDGET = 1800


def _template_path(template_name: str, lang: str) -> str:
    return os.path.join(TEMPLATE_DIR, f"{template_name}.{lang}.txt")


def render_mail(template_name: str, lang, **context) -> Tuple[str, str]:
    """Renderdab malli ja tagastab (pealkiri, keha).

    Kasutab `Template.substitute`, MITTE `safe_substitute`: puuduv võti peab
    andma `KeyError` testis, mitte saatma kasutajale kirja, milles seisab
    `$username`.
    """
    language = normalize_language(lang)
    path = _template_path(template_name, language)
    if not os.path.exists(path):
        raise FileNotFoundError(f"Kirjamalli ei leitud: {path}")

    with open(path, "r", encoding="utf-8") as f:
        raw = f.read().replace("\r\n", "\n")

    if "\n\n" not in raw:
        raise ValueError(f"Kirjamallil puudub pealkirja ja keha vahel tühi rida: {path}")

    subject, body = raw.split("\n\n", 1)
    return (
        Template(subject.strip()).substitute(**context),
        Template(body.strip()).substitute(**context),
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_mail_templates.py -q`
Expected: PASS (10 testi)

- [ ] **Step 5: Kinnita, et mallid lähevad Dockerisse kaasa**

Run: `grep -n "COPY server" Dockerfile && grep -c "txt" .dockerignore`
Expected: `Dockerfile:16: COPY server/ ./server/` — kogu pakett kopeeritakse, seega
uus alamkaust tuleb kaasa; `.dockerignore` ei filtreeri `*.txt`-d (grep annab 0).
Kontrollitud plaani kirjutamise ajal; kui väljund erineb, PEATU ja ütle, sest siis
läheks kood tootmisse mallideta.

- [ ] **Step 6: Run the full backend suite**

Run: `.venv/bin/pytest tests/ -q`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add server/mail_templates.py server/email_templates/ server/registration.py tests/test_mail_templates.py
git commit -m "feat(mail): kirjamallid repos tekstifailidena + renderdaja"
```

---

### Task 5: `approve` renderdab kirja saaja keeles

**Files:**
- Modify: `server/routers/admin.py:51-80` (`approve_registration`)
- Test: `tests/test_approve_mail_language.py`

**Interfaces:**
- Consumes: `render_mail` (Task 4), `normalize_language` (Task 1)
- Produces: `POST /admin/registrations/approve` vastuses `mail_subject`, `mail_body`, `language`; päring võtab valikulise `language`

- [ ] **Step 1: Write the failing test**

`tests/test_approve_mail_language.py`:

```python
"""Kutsekirja tekst tuleb serverist, saaja keeles.

Enne seda oli tekst kõvakodeeritud eesti keeles frontendis mailto: URL-i sees
— ingliskeelne kasutaja sai esimese kirja alati eesti keeles.
"""


def _approve(client, login, backend_env, monkeypatch, language=None, approve_language=None):
    monkeypatch.setattr(backend_env["registration"], "get_cached_collections", lambda: {})
    body = {
        "name": "New User", "email": "new@example.test",
        "motivation": "I would like to help", "gdpr_consent": True,
    }
    if language:
        body["language"] = language
    client.post("/register", json=body)

    admin_token = login("admin", "adminpass")
    headers = {"Authorization": f"Bearer {admin_token}"}
    reg_id = client.post("/admin/registrations", headers=headers).json()["registrations"][0]["id"]
    payload = {"registration_id": reg_id, "role": "editor", "edit_collections": []}
    if approve_language:
        payload["language"] = approve_language
    res = client.post("/admin/registrations/approve", json=payload, headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


def test_mail_rendered_in_requested_language(client, login, backend_env, monkeypatch):
    data = _approve(client, login, backend_env, monkeypatch, language="en")
    assert data["language"] == "en"
    assert "activation" in data["mail_subject"].lower()
    assert data["username"] in data["mail_body"]
    assert data["invite_url"] in data["mail_body"]
    assert "$" not in data["mail_body"]


def test_mail_defaults_to_estonian(client, login, backend_env, monkeypatch):
    data = _approve(client, login, backend_env, monkeypatch)
    assert data["language"] == "et"
    assert "aktiveerimise" in data["mail_subject"].lower()


def test_admin_can_override_language_at_approval(client, login, backend_env, monkeypatch):
    """Admin teab, et tegemist on väliskülalisega, kes täitis vormi ET lehel."""
    data = _approve(client, login, backend_env, monkeypatch, language="et", approve_language="en")
    assert data["language"] == "en"
    assert "activation" in data["mail_subject"].lower()


def test_mail_body_contains_absolute_url(client, login, backend_env, monkeypatch):
    """Kirjas peab olema klõpsatav täisaadress, mitte /set-password?token=..."""
    data = _approve(client, login, backend_env, monkeypatch)
    assert data["mail_body"].count("http") >= 1
```

**NB:** `PUBLIC_BASE_URL` konstanti `server/config.py`-s EI OLE (kontrollitud —
aadress esineb ainult `ALLOWED_ORIGINS` loendis, `config.py:211`). Lisa see
`ALLOWED_ORIGINS` ploki kõrvale, sama `os.getenv` mustriga mis mujal failis
(`config.py:242-247`):

```python
# =========================================================
# AVALIK AADRESS (kirjades olevad lingid)
# =========================================================

# Kirjas peab olema klõpsatav täisaadress — kasutaja postkastis ei ole
# `/set-password?token=...` millegi suhtes suhteline. Trailing slash
# eemaldatakse, et `f"{PUBLIC_BASE_URL}{invite_url}"` ei annaks kahekordset
# kaldkriipsu.
PUBLIC_BASE_URL = os.getenv("PUBLIC_BASE_URL", "https://vutt.utlib.ut.ee").rstrip("/")
```

ADR 0021 (env-nimede leping) nõuab ühte nime ühe seade kohta — `PUBLIC_BASE_URL`
on uus nimi, mitte vana ümbernimetus, seega legacy-loendisse midagi ei lisandu.
Jooksuta `.venv/bin/pytest tests/test_env_names.py -q` ja veendu, et roheline.

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/pytest tests/test_approve_mail_language.py -q`
Expected: FAIL — `KeyError: 'mail_subject'`

- [ ] **Step 3: Write minimal implementation**

`server/routers/admin.py`:

```python
from ..mail_templates import render_mail
from ..user_language import normalize_language
from ..registration import INVITE_EXPIRY_HOURS
from ..config import PUBLIC_BASE_URL
```

```python
    # Keele valib taotleja; admin saab selle enne kutse loomist üle kirjutada
    # (nt väliskülaline, kes täitis vormi eestikeelsel lehel).
    language = normalize_language(data.get("language") or reg.get("language"))
    token_data = await run_in_threadpool(
        create_invite_token, reg["email"], reg["name"], user["username"],
        username=reg.get("username"),
        role=data.get("role"),
        edit_collections=data.get("edit_collections", []),
        language=language,
    )
    invite_url = f"/set-password?token={token_data['token']}"
    # Kiri renderdatakse serveris: üks tekstiallikas nii tänasele mailto-nupule
    # kui #298 saatjale.
    mail_subject, mail_body = render_mail(
        "invite",
        language,
        name=token_data["name"],
        username=token_data["username"],
        url=f"{PUBLIC_BASE_URL}{invite_url}",
        expires_hours=INVITE_EXPIRY_HOURS,
    )
    return {
        "status": "success",
        "invite_token": token_data["token"],
        "invite_url": invite_url,
        "expires_at": token_data["expires_at"],
        "email": token_data["email"],
        "username": token_data["username"],
        "name": token_data["name"],
        "role": token_data["role"],
        "edit_collections": token_data["edit_collections"],
        "language": language,
        "mail_subject": mail_subject,
        "mail_body": mail_body,
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/pytest tests/test_approve_mail_language.py -q`
Expected: PASS (4 testi)

- [ ] **Step 5: Run the full backend suite**

Run: `.venv/bin/pytest tests/ -q`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add server/routers/admin.py server/config.py tests/test_approve_mail_language.py
git commit -m "feat(mail): approve renderdab kutsekirja saaja keeles"
```

---

### Task 6: Keelevalik registreerimisvormil

**Files:**
- Modify: `src/pages/Register.tsx:13-19` (`formData`), `:97-104` (POST keha), vormi markup
- Modify: `src/locales/et/register.json`, `src/locales/en/register.json`
- Test: `src/pages/__tests__/registerLanguage.test.tsx` (kui kausta ei ole, loo)

**Interfaces:**
- Consumes: `POST /register` `language` väli (Task 2)
- Produces: vormi väli `language`, vaikeväärtus `i18n.language`-ist

- [ ] **Step 1: Write the failing test**

`src/pages/__tests__/registerLanguage.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { defaultRegistrationLanguage } from '../registerLanguage';

describe('defaultRegistrationLanguage', () => {
  it('võtab UI keele, kui see on toetatud', () => {
    expect(defaultRegistrationLanguage('en')).toBe('en');
    expect(defaultRegistrationLanguage('et')).toBe('et');
  });

  it('kärbib piirkonna: brauseri i18n.language võib olla en-GB', () => {
    expect(defaultRegistrationLanguage('en-GB')).toBe('en');
    expect(defaultRegistrationLanguage('et-EE')).toBe('et');
  });

  it('langeb toetamata või puuduva keele korral eesti keelele', () => {
    expect(defaultRegistrationLanguage('de')).toBe('et');
    expect(defaultRegistrationLanguage('')).toBe('et');
    expect(defaultRegistrationLanguage(undefined)).toBe('et');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/pages/__tests__/registerLanguage.test.tsx`
Expected: FAIL — moodulit `../registerLanguage` ei ole

- [ ] **Step 3: Write minimal implementation**

`src/pages/registerLanguage.ts`:

```ts
/** Registreerimisvormi keelevalik. Sama reegel mis serveris:
 *  väiksed tähed → `-`-i eest osa → et|en, muidu et. */
export type UiLanguage = 'et' | 'en';

export const defaultRegistrationLanguage = (uiLanguage?: string): UiLanguage => {
  const code = (uiLanguage || '').trim().toLowerCase().split('-')[0];
  return code === 'en' ? 'en' : 'et';
};
```

`src/pages/Register.tsx`:

```tsx
const { t, i18n } = useTranslation(['register', 'common']);
```

```tsx
  const [language, setLanguage] = useState<UiLanguage>(defaultRegistrationLanguage(i18n.language));
```

Vormi väli (paiguta e-posti ja asutuse vahele, sama markup-muster mis rolli-select `Registrations.tsx`-is):

```tsx
            {/* Suhtluskeel — vaikimisi UI keel, aga inimene saab muuta:
                eestikeelset lehte sirviv väliskülaline soovib ingliskeelset kirja. */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {t('form.language')}
              </label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as UiLanguage)}
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none transition-colors"
                disabled={isSubmitting}
              >
                <option value="et">{t('form.languageEt')}</option>
                <option value="en">{t('form.languageEn')}</option>
              </select>
              <p className="mt-1 text-xs text-gray-500">{t('form.languageHint')}</p>
            </div>
```

POST kehasse:

```tsx
          gdpr_consent: true,
          language,
          website: formData.website  // Honeypot
```

Locales — `src/locales/et/register.json` `form` objekti:

```json
    "language": "Suhtluskeel",
    "languageEt": "Eesti keel",
    "languageEn": "Inglise keel",
    "languageHint": "Selles keeles saadame sulle konto aktiveerimise kirja."
```

`src/locales/en/register.json`:

```json
    "language": "Language",
    "languageEt": "Estonian",
    "languageEn": "English",
    "languageHint": "We will send your account activation email in this language."
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/pages/__tests__/registerLanguage.test.tsx`
Expected: PASS (3 testi)

- [ ] **Step 5: Run the frontend gates**

Run: `npm run typecheck && npm test`
Expected: PASS — sh `localeParity.test.ts` ja `translationKeysResolve.test.ts` peavad jääma roheliseks (mõlemad keeled said võtmed samas commitis)

- [ ] **Step 6: Commit**

```bash
git add src/pages/Register.tsx src/pages/registerLanguage.ts src/pages/__tests__/registerLanguage.test.tsx src/locales/et/register.json src/locales/en/register.json
git commit -m "feat(i18n): registreerimisvormil on suhtluskeele valik"
```

---

### Task 7: Admini vaade — keele korrigeerimine ja serveri tekst mailto-s

**Files:**
- Modify: `src/pages/admin/Registrations.tsx` (`Registration`/`InviteResult` liidesed `:25-44`, `handleApprove:118-140`, rolli-valiku plokk `:331-343`, mailto `:249-269`)
- Modify: `src/locales/et/admin.json`, `src/locales/en/admin.json`
- Test: käsitsi (UI), automaatselt katab backend Task 5

**Interfaces:**
- Consumes: `approve` vastuse `mail_subject`, `mail_body`, `language` (Task 5)
- Produces: —

- [ ] **Step 1: Laienda liidesed**

```tsx
interface Registration {
  ...
  language?: 'et' | 'en';
}

interface InviteResult {
  ...
  mail_subject: string;
  mail_body: string;
}
```

- [ ] **Step 2: Keelevalik heakskiitmise plokki**

Rolli-select'i kõrvale, sama `approveRole` muster:

```tsx
  const [approveLanguage, setApproveLanguage] = useState<Record<string, 'et' | 'en'>>({});
  const languageFor = (reg: Registration): 'et' | 'en' =>
    approveLanguage[reg.id] || reg.language || 'et';
```

```tsx
                          <label className="text-xs font-medium text-gray-500">{t('registrations.languageLabel')}</label>
                          <select
                            value={languageFor(reg)}
                            onChange={(e) =>
                              setApproveLanguage((prev) => ({ ...prev, [reg.id]: e.target.value as 'et' | 'en' }))
                            }
                            className="text-sm border border-gray-300 rounded px-2 py-1 w-fit"
                          >
                            <option value="et">{t('registrations.languageEt')}</option>
                            <option value="en">{t('registrations.languageEn')}</option>
                          </select>
```

`handleApprove` saadab keele kaasa ja koristab valiku samamoodi nagu rolli:

```tsx
      const data = await apiPost<RegistrationActionResponse>('/admin/registrations/approve', {
        registration_id: regId,
        role,
        edit_collections: scope,
        language: languageFor(registrations.find((r) => r.id === regId) as Registration),
      }, { token: authToken });
```

```tsx
        setApproveLanguage((prev) => { const next = { ...prev }; delete next[regId]; return next; });
```

`setInviteResult` võtab kaasa uued väljad:

```tsx
        setInviteResult({
          ...
          mail_subject: data.mail_subject,
          mail_body: data.mail_body
        });
```

- [ ] **Step 3: mailto kasutab serveri teksti**

Asenda kogu kõvakodeeritud eestikeelne plokk (`:249-269`):

```tsx
                  <a
                    href={`mailto:${inviteResult.email}?subject=${encodeURIComponent(inviteResult.mail_subject)}&body=${encodeURIComponent(inviteResult.mail_body)}`}
                    className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors flex items-center gap-1"
                  >
                    <Mail size={16} />
                    {t('registrations.sendEmail')}
                  </a>
```

`deriveUsernameFromEmail` import jääb alles ainult siis, kui seda kasutatakse mujal failis — **kontrolli `grep -n deriveUsernameFromEmail src/pages/admin/Registrations.tsx` ja eemalda kasutuseta import**, muidu kukub `npm run build`.

- [ ] **Step 4: Locales mõlemas keeles**

`src/locales/et/admin.json` → `registrations`:

```json
    "languageLabel": "Suhtluskeel",
    "languageEt": "Eesti keel",
    "languageEn": "Inglise keel",
```

`src/locales/en/admin.json` → `registrations`:

```json
    "languageLabel": "Language",
    "languageEt": "Estonian",
    "languageEn": "English",
```

- [ ] **Step 5: Run the frontend gates**

Run: `npm run typecheck && npm test && npm run lint:ci`
Expected: PASS, `lint:ci` hoiatusi ≤ 49

- [ ] **Step 6: Commit**

```bash
git add src/pages/admin/Registrations.tsx src/locales/et/admin.json src/locales/en/admin.json
git commit -m "feat(mail): admin näeb ja parandab keelt, mailto tuleb serveri mallist"
```

---

### Task 8: Teavituse masina-lause renderdatakse lugemisel

**Files:**
- Create: `src/utils/notificationText.ts`
- Create: `src/utils/__tests__/notificationText.test.ts`
- Modify: `src/pages/Notifications.tsx:29-39` (`notificationTitle`, `notificationBody`), `:50` (`isSentNotification`), `:322`, `:386`
- Modify: `src/components/UserMenu.tsx:81`

**Interfaces:**
- Consumes: `UserNotification` (`src/types.ts:167`)
- Produces:
  - `isSentNotification(n: UserNotification): boolean`
  - `notificationTitle(n: UserNotification, t: TFunction): string`

- [ ] **Step 1: Write the failing test**

`src/utils/__tests__/notificationText.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isSentNotification, notificationTitle } from '../notificationText';
import type { UserNotification } from '../../types';

// Tõlkefunktsiooni asendaja: tagastab võtme ja parameetrid, et test näeks,
// MILLIST võtit kasutati — mitte ainult seda, et mingi string tuli.
const t = ((key: string, opts?: Record<string, unknown>) =>
  opts?.actor ? `${key}:${opts.actor}` : key) as never;

const base: UserNotification = {
  id: 'n1',
  type: 'comment_reply',
  recipient_username: 'mari',
  created_at: '2026-09-05T10:00:00',
};

describe('notificationTitle', () => {
  it('renderdab masina teate tüübist, mitte salvestatud eestikeelsest lausest', () => {
    const n = { ...base, actor_name: 'Anne', title: 'Anne vastas sinu kommentaarile' };
    expect(notificationTitle(n, t)).toBe('notifications.commentReply:Anne');
  });

  it('langeb salvestatud pealkirjale, kui actor_name puudub', () => {
    const n = { ...base, title: 'Keegi vastas sinu kommentaarile' };
    expect(notificationTitle(n, t)).toBe('Keegi vastas sinu kommentaarile');
  });

  it('ei renderda undefined-it, kui ei ole pealkirja ega actor_name-i', () => {
    expect(notificationTitle(base, t)).toBe('notifications.commentReplyFallback');
  });

  it('inimese kirjutatud pealkirja ei asenda', () => {
    const n: UserNotification = { ...base, type: 'sent_notification', title: 'Koosolek reedel' };
    expect(notificationTitle(n, t)).toBe('Koosolek reedel');
  });

  it('tundmatu tüüp langeb salvestatud pealkirjale', () => {
    const n: UserNotification = { ...base, type: 'midagi_uut', title: 'Uus asi' };
    expect(notificationTitle(n, t)).toBe('Uus asi');
  });
});

describe('isSentNotification', () => {
  it('eristab saadetud koopiat saabunud teatest', () => {
    expect(isSentNotification({ ...base, type: 'sent_notification' })).toBe(true);
    expect(isSentNotification(base)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/__tests__/notificationText.test.ts`
Expected: FAIL — moodulit `../notificationText` ei ole

- [ ] **Step 3: Write minimal implementation**

`src/utils/notificationText.ts`:

```ts
import type { TFunction } from 'i18next';
import type { UserNotification } from '../types';

/**
 * Teavituse teksti tuletamine.
 *
 * INVARIANT: server ei salvesta lugejale nähtavat lauset, mille ta oskaks
 * teavituse tüübist tuletada. Masina teade (`comment_reply`) renderdatakse
 * SIIN, lugeja praeguses keeles; inimese kirjutatud tekst (admini saadetud
 * sõnum) jääb täpselt nii, nagu ta kirjutati — masintõlget ei tehta.
 *
 * Salvestatud `title` jääb varuvõimaluseks: vana kirje, katkine metadata või
 * tundmatu tüüp langeb selle peale tagasi. Eestikeelne lause on halb,
 * „undefined vastas sinu kommentaarile" on hullem.
 */

/** Tüübid, mille lause server genereerib ja mis tuleb seetõttu ise renderdada. */
const MACHINE_TYPES: Record<string, (n: UserNotification) => boolean> = {
  // Vajab actor_name-i: ilma selleta ei ole lauset, mida renderdada.
  comment_reply: (n) => Boolean(n.actor_name),
};

export const isSentNotification = (notification: UserNotification): boolean =>
  notification.type === 'sent_notification';

export const notificationTitle = (notification: UserNotification, t: TFunction): string => {
  const canRender = MACHINE_TYPES[notification.type];
  if (canRender && canRender(notification)) {
    return t('notifications.commentReply', { actor: notification.actor_name });
  }
  if (notification.title) return notification.title;
  return t('notifications.commentReplyFallback');
};
```

Locales — `src/locales/et/common.json` `notifications` objekti (`commentReplyFallback` on juba olemas, jäta alles):

```json
    "commentReply": "{{actor}} vastas sinu kommentaarile",
```

`src/locales/en/common.json`:

```json
    "commentReply": "{{actor}} replied to your comment",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils/__tests__/notificationText.test.ts`
Expected: PASS (6 testi)

- [ ] **Step 5: Ühenda kasutuskohad**

`src/pages/Notifications.tsx` — kustuta lokaalsed `notificationTitle` (`:29-35`) ja `isSentNotification` (`:50`), impordi jagatud moodulist:

```tsx
import { isSentNotification, notificationTitle } from '../utils/notificationText';
```

Kutsekohad `:322` ja `:386` kaotavad teise argumendi ja saavad `t`-i:

```tsx
{notificationTitle(notification, t)}
```

```tsx
{notificationTitle(replyingTo, t)}
```

`src/components/UserMenu.tsx` — kustuta lokaalne `isSentNotification` (`:81`) ja impordi:

```tsx
import { isSentNotification } from '../utils/notificationText';
```

- [ ] **Step 6: Run the frontend gates**

Run: `npm run typecheck && npm test && npm run lint:ci`
Expected: PASS

- [ ] **Step 7: Käsitsi kontroll**

Ava Teavitused eesti keeles ja lülita keel inglise keelde: **juba olemasolev** `comment_reply` teavitus peab pealkirja vahetama (`Anne vastas sinu kommentaarile` → `Anne replied to your comment`), admini saadetud sõnum aga MITTE.

- [ ] **Step 8: Commit**

```bash
git add src/utils/notificationText.ts src/utils/__tests__/notificationText.test.ts src/pages/Notifications.tsx src/components/UserMenu.tsx src/locales/et/common.json src/locales/en/common.json
git commit -m "feat(i18n): teavituse masina-lause renderdatakse lugeja keeles"
```

---

### Task 9: ADR ja spekiparandus

**Files:**
- Create: `docs/decisions/0033-serveripoolne-kasutajale-nahtav-tekst.md`
- Modify: `docs/decisions/README.md` (registririda)
- Modify: `docs/superpowers/specs/2026-09-05-kasutaja-keel-ja-serveripoolne-tekst-design.md` (UserMenu täpsustus)

- [ ] **Step 1: Kirjuta ADR**

Sisu peab katma kolm otsust ja iga otsuse **põhjuse**:

1. **Serveris sündiv kasutajale nähtav tekst jaguneb kaheks.** Rakenduses loetav (teavitus) → server salvestab tüübi ja parameetrid, lause renderdab lugeja pool tema PRAEGUSES keeles. Süsteemist lahkuv (kiri) → server renderdab saaja SALVESTATUD keeles, mallist. Põhjus: teavitust loetakse seal, kus lugeja keel on teada; kiri läheb sinna, kus ei ole.
2. **Kasutaja keelt küsitakse ühest funktsioonist** (`get_user_language`): `user_settings.language` → `users.json.language` → `et`. Üks kirjutuskoht, üks lugemiskoht. Kahekordne kirjutamine lahkneks ajas ja viga ilmneks alles siis, kui esimene automaatkiri välja läheb.
3. **Mallid on repos, `Template.substitute`-ga.** Puuduv platseholder on `KeyError` CI-s, mitte `$username` kasutaja postkastis. Kuupäevi mallides ei ole; kui vaja, vormindab kutsuja saaja keeles.

Lisa „Mis EI muutu": inimese kirjutatud teksti ei tõlgita ega asendata üheski suunas.

- [ ] **Step 2: Lisa registririda**

`docs/decisions/README.md` tabeli lõppu:

```markdown
| [0033](0033-serveripoolne-kasutajale-nahtav-tekst.md) | Rakenduses loetav tekst renderdatakse lugeja keeles, lahkuv tekst saaja salvestatud keeles; keelt küsitakse ühest funktsioonist | kehtib |
```

- [ ] **Step 3: Paranda spekk**

Spekk väidab, et `UserMenu.tsx` kuvab teavituse pealkirju. Ei kuva — loendab ainult lugemata teateid. Paranda lõik nii, et jagatud moodulisse läheb `isSentNotification` (dubleeritud mõlemas failis) ja `notificationTitle` (ainult `Notifications.tsx` vajab).

- [ ] **Step 4: Commit**

```bash
git add docs/decisions/ docs/superpowers/specs/
git commit -m "docs(adr): 0033 — serveripoolne kasutajale nähtav tekst"
```

---

### Task 10: Lõppkontroll ja PR

- [ ] **Step 1: Kõik väravad korraga**

```bash
.venv/bin/pytest tests/ -q && npm run typecheck && npm test && npm run lint:ci
```

Expected: pytest PASS, vitest PASS, typecheck vaikib, lint ≤ 49 hoiatust

- [ ] **Step 2: Käsitsi läbimäng**

1. Registreeru ingliskeelselt lehelt keelega „English".
2. Admini vaates: taotlusel on näha keel; kinnita.
3. Vajuta „Saada e-kiri" — mailto avaneb **ingliskeelse** tekstiga, milles on õige kasutajanimi, täisaadressiga link ja „48 hours".
4. Sea parool, logi sisse — UI tuleb üles inglise keeles ilma käsitsi valikuta.
5. Muuda Seadetes keel eesti keeleks, logi välja ja uuesti sisse — UI on eesti keeles (`user_settings` võidab).

- [ ] **Step 3: PR**

```bash
git push -u origin feat/kasutaja-keel-299
gh pr create --base main --title "Kasutaja keel-eelistus ja serveripoolne kasutajale nähtav tekst (#299)" --body "..."
```

PR-i kirjeldusse: probleem (kolm mõõdetud kohta spekist), lahendus osade kaupa, testide arv, viide spekile ja ADR-ile, ning märkus, et `password_reset` mall on teadlikult väljas (tarbijat ei ole enne #298).

---

## Enesekontroll (plaani kirjutaja tehtud)

- **Spekikate:** A-osa → Task 1, 2, 3, 6; B-osa → Task 4, 5, 7; C-osa → Task 8; ADR → Task 9. Spekis nimetatud `password_reset` on teadlikult väljas ja see on PR-i kirjelduses öeldud.
- **Platseholderid:** ei ole — iga samm sisaldab päris koodi või päris käsku.
  Kolm oletust, mis plaani mustandis olid, on ette kontrollitud ja asendatud
  faktiga: `Dockerfile:16` kopeerib `server/` tervikuna ja `.dockerignore` ei
  filtreeri `*.txt`-d (Task 4); `PUBLIC_BASE_URL`-i ei ole olemas, seega Task 5
  sisaldab selle täiskoodi; `backend_env` võtmed on `conftest.py:173-183` järgi
  olemas (Task 2). Ainus kontrollisamm, mis jääb teostajale, on
  `deriveUsernameFromEmail` impordi kasutus (Task 7) — see sõltub sellest, mis
  faili selleks hetkeks alles jääb.
- **Tüübikooskõla:** `normalize_language` (Task 1) → kasutatakse Task 2, 4, 5-s sama nimega; `render_mail(template_name, lang, **context)` (Task 4) → kutsutakse Task 5-s sama järjekorraga; `notificationTitle(n, t)` (Task 8) → kaks kutsekohta sama signatuuriga; `INVITE_EXPIRY_HOURS` defineeritud Task 4-s ja tarbitud Task 4 mallis + Task 5 kutses.
