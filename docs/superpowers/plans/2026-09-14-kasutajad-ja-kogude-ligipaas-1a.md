# Etapp 1a — server ja konto elutsükkel (teostusplaan)

> **Agentidele:** KOHUSTUSLIK ALAMOSKUS: kasuta selle plaani täitmiseks
> `superpowers:subagent-driven-development` (soovitatud) või
> `superpowers:executing-plans`. Sammud on checkbox-kujul (`- [ ]`).

**Eesmärk:** viia kõik `users.json` kirjutusteed ühe luku alla, reserveerida
kustutatud kasutajanimed püsivalt ning panna töökollektsiooni `PUT access`
täisasendus serveripoolsete diff-valvurite taha — kõik olemasoleva
kasutajaliidesega ühilduvalt, nii et etapi saab juurutada enne paneeli.

**Arhitektuur:** `server/auth.py` saab ühe `users_transaction()`
kontekstihalduri, mille sees toimub kogu loe-kontrolli-muuda-salvesta tsükkel;
kõik teised sama jagatud cache-objekti kirjutajad viiakse sellesama alla.
Kustutatud nimede register on uus state-fail, mida hoitakse mälus `set`-ina ja
kirjutatakse enne konto eemaldamist. Töökollektsiooni `access` jääb
täisasenduseks, aga server klassifitseerib vana ja uue kaardi diffi ja jõustab
kirjepõhised valvurid `_work_sets_lock` all; kasutajate rollide hetktõmmis
võetakse `users_lock` all ja see lukk vabastatakse ENNE kogulukku.

**Tehnoloogia:** FastAPI, Python 3.9 (`Optional[dict]`, mitte `dict | None`),
pytest (`.venv/bin/pytest`), `threading.RLock`.

**Spekk:** [`docs/superpowers/specs/2026-09-14-kasutajad-ja-kogude-ligipaas-design.md`](../specs/2026-09-14-kasutajad-ja-kogude-ligipaas-design.md)
**ADR:** [0043](../../decisions/0043-kogude-oiguste-uhised-toimingud.md)

## Üldised piirangud

- **Koodikommentaarid eesti keeles.** Kommentaar ütleb MIKS, mitte MIDA.
- **Python 3.9:** `Optional[X]`, `Dict[str, str]` — mitte `X | None`.
- **Blokeeriv I/O `async def` sees on keelatud** (ADR 0002): kas sync `def`
  route või `run_in_threadpool`.
- **Testid:** ALATI `.venv/bin/pytest`, mitte süsteemi `python3`.
- **Kliendi leping ei muutu selles etapis.** Olemasolev `Users.tsx`,
  `CollectionEditor.tsx` ja `WorkSets.tsx` peavad edasi töötama. Ainus lubatud
  nähtav muutus: uued valideerimisvead annavad tavapärase veateate
  (`{"status": "error", "message": ...}` või HTTP 4xx `detail`).
- **`PUT /admin/collections/{id}` `allowed_users` haru EI eemaldata siin** —
  ainult lukustatakse. Eemaldamine käib etapis 2 koos kliendiga.
- **Kaks lukku ei ole kunagi korraga hoitud:** `users_lock` vabastatakse enne
  `_work_sets_lock` võtmist; kogutoimingu sees ei kutsuta `load_users()`-it.
- **Aeglast kõrvaltegevust ei panda `users_lock`-i sisse:** sessioonide
  invalideerimine, reset-tokenite tühistamine, e-kiri ja parooliräsi arvutus
  jäävad luku VÄLJA.
- **Väravad iga taski lõpus:** `.venv/bin/pytest tests/ -q`. Etapi lõpus ka
  `npm run typecheck`, `npm test`, `npm run lint:ci`.

## Failistruktuur

| Fail | Vastutus | Muudatus |
|---|---|---|
| `server/config.py` | teed ja konstandid | + `DELETED_USERNAMES_FILE`, + `WORK_SET_MAX_ACCESS` |
| `server/auth.py` | kasutajate salvestus, lukk, rollikontrollid | + `users_transaction()`, + nimeregister, + `users_role_snapshot()`, + `apply_collection_rights_delta()`; 4 helperit luku alla |
| `server/routers/admin.py` | admini API | + `POST /admin/users/collection-rights` |
| `server/registration.py` | konto loomine kutsest | nimevalik + salvestus ühe luku alla, ühine `save_users` |
| `server/password_reset.py` | parooli lähtestus | loe-muuda-salvesta luku alla |
| `server/routers/collections.py` | kollektsioonide API | `allowed_users` haru + kustutamise koristus luku alla; koristus mõlemale väljale |
| `server/work_sets_access.py` | puhtad õiguse-predikaadid | + `classify_access_diff()`, + `check_access_diff()` |
| `server/work_sets_ops.py` | kogude salvestus | + `set_access()`, + `WorkSetAccessDenied`; `create_work_set` ei lisa loojat |
| `server/routers/work_sets.py` | kogude API | `put_access` nõuab `revision`-it, võtab hetktõmmise, kutsub `set_access` |
| `scripts/import_deleted_usernames.py` | ühekordne juurutuse eelsamm | uus |
| `tests/conftest.py` | testikeskkond | + `deleted_usernames.json` patch |

---

### Task 0: haru ja ADR

- [ ] **Samm 1: loo haru**

```bash
git checkout -b feat/kasutajad-kogude-ligipaas-1a
```

- [ ] **Samm 2: commiti ADR ja spekk**

ADR 0043, registri rida ja spekk on tööpuus juba olemas, aga committimata
(`docs/decisions/0043-kogude-oiguste-uhised-toimingud.md`,
`docs/decisions/README.md`, `docs/superpowers/specs/2026-09-14-…-design.md`).
Jälgitav fail on autoriteetne fail (ADR 0040) — need lähevad sama PR-iga sisse.
Lavasta NIMELISELT, mitte `git add -A`:

```bash
git add docs/decisions/0043-kogude-oiguste-uhised-toimingud.md \
        docs/decisions/README.md \
        docs/superpowers/specs/2026-09-14-kasutajad-ja-kogude-ligipaas-design.md \
        docs/superpowers/plans/2026-09-14-kasutajad-ja-kogude-ligipaas-1a.md
git commit -m "docs(adr): 0043 kogude õigustel on ühised toimingud (#318)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017Ej5TrAANh3KXb9ABtZtcw"
```

---

### Task 1: `users_transaction()` ja kolm `update_user_*` helperit luku alla

**Failid:**
- Muuda: `server/auth.py:142-166` (lukukiht), `server/auth.py:323-560`
  (`update_user_role`, `update_user_allowed_collections`,
  `update_user_edit_collections`, `delete_user`)
- Test: `tests/test_users_lock.py` (uus)

**Liidesed:**
- Toodab: `server.auth.users_transaction()` — kontekstihaldur, mis annab
  `users` dicti ja hoiab `users_lock`-i kogu bloki vältel. Kasutajad:
  taskid 2, 3, 4, 5.

- [ ] **Samm 1: kirjuta kukkuv test**

Loo `tests/test_users_lock.py`:

```python
"""Kasutajate jagatud cache-objekti loe-muuda-salvesta lukk (ADR 0043 p3).

`load_users()` tagastab JAGATUD dicti. Kui muudatus toimub väljaspool lukku,
võib teine lõim serialiseerida poolikut olekut või kaotada oma muudatuse.
"""
import threading

import pytest


KOLLEKTSIOONID = {"sample": {"name": {"et": "Näidis"}, "visibility": "restricted"}}


def test_kaks_kirjutajat_ei_kaota_teineteise_muudatust(backend_env, monkeypatch):
    auth = backend_env["auth"]
    # `get_cached_collections` loeb PÄRIS config-teed — testides patchitakse
    # see alati (vt tests/test_user_collections_api.py `_patch_restricted`).
    monkeypatch.setattr(auth, "get_cached_collections", lambda: KOLLEKTSIOONID)

    alustatud = threading.Event()
    lase_edasi = threading.Event()
    paris_write = auth.atomic_write_json

    def aeglane_write(path, data):
        # Serialiseerimise AJAL peab dict olema muutumatu: teine lõim ootab lukku.
        alustatud.set()
        lase_edasi.wait(timeout=5)
        paris_write(path, data)

    monkeypatch.setattr(auth, "atomic_write_json", aeglane_write)

    admin = {"username": "admin", "role": "admin"}
    vead = []

    def esimene():
        ok, _sonum, _ = auth.update_user_edit_collections("contrib", ["sample"], admin)
        if not ok:
            vead.append("esimene")

    def teine():
        alustatud.wait(timeout=5)
        # Peab OOTAMA luku taga, mitte lugema poolikut cache'i.
        ok, _sonum, _ = auth.update_user_edit_collections("contrib_muu", ["sample"], admin)
        if not ok:
            vead.append("teine")

    t1 = threading.Thread(target=esimene)
    t2 = threading.Thread(target=teine)
    t1.start()
    t2.start()
    alustatud.wait(timeout=5)
    # Teine lõim on nüüd luku taga; vabasta esimene.
    lase_edasi.set()
    t1.join(timeout=5)
    t2.join(timeout=5)

    assert vead == []
    kasutajad = auth.reload_users_cache()
    assert kasutajad["contrib"]["edit_collections"] == ["sample"]
    assert kasutajad["contrib_muu"]["edit_collections"] == ["sample"]


def test_users_transaction_hoiab_lukku_kogu_bloki(backend_env):
    auth = backend_env["auth"]
    with auth.users_transaction() as users:
        # RLock on sama lõime jaoks reentrantne; `locked()` puudub RLock-il,
        # seega kontrollime, et teine lõim EI saa lukku.
        sai_luku = []

        def proovi():
            sai_luku.append(auth.users_lock.acquire(blocking=False))
            if sai_luku[-1]:
                auth.users_lock.release()

        t = threading.Thread(target=proovi)
        t.start()
        t.join(timeout=5)
        assert sai_luku == [False]
        assert "admin" in users
```

- [ ] **Samm 2: käivita test, veendu et kukub**

Käsk: `.venv/bin/pytest tests/test_users_lock.py -v`
Oodatud: `test_users_transaction_hoiab_lukku_kogu_bloki` FAIL —
`AttributeError: module 'server.auth' has no attribute 'users_transaction'`.
`test_kaks_kirjutajat...` võib praeguse koodiga JUHUSLIKULT läbida (võidujooks
on ajastusest sõltuv) — see on oodatud; teine test on siin determinism.

- [ ] **Samm 3: lisa `users_transaction` `server/auth.py`-sse**

Lisa faili algusesse import (kui puudub):

```python
from contextlib import contextmanager
```

Lisa `reload_users_cache` järele (`server/auth.py:166` järele):

