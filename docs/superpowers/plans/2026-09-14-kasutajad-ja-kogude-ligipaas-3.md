# Etapp 3 — kasutajate nimekiri ja detailvaade (teostusplaan)

> **Agentidele:** KOHUSTUSLIK ALAMOSKUS: kasuta selle plaani täitmiseks
> `superpowers:subagent-driven-development` (soovitatud) või
> `superpowers:executing-plans`. Sammud on checkbox-kujul (`- [ ]`).

**Eesmärk:** `/admin/users` muutub kompaktseks otsitavaks nimekirjaks (nimi,
kasutajanimi, e-post, roll, viimane muudatus) ja kasutaja õigusi hallatakse
uues detailvaates `/admin/users/:username`, kus kolm õiguste telge ja konto
toimingud on ühes kohas ning kollektsiooniõigused salvestuvad ÜHE paketina.

**Arhitektuur:** server saab ühe uue lugemisendpoint'i
(`GET /admin/users/activity` — viimane git-commit kasutaja kohta, TTL 300 s,
üks logiläbimine threadpool'is). Kirjutusteed on juba olemas: etapi 2
`POST /admin/users/collection-rights` (delta) ja `PUT /work-sets/{id}/access`
(täisasendus + `revision`). Uut õiguste kirjutusteed EI looda. Kliendi pool
jaguneb puhasteks mooduliteks (`userRightsDraft.ts`, `userWorkSetSave.ts`,
`userListFilter.ts`), mis on vitestiga kaetud, ja nende vaadeteks
(`UserDetail.tsx`, ümber kirjutatud `Users.tsx`).

**Tehnoloogia:** FastAPI + GitPython, pytest; React 19 + TypeScript +
Tailwind, vitest, i18next, react-router (`useSearchParams`).

**Spekk:** [`docs/superpowers/specs/2026-09-14-kasutajad-ja-kogude-ligipaas-design.md`](../specs/2026-09-14-kasutajad-ja-kogude-ligipaas-design.md) (§1, §3, §5, §6 p3)
**ADR:** [0043](../../decisions/0043-kogude-oiguste-uhised-toimingud.md), [0031](../../decisions/0031-contributor-kollektsiooni-ulatus.md), [0038](../../decisions/0038-aktiivne-kogu-urlis.md), [0042](../../decisions/0042-tookollektsioonid.md)
**Eelnevad etapid:** [1a](2026-09-14-kasutajad-ja-kogude-ligipaas-1a.md) (PR #361),
[1b](2026-09-14-kasutajad-ja-kogude-ligipaas-1b.md) (PR #362),
[2](2026-09-14-kasutajad-ja-kogude-ligipaas-2.md) (PR #363, #364, #365) — kõik tootmises 2026-09-14.

## Üldised piirangud

- **Koodikommentaarid eesti keeles.** Kommentaar ütleb MIKS, mitte MIDA.
- **i18n (ADR 0011):** `fallbackLng` on VÄLJAS — iga uus võti lisatakse
  `src/locales/et/admin.json` JA `src/locales/en/admin.json` KORRAGA, muidu
  katkeb build. Valvurid: `localeParity.test.ts`, `translationKeysResolve.test.ts`.
- **Kaks telge (ADR 0031):** `allowed_collections` = lugemisõigus piiratud
  kogule; `edit_collections` = contributori kirjutamisulatus, mis kehtib KÕIGILE
  kogudele. Üks EI anna teist ja üks kirjutus ei tohi teist üle kirjutada.
- **Üks kirjutustee (ADR 0043 p2):** kollektsiooniõigused lähevad AINULT
  `POST /admin/users/collection-rights` delta kaudu (`applyCollectionRights`).
  Vanu `update-collections` / `update-edit-collections` endpoint'e uus klient
  ei kutsu. Server valideerib kogu paketi ENNE ühtki muudatust.
- **Laadimisviga ei ole tühi õiguste kaart.** Ebaõnnestunud laadimisel jääb
  mustand `null`-iks ja salvestusnupp on väljas — tühja mustandi salvestamine
  võtaks kõik õigused ära.
- **Töökollektsioonid on eraldi failid** oma `revision`-lukuga: failideülest
  tehingut EI OLE. Muudatused salvestuvad kogu kaupa, osaline edu on tavaline
  tulemus; juba salvestatut ei saadeta uuesti. 409 korral laaditakse uus olek
  ja näidatakse kasutaja kavatsust võrdluseks — ei automaatset kordussaatmist.
- **Täieliku kaardi leping (ADR 0043 p7):** `PUT /work-sets/{id}/access` saab
  TERVE `access`-kaardi. `accessChanges` ehitab selle laetud kaardist; filtrid
  ja nähtavad read EI TOHI kaarti kärpida.
- **Sessioonid:** kollektsiooniõiguste salvestus lõpetab mõjutatud kasutaja
  sessioonid (hoiatus nupu juures, ENNE vajutust). Töökollektsiooni `access`
  muudatus sessioone EI lõpeta — seda hoiatust sinna ei panda.
- **Admin-filtrid ei muuda aktiivset kogu (ADR 0038):** `useCollectionUrlSync`-i
  admin-lehel ei kutsuta; `rights_collection` / `rights_work_set` on
  haldusloendi filtrid, mitte koguvalik. `CollectionContext`-i ei kirjutata.
- **Peitmine ei ole autoriseerimine:** vaate rollikontroll on mugavus, otsus
  tehakse serveris (`require_role("admin")`).
- **Python 3.9 (backend Docker):** `Optional[dict]`, mitte `dict | None`.
  Blokeeriv I/O `async def` sees on keelatud (ADR 0002) → `run_in_threadpool`.
- **nginx:** `/api/files/` proksib kõik backend-teed avalikult — uus endpoint
  on `/admin/` all JA `require_role("admin")` taga.
- **Väravad iga taski lõpus:** `npm run typecheck`, `npm test`,
  `.venv/bin/pytest tests/` (serveripoolsel taskil). Etapi lõpus lisaks
  `npm run lint:ci` (lävi `--max-warnings 44` — parandades LANGETA arvu) ja
  `npm run build`.
- **Käsud käivad projekti venv-iga:** `.venv/bin/pytest`, `.venv/bin/python`.

## Kaks PR-i ja miks selles järjekorras

| PR | Sisu |
|---|---|
| **3a** | server: `GET /admin/users/activity`; klient: detailvaade `/admin/users/:username` kolme õiguste plokiga. Olemasolev kaardiloend jääb esialgu alles ja saab igale kaardile lingi detaili. |
| **3b** | `Users.tsx` asendub kompaktse nimekirjaga: otsing, rolli- ja õigusefiltrid URL-is, klaviatuuritugi, „viimane muudatus" veerg. Inline õiguste toimetamine ja konto kebab-menüü kaovad — need elavad nüüd detailis. |

Spekk §6 pakkus „server + loend eraldi PR-is, detailvaade teises". Siin on
järjekord **detail enne loendi asendamist**: loendi kärpimine ENNE detaili
jätaks tootmisse perioodi, kus kasutaja õigusi ei saa üldse muuta (mõlemad
PR-id juurutatakse eraldi, sest virnastatud PR-idele CI checke ei tule).
Server on siiski oma taskides 3a alguses ja on eraldi testitav.

## Failistruktuur

| Fail | Vastutus | Muudatus |
|---|---|---|
| `server/git_ops.py` | `_read_author_dates`, `_latest_by_author`, `get_user_activity` (TTL 300 s) | muuda |
| `server/routers/admin.py` | `GET /admin/users/activity` | muuda |
| `tests/test_user_activity.py` | aktiivsuse kaardi ühikkate | **uus** |
| `tests/test_admin_activity_endpoint.py` | endpoint'i rollipiir ja kuju | **uus** |
| `src/pages/admin/userRightsDraft.ts` | ühe KASUTAJA õiguste mustand, read, alused, delta | **uus** |
| `src/pages/admin/__tests__/userRightsDraft.test.ts` | ülaltoodu kate | **uus** |
| `src/pages/admin/userWorkSetSave.ts` | kogu kaupa salvestus + osalise edu tulemus | **uus** |
| `src/pages/admin/__tests__/userWorkSetSave.test.ts` | ülaltoodu kate | **uus** |
| `src/pages/admin/ResetPasswordResult.tsx` | parooli-taastamise lingi kast (välja tõstetud) | **uus** |
| `src/utils/formatDateTime.ts` | kuupäev + kellaaeg eesti kujul | **uus** |
| `src/pages/admin/UserDetail.tsx` | kasutaja detailvaade | **uus** |
| `src/pages/admin/userListFilter.ts` | haldusloendi filtrid + URL-i teisendus | **uus** (3b) |
| `src/pages/admin/__tests__/userListFilter.test.ts` | ülaltoodu kate | **uus** (3b) |
| `src/services/userActivityService.ts` | `getUserActivity()` | **uus** (3b) |
| `src/pages/admin/Users.tsx` | 3a: link detaili + kasutab `ResetPasswordResult`-i; 3b: kompaktne nimekiri | muuda |
| `src/App.tsx` | marsruut `/admin/users/:username` | muuda |
| `src/locales/{et,en}/admin.json` | `users.detail.*`, `users.list.*` | muuda MÕLEMAD |

---

# Osa 3a — server + kasutajadetail

### Task 0: haru

- [ ] **Samm 1: kontrolli, et main on värske**

```bash
git checkout main && git pull --ff-only && git log --oneline -1
```

Oodatud: `199582ca` või uuem.

- [ ] **Samm 2: loo haru**

```bash
git checkout -b feat/kasutajate-detail-3a
```

---

### Task 1: aktiivsuse kaart git-logist

**Failid:**
- Muuda: `server/git_ops.py`
- Test: `tests/test_user_activity.py`

**Liidesed:**
- Toodab: `get_user_activity(usernames: list) -> dict` (username → ISO-aeg),
  `_latest_by_author(pairs) -> dict`, `_read_author_dates(repo) -> list`,
  `_reset_activity_cache()`, konstant `ACTIVITY_TTL_SECONDS = 300`.

- [ ] **Samm 1: kirjuta kukkuv test**

Fail `tests/test_user_activity.py`:

```python
"""Kasutaja viimane muudatus git-logist (#318, spekk §1).

„Viimane muudatus" tähendab COMMIT'i, mitte viimast sisselogimist. Autor
seotakse ainult TÄPSE kasutajanime alusel: git `--author` on substring-otsing
ja lähendatud vaste annaks vale inimese aktiivsuse.
"""
from datetime import datetime, timedelta

import pytest

import server.git_ops as git_ops


@pytest.fixture(autouse=True)
def puhas_vahemalu():
    git_ops._reset_activity_cache()
    yield
    git_ops._reset_activity_cache()


def sea_log(monkeypatch, paarid, loendur=None):
    def _loe(repo):
        if loendur is not None:
            loendur.append(1)
        return list(paarid)
    monkeypatch.setattr(git_ops, "_read_author_dates", _loe)
    monkeypatch.setattr(git_ops, "get_or_init_repo", lambda: object())


def test_uusim_commit_autori_kohta(monkeypatch):
    # Git log on uuemast vanemani: esimene kirje autori kohta ongi viimane muudatus.
    sea_log(monkeypatch, [
        ("meelis", "2026-09-14T10:00:00+03:00"),
        ("annipolding", "2026-09-05T09:00:00+03:00"),
        ("meelis", "2026-09-01T10:00:00+03:00"),
    ])
    got = git_ops.get_user_activity(["meelis", "annipolding"])
    assert got == {"meelis": "2026-09-14T10:00:00+03:00",
                   "annipolding": "2026-09-05T09:00:00+03:00"}


def test_automaatne_ei_ole_kasutaja(monkeypatch):
    # Taustatee autor (save_config_with_git) ei ole kellegi aktiivsus.
    sea_log(monkeypatch, [("Automaatne", "2026-09-14T10:00:00+03:00")])
    assert git_ops.get_user_activity(["Automaatne", "meelis"]) == {}


def test_ainult_tapne_kasutajanimi(monkeypatch):
    sea_log(monkeypatch, [("meelis2", "2026-09-14T10:00:00+03:00")])
    # „meelis2" EI OLE „meelis" ja tundmatu autor ei jõua vastusesse.
    assert git_ops.get_user_activity(["meelis"]) == {}


def test_ttl_valtib_teist_git_labimist(monkeypatch):
    loendur = []
    sea_log(monkeypatch, [("meelis", "2026-09-14T10:00:00+03:00")], loendur)
    git_ops.get_user_activity(["meelis"])
    git_ops.get_user_activity(["meelis"])
    assert len(loendur) == 1

    # TTL möödas → uus läbimine.
    git_ops._activity_cache_at = datetime.now() - timedelta(
        seconds=git_ops.ACTIVITY_TTL_SECONDS + 1)
    git_ops.get_user_activity(["meelis"])
    assert len(loendur) == 2


def test_git_viga_ei_muutu_tyhjaks_kaardiks(monkeypatch):
    # Tühi kaart tähendaks „keegi ei ole midagi teinud" ja oleks katkisest
    # git-ist eristamatu. Viga peab tõusma kutsujani.
    def _kukub(repo):
        raise RuntimeError("git ei vasta")
    monkeypatch.setattr(git_ops, "_read_author_dates", _kukub)
    monkeypatch.setattr(git_ops, "get_or_init_repo", lambda: object())
    with pytest.raises(RuntimeError):
        git_ops.get_user_activity(["meelis"])
```

- [ ] **Samm 2: käivita ja veendu, et kukub**

Käsk: `.venv/bin/pytest tests/test_user_activity.py -v`
Oodatud: FAIL — `AttributeError: module 'server.git_ops' has no attribute '_reset_activity_cache'`.

- [ ] **Samm 3: kirjuta teostus**

`server/git_ops.py`, `_work_info_cache` deklaratsioonide juurde:

```python
# Kasutajate viimane muudatus (#318). Kaart on kõigile adminidele SAMA, seega
# globaalne TTL-vahemälu; kasutajapõhist vastust siin ei hoita.
ACTIVITY_TTL_SECONDS = 300
_activity_cache = None       # autor -> ISO-aeg
_activity_cache_at = None
_activity_lock = threading.Lock()
```

Faili lõppu (või `_read_commit_meta` naabrusse):

```python
def _reset_activity_cache():
    """Ainult testidele: TTL-vahemälu nullimine."""
    global _activity_cache, _activity_cache_at
    with _activity_lock:
        _activity_cache = None
        _activity_cache_at = None


def _read_author_dates(repo):
    """(autor, ISO-aeg) paarid ÜHE git-protsessiga, uuemast vanemani.

    Commiti sõnumit siin ei loeta — vaja on ainult „kes, millal". Mõõdetud
    tootmises: 12 060 commiti läbimine ~0,13 s, seega piisab ühest korrast
    TTL kohta ja partii-akent (`--max-count`) pole vaja.
    """
    out = repo.git.log(f"--format=%an{_COMMIT_FIELD_SEP}%cI")
    paarid = []
    for rida in out.split("\n"):
        if _COMMIT_FIELD_SEP not in rida:
            continue
        autor, iso = rida.split(_COMMIT_FIELD_SEP, 1)
        iso = iso.strip()
        if autor and iso:
            paarid.append((autor, iso))
    return paarid


def _latest_by_author(paarid):
    """Autor → uusim aeg. Git log on uuemast vanemani, seega esimene võidab.

    „Automaatne" on taustatee autor (vt `save_config_with_git`) — see ei ole
    ühegi inimese muudatus.
    """
    out = {}
    for autor, iso in paarid:
        if autor == "Automaatne":
            continue
        if autor not in out:
            out[autor] = iso
    return out


def get_user_activity(usernames):
    """username → viimase commiti ISO-aeg; puuduv vaste jääb kaardist välja.

    Vaste leitakse TÄPSE kasutajanime järgi: VUTT-i commitides on `%an`
    kasutajanimi (vt `save_page_to_git`). Ligikaudne vaste (git `--author`
    on substring) annaks vale inimese aktiivsuse.

    Viga EI muutu tühjaks kaardiks — tühi kaart tähendaks „keegi ei ole midagi
    teinud" ja oleks katkisest git-ist eristamatu. Kutsuja otsustab, kuidas
    seda kuvada.
    """
    global _activity_cache, _activity_cache_at
    with _activity_lock:
        vana = (_activity_cache is None or _activity_cache_at is None
                or (datetime.now() - _activity_cache_at).total_seconds()
                > ACTIVITY_TTL_SECONDS)
        if vana:
            repo = get_or_init_repo()
            _activity_cache = _latest_by_author(_read_author_dates(repo))
            _activity_cache_at = datetime.now()
        kaart = _activity_cache
    return {u: kaart[u] for u in usernames if u in kaart}
```

- [ ] **Samm 4: käivita testid**

Käsk: `.venv/bin/pytest tests/test_user_activity.py -v`
Oodatud: PASS (5 testi).

- [ ] **Samm 5: commit**

```bash
git add server/git_ops.py tests/test_user_activity.py
git commit -m "feat(admin): kasutaja viimane muudatus git-logist, TTL 300 s (#318)"
```

---

### Task 2: `GET /admin/users/activity`

**Failid:**
- Muuda: `server/routers/admin.py`
- Test: `tests/test_admin_activity_endpoint.py`

**Liidesed:**
- Tarbib: `get_user_activity` (Task 1), `get_all_users` (olemasolev).
- Toodab: `GET /admin/users/activity` → `{"status": "success", "activity": {username: iso}}`.

- [ ] **Samm 1: kirjuta kukkuv test**

Fail `tests/test_admin_activity_endpoint.py`:

```python
"""GET /admin/users/activity (#318, spekk §1).

Endpoint on `/admin/` all ja admini taga: nginx proksib `/api/files/` alt KÕIK
backend-teed avalikult, seega sisemist infot lekitav tee vajab mõlemat.
"""
import server.routers.admin as admin_router


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_tagastab_ainult_olemasolevad_kasutajad(client, login, monkeypatch):
    monkeypatch.setattr(admin_router, "get_user_activity",
                        lambda usernames: {"admin": "2026-09-14T10:00:00+03:00"})
    token = login("admin", "adminpass")

    r = client.get("/admin/users/activity", headers=_auth(token))
    assert r.status_code == 200, r.text
    assert r.json()["activity"] == {"admin": "2026-09-14T10:00:00+03:00"}


def test_kasutajanimed_tulevad_users_json_ist(client, login, monkeypatch):
    nahtud = {}

    def _kaart(usernames):
        nahtud["usernames"] = sorted(usernames)
        return {}

    monkeypatch.setattr(admin_router, "get_user_activity", _kaart)
    token = login("admin", "adminpass")
    client.get("/admin/users/activity", headers=_auth(token))
    # Kaarti küsitakse KÕIGI kontode kohta, mitte git-i autorite nimekirja alusel.
    assert "contrib" in nahtud["usernames"] and "superadmin" in nahtud["usernames"]


def test_editor_ei_paase(client, login, monkeypatch):
    monkeypatch.setattr(admin_router, "get_user_activity", lambda usernames: {})
    token = login("editor", "editorpass")
    assert client.get("/admin/users/activity", headers=_auth(token)).status_code == 403


def test_ilma_tokenita_ei_paase(client):
    assert client.get("/admin/users/activity").status_code in (401, 403)
```

- [ ] **Samm 2: käivita ja veendu, et kukub**

Käsk: `.venv/bin/pytest tests/test_admin_activity_endpoint.py -v`
Oodatud: FAIL — `AttributeError: module 'server.routers.admin' has no attribute 'get_user_activity'`.

- [ ] **Samm 3: kirjuta teostus**

`server/routers/admin.py` — täienda git_ops importi:

```python
from ..git_ops import (
    clear_git_failures,
    delete_work_from_git,
    get_git_failures,
    get_user_activity,
    run_git_fsck,
)
```

Ja lisa `admin_users` endpoint'i järele:

```python
@router.get("/admin/users/activity")
async def admin_users_activity(user=Depends(require_role("admin"))):
    """Iga kasutaja viimane muudatus (#318, spekk §1).

    Viimane MUUDATUS tähendab git-commit'i, mitte viimast sisselogimist.
    Blokeeriv git-töö käib threadpool'is (ADR 0002); vastus tuleb TTL-vahemälust,
    seega üks logiläbimine 300 s kohta, mitte üks päringu kohta.
    """
    usernames = [u["username"] for u in get_all_users()]
    activity = await run_in_threadpool(get_user_activity, usernames)
    return {"status": "success", "activity": activity}
```

- [ ] **Samm 4: käivita testid**

Käsk: `.venv/bin/pytest tests/test_admin_activity_endpoint.py tests/test_user_activity.py -v`
Oodatud: PASS.

- [ ] **Samm 5: kogu serveri värav**

Käsk: `.venv/bin/pytest tests/ -q`
Oodatud: PASS (olemasolevad testid ei tohi katki minna).

- [ ] **Samm 6: commit**

```bash
git add server/routers/admin.py tests/test_admin_activity_endpoint.py
git commit -m "feat(admin): GET /admin/users/activity (#318)"
```

---

### Task 3: `userRightsDraft.ts` — ühe kasutaja õiguste mustand

**Failid:**
- Loo: `src/pages/admin/userRightsDraft.ts`
- Test: `src/pages/admin/__tests__/userRightsDraft.test.ts`

**Liidesed:**
- Tarbib: `RightsBasis` (`./collectionRightsDraft`), `RightsChange`
  (`../../services/collectionRightsService`), `isAtLeast` (`../../utils/roleUtils`).
- Toodab: `CollectionInfo`, `UserRightsState`, `UserRightsRow`,
  `userRightsRows(state, collections, targetRole)`,
  `addableAllowed(collections, state)`,
  `addableEdit(collections, state, targetRole)`,
  `userRightsDelta(loaded, draft, username)`.

- [ ] **Samm 1: kirjuta kukkuv test**

Fail `src/pages/admin/__tests__/userRightsDraft.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  addableAllowed, addableEdit, CollectionInfo, userRightsDelta, userRightsRows,
  UserRightsState,
} from '../userRightsDraft';

const KOGUD: Record<string, CollectionInfo> = {
  kinnine: { id: 'kinnine', name: 'Kinnine', visibility: 'restricted', isVirtual: false },
  avalik: { id: 'avalik', name: 'Avalik', visibility: 'public', isVirtual: false },
  ruhm: { id: 'ruhm', name: 'Rühm', visibility: 'public', isVirtual: true },
};

const olek = (allowed: string[], edit: string[]): UserRightsState =>
  ({ allowed: new Set(allowed), edit: new Set(edit) });

describe('userRightsRows', () => {
  it('contributori määrang on „assigned"', () => {
    const [rida] = userRightsRows(olek(['kinnine'], ['kinnine']), KOGUD, 'contributor');
    expect(rida.collectionId).toBe('kinnine');
    expect(rida.allowedBasis).toBe('assigned');
    expect(rida.editBasis).toBe('assigned');
    expect(rida.exists).toBe(true);
  });

  it('toimetaja kirjutamisulatus tuleb rollist, lugemisõigus mitte', () => {
    // ADR 0031: editor'i ulatus on üldine, aga piiratud kogu LUGEMISõigust
    // vajab ta endiselt — seepärast ei tohi mõlemad alused olla ühesugused.
    const [rida] = userRightsRows(olek(['kinnine'], ['kinnine']), KOGUD, 'editor');
    expect(rida.editBasis).toBe('role_based');
    expect(rida.allowedBasis).toBe('assigned');
  });

  it('adminil on mõlemad alused rollist', () => {
    const [rida] = userRightsRows(olek(['kinnine'], ['kinnine']), KOGUD, 'admin');
    expect(rida.allowedBasis).toBe('role_based');
    expect(rida.editBasis).toBe('role_based');
  });

  it('avaliku kogu lugemismäärang on inertne jäänuk', () => {
    const [rida] = userRightsRows(olek(['avalik'], []), KOGUD, 'contributor');
    expect(rida.allowedBasis).toBe('inert');
    expect(rida.allowed).toBe(true);  // määrang on ALLES ja taasjõustub piiramisel
  });

  it('kustutatud kogu jäänuk on nähtav, inertne ja lõpus', () => {
    const read = userRightsRows(olek(['kinnine', 'kadunud'], []), KOGUD, 'contributor');
    expect(read.map(r => r.collectionId)).toEqual(['kinnine', 'kadunud']);
    const kadunud = read[1];
    expect(kadunud.exists).toBe(false);
    expect(kadunud.allowedBasis).toBe('inert');
    expect(kadunud.name).toBe('kadunud');
  });
});

describe('addableAllowed / addableEdit', () => {
  it('lugemisõigust pakutakse ainult piiratud ja veel määramata kogule', () => {
    expect(addableAllowed(KOGUD, olek([], [])).map(c => c.id)).toEqual(['kinnine']);
    expect(addableAllowed(KOGUD, olek(['kinnine'], [])).map(c => c.id)).toEqual([]);
  });

  it('kirjutamisulatust ei pakuta toimetajale ega virtuaalsele rühmale', () => {
    expect(addableEdit(KOGUD, olek([], []), 'editor')).toEqual([]);
    expect(addableEdit(KOGUD, olek([], []), 'contributor').map(c => c.id))
      .toEqual(['avalik', 'kinnine']);
  });
});

describe('userRightsDelta', () => {
  it('puutumata olek ei tekita muudatust', () => {
    expect(userRightsDelta(olek(['kinnine'], []), olek(['kinnine'], []), 'mati')).toEqual([]);
  });

  it('kaks telge on eraldi kolmikud', () => {
    const delta = userRightsDelta(olek(['kinnine'], []), olek([], ['kinnine']), 'mati');
    expect(delta).toEqual([
      { username: 'mati', collection_id: 'kinnine', field: 'edit', action: 'add' },
      { username: 'mati', collection_id: 'kinnine', field: 'allowed', action: 'remove' },
    ]);
  });

  it('kustutatud kogu jäänukit tohib eemaldada', () => {
    const delta = userRightsDelta(olek(['kadunud'], []), olek([], []), 'mati');
    expect(delta).toEqual([
      { username: 'mati', collection_id: 'kadunud', field: 'allowed', action: 'remove' },
    ]);
  });
});
```

- [ ] **Samm 2: käivita ja veendu, et kukub**

Käsk: `npx vitest run src/pages/admin/__tests__/userRightsDraft.test.ts`
Oodatud: FAIL — `Failed to resolve import "../userRightsDraft"`.

- [ ] **Samm 3: kirjuta teostus**

Fail `src/pages/admin/userRightsDraft.ts`:

```ts
/**
 * Ühe KASUTAJA kollektsiooniõiguste mustand (#318, ADR 0043 p2).
 *
 * Peegelpilt `collectionRightsDraft.ts`-ist: seal on read kasutajate kohta
 * ühes kogus, siin kogude kohta ühel kasutajal. Serveri toiming on SAMA
 * (`apply_collection_rights_delta`) ja ka `RightsChange` kolmik on sama —
 * teist kirjutusteed ei looda.
 *
 * Kaks telge (ADR 0031): `allowed` = lugemisõigus piiratud kogule, `edit` =
 * contributori kirjutamisulatus (kehtib KÕIGILE kogudele). Üks ei anna teist.
 *
 * Siinsed funktsioonid PEEGELDAVAD serveri reegleid — otsus tehakse serveris.
 */
import { isAtLeast } from '../../utils/roleUtils';
import { RightsChange } from '../../services/collectionRightsService';
import { RightsBasis } from './collectionRightsDraft';

export interface CollectionInfo {
  id: string;
  name: string;
  visibility: 'public' | 'restricted';
  isVirtual: boolean;
}

export interface UserRightsState {
  allowed: Set<string>;
  edit: Set<string>;
}

export interface UserRightsRow {
  collectionId: string;
  name: string;
  /** Kas kogu on konfiguratsioonis olemas? `false` = kustutatud kogu jäänuk. */
  exists: boolean;
  allowed: boolean;
  edit: boolean;
  allowedBasis: RightsBasis;
  editBasis: RightsBasis;
}

/**
 * Read kogude kaupa: kõik, millel on SALVESTATUD määrang kummalgi teljel.
 * Olemasolevad kogud nime järgi, kustutatud jäänukid lõppu — hüplev
 * järjestus teeks „mis muutus" hindamise võimatuks.
 */
export function userRightsRows(
  state: UserRightsState,
  collections: Record<string, CollectionInfo>,
  targetRole: string,
): UserRightsRow[] {
  const idd = [...new Set([...state.allowed, ...state.edit])];
  const read = idd.map<UserRightsRow>(id => {
    const kogu = collections[id];
    const exists = kogu !== undefined;

    let allowedBasis: RightsBasis = 'assigned';
    let editBasis: RightsBasis = 'assigned';
    if (isAtLeast(targetRole, 'admin')) {
      // Admin+ näeb ja toimetab kõike rollist tulenevalt; kirje on dekoratiivne.
      allowedBasis = 'role_based';
      editBasis = 'role_based';
    } else if (isAtLeast(targetRole, 'editor')) {
      // Toimetaja ulatus on üldine, LUGEMISõigust vajab ta endiselt (ADR 0031).
      editBasis = 'role_based';
    }

    if (!exists) {
      // Kustutatud kogu ID ei ole kehtiv õigus, aga ta on andmetes alles ja
      // ainus tee teda maha võtta on see rida.
      allowedBasis = 'inert';
      editBasis = 'inert';
    } else if (allowedBasis === 'assigned' && kogu.visibility === 'public') {
      // Avalikul kogul määrang ei mõju — aga ta taasjõustub, kui kogu piiratakse.
      allowedBasis = 'inert';
    }

    return {
      collectionId: id,
      name: exists ? kogu.name : id,
      exists,
      allowed: state.allowed.has(id),
      edit: state.edit.has(id),
      allowedBasis,
      editBasis,
    };
  });

  return read.sort((a, b) => {
    if (a.exists !== b.exists) return a.exists ? -1 : 1;
    return a.name.localeCompare(b.name, 'et');
  });
}

/** Lisatav lugemisõigus: AINULT piiratud kogu (server vastab avalikule 400-ga). */
export function addableAllowed(
  collections: Record<string, CollectionInfo>, state: UserRightsState,
): CollectionInfo[] {
  return Object.values(collections)
    .filter(c => c.visibility === 'restricted' && !state.allowed.has(c.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'et'));
}

/**
 * Lisatav kirjutamisulatus: ainult contributor'ile (editor+ ulatus tuleb
 * rollist) ja mitte virtuaalsele rühmale — teosele ei saagi virtuaalset
 * gruppi määrata, seega ei saa see olla ka ulatuse liige.
 */
export function addableEdit(
  collections: Record<string, CollectionInfo>,
  state: UserRightsState,
  targetRole: string,
): CollectionInfo[] {
  if (isAtLeast(targetRole, 'editor')) return [];
  return Object.values(collections)
    .filter(c => !c.isVirtual && !state.edit.has(c.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'et'));
}

/** Muudetud määrangud ühe KASUTAJA piires. Puutumata kogu ei tekita muudatust. */
export function userRightsDelta(
  loaded: UserRightsState, draft: UserRightsState, username: string,
): RightsChange[] {
  const out: RightsChange[] = [];
  for (const field of ['edit', 'allowed'] as const) {
    const vana = loaded[field];
    const uus = draft[field];
    for (const id of [...uus].sort()) {
      if (!vana.has(id)) out.push({ username, collection_id: id, field, action: 'add' });
    }
    for (const id of [...vana].sort()) {
      if (!uus.has(id)) out.push({ username, collection_id: id, field, action: 'remove' });
    }
  }
  return out;
}
```

- [ ] **Samm 4: käivita testid**

Käsk: `npx vitest run src/pages/admin/__tests__/userRightsDraft.test.ts`
Oodatud: PASS.

- [ ] **Samm 5: väravad ja commit**

```bash
npm run typecheck && npm test
git add src/pages/admin/userRightsDraft.ts src/pages/admin/__tests__/userRightsDraft.test.ts
git commit -m "feat(admin): kasutaja kollektsiooniõiguste mustand (#318)"
```

---

### Task 4: `userWorkSetSave.ts` — kogu kaupa salvestus

**Failid:**
- Loo: `src/pages/admin/userWorkSetSave.ts`
- Test: `src/pages/admin/__tests__/userWorkSetSave.test.ts`

**Liidesed:**
- Tarbib: `AccessChange` (`./workSetAccess`).
- Toodab: `SaveOutcome`, `saveAccessChanges(changes, save)`.

- [ ] **Samm 1: kirjuta kukkuv test**

Fail `src/pages/admin/__tests__/userWorkSetSave.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { saveAccessChanges } from '../userWorkSetSave';
import { AccessChange } from '../workSetAccess';

const muudatus = (setId: string): AccessChange =>
  ({ setId, access: { mati: 'viewer' }, revision: 1 });

describe('saveAccessChanges', () => {
  it('salvestab iga kogu eraldi ja loetleb õnnestunud', async () => {
    const save = vi.fn().mockResolvedValue({});
    const tulemus = await saveAccessChanges([muudatus('a'), muudatus('b')], save);
    expect(save).toHaveBeenCalledTimes(2);
    expect(tulemus).toEqual({ saved: ['a', 'b'], failed: [] });
  });

  it('ühe kogu konflikt ei peata teiste salvestamist', async () => {
    // Kogud on ERALDI failid oma revision-lukuga: ühe 409 ei ütle teiste kohta
    // midagi ja katkestamine jätaks töö pooleli ilma põhjuseta.
    const save = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('konflikt'), { status: 409 }))
      .mockResolvedValueOnce({});
    const tulemus = await saveAccessChanges([muudatus('a'), muudatus('b')], save);
    expect(save).toHaveBeenCalledTimes(2);
    expect(tulemus.saved).toEqual(['b']);
    expect(tulemus.failed).toEqual([{ setId: 'a', status: 409 }]);
  });

  it('tühi nimekiri ei kutsu salvestust', async () => {
    const save = vi.fn();
    expect(await saveAccessChanges([], save)).toEqual({ saved: [], failed: [] });
    expect(save).not.toHaveBeenCalled();
  });
});
```

- [ ] **Samm 2: käivita ja veendu, et kukub**

Käsk: `npx vitest run src/pages/admin/__tests__/userWorkSetSave.test.ts`
Oodatud: FAIL — `Failed to resolve import "../userWorkSetSave"`.

- [ ] **Samm 3: kirjuta teostus**

Fail `src/pages/admin/userWorkSetSave.ts`:

```ts
/**
 * Ühe kasutaja töökollektsiooni-määrangute salvestus (#318, spekk §5).
 *
 * Iga kogu on OMA fail oma `revision`-lukuga — failideülest tehingut ei ole.
 * Seepärast salvestatakse kogu kaupa ja OSALINE edu on tavaline tulemus, mitte
 * erand: juba salvestatut ei saadeta uuesti ja ühe kogu konflikt ei tohi
 * teiste muudatusi ära jätta.
 */
import { AccessChange } from './workSetAccess';

export interface SaveOutcome {
  /** Edukalt salvestatud kogude ID-d. */
  saved: string[];
  /** Salvestamata jäänud kogud koos HTTP-staatusega (409 = revision-konflikt). */
  failed: { setId: string; status?: number }[];
}

export async function saveAccessChanges(
  changes: AccessChange[],
  save: (c: AccessChange) => Promise<unknown>,
): Promise<SaveOutcome> {
  const out: SaveOutcome = { saved: [], failed: [] };
  for (const c of changes) {
    try {
      await save(c);
      out.saved.push(c.setId);
    } catch (e) {
      out.failed.push({ setId: c.setId, status: (e as { status?: number }).status });
    }
  }
  return out;
}
```

- [ ] **Samm 4: käivita testid**

Käsk: `npx vitest run src/pages/admin/__tests__/userWorkSetSave.test.ts`
Oodatud: PASS.

- [ ] **Samm 5: väravad ja commit**

```bash
npm run typecheck && npm test
git add src/pages/admin/userWorkSetSave.ts src/pages/admin/__tests__/userWorkSetSave.test.ts
git commit -m "feat(admin): töökollektsioonide kogu-kaupa salvestus osalise eduga (#318)"
```

---

### Task 5: `ResetPasswordResult` ja `formatDateTime` välja tõstmine

Detailvaade vajab sama parooli-taastamise kasti ja sama kuupäevavormingut mis
loend. Kopeerimise asemel tõstetakse need enne detaili kirjutamist välja —
kolmas `toLocaleDateString('et-EE', …)` koopia oli juba tekkimas.

**Failid:**
- Loo: `src/utils/formatDateTime.ts`
- Loo: `src/pages/admin/ResetPasswordResult.tsx`
- Muuda: `src/pages/admin/Users.tsx` (kasutab mõlemat; JSX liigub muutmata)

**Liidesed:**
- Toodab: `formatDateTime(iso: string): string`;
  `ResetPasswordResult` props `{ result: ResetResult; onClose: () => void }`
  ja tüüp `ResetResult = { username: string; name: string; reset_url: string;
  mail_sent?: boolean; mail_error?: string | null }`.

- [ ] **Samm 1: loo `src/utils/formatDateTime.ts`**

```ts
/**
 * Kuupäev + kellaaeg eesti kujul.
 *
 * Eraldi utiliit, sest sama vorming on nüüd kolmes vaates (kasutajate loend,
 * kasutaja detail, registreerimistaotlused) ja koopiad lahknevad vaikselt.
 */
export function formatDateTime(isoString: string): string {
  return new Date(isoString).toLocaleDateString('et-EE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
```

- [ ] **Samm 2: loo `src/pages/admin/ResetPasswordResult.tsx`**

Tõsta `Users.tsx`-ist `resetResult && (…)` plokk (praegu read ~364–420)
muutmata kujul komponenti. Sisemine olek (`linkCopied`, `showResetLink`) ja
`copyResetLink` liiguvad kaasa — need on ainult selle kasti asi.

```tsx
/**
 * Parooli-taastamise lingi kast (#298, #318).
 *
 * Välja tõstetud, et sama kast töötaks nii kasutajate loendis kui detailis.
 * Saadetud kirja korral on link PEIDUS, mitte ära võetud: kiri võib maanduda
 * rämpsposti ja siis on link ainus tee.
 */
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, Copy, Mail, X } from 'lucide-react';

export interface ResetResult {
  username: string;
  name: string;
  reset_url: string;
  mail_sent?: boolean;
  mail_error?: string | null;
}

interface Props {
  result: ResetResult;
  onClose: () => void;
}

const ResetPasswordResult: React.FC<Props> = ({ result, onClose }) => {
  const { t } = useTranslation(['admin', 'common']);
  const [linkCopied, setLinkCopied] = useState(false);
  const [showResetLink, setShowResetLink] = useState(false);

  const copyResetLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}${result.reset_url}`);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  };

  // … (JSX täpselt nagu Users.tsx-is, `resetResult` → `result`,
  //     `setResetResult(null)` → `onClose`)
};

export default ResetPasswordResult;
```

- [ ] **Samm 3: ühenda `Users.tsx`-i**

`Users.tsx`-is: kustuta inline JSX, `linkCopied`, `showResetLink`,
`copyResetLink` ja `formatDate`; impordi uued moodulid; asenda kasutuskohad
(`<ResetPasswordResult result={resetResult} onClose={() => setResetResult(null)} />`
ja `formatDateTime(u.created_at)`). Kasutu jäänud lucide-ikoonide impordid
(`Copy`, `Mail`, `CheckCircle`) eemalda — muidu annab lint hoiatuse.

- [ ] **Samm 4: väravad**

Käsk: `npm run typecheck && npm test`
Oodatud: PASS. Vaata diff üle: käitumine ei tohi muutuda, ainult asukoht.

- [ ] **Samm 5: commit**

```bash
git add src/utils/formatDateTime.ts src/pages/admin/ResetPasswordResult.tsx src/pages/admin/Users.tsx
git commit -m "refactor(admin): parooli-taastamise kast ja kuupäevavorming eraldi mooduliteks (#318)"
```

---

### Task 6: `UserDetail.tsx` — kasutaja detailvaade

**Failid:**
- Loo: `src/pages/admin/UserDetail.tsx`
- Muuda: `src/App.tsx` (marsruut), `src/pages/admin/Users.tsx` (link kaardilt),
  `src/locales/et/admin.json`, `src/locales/en/admin.json`

**Liidesed:**
- Tarbib: `userRightsRows`, `addableAllowed`, `addableEdit`, `userRightsDelta`
  (Task 3); `saveAccessChanges` (Task 4); `accessChanges`, `SetRole`
  (`./workSetAccess`); `applyCollectionRights` (`../../services/collectionRightsService`);
  `listWorkSets`, `setWorkSetAccess` (`../../services/workSetService`);
  `ResetPasswordResult`, `formatDateTime` (Task 5).
- Toodab: marsruut `/admin/users/:username`.

- [ ] **Samm 1: lisa i18n võtmed MÕLEMASSE keelde**

`src/locales/et/admin.json` → `users` objekti sisse:

```json
"detail": {
  "back": "Kasutajad",
  "notFound": "Kasutajat ei leitud",
  "loadFailed": "Kasutaja andmete laadimine ebaõnnestus",
  "account": "Konto",
  "rightsTitle": "Kollektsiooniõigused",
  "rightsHint": "Lugemisõigus avab piiratud kogu teosed. Kirjutamisulatus piirab kaastöölise muutmisõigust ega anna lugemisõigust.",
  "readRight": "Lugemisõigus",
  "writeScope": "Kirjutamisulatus",
  "basisRoleBased": "rollist tulenev",
  "basisInert": "praegu ei mõju",
  "deletedCollection": "Kustutatud kollektsioon ({{id}})",
  "publicInert": "Praegu ei mõju: kogu on avalik",
  "inertScope": "Salvestatud ulatus ei piira: õigus rollist",
  "scopeWithoutRead": "Ulatus üksi ei ava selle piiratud kogu teoseid.",
  "addReadRight": "Lisa lugemisõigus",
  "noRights": "Salvestatud määranguid ei ole",
  "addRead": "+ lisa lugemisõigus",
  "addScope": "+ lisa kirjutamisulatus",
  "remove": "Eemalda",
  "sessionWarning": "Õiguste muutmisel peab kasutaja uuesti sisse logima.",
  "save": "Salvesta muudatused",
  "cancel": "Loobu",
  "saving": "Salvestan…",
  "saveFailed": "Õiguste salvestamine ebaõnnestus",
  "workSetsTitle": "Töökollektsioonid",
  "workSetsSaved": "Salvestatud: {{names}}",
  "workSetsFailed": "Salvestamata: {{names}}",
  "workSetsConflictHint": "Keegi muutis sama kogu vahepeal. Allolev olek on serverist uuesti laetud — vaata muudatus üle ja salvesta uuesti."
}
```

`src/locales/en/admin.json` → sama võtmestik inglise keeles (`"back": "Users"`,
`"notFound": "User not found"`, `"basisRoleBased": "from role"`,
`"basisInert": "no effect now"`, `"deletedCollection": "Deleted collection ({{id}})"`,
`"publicInert": "No effect now: the collection is public"`,
`"inertScope": "Saved scope does not restrict: right comes from role"`, jne).

Kontroll: `npx vitest run src/locales/__tests__/localeParity.test.ts`

- [ ] **Samm 2: kirjuta `UserDetail.tsx`**

```tsx
/**
 * Kasutaja detailvaade (#318, spekk §1).
 *
 * Konto toimingud ja KOLM õiguste telge ühes kohas. Kollektsiooniõigused
 * (lugemisõigus + kirjutamisulatus) salvestuvad ÜHE delta-paketina: üks
 * kirjutus `users.json`-i ja üks sessioonide invalideerimine inimese kohta.
 * Töökollektsioonid on eraldi failid oma `revision`-lukuga — need salvestuvad
 * kogu kaupa ja osaline edu on tavaline tulemus (spekk §5).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, KeyRound, Loader2, Trash2 } from 'lucide-react';
import Header from '../../components/Header';
import { useUser } from '../../contexts/UserContext';
import { useCollection } from '../../contexts/CollectionContext';
import { apiPost } from '../../services/apiClient';
import { applyCollectionRights } from '../../services/collectionRightsService';
import { listWorkSets, setWorkSetAccess, WorkSetSummary } from '../../services/workSetService';
import { assignableRoles, canManageUser, isAtLeast } from '../../utils/roleUtils';
import { getLangCode } from '../../utils/getLangCode';
import { formatDateTime } from '../../utils/formatDateTime';
import ResetPasswordResult, { ResetResult } from './ResetPasswordResult';
import { accessChanges, SetRole } from './workSetAccess';
import { saveAccessChanges } from './userWorkSetSave';
import {
  addableAllowed, addableEdit, CollectionInfo, userRightsDelta, userRightsRows,
  UserRightsState,
} from './userRightsDraft';

interface AdminUser {
  username: string;
  name: string;
  email: string;
  role: string;
  created_at: string | null;
  allowed_collections?: string[];
  edit_collections?: string[];
}

const klooni = (s: UserRightsState): UserRightsState =>
  ({ allowed: new Set(s.allowed), edit: new Set(s.edit) });

const UserDetail: React.FC = () => {
  const { t, i18n } = useTranslation(['admin', 'common']);
  const lang = getLangCode(i18n.language);
  const { username } = useParams<{ username: string }>();
  const { user, authToken, isLoading: userLoading } = useUser();
  const { collections } = useCollection();
  const navigate = useNavigate();

  const [target, setTarget] = useState<AdminUser | null>(null);
  const [laadin, setLaadin] = useState(true);
  const [viga, setViga] = useState<string | null>(null);
  const [laetud, setLaetud] = useState<UserRightsState | null>(null);
  const [mustand, setMustand] = useState<UserRightsState | null>(null);
  const [salvestan, setSalvestan] = useState(false);
  const [workSets, setWorkSets] = useState<WorkSetSummary[]>([]);
  const [wsMustand, setWsMustand] = useState<Record<string, SetRole | null>>({});
  const [wsSalvestan, setWsSalvestan] = useState(false);
  const [wsTulemus, setWsTulemus] = useState<{ saved: string[]; failed: string[] } | null>(null);
  const [resetResult, setResetResult] = useState<ResetResult | null>(null);
  const [kustutaKinnitus, setKustutaKinnitus] = useState(false);

  useEffect(() => {
    if (!userLoading && (!user || !isAtLeast(user.role, 'admin'))) navigate('/');
  }, [user, userLoading, navigate]);

  const wsNimi = useCallback(
    (ws: WorkSetSummary) => ws.name[lang] || ws.name.et || ws.name.en || ws.id, [lang]);

  const kogud = useMemo<Record<string, CollectionInfo>>(() => Object.fromEntries(
    Object.entries(collections).map(([id, c]) => [id, {
      id,
      name: c.name?.[lang] || c.name?.et || id,
      // `visibility` puudumine tähendab avalikku kogu — sama mis serveris
      // (`kogu.get("visibility") != "restricted"`).
      visibility: c.visibility === 'restricted' ? 'restricted' : 'public',
      isVirtual: c.type === 'virtual_group',
    }])), [collections, lang]);

  const lae = useCallback(async () => {
    if (!authToken || !username) return;
    setLaadin(true);
    setViga(null);
    try {
      const d = await apiPost<{ status: string; users?: AdminUser[] }>(
        '/admin/users', {}, { token: authToken });
      const leitud = (d.users || []).find(u => u.username === username) || null;
      setTarget(leitud);
      if (leitud) {
        const olek: UserRightsState = {
          allowed: new Set(leitud.allowed_collections || []),
          edit: new Set(leitud.edit_collections || []),
        };
        setLaetud(olek);
        setMustand(klooni(olek));
      }
      // Arhiveeritud kaasa: kasutajal võib olla õigus arhiivis kogule ja
      // selle vaikne peitmine teeks õiguse eemaldamise võimatuks.
      const ws = await listWorkSets(true);
      setWorkSets(ws);
      setWsMustand(Object.fromEntries(
        ws.map(s => [s.id, ((s.access || {})[username] as SetRole) ?? null])));
    } catch {
      // Laadimisviga EI tohi muutuda tühjaks õiguste kaardiks: tühja mustandi
      // salvestamine võtaks kõik õigused ära.
      setLaetud(null);
      setMustand(null);
      setViga(t('users.detail.loadFailed'));
    } finally {
      setLaadin(false);
    }
  }, [authToken, username, t]);

  useEffect(() => { lae(); }, [lae]);

  const delta = useMemo(
    () => (laetud && mustand && target ? userRightsDelta(laetud, mustand, target.username) : []),
    [laetud, mustand, target]);

  const read = useMemo(
    () => (mustand && target ? userRightsRows(mustand, kogud, target.role) : []),
    [mustand, kogud, target]);

  const lyliti = (id: string, field: 'allowed' | 'edit', peal: boolean) => {
    setMustand(prev => {
      if (!prev) return prev;
      const next = klooni(prev);
      if (peal) next[field].add(id); else next[field].delete(id);
      return next;
    });
  };

  const salvestaOigused = async () => {
    if (!mustand || !target || delta.length === 0) return;
    setSalvestan(true);
    setViga(null);
    try {
      const tulemus = await applyCollectionRights(delta);
      const kinnitatud = tulemus.users?.[target.username];
      // Kinnitatud olek tuleb SERVERILT, mitte optimistlikust oletusest.
      const uus: UserRightsState = kinnitatud
        ? { allowed: new Set(kinnitatud.allowed_collections),
            edit: new Set(kinnitatud.edit_collections) }
        : klooni(mustand);
      setLaetud(klooni(uus));
      setMustand(uus);
    } catch (e) {
      setViga((e as { message?: string }).message || t('users.detail.saveFailed'));
    } finally {
      setSalvestan(false);
    }
  };

  const salvestaKogud = async () => {
    if (!target) return;
    const muudatused = accessChanges(workSets, target.username, wsMustand);
    if (muudatused.length === 0) return;
    setWsSalvestan(true);
    setWsTulemus(null);
    const nimed = Object.fromEntries(workSets.map(ws => [ws.id, wsNimi(ws)]));
    const tulemus = await saveAccessChanges(
      muudatused, c => setWorkSetAccess(c.setId, c.access, c.revision));
    // Uus `revision` ja teiste vahepealsed muudatused tulevad serverilt:
    // mustand ehitatakse ALATI uuesti laetud kaardist (täieliku kaardi leping).
    const ws = await listWorkSets(true);
    setWorkSets(ws);
    setWsMustand(Object.fromEntries(
      ws.map(s => [s.id, ((s.access || {})[target.username] as SetRole) ?? null])));
    setWsTulemus({
      saved: tulemus.saved.map(id => nimed[id] || id),
      failed: tulemus.failed.map(f => nimed[f.setId] || f.setId),
    });
    setWsSalvestan(false);
  };

  const muudaRolli = async (uusRoll: string) => {
    if (!target) return;
    setViga(null);
    try {
      await apiPost('/admin/users/update-role',
        { username: target.username, new_role: uusRoll }, { token: authToken });
      // Roll muudab õiguste ALUSEID (toimetaja ulatus tuleb rollist), seega
      // laadime terve vaate uuesti, mitte ei paika ainult rollivälja.
      await lae();
    } catch (e) {
      setViga((e as { message?: string }).message || t('users.roleChangeError'));
    }
  };

  const taastaParool = async () => {
    if (!target) return;
    setViga(null);
    setResetResult(null);
    try {
      const d = await apiPost<{ status: string; reset_url?: string; username?: string;
        name?: string; mail_sent?: boolean; mail_error?: string | null; message?: string }>(
        '/admin/users/reset-password', { username: target.username }, { token: authToken });
      if (d.status === 'success' && d.reset_url) {
        setResetResult({
          username: d.username || target.username,
          name: d.name || target.name,
          reset_url: d.reset_url,
          mail_sent: d.mail_sent,
          mail_error: d.mail_error,
        });
      } else {
        setViga(d.message || t('users.resetError'));
      }
    } catch (e) {
      setViga((e as { message?: string }).message || t('users.resetError'));
    }
  };

  const kustuta = async () => {
    if (!target) return;
    setKustutaKinnitus(false);
    setViga(null);
    try {
      await apiPost('/admin/users/delete', { username: target.username }, { token: authToken });
      // Kustutatud kasutaja detaili ei ole enam olemas — mine loendisse tagasi,
      // muidu jääks ekraanile kirje, mida serveris ei ole.
      navigate('/admin/users');
    } catch (e) {
      setViga((e as { message?: string }).message || t('users.deleteError'));
    }
  };

  // … render: kolm kaarti (Konto / Kollektsiooniõigused / Töökollektsioonid)
};

export default UserDetail;
```

Renderduse nõuded (täida ülal olevate olekute põhjal):

- **Päis:** `<Header showSearchButton={false} pageTitle={target?.name || username} />`
  ja `<Link to="/admin/users">` tagasi, `max-w-5xl mx-auto px-4 py-8` konteiner
  (sama mis `Users.tsx`-is).
- **Konto kaart:** nimi, kasutajanimi (`font-mono`), e-post, `formatDateTime(created_at)`,
  rolli `<select>` `assignableRoles(user.role)` väärtustega — väljas, kui
  `!canManageUser(user.role, target.role)` või `target.username === user.username`;
  nupud „Taasta parool" (`KeyRound`) ja „Kustuta" (`Trash2`, kaheastmeline
  kinnitus `kustutaKinnitus`, iseennast kustutada ei saa). `resetResult`
  korral `<ResetPasswordResult result={resetResult} onClose={() => setResetResult(null)} />`.
- **Kollektsiooniõiguste kaart:** `read` read kahe märkeruuduga
  (`users.detail.readRight`, `users.detail.writeScope`). Märkeruut on väljas, kui
  `!canManageUser(user.role, target.role)` VÕI kui märkimata ruudu lisamine ei ole
  lubatud (`allowed`: kogu pole `restricted`; `edit`: `addableEdit` on tühi või
  kogu on virtuaalne). Aluse sildid: `role_based` → `users.detail.basisRoleBased`,
  `inert` → `users.detail.basisInert`. Kustutatud kogu rida kannab nime
  `t('users.detail.deletedCollection', { id })`. Avaliku kogu inertsel real
  lisaselgitus `users.detail.publicInert`; `role_based` ulatusel `users.detail.inertScope`.
  Kui real on `edit && !allowed` ja kogu on `restricted` ja `editBasis === 'assigned'`,
  näita `users.detail.scopeWithoutRead` + nupp `users.detail.addReadRight`, mis
  paneb `allowed` mustandisse (vaikselt seda EI lisata).
  Kaks lisamisvalikut (`<select>` nagu `Users.tsx`-is): `addableAllowed(kogud, mustand)`
  ja `addableEdit(kogud, mustand, target.role)`.
  Nupu kohal `users.detail.sessionWarning`, kui `delta.length > 0`.
  „Salvesta muudatused" / „Loobu" (`loobu` = `setMustand(klooni(laetud))`) on
  väljas, kui `delta.length === 0 || salvestan`.
- **Töökollektsioonide kaart:** iga `workSets` kirje kohta `<select>`
  (`workSets.none` / `workSets.viewer` / `workSets.manager`), väljas kui
  `!ws.can_manage || !canManageUser(user.role, target.role)`; arhiveeritud kogu
  nime järel `(t('workSets.statusArchived'))`. Selgitus `workSets.userAccessHint`.
  Eraldi „Salvesta muudatused" nupp (`salvestaKogud`), mis on väljas, kui
  `accessChanges(workSets, target.username, wsMustand).length === 0`.
  `wsTulemus` korral kaks rida: `users.detail.workSetsSaved` ja
  `users.detail.workSetsFailed` (ainult mittetühjad) + `users.detail.workSetsConflictHint`,
  kui midagi ebaõnnestus. **Sessioonihoiatust siia EI panda.**
- **Laadimine / vead:** `laadin` → spinner; `!target && !laadin` →
  `users.detail.notFound` + tagasilink; `viga` → punane kast ja
  õiguste kaardi puhul „Proovi uuesti" nupp (`lae`).

- [ ] **Samm 3: lisa marsruut**

`src/App.tsx`: laisk import ja marsruut TÄPSE loendi marsruudi järele.

```tsx
const AdminUserDetail = lazyRetry(() => import('./pages/admin/UserDetail'));
```

```tsx
  {
    path: "/admin/users/:username",
    element: <Lazy><AdminUserDetail /></Lazy>,
    errorElement: <RouteErrorBoundary />,
  },
```

- [ ] **Samm 4: lisa link loendi kaardilt**

`src/pages/admin/Users.tsx`: tee kaardi nimi lingiks detaili (kebab-menüü jääb
3a ajaks alles, et ükski toiming vahepeal ei kaoks):

```tsx
<Link to={`/admin/users/${u.username}`} className="font-medium text-gray-900 truncate hover:underline">
  {u.name}
</Link>
```

- [ ] **Samm 5: väravad**

Käsk: `npm run typecheck && npm test`
Oodatud: PASS (sh `localeParity` ja `translationKeysResolve`).

- [ ] **Samm 6: commit**

```bash
git add src/pages/admin/UserDetail.tsx src/App.tsx src/pages/admin/Users.tsx src/locales/et/admin.json src/locales/en/admin.json
git commit -m "feat(admin): kasutaja detailvaade kolme õiguste plokiga (#318)"
```

---

### Task 7: 3a väravad, käsitsi kontroll ja PR

- [ ] **Samm 1: kõik väravad**

```bash
npm run typecheck && npm test && npm run lint:ci && npm run build && .venv/bin/pytest tests/ -q
```

Oodatud: kõik PASS. `lint:ci` hoiatuste arv ei tohi tõusta (lävi 44).

- [ ] **Samm 2: käsitsi kontroll brauseris (`npm run dev`)**

Kontrolli adminina mõlemas keeles:
- [ ] Detail avaneb loendi nimelt; tagasilink viib loendisse.
- [ ] Contributorile lugemisõiguse lisamine + kirjutamisulatuse lisamine ÜHE
      salvestusega; enne salvestust on nähtav sessioonihoiatus.
- [ ] Avaliku kogu real on „praegu ei mõju" ja lugemisõigust ei pakuta lisada.
- [ ] Toimetaja real on kirjutamisulatus „rollist tulenev" ja selle eemaldamine
      õnnestub, ilma et ulatus tegelikult kaoks.
- [ ] Töökollektsiooni rolli muutmine salvestub eraldi nupuga; sessioon EI katke.
- [ ] Iseenda detailis ei saa rolli muuta ega kontot kustutada.
- [ ] Superadmini detail adminina: õiguste märkeruudud on väljas.

- [ ] **Samm 3: PR**

```bash
git push -u origin feat/kasutajate-detail-3a
gh pr create --base main --title "Kasutaja detailvaade ja viimase muudatuse endpoint (#318, etapp 3a)" --body "$(cat <<'BODY'
Etapp 3a spekist `docs/superpowers/specs/2026-09-14-kasutajad-ja-kogude-ligipaas-design.md` (§1).

- `GET /admin/users/activity`: viimane git-commit kasutaja kohta, TTL 300 s, üks logiläbimine threadpool'is (mõõdetud tootmises: 12 060 commiti ~0,13 s).
- `/admin/users/:username`: konto toimingud + kolm õiguste telge. Kollektsiooniõigused salvestuvad ÜHE delta-paketina (ADR 0043 p2), töökollektsioonid kogu kaupa `revision`-lukuga ja osalise eduga (spekk §5).
- Loend jääb selles PR-is alles ja saab lingi detaili — õiguste muutmine ei kao vahepeal tootmisest ära.

Väravad: typecheck, vitest, lint:ci, build, pytest.
BODY
)"
```

---

# Osa 3b — kompaktne nimekiri

### Task 8: haru ja `userListFilter.ts`

**Failid:**
- Loo: `src/pages/admin/userListFilter.ts`
- Test: `src/pages/admin/__tests__/userListFilter.test.ts`

**Liidesed:**
- Tarbib: `searchUsers` (`../../utils/userSearch`).
- Toodab: `ListUser`, `UserFilters`, `EMPTY_FILTERS`,
  `filterUsers(users, filters, workSetAccess)`,
  `filtersFromParams(params)`, `paramsFromFilters(filters)`.

- [ ] **Samm 1: loo haru (3a on merge'itud)**

```bash
git checkout main && git pull --ff-only && git checkout -b feat/kasutajate-loend-3b
```

- [ ] **Samm 2: kirjuta kukkuv test**

Fail `src/pages/admin/__tests__/userListFilter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTERS, filterUsers, filtersFromParams, ListUser, paramsFromFilters,
} from '../userListFilter';

const KASUTAJAD: ListUser[] = [
  { username: 'mati', name: 'Mati Jõgi', email: 'mati@ut.ee', role: 'contributor',
    allowed_collections: ['kinnine'], edit_collections: [] },
  { username: 'kati', name: 'Kati Kask', email: 'kati@ut.ee', role: 'editor',
    allowed_collections: [], edit_collections: ['kinnine'] },
  { username: 'juhan', name: 'Juhan Tamm', email: 'juhan@ut.ee', role: 'admin',
    allowed_collections: [], edit_collections: [] },
];

const KOGUD = { set1: { mati: 'viewer' } };

describe('filterUsers', () => {
  it('tühjad filtrid annavad kõik', () => {
    expect(filterUsers(KASUTAJAD, EMPTY_FILTERS, KOGUD)).toHaveLength(3);
  });

  it('rollifilter', () => {
    expect(filterUsers(KASUTAJAD, { ...EMPTY_FILTERS, role: 'editor' }, KOGUD)
      .map(u => u.username)).toEqual(['kati']);
  });

  it('kogu filter katab MÕLEMAD teljed', () => {
    // „Kellel on selle koguga seotud salvestatud määrang" — lugemisõigus VÕI
    // kirjutamisulatus. Ainult ühe telje vaatamine peidaks poole vastusest.
    expect(filterUsers(KASUTAJAD, { ...EMPTY_FILTERS, rightsCollection: 'kinnine' }, KOGUD)
      .map(u => u.username).sort()).toEqual(['kati', 'mati']);
  });

  it('töökollektsiooni filter', () => {
    expect(filterUsers(KASUTAJAD, { ...EMPTY_FILTERS, rightsWorkSet: 'set1' }, KOGUD)
      .map(u => u.username)).toEqual(['mati']);
    expect(filterUsers(KASUTAJAD, { ...EMPTY_FILTERS, rightsWorkSet: 'tundmatu' }, KOGUD))
      .toEqual([]);
  });

  it('otsing on diakriitikatundetu ja käib ka kasutajanime ning e-posti järgi', () => {
    expect(filterUsers(KASUTAJAD, { ...EMPTY_FILTERS, q: 'jogi' }, KOGUD)
      .map(u => u.username)).toEqual(['mati']);
    expect(filterUsers(KASUTAJAD, { ...EMPTY_FILTERS, q: 'kati@ut' }, KOGUD)
      .map(u => u.username)).toEqual(['kati']);
  });

  it('filtrid liituvad JA-ga', () => {
    expect(filterUsers(KASUTAJAD,
      { q: 'a', role: 'contributor', rightsCollection: 'kinnine', rightsWorkSet: 'set1' }, KOGUD)
      .map(u => u.username)).toEqual(['mati']);
  });
});

describe('URL-i teisendus', () => {
  it('tühi väärtus ei lähe URL-i', () => {
    expect(paramsFromFilters({ ...EMPTY_FILTERS, q: 'mati' })).toEqual({ q: 'mati' });
  });

  it('URL → filtrid → URL on stabiilne', () => {
    const p = new URLSearchParams({ q: 'mati', role: 'editor', rights_collection: 'kinnine' });
    const f = filtersFromParams(p);
    expect(f).toEqual({ q: 'mati', role: 'editor', rightsCollection: 'kinnine', rightsWorkSet: '' });
    expect(paramsFromFilters(f)).toEqual(
      { q: 'mati', role: 'editor', rights_collection: 'kinnine' });
  });

  it('tundmatu parameeter ei tühjenda loendit', () => {
    const f = filtersFromParams(new URLSearchParams({ collection: 'kinnine' }));
    expect(f).toEqual(EMPTY_FILTERS);
  });
});
```

- [ ] **Samm 3: käivita ja veendu, et kukub**

Käsk: `npx vitest run src/pages/admin/__tests__/userListFilter.test.ts`
Oodatud: FAIL — `Failed to resolve import "../userListFilter"`.

- [ ] **Samm 4: kirjuta teostus**

Fail `src/pages/admin/userListFilter.ts`:

```ts
/**
 * Kasutajate haldusloendi filtrid (#318, spekk §1).
 *
 * Need on HALDUSLOENDI filtrid, mitte koguvalik: `rights_collection` ja
 * `rights_work_set` ei muuda aktiivset kogu ega puutu `CollectionContext`-i
 * (ADR 0038). Puhas funktsioon, et URL-i ja tulemuse seos oleks testitav.
 */
import { searchUsers } from '../../utils/userSearch';

export interface ListUser {
  username: string;
  name: string;
  email: string;
  role: string;
  allowed_collections?: string[];
  edit_collections?: string[];
}

export interface UserFilters {
  q: string;
  role: string;             // '' = kõik rollid
  rightsCollection: string; // '' = kõik
  rightsWorkSet: string;    // '' = kõik
}

export const EMPTY_FILTERS: UserFilters = {
  q: '', role: '', rightsCollection: '', rightsWorkSet: '',
};

/**
 * @param workSetAccess kogu-ID → `access`-kaart (username → roll). Tundmatu
 *   kogu ID annab TÜHJA tulemuse, mitte filtri ärajätmise: „kogu, mida ei ole"
 *   ja „kõik kasutajad" on kaks eri asja (ADR 0042 sama loogika).
 */
export function filterUsers<T extends ListUser>(
  users: T[], f: UserFilters, workSetAccess: Record<string, Record<string, string>>,
): T[] {
  let out = users;
  if (f.role) out = out.filter(u => u.role === f.role);
  if (f.rightsCollection) {
    // Mõlemad teljed: „kellel on selle koguga seotud SALVESTATUD määrang".
    out = out.filter(u =>
      (u.allowed_collections || []).includes(f.rightsCollection)
      || (u.edit_collections || []).includes(f.rightsCollection));
  }
  if (f.rightsWorkSet) {
    const kaart = workSetAccess[f.rightsWorkSet] || {};
    out = out.filter(u => u.username in kaart);
  }
  return searchUsers(out, f.q);
}

/** URL → filtrid. Tundmatu parameeter jäetakse tähelepanuta. */
export function filtersFromParams(p: URLSearchParams): UserFilters {
  return {
    q: p.get('q') || '',
    role: p.get('role') || '',
    rightsCollection: p.get('rights_collection') || '',
    rightsWorkSet: p.get('rights_work_set') || '',
  };
}

/** Filtrid → URL. Tühi väärtus EI lähe URL-i, et jagatav link jääks puhtaks. */
export function paramsFromFilters(f: UserFilters): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.q) out.q = f.q;
  if (f.role) out.role = f.role;
  if (f.rightsCollection) out.rights_collection = f.rightsCollection;
  if (f.rightsWorkSet) out.rights_work_set = f.rightsWorkSet;
  return out;
}
```

- [ ] **Samm 5: käivita testid ja commit**

```bash
npx vitest run src/pages/admin/__tests__/userListFilter.test.ts
npm run typecheck && npm test
git add src/pages/admin/userListFilter.ts src/pages/admin/__tests__/userListFilter.test.ts
git commit -m "feat(admin): kasutajate haldusloendi filtrid (#318)"
```

---

### Task 9: `userActivityService.ts`

**Failid:**
- Loo: `src/services/userActivityService.ts`

**Liidesed:**
- Tarbib: `apiGet` (`./apiClient`), endpoint Task 2-st.
- Toodab: `getUserActivity(): Promise<Record<string, string>>`.

- [ ] **Samm 1: kirjuta teenus**

```ts
/**
 * Kasutajate viimane muudatus (#318, spekk §1).
 *
 * „Viimane muudatus" on git-commit, mitte viimane sisselogimine. Viga tõuseb
 * kutsujani: tühi kaart tähendaks „keegi ei ole midagi teinud" ja oleks
 * ebaõnnestunud laadimisest eristamatu.
 */
