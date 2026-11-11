# VUTT kiiruse, töökindluse ja turvalisuse ülevaade (2026-11-10)

**Kuupäev:** 2026-11-10
**Aluseks olev seis:** `82bb2b37` (haru `spike/eksemplari-leht-proto`; `main` = `2080f193`)
**Varasemad ülevaated:** `2026-07-09-skaleerimise-ulevaade.md`, `2026-09-24-koodibaasi-koondylevaade.md`,
`2026-09-27-turva-ja-andmelekke-ulevaade.md`, `2026-10-16-turva-ja-koodibaasi-ulevaade.md`

**Raamistus:** andmed on valdavalt üle 100 aasta vanad, suurt saladust ei ole. Tähtis on,
et (a) toimetajate töö ei kaoks ja teenus püsiks, (b) kiirus ja mugavus hoiaksid inimesi
tegutsemas. Turvaleide on hinnatud selle järgi, mitte maksimaalse ranguse järgi.

**Meetod ja piirid:** koodi lugemine + avaliku saidi mõõtmine väljast (`curl`, anonüümne
Meili token). Lõigud 1–3 on kirjutatud ENNE serverisse pääsu; serveris kontrollitu on
lõigus 4. Dashboardi päringuid päris andmetega ei mõõdetud.

---

## 0. Koondtabel