```python
@contextmanager
def users_transaction():
    """Kogu loe-kontrolli-muuda-salvesta tsükkel ühe luku all (ADR 0043 p3).

    `load_users()` tagastab JAGATUD `_users_cache` objekti — mitte koopia.
    Kui üks lõim muudab seda dicti sel ajal, kui teine seda `atomic_write_json`-is
    serialiseerib, kirjutatakse ketta peale olek, mida kumbki kutsuja ei palunud.
    `save_users` sees olev lukk kaitseb ainult kirjutamist, mitte kontrolli ja
    muutmist enne seda.

    `users_lock` on RLock, seega `save_users(users)` tohib olla bloki SEES.
    Sisse EI panda aeglast kõrvaltegevust (sessioonid, tokenid, e-kiri,
    parooliräsi) — see hoiaks lukku ilma põhjuseta.
    """
    with users_lock:
        yield load_users()
```

- [ ] **Samm 4: vii `update_user_role` luku alla**

Asenda `server/auth.py` `update_user_role` keha alates `users = load_users()`
reast kuni `save_users(users)`-ini:

```python
    with users_transaction() as users:
        if username not in users:
            return False, "Kasutajat ei leitud"

        target_current = users[username].get("role", "contributor")
        # Invariant: tohib target-i puutuda JA tohib uut rolli määrata
        if not can_change_role(admin_user["role"], target_current, new_role):
            return False, "Pole õigust seda kasutajat sellele rollile määrata"

        old_role = target_current
        users[username]["role"] = new_role
        save_users(users)

    # Sessioonide ja tokenite käsitlus on TEADLIKULT luku väljas: nad võtavad
    # oma lukud ja lukkude sisse pesastamine tekitaks järjekorra-sõltuvuse.
    invalidated = delete_user_sessions(username)
```

Ülejäänud (reset-tokenite tühistus, `print`, `return`) jääb muutmata.

- [ ] **Samm 5: vii `update_user_allowed_collections` luku alla**

Asenda selles funktsioonis `users = load_users()` kuni `save_users(users)`:

```python
    with users_transaction() as users:
        if username not in users:
            return False, "Kasutajat ei leitud", []

        # Õigus: AINULT keskne can_manage_user (rangelt madalam tase).
        target_role = users[username].get("role", "contributor")
        if not can_manage_user(admin_user["role"], target_role):
            return False, "Pole õigust selle kasutaja kollektsioone muuta", []

        collections_config = get_cached_collections()
        submitted = {c for c in collection_ids if isinstance(c, str)}
        restricted_ordered = [
            cid for cid, c in collections_config.items()
            if c.get("visibility") == "restricted"
        ]
        sanitized = [cid for cid in restricted_ordered if cid in submitted]

        # No-op kaitse: ära salvesta ega katkesta sessiooni asjatult
        old = users[username].get("allowed_collections", [])
        if old == sanitized:
            return True, "Kollektsioonid uuendatud", sanitized

        users[username]["allowed_collections"] = sanitized
        save_users(users)

    delete_user_sessions(username)
```

- [ ] **Samm 6: vii `update_user_edit_collections` luku alla**

Sama muster:

```python
    with users_transaction() as users:
        if username not in users:
            return False, "Kasutajat ei leitud", []

        target_role = users[username].get("role", "contributor")
        if not can_manage_user(admin_user["role"], target_role):
            return False, "Pole õigust selle kasutaja ulatust muuta", []

        collections_config = get_cached_collections()
        sanitized = sanitize_edit_collections(collection_ids, collections_config)

        old = users[username].get("edit_collections", [])
        if old == sanitized:
            return True, "Ulatus uuendatud", sanitized

        users[username]["edit_collections"] = sanitized
        save_users(users)

    delete_user_sessions(username)
```

- [ ] **Samm 7: vii `delete_user` luku alla**

```python
    with users_transaction() as users:
        if username not in users:
            return False, "Kasutajat ei leitud"

        if not can_manage_user(admin_user["role"], users[username].get("role", "contributor")):
            return False, "Pole õigust seda kasutajat kustutada"

        deleted_name = users[username].get("name", username)
        del users[username]
        save_users(users)

    removed = delete_user_sessions(username)
```

- [ ] **Samm 8: käivita testid**

Käsk: `.venv/bin/pytest tests/test_users_lock.py tests/test_user_collections.py tests/test_user_collections_api.py tests/test_admin_role_endpoints.py tests/test_role_permissions.py -v`
Oodatud: PASS.

- [ ] **Samm 9: commit**

```bash
git add server/auth.py tests/test_users_lock.py
git commit -m "fix(auth): kasutajate loe-muuda-salvesta tsükkel ühe luku all (#318)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017Ej5TrAANh3KXb9ABtZtcw"
```

---

### Task 2: ülejäänud `users.json` kirjutajad sama luku alla

**Failid:**
- Muuda: `server/password_reset.py:209-233`
- Muuda: `server/routers/collections.py:161-179` (`allowed_users` haru),
  `server/routers/collections.py:243-255` (`_cleanup_allowed_collections_on_delete`)
- Test: `tests/test_users_lock.py` (täiendus)

**Liidesed:**
- Tarbib: `users_transaction()` (Task 1).

- [ ] **Samm 1: kirjuta kukkuv test**

Lisa `tests/test_users_lock.py` lõppu:

```python
def test_koik_kirjutajad_kasutavad_users_transactionit():
    """Valvur: uus `save_users` kutse ilma lukuta on vaikne regressioon.

    Grep-tasemel kontroll on siin tahtlik — käitumistestiga ei saa tõestada,
    et KEEGI EI kirjuta lukuta. Kutsuja peab `save_users`-i juurde võtma ka
    `users_transaction`-i (või olema auth.py enda lukustatud tee).
    """
    import pathlib
    import re

    juur = pathlib.Path(__file__).resolve().parents[1]
    lubatud_ilma = {
        "server/auth.py",          # siin ON lukk (users_transaction / save_users ise)
    }
    for fail in (juur / "server").rglob("*.py"):
        suhteline = str(fail.relative_to(juur))
        if suhteline in lubatud_ilma:
            continue
        tekst = fail.read_text(encoding="utf-8")
        if re.search(r"\bsave_users\s*\(", tekst):
            assert "users_transaction" in tekst, (
                f"{suhteline} kutsub save_users-i ilma users_transaction-ita"
            )
        assert "atomic_write_json(USERS_FILE" not in tekst, (
            f"{suhteline} kirjutab users.json-i save_users-ist mööda"
        )
```

- [ ] **Samm 2: käivita test, veendu et kukub**

Käsk: `.venv/bin/pytest tests/test_users_lock.py::test_koik_kirjutajad_kasutavad_users_transactionit -v`
Oodatud: FAIL — `server/routers/collections.py kutsub save_users-i ilma
users_transaction-ita` (ja `server/registration.py` atomic_write_json rida,
mille parandab Task 4).

- [ ] **Samm 3: paranda `password_reset.py`**

Asenda `server/password_reset.py` real ~209 algav plokk:

```python
    # 3. Sea uus hash (loe vana välja rollbacki jaoks)
    from .auth import users_transaction
    with users_transaction() as users:
        if username not in users:
            _unconsume_token(token)
            return None, "Kasutajat ei leitud"
        old_hash = users[username].get("password_hash")
        users[username]["password_hash"] = hash_password(new_password)
        try:
            save_users(users)
        except Exception as e:
            # Taasta mälusisene olek: kettale ei jõudnud midagi, aga cache on
            # jagatud objekt ja kannaks muidu salvestamata hashi edasi.
            users[username]["password_hash"] = old_hash
            _unconsume_token(token)
            logger.error(f"Reset: parooli salvestus ebaõnnestus ({username}): {e}")
            return None, "Parooli salvestamine ebaõnnestus, palun proovi uuesti"
```

Ja rollback-haru (rida ~226) sama luku alla:

```python
        try:
            with users_transaction() as users:
                users[username]["password_hash"] = old_hash
                save_users(users)
        except Exception as e2:
            logger.error(f"Reset: hash-rollback ebaõnnestus ({username}): {e2}")
```

**NB:** `hash_password(new_password)` on kallis — kui see osutub luku sees
mõõdetavaks pidurdajaks, arvuta see ENNE `users_transaction()` plokki ja
kasuta luku sees valmis väärtust. Tee seda kohe, sama sammu sees:

```python
    uus_hash = hash_password(new_password)   # kallis: ARVUTA ENNE LUKKU
    from .auth import users_transaction
    with users_transaction() as users:
        ...
        users[username]["password_hash"] = uus_hash
```

- [ ] **Samm 4: paranda `routers/collections.py` `allowed_users` haru**

Asenda rida 161–179 algav plokk:

```python
    # allowed_collections: kasutajate ligipääsu haldus kollektsiooni tasandil.
    # ÜLEMINEK: see haru eemaldatakse etapis 2 koos kliendiga (ADR 0043 p2);
    # siin ainult lukustatakse, et jagatud cache-objekt ei muutuks
    # serialiseerimise ajal.
    allowed_users_param = body.get("allowed_users")
    if allowed_users_param is not None:
        def _kirjuta_allowed_users():
            changed = []
            with users_transaction() as users_data:
                for username, udata in users_data.items():
                    current = set(udata.get("allowed_collections", []))
                    updated = set(current)
                    if username in allowed_users_param:
                        updated.add(collection_id)
                    else:
                        updated.discard(collection_id)
                    if updated != current:
                        changed.append(username)
                    users_data[username]["allowed_collections"] = list(updated)
                save_users(users_data)
            return changed

        changed_users = await run_in_threadpool(_kirjuta_allowed_users)
        # Invalideeri muutunud kasutajate sessioonid (Leid I) — luku VÄLJAS.
        for username in changed_users:
            delete_user_sessions(username)
```

Lisa faili importidesse `users_transaction`:

```python
from ..auth import users_transaction
```

(kontrolli olemasolevat import-rida `from ..auth import ...` ja lisa nimi sinna).

- [ ] **Samm 5: käivita testid**

Enne käivitust lisa valvurisse ÜKS ajutine erand, sest `registration.py`
parandatakse alles Task 4-s. Muuda `tests/test_users_lock.py`-s:

```python
    lubatud_ilma = {
        "server/auth.py",          # siin ON lukk
        "server/registration.py",  # AJUTINE — eemalda Task 4 sammus 5
    }
```

ja pane `atomic_write_json(USERS_FILE` kontroll sama erandi taha:

```python
        if suhteline not in lubatud_ilma:
            assert "atomic_write_json(USERS_FILE" not in tekst, (
                f"{suhteline} kirjutab users.json-i save_users-ist mööda"
            )
```

Käsk: `.venv/bin/pytest tests/test_users_lock.py tests/test_auth_password.py tests/test_password_reset*.py tests/test_work_collections.py -v`
Oodatud: PASS.

- [ ] **Samm 6: commit**

```bash
git add server/password_reset.py server/routers/collections.py tests/test_users_lock.py
git commit -m "fix(auth): parooli lähtestus ja kollektsiooni allowed_users kirjutavad luku all (#318)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017Ej5TrAANh3KXb9ABtZtcw"
```