import { apiGet } from './apiClient';

export type UserActivity = Record<string, string>;

export async function getUserActivity(): Promise<UserActivity> {
  const d = await apiGet<{ status?: string; activity?: UserActivity }>(
    '/admin/users/activity', { useLocalStorageToken: true });
  return d.activity || {};
}
```

- [ ] **Samm 2: väravad ja commit**

```bash
npm run typecheck && npm test
git add src/services/userActivityService.ts
git commit -m "feat(admin): kasutajate aktiivsuse teenus (#318)"
```

---

### Task 10: `Users.tsx` → kompaktne nimekiri

**Failid:**
- Muuda: `src/pages/admin/Users.tsx` (loend, filtrid, klaviatuur, aktiivsus)
- Muuda: `src/locales/{et,en}/admin.json` (`users.list.*`)

**Liidesed:**
- Tarbib: `filterUsers`, `filtersFromParams`, `paramsFromFilters`, `EMPTY_FILTERS`
  (Task 8); `getUserActivity` (Task 9); `formatDateTime`, `listWorkSets`.

- [ ] **Samm 1: i18n võtmed MÕLEMASSE keelde**

`users` objekti sisse:

```json
"list": {
  "searchPlaceholder": "Otsi nime, kasutajanime või e-posti järgi",
  "allRoles": "Kõik rollid",
  "allCollections": "Kõik kollektsioonid",
  "allWorkSets": "Kõik töökollektsioonid",
  "lastChange": "Viimane muudatus",
  "noMatches": "Ükski kasutaja ei vasta filtritele",
  "clearFilters": "Tühjenda filtrid",
  "activityFailed": "Viimase muudatuse laadimine ebaõnnestus",
  "count": "{{shown}} / {{total}}"
}
```

- [ ] **Samm 2: kirjuta loend ümber**

Eemalda: `handleCollectionsChange`, `handleEditCollectionsChange`,
`handleWorkSetRoleChange`, `handleRoleChange`, `handleDeleteUser`,
`handleResetPassword`, `copyResetLink`, kebab-menüü, popover-loogika
(`popoverStyle`, `anchorRect`, `openMenu`, `deleteConfirm`) ja nende
kasutuseta jäävad impordid. Need toimingud elavad nüüd detailis (3a).

`listWorkSets(true)` jääb — töökollektsiooni filter vajab `access`-kaarte.

Uus tuum:

```tsx
const [searchParams, setSearchParams] = useSearchParams();
const filters = useMemo(() => filtersFromParams(searchParams), [searchParams]);
const [activity, setActivity] = useState<UserActivity | null>(null);
const [activityFailed, setActivityFailed] = useState(false);
const [aktiivneRida, setAktiivneRida] = useState(0);

