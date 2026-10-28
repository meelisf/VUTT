# Dubleerimise järelkontroll — 2026-10-28

Eesmärk: leida teenused ja protsessid, mis teevad sama asja mitmes kohas — modulariseerimise
ja ühtse kasutajakogemuse küsimused. Eelmised: `_archive/vana/codebase_duplication_fallback_review_2026-06-07.md`,
[`2026-09-15-koodibaasi-ulevaade.md`](2026-09-15-koodibaasi-ulevaade.md) (P1-6, P1-7, P1-8).

## Kokkuvõte

Copy-paste'i on vähe: normaliseeritud 10-realise aknaga leiab `server/` + `src/` + `mcp/` koodist
umbes 20 kattuvat lõiku, peaaegu kõik lühikesed. Probleem on **struktuurne**: sama mustrit on
uue töö jaoks uuesti kirjutatud, mitte olemasolevat taaskasutatud. Üks lahknemine on juba
kasutajale nähtav viga (§3).

Juunist/septembrist parandatud: `scripts/1-1_consolidate_data.py` impordib nüüd
`server.meili_doc`-i (LinkedEntity abifunktsioonide koopiat enam pole); hulgimuudatused käivad
`metadata_ops.bulk_update_works` kaudu.

| § | Leid | Issue |
|---|---|---|
| 1 | Kaks HTTP-kihti: 43 faili möödub `apiClient`-ist | #671 |
| 2 | Tagasiside: `alert` 23×, `window.confirm` 9× vs `ConfirmModal`/`ErrorBanner` | #672 |
| 3 | Isikufiltrid 6 kohas käsitsi → **kaart ignoreerib `origin_place`-i** (viga) | #670 |
| 4 | Viewer-token 7 kohas kolmel viisil | #673 |
| 5 | Ajaloovaated: `renderDiff` ~90 identset rida kahes kohas, 4 ajaloo-UI-d | #674 |
| 6 | Agendikoodi hoidla ×3 | #675 |
| 7 | Taustatööde olek ja poll (server ×2–4, klient ×5) | #675 |
| 8 | Võtmepõhised lukuregistrid ×5 | #675 |
| 9 | `_metadata.json` lugejad ×5 (P1-6) — halvenenud | `tegemata_tood.md` |

## Kasutajale nähtav

### 1. Kaks HTTP-kihti (#671)

`src/services/apiClient.ts`: 401 kaasa antud tokeniga → `sessionExpiredHandler`, ühtne
veateate lugemine, `ApiError`. Kasutajaid 17. **43 faili** kutsub `fetchWithTimeout`-i otse
(sh komponendid `HistoryTab`, `Dashboard`, `Review`, `MetadataModal`, `useReOcr`), otse `fetch`
lisaks `Workspace.tsx` (3×), `letters/useImageTokens.ts`. Neis kohtades annab aegunud sessioon
valdkonna veateate — see, mille vastu käsitleja tehti.

### 2. Tagasiside mustrid (#672)

`alert()` 23× (`HistoryTab` 11, `Dashboard` 6), `window.confirm()` 9×; `ConfirmModal` 2 kasutajat,
`ErrorBanner` („asendab alert() kõnesid") 3. `git_committed === false` hoiatus on igas kohas
eraldi `alert`.

### 3. Isikufiltrid ja kaart (#670)

Filtriloend on käsitsi kirjutatud 6 kohas: `prosopography/router.py:125,205`,
`person_search.py:405,495`, `prosopographyService.ts:145,204` (+ `PersonsPage.tsx`
`listParams`/`mapFilters`). Kaardi haru jäi **kõigis kolmes kihis** `origin_place`-ita.
Kontrollitud koodist: `PersonsPage.tsx:305` `mapFilters` ei sisalda seda, `fetchPersonMapMarkers`
tüüp ei sisalda, `get_person_map_markers` ei võta vastu. Filtrikiip (`PersonsPage.tsx:462`)
renderdub sõltumata vaatest → kaardivaates on kiip aktiivne, kaart näitab kõiki. Sisend tuleb
kohtade registrist (`PlacesDetail.tsx:659`). Sama klass nagu #421. Brauseris kordamata.

### 4. Viewer-token (#673)

`Workspace.tsx:133,219` (fetch), `WorkManage.tsx:257` (`getViewerToken` + 45 min värskendus),
`SearchResults.tsx:25`, `manage/PageThumb.tsx:50`, `useWorkThumbnail.ts:37` (403 → token),
`letters/useImageTokens.ts:8` (eelpäring). `ThumbnailGrid` tokenit ei kasuta.

### 5. Ajaloovaated (#674)

`HistoryTab.tsx:269` ↔ `Review.tsx:403` — sama `renderDiff`. Lisaks isikukaardi ajalugu
(`PersonDetailPage.tsx:326`) ja `CommentHistoryPanel` — erinev kinnitus, veakäsitlus, git-hoiatus.

## Backend

### 6. Agendikoodi hoidla ×3 (#675 A)

`work_part_proposals.py:75–140`, `page_text_proposals.py:50–165`,
`prosopography/enrichment_proposals.py:50–145`: `_db()`, `handoff` tabel, `issue/revoke/_clean`.
Lahknenud: „kõik" ulatus on `NULL` / `"*"` / `scope` veerg. `agent_proposals` registreerib räsi
kolme hoidlasse ja kompenseerib osalise registreerimise. Küsimus ADR 0058-le: üks tabel?

### 7. Taustatööd (#675 B)

`page_ops_jobs.py` ≡ `page_text_proposal_jobs.py` (sama skelett); eraldi olek ka
`reocr_ops._reocr_jobs`, `heartbeat._jobs`. Klient: `useReOcr.ts:95,215`, `WorkManage.tsx:281,588`,
`useTextProposal.ts:243` — igaühel oma intervall ja katkestusreegel.

### 8. Lukuregistrid (#675 C)

`page_locks.py`, `page_text_proposals.py:98` (weakref-koodi koopia), `prosopography/locks.py:21`,
`admin_page_ops.py:31`, `upload/state.py:19` (+ ümbris `upload_ops.py:52`).

### 9. `_metadata.json` lugejad (P1-6)

`work_meta.py:19`; `prosopography/router.py:295` (täpne koopia); `meilisearch_ops.py:233`
(puuduv → `{}`); `image_server.py:46` (valideerib); **uus** `work_sets_access.py:17` — `try` puudub,
rikutud fail tõstab erindi (500), samas kui teised annavad `None` (fail-closed). Iga lugeja
tähendab „puudub" ja „loetamatu" erinevalt.

## Madal prioriteet (issue'ta)

- `scripts/match_aa_duplicates.py` ↔ `match_comma_duplicates.py` (~250 rida), `migrate_creators_*`
  ↔ `migrate_publisher_*` (~90) — ühekordsed, kandidaadid `scripts/archive/`-sse.
- `Register.tsx:114` ↔ `SetPassword.tsx:107`, `BulkGenrePicker` ↔ `BulkTagsPicker`,
  `CollectionAccessPanel:240` ↔ `UserDetail:451`.

## Metoodika ja piirid

Väline kloonidetektor (jscpd) ei olnud kasutatav; kasutatud oma skripti (normaliseeritud read,
tühjad/kommentaarid/impordid välja, 10-realine aken, testid ja lokaalifailid välja), seejärel
sihitud otsing mustrite kaupa (lukud, töö-registrid, HTTP-kutsed, tokenid, dialoogid, ajalugu,
filtrid, metaandmete lugemine). Teste ei jooksutatud; §3 on kinnitatud koodilugemisega.