---

### Task 3: kustutatud kasutajanimede register

**Failid:**
- Muuda: `server/config.py:149` järele
- Muuda: `server/auth.py` (register + `delete_user`)
- Muuda: `tests/conftest.py:112` ümbrus (patch)
- Test: `tests/test_deleted_usernames.py` (uus)

**Liidesed:**
- Toodab: `server.auth.is_username_reserved(username) -> bool`,
  `server.auth.reserve_username(username) -> None`,
  `server.auth.load_deleted_usernames() -> set`,
  `server.auth.DeletedUsernamesCorrupt(Exception)`. Kasutaja: Task 4.

- [ ] **Samm 1: kirjuta kukkuv test**

Loo `tests/test_deleted_usernames.py`:

```python
"""Kustutatud kasutajanimede püsiv register (ADR 0043 p8).

Nime taaskasutus annaks uuele kontole vanadesse `access`-kaartidesse alles
jäänud õigused. Register on konto elutsükli AUTORITEETNE olek, mitte cache.
"""
import json

import pytest


def test_delete_user_reserveerib_nime(backend_env):
    auth = backend_env["auth"]
    admin = {"username": "admin", "role": "admin"}

    ok, _ = auth.delete_user("contrib", admin)
    assert ok

    assert auth.is_username_reserved("contrib")
    kettal = json.loads((backend_env["state_dir"] / "deleted_usernames.json").read_text())
    assert kettal == ["contrib"]


def test_registri_kirjutusveaga_kontot_ei_eemaldata(backend_env, monkeypatch):
    auth = backend_env["auth"]
    admin = {"username": "admin", "role": "admin"}

    def katkine_write(path, data):
        raise OSError("ketas täis")

    monkeypatch.setattr(auth, "atomic_write_json", katkine_write)
    ok, sonum = auth.delete_user("contrib", admin)

    assert not ok
    assert "contrib" in auth.reload_users_cache()


def test_katkist_registrit_ei_kasitleta_tuhjana(backend_env):
    auth = backend_env["auth"]
    (backend_env["state_dir"] / "deleted_usernames.json").write_text('{"vale": "kuju"}')
    auth._deleted_usernames_cache = None

    with pytest.raises(auth.DeletedUsernamesCorrupt):
        auth.load_deleted_usernames()


def test_reserveering_ei_blokeeri_olemasoleva_konto_sisselogimist(backend_env, client, login):
    auth = backend_env["auth"]
    auth.reserve_username("editor")   # jäänuk vanast importist
    assert login("editor", "editorpass")
```

- [ ] **Samm 2: käivita test, veendu et kukub**

Käsk: `.venv/bin/pytest tests/test_deleted_usernames.py -v`
Oodatud: FAIL — `AttributeError: module 'server.auth' has no attribute
'is_username_reserved'`.

- [ ] **Samm 3: lisa konstant `server/config.py`-sse**

`server/config.py:149` (`RESET_TOKENS_FILE` rea) järele:

```python
DELETED_USERNAMES_FILE = os.path.join(_STATE_DIR, "deleted_usernames.json")
```

- [ ] **Samm 4: lisa register `server/auth.py`-sse**

Lisa import (`USERS_FILE` kõrvale):

```python
from .config import DELETED_USERNAMES_FILE
```

Lisa `users_transaction` järele:

```python
class DeletedUsernamesCorrupt(Exception):
    """Register on olemas, aga loetamatu.

    Tühjana käsitlemine annaks kustutatud nime uuesti välja — seepärast
    katkestab see konto loomise ja kustutamise, mitte ei jää vaikselt vahele.
    """


_deleted_usernames_cache = None


def _load_deleted_usernames_from_file():
    if not os.path.exists(DELETED_USERNAMES_FILE):
        return set()
    try:
        with open(DELETED_USERNAMES_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except (json.JSONDecodeError, OSError) as e:
        raise DeletedUsernamesCorrupt(str(e))
    if not isinstance(data, list) or any(not isinstance(x, str) for x in data):
        raise DeletedUsernamesCorrupt("oodatud on stringide list")
    return set(data)


def load_deleted_usernames():
    """Mälus hoitav `set`: konto loomise nimekontroll on O(1), mitte kogufailide skann."""
    global _deleted_usernames_cache
    with users_lock:
        if _deleted_usernames_cache is None:
            _deleted_usernames_cache = _load_deleted_usernames_from_file()
        return _deleted_usernames_cache


def is_username_reserved(username):
    return username in load_deleted_usernames()


def reserve_username(username):
    """Lisab nime registrisse. Cache avaldatakse alles EDUKA kirjutuse järel.

    Kutsutakse ENNE konto eemaldamise salvestust: kui see kukub, jääb konto
    alles ja kustutamist saab uuesti proovida. Vastupidises järjekorras jääks
    konto kustutatuks ja nimi vabaks — just see, mida register välistab.
    """
    global _deleted_usernames_cache
    with users_lock:
        praegu = load_deleted_usernames()
        if username in praegu:
            return
        uus = sorted(praegu | {username})
        atomic_write_json(DELETED_USERNAMES_FILE, uus)
        _deleted_usernames_cache = set(uus)
```

- [ ] **Samm 5: kutsu `reserve_username` `delete_user`-is**

Task 1-s kirjutatud `delete_user` luku-plokis, ENNE `del users[username]`:

```python
        deleted_name = users[username].get("name", username)
        try:
            # Reserveering ENNE konto eemaldamist (ADR 0043 p8): kirjutusviga
            # jätab konto alles, mitte ei vabasta nime.
            reserve_username(username)
        except (DeletedUsernamesCorrupt, OSError) as e:
            print(f"Kustutamine katkestatud: nimeregistri kirjutus ebaõnnestus ({username}): {e}")
            return False, "Kasutajanime registreerimine ebaõnnestus, proovi uuesti"
        del users[username]
        save_users(users)
```

- [ ] **Samm 6: patchi conftest**

`tests/conftest.py`-s, `reset_tokens_file` rea kõrvale (~rida 33):

```python
    deleted_usernames_file = state_dir / "deleted_usernames.json"
```

ja `monkeypatch.setattr(auth, "_users_cache", None)` juurde (~rida 112):

```python
    monkeypatch.setattr(auth, "DELETED_USERNAMES_FILE", str(deleted_usernames_file))
    monkeypatch.setattr(auth, "_deleted_usernames_cache", None)
```

ning `yield` sõnastikku:

```python
            "deleted_usernames_file": deleted_usernames_file,
```

- [ ] **Samm 7: käivita testid**

Käsk: `.venv/bin/pytest tests/test_deleted_usernames.py tests/test_admin_role_endpoints.py -v`
Oodatud: PASS.

- [ ] **Samm 8: commit**

```bash
git add server/config.py server/auth.py tests/conftest.py tests/test_deleted_usernames.py
git commit -m "feat(auth): kustutatud kasutajanimed reserveeritakse püsivalt (#318)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017Ej5TrAANh3KXb9ABtZtcw"
```

---

### Task 4: `create_user_from_invite` — nimevaliku võidujooks ja ühine salvestustee

**Failid:**
- Muuda: `server/registration.py:343-408` (`create_user_from_invite`),
  `server/registration.py:148-172` (`_next_available_username`),
  `server/registration.py:175-210` (`suggest_username_for_email`)
- Test: `tests/test_registration_username.py` (täiendus),
  `tests/test_users_lock.py` (erandi eemaldamine)

**Liidesed:**
- Tarbib: `users_transaction()` (Task 1), `is_username_reserved()` (Task 3).

**NB:** speki §5 nimetab funktsiooni `create_user_from_token`; koodis on selle
nimi `create_user_from_invite` (`server/registration.py:343`). Nime EI muudeta.

- [ ] **Samm 1: kirjuta kukkuv test**

Lisa `tests/test_registration_username.py` lõppu:

```python
import threading


def _tee_token(backend_env, token, email):
    import json
    fail = backend_env["invite_tokens_file"]
    data = json.loads(fail.read_text())
    data["tokens"].append({
        "token": token,
        "email": email,
        "name": "Uus Kasutaja",
        "username": "uus",
        "role": "contributor",
        "used": False,
        "expires_at": "2099-01-01T00:00:00",
    })
    fail.write_text(json.dumps(data, ensure_ascii=False))


def test_kaks_samaaegset_kutset_saavad_eri_nimed(backend_env):
    registration = backend_env["registration"]
    _tee_token(backend_env, "tok-a", "uus@example.test")
    _tee_token(backend_env, "tok-b", "uus2@example.test")

    tulemused = []
    barjaar = threading.Barrier(2, timeout=5)

    def loo(token):
        barjaar.wait()
        kasutaja, viga = registration.create_user_from_invite(token, "TugevParool123!")
        tulemused.append((kasutaja, viga))

    lõimed = [threading.Thread(target=loo, args=(t,)) for t in ("tok-a", "tok-b")]
    for l in lõimed:
        l.start()
    for l in lõimed:
        l.join(timeout=10)

    nimed = [k["username"] for k, viga in tulemused if k]
    assert len(nimed) == 2, tulemused
    assert len(set(nimed)) == 2, f"kaks kontot said sama nime: {nimed}"


def test_kustutatud_nime_ei_anta_uuesti(backend_env):
    auth = backend_env["auth"]
    registration = backend_env["registration"]
    auth.reserve_username("uus")
    _tee_token(backend_env, "tok-c", "uus@example.test")

    kasutaja, viga = registration.create_user_from_invite("tok-c", "TugevParool123!")
    assert viga is None, viga
    assert kasutaja["username"] != "uus"


def test_suggest_username_arvestab_reserveeritud_nime(backend_env):
    auth = backend_env["auth"]
    registration = backend_env["registration"]
    auth.reserve_username("uus")
    assert registration.suggest_username_for_email("uus@example.test") != "uus"
```

- [ ] **Samm 2: käivita test, veendu et kukub**

Käsk: `.venv/bin/pytest tests/test_registration_username.py -v -k "samaaegset or kustutatud or reserveeritud"`
Oodatud: `test_kustutatud_nime_ei_anta_uuesti` FAIL (nimi on `uus`);
`test_suggest_username_arvestab_reserveeritud_nime` FAIL.

- [ ] **Samm 3: arvesta registrit nimevalikus**

`server/registration.py` `_next_available_username`-is, `taken = set(users.keys())`
järele:

```python
    from .auth import load_deleted_usernames
    # Kustutatud nimi jääb hõivatuks: vanades access-kaartides võib tema kirje
    # alles olla ja uus konto pärandaks selle õigused (ADR 0043 p8).
    taken |= load_deleted_usernames()
```

Sama lisandus `suggest_username_for_email`-is, samuti `taken = set(users.keys())`
järele.

- [ ] **Samm 4: vii nimevalik ja salvestus ühe luku alla**

Asenda `create_user_from_invite`-is plokk alates `# Kontrolli, kas kasutajanimi
on vahepeal kasutusse läinud` kuni funktsiooni lõpuni:

```python
    # Kallis parooliräsi arvutatakse ENNE lukku (ADR 0043 p8).
    from .auth import (hash_password, is_username_reserved, load_deleted_usernames,
                       save_users, users_transaction, DeletedUsernamesCorrupt)
    password_hash = hash_password(password)

    # Teine klamber tarbimisteel (leid 6): token peaks juba sisaldama ainult
    # lubatud rolli, aga käsitsi muudetud tokenifail ei tohi anda laiemat rolli.
    role = token_data.get("role", "contributor")
    if role not in ("contributor", "editor"):
        role = "contributor"

    uus_kirje = {
        "password_hash": password_hash,
        "name": name,
        "email": email,
        "role": role,
        "edit_collections": token_data.get("edit_collections", []),
        # Vanadel tokenitel võtit ei ole → normalize_language(None) = "et"
        "language": normalize_language(token_data.get("language")),
        "created_at": datetime.now().isoformat(),
    }

    # Nimevalik JA salvestus ühe luku all: kaks samaaegset kutset ei tohi
    # valida sama nime. Varem valiti nimi lukuta ja kirjutati `atomic_write_json`-iga
    # `save_users`-ist mööda, jättes mälus oleva cache'i vana kujuga.
    try:
        with users_transaction() as users:
            hoivatud = set(users.keys()) | load_deleted_usernames()
            base_username = username
            counter = 1
            while username in hoivatud:
                username = f"{base_username}{counter}"
                counter += 1
            users[username] = uus_kirje
            save_users(users)
    except DeletedUsernamesCorrupt as e:
        _unconsume_token(token)
        logger.error(f"Kasutaja loomine katkestatud, nimeregister katki: {e}")
        return None, "Kasutaja loomine ebaõnnestus, palun proovi uuesti"
    except Exception as e:
        # Token on juba tarbitud — vabasta ta, et kutse ei läheks kaotsi.
        _unconsume_token(token)
        logger.error(f"Kasutaja salvestamine ebaõnnestus ({username}): {e}")
        return None, "Kasutaja loomine ebaõnnestus, palun proovi uuesti"

    logger.info(f"Loodud uus kasutaja: {username} ({name})")
    # Tagastus tuleb KINNITATUD kirjest, mitte hiljem muutuvast cache'ist.
    return {"username": username, "name": name, "role": uus_kirje["role"]}, None
```

Eemalda funktsiooni algusest üleliigne `users = load_users()` plokk ja vana
`from .auth import hash_password` rida.

- [ ] **Samm 5: eemalda erand Task 2 valvurist**

`tests/test_users_lock.py`-s eemalda `"server/registration.py"` reast
`lubatud_ilma` ja eemalda `atomic_write_json(USERS_FILE` kontrolli tingimuslik
vahelejätmine.

- [ ] **Samm 6: käivita testid**

Käsk: `.venv/bin/pytest tests/test_registration_username.py tests/test_registration_flow.py tests/test_registration_language.py tests/test_auth_password.py tests/test_users_lock.py -v`
Oodatud: PASS.

- [ ] **Samm 7: commit**

```bash
git add server/registration.py tests/test_registration_username.py tests/test_users_lock.py
git commit -m "fix(registration): nimevalik ja konto salvestus ühe kasutajaluku all (#318)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017Ej5TrAANh3KXb9ABtZtcw"
```

---

### Task 5: kollektsiooni kustutamise koristus katab mõlemad väljad

**Failid:**
- Muuda: `server/routers/collections.py:243-255`
  (`_cleanup_allowed_collections_on_delete`)
- Test: `tests/test_work_collections.py` (täiendus)

**Liidesed:**
- Tarbib: `users_transaction()` (Task 1).
- Toodab: `_cleanup_collection_from_users(collection_id) -> list` (muutunud
  kasutajanimed). Vana nimi `_cleanup_allowed_collections_on_delete`
  eemaldatakse; kontrolli `grep -rn "_cleanup_allowed_collections_on_delete"
  server/ tests/` ja uuenda kõik kutsujad.

- [ ] **Samm 1: kirjuta kukkuv test**

Lisa `tests/test_work_collections.py` lõppu:

```python
def test_kollektsiooni_kustutamine_koristab_moloemad_vаljad(backend_env, client, login):
    """Kustutatud kogu ID jääks `edit_collections`-i inertse jäänukina alles."""
    import json

    auth = backend_env["auth"]
    kollektsioonid = backend_env["collections_file"]
    andmed = json.loads(kollektsioonid.read_text())
    andmed["kaduv"] = {"name": {"et": "Kaduv", "en": "Gone"}, "visibility": "restricted"}
    kollektsioonid.write_text(json.dumps(andmed, ensure_ascii=False))

    kasutajad = auth.reload_users_cache()
    kasutajad["contrib"]["allowed_collections"] = ["kaduv"]
    kasutajad["contrib"]["edit_collections"] = ["kaduv"]
    auth.save_users(kasutajad)

    from server.routers import collections as col_router
    muutunud = col_router._cleanup_collection_from_users("kaduv")

    assert muutunud == ["contrib"]
    varske = auth.reload_users_cache()
    assert varske["contrib"]["allowed_collections"] == []
    assert varske["contrib"]["edit_collections"] == []
```

- [ ] **Samm 2: käivita test, veendu et kukub**

Käsk: `.venv/bin/pytest tests/test_work_collections.py -v -k koristab`
Oodatud: FAIL — `AttributeError: ... has no attribute
'_cleanup_collection_from_users'`.

- [ ] **Samm 3: kirjuta uus koristus**

Asenda `server/routers/collections.py` `_cleanup_allowed_collections_on_delete`:

```python
def _cleanup_collection_from_users(collection_id: str) -> list:
    """Eemaldab kustutatud kogu ID MÕLEMALT väljalt ühe luku all (ADR 0043).

    Lugemisõigus (`allowed_collections`) ja kirjutamisulatus (`edit_collections`)
    on eri teljed, aga kustutatud kogu ID ei ole kummalgi kehtiv õigus.
    Tagastab muutunud kasutajanimed — sessioonid invalideerib KUTSUJA
    (luku väljas, üks kord kasutaja kohta).
    """
    muutunud = []
    with users_transaction() as users_data:
        for uname, udata in users_data.items():
            kasutaja_muutus = False
            for vali in ("allowed_collections", "edit_collections"):
                praegu = udata.get(vali, [])
                if collection_id in praegu:
                    users_data[uname][vali] = [c for c in praegu if c != collection_id]
                    kasutaja_muutus = True
            if kasutaja_muutus:
                muutunud.append(uname)
        if muutunud:
            save_users(users_data)
    return muutunud
```

- [ ] **Samm 4: uuenda kutsuja(d)**

Leia kutsujad:

```bash
grep -rn "_cleanup_allowed_collections_on_delete" server/ tests/
```

Asenda igas kohas nimi ja lisa sessioonide invalideerimine luku VÄLJAS:

```python
    muutunud = _cleanup_collection_from_users(collection_id)
    for uname in muutunud:
        delete_user_sessions(uname)
```

- [ ] **Samm 5: käivita testid**

Käsk: `.venv/bin/pytest tests/test_work_collections.py tests/test_user_collections.py tests/test_users_lock.py -v`
Oodatud: PASS.

- [ ] **Samm 6: commit**

```bash
git add server/routers/collections.py tests/test_work_collections.py
git commit -m "fix(collections): kustutamine koristab ka edit_collections (#318)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017Ej5TrAANh3KXb9ABtZtcw"
```

---

### Task 6: kollektsiooniõiguste delta-toiming

**Failid:**
- Muuda: `server/auth.py` (uus `apply_collection_rights_delta`)
- Muuda: `server/routers/admin.py` (uus endpoint `POST /admin/users/collection-rights`)
- Test: `tests/test_collection_rights_delta.py` (uus)

**Liidesed:**
- Tarbib: `users_transaction()` (Task 1), `get_cached_collections()`,
  `can_manage_user()`, `sanitize_edit_collections()` reeglid.
- Toodab: `server.auth.apply_collection_rights_delta(changes, admin_user)
  -> Tuple[bool, str, dict]` — `(ok, sõnum, kinnitatud_olek)`, kus
  `kinnitatud_olek` on `{kasutajanimi: {"allowed_collections": [...],
  "edit_collections": [...]}}` ainult PUUDUTATUD kasutajate kohta.
  Kasutajad: etapp 2 (`CollectionEditor`) ja etapp 3 (kasutajadetail).

**Payloadi kuju** (fikseeritud siin, et etapid 2 ja 3 ei leiutaks uut):

```json
{"changes": [
  {"username": "mari", "collection_id": "kirjad", "field": "allowed", "action": "add"},
  {"username": "mari", "collection_id": "kirjad", "field": "edit",    "action": "remove"}
]}
```

`field` ∈ `{"allowed", "edit"}`, `action` ∈ `{"add", "remove"}`.
Üks päring võib kanda mitme inimese muudatusi. Vigane pakett EI rakendu
osaliselt. Sama `(username, collection_id, field)` kordumine vastuolulise
`action`-iga lükatakse tagasi.

- [ ] **Samm 1: kirjuta kukkuvad testid**

Loo `tests/test_collection_rights_delta.py`:

```python
"""Kollektsiooniõiguste delta (ADR 0043 p2).

Delta muudab AINULT nimetatud määranguid. Vana täisasendus
(`update_user_allowed_collections`) võis avalikuks muudetud kogu ID
sanitiseerimisel vaikselt maha võtta; delta seda ei tee.
"""
import json

import pytest


@pytest.fixture
def kollektsioonid(backend_env, monkeypatch):
    """`get_cached_collections` loeb PÄRIS config-teed — testis patchitakse
    see otse `auth`-is, nagu teevad olemasolevad kollektsioonitestid
    (`tests/test_user_collections_api.py::_patch_restricted`)."""
    auth = backend_env["auth"]
    kaardid = {
        "avalik": {"name": {"et": "Avalik", "en": "Public"}, "visibility": "public"},
        "kinnine": {"name": {"et": "Kinnine", "en": "Closed"}, "visibility": "restricted"},
        "teine": {"name": {"et": "Teine", "en": "Other"}, "visibility": "restricted"},
        "ruhm": {"name": {"et": "Rühm", "en": "Group"}, "type": "virtual_group"},
    }
    monkeypatch.setattr(auth, "get_cached_collections", lambda: kaardid)
    return kaardid


ADMIN = {"username": "admin", "role": "admin"}


def test_lisab_lugemisoiguse_piiratud_kogule(backend_env, kollektsioonid):
    auth = backend_env["auth"]
    ok, sonum, olek = auth.apply_collection_rights_delta(
        [{"username": "contrib", "collection_id": "kinnine", "field": "allowed", "action": "add"}],
        ADMIN)
    assert ok, sonum
    assert olek["contrib"]["allowed_collections"] == ["kinnine"]
    assert auth.reload_users_cache()["contrib"]["allowed_collections"] == ["kinnine"]


def test_keelab_lugemisoiguse_avalikule_kogule(backend_env, kollektsioonid):
    auth = backend_env["auth"]
    ok, sonum, _ = auth.apply_collection_rights_delta(
        [{"username": "contrib", "collection_id": "avalik", "field": "allowed", "action": "add"}],
        ADMIN)
    assert not ok
    assert "avalik" in sonum


def test_avaliku_kogu_vana_maarangu_eemaldamine_on_lubatud(backend_env, kollektsioonid):
    auth = backend_env["auth"]
    kasutajad = auth.reload_users_cache()
    kasutajad["contrib"]["allowed_collections"] = ["avalik", "kinnine"]
    auth.save_users(kasutajad)

    ok, sonum, olek = auth.apply_collection_rights_delta(
        [{"username": "contrib", "collection_id": "avalik", "field": "allowed", "action": "remove"}],
        ADMIN)
    assert ok, sonum
    assert olek["contrib"]["allowed_collections"] == ["kinnine"]


def test_teise_kogu_muutmine_ei_kustuta_jaanukit(backend_env, kollektsioonid):
    """Vana täisasendus oleks „avalik" ID restricted-sanitiseerimisel maha võtnud."""
    auth = backend_env["auth"]
    kasutajad = auth.reload_users_cache()
    kasutajad["contrib"]["allowed_collections"] = ["avalik", "kinnine"]
    auth.save_users(kasutajad)

    ok, _sonum, olek = auth.apply_collection_rights_delta(
        [{"username": "contrib", "collection_id": "teine", "field": "allowed", "action": "add"}],
        ADMIN)
    assert ok
    assert "avalik" in olek["contrib"]["allowed_collections"]


def test_kustutatud_kogu_jaanuki_tohib_eemaldada_mitte_lisada(backend_env, kollektsioonid):
    auth = backend_env["auth"]
    kasutajad = auth.reload_users_cache()
    kasutajad["contrib"]["edit_collections"] = ["kadunud"]
    auth.save_users(kasutajad)

    ok, _s, olek = auth.apply_collection_rights_delta(
        [{"username": "contrib", "collection_id": "kadunud", "field": "edit", "action": "remove"}],
        ADMIN)
    assert ok
    assert olek["contrib"]["edit_collections"] == []

    ok, sonum, _ = auth.apply_collection_rights_delta(
        [{"username": "contrib", "collection_id": "kadunud", "field": "edit", "action": "add"}],
        ADMIN)
    assert not ok
    assert "kadunud" in sonum


def test_keelab_virtuaalse_ruhma_kirjutamisulatuse(backend_env, kollektsioonid):
    auth = backend_env["auth"]
    ok, _sonum, _ = auth.apply_collection_rights_delta(
        [{"username": "contrib", "collection_id": "ruhm", "field": "edit", "action": "add"}],
        ADMIN)
    assert not ok


def test_kirjutamisulatus_avalikul_kogul_on_lubatud(backend_env, kollektsioonid):
    auth = backend_env["auth"]
    ok, sonum, olek = auth.apply_collection_rights_delta(
        [{"username": "contrib", "collection_id": "avalik", "field": "edit", "action": "add"}],
        ADMIN)
    assert ok, sonum
    assert olek["contrib"]["edit_collections"] == ["avalik"]


def test_vigane_pakett_ei_rakendu_osaliselt(backend_env, kollektsioonid):
    auth = backend_env["auth"]
    ok, _sonum, _ = auth.apply_collection_rights_delta([
        {"username": "contrib", "collection_id": "kinnine", "field": "allowed", "action": "add"},
        {"username": "superadmin", "collection_id": "kinnine", "field": "allowed", "action": "add"},
    ], ADMIN)
    assert not ok
    assert auth.reload_users_cache()["contrib"].get("allowed_collections", []) == []


def test_vastuoluline_kordus_lukatakse_tagasi(backend_env, kollektsioonid):
    auth = backend_env["auth"]
    ok, sonum, _ = auth.apply_collection_rights_delta([
        {"username": "contrib", "collection_id": "kinnine", "field": "allowed", "action": "add"},
        {"username": "contrib", "collection_id": "kinnine", "field": "allowed", "action": "remove"},
    ], ADMIN)
    assert not ok
    assert "vastuoluline" in sonum.lower()


def test_uks_invalideerimine_inimese_kohta(backend_env, kollektsioonid, monkeypatch):
    auth = backend_env["auth"]
    kutsed = []
    monkeypatch.setattr(auth, "delete_user_sessions", lambda u: kutsed.append(u) or 0)

    ok, sonum, _ = auth.apply_collection_rights_delta([
        {"username": "contrib", "collection_id": "kinnine", "field": "allowed", "action": "add"},
        {"username": "contrib", "collection_id": "teine", "field": "edit", "action": "add"},
    ], ADMIN)
    assert ok, sonum
    assert kutsed == ["contrib"]


def test_muutusteta_pakett_ei_kirjuta_ega_invalideeri(backend_env, kollektsioonid, monkeypatch):
    auth = backend_env["auth"]
    kirjutised, kutsed = [], []
    monkeypatch.setattr(auth, "atomic_write_json",
                        lambda path, data: kirjutised.append(path))
    monkeypatch.setattr(auth, "delete_user_sessions", lambda u: kutsed.append(u) or 0)

    ok, _s, _ = auth.apply_collection_rights_delta(
        [{"username": "contrib", "collection_id": "kinnine", "field": "allowed", "action": "remove"}],
        ADMIN)
    assert ok
    assert kirjutised == []
    assert kutsed == []


def test_endpoint_noub_admini(client, login, kollektsioonid):
    token = login("contrib", "contribpass")
    r = client.post("/admin/users/collection-rights",
                    json={"changes": []},
                    headers={"Authorization": f"Bearer {token}"})
    # require_role("admin") ebaõnnestumisel tõstab deps.get_user HTTPException(401)
    assert r.status_code == 401


def test_endpoint_tagastab_kinnitatud_oleku(client, login, kollektsioonid):
    token = login("admin", "adminpass")
    r = client.post("/admin/users/collection-rights",
                    json={"changes": [
                        {"username": "contrib", "collection_id": "kinnine",
                         "field": "allowed", "action": "add"}]},
                    headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    assert r.json()["users"]["contrib"]["allowed_collections"] == ["kinnine"]
```

- [ ] **Samm 2: käivita testid, veendu et kukuvad**

Käsk: `.venv/bin/pytest tests/test_collection_rights_delta.py -v`
Oodatud: FAIL — `AttributeError: module 'server.auth' has no attribute
'apply_collection_rights_delta'`.

- [ ] **Samm 3: kirjuta delta-toiming `server/auth.py`-sse**

Lisa `update_user_edit_collections` järele:

```python
_RIGHTS_FIELDS = {"allowed": "allowed_collections", "edit": "edit_collections"}


def apply_collection_rights_delta(changes, admin_user):
    """Muudab AINULT nimetatud määranguid (ADR 0043 p2).

    Vana täisasendus (`update_user_allowed_collections`) kirjutas terve loendi
    üle ja võis avalikuks muutunud kogu ID sanitiseerimisel vaikselt maha võtta.
    Delta puudutab ainult loetletud (kasutaja, kogu, väli) kolmikuid; teised
    kasutajad ja kogud jäävad puutumata.

    Kogu pakett valideeritakse ENNE ühtki muudatust: vea korral ei rakendu
    sellest midagi. Tagastab (ok, sõnum, kinnitatud_olek), kus kinnitatud_olek
    katab ainult puudutatud kasutajaid — klient kirjutab selle oma state'i,
    mitte oma optimistlikku oletust.
    """
    if not isinstance(changes, list):
        return False, "Vigane muudatuste nimekiri", {}

    collections_config = get_cached_collections()

    # 1) Kuju ja vastuolude kontroll
    soovid = {}  # (username, field, collection_id) -> "add" | "remove"
    for muudatus in changes:
        if not isinstance(muudatus, dict):
            return False, "Vigane muudatus", {}
        username = muudatus.get("username")
        collection_id = muudatus.get("collection_id")
        field = muudatus.get("field")
        action = muudatus.get("action")
        if not isinstance(username, str) or not username.strip():
            return False, "Kasutajanimi puudub", {}
        if not isinstance(collection_id, str) or not collection_id.strip():
            return False, "Kollektsiooni ID puudub", {}
        if field not in _RIGHTS_FIELDS:
            return False, "field peab olema 'allowed' või 'edit'", {}
        if action not in ("add", "remove"):
            return False, "action peab olema 'add' või 'remove'", {}
        voti = (username, field, collection_id)
        if voti in soovid and soovid[voti] != action:
            return False, f"Vastuoluline kordus: {username}/{collection_id}/{field}", {}
        soovid[voti] = action

    # 2) Sisuline valideerimine (kogu pakett enne muutmist)
    with users_transaction() as users:
        for (username, field, collection_id), action in soovid.items():
            if username not in users:
                return False, f"Kasutajat '{username}' ei leitud", {}
            target_role = users[username].get("role", "contributor")
            if not can_manage_user(admin_user["role"], target_role):
                return False, f"Pole õigust kasutaja '{username}' õigusi muuta", {}
            if action == "remove":
                # Eemaldamine on koristustoiming: puuduv või avalikuks muutunud
                # kogu ID tohib alati maha võtta.
                continue
            kogu = collections_config.get(collection_id)
            if kogu is None:
                return False, f"Kollektsiooni '{collection_id}' ei leitud", {}
            if field == "allowed" and kogu.get("visibility") != "restricted":
                return False, (f"Kollektsioon '{collection_id}' on avalik — "
                               f"lugemisõiguse määrangut ei lisata"), {}
            if field == "edit" and kogu.get("type") == "virtual_group":
                return False, (f"Virtuaalsele rühmale '{collection_id}' "
                               f"kirjutamisulatust ei määrata"), {}

        # 3) Rakendamine
        muutunud = set()
        for (username, field, collection_id), action in soovid.items():
            vali = _RIGHTS_FIELDS[field]
            praegu = list(users[username].get(vali, []))
            if action == "add" and collection_id not in praegu:
                praegu.append(collection_id)
            elif action == "remove" and collection_id in praegu:
                praegu = [c for c in praegu if c != collection_id]
            else:
                continue  # juba soovitud olekus
            # Deterministlik järjekord: konfiguratsiooni oma, tundmatud lõppu.
            jarjekord = list(collections_config.keys())
            praegu.sort(key=lambda c: (jarjekord.index(c) if c in jarjekord
                                       else len(jarjekord), c))
            users[username][vali] = praegu
            muutunud.add(username)

        if muutunud:
            save_users(users)

        kinnitatud = {
            u: {
                "allowed_collections": list(users[u].get("allowed_collections", [])),
                "edit_collections": list(users[u].get("edit_collections", [])),
            }
            for u in {kasutaja for kasutaja, _, _ in soovid}
        }

    # Sessioonid luku VÄLJAS, üks kord muutunud inimese kohta: viis muudetud
    # kasutajat = viie inimese sessioonide lõpp, aga ühe inimese kaks muudatust
    # ei logi teda kaks korda välja.
    for username in sorted(muutunud):
        delete_user_sessions(username)

    return True, "Õigused uuendatud", kinnitatud
```