// Admin-filtrid EI kutsu `useCollectionUrlSync`-i ega muuda aktiivset kogu
// (ADR 0038): need on haldusloendi filtrid, mitte koguvalik.
const seaFilter = (muutus: Partial<UserFilters>) => {
  setSearchParams(paramsFromFilters({ ...filters, ...muutus }), { replace: true });
  setAktiivneRida(0);
};

useEffect(() => {
  getUserActivity()
    .then(a => { setActivity(a); setActivityFailed(false); })
    // Aktiivsuse viga EI blokeeri kasutajahaldust ega tähenda tegevusetust:
    // kriips tähendaks „ei ole midagi teinud" ja oleks siin vale vastus.
    .catch(() => { setActivity(null); setActivityFailed(true); });
}, []);

const workSetAccess = useMemo(
  () => Object.fromEntries(workSets.map(ws => [ws.id, (ws.access || {}) as Record<string, string>])),
  [workSets]);

const nahtavad = useMemo(
  () => filterUsers(users, filters, workSetAccess), [users, filters, workSetAccess]);
```

Klaviatuur (otsinguväli saab algfookuse `autoFocus`):

```tsx
const klahv = (e: React.KeyboardEvent) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    setAktiivneRida(i => Math.min(i + 1, nahtavad.length - 1));
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    setAktiivneRida(i => Math.max(i - 1, 0));
  } else if (e.key === 'Enter' && nahtavad[aktiivneRida]) {
    navigate(`/admin/users/${nahtavad[aktiivneRida].username}`);
  }
};
```

Renderdus:
- Filtririba: otsinguväli (`autoFocus`, `onKeyDown={klahv}`), rolli `<select>`
  (`users.list.allRoles` + `ROLE_LEVELS` võtmed), kollektsiooni `<select>`
  (kõik kogud nime järgi), töökollektsiooni `<select>` (`workSets`),
  „Tühjenda filtrid" nupp, kui mõni filter on seatud. Loendur
  `t('users.list.count', { shown: nahtavad.length, total: users.length })`.
- Nimekiri: `<ul>` ridadega, iga rida `<Link to={/admin/users/${u.username}}>`,
  veerud: nimi (+ „sina" silt), kasutajanimi (`font-mono text-xs`), e-post, roll
  (`t('common:roles.'+u.role)`), viimane muudatus
  (`activity ? (activity[u.username] ? formatDateTime(activity[u.username]) : '—') : ''`).
  Aktiivne rida saab `ring-2 ring-primary-500`; kerib vaatesse
  (`ref` + `scrollIntoView({ block: 'nearest' })`).
- `activityFailed` → hoiatusriba `users.list.activityFailed` (loend renderdub edasi).
- `nahtavad.length === 0 && users.length > 0` → `users.list.noMatches` + „Tühjenda filtrid".
- Mobiil (~400 px): veerud pakitakse (`flex-wrap`), e-post ja viimane muudatus
  peidetakse `hidden sm:block` abil; horisontaalset kerimist ei teki.

- [ ] **Samm 3: väravad**

```bash
npm run typecheck && npm test
```

- [ ] **Samm 4: commit**

```bash
git add src/pages/admin/Users.tsx src/locales/et/admin.json src/locales/en/admin.json
git commit -m "feat(admin): kompaktne otsitav kasutajate nimekiri (#318)"
```

---

### Task 11: 3b väravad, dokumentatsioon ja PR

- [ ] **Samm 1: kontrolli, et vanu kirjutusteid enam ei kutsuta**

```bash
grep -rn "update-collections\|update-edit-collections" src/ || echo "kliendis puhas"
```

Oodatud: `kliendis puhas`. Serveri endpoint'id ja nende testid JÄÄVAD —
nende eemaldamine on eraldi otsus (vt „Teadlikult väljas").

- [ ] **Samm 2: kõik väravad**

```bash
npm run typecheck && npm test && npm run lint:ci && npm run build && .venv/bin/pytest tests/ -q
```

- [ ] **Samm 3: käsitsi kontroll brauseris (`npm run dev`)**

- [ ] Otsing „jogi" leiab „Jõgi"; otsinguväli saab algfookuse.
- [ ] Nool alla/üles + Enter avab detaili.
- [ ] Filtrid püsivad URL-is; detailist tagasi tulles on filter ja otsing alles.
- [ ] Kollektsiooni- ja töökollektsioonifilter EI muuda aktiivset kogu
      (kontrolli Dashboardi koguvalikut pärast filtri seadmist).
- [ ] Tühi tulemus annab selge teate ja „Tühjenda filtrid" töötab.
- [ ] „Viimane muudatus" näitab reaalset aega; kasutajal ilma commitideta kriips.
- [ ] Mõlemad keeled; ~400 px laius ilma horisontaalse kerimiseta.

- [ ] **Samm 4: uuenda ADR 0043 staatus**

`docs/decisions/0043-kogude-oiguste-uhised-toimingud.md` ja
`docs/decisions/README.md`: „1a, 1b, 2 ja 3 tootmises, 4 lahtine".

- [ ] **Samm 5: PR**

```bash
git push -u origin feat/kasutajate-loend-3b
gh pr create --base main --title "Kompaktne kasutajate nimekiri filtritega (#318, etapp 3b)" --body "$(cat <<'BODY'
Etapp 3b spekist (§1). Jätkab PR-i 3a.

