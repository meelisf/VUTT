# VUTT koodibaasi ülevaade: turvalisus, jõudlus, hallatavus

Kuupäev: 2026-06-28

Eesmärk: koondada järgmised soovitatavad sammud pärast `server/main.py` refaktorit. Fookus on tervel rakendusel: FastAPI backend, React/TypeScript frontend, Meilisearch, nginx/deploy ja testid.

## Lühikokkuvõte

`main.py` refaktor on õnnestunud: fail on nüüd väike app-koostaja (~118 rida) ja domeenid on routeritesse ja ops-moodulitesse jaotatud. Järgmine suurim võit ei ole enam `main.py`, vaid:

1. **Turvalisus:** sessioonide/tokenite mudel, välised proxy'd/rate-limitid, uploadide failipiirangud, HTML renderdamise poliitika.
2. **Optimeerimine:** suurte frontend-lehtede ja otsingu päringumustri lihtsustamine, Meilisearch-päringute koondamine/cache, backend I/O ja taustatööde kontrollitud järjekorrad.
3. **Loetavus/hallatavus:** kõige suuremad failid (`upload_ops.py`, `prosopography/ops.py`, `Upload.tsx`, `TextEditor.tsx`, `WorkManage.tsx`, `Dashboard.tsx`) väiksemateks domeenideks; ühtne API klient frontendile; lint/format/typecheck CI.

---

## Prioriteetne tegevusplaan

### P0 — teha enne suuremaid uusi featuure

| Teema | Miks | Soovitus |
|---|---|---|
| `/meili/` ja `/api/images/` rate-limit live-kontroll | Avalik otsing ja pildid on kõige lihtsam DoS/kraapimise pind | Viia lõpuni `docs/security_review_2026-06-09.md` M1/M2: dedicated nginx limit zone, helde burst, live-test devtoolsiga |
| Frontendi XSS/HTML renderdamise inventuur | `dangerouslySetInnerHTML` on sihilikult kasutusel, aga vajab keskset poliitikat | Luba ainult 2 teed: `sanitizeHighlight()` otsinguhighlightideks ja staatilised trusted HTML failid. Lisa lint/grep-test, mis keelab uued kasutused ilma põhjenduseta |
| Uploadi failisuuruse ja pildide decompression bomb piirang | Admin-only, kuid kõige kallim sisend CPU/mälu mõttes | Lisa backendis max PDF/image size, Pillow `MAX_IMAGE_PIXELS`, magic-byte järel mõõtmete kontroll; nginx `client_max_body_size` dokumenteerida |
| Auth-token localStorage risk | XSS korral võetakse token üle | Hinnata üleminekut HttpOnly SameSite Secure cookie sessioonile või vähemalt lühem access-token + serveripoolne sessioon; säilitada Bearer ajutise ühilduvusena |
| Automaatne kvaliteedivärav | Praegu on testid head, aga lint/format pole standardiseeritud | Lisa CI-sse: `npm run typecheck`, `npm test`, `npm run build`, `pytest tests/`; lisada ESLint + Python ruff järk-järgult |

### P1 — järgmine refaktori laine

| Fail / ala | Praegune risk | Soovitus |
|---|---|---|
| `server/prosopography/ops.py` (~1933 rida) | Palju eri vastutusi ühes moodulis | Jaota: `person_crud.py`, `person_search.py`, `relations.py`, `indices.py`, `merge_ops.py`, `git_history.py` |
| `server/upload_ops.py` (~1638 rida) | Staging, SFTP, PDF/image, import, polling ühes failis | Jaota: `upload_state.py`, `ocr_client.py`, `file_detection.py`, `import_work.py`, `thumbs.py` |
| `src/pages/Upload.tsx` (~1406 rida) | UI olekumasin + API + render samas failis | Tee `useUploadWizard`, `UploadStepMeta`, `UploadStepTransfer`, `UploadStepReview`, `uploadApi.ts` |
| `src/components/TextEditor.tsx` (~1377 rida) | Editorikäitumine, copy/paste, save, toolbar, layout koos | Eralda hooks: `useEditorState`, `useEditorSave`, `useCopyPastePlainMarkup`, `EditorToolbar`, `EditorStatusBar` |
| `src/pages/Dashboard.tsx`, `WorkManage.tsx` | Bulk-toimingud ja API korduvad | Ühtne `workApi.ts` + väiksemad komponendid; bulk ops utiliit/service |
| Frontendi API-kutsed | Tokeni lugemine ja `fetch` kordub paljudes failides | Keskne `apiClient.ts`: JSON parsing, timeout, auth header, 401 käsitlus, veateated |

