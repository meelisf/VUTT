# Tegemata tööd / tehniline võlg

Teadaolevad parandused, mis on teadlikult edasi lükatud. **Iga kirje on koodi vastu üle
kontrollitud 2026-08-04** — valmis saanud kirjed on siit eemaldatud (ajalugu: `git log`).

Suuremad tööd elavad GitHub Issues'is (`gh issue list`), mitte siin. Praegu avatud:
**#131** varundus (pildid + `state/` off-site), **#132** OCR job-state → SQLite,
**#133** vea-agregatsioon serveripool, **#134** andmete eksport (TEI / dump),
**#386** P0 järelmõjud, **#387** Python 3.9/3.12 + sõltuvuste lock,
**#388** `image_server` surm on nähtamatu, **#389** käivitustaaste võistlus,
**#390** `strictNullChecks`.

---

## Backend

### `find_directory_by_id` — slug-match ilma `sanitize_id`-ta

**Fail:** `server/utils.py:240`

`sanitize_id(entry.name) == target_id` — `sanitize_id` stripib lõpus olevad alakriipsud,
mistõttu slug `..._precatione_` ei leia vastet, kuigi kataloog täpselt selle nimega on olemas.
Slug-põhised pildi-URLid saaksid 403; praegu päästab `image_server.translate_path` fallback.

**Parandus:** step 4 peaks võrdlema otse `entry.name == target_id`. Enne kontrolli, kas
`sanitize_id` seal oli mõeldud URL-dekodeeritud nime jaoks.

### `_check_image_access` on fail-OPEN, kui metaandmeid ei õnnestu laadida

**Fail:** `server/image_server.py` — `if meta is None ... return True`

Kui `_metadata.json` on rikutud/loetamatu, muutub piiratud teose pilt avalikuks.
**Parandus:** eralda „ei ole piiratud" ja „ei suutnud lugeda" — viimane peaks keelama.
(Leitud käsitsi-ülevaatusel 2026-07-21, N2.)

### `get_client_ip` usaldab kliendi-kontrollitavaid päiseid

**Fail:** `server/rate_limit.py:87`

`X-Real-IP` / `X-Forwarded-For` võetakse vastu tingimusteta. Otseühendusel backendiga saaks
rate-limitist mööda päisega. Praegu leevendab see, et backend ei ole avalikult avatud ja nginx
kirjutab päise üle. **Parandus:** usalda päist ainult teadaolevatelt proksi-IP-delt.
(Leitud käsitsi-ülevaatusel 2026-07-21, N3.)

### Meilisearch `lehekylje_pilt` — katalooginimi, mitte nanoid

**Fail:** `server/meili_doc.py:364` — `os.path.join(dir_name, img_name)`

Väli sisaldab kaustapõhist teed. Nanoid on kanooniline viide, kaustanimi on muudetav →
kaustanime muutumisel lähevad pildi-URLid katki ja image server peab tegema tõlkimise.
**Parandus:** indekseeri nanoid + failinimi. Nõuab reindeksit (`server_seed_data.sh`).

### Legacy fallbackid (P3, avatud alates 2026-06-08)

- Kohtade lineaarne label-otsing runtime'is (`server/prosopography/places_ops.py`)
- `status`/`confession` legacy fallbackid (`server/prosopography/ops.py`)

Sulge migratsiooniskriptiga või lisa diagnostiline hoiatus, et näha, kas neid veel tabatakse.

---

## Frontend

### `PageThumbnail` — duplikeeritud viewer-tokeni loogika

Viewer-tokeni retry (piiratud kollektsioonide pisipildid: 403 → küsi token → lisa `exp`+`sig`)
on kahes kohas eraldi: `src/pages/search/SearchResults.tsx` ja `src/pages/manage/PageThumb.tsx`.
Kolmas pisipildivaade `src/components/ThumbnailGrid.tsx` ei kasuta viewer-tokenit üldse.
**Parandus:** üks jagatud `src/components/PageThumbnail.tsx` kõigile kolmele.