| ID | Teema | Liik | Kaal | Seis |
|---|---|---|---|---|
| **N10-01** | Piiratud teose pildid `no-store` → iga lehepööre laeb ~2 MB uuesti, eellaadimine topelt | kiirus | kõrge | avatud — #757 |
| **N10-02** | Töölaud näitab alati täissuuruses skaneeringut (vahevarianti ei ole) | kiirus | keskmine (featuur) | avatud — #758 |
| **N10-03** | Isikuloend parsib `prosopography_index.json` igal päringul | kiirus / GIL | keskmine | avatud — #759 |
| **N10-04** | Iga salvestus saadab Meilisse kogu teose | kiirus | madal | mõõdetud 2026-11-11, ei tehta — #760 (suletud) |
| **N10-05** | IP-põhised piirangud pöördproksi taga võivad olla kõigi peale ühised | töökindlus | madal | **ei kinnitunud** (lõik 4); NAT-i juhtum **parandatud** — #762 / PR #765 |
| **N10-06** | Sessioonid ainult mälus; 24 h sisselogimisest, mitte tegevusest | mugavus | keskmine | avatud — #761 |
| **N10-07** | Konto lukustus kõrvalisele kättesaadav (kasutajanimed avalikud) | töökindlus | madal | **parandatud** — #762 / PR #765 ((konto, IP) lävi 10, kontoülene 50) |
| **N10-08** | Varukoopia ühes asukohas; taasteproov; sihtkausta õigused | töökindlus | keskmine | varundus töötab (lõik 4); õigused parandatud 2026-11-10; teine asukoht ja taasteproov avatud (#763) |
| **N10-09** | Sessioonitoken URL-is (`?token=`) → nginxi access-logi | turve | madal | **parandatud** — #764 / PR #765 (lühiajaline pilet, `?token=` eemaldatud; lisandus neljas koht `workPagePreviewUrl`) |
| **N10-10** | Ujuvad Docker-tagid (`meilisearch:v1`, umami `latest`) | töökindlus | madal | avatud — #764 |
| **N10-11** | Vite dev-server `host: '0.0.0.0'` tunneli ajal | turve | madal | **parandatud** — #764 / PR #765 |

---

## 1. Kiirus

### N10-01 — piiratud teose pilte ei puhverdata

`server/image_server.py:463`:

```python
self._cache_policy = ('public, max-age=0, must-revalidate'
                      if is_work_public(meta) else 'no-store')
```

Muutus tuli #423-ga (fail-closed pildiserver). Tagajärg:

- **Piiratud teos:** brauser ei tohi pilti hoida. Iga lehepööre laeb skaneeringu uuesti ja
  `useAdjacentPagePrefetch` (`new Image()`) tõmbab kõrvallehed ette, mida siis päris
  pöördel uuesti laetakse → topeltliiklus. Sama kehtib pisipildiruudustikule.
- **Avalik teos:** iga kasutus teeb tingimusliku päringu. Mõõdetud 304 = ~14 ms, seega
  võit siin väike.

Mõõdetud (avalik sait, 10 lehte): skaneering keskmiselt **1952 KB**, max 3291 KB, min 630 KB.

**Parandus:** piiratud teosele `private, max-age=3600` (või kuni allkirja `exp`-ini).
Allkirjastatud URL (`?exp=&sig=`) on niikuinii 1 h kehtiv kandjavolitus; `private` hoiab
ta jagatud vahemäludest väljas. Avalikule võib kaaluda `max-age=300…600` — pildi
asendus samas seansis kannab juba `?v=` (`Workspace.tsx:372`).

**Dokumentatsiooni triiv:** `src/hooks/useAdjacentPagePrefetch.ts` („`max-age=86400`,
nginx 30 p") ja `src/services/workImageService.ts` („pildid on 30 päeva brauseri-cache'is")
kirjeldavad #423-eelset seisu.

### N10-02 — vaatamiskuju puudub

`src/components/ImageViewer.tsx` saab ühe `src`-i = 300 DPI originaal. Vahevariant
(~1600 px, hinnanguliselt 300–400 KB) + täisresolutsioon alles suumimisel oleks
koduühendusega toimetajale kõige tuntavam kiirendus. Eraldi featuur (issue), mitte
kiirparandus; sama muster on isikupiltidel juba olemas (`image_variants.py`, #424).

### N10-03 — isikuindeks parsitakse igal päringul

`server/prosopography/person_search.py:349` — `_filter_index_entries` kutsub
`_load_index()` (`indices.py:106`, paljas `json.load`) igal `/prosopography`,
`/facets`, `/map` päringul; relevantsusotsing loeb lisaks `person_aliases.json`-i
(`person_search.py:474`, kommentaari järgi 350 KB).

Mõõdetud TTFB väljast (võrdluseks `/health` = 15 ms):

| Päring | TTFB |
|---|---|
| `/prosopography?limit=48` | ~100 ms |
| `…&q=lud&sort_by=relevance` | ~165 ms |
| `/prosopography/map` | ~110 ms |
| `/prosopography/facets` | ~67 ms |

`json.load` hoiab GIL-i → ühe uvicorn-workeri juures seisavad selle aja kõik teised
päringud (ka `/save`). PersonsPage teeb filtrimuutusel mitu sellist päringut.

**Parandus:** mtime-võtmega vahemälu nagu `network.py` `_cached(...)`. NB: tagastatavat
struktuuri ei tohi kutsuja muteerida (kontrollida `_filter_index_entries` järeltöötlust).

### N10-04 — salvestus indekseerib kogu teose

ADR 0013 teadlik otsus; sünk peab jääma kettapõhiseks ja idempotentseks. Kooskõlas
variant: sünk ehitab kõik dokumendid nagu praegu, aga saadab ainult need, mille räsi
erineb viimati saadetust (protsessi-lokaalne räsitabel; tühi tabel = saada kõik).
Ette võtta ainult siis, kui pika teose indekseerimisviivitus päriselt häirib.

**Mõõdetud 2026-11-11 — ei tehta** (#760, suletud „not planned"; täismõõtmine issue's).
Suurim teos 706 lehte: dokumentide ehitus 0,19 s. Meili tegelik indekseerimine
(935 tavasünki, nädal): mediaan 0,63 s, 252 dokumenti ~2,5 s; `/save` ei oota seda.
Aeglaseimad (kuni 57 s) olid 9–11 dokumendiga — külmkäivitus/taustatöö, mitte
dokumentide arv, delta ei aitaks. Uuesti üles võtta ainult uue mõõtmisega.

### Mis on korras

- Meili: `disputatio` 10 ms, prefiks `orat` 76 ms, fraas 65 ms, lehe lugemine 1 ms.
- Esmalaadimine ~265 KB gzip (index 90 + vendor-react 93 + locale 38 + css 33 + icons 11);
  Workspace 168 KB, Statistics 110 KB, kaart 283 KB laisalt.
- `/save`: native git (~0,15 s), no-op salvestus, Meili sünk taustal.
- Avalikud registrid 15–50 ms (5 min vahemälu).

---

## 2. Töökindlus ja kasutusmugavus

### N10-05 — IP-põhised piirangud pöördproksi taga

`server/config.py:298` ja `nginx.host.conf:166` ütlevad, et ülikooli pöördproksi taga
paistavad eri kliendid sama lähte-IP-ga. Kui see kehtib kogu liikluse kohta:

- nginxi `limit_req` tsoonid (`vutt_api` 10 r/s, `vutt_meili` 20 r/s, `vutt_images`
  60 r/s, `vutt_auth` 1 r/s; võti `$binary_remote_addr`) on **kogu kasutajaskonna ühine
  eelarve**, mitte kasutaja oma;
- rakenduse `/login` lagi 5/60 s (`RATE_LIMITS`, võti `get_client_ip` = `X-Real-IP` =
  `$remote_addr`) loeb ka õnnestunud sisselogimisi (`check_rate_limit` lisab iga päringu)
  → seminarirühm ei saa korraga sisse; üks võõras saab 5 päringuga minutis sisselogimise
  kõigil kinni hoida. Sama `/register`, `/reset/*`, `/download`, `/client-error`.

**Kontroll:** hosti access-logis `$remote_addr` jaotus. **Parandus (kui kinnitub):**
`set_real_ip_from <proksi>; real_ip_header X-Forwarded-For;` hosti nginxis (+ koopia
`nginx.host.conf`-i). Tulemus lõigus 4.

### N10-06 — sessioonid mälus

`server/auth.py:25` (`sessions = {}`), püsisalvestust ei ole. Iga backend-deploy logib
kõik välja; `SESSION_DURATION` loetakse `created_at`-ist (`auth.py:403`), mitte viimasest
tegevusest → toimetaja kukub välja keset tööd täpselt 24 h pärast sisselogimist.

**Parandus:** sessioonid `state/`-i (tokeni SHA-256, mitte toortoken) + libisev aegumine
ülempiiriga. ADR 0046 (sessioon on õiguste ainus tõde) jääb kehtima —
`delete_user_sessions` peab ka faili puhastama.

### N10-07 — konto lukustus

`rate_limit.py`: 10 ebaõnnestumist / 15 min lukustab konto. Kasutajanimed on avalikud
(lehe kommentaarid, ajalugu Meili dokumentides). Sihitud tüütamine on võimalik,
tõenäosus väike. Teadmiseks; leevendus oleks lukustada (konto, IP) paar pärast N10-05
lahendamist.

### N10-08 — varundus

`docs/vutt-backup.md`: tõmmatav, iga päev, `--keep-days 365`, VUTT-il ei ole
kirjutusõigust koopiatele — hea. Lahtine: üks asukoht samas ülikooli võrgus (`loss`,
mis on ühtlasi OCR-server), taasteproovi kohta märget ei ole, `healthcheck`-URL-i
seadistus teadmata. Tulemus lõigus 4.

---

## 3. Turvalisus

Varasemate ülevaadete leiud on suletud; uut olulist ei leitud. Kontrollitud: `npm audit
--omit=dev` = 0 haavatavust; paroolid bcrypt (+ ajastuse võrdsustus); CSP `script-src
'self'`; pildiserveri teekontroll; eksemplaride (ADR 0076/0079) otspunktide õigused;
välispäringutel timeout; Dockeri logirotatsioon ja `127.0.0.1` pordid.

Lehe kommentaarid on anonüümsele Meili kaudu loetavad — see on kooskõlas UI-ga
(kommentaaripaneel on nähtav kõigile), mitte leke.

### N10-09 — token URL-is

`src/pages/upload/uploadApi.ts:528`, `src/pages/upload/components/UploadStepReview.tsx:25`,
`src/pages/manage/trashGrouping.ts:26` panevad 24 h kehtiva admin-sessioonitokeni
`<img src>` päringustringi; `/api/files/admin/` access-log on sees. Puhtam: lühiajaline
HMAC-allkiri nagu lehepiltidel (`_validate_image_token`).

### N10-10 — ujuvad image-tagid

`docker-compose.yml`: `getmeili/meilisearch:v1`, `ghcr.io/umami-software/umami:postgresql-latest`.
`server_update.sh` neid ei tõmba, aga käsitsi `pull` või uus host võib Meili versiooni
olemasoleva andmekausta alt ära nihutada (Meili keeldub siis käivitumast kuni
dump/upgrade'ini). Kinnitada täpne versioon.

### N10-11 — dev-server kuulab kogu võrku

`vite.config.ts:18` `host: '0.0.0.0'`. Tunneli ajal on tootmise backend (8002, 7700)
kohtvõrgust kättesaadav nginxi piiranguteta ja `X-Real-IP` on võltsitav
(`rate_limit.get_client_ip`, vt ka `docs/tegemata_tood.md`). `localhost` oleks ohutum.

---

## 4. Serveris kontrollitu

Loetud 2026-11-10 ~14:00 (`ssh vutt`, `ssh loss`, ainult lugemine).

### Host

4 tuuma, 16 GB (kasutusel 1,7 GB), koormus 0,02; ketas 145 GB, 64 % täis (51 GB vaba).
Konteinerid: backend 228 MB, pildiserver 56 MB, Meili 1,5 GB (**1.33.1**), umami 363 MB.
Hosti nginxi sait = repo `nginx.host.conf` (kommentaarideta võrdlus identne).
Ressursipuudust ei ole — kitsaskoht on ühe protsessi GIL, mitte raud.

### N10-05 — kliendi-IP: EI KINNITUNUD

Access-logi viimased 20 000 rida (00:00–13:56): `$remote_addr` on eristuv — välised
kliendid tulevad oma avaliku IP-ga, sisevõrgu omad sisevõrgu aadressiga. Kolm
suurimat allikat: arendaja enda masin (3802 rida — Firefox/Linux + `python-requests` +
`curl`), üks sisevõrgu Windowsi kasutaja ja seireteenus. `real_ip`
seadistust ei ole ega ole vaja. 429-sid kõigis säilinud logides 43, kõik kahelt Google
Cloudi IP-lt (robotid); backend-logis 72 h jooksul 1 piirangu-/lukustusrida.

Järeldus: piirangud on kasutajapõhised, nagu mõeldud. Alles jääb ainult klassikaline
NAT-juhtum (seminarirühm ühe IP taga: `/login` 5/60 s loeb ka õnnestunud sisselogimisi).
Odav leevendus: ära loe õnnestunud sisselogimist IP-eelarvesse. `config.py:298` ja
`nginx.host.conf:166` kommentaar „pöördproksi taga sama IP" tasub täpsustada — praeguse
logi järgi kehtib see heal juhul osale liiklusest.

### N10-03 — indeksi suurus

`prosopography_index.json` **3,39 MB**, `person_aliases.json` 396 KB,
`person_to_works.json` 266 KB. 3,4 MB JSON-i parsimine iga isikuloendi päringu peale
seletab mõõdetud ~100 ms; leid kehtib.

### `data/` git

25 392 commiti, 223 153 objekti 26 pakis (137 MB), 1014 lahtist objekti, indeks 14 MB.
Ajastus (`GIT_OPTIONAL_LOCKS=0`): `diff --cached --quiet` 0,02 s, `cat-file -e` 0,00 s,
`status --porcelain` 0,29 s. Salvestustee on kiire; `feature.manyFiles` vms häälestust
praegu vaja ei ole. `2026-07-09` ülevaate 1.6 („sujuv aeglustumine") ei ole veel käes.

### N10-08 — varundus (`loss`)

- Töötab: 102 snapshot'i, viimane `20261110T011501Z` (cron 03:15, `--keep-days 365`),
  `healthcheck`-URL on seadistatud, viimase jooksu logi puhas. Viimase snapshot'i
  `data/` HEAD = 2026-11-09 15:13. Ketas 1,7 TB, 32 % täis.
- Varukoopiate juurkaust ei olnud 700, nagu `docs/vutt-backup.md` nõuab (sees on
  `state/`). **Parandatud 2026-11-10** (`chmod 700`).
- Endiselt üks asukoht (sama ülikooli võrk, sama masin mis OCR) ja taasteproovi kohta
  märget ei ole.

### Muu

- `state/` on 700 `meelisf`, `.env` 600 — korras (S27-01 püsib).
- nginx `worker_connections 768`, `server_tokens off`. `ssl_session_cache`-i ega
  `keepalive`-häälestust `nginx.conf`-is ei ole (vaikeväärtused) — mõõdetud TTFB 12–17 ms
  juures ei ole see probleem.