### P2 — jõudlus ja opereeritavus

| Teema | Soovitus |
|---|---|
| Meilisearch päringute arv | Mõõda brauseri Networkis dashboard/search/work avamine; koonda facet/suggestion päringuid, lisa debounce ja AbortController otsingule |
| Frontendi bundle | Lazy-loading on olemas; lisa `vite build --report` või visualizer, kontrolli suuri chunk'e (`Upload`, `Admin`, `leaflet`, `recharts`) |
| Backend taustalõimed | Dokumenteeri kõik daemonid ühes failis; lisa health/status endpoint taustatööde viimase õnnestumise ajaga |
| Observability | Lisa struktureeritud request-id logidesse; erista auth/audit logid; kaaluda `/metrics` hiljem |
| Cache invalidation | Cache'id on olemas, kuid hajuvad | Koonda cache registriks: nimi, TTL, invalidation triggerid; tee admin maintenance lehele cache clear/status |

---

## Turvalisuse soovitused

### 1. Sessioonid ja tokenid

Praegu hoiab frontend `vutt_token` localStorage'is ja saadab `Authorization: Bearer`. See on SPA-des tavaline, kuid XSS korral on token otse loetav.

Soovitus:
- eelistatud siht: HttpOnly + Secure + SameSite=Lax/Strict cookie põhine sessioon;
- CSRF kaitse kirjutavatele endpointidele, kui cookie kasutusele tuleb;
- üleminekuperioodil toetada nii Bearer kui cookie;
- `verify-token` ja refresh endpointidele rate-limit;
- admin-toimingutele audit log: kes, millal, milline teos/isik, enne/pärast olulisemad väljad.

### 2. HTML renderdamine frontendil

Leitud kasutused on valdavalt põhjendatud (Meili highlightid, staatiline about HTML), kuid risk vajab protsessilist kontrolli.

Soovitus:
- keskne wrapper-komponent nt `<SafeHtml kind="highlight" html={...} />`;
- kõik highlightid käivad `sanitizeHighlight()` kaudu;
- staatilised HTML failid märgistada trusted allikana ja mitte segada kasutajasisuga;
- lisada test/grep, mis ebaõnnestub uue `dangerouslySetInnerHTML` lisamisel ilma whitelistita.

### 3. Avalikud proxy'd ja rate-limitid

Jätkata eelmisest security review'st:
- `/meili/`: dedicated rate-limit zone, vajadusel eemaldada kliendi `Authorization` headeri edastus;
- `/api/images/`: helde rate-limit + vähemalt kuritarvituse nähtav logimine;
- Wikidata/VIAF/GND proxy'dele timeoutid, rate-limitid ja võimalusel lühike cache.

### 4. Faili- ja teerajaturvalisus

Juba on tehtud slug/upload_id/person_id kontrollid. Järgmine kiht:
- upload body max suurus nginxis ja backendis;
- PDF lehekülgede max arv;
- image max megapikslid ja Pillow decompression bomb kaitse;
- kõik filesystem path join'id läbi ühe helperi `safe_join_under(base, *parts)`.

---

## Optimeerimise soovitused

### Backend