### Normaliseerijad ei kata kõiki erijuhte (P2)

`normalizePage` / `normalizeWork` (`meiliService.ts`) vs `pageService.ts` / `workService.ts`
(`page_tags_object`, `languages` fallback). Enne asendamist täienda jagatud normaliseerijaid.

### WorkManage — hulgivaliku ülevaatuse jäägid (2026-06-21)

| # | Fail / koht | Probleem | Parandus |
|---|---|---|---|
| 1 | `WorkManage.tsx` `handleBulkDelete`, 409-haru | valik tühjendatakse, aga `bulkDeleteConfirm` jääb `true` → „Kustutada 0 lehekülge?" | `setBulkDeleteConfirm(false)` ka 409-harusse |
| 2 | `WorkManage.tsx:250` `hasReorderChanges` | esmarenderil on `draftPositions` tühi → riba välgatab | `useMemo` või init otse `useState`-s (`?? page_num`) |
| 3 | `WorkManage.tsx` `handleDeletePage` | üksik-kustutus ei ole draft-järjekorra ajal blokeeritud (bulk on) → salvestamata järjekord kaob hoiatuseta | sama blokeering või hoiatus |

### Fallbackide eemaldamine

- **`tags`-fallback** — 35 lehte kasutab veel vana `tags` välja; pärast puhastamist eemalda
  fallback `server/meili_doc.py`-st.
- **JSON-i koristus** — `page_number` lehe-JSON-idest välja.