- [ ] **Samm 4: lisa endpoint `server/routers/admin.py`-sse**

`admin_update_edit_collections` (rida ~198) järele:

```python
@router.post("/admin/users/collection-rights")
async def admin_collection_rights(request: Request, user=Depends(require_role("admin"))):
    """Kollektsiooniõiguste delta (ADR 0043 p2).

    Mõlemad kliendivaated (kasutajadetail ja kogu ligipääsupaneel) kasutavad
    seda sama toimingut — paralleelset õiguste kirjutusteed ei looda.
    """
    data = await get_json_data(request)
    ok, message, users_state = await run_in_threadpool(
        apply_collection_rights_delta, data.get("changes"), user)
    if not ok:
        raise HTTPException(status_code=400, detail=message)
    return {"status": "success", "users": users_state}
```

Lisa importidesse `apply_collection_rights_delta` (olemasoleva
`from ..auth import ...` rea juurde; kontrolli, kas router impordib
`HTTPException` ja `run_in_threadpool` — kui ei, lisa need).

- [ ] **Samm 5: käivita testid**

Käsk: `.venv/bin/pytest tests/test_collection_rights_delta.py tests/test_user_collections.py tests/test_user_collections_api.py -v`
Oodatud: PASS.

- [ ] **Samm 6: commit**

```bash
git add server/auth.py server/routers/admin.py tests/test_collection_rights_delta.py
git commit -m "feat(auth): kollektsiooniõiguste delta-toiming (#318)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017Ej5TrAANh3KXb9ABtZtcw"
```

---

### Task 7: `access`-diffi klassifikatsioon ja valvurid (puhtad funktsioonid)

**Failid:**
- Muuda: `server/config.py:195` (`WORK_SET_MAX_MEMBERS` kõrvale)
- Muuda: `server/work_sets_access.py`
- Test: `tests/test_work_sets_access_diff.py` (uus)

**Liidesed:**
- Toodab:
  - `WORK_SET_MAX_ACCESS = 1000` (`server/config.py`)
  - `classify_access_diff(old: dict, new: dict) -> dict` — võtmed
    `"added"`, `"changed"`, `"unchanged"`, `"removed"`, iga väärtus sorditud
    kasutajanimede list.
  - `check_access_diff(diff: dict, old: dict, new: dict, users_snapshot: dict,
    actor: dict) -> Optional[str]` — veateade või `None`.
    `users_snapshot` on `{kasutajanimi: roll}`; `actor` on kutsuja user-dict.
  - Kasutaja: Task 8.

- [ ] **Samm 1: kirjuta kukkuvad testid**

Loo `tests/test_work_sets_access_diff.py`:

```python
"""`PUT access` täisasenduse serveripoolsed valvurid (ADR 0043 p7).

Klient saadab TERVE kaardi. Server ei usu, et väljajäänud võti oli tahtlik
eemaldamine ainult siis, kui kutsuja tohtis seda eemaldada — üks keelatud
muudatus lükkab terve salvestuse tagasi.
"""
import pytest

from server.work_sets_access import check_access_diff, classify_access_diff

HETKTOMMIS = {
    "admin": "admin",
    "admin2": "admin",
    "superadmin": "superadmin",
    "editor": "editor",
    "contrib": "contributor",
}
ADMIN = {"username": "admin", "role": "admin"}
SUPER = {"username": "superadmin", "role": "superadmin"}


def test_klassifitseerib_koik_neli_kategooriat():
    vana = {"editor": "manager", "contrib": "viewer", "admin2": "manager"}
    uus = {"editor": "viewer", "contrib": "viewer", "superadmin": "manager"}
    d = classify_access_diff(vana, uus)
    assert d["added"] == ["superadmin"]
    assert d["changed"] == ["editor"]
    assert d["unchanged"] == ["contrib"]
    assert d["removed"] == ["admin2"]


def test_puuduv_uus_vote_tahendab_eemaldamist():
    assert classify_access_diff({"contrib": "viewer"}, {})["removed"] == ["contrib"]


def _kontrolli(vana, uus, actor=ADMIN, hetktommis=None):
    d = classify_access_diff(vana, uus)
    return check_access_diff(d, vana, uus, hetktommis or HETKTOMMIS, actor)


def test_lubab_madalama_rolliga_kasutaja_lisamist():
    assert _kontrolli({}, {"contrib": "viewer"}) is None


def test_keelab_tundmatu_kasutajanime():
    assert _kontrolli({}, {"puudub": "viewer"}) is not None


def test_keelab_uue_admin_maarangu():
    assert _kontrolli({}, {"admin2": "manager"}) is not None
    assert _kontrolli({}, {"superadmin": "manager"}, actor=SUPER) is not None


def test_keelab_tundmatu_rolli():
    assert _kontrolli({}, {"contrib": "owner"}) is not None


def test_muutmata_parand_lubatakse_labi():
    assert _kontrolli({"admin2": "manager"}, {"admin2": "manager"}) is None


def test_keelab_vordse_admini_kirje_muutmise_ja_eemaldamise():
    assert _kontrolli({"admin2": "manager"}, {"admin2": "viewer"}) is not None
    assert _kontrolli({"admin2": "manager"}, {}) is not None


def test_admin_ei_eemalda_superadmini_kirjet():
    assert _kontrolli({"superadmin": "manager"}, {}) is not None


def test_enda_dekoratiivse_kirje_eemaldamine_on_lubatud():
    assert _kontrolli({"admin": "manager"}, {}) is None


def test_kustutatud_kasutaja_kirje_sailitamine_ja_eemaldamine():
    assert _kontrolli({"kadunud": "viewer"}, {"kadunud": "viewer"}) is None
    assert _kontrolli({"kadunud": "viewer"}, {}) is None
    # Rolli muutmine surnud kirjel EI ole lubatud
    assert _kontrolli({"kadunud": "viewer"}, {"kadunud": "manager"}) is not None


def test_uks_keelatud_muudatus_lukkab_terve_paketi_tagasi():
    vana = {"contrib": "viewer", "superadmin": "manager"}
    uus = {"contrib": "manager"}   # lubatud muudatus + keelatud eemaldamine
    assert _kontrolli(vana, uus) is not None


def test_mahupiir_keelab_uue_ule_piiri_kaardi():
    from server.config import WORK_SET_MAX_ACCESS
    hetktommis = {f"k{i}": "contributor" for i in range(WORK_SET_MAX_ACCESS + 5)}
    uus = {f"k{i}": "viewer" for i in range(WORK_SET_MAX_ACCESS + 1)}
    assert _kontrolli({}, uus, hetktommis=hetktommis) is not None


def test_ule_piiri_parandkaart_tohib_vaheneda():
    from server.config import WORK_SET_MAX_ACCESS
    hetktommis = {f"k{i}": "contributor" for i in range(WORK_SET_MAX_ACCESS + 5)}
    vana = {f"k{i}": "viewer" for i in range(WORK_SET_MAX_ACCESS + 3)}
    uus = {f"k{i}": "viewer" for i in range(WORK_SET_MAX_ACCESS + 2)}
    assert _kontrolli(vana, uus, hetktommis=hetktommis) is None
```

- [ ] **Samm 2: käivita testid, veendu et kukuvad**

Käsk: `.venv/bin/pytest tests/test_work_sets_access_diff.py -v`
Oodatud: FAIL — `ImportError: cannot import name 'classify_access_diff'`.

- [ ] **Samm 3: lisa konstant `server/config.py`-sse**

`WORK_SET_MAX_MEMBERS = 1000` rea (rida 195) järele:

```python
# Kirjete kaitsepiir `access`-kaardil — EI OLE mõõdetud kasutajate mahutavus.
# Üle piiri uut kaarti ei salvestata; pärandkaart tohib ainult VÄHENEDA.
WORK_SET_MAX_ACCESS = 1000
```

- [ ] **Samm 4: kirjuta puhtad funktsioonid**

Lisa `server/work_sets_access.py` lõppu (ja importidesse
`from .auth import can_manage_user, is_at_least` — kontrolli olemasolevat
`from .auth import is_at_least` rida ja täienda seda; lisa ka
`from .config import WORK_SET_MAX_ACCESS`):

```python
ACCESS_ROLES = ("viewer", "manager")


def classify_access_diff(old: dict, new: dict) -> dict:
    """Vana ja uue kaardi võtmete ÜHENDI pealt nelja kategooriasse.

    Täisasenduse leping (ADR 0043 p7): puuduv uus võti TÄHENDAB eemaldamist.
    Klient peab seetõttu saatma ka lukustatud ja puutumata pärandkirjed kaasa —
    nende kogemata väljajätmine annab vea, mitte vaikse õiguse eemaldamise.
    """
    old = old or {}
    new = new or {}
    added, changed, unchanged, removed = [], [], [], []
    for kasutaja in sorted(set(old) | set(new)):
        if kasutaja not in old:
            added.append(kasutaja)
        elif kasutaja not in new:
            removed.append(kasutaja)
        elif old[kasutaja] != new[kasutaja]:
            changed.append(kasutaja)
        else:
            unchanged.append(kasutaja)
    return {"added": added, "changed": changed, "unchanged": unchanged, "removed": removed}


def check_access_diff(diff: dict, old: dict, new: dict,
                      users_snapshot: dict, actor: dict) -> Optional[str]:
    """Tagastab veateate või None. Üks keelatud muudatus → midagi ei salvestata.

    `users_snapshot` on {kasutajanimi: roll}, võetud `users_lock` all ja
    ANTUD SIIA KAASA — siin ei kutsuta `load_users`-it, sest see funktsioon
    jookseb `_work_sets_lock` all (ADR 0043 p3).
    """
    actor_role = actor.get("role") or "contributor"

    # Mahupiir: uus kaart ei tohi piiri ületada; pärandkaart tohib VÄHENEDA.
    if len(new) > WORK_SET_MAX_ACCESS and len(new) >= len(old):
        return f"Õiguste kirjete lagi on {WORK_SET_MAX_ACCESS}"

    for kasutaja in diff["added"] + diff["changed"]:
        if new[kasutaja] not in ACCESS_ROLES:
            return "Roll peab olema viewer või manager"
        sihtroll = users_snapshot.get(kasutaja)
        if sihtroll is None:
            # Ka olemasoleva SURNUD kirje rolli muutmine käib siit läbi.
            return f"Kasutajat '{kasutaja}' ei leitud"
        if is_at_least(sihtroll, "admin"):
            # Uut admin+ määrangut ei looda: nende haldusõigus tuleneb rollist.
            return f"'{kasutaja}' haldusõigus tuleneb rollist, määrangut ei lisata"
        if not can_manage_user(actor_role, sihtroll):
            return f"Pole õigust kasutaja '{kasutaja}' määrangut muuta"

    for kasutaja in diff["removed"]:
        if kasutaja == actor.get("username"):
            continue  # oma dekoratiivse kirje koristus
        sihtroll = users_snapshot.get(kasutaja)
        if sihtroll is None:
            continue  # kustutatud kasutaja jäänuk: eemaldamine on koristus
        if not can_manage_user(actor_role, sihtroll):
            return f"Pole õigust kasutaja '{kasutaja}' määrangut eemaldada"

    return None
```