- Failipõhiste read-modify-write operatsioonide jaoks kasutada domeenipõhiseid lukke järjekindlalt (`work_id`, `person_id`, config-failid).
- Meilisearch sync on juba async; lisada queue pikkuse ja viimase vea nähtavus.
- Admin/import bulk operatsioonides eelistada batch-commit ja batch-index strateegiat, kus kasutajakogemus seda lubab.
- Väliste HTTP/SFTP operatsioonide timeoutid teha ühtseks konfigiks.

### Frontend

- Lisada otsingus debounce + päringute tühistamine (`AbortController`), et kiire filtrite klõpsimine ei jätaks vanu vastuseid võistlema.
- Koondada sama lehe mitu sõltuvat API päringut custom hookidesse, kus on loading/error/cache ühes kohas.
- Virtualiseerida pikad nimekirjad, kui admin/otsingu/registrite vaadetes hakkab DOM suureks minema.
- Suurte modaalide ja admin-vaadete lazy import jätkata komponentide tasemel, mitte ainult route tasemel.

---

## Loetavuse ja hallatavuse soovitused

### Backend struktuur

Hea sihtmuster iga domeeni jaoks:

```text
server/<domain>/
├── router.py        # HTTP, request/response, Depends
├── service.py       # äriloogika / use-case'id
├── repository.py    # failisüsteem, Meili, git, välised API-d
├── schemas.py       # Pydantic mudelid
└── tests...
```

Kõiki domeene pole vaja kohe ümber tõsta, aga uued suured domeenid võiksid seda mustrit järgida. Routerid peaksid jääma õhukeseks.

### Frontend struktuur

Soovitatav muster suurtele lehtedele:

```text
src/pages/upload/
├── UploadPage.tsx
├── uploadApi.ts
├── useUploadWizard.ts
├── components/
└── types.ts
```

Eesmärk: page-fail orkestreerib, hooks hoiavad olekut, `services/*Api.ts` teeb võrgukutsed, komponendid renderdavad.

### TypeScript rangus

Praegu on palju `any` kasutusi Meilisearchi ja väliste API-de ümber. Kõiki korraga ei tasu eemaldada.

Soovitus järjekord:
1. defineeri Meili raw-hit tüübid (`RawWorkHit`, `RawPageHit`) ja normalizerid;
2. keela `any` uutes utiliitides ja teenustes;
3. lisa ESLint reegel alguses warninguna, hiljem errorina valitud kaustades (`src/utils`, `src/services`).

---

## Testimise ja CI soovitused

Olemasolev testibaas on hea: backendis palju pyteste, frontendil 37 Vitest faili. Järgmine samm on kvaliteedivärav.

Minimaalne CI/deploy checklist:

```bash
pytest tests/
npm run typecheck
npm test
npm run build
```

Lisada järk-järgult:
- ESLint React/TypeScriptile;
- ruff Pythonile (esmalt ainult import/unused/simple vead);
- turvatestid: no-new-dangerous-html, path traversal helperid, authz smoke testid kõigile kirjutavatele endpointidele;
- Playwright smoke: login, dashboard, work open, save, search, admin upload happy path mockiga.

---

## Soovitatud GitHub issue'd

1. **P0: nginx rate-limit live rollout `/meili/` ja `/api/images/`**
2. **P0: SafeHtml wrapper ja `dangerouslySetInnerHTML` guard-test**
3. **P0: upload size / megapixel / PDF page piirangud**
4. ~~**P0: CI quality gate (`pytest`, `typecheck`, `vitest`, `build`)**~~ — tehtud GitHub Actions workflow'na (`.github/workflows/ci.yml`)
5. **P1: `upload_ops.py` split väiksemateks mooduliteks**
6. **P1: `Upload.tsx` split hookideks ja sammukomponentideks**
7. **P1: keskne frontend `apiClient.ts`**
8. **P1: `prosopography/ops.py` domeenipõhine jaotus**
9. **P2: Meilisearch päringute mõõtmine ja debounce/abort otsingus**
10. **P2: backend health/status taustatöödele ja queue-dele**