> `crossLangTypeMap` / `crossLangGenreMap` EI OLE enam tegemata töö — vt selgitust
> `src/components/AdvancedFilters.tsx:186`: need lahendavad vanade/jagatud URL-ide
> label-sisendit, mitte facetide keeleneutraalsust (issue #18).

---

## Lahtised küsimused (vajavad otsust, mitte koodi)

### Isiku kaardivaade ja kollektsioonifilter

Isikul, kellel on päritolukoht märgitud, aga ühtegi *seost* ei ole (nt
`/persons/vutt:Ptdn4lxy`), ütleb kaart „Valitud kollektsioonis pole selle isiku seoseid",
kuigi isik ise kuulub Academia Gustaviana üliõpilaste hulka. Kas kollektsioonifilter peaks
kaardil käima isiku enda kuuluvuse, mitte seoste järgi?

### Arhiiviviidetel puudub keelevariantide tugi

`data/config/archives.json` kirjel on üks `name` (arhiivi enda keeles, nt „Latvijas Valsts
vēstures arhīvs"). Kui UI vajab eesti/inglise vastet, tuleb lisada `labels{et,en}` nagu
mujal LinkedEntity-väljadel.

### „Loengukava" märksõna

Pole Q-koodi ega ingliskeelset vastet (~18 teost). Vajab otsust: leia Wikidata vaste või
märgi teadlikult kohalikuks terminiks.

---

## Koodibaasi ülevaatus 2026-09-15 — leiud, millel EI OLE issue't

Allikas: [`reviews/2026-09-15-koodibaasi-ulevaade.md`](reviews/2026-09-15-koodibaasi-ulevaade.md).
Suuremad leiud said issue'd (#386–#390, vt päis). **Need siin jäid teadlikult
issue'ta**, sest nad on hajusad ja ilma päästikuta: issue'na nad ei liiguks, vaid
tekitaksid mulje pikemast järjekorrast kui on. Õige hetk on siis, kui sama faili
niikuinii puutud.

### P1-4 — vaikne ebaõnnestumine veakäsitluses

AST-loendus: `except Exception` 337× `server/`-is + 100× `scripts/`-is, neist keha
ainult `pass`/`continue` **117**; paljas `except:` 6× `scripts/`-is.

Arv üksi ei tõenda, et vaikne käsitlus domineeriks. **Kui ette võtta, siis kitsendatult:**
upload/re-OCR harud, mis peatavad kasutaja töö — seal on vaikne neelamine kõige kallim.
Vea järgi `warning`/`error`; `debug` võib tootmises välja lülitatud olla. Erindi teksti
logimisel vältida tokenitega URL-e.

### P1-6 — `_metadata.json` lugemine on dubleeritud

90 viidet, ≥5 sõltumatut teostust: `git_ops.py:181`, `admin_page_ops.py:164`,
`scripts/sync_meilisearch.py:134`, `image_server.py:451,490,526` (3× ühes failis),
`prosopography/router.py:327` (`_load_work_meta`).

`server/work_meta.py:19 load_work_metadata` **ongi selleks** ja eksisteerib — teda ei
kasutata järjekindlalt. Ühendamine ei ole mehaaniline: praegune loader **ei erista**
puudumist lugemisveast (mõlemal `None`) ja võtab `work_id`, samas osa kutsujaid teab
juba kataloogiteed. Õiguskontrolli **fail-closed** leping peab säilima.

### P1-7 — ühilduvusfassaadid on saanud de-facto API-ks

`server/__init__.py` (88 rida re-eksporte), `prosopography/ops.py` (122) +
`_compat.py` (169) — **69 faili impordib sealt**; `main.py` `_`-nimelised re-ekspordid,
mille ainus tarbija on testid.

Muster oli refaktoreerimisel õige, aga kasvav fassaad kangestab vana kuju. **Odav pool:
kirjuta reegel** („uut nime fassaadi ei lisata, uus import otse moodulist"). Migreerimine
ise on kallim: `_compat.py` vahendab ka monkeypatch'itud olekut — ainult importide
ümbernimetamisest ei piisa, testid peavad patch'ima tegeliku kutsuja sõltuvust
(vrd [`_compat` sync mock-leke, #342](https://github.com/meelisf/VUTT/pull/351)).

### P1-8 — god-moodulid ja pikad funktsioonid

`reocr_ops.py` 1557 rida, `git_ops.py` 1332, `admin_page_ops.py` 1046,
`prosopography/router.py` 1041, `upload_ops.py` 954. **20 funktsiooni üle 120 rea**,
suurimad `upload_ops.replace_work_content()` 294 ja `upload/import_work._teosta_import()` 291.

Routeri-tasand on korras (endpointid `routers/`-is) — monoliitsus on **ops-tasandil**.
Selgeim kandidaat on `reocr_ops.py` (`state` / `poll` / `batch` / `recovery`).

### P2 — väiksemad

| Teema | Koht |
|---|---|
| `dangerouslySetInnerHTML`-valvur ei püüa `el.innerHTML`-i | `src/utils/__tests__/dangerouslySetInnerHTMLGuard.test.ts:26`; laienda `.innerHTML` / `.outerHTML` / `insertAdjacentHTML` peale (vrd `MarginaliaExtension.ts:357`) |
| `config.py` impordi kõrvalmõjud | loob `logs/`, seab juurloggeri ja **`sys.exit()`-ib impordil** (2 kohta). `validate_config()` eraldi kutsumine oleks testitavam |
| Saladuse *tugevust* ei kontrollita | `config.check_production_secrets` kontrollib ainult „puudub" ja „arendusvaikeväärtus"; HMAC-saladusele lisaks pikkusnõue (≥32 baiti) |
| 54 `print()` vs 346 logger-kutset | `image_server.py` 20, `auth.py` 12, `config.py:296` |
| Sisemine infra-info repos **kolmes kohas** | `config.py:335-340` vaikeväärtused, `.env` (`OCR_SERVER_HOST`), `vite.config.ts:6` (`DEV_BACKEND`). Tootmises võiks nõuda eksplitsiitset env-i |

`prosopography/router.py` oma `_get_user` on **#356**, mitte siin.
