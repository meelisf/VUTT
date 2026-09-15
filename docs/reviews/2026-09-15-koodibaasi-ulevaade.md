# Koodibaasi ülevaatus — turva, hallatavus, loetavus, pikaealisus

**Kuupäev:** 2026-09-15
**Algse ülevaate ulatus ja reaarvud (järelkontrollis kordamata):** `server/` (30 203 rida), `src/` (63 744), `mcp/` (6 252),
`scripts/` (12 072), `tests/` (33 362); konfiguratsioon, Docker, CI, sõltuvused.
**Küsimus:** mis takistab koodibaasi haldamist, mõistmist ja edasiarendamist järgmised
5 aastat — ja kas kuskil lekib saladus.

**Sõltumatu järelkontroll:** 2026-09-15, lähtekoodi commit `48109fd7`.
Allpool on parandatud algse ülevaate järeldusi; algsete mõõtmiste kordamata
arvud on taustainfo, mitte järelkontrolli tulemused. Järelkontroll muutis esmalt seda dokumenti. Järgnevalt parandati kasutaja
palvel P0-2 ehituskonfiguratsioonis ning P0-1/P0-3 rakenduskoodis (vt §8).
Allpool olevad vastunäited kirjeldavad paranduseelset seisu.

**Vastus lühidalt:** esmajärjekorras tuleb eemaldada `state/` Docker image'ist
ja sulgeda vearaporti serveripoolse puhastuse kodeeritud sisendite augud.
MapLibre haavatav sõltuvus vajab uuendamist; esimene parandatud versioon on
**6.4.1**, mitte 6.9.1. Python 3.9 ja CI 3.12 lahknevus on kinnitatud, kuid
praegusele CI-tööle ei saa lihtsalt 3.9 maatriksirida lisada. `strictNullChecks`
puudub; see on arvestatav pikaajaline võlg. Lint-lävi 43 on tahtlik võla
kasvu piiraja ja töötab õigesti.

**Saladuste puudumist kogu ajaloos ei saa siin tõendada.** Praeguste võtmete
otsing ei kata roteeritud võtmeid, teisi ehitisi ega kõiki ajaloo viiteid.
ADR 0021 mainib varasemat Gemini võtme leket, täpsustamata selle kanalit;
seega algse ülevaate absoluutne kinnitus oli põhjendamatu.

> Ajalugu: `docs/reviews/2026-07-09-skaleerimise-ulevaade.md` käsitles **kasvu**
> (2x/5x teosed). See ülevaatus käsitleb **koodi enda** kvaliteeti. Kattumist on
> vähe: kasvu-ülevaate leiud (Dashboard `limit: 5000` → #156, `save_with_git`
> ajalookõnd, read-modelite piirid) kehtivad endiselt ega ole siin korratud.

---

## 1. Saladuste ja volituste kontroll

Algne ülevaade kirjeldas järgmisi kontrolle. Nende käivitusväljundeid ei ole
selle dokumendiga kaasas ja järelkontroll ei korranud saladuste ega kogu ajaloo
skaneerimist. Tulemusi tuleb lugeda piiratud kontrolli kirjeldusena.