- [ ] **Samm 5: käivita testid**

Käsk: `.venv/bin/pytest tests/test_work_sets_access_diff.py -v`
Oodatud: PASS (14 testi).

- [ ] **Samm 6: commit**

```bash
git add server/config.py server/work_sets_access.py tests/test_work_sets_access_diff.py
git commit -m "feat(work-sets): access-diffi klassifikatsioon ja kirjepõhised valvurid (#318)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017Ej5TrAANh3KXb9ABtZtcw"
```

---

### Task 8: `set_access` salvestuskihis + router nõuab `revision`-it

**Failid:**
- Muuda: `server/work_sets_ops.py` (uus `set_access`, uus erand)
- Muuda: `server/auth.py` (`users_role_snapshot`)
- Muuda: `server/routers/work_sets.py:152-167` (`put_access`)
- Test: `tests/test_work_sets_api.py` (täiendus)

**Liidesed:**
- Tarbib: `classify_access_diff`, `check_access_diff` (Task 7).
- Toodab:
  - `server.auth.users_role_snapshot() -> Dict[str, str]`
  - `server.work_sets_ops.WorkSetAccessDenied(Exception)` (sõnum kannab
    veateadet)
  - `server.work_sets_ops.set_access(set_id, new_access, actor,
    users_snapshot, expected_revision) -> dict`

- [ ] **Samm 1: kirjuta kukkuvad testid**

Lisa `tests/test_work_sets_api.py` lõppu:

```python
def test_put_access_nouab_revisionit(client, work_sets, admin_token, ws_id):
    r = client.put(f"/work-sets/{ws_id}/access",
                   json={"access": {"contrib": "viewer"}},
                   headers=auth(admin_token))
    assert r.status_code == 400


def test_put_access_keelab_tundmatu_kasutajanime(client, work_sets, admin_token, ws_id):
    r = client.put(f"/work-sets/{ws_id}/access",
                   json={"access": {"puudub": "viewer"}, "revision": 2},
                   headers=auth(admin_token))
    assert r.status_code == 403
    assert "puudub" in str(r.json()["detail"])


def test_put_access_keelab_admin_maarangu(client, work_sets, admin_token, ws_id):
    r = client.put(f"/work-sets/{ws_id}/access",
                   json={"access": {"superadmin": "manager"}, "revision": 2},
                   headers=auth(admin_token))
    assert r.status_code == 403


def test_lukustatud_votme_valjajatmine_lukkab_terve_salvestuse_tagasi(
        client, work_sets, admin_token, ws_id):
    import server.work_sets_ops as ops
    ops.update_work_set(ws_id, {"access": {"editor": "manager", "superadmin": "manager"}},
                        "admin", expected_revision=2)
    # Klient „filtreeris" superadmini rea välja ja saadab ainult nähtavad read.
    r = client.put(f"/work-sets/{ws_id}/access",
                   json={"access": {"editor": "viewer"}, "revision": 3},
                   headers=auth(admin_token))
    assert r.status_code == 403
    ws = ops.load_work_set(ws_id)
    assert ws["access"]["superadmin"] == "manager"
    assert ws["revision"] == 3, "valideerimisviga ei tohi revisionit tõsta"


def test_valideerimisviga_ei_tosta_revisionit(client, work_sets, admin_token, ws_id):
    import server.work_sets_ops as ops
    enne = ops.load_work_set(ws_id)["revision"]
    client.put(f"/work-sets/{ws_id}/access",
               json={"access": {"puudub": "viewer"}, "revision": enne},
               headers=auth(admin_token))
    assert ops.load_work_set(ws_id)["revision"] == enne


def test_muutusteta_access_on_noop(client, work_sets, admin_token, ws_id):
    import server.work_sets_ops as ops
    ws = ops.load_work_set(ws_id)
    r = client.put(f"/work-sets/{ws_id}/access",
                   json={"access": dict(ws["access"]), "revision": ws["revision"]},
                   headers=auth(admin_token))
    assert r.status_code == 200
    assert ops.load_work_set(ws_id)["revision"] == ws["revision"]
```

- [ ] **Samm 2: käivita testid, veendu et kukuvad**

Käsk: `.venv/bin/pytest tests/test_work_sets_api.py -v -k "revisionit or tundmatu or admin_maarangu or lukustatud or noop"`
Oodatud: FAIL — praegune `put_access` tagastab 200 ka `revision`-ita ja
tundmatu nimega.

- [ ] **Samm 3: lisa `users_role_snapshot` `server/auth.py`-sse**

`users_transaction` järele:

```python
def users_role_snapshot():
    """Kasutajanimi → roll, KOPEERITUD `users_lock` all (ADR 0043 p3).

    Lukk vabaneb enne tagastust — kutsuja võtab seejärel `_work_sets_lock`-i.
    Kahte lukku ei hoita kunagi korraga ja kasutajalukku ei võeta koguluku sees.
    Vahepealne kasutaja kustutamine talutakse inertse jäänukina, mitte
    failideülese tehinguna.
    """
    with users_lock:
        return {u: d.get("role", "contributor") for u, d in load_users().items()}
```

- [ ] **Samm 4: lisa `set_access` `server/work_sets_ops.py`-sse**

Importidesse:

```python
from .config import WORK_SETS_DIR, WORK_SET_MAX_MEMBERS, get_logger
from .work_sets_access import check_access_diff, classify_access_diff
```

Erand `WorkSetLimit` järele:

```python
class WorkSetAccessDenied(Exception):
    """Diffis oli vähemalt üks keelatud muudatus — midagi ei salvestatud."""
```

`mutate_members` järele:

```python
def set_access(set_id: str, new_access: dict, actor: dict,
               users_snapshot: dict, expected_revision: Optional[int]) -> dict:
    """`access`-kaardi TÄISASENDUS koos serveripoolse diffiga (ADR 0043 p7).

    Kaardi lugemine, revision-kontroll, diff, valvurid ja salvestus toimuvad
    ühe `_work_sets_lock` all. `users_snapshot` on kaasa antud — siin ei
    kutsuta `load_users`-it, sest kahte lukku ei hoita korraga.
    """
    with _work_sets_lock:
        ws = load_work_set(set_id)
        if ws is None:
            raise WorkSetNotFound(set_id)
        _check_revision(ws, expected_revision)

        vana = ws.get("access") or {}
        diff = classify_access_diff(vana, new_access)
        viga = check_access_diff(diff, vana, new_access, users_snapshot, actor)
        if viga:
            # Valideerimisviga EI tõsta revisionit: kliendi olek jääb kehtima.
            raise WorkSetAccessDenied(viga)

        if not (diff["added"] or diff["changed"] or diff["removed"]):
            return ws  # muutusteta salvestus on no-op (ADR 0012 joon)

        ws["access"] = dict(new_access)
        ws["revision"] = ws.get("revision", 1) + 1
        return _save(ws, actor["username"], f"Töökollektsioon: õigused {set_id}")
```

- [ ] **Samm 5: kirjuta `put_access` ümber**

Asenda `server/routers/work_sets.py:152-167`:

```python
@router.put("/work-sets/{set_id}/access")
async def put_access(set_id: str, request: Request, user=Depends(require_role("admin"))):
    _load_or_404(set_id)
    body = await get_json_data(request)
    access = body.get("access")
    if not isinstance(access, dict):
        raise HTTPException(status_code=400, detail="access peab olema objekt")
    revision = body.get("revision")
    if not isinstance(revision, int) or isinstance(revision, bool):
        # Täisasendus ilma revisionita kirjutaks teise admini töö vaikselt üle.
        raise HTTPException(status_code=400, detail="revision on kohustuslik")

    # Hetktõmmis võetakse `users_lock` all ja see lukk on vabastatud ENNE
    # `_work_sets_lock`-i (ADR 0043 p3).
    users_snapshot = await run_in_threadpool(users_role_snapshot)
    try:
        ws = await run_in_threadpool(set_access, set_id, access, user,
                                     users_snapshot, revision)
    except WorkSetAccessDenied as e:
        raise HTTPException(status_code=403, detail=str(e))
    except WorkSetConflict as e:
        raise HTTPException(status_code=409, detail={"revision": e.current_revision})
    except WorkSetNotFound:
        raise HTTPException(status_code=404, detail="Töökollektsiooni ei leitud")
    return {"status": "success", "work_set": _public_view(ws, user)}
```

Lisa importidesse:

```python
from ..auth import users_role_snapshot
from ..work_sets_ops import WorkSetAccessDenied, set_access
```

(kontrolli olemasolevaid `from ..work_sets_ops import ...` ja `from ..auth
import ...` ridu ning täienda neid.)

- [ ] **Samm 6: kohanda olemasolev test**

`tests/test_work_sets_api.py:157`
(`test_access_vastu_voetakse_ainult_teadaolevad_rollid`) saadab
`{"contrib": "admin"}` ja ootab 400. Uus tee annab tundmatu rolli eest 403
(`check_access_diff`). Uuenda ootust:

```python
def test_access_vastu_voetakse_ainult_teadaolevad_rollid(client, work_sets, admin_token, ws_id):
    r = client.put(f"/work-sets/{ws_id}/access",
                   json={"access": {"contrib": "admin"}, "revision": 2},
                   headers=auth(admin_token))
    assert r.status_code == 403
    assert "viewer" in str(r.json()["detail"])
```

- [ ] **Samm 7: käivita testid**

Käsk: `.venv/bin/pytest tests/test_work_sets_api.py tests/test_work_sets_ops.py tests/test_work_sets_access.py tests/test_work_sets_members.py -v`
Oodatud: PASS.

- [ ] **Samm 8: commit**

```bash
git add server/auth.py server/work_sets_ops.py server/routers/work_sets.py tests/test_work_sets_api.py
git commit -m "feat(work-sets): PUT access valideerib diffi ja nõuab revisionit (#318)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017Ej5TrAANh3KXb9ABtZtcw"
```

---

### Task 9: `create_work_set` ei lisa loojat `access`-kaarti

**Failid:**
- Muuda: `server/work_sets_ops.py:86-103` (`create_work_set`)
- Test: `tests/test_work_sets_ops.py:41` (olemasolev ootus muutub)

