# Refaktoreerimisplaan: `server/main.py` laialitõmbamine routeritesse

Kuupäev: 2026-06-25
Eesmärk: tõsta `server/main.py` (2 302 rida, 96 endpointi, 100 KB) domeenipõhistesse
FastAPI routeritesse, järgides `server/prosopography/` eeskuju. Tulemusena jääb
`main.py` ~150–200 reale (app + lifespan + routerite registreerimine + middleware).

---

## Kontekst ja taust

### Miks see kriitiline on

`main.py` on koodibaasi suurim hooldusrisk:
- 96 endpointi ühes failis, kuigi **enamuse äraloogika on juba eraldatud**
  ops-moodulitesse (`admin_page_ops.py`, `upload_ops.py`, `reocr_ops.py`,
  `trash_ops.py`, `registration.py`, `auth.py`).
- Endpointid onki peamiselt õhukesed proxy'd — tõstmine on suures osas mehaaniline.
- Iga uus featuur lisab `main.py`-sse juurde, ükski domeen ei väldi selle paisumist.

### Õige eeskuju: `server/prosopography/`

```
server/prosopography/
├── router.py        ← õhukesed endpointid (APIRouter)
├── ops.py           ← äraloogika
├── places_ops.py    ← alamdomeen
├── enrichment.py
└── work_relations_ops.py
```
`main.py` registreerib selle ühe reaga: `app.include_router(prosopography_router, prefix="/prosopography")`.

**Sama mustrit rakendame kõigile ülejäänud domeenidele.**

### Testikate on juba tugev (oluline parandus eelnevast hinnangust)

Backendis on **45 testifaili, 563 test funktsiooni** (`tests/` kataloogis juurkaustas,
mitte `server/tests/` all). See teeb refaktoreeringu **turvaliseks**: iga faasi järel
annab `pytest tests/` usaldusväärse tagasiside.

> Eelnevas koodibaasi ülevaates väideti ekslikult, et backendis on 0 testi. Vabandame.
> Tegelikult on katvus tugev — refaktoreering on palju madalama riskiga kui esialgu tundus.

### Sobitumine GitHub Issues süsteemi