| Kontroll | Meetod | Tulemus |
|---|---|---|
| `.env` gitis või ajaloos | `git log --all -S <väärtus>` iga 10 võtme kohta | Algse kontrolli järgi praeguste väärtuste tabamusi ei leitud; ei välista varasemaid võtmeid |
| `.env` väärtused `dist/`-is | 6 MB bundle läbiotsimine baitide kaupa | **Ei esine** — `vite.config.ts`-s `define`-plokki tahtlikult ei ole (ADR 0021) |
| Kõva-kodeeritud saladused | 11 mustrit (privaatvõti, `sk-`, `AIza`, `ghp_`, `AKIA`, JWT, `Bearer`, URL-basic-auth, `*_key/secret/password = "…"`) × 830 faili | **0 tabamust.** Ainsad leiud olid test-fixture UUID-d |
| Ajaloo diff-skaneering | 2635 commit'i `-p` väljund läbi sama mustri | **0 sisulist tabamust** |
| `image_server` HMAC | `hmac.compare_digest` kasutus | korras |
| Paroolid | `bcrypt` + `gensalt`, ajastuse-ühtlustaja olemas | korras |
| Salajased väljad | `SECRET_FIELDS` filtreerib ka **lugemisel** (#237) | korras |

Algne ülevaade raporteeris ajaloost kolm **mitte-saladuslikku** väärtust: `MEILI_URL`,
`OCR_SERVER_HOST`, `OCR_SERVER_PATH`. Need on ühtlasi kõvakodeeritud vaikeväärtustena
`server/config.py:335-340` sees. Roteerimist ei vaja (pole võtmed), aga sisemine
infra-info (IP, kasutajanimi, tee) avalikus repos → vt P2-5.

---

## 2. P0 — parandatud või kohe vaja

### P0-1. Vearaport kandis volitusi — parandatud, vt §8

`src/services/clientErrorReporter.ts` saatis `window.location.pathname + window.location.search`
serverisse. `src/pages/SetPassword.tsx:20` loeb tokeni just päringustringist
(`/set-password?token=<uuid>`), seega iga JS-viga sellel lehel kirjutas **kehtiva
kutse- või paroolivahetuse tokeni** `state/client_errors.json`-i, kust
`GET /admin/client-errors` selle admin-paneelis välja näitas.

**Praeguses lahenduses on kliendi- ja serveripoolne puhastus:**
- `src/services/scrubSensitive.ts` — puhastus kliendis, **kaheosaline reegel**
  (võtmenimi + väärtuse kuju), sest paljas denylist jääb alati maha
- `server/client_errors.py:_on_tundlik/scrub` — sama reegel serveris, sest
  „klient on ANDMED, mitte filter" (vana vahemälust laaditud bundle saadab mida tahes)
- `tests/test_client_errors.py:227 test_kaks_keelt_uks_reegel` — **pariteedivalvur**,
  mis loeb TS-faili ja kontrollib, et nimekirjad ei lahkneks. Täpselt õige muster
  (sama, mis `mcp/tests/test_meili_contract.py`).
- `typecheck` on nüüd puhas (varem kukkus WIP-testifaili tõttu)

**Järelkontrolli leiud.** TS-funktsioonid käivitati `esbuild`-iga ja Pythoni
puhastusfunktsioonid eraldati AST kaudu, vältides konfiguratsiooni importi.
Kõik väärtused olid sünteetilised.

| Sisend | `scrubUrl` | `scrubText` / serveri `scrub` |
|---|---|---|
| `/x?token=synthetic-short` | eemaldab | eemaldab |
| `/x?%74oken=synthetic-short` | eemaldab | **jätab alles** |
| `/x?a=%26token%3Dsynthetic-short` | taastab `&token=synthetic-short` | **kodeeritud sisend jääb alles** |
| `/x#token=synthetic-short` | jätab alles | jätab alles |

Olulised täpsustused:

1. Kodeeritud võtmenimi läheb serveris filtrist läbi. Vana klient või URL
   veateate/stacki sees võib salvestada taastatava saladuse. See on kinnitatud
   serveripoolne puudus, mitte ainult kliendi vormistusprobleem.
2. Pesastatud väärtuse näites eemaldab praegune server **kliendi dekodeeritud
   väljundist** literaalse `&token=...`. Kliendifunktsiooni väljund üksi ei
   tõenda selle näite jõudmist kettale. Algne soovitus eemaldada
   `decodeURIComponent` jätaks saladuse kodeeritult alles ka serveris:
   **kodeerimine ei ole saladuse eemaldamine**.
3. Raportööri `url` kasutab `pathname + search`, seega fragment ei jõua sinna
   praegu üldse. `message` ja `stack` võivad fragmendiga URL-i sisaldada.
4. `test_kaks_keelt_uks_reegel` võrdleb **ainult võtmenimede hulka**, mitte
   parsingu ega kuju-reeglite käitumist. See ei tõenda täielikku pariteeti.
5. `_load()` ja `list_errors()` ei puhasta olemasolevaid kirjeid uuesti.
   Koodiparandus üksi ei kõrvalda enne parandust kettale jäänud tokeneid.

**Soovitus:** määrata mõlemale keelele ühine sisend/väljund-testikorpus
(kodeeritud nimed ja väärtused, pesastatud URL, vigane kodeering, fragment).
Eelistada vearaporti `url` väljas teed ja kitsast diagnostiliste parameetrite
lubatud loendit; `message`/`stack` vajavad eraldi URL-ide puhastust.
Piiratud dekodeerimine peab lõppema puhastamisega; arusaamatu väärtus tuleb
välja jätta. Kontrollida ka `record_error` salvestust ja vanade kirjete
lugemist, mitte üksnes abifunktsiooni. Varasemate logide puhastamine ja
võimalike kehtivate tokenite tühistamine vajab eraldi rakendusplaani.

Kuju-reegel (`LONG_OPAQUE`, ≥24 ASCII märki) võib peita pika otsingusõna.
Selle eemaldamist `message`/`stack` teelt ei soovita ilma asenduskaitseta:
see kaotaks tundmatu võtmenimega tokenite kaitse just vabatekstis.

### P0-2. `state/` läheb Docker image'isse — ehituskonfiguratsioon parandatud

**Parandatud 2026-09-15 tööpuus:**

- `Dockerfile` ei kopeeri enam `state/` sisu; loob ainult tühja `/app/state` kausta.
- `.dockerignore` välistab `state/` ka ehituskontekstist.
- Compose kasutab endiselt hosti köidet `./state:/app/state`.

Kontrollitud staatiliselt: kõik allesjäänud `COPY` lähtekohad eksisteerivad,
`state/` kopeerimist pole, ignoreerimisreegel ja tühi haakepunkt on olemas
ning Compose'i köide säilib. `git diff --check` läbis. Docker image'i ehitamist
siin ei kontrollitud: kohalik Docker API keeldus ligipääsust (`permission denied`).

**Rakendamine:** serveris tuleb ehitada uus backend-image ja konteiner taasluua.
Selle muudatusega ei ole tootmisse juurutatud ega vanu image'eid kustutatud.
Varasemad kihid võivad endiselt sisaldada ehitamise ajal olemas olnud
runtime-faile. Kontrollida tuleb nende levikut, ehitusvahemälu ja võimalikke
registry-koopiaid; tokenite tühistamise vajadus sõltub tegelikust kokkupuutest.

`~/VUTT/state/` on dokumenteeritud tootmise runtime-kaust. Lokaalne `state/`
ei tõenda tootmise sisu (CLAUDE.md); tootmise image'i kihte pole kontrollitud.

### P0-3. `maplibre-gl <=6.4.0` — sõltuvus uuendatud, vt §8

Lukufaili MapLibre **5.24.0** kuulub haavatavasse vahemikku. Turvateate järgi on esimene
parandatud versioon **6.4.1**. Rünne puudutab ohtlikku HTML-i stiili allikate
attributsioonis; ainult pop-up'ide kontrollimisest ei piisa.
Allikas: [MapLibre turvateade GHSA-jrc7-96c5-q579](https://github.com/advisories/GHSA-jrc7-96c5-q579)
(kontrollitud 2026-09-15).

`HistoricalMapLayer.tsx` laadib OpenHistoricalMapi välist stiili ning kasutab
attributsioonikontrolli. Väline sisend on seega olemas; VUTT-is tegelikult
käivituvat ründeahelat ei ole reprodutseeritud. Paketi `critical` raskusaste
ja rakenduse P0-prioriteet ei ole automaatselt sama.

**Soovitus:** uuendada parandatud versioonile ning kontrollida ajaloolise kaardi
stiili, aastafiltrit, attributsiooni, kihtide eemaldamist ja Leafleti adapterit.
5.x → 6.x on major-uuendus. Versioon 6.9.1 ei ole selle augu minimaalne parandus.

Järelkontrolli `npm audit --omit=dev` ebaõnnestus DNS-veaga (`EAI_AGAIN`);
ülejäänud auditileidude praegust nimekirja ei kinnitatud. `--omit=dev` ei tõenda,
et kõik leitud paketid jõuavad brauserisse; samas ei muuda ehitusahelas olemine
haavatavust automaatselt tähtsusetuks. Hinnata tuleb iga paketi kasutusteed.

---

## 3. P1 — hallatavus ja pikaealisus

### P1-1. TypeScript ei ole strict — suurim üksik tehniline võlg

`tsconfig.json`-s **puudub `strict`** → `strictNullChecks` on väljas. 63 744 rida TS-i,
kus `null`/`undefined` ei ole tüübikontrolli all. Kaasnähtus: **117** `any` ja **138**
`as any`, neist tootmiskoodis `WorkspaceMobileView.tsx` (10), `WorkInfoPanel.tsx` (10),
`prosopographyService.ts` (7), `SearchResults.tsx` (6), `PersonDetailPage.tsx` (5),
`WorkTagsPanel.tsx` (5), `searchService.ts` (4).

`strictNullChecks` aitab leida nulliga seotud vigu, kuid `strict` ei keela
otseselt kirjutatud `any` ega `as any` kasutust. Nende arvu ei saa seletada
üksnes `strict` puudumisega. Ka CI-pariteet ja sõltuvuste lukustamine ennetavad
terveid veaklasse; suurima võla järjestus on hinnang, mitte mõõtmistulemus.

**Soovitus:** mõõda esmalt `tsc --noEmit --strictNullChecks` diagnostika.
Praegune CI ei oska lubatud vealoendit arvestada: järkjärguline üleminek nõuab
eraldi kontrolli või baastaseme mehhanismi. Failikaupa eraldamine ei pruugi
impordigraafi tõttu piirduda soovitud kaustaga. Säilita olemasolev roheline
kontroll ning väldi võla peitmist `as any` või `@ts-ignore` lisamisega.

### P1-2. CI testib Python 3.12-l, tootmine jookseb 3.9-l

```
Dockerfile:1                    FROM python:3.9-slim
.github/workflows/ci.yml:24     python-version: '3.12'
```

CI 3.12 ei kontrolli 3.9-ga ühilduvust. Skriptides on annoteeringuid, mille hindamine vajab uuemat Pythonit:

```
scripts/migrate_confession_to_confessions.py:17   def migrate(prosopo_dir: str | None = None) -> int:
scripts/suggest_place_coordinates.py:58, 85, 119  dict | None, set[str] | None
scripts/enrich_place_coordinates.py:31            dict | None
```

`X | None` on PEP 604 = Python 3.10+. Annoteeringud hinnatakse definitsiooni hetkel,
seega need skriptid **kukuvad importimisel 3.9-s**. Konteiner on 3.9 → `docker exec`
kaudu jooksutades kukuvad ka tootmises.

Algne ülevaade ei leidnud serverist samasuguseid annoteeringuid. See ei asenda
3.9 käituskontrolli; CLAUDE.md ühilduvusreegel ei ole praegu selle versiooni CI-ga kaitstud.

**Parandus:** eelista käituskeskkonna ja CI ühisele versioonile viimist koos
sõltuvuste ning konteineri käivituse kontrolliga. Kui 3.9 tugi säilib, vajab see
**eraldi backendi CI-tööd ja ühilduvaid testisõltuvusi**: `requirements-dev.txt`
sisaldab `pytest>=9` ja `mcp>=2`; `mcp/pyproject.toml` nõuab vähemalt Python 3.10.
Olemasoleva töö lihtne maatriksistamine kukuks sõltuvuste paigaldusel.
Lisaks testidele kontrolli hooldusskriptide importi: ainult süntaksi kompileerimine
ei tuvasta kõiki annoteeringute hindamisel tekkivaid vigu.

### P1-3. Sõltuvused on pin'imata → build katkeb iseenesest

`requirements.txt` kasutab kõikjal `>=` ja lock-faili pole, baas on `python:3.9-slim`.
Iga värske sõltuvuste lahendamine võib tuua muutunud API või transitiivse
sõltuvuse. `pip` arvestab korrektselt deklareeritud `Requires-Python` piirangut;
3.9 mittetoetava major-versiooni automaatne valimine ei ole üldreegel.
Taastoodetavuse risk on siiski olemas.

**Fix:** `pip-compile` või projektile sobiv lock koos Dockeris **lukust paigaldamisega**.
Pelgalt `uv.lock` lisamine ei muuda praegust `pip install -r requirements.txt` käsku.
Ülempiirid vähendavad riski, kuid ei lukusta transitiivseid sõltuvusi. Kriitilised paketid:
`fastapi`, `GitPython`, `paramiko`, `bcrypt`. Frontend on `package-lock.json`-iga juba
korras.

### P1-4. Vaikne ebaõnnestumine on domineeriv veakäsitlusmuster

Järelkontrolli AST-loendus (ainult `server/**/*.py` ja `scripts/**/*.py`):

| Muster | `server/` | `scripts/` |
|---|---|---|
| `except Exception` | 337 | 100 |
| neist keha ainult `pass` / `continue` | 105 | 12 |
| paljas `except:` | 0 | 6 |

Algne 164 vaikse haru arv ei kordunud: selle selge definitsiooni järgi on neid
**117**. Erandipüüdjate koguarv 437 kinnitati. Arv ei tõenda, et vaikne
veakäsitlus domineeriks kõigis rakenduse vigades.

**Soovitus:** auditeerida esmalt kasutaja tööd peatavaid upload/re-OCR harusid.
Valida vea järgi `warning`/`error`, oodatava puudumise jaoks vaikne tagastus.
`debug` võib tootmises olla välja lülitatud ega taga nähtavust. Erandi teksti
või traceback'i logimisel vältida tokenite ja autentimisandmetega URL-e.

### P1-5. Taustatööde elutsükkel ja käivitusaegse taaste järjestus

`main.py` käivitab kümme lõime otse ja kutsub nelja käivitajat, kuid see ei
võrdu 14 perioodilise lõimega. `reocr_ops.py` käivitab lisaks lõime impordi
ajal ning `start_reocr_background` käivitab taastamise järel reaper'i.
`ada-fetch`, `apply`, `import` ja `preview` taaste on **ühekordsed käivitustööd**.

Heartbeat katab juba muu hulgas upload-sünki, re-OCR pollimist/koristust,
reaper'it, OCR käivitustaastet, metadata-watcher'it ja Meili keepwarm'i.
`apply_recovery.py` logib ühe üleslaadimise taastevea `exc_info=True` abil
ja jätkab teistega. Väide, et iga lõime surm jääb täiesti märkamatuks, on liiga lai.

**Uus kontrollikoht:** `apply_recovery.py` nõuab kommentaaris taastet enne uute
apply'de algust, kuid `lifespan` käivitab selle daemon-lõimes ja jõuab `yield`-ini
lõppu ootamata. Koodis on seega võimalik võistlus käivitustaaste ning uue päringu
vahel; tootmisjuhtumit ei ole reprodutseeritud. Lisada deterministlik test,
mis peatab taaste ja proovib sama üleslaadimise uut tööd. Lahendus võib olla
lokaalse taaste ootamine enne valmisolekut või taastega kattuvate kirjutuste
värav; OCR-serveri võrgutööd ei tohi blokeerida sündmussilmust (ADR 0002).

Perioodiliste tööde jaoks jälgida viimast edukat tsüklit ja aegumist; ühekordsete
jaoks `started/completed/failed` olekut. Neile korduva heartbeat'i nõudmine või
taaste perioodiliseks muutmine oleks vale.

### P1-6. Duplikeeritud `_metadata.json` lugemine

90 viidet, vähemalt 5 sõltumatut lugemisteostust:

```
server/git_ops.py:181            ┐
server/admin_page_ops.py:164     ├ sama if os.path.exists / try / open / json.load muster
scripts/sync_meilisearch.py:134  ┘
server/image_server.py:451, 490, 526     ← 3× sama plokk ÜHES failis
server/prosopography/router.py:327       ← _load_work_meta dubleerib work_meta.load_work_metadata
```

`server/work_meta.py:19 load_work_metadata` **ongi selleks mõeldud** ja eksisteerib —
teda ei kasutata järjekindlalt. Praegune loader **ei erista** puudumist ja
lugemisviga: mõlemal juhul tuleb `None`. Ta võtab `work_id`, samas osa kutsujaid
teab juba kataloogiteed. Ühendamisel säilitada `None`/`{}` ja õiguskontrolli
fail-closed leping; vajadusel eraldada tee järgi lugemine ID lahendamisest.
Kõigi lugemiskohtade mehaaniline asendamine ei ole ohutu.

### P1-7. Ühilduvusfassaadid on saanud de-facto API-ks

- `server/__init__.py` — 88 rida re-eksporte
- `server/prosopography/ops.py` (122) + `_compat.py` (169) — **69 faili impordib sealt**
- `server/main.py` — backward-compat re-eksport `_`-nimedega (`_safe_username`,
  `_load_notifications`, `_notifications_lock`…), mille ainus tarbija on testid

Muster oli refaktoreerimisel õige (ei murra kõike korraga). Aga fassaad, mis kasvab,
muutub ise võlaks: iga uus funktsioon, mis sinna lisatakse, kangestab vana kuju ja
muudab „kas seda kasutatakse veel?" vastamatuks.

**Soovitus:** kirjuta reegel („uut nime fassaadi ei lisata, uus import otse moodulist")
+ üks migreerimisprits, mis viib testid otse `person_crud`/`person_search`/… sisse,
alles tarbijate puudumisel eemalda fassaadid. `_compat.py` vahendab ka
monkeypatch'itud olekut: ainult importide ümbernimetamisest ei piisa.
Kontrolli, et testid patch'iksid tegeliku kutsuja sõltuvust. Sama kehtib
`main.py` `_`-nimedele.

### P1-8. God-moodulid ja pikad funktsioonid

| Fail | Rida |
|---|---|
| `server/reocr_ops.py` | 1557 |
| `server/git_ops.py` | 1332 |
| `server/admin_page_ops.py` | 1046 |
| `server/prosopography/router.py` | 1041 |
| `server/upload_ops.py` | 954 |

**20 funktsiooni üle 120 rea**, suurimad `upload_ops.replace_work_content()` **294**,
`upload/import_work._teosta_import()` **291**, `prosopography/router._collect_work_titles()`
266, `upload/thumbs.poll_and_sync_thumbs()` 220. Routeri-tasand on korras (endpointid
`routers/`-is) — monoliitsus on ops-tasandil. `reocr_ops.py` on selgeim kandidaat
jagamiseks (`state`, `poll`, `batch`, `recovery`).

### P1-9. Lint-kommentaar on aegunud; lävi ise on õige

`npm run lint:ci` lubab 43 hoiatust ja järelkontroll leidis täpselt 43,
0 viga. See on **tahtlik baastase**: olemasolev võlg on lubatud, uus mitte.
See ei keela Hookside muutmist; uue hoiatuse tekkimisel tuleb põhjus lahendada.
`eslint.config.js` päise 57 on aegunud ja tuleks muuta 43-ks või viidata
numbrilise dubleerimiseta `package.json`-ile.

Hoiatusi tasub parandada juhtumipõhiselt ja läve samas muudatuses langetada.
Sõltuvuse pimesi lisamine võib tekitada tsükli; suvalist „3–5 hoiatuse” kvooti
pole vaja. Kommentaariparandus kuulub P2 tasemele.

### P1-10. Konteineri protsessihaldus

```
Dockerfile CMD   ["/bin/bash","-c","... uvicorn ... & ... image_server ... & wait"]
```

`HEALTHCHECK` puudub (`Dockerfile`, `docker-compose.yml`). Kui `image_server` sureb,
jääb konteiner „töötab" ja `restart: always` ei aita — pildid lihtsalt lakkavad
töötamast, ilma et miski seda näitaks. `server_update.sh` `docker compose ps` näitab
rohelist.

**Fix:** kaks eraldi teenet compose'is (puhtaim) **või** `supervisord`/`s6` +
healthcheck mõlemale pordile (8001 ja 8002). Healthcheck üksi märgib konteineri
`unhealthy` olekusse; see ei taga `restart: always` korral protsessi taaskäivitust.
Kontrollida tuleb ka SIGTERM-i edastamist, laste sulgemist ja ühe protsessi
surma korral kogu teenuse taastumist.

### P1-11. Build-kontekst on ~240 MB

`.dockerignore` katab `node_modules`/`data`/`.git`, aga **mitte**:

| Kaust | Suurus |
|---|---|
| `.venv/` | **198 MB** |
| `docs/` | 9,8 MB |
| `tests/` | 6,4 MB |
| `src/` | 3,8 MB |
| `state/` | 2,7 MB (ja see on ka turvaprobleem — P0-2) |

Need on algse ülevaate lokaalsete kaustade suurused, mitte mõõdetud Dockeri
ülekandemaht. Tegelik maht sõltub ehitajast ja vahemälust. Ignoreerimisloendit
tasub kitsendada ning maht kinnitada `--progress=plain` build-väljundiga.
Kontrollida ka `.worktrees/`, `.pytest_cache/` ja `.env.*` välistamist;
`reference_data/` on praeguse Dockerfile'i sisend ja peab konteksti jääma.

---

## 4. P2 — väiksemad, aga kirja väärt

| # | Teema | Koht | Märkus |
|---|---|---|---|
| P2-1 | `dangerouslySetInnerHTML`-valvur ei püüa `el.innerHTML`-i | `MarginaliaExtension.ts:357`; `src/utils/__tests__/dangerouslySetInnerHTMLGuard.test.ts:26` | Guard greibib ainult `dangerouslySetInnerHTML\s*=`. Laienda `.innerHTML` / `.outerHTML` / `insertAdjacentHTML` peale. Algne ülevaade raporteeris 1062 tagivariandi fuzz-kontrolli; järelkontroll seda ei korranud |
| P2-2 | `config.py` impordi kõrvalmõjud | `config.py` | Loob `logs/`, seab juurloggeri ja **`sys.exit()`-ib impordil** (2 kohta: legacy-nimed, prod-saladused). Seam'id on testide jaoks olemas, aga `validate_config()` eraldi kutsumine oleks puhtam ja testitavam |
| P2-3 | Saladuse *tugevust* ei kontrollita | `config.check_production_secrets` | Kontrollib ainult „puudub" ja „teadaolev arendusvaikeväärtus". HMAC-saladusele lisaks pikkusnõue (≥32 baiti) |
| P2-4 | Segane logimine | **54** `print()` vs **346** logger-kutset | `image_server.py` 20, `auth.py` 12. Eriti `config.py:296` `print(f"Meilisearch: URL=…")` |
| P2-5 | OCR-serveri vaikeväärtused koodis | `config.py:335-340` | Sisemine IP + kasutajanimi + failitee. Selgitab ka ajaloo tabamusi. Tootmises võiks nõuda eksplitsiitset env-i |
| P2-6 | Tailwind 3 + v4 plugin korraga | `package.json:43`, `postcss.config.js` | `@tailwindcss/postcss@4` on kasutuseta (postcss kasutab v3 `tailwindcss`), aga tõmbab lock'i eraldi `tailwindcss@4`. Eemalda |
| P2-7 | Dev-backend kõvakodeeritud | `vite.config.ts:6` | `DEV_BACKEND` on sisemine IP literaalina. **NB: sama väärtus on ka `.env`-is (`OCR_SERVER_HOST`) ja `config.py` vaikeväärtuses** — seega sisemine infra-info on repos kolmes kohas. Väärtust siin dokumendis teadlikult ei korda |
| P2-8 | `prosopography/router.py` oma `_get_user` | vs `deps.get_user` | Teadaolevalt #356. Tokeni-lugeja valvur (`tests/test_token_lugeja_uks_reegel.py`) on olemas — hea |

**Algse ülevaate viited `docs/tegemata_tood.md` kirjetele** (selles järelkontrollis
uuesti valideerimata): `_check_image_access` fail-open, `get_client_ip` päiste usaldamine,
`find_directory_by_id` slug-match, viewer-tokeni duplikatsioon
(`SearchResults` / `PageThumb` / `ThumbnailGrid`), `tags`-fallback, Meili
`lehekylje_pilt` katalooginimi.

---

## 5. Mis on hästi

Et soovitused oleksid tasakaalus — need ei ole viisakusfraasid, vaid asjad, mida
**järgmised muudatused peavad säilitama**:

- **Testikomplekt on mahukas.** Algne ülevaade raporteeris 2227 py-testi ja
  1174 ts-testi; järelkontrolli tegelikud tulemused on §7-s. Backend-testikood (33 362 rida) on **mahukam kui backend ise** (30 203).
  Duplikaatkood ~2% (3344 rida 145k-st) — 8-realisest aknast otsides.
- **Dokumentatsioon on erakordne.** 43 ADR-i formaadis Kontekst/Otsus/Tagajärjed,
  `docs/README.md` eristab elava
  arhiivist. Kommentaarid selgitavad **miks**, mitte **mida** — see on täpselt see,
  mis hoiab bus-factor'i probleemi (issue #137) kontrolli all.
- **Turvahügieen on läbi mõeldud ja kihiline:** `bcrypt` + ajastuse-ühtlustaja,
  `hmac.compare_digest`, Meili tenant-tokenid filtritega serveri poolel,
  `SECRET_FIELDS` ka lugemisel, tootmise-saladuste stardikontroll, ADR 0021
  legacy-env-nimede **vali** tagasilükkamine, `script-src 'self'` CSP,
  kahekihiline rate-limit (nginx + app), vearaporti väljade allowlist ja tundlike
  võtmenimede pariteeditest (käitumise pariteet vajab täiendamist, vt P0-1).
- **Väravad on CI-s olemas:** `typecheck`, `lint:ci`, `npm test`, `build`,
  pytest + mcp-testid. Järelkontrolli tulemused ja piirid on §7-s.
- **`mcp/` eraldatus** (ei impordi `server`-it runtime'is, oma testid,
  `structured_output=False`, `ToolError` alamtüüp) on õigesti ja dokumenteeritult tehtud.

---

## 6. Soovitatud järjekord

| # | Tegevus | Valmimise kontroll |
|---|---|---|
| 1 | `state/` ehituskonfiguratsioonist eemaldatud; teha uus build ja varasemate image'ite leviku kontroll | värske image ei sisalda runtime-faile; vana materjali käsitlus otsustatud |
| 2 | Vearaportite serveri- ja kliendipuhastus, vanade logide käsitlus | ühine kodeeritud sisendite testikorpus; salvestuse ja lugemise testid |
| 3 | MapLibre parandatud versioon | kaardi automaattestid ja brauserikontroll, uuendatud lock |
| 4 | Käivitustaaste ja uue apply võistluse kontroll | deterministlik konkurentsitest; taaste ei lähtesta uut tööd |
| 5 | Python-keskkondade ühtlustamine ja sõltuvuste lukustamine | Docker build, teenuste start, backend-testid ja skriptide ühilduvus |
| 6 | Konteineri protsessihaldus | ühe protsessi surm ning SIGTERM taastuvad/sulguvad ootuspäraselt |
| 7 | Eraldi väikesed muudatused: metadata-loader, logimine, taustatööde olek | igaühel oma leping ja asjakohased regressioonitestid |
| 8 | Lint-kommentaar ja kasutamata Tailwindi plugin | lint/build rohelised, lint-lävi ei tõuse |
| 9 | Fassaadide tarbijate järkjärguline migreerimine | patch'imise semantika säilib, tarbijate puudumine enne eemaldamist |
| 10 | `strictNullChecks` ja hiljem ülejäänud strict-reeglid | mõõdetud diagnostika ja võla kasvu tõkestav CI |

Algne „kõik P0-d alla tööpäeva” hinnang oli liiga kindel: vanade image'ite/logide
käsitlus ja major-sõltuvuse ühilduvus võivad olla suuremad kui lähtekoodiparandus.
Kolme eri vastutusega refaktorit ei tasu koondada üheks muudatuseks.

---

## 7. Järelkontrolli metoodika ja piirid

Kontrollisin Dockerit, Compose'i, CI-d, sõltuvusdeklaratsioone, TS/ESLint seadeid,
vearaporti mõlemat puhastuskihti ja testi tegelikku ulatust, taustatööde
käivitajaid/heartbeat'i, metadata-loader'eid, fassaadi patch'imismehhanismi,
kolme viidatud Python-skripti ning MapLibre tegelikku kasutuskohta.
Lugesin ADR-registrit ja saladuste käsitlust puudutavat ADR 0021.

**Uuesti käivitatud kontrollid:**

- `npm run typecheck`: edukas.
- `npm run lint:ci`: edukas, 43 hoiatust, 0 viga.
- `npm test`: 117 faili, **1184 testi edukad** (algse ülevaate 1174 on aegunud).
- `.venv/bin/pytest tests/ mcp/tests/ -q`: katkestatud pärast mitmeminutilist
  edenemiseta ootamist (60 edupunkti, lõppkokkuvõtet ei tulnud). Kogu Pythoni
  testikomplekti rohelisust järelkontroll **ei kinnita**. Diagnostiline kordus
  (`timeout -s INT 40`, `-vv -o faulthandler_timeout=15`) lokaliseeris ootamise
  testi `test_ada_duplicate_warning.py::test_lookup_hoiatab_kui_handle_juba_olemas`
  fixture'i: `tests/conftest.py:173`, Starlette `TestClient.__enter__`, AnyIO
  lõimedevahelise kutse ootel. Põhjus (keskkond või kood) jäi tuvastamata;
  seda ei saa esitada läbitud ega kinnitatud rakenduse veana.
- `timeout -s INT 45 .venv/bin/pytest tests/test_client_errors.py -q
  -o faulthandler_timeout=15`: **17 testi edukad** (0,50 s).
- `npm run build`: edukas; üle 500 kB chunk'ide hoiatus jäi alles.
- `npm audit --omit=dev --json`: blokeeritud DNS-veaga `EAI_AGAIN`; see ei ole puhas audit.
- TS/Python puhastuse sünteetilised vastunäited ning AST-põhine erandiharude loendus.

**Piirid:** ei ühendunud tootmisserveriga ega kontrollinud registry't, tootmise
image'i, tegelikke runtime-andmeid või GitHubi branch protection'i. Ei lugenud
`.env` väärtusi ega skaneerinud võtmeid või kogu git-ajalugu. Ei korranud algse
ülevaate koodimahu/duplikaatide mõõtmist, HTML-fuzzimist ega visuaalset kaarditesti.
Algse ülevaate väide „CI on PR-idel kohustuslik” ei ole pelga workflow põhjal
tõendatud: käivitustingimused ja merge'i blokeerivad nõuded on eri asjad.
Testide arv ega testikoodi maht ei ole koodikatvuse mõõtmine.


## 8. Rakendatud turvaparandused (2026-09-15)

### Vearaportite puhastus

- TS ja Python kontrollivad nii päringut kui ka fragmenti, kodeeritud
  võtmenimesid/väärtusi ning pesastatud URL-e. Dekodeerimise piir on neli sammu;
  vigane või sügavam kodeering eemaldatakse. Pesastatud ohtlik kodeeritud lõik
  eemaldatakse tervikuna, mitte ei saadeta uuesti kodeeritud saladust edasi.
- Tavalised diagnostilised parameetrid (`view=map`, `related_to`) ja ohutud
  UTF-8 otsingusõnad säilivad. Puhastus toimub enne pikkusepiiri rakendamist.
- Mõlemad keeled kasutavad 23 juhuga ühist testikorpust
  `tests/fixtures/client_error_scrub.json`; testid kontrollivad ka idempotentsust.
- Server puhastab vana logi lugemisel, eemaldab tundmatud väljad ja vigased
  kirjed ning kirjutab puhastatud logi atomaarse asendusega tagasi.
  Kirjutustõrke korral näeb admin siiski ainult puhastatud koopiat ja server
  logib hoiatuse. Käivitamisel tehakse see enne päringute vastuvõtmist eraldi
  I/O-lõimes; tühistatud või vigaseid tokeneid logis eraldi ei säilitata.
- See ei kustuta varukoopiaid ega tühista varem logitud kehtivaid tokeneid.
  Nende käsitlus sõltub tegelikust varasemast kokkupuutest.

### MapLibre

- `maplibre-gl` 5.24.0 → **6.9.1** ja Leafleti adapter 0.1.3 → **0.1.4**
  (adapter deklareerib 6.x toe). Uuendatud on ka lukufail.
- `HistoricalMapLayer` paint-abifunktsiooni võtmetüüp tuleb nüüd otse
  `MapLibreMap.setPaintProperty` allkirjast; 6.x rangem tüübikontroll läbib.
- Regressioonitest kasutab paigaldatud teegi päris `AttributionControl`-i:
  järjestikused `onload`/`ontoggle` atribuudid eemaldatakse, ohutu allikaviide säilib.
- Chrome'is kontrollitud päris `HistoricalMapLayer` koos välise OHM-stiiliga:
  renderdus, aastavahetus 1650 → 1750, suumimine, kihi eemaldamine/taastamine ja
  attributsioon. Brauseri vigu/hoiatusi ei tekkinud. Piirkondade API oli lokaalses
  testvaates asendatud tühja testvastusega; tootmisandmeid ega kasutajaseanssi ei muudetud.
- `npm audit --omit=dev`: **0 critical**, MapLibre'i leidu pole. Alles on
  3 high ja 1 moderate muudes pakettides; kogu sõltuvuspuu ei ole leiuvaba.

### Lõppkontroll

- Backendi ja MCP ühiskäivitus: **2543 testi läbis**, 8 konfiguratsiooniga välja
  jäetud (102 s). Lõpliku vealogikoodi eraldi kontroll: **66 testi läbis**, sh
  käivitusaegse puhastuse ning I/O-lõime test. Varasem TestClienti hangumine
  piiratud keskkonnas ei kordunud väljaspool seda.
- Frontend: **1208 testi / 118 faili läbis**; typecheck, lint (43 hoiatust,
  0 viga) ja build koos eelkompressiooniga läbisid.
- MapLibre'i brauserikontroll ja turvaaudit on kirjeldatud ülal.

### Rakendamine

Muudatused vajavad nii backendi uuendamist (`server_update.sh --no-cache`)
kui ka uue frontendi `dist/` avaldamist koos `.br`/`.gz` failidega.
Ainult backendi uuendamine ei vii MapLibre'i uut versiooni kasutajate brauserisse.
Tootmisse juurutamine jääb kasutaja valitud hooldusajale.