- `/admin/users` on kompaktne nimekiri: diakriitikatundetu otsing, rolli-, kollektsiooni- ja töökollektsioonifilter URL-is (`q`, `role`, `rights_collection`, `rights_work_set`), klaviatuuritugi ja „viimane muudatus" veerg.
- Filtrid on haldusloendi filtrid: `useCollectionUrlSync`-i ei kutsuta ja aktiivne kogu ei muutu (ADR 0038).
- Inline õiguste toimetamine ja konto-kebab kadusid loendist — need elavad detailis (3a).
- Aktiivsuse laadimisviga ei blokeeri haldust ega kuvata kriipsuna.

Väravad: typecheck, vitest, lint:ci, build, pytest.
BODY
)"
```

---

## Teadlikult väljas

- **Pagineerimine** — spekk jätab selle välja; loend on filtreeritav.
- **`POST /admin/users/update-collections` ja `update-edit-collections`
  eemaldamine** — pärast 3b ei kutsu neid ükski klient, aga endpoint'i
  eemaldamine on eraldi otsus koos olemasolevate testidega. Etapp 4.
- **Etapp 4** — ühine „Kogud" sisenemiskoht, tüübifilter, vanade URL-ide
  suunamine (spekk §4).
- **Kaks lahtist pisiasja** seis-dokumendist
  (`2026-09-14-seis-ja-jatk.md`): „rollist tulenev" sildi ähmasus ja
  sessiooni aegumise eristamine 401 põhjal. Need on omaette väikesed PR-id
  ega kuulu ühessegi etappi.
- **Aktiivsuse ajajoon ja õiguste maatriks** — spekk §6 viimane lõik.