Olemasolevad issues: #14–#31 (enamik tehtud). See refaktor saab uued issue-numbrid
(#32+), üks faas = üks PR = üks issue. Järgib sama töövoogu nagu #16 (sync_work_to_meilisearch)
ja #23 (unifitseeri Meilisearch kaardistus).

---

## Testidega seotud peamine risk (lahendatav)

`tests/conftest.py` `backend_env` fixture monkeypatchib `server.main` mooduli konstante:

```python
monkeypatch.setattr(main, "COLLECTIONS_FILE", str(collections_file))
monkeypatch.setattr(main, "ARCHIVES_FILE", str(archives_file))
monkeypatch.setattr(main, "USER_SETTINGS_DIR", str(user_settings_dir))
monkeypatch.setattr(main, "UPLOADS_DIR", str(uploads_dir))
monkeypatch.setattr(main, "invalidate_cache", lambda: None)
```

**Probleem:** kui collections/user_settings endpointid tõstetakse `routers/collections.py`-sse,
siis see fail teeb `from ..config import COLLECTIONS_FILE` oma nimeruumi — ja `main`-i
monkeypatch enam ei mõjuta seda. **Testid katkevad vaikselt.**

**Lahendus (Faas 0-s):** lisada conftesti üldine helper, mis patchib konstandi kõikides
moodulites, kuhu see imporditakse. Samamoodi tehakse juba `upload_ops` jaoks
(`monkeypatch.setattr(upload_ops, "UPLOADS_DIR", ...)`). Iga uus router lisab lihtsalt oma
nime sellele helperile.

Samuti: `_validate_base_names` on imporditud `from server.main import ...` 10 testis.
Tõstetakse `admin_page_ops.py`-sse (loomulik kodu); hoida backward-compat re-eksport
`main.py`-s seniksuks, kuni testid uuendatakse (või uuendada kohe).

---

## Lõplik domeenijaotus (96 endpointi → 10–12 routerit)

| Domeen / router | Endpointe | Ops moodul (olemas?) | Abifunktsioonid (loetakse kaasa) | Risk |
|---|---|---|---|---|
| **auth** | 13 | `auth.py` ✅, `registration.py` ✅ | `get_user`, `require_role`, `get_json_data`, `_get_optional_user` → `deps.py` | madal |
| **notifications** | 5 | uus: `notifications_ops.py` | `_load/_save/_append/_create_notification`, `_find_username_by_display_name`, `_notifications_lock` | madal |
| **upload** | 10 | `upload_ops.py` ✅ | — | madal (mehaaniline) |
| **reocr** | 7 | `reocr_ops.py` ✅ | — | madal (mehaaniline) |
| **pages** (admin) | 11 | `admin_page_ops.py` ✅ | `_validate_base_names` → `admin_page_ops` | madal |
| **user_settings** | 4 | uus: `user_settings_ops.py` (väike) | `_get/_load/_save_user_settings` | **keskmine** (monkeypatch) |
| **collections + config** | ~12 | cache ✅, config ✅ | `_find_works_with_collection/archive`, `_cleanup_allowed_collections_on_delete` | **keskmine** (monkeypatch) |
| **public/SEO** | ~8 | `metadata_handler.py` ✅ | `_load_work_metadata`, `_sitemap_cache`, `_invalidate_all_caches` | keskmine (jagatud helperid) |
| **admin_users** (registrations, users, trash, git-health, work-delete) | ~10 | `trash_ops.py` ✅, `auth.py` ✅, `registration.py` ✅ | — | madal |
| **save** | 1 (mahukas) | `marginalia_normalize.py` ✅ | — | keskmine |
| **metadata + git_history + bulk** | 7 | `metadata_ops.py` ✅, `git_ops.py` ✅ | `_read_work_meta_direct_sync` | madal–keskmine |

**Jagatud helperid, mis ei kuulu ühele domeenile** (üksikasjad allpool): need tõstetakse
sobivasse ühismoodulisse Faasis 0 või 6.

---

## Teostus: 8 faasi (igaüks eraldi PR + issue)

Iga faas on **iseseisev ja deploydatav**. Pärast iga faasi: `pytest tests/` + manuaalne
smoke test + commit. Faasid on tellitult riskikasvavad: madala riskiga mehaanilised
tõstmised esimesena, jagatud helperitega domeenid viimasena.

### Faas 0 — Vundament (ühine deps moodul + conftest uuendus)

**Eesmärk:** luua alus, mis muudab kõik järgnevad faasid turvaliseks ja eemaldab olemasoleva
duplikaadi.

1. Loo `server/deps.py`:
   ```python
   async def get_user(request, min_role="contributor"): ...
   def require_role(role): ...
   async def get_json_data(request): ...
   async def optional_user(request): ...   # endine _get_optional_user
   ```

2. **Eemalda duplikaat** `server/prosopography/router.py`-st: praegu on seal privaatne
   `_get_user` ja `_optional_user`, mis on peaaegu identsed `main.py` omadega (üks erinevus:
   prosopography versioon loeb tokenit ka JSON body-st). Ühenda üheks `deps.py`-ks, mis
   toetab mõlemat kanalit (header + query + JSON body). Testi, et prosopography endpointid
   ikka töötavad.

3. Loo `server/routers/__init__.py` (tühi pakett).

4. **Uuenda `tests/conftest.py`:** lisa helper, mis patchib konstandi kõigis antud
   moodulites. Näiteks:
   ```python
   def patch_config_const(monkeypatch, name, value, modules):
       for mod in modules:
           importlib.import_module(mod)  # tagab, et import on toimunud
           monkeypatch.setattr(mod, name, value, raising=False)
   ```
   ja uuenda `backend_env`-i seda kasutama (esialjasse kuuluvad `main`, `upload_ops`).
   Tulevased faasid lisavad oma moodulid lihtsalt juurde.

5. Loo `server/work_meta.py` (või lisa `utils.py`-sse): `_load_work_metadata`,
   `_read_work_meta_direct_sync` — neid kasutavad nii public/SEO, collections, download,
   shareable, viewer-token. Ühine kodu väldib korduvat importimist.
   Hoia backward-compat re-eksport `main.py`-s.

6. Tõsta `_validate_base_names` `admin_page_ops.py`-sse (loomulik kodu, kuna valideerib
   page base_names). Hoia `main.py`-s `from .admin_page_ops import _validate_base_names`
   (backward-compat), et 10 testi ei katkeks.

**Valideerimine:** `pytest tests/` roheline; prosopography endpointid toimivad; manual
login + ühe teose avamine.

**Hinnang:** ~0,5 päeva. **Suurim võit:** ühine auth-dep ja conftest infra on valmis kõigile
järgnevatele faasidele.

---

### Faas 1 — Notifications (suurim võit, kõige iseseisvam domeen)

**Eesmärk:** eraldada täiesti suletud domeen (5 endpointi + 7 abifunktsiooni + lukk).

1. Loo `server/notifications_ops.py` — kogu notifications äraloogika:
   - `_notifications_lock`, `_safe_username`, `_get_notifications_path`
   - `_load_notifications`, `_save_notifications`, `_append_notifications`
   - `_create_notification`, `_find_username_by_display_name`
   - Nendest tee avalikud funktsioonid (eemalda `_` eesliides, kus mõistlik).

2. Loo `server/routers/notifications.py` (`APIRouter`):
   - `POST /page-comments/reply`
   - `GET /notifications`
   - `GET /notification-recipients`
   - `POST /notifications/send`
   - `POST /notifications/{notification_id}/read`

3. `main.py`: `app.include_router(notifications_router)`.

**Valideerimine:** `pytest tests/` (kui notifications jaoks on teste — kontrolli); manuaalne
kommentaari vastamine + teavituse saatmine.

**Hinnang:** ~0,5 päeva. **Võit:** `-~280 rida main.py`-st, domeenist saab iseseisev moodul,
mida saab testida ja arendada eraldi.

---

### Faas 2 — Upload + Re-OCR (mehaaniline, ops juba eraldatud)

**Eesmärk:** kaks õhukeste endpointide rühma, mille äraloogika on juba ops-moodulites.

1. Loo `server/routers/upload.py` (10 endpointi, kõik `/admin/upload/*` ja `/admin/uploads`).
2. Loo `server/routers/reocr.py` (7 endpointi, kõik `/admin/reocr/*` ja `/admin/work/{work_id}/reocr-*`).
3. `main.py`: include mõlemad routerid.

**Valideerimine:** `pytest tests/` (on olemas `test_reocr_*`, `test_upload_*`, `test_add_pages`
jt — tugev katvus); manuaalne upload-wizard läbimäng.

**Hinnang:** ~0,5 päeva. **Võit:** `-~350 rida`. **Madal risk**, sest endpointid on proxy'd.

---

### Faas 3 — Pages admin (mehaaniline)

**Eesmärk:** lehekülgede haldusdomeen (suurim endpointide rühm).

1. Loo `server/routers/pages.py` (11 endpointi, kõik `/admin/work/{work_id}/*page*`):
   - pages (GET), delete-page, delete-pages, replace-image, add-page, add-pages,
     split, transform, reorder, page-ocr (GET+DELETE).
2. Eemalda `_validate_base_names` backward-compat import (kui Faas 0 lisas) — uuenda
   teste importima `from server.admin_page_ops import _validate_base_names`.
3. `main.py`: include router.

**Valideerimine:** `pytest tests/` (`test_delete_pages*`, `test_add_pages`, `test_split_page`,
`test_transform_page`, `test_allocate_sequences` jt — väga tugev katvus).

**Hinnang:** ~0,5 päeva. **Võit:** `-~400 rida`. **Madal risk.**

---

### Faas 4 — Auth + registreerimine

**Eesmärk:** auth, meili-tokenid, registreerimine, invite.

1. Loo `server/routers/auth.py` (13 endpointi):
   - `/login`, `/verify-token`, `/logout`, `/api/meili-token*` (2)
   - `/register*` (2), `/invite/*` (2).
2. `main.py`: include router.

**Valideerimine:** `pytest tests/` (`test_login_throttle`, `test_auth_password`,
`test_session_invalidation`, `test_registration_username` — tugev katvus).

**Hinnang:** ~0,5 päeva. **Võit:** `-~250 rida`.

---

### Faas 5 — Admin haldus (registrations, users, trash, git-health, work-delete)

**Eesmärk:** admin vood, mis ei kuulu teistesse domeenidesse.

1. Loo `server/routers/admin.py` (~10 endpointi):
   - `/admin/registrations*` (3), `/admin/users*` (3)
   - `/admin/people-refresh*` (2)
   - `/admin/git-failures`, `/admin/git-health`
   - `/admin/trash*` (2), `/admin/work/{work_id}/trash-pages*` (2)
   - `/admin/work/{work_id}` DELETE (work delete — mahukas, aga iseseisev).
2. `main.py`: include router.

**Valideerimine:** `pytest tests/` (`test_trash_ops`, `test_work_collections`,
`test_session_invalidation` — tugev katvus).

**Hinnang:** ~0,5–1 päev. **Võit:** `-~300 rida`.

---

### Faas 6 — Collections + config + user_settings + public/SEO (kõrgem risk)

> **See on kõige keerukam faas** monkeypatchimise ja jagatud helperite tõttu. Soovitatav
> teha pärast Faasi 0 conftest-infra usaldusväärset valideerimist.

**Jagatud helperid, mis vajavad ühist kodu:**
- `_invalidate_all_caches`, `_sitemap_cache` → laienda `server/cache.py` või uus
  `server/cache_helpers.py`.
- `_load_work_metadata`, `_read_work_meta_direct_sync` → `server/work_meta.py` (Faasis 0 loodud).
- `_find_works_with_collection`, `_find_works_with_archive`,
  `_cleanup_allowed_collections_on_delete` → `server/routers/collections.py` privaatsetena.

1. Loo `server/routers/collections.py` (~12 endpointi): `/collections`, `/config/archives*` (4),
   `/admin/collections*` (5).
2. Loo `server/routers/user_settings.py` (4 endpointi) + `server/user_settings_ops.py`
   (`_load/_save_user_settings`).
3. Loo `server/routers/public.py` (~8 endpointi): `/vocabularies`, `/people-aliases`,
   `/people-register`, `/entity-labels`, `/admin/refresh-entity-labels`,
   `/admin/enrich-page-tag-labels`, `/work/{work_id}/shareable`, `/work/{work_id}/viewer-token`,
   `/meta/*` (3), `/sitemap.xml`, `/health`, `/download/{work_id}`.
4. **Uuenda `tests/conftest.py`:** lisa kõik uued moodulid `patch_config_const` helperisse
   (`COLLECTIONS_FILE`, `ARCHIVES_FILE`, `USER_SETTINGS_DIR` jaoks).
5. `main.py`: include kõik routerid.

**Valideerimine:** `pytest tests/` (`test_work_collections`, `test_viewer_token`,
`test_work_titles_endpoint`, `test_metadata_handler`, `test_backend_smoke` — hoolikalt,
kuna monkeypatch-muudatused on siin kõige tundlikumad). Manuaalne: kollektsiooni loomine/
kustutamine, arhiivi CRUD, user settings salvestamine, sitemap.xml, download.

**Hinnang:** ~1–1,5 päeva. **Võit:** `-~600 rida`. **Kõrgem risk** — hoolas testimine.

---

### Faas 7 — Save + metadata + git history + bulk

**Eesmärk:** viimane jaotus, toimetamise tuum.

1. Loo `server/routers/save.py`: `POST /save` (üks endpoint, aga mahukas — ligi 50 rida
   äriloogikat). Hoiab `normalize_marginalia_tags` + `can_write_work` kontrolli.
2. Loo `server/routers/metadata.py`: `POST /update-work-metadata`, `/get-work-metadata`,
   `/get-metadata-suggestions`.
3. Loo `server/routers/git_history.py`: `/recent-edits`, `/git-history`, `/commit-diff`,
   `/git-restore`, `/works/bulk-collection`, `/works/bulk-tags`, `/works/bulk-genre`.
4. `main.py`: include kõik routerid.

**Valideerimine:** `pytest tests/` (`test_marginalia_normalize`, `test_bulk_atomicity`,
`test_work_lock` jt). Manuaalne: salvestamine, git restore, bulk collection muudatus.

**Hinnang:** ~1 päev. **Võit:** `-~450 rida`.

---

## Lõpptulemus

`server/main.py` pärast kõiki faase (~150–200 rida):

```python
# Impordid
from .config import ...
from .deps import get_user, require_role, get_json_data  # (backward-compat)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # build_work_id_cache, run_git_fsck, daemon threads
    ...

app = FastAPI(title="VUTT API", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, ...)

# Routerite registreerimine
app.include_router(prosopography_router, prefix="/prosopography")
app.include_router(auth_router)
app.include_router(notifications_router)
app.include_router(upload_router)
app.include_router(reocr_router)
app.include_router(pages_router)
app.include_router(admin_router)
app.include_router(collections_router)
app.include_router(user_settings_router)
app.include_router(public_router)
app.include_router(save_router)
app.include_router(metadata_router)
app.include_router(git_history_router)
```

**Kokku: 2 302 → ~180 rida.** Iga domeen on iseseisev moodul, testitav eraldi, arendatav
ilma `main.py`-d puudutamata.

---

## Struktuur pärast refaktoreeringut

```
server/
├── main.py                 # ~180 rida: app, lifespan, routerite registreerimine
├── deps.py                 # auth dependencies (ühine)
├── work_meta.py            # _load_work_metadata, _read_work_meta_direct_sync
├── cache_helpers.py        # _invalidate_all_caches, _sitemap_cache (või laienda cache.py)
├── routers/
│   ├── __init__.py
│   ├── auth.py             # login, register, invite, meili-token
│   ├── notifications.py
│   ├── upload.py
│   ├── reocr.py
│   ├── pages.py            # admin page management
│   ├── admin.py            # registrations, users, trash, git-health, work-delete
│   ├── collections.py      # + archives config
│   ├── user_settings.py
│   ├── public.py           # vocabularies, people, entity-labels, SEO/meta, sitemap, download
│   ├── save.py
│   ├── metadata.py
│   └── git_history.py      # + bulk operations
├── [olemasolevad ops moodulid: admin_page_ops, upload_ops, reocr_ops, trash_ops,
│    registration, auth, cache, config, git_ops, meilisearch_ops, people_ops,
│    marginalia_normalize, metadata_handler, metadata_ops, utils, ...]
├── notifications_ops.py    # uus (Faas 1)
├── user_settings_ops.py    # uus (Faas 6)
└── prosopography/          # olemasolev (eeskuju)
```

---

## Turvameetmed (iga faasi jaoks)

1. **Üks faas = üks branch = üks PR = üks GitHub issue.** Mitte kunagi mitu faasi ühes PR-is.
2. **Enne iga faasi:** `pytest tests/` → dokumenteeri baasjoon (X testi läheb läbi).
3. **Pärast iga faasi:** `pytest tests/` → sama arv (või rohkem) testi läheb läbi.
4. **Backward-compat import** `main.py`-st kõigepealt; eemalda alles siis, kui kõik viited
   uuendatud (nt `_validate_base_names`, `_load_work_metadata`).
5. **Manual smoke test** pärast iga faasi: login → teose avamine → salvestamine → üks
   domeenipõhine voog.
6. **Ei muudeta käitumist** — see on puhas struktuuriline refaktoreering. Kui leiad bugi
   tõstmise käigus, tee eraldi issue, ära paranda samas PR-is.
7. **Re-eksportide auditeerimine** lõpus: pärast Faasi 7 otsida `from server.main import`
   kogu koodibaasis ja testides, et tagada, et backward-compat kihist saab lahti.

---

## Soovituslik järjekord ja ajakulu

| Faas | Sisu | Hinnang | Risk | Tasuvus |
|---|---|---|---|---|
| 0 | deps + conftest infra + work_meta | 0,5 päeva | madal | kõrge (vundament) |
| 1 | notifications | 0,5 päeva | madal | kõrge (suletud domeen) |
| 2 | upload + reocr | 0,5 päeva | madal | kõrge (mehaaniline) |
| 3 | pages admin | 0,5 päeva | madal | kõrge (suurim rühm) |
| 4 | auth + registreerimine | 0,5 päeva | madal | keskmine |
| 5 | admin haldus | 0,5–1 päeva | madal | keskmine |
| 6 | collections + config + public/SEO | 1–1,5 päeva | **keskmine/kõrge** | kõrge |
| 7 | save + metadata + git history | 1 päev | keskmine | keskmine |
| **Kokku** | | **~5–6 päeva** | | |

**Soovitus:** alusta Faasist 0–3 (kõrge tasuvus, madal risk). Pärast Faasi 3 on `main.py`
juba poole väiksem (~1 000 rida) ja kõige raskemad domeenid on eemaldatud. Faasid 4–7
võib teha lõdvalt, ükshaaval, ilma surveta.

---

## Kontrollkäsud

```bash
# main.py suurus refaktoreeringu käigus
wc -l server/main.py

# Endpointide jaotus domeenide kaupa (peab vähenema main.py-s)
grep -cE "@app\.(get|post|put|delete|patch)" server/main.py

# Testid (baasjoon enne refaktoreeringut)
pytest tests/ -q 2>&1 | tail -5

# Backward-compat importide auditeerimine lõpus
grep -rn "from server.main import" tests/ src/ server/

# Re-ekspordid mida saaks eemaldada pärast viimast faasi
grep -n "^from \." server/main.py | grep "import _"
```

---

## Seosed teiste olemasolevate/refaktoreerimata aladega

- See refaktor **ei puuduta** ops-moodulite sisu (`admin_page_ops.py`, `upload_ops.py` jne) —
  ainult endpointide tõstmine. Ops-moodulite sisemine refaktoreering (nt issue #17
  `save_and_transfer_to_ocr`) jääb eraldiseisvaks ja võib toimuda paralleelselt.
- **Ei lahenda** frontendi legacy võlka (issue #18 `crossLang*Map`, `PersonsPage` URL
  dual-loogika) — see on eraldi teema.
- Pärast refaktoreeringut muutub `prosopography/` ja teiste ops-moodulite juurde uute
  domeenide lisamine **triviaalseks** — lihtsalt uus `routers/x.py` + `include_router`.