**Liidesed:**
- Muutuv käitumine: uus kogu tekib `access: {}` ja `created_by: <admin>`.

**Nähtav tagajärg:** `Settings.tsx` „Minu õigused" filtreerib `my_access` järgi
(`src/pages/Settings.tsx:32`). Admin, kes kogu lõi, EI näe seda enam oma
isiklikus loendis — tema haldusõigus tuleb rollist. See on speki §5 tahtlik
tulemus, mitte regressioon; kontrolli see brauseris üle.

- [ ] **Samm 1: muuda olemasolev test kukkuma**

`tests/test_work_sets_ops.py:41` — asenda ootus:

```python
    # Looja ei saa enam automaatset `access`-kirjet: admini haldusõigus tuleneb
    # rollist ja dekoratiivne kirje eksitas „Minu õigused" loendit (ADR 0043 p5).
    assert ws["access"] == {}
    assert ws["created_by"] == "mari"
```

- [ ] **Samm 2: käivita test, veendu et kukub**

Käsk: `.venv/bin/pytest tests/test_work_sets_ops.py -v`
Oodatud: FAIL — `assert {'mari': 'manager'} == {}`.

- [ ] **Samm 3: muuda `create_work_set`**

`server/work_sets_ops.py`-s:

```python
            # Looja EI saa automaatset access-kirjet: kogusid loovad admin+,
            # kelle haldusõigus tuleneb rollist. `created_by` jääb auditiinfoks.
            # Vanadele kogudele massmigratsiooni ei tehta (ADR 0043 p5).
            "access": {},
```

- [ ] **Samm 4: käivita testid**

Käsk: `.venv/bin/pytest tests/test_work_sets_ops.py tests/test_work_sets_api.py tests/test_work_sets_access.py -v`
Oodatud: PASS. Kui mõni test eeldas loojat halduriks, lisa talle selgesõnaline
`update_work_set(..., {"access": {...}})` — ära taasta automaatset kirjet.

- [ ] **Samm 5: commit**

```bash
git add server/work_sets_ops.py tests/test_work_sets_ops.py
git commit -m "feat(work-sets): kogu looja ei saa automaatset access-kirjet (#318)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017Ej5TrAANh3KXb9ABtZtcw"
```

---

### Task 10: ühekordne surnud access-nimede import registrisse

**Failid:**
- Loo: `scripts/import_deleted_usernames.py`
- Test: `tests/test_import_deleted_usernames.py` (uus)

**Liidesed:**
- Tarbib: `server.auth.reserve_username`, `server.work_sets_ops.list_work_sets`.
- Toodab: `collect_unknown_access_usernames(work_sets, users) -> list`

**Kontekst:** varem kustutatud nimesid register tagasiulatuvalt ei tea. See on
juurutuse EELSAMM peatatud kontokirjutustega: katkine kogufail KATKESTAB
impordi, mitte ei jää vaikides vahele. Kogufaile EI muudeta.

- [ ] **Samm 1: kirjuta kukkuv test**

Loo `tests/test_import_deleted_usernames.py`:

```python
"""Ühekordne juurutuse eelsamm: vanade access-kaartide tundmatud nimed registrisse."""
import json

import pytest


def test_kogub_tundmatud_nimed(tmp_path):
    from scripts.import_deleted_usernames import collect_unknown_access_usernames

    kogud = [
        {"id": "ws_1", "access": {"editor": "manager", "kadunud": "viewer"}},
        {"id": "ws_2", "access": {"kadunud": "manager", "teine_kadunud": "viewer"}},
    ]
    users = {"editor": {}, "admin": {}}
    assert collect_unknown_access_usernames(kogud, users) == ["kadunud", "teine_kadunud"]


def test_katkine_kogufail_katkestab_impordi(tmp_path, monkeypatch):
    from scripts import import_deleted_usernames as skript

    kaust = tmp_path / "work_sets"
    kaust.mkdir()
    (kaust / "ws_1.json").write_text('{"id": "ws_1", "access": {}}')
    (kaust / "ws_2.json").write_text("{ katki")

    with pytest.raises(ValueError, match="ws_2"):
        skript.load_all_work_sets(str(kaust))
```

- [ ] **Samm 2: käivita test, veendu et kukub**

Käsk: `.venv/bin/pytest tests/test_import_deleted_usernames.py -v`
Oodatud: FAIL — `ModuleNotFoundError: No module named 'scripts.import_deleted_usernames'`.
`scripts/` ei ole `__init__.py`-ga pakett, aga `from scripts.x import y` töötab
nimeruumipaketina — sama mustrit kasutab juba
`tests/test_match_aa_duplicates.py:9`. Uut `__init__.py`-d EI looda.

- [ ] **Samm 3: kirjuta skript**

Loo `scripts/import_deleted_usernames.py`:

```python
#!/usr/bin/env python3
"""Ühekordne eelsamm: vanade töökollektsiooni access-kaartide tundmatud
kasutajanimed kustutatud nimede registrisse (ADR 0043 p8).

Uus register ei tea tagasiulatuvalt, kes varem kustutati. Ilma selle impordita
saaks uus konto vana surnud kirje kaudu õigusi pärida.

Jooksutatakse PEATATUD kontokirjutustega (backend maas või hoolduses):
konto loomine ja kustutamine käivad sama registri kallal.

Kogufaile EI muudeta. Katkine kogufail katkestab impordi.

Kasutus (serveris, konteinerist):
    docker exec -it vutt-backend python scripts/import_deleted_usernames.py --dry-run
    docker exec -it vutt-backend python scripts/import_deleted_usernames.py --apply
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server.auth import load_users, reserve_username  # noqa: E402
from server.config import WORK_SETS_DIR  # noqa: E402


def load_all_work_sets(kaust):
    """Loeb kõik kogufailid. Katkine fail VISKAB — vaikne vahelejätmine
    jätaks surnud nime registreerimata ja nime taaskasutatavaks."""
    kogud = []
    if not os.path.isdir(kaust):
        return kogud
    for nimi in sorted(os.listdir(kaust)):
        if not nimi.endswith(".json"):
            continue
        tee = os.path.join(kaust, nimi)
        try:
            with open(tee, "r", encoding="utf-8") as f:
                kogud.append(json.load(f))
        except (json.JSONDecodeError, OSError) as e:
            raise ValueError(f"Katkine kogufail {nimi}: {e}")
    return kogud


def collect_unknown_access_usernames(kogud, users):
    """Access-kaartides esinevad nimed, mida `users.json`-is EI OLE."""
    tundmatud = set()
    for ws in kogud:
        for kasutaja in (ws.get("access") or {}):
            if kasutaja not in users:
                tundmatud.add(kasutaja)
    return sorted(tundmatud)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--apply", action="store_true", help="kirjuta registrisse")
    args = p.parse_args()

    kogud = load_all_work_sets(WORK_SETS_DIR)
    users = load_users()
    tundmatud = collect_unknown_access_usernames(kogud, users)

    print(f"Kogusid: {len(kogud)}; tundmatuid access-nimesid: {len(tundmatud)}")
    for nimi in tundmatud:
        print(f"  {nimi}")

    if not args.apply:
        print("\nKuivkäivitus. Kirjutamiseks lisa --apply.")
        return 0

    for nimi in tundmatud:
        reserve_username(nimi)
    print(f"Registrisse lisatud: {len(tundmatud)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Samm 4: käivita testid**

Käsk: `.venv/bin/pytest tests/test_import_deleted_usernames.py -v`
Oodatud: PASS.

- [ ] **Samm 5: käivita kogu testikomplekt**

Käsk: `.venv/bin/pytest tests/ -q`
Oodatud: kõik roheline. Kui mõni vana test kukub, paranda TESTI ootus ainult
siis, kui muutus on plaanis kirjeldatud teadlik muudatus (Task 8 rollivea kood,
Task 9 looja kirje); muul juhul on tegu regressiooniga.

- [ ] **Samm 6: commit**

```bash
git add scripts/import_deleted_usernames.py tests/test_import_deleted_usernames.py
git commit -m "chore(auth): ühekordne surnud access-nimede import registrisse (#318)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017Ej5TrAANh3KXb9ABtZtcw"
```

---

## Etapi lõpp: väravad ja juurutus

- [ ] **Samm 1: kõik väravad**

```bash
.venv/bin/pytest tests/ -q
npm run typecheck
npm test
npm run lint:ci
npm run build
```

- [ ] **Samm 2: brauseris olemasoleva kliendiga**

Kontrolli, et ükski neist ei ole katki (klient ei muutunud):
- `/admin` → Kasutajad: rolli muutmine, kollektsioonide määramine,
  kirjutamisulatuse määramine, parooli lähtestus, kustutamine.
- `/admin` → Kollektsioonid: `CollectionEditor` „Ligipääs" salvestamine
  (vana `allowed_users` haru töötab edasi).
- `/admin` → Töökollektsioonid: kogu loomine, õiguste määramine
  (klient saadab terve kaardi + `revision` — kontrolli võrgukaardilt).
- Kutse vastuvõtmine `/set-password?token=…` → konto tekib.

- [ ] **Samm 3: PR**

```bash
git push -u origin feat/kasutajad-kogude-ligipaas-1a
gh pr create --base main --title "Etapp 1a: kasutajate lukk, nimeregister ja access-valvurid (#318)" --body "..."
```

PR-i kirjeldus peab nimetama: ADR 0043, spekk, mis jäi teadlikult 1b/2 jaoks
(`allowed_users` haru eemaldamine, GET users laiendus, paneel).

- [ ] **Samm 4: juurutus**

```bash
ssh vutt
cd ~/VUTT
./scripts/server_update.sh --no-cache        # Python-muudatus → --no-cache kohustuslik
docker exec -it vutt-backend python scripts/import_deleted_usernames.py   # kuivkäivitus
docker exec -it vutt-backend python scripts/import_deleted_usernames.py --apply
docker logs vutt-backend | tail -50
```

**NB:** import jookseb PÄRAST juurutust, aga konto loomise/kustutamise ajal
mitte. Kui tootmises on aktiivseid admin-toiminguid, tee import kohe pärast
restarti.

---

## Väljaspool etappi 1a

Need speki osad saavad oma plaani PÄRAST 1a liitmist (järjestikused PR-id
otse `main`-i vastu — virnastatud PR-idele CI kontrolle ei tule):

- **1b** — töökollektsiooni ligipääsupaneel (`workSetAccess.ts` taaskasutus,
  täieliku kaardi säilitamine filtreerimisel, koondsalvestus, „Lähtesta valik").
- **2** — `allowed_users` haru eemaldamine + `CollectionEditor` delta-toimingule,
  `GET /admin/collections/{id}/users` laiendus (`edit_users`, `visibility`,
  `is_virtual`), kollektsioonide loend adminile, superadmini seadete eraldamine.
- **3** — otsitav kasutajanimekiri, `/admin/users/:username` detail,
  `/admin/users/activity` (#318).
- **4** — ühine „Kogud" sisenemiskoht.
