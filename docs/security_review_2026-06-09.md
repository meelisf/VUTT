# Security review: SEO ja avaliku indekseerimise järel

Kuupäev: 2026-06-09

## Ulatus

Review keskendus rünnakupinnale, mis kasvas pärast `sitemap.xml` ja botidele mõeldud dünaamilise meta-HTML lisamist. Vaadatud alad:

- sitemap ja `/meta/work/{work_id}` SEO endpointid;
- avalikud API endpointid;
- Meilisearchi tokenid ja `/meili/` proxy;
- pildiserveri ligipääsukontroll;
- nginx host-konfiguratsioon ja rate limiting;
- frontend XSS/CSP riskid.

Teadlik disainiotsus: kollektsioonita teosed on avalikud. Seda ei käsitleta selles dokumendis veana.

## Kokkuvõte

Kõige olulisemad riskid ei ole sitemap XML-i genereerimises endas, vaid selles, et Google'i nähtavus muudab varem raskemini leitavad avalikud pinnad aktiivsemalt külastatavaks ja kraabitavaks. Sitemap filtreerib teosed läbi `is_work_public()` loogika, kuid avaliku domeeni otsinguliiklus suurendab survet Meilisearchile, registri-endpointidele, bot-meta endpointile ja pildiserverile.

## Kriitilised / kõrge prioriteet

### 1. Produktsioonis ei tohi kasutada vaikimisi saladusi

**Mõju:** Kui produktsioon käivitub vaikimisi väärtustega, on Meilisearchi master key ja pildi-HMAC saladus teadaolevad. Kuna host nginx proxib `/meili/` avalikult ja edastab `Authorization` päise, on vaikimisi `MEILI_MASTER_KEY` kriitiline risk: ründaja saaks Meilisearchi admin API-d kasutada. Vaikimisi `IMAGE_TOKEN_SECRET` võimaldaks restricted/shareable pilditokenite võltsimist.

**Asukohad:**

- `docker-compose.yml` - `MEILI_MASTER_KEY=${MEILI_MASTER_KEY:-vutt_master_key}`
- `docker-compose.yml` - `IMAGE_TOKEN_SECRET=${IMAGE_TOKEN_SECRET:-dev-image-secret-change-in-production}`
- `docker-compose.yml` - `UMAMI_DB_PASSWORD` ja `UMAMI_APP_SECRET` kasutavad samuti vaikimisi väärtusi
- `server/config.py` - `IMAGE_TOKEN_SECRET` fallback
- `nginx.host.conf` - `location /meili/` proxib Meilisearchi avalikult

**Soovitus:**

- Tootmises failida startup, kui `MEILI_MASTER_KEY`, `MEILI_SEARCH_KEY`, `MEILI_SEARCH_KEY_UID`, `IMAGE_TOKEN_SECRET`, `UMAMI_DB_PASSWORD` või `UMAMI_APP_SECRET` puuduvad või võrduvad teadaoleva defaultiga.
- Hoida Meilisearchi write/admin API ainult localhosti/sisevõrgu taga. Avalik `/meili/` peaks aktsepteerima ainult search key või tenant tokeniga otsinguid.
- Dokumenteerida deployment checklistis, et defaultidega käivitus on lubatud ainult lokaalses arenduses.

### 2. `shareable` ei ole privaatne link, vaid anonüümne teose ligipääs

**Mõju:** `shareable=True` korral lubab backend anonüümse lugemise. `/work/{work_id}/viewer-token` annab seejärel anonüümsele kasutajale work-scoped Meilisearchi tokeni ja pildi HMAC andmed. See ei pane teost sitemap'i, kuid igaüks, kes teab või saab kätte `work_id`, võib teose avada. Link võib lekkida referrerite, chatide, logide või kasutajate jagamise kaudu ning otsimootor võib selle hiljem leida.

**Asukohad:**

- `server/access_ops.py` - `can_read_work()` lubab `shareable` teose anonüümselt.
- `server/main.py` - `POST /work/{work_id}/shareable` lubab editoril lippu muuta.
- `server/main.py` - `GET /work/{work_id}/viewer-token` väljastab work-scoped tokenid.
- `server/image_server.py` - restricted/shareable piltidele piisab HMAC parameetritest.

**Soovitus:**

- Otsustada ja dokumenteerida semantika: kas `shareable` tähendab "avalik, kuid sitemapist väljas" või "privaatne salalink".
- Kui eesmärk on salalink, lisada eraldi juhuslik jagamistoken, mitte tugineda ainult `work_id`-le.
- Kaaluda `shareable` muutmise õiguse tõstmist adminile või nõuda editori toimingule selgemat UI hoiatust.

## Keskmine prioriteet

### 3. Avalikud registri- ja prosopograafia endpointid suurendavad OSINT pinda

**Mõju:** Rakendus ei avalda ainult sitemapis olevaid teoseid. Mitmed registrid ja prosopograafia endpointid on anonüümsed. Kui nendes andmetes on pooleliolevaid kirjeid, sisemisi märgendeid, isikuandmeid, koordinaate või adminitöö käigus tekkinud abivälju, muutub see kraabitavaks sõltumata sitemapist.

**Asukohad:**

- `server/main.py` - avalikud `GET /collections`, `/config/archives`, `/vocabularies`, `/people-aliases`, `/people-register`, `/entity-labels`.
- `server/prosopography/router.py` - avalikud list, query, map, facets, relation-type suggestions, work-relations, person images, places ja Wikidata lookup endpointid.

**Soovitus:**

- Kirjeldada "avaliku andmelepingu" dokumendis, millised registrid on teadlikult avalikud.
- Kui kõik registriväljad ei ole mõeldud avalikuks tarbimiseks, teha endpointidele public DTO/filter.
- Lisada prosopograafia ja places endpointidele rate limit, eriti list/query/map/facets ja välisallika proxy päringutele.

### 4. CSP on nõrk ja testide eeldus ei vasta host-konfile

**Mõju:** Host nginx CSP lubab `script-src 'unsafe-inline'` ja `style-src 'unsafe-inline'`. See suurendab XSS-i mõju, eriti kuna rakenduses on vähemalt üks `dangerouslySetInnerHTML` kasutus transkriptsioonijuhendi kuvamiseks. Testis on kommentaar/eeldus, et `unsafe-inline` on eemaldatud, kuid host-konfis see on endiselt olemas.

**Asukohad:**

- `nginx.host.conf` - `Content-Security-Policy` sisaldab `unsafe-inline`.
- `src/components/TextEditor.tsx` - transkriptsioonijuhend renderdatakse `dangerouslySetInnerHTML` kaudu.
- `tests/test_security_fixes.py` - CSP test otsib serveri `/etc/nginx/sites-available/vutt` seisu, mitte repo `nginx.host.conf` sisu.

**Soovitus:**

- Eemaldada `script-src 'unsafe-inline'` või asendada nonce/hash põhise CSP-ga.
- Kui inline style'id on vältimatud, hoida vähemalt `script-src` rangem.
- Muuta test nii, et repo konfiguratsioon ja produktsiooni konfiguratsioon ei läheks märkamatult lahku.
- Hoida `dangerouslySetInnerHTML` ainult rangelt staatilise, kontrollitud HTML-i jaoks; kasutajasisu korral kasutada sanitizerit.

### 5. Rate limiting on ebaühtlane

**Mõju:** `/meta/work` ja `/download` on serveris piiratud ning `/api/files/` on host nginxis üldiselt piiratud. Samas `/meili/`, `/api/files/api/meili-token`, sitemap ja osa prosopograafia endpointidest ei paista omavat konkreetset limiiti. Avalik otsing ja Google'i nähtavus teevad kraapimise lihtsamaks.

**Asukohad:**

- `server/config.py` - rate limitid on määratud ainult osale endpointidest.
- `server/main.py` - `/api/meili-token` väljastab anonüümse Meilisearchi tokeni.
- `nginx.host.conf` - `/api/files/` on piiratud, `/api/files/admin/` mitte, `/meili/` mitte.
- `server/prosopography/router.py` - avalikud list/query/map/facets endpointid.

**Soovitus:**

- Lisada nginxis eraldi `limit_req` `/meili/` jaoks.
- Lisada serveris limiit `/api/meili-token`, `/sitemap.xml`, prosopograafia list/query/map/facets ja välisallika proxy endpointidele.
- Cache'ida sitemap tugevalt ja kaaluda bot-meta HTML-i agressiivsemat cache'i avalikele teostele.

## Madalam prioriteet / kinnitatud tugevused

### 6. Bot-meta HTML escape'imine on üldiselt korrektne

`server/metadata_handler.py` kasutab HTML escape'imist pealkirja, kirjelduse, canonical URL-i, Dublin Core meta tagide ja body väljade jaoks. See vähendab SEO HTML-i XSS riski.

**Jälgida:** `work_id` kasutatakse URL-is. Praegu escape kaitseb HTML kontekstis, kuid URL-i komponendina oleks korrektsem kasutada URL encodingut.

### 7. Põhilised lugemisrajad kontrollivad ligipääsu

`/download/{work_id}`, `/meta/work/{work_id}` ja pildiserveri restricted pildid kontrollivad ligipääsu `can_read_work()` või pildi-HMAC kaudu. See on hea baas. Peamised riskid tulenevad pigem õiguste semantikast (`shareable`) ja produktsiooni saladustest.

## Soovitatud tööjärjekord

1. Lisada produktsiooni startup check default-saladuste vastu.
2. Otsustada ja dokumenteerida `shareable` täpne semantika; vajadusel lisada salalingi token.
3. Lisada `/meili/` ja prosopograafia endpointidele rate limit.
4. Tugevdada CSP-d ja viia testid repo/prod konfiguratsiooniga kooskõlla.
5. Kaardistada avalikud registrid ning eemaldada või filtreerida väljad, mis ei pea olema avalikud.

---

## Ülevaate järelkommentaarid (2026-06-09)

### Leid 1 + leid 2 on seotud

Leid 1 (vaikimisi `IMAGE_TOKEN_SECRET`) ja leid 2 (shareable pildid) on omavahel seotud: `image_server.py` kontrollib `meta.get('shareable', False)` ja laseb anonüümse ligipääsu läbi HMAC valideerimata. Kui `IMAGE_TOKEN_SECRET` on vaikimisi teadaolev väärtus, saab ründaja luua kehtivaid HMAC tokene ka restricted teostele. Need kaks leidu tuleks parandada koos.

### Leid 2 — shareable semantika selgitatud

Otsus tehtud: `shareable` tähendab "avalik, kuid sitemapist väljas" — tekst ja pildid on anonüümselt loetavad. See on kavandatud käitumine.

**Ligipääsu tühistamine** toimib järgmiselt:
- Tekstisisu (`/download`, leheküljed): `can_read_work()` loeb `shareable` lipu igal päringul `_metadata.json`-ist → ligipääs katkeb koheselt.
- Pildid (`image_server.py`): sama loogika, kohene katkestus.
- **Erand:** viewer-token sisaldab pildi HMAC-i `exp = now + 3600`. Kui kasutaja sai tokeni enne privaatseks muutmist, töötavad pildid veel kuni 1 tund. Aktsepteeritav kompromiss, kuid tasub teada.

### Leid 3 — prosopograafia ja kohtade register

`/prosopography/{person_id}/image` on anonüümselt avalik (`router.py:361`, kommentaar "avalik") — see on kavandatud käitumine.

Prosopograafia ja kohtade registri avalikkus on digitaalhumanitaaria platvormil tõenäoliselt teadlik otsus (andmed on projekti väärtus). Rate limit on mõistlik, aga DTO filter oleks üleliigne töö minimaalse kasuga.

### Leid 4 — dangerouslySetInnerHTML on laiem kui review kirjeldab

Review mainib ainult `TextEditor.tsx` (`transcriptionGuideHtml`). Tegelik olukord:

**Madala riskiga (kontrollitud sisu):**
- `TextEditor.tsx:936` — `transcriptionGuideHtml` tuleb staatilisest `dist/` failist, mitte kasutajasisendist. Ohutu.
- `Dashboard.tsx:986` — `aboutHtml` tuleb samuti staatilisest failist (`/about*.html`). Ohutu.

**Kõrgema riskiga (kasutajasisend):**
- `SearchResults.tsx:218` — `comment.text` renderdatakse HTML-ina, kui see sisaldab Meilisearchi `<em>` highlight-märgendeid. Kommentaarid on autentitud kasutajate sisestatud sisu. Autentitud kasutaja saab sisestada HTML-i kommentaari → see indekseeritakse → teisele kasutajale renderitakse `dangerouslySetInnerHTML`-iga. `unsafe-inline` CSP + see vektor = XSS risk, kuigi ainult autentitud kasutajate kaudu.
- `WorkspaceMobileView.tsx:285` — `renderVuttMarkup(page.text_content)` renderdab transkriptsiooni sisu. Tuleks kontrollida, kas `renderVuttMarkup` saniteerib väljundi.

---

## Järelkontrolli täiendused ja lisaleidude analüüs (2026-06-09 - Antigravity)

Oleme teostanud täiendava koodibaasi turvaauditi ja koodi analüüsi, mille käigus valideerisime algses raportis toodud leide ning tuvastasime uusi kõrge ja keskmise prioriteediga turvariske. Koodi ei ole selle analüüsi käigus muudetud.

### 1. Valiidsuse kinnitused koodis

* **Leid 1 (Saladused):** Kinnitatud. Failis [docker-compose.yml](file:///home/mf/LLM/VUTT/docker-compose.yml#L10-L13) on kasutusel vaikimisi test-saladused (nt `vutt_master_key` ja `dev-image-secret-change-in-production`). Koos failiga [nginx.host.conf](file:///home/mf/LLM/VUTT/nginx.host.conf#L130-L135) (mis suunab Meilisearchi `/meili/` kaudu avalikkusele koos `Authorization` päisega) on see kriitiline risk.
* **Leid 2 (shareable ligipääs):** Kinnitatud. Failides [access_ops.py](file:///home/mf/LLM/VUTT/server/access_ops.py#L25) (funktsioon `can_read_work`) ja [image_server.py](file:///home/mf/LLM/VUTT/server/image_server.py#L60) (funktsioon `_check_image_access`) lubatakse `shareable=True` korral anonüümset lugemist. viewer-token aegumine (1 tund) on ainus ligipääsu kustumise aegviide.

### 2. Täiendavad ja laiendatud leiud (Järelkontrolli lisandus)

#### Leid A: Atribuutide filtreerimise puudumine `renderVuttMarkup` funktsioonis (Kõrge prioriteet)
* **Asukoht:** [renderVuttMarkup.ts](file:///home/mf/LLM/VUTT/src/utils/renderVuttMarkup.ts#L20) ja [WorkspaceMobileView.tsx](file:///home/mf/LLM/VUTT/src/components/mobile/WorkspaceMobileView.tsx#L285)
* **Mõju:** Funktsiooni `renderVuttMarkup` regex eemaldab küll tundmatud XML/HTML tagid, kuid lubab whitelistitud elemendid (`strong`, `em`, `span`, `mark`, `sup`, `hr`) läbi koos kõigi nende atribuutidega. See tähendab, et sisend nagu `<span onclick="alert(1)">kliki siia</span>` renderdatakse ilma puhastamata ja koos CSP reegliga `'unsafe-inline'` viib see DOM-põhise XSS haavatavuseni mobiilivaates.

#### Leid B: Kasutajate kommentaaride renderdamine ilma saniteerimiseta (Kõrge prioriteet)
* **Asukoht:** [SearchResults.tsx](file:///home/mf/LLM/VUTT/src/pages/search/SearchResults.tsx#L218)
* **Mõju:** Otsingutulemustes renderdatakse kasutajate endi poolt sisestatud kommentaare (`comment.text`) otse läbi `dangerouslySetInnerHTML`. Seda tehakse selleks, et Meilisearchi poolt esiletõstmiseks lisatud `<em>` tagid töötaksid. Kuna aga kommentaari sisestamisel ja salvestamisel puudub HTML-i puhastamine, saab pahatahtlik toimetaja sisestada Stored XSS koodi (nt `<img src=x onerror=... >`), mis käivitub automaatselt iga otsingut teostava kasutaja brauseris.

#### Leid C: Rate Limiting puudumine Meilisearchi võtme hankimisel (Keskmine prioriteet)
* **Asukoht:** [main.py](file:///home/mf/LLM/VUTT/server/main.py#L193) (`/api/meili-token`)
* **Mõju:** Endpoint `/api/meili-token`, mis väljastab avalikke tenant-tokeneid, on ilma rate limitita. Kuna see endpoint genereerib igal väljakutsel Meilisearchi API kaudu uue tokeni, saab ründaja selle piiramatu pärimisega tekitada serverile ja otsingumootorile suure koormuse (DoS oht).

#### Leid D: CSP testi SSH sõltuvus ja kohaliku faili eiramine (Madal / Protseduuriline prioriteet)
* **Asukoht:** [test_security_fixes.py](file:///home/mf/LLM/VUTT/tests/test_security_fixes.py#L98) (`test_csp_no_unsafe_inline_in_nginx_config`)
* **Mõju:** Test teeb SSH-ühenduse tootmisserverisse `vutt` ning greppib sealset aktiivset konfiguratsiooni. See test ei kontrolli kohalikku repos olevat faili `nginx.host.conf`. Seetõttu võivad reposse sattuda ebaturvalised CSP seaded, ilma et kohalikud testid või CI/CD keskkond sellest teataks.

#### Leid E: Bot-meta URL escape viga (Madal prioriteet)
* **Asukoht:** [metadata_handler.py](file:///home/mf/LLM/VUTT/server/metadata_handler.py#L100) ja [metadata_handler.py](file:///home/mf/LLM/VUTT/server/metadata_handler.py#L217)
* **Mõju:** Funktsioonid kasutavad `work_id` URL-idesse panemiseks HTML-escape'i (`_escape` ehk `html.escape()`), mis ei asenda kõiki URL-i erimärke (nagu `/` või `&`). Korrektsem oleks kasutada URL encodingut (`urllib.parse.quote()`).

### 3. Järgmised sammud ja soovitused parandusteks

1. **Atribuutide eemaldamine ja saniteerimine:**
   * Täiendada `renderVuttMarkup` nii, et see filtreeriks elementidest välja atribuudid või kasutada DOM-puhastajat (nt DOMPurify).
   * Parandada kommentaaride kuvamine otsingus nii, et sisu asendatakse kõigepealt HTML-ohutuks ja alles siis lisatakse Meilisearchi `<em>` esiletõstud, või saniteeritakse kogu väljund.
2. **CSP testi kohandamine:**
   * Muuta test kontrollima otse repos olevat `nginx.host.conf` faili.
3. **Rate limiting ja saladused:**
   * Lisada `/api/meili-token`-ile rate limit kaitse.
   * Lisada `server/config.py` käivitamisel kontroll vaikimisi arendussaladuste kasutamise vastu produktsioonis.

---

## Implementatsioonikommentaarid (2026-06-09)

Koodibaasi ülevaatuse järel — leidude kinnitamine, prioritiseerimine ja konkreetsed parandusstrateegiaid enne nädalavahetuse implementatsiooni.

### Leid 1 (vaikimisi saladused) — kinnitatud, kriitiline

Produktsioonikeskkond ei tohi kunagi käivituda teadaolevate saladuste peal. Lahendus on lihtne ja tuleb teha esimesena.

**`server/config.py`-sse startup-kontroll:**
```python
import sys, os

_KNOWN_DEFAULTS = {"vutt_master_key", "dev-image-secret-change-in-production"}

def _check_production_secrets():
    if os.getenv("VUTT_ENV", "dev") != "production":
        return
    for name, val in [
        ("MEILI_MASTER_KEY", MEILI_MASTER_KEY),
        ("IMAGE_TOKEN_SECRET", IMAGE_TOKEN_SECRET),
    ]:
        if not val or val in _KNOWN_DEFAULTS:
            sys.exit(f"FATAL: {name} on vaikimisi arendusväärtus — tootmises ei ole lubatud käivituda")
```

`docker-compose.yml`-is panna `VUTT_ENV=production` teenuse env-i alla (või `.env` failis). Umami saladused on eraldi teenus ja lahendatakse samamoodi — nende `docker-compose.yml` osa vaatab üle eraldi.

**`/meili/` nginx proxy `Authorization` päise edastamine** on täiendav risk mida saab leevendada: nginx `proxy_set_header Authorization ""` tühjendaks päise enne edastamist, mis sunnib kliente kasutama search key't (mitte master key'd). Aga selle muudatuse mõju tuleb hoolikalt testida — Meilisearchi search-only päringud peavad jätkama toimima.

---

### Leid 2 (shareable semantika) — aktsepteeritud, ei vaja muutust

Otsus dokumenteeritud eespool: `shareable` = "avalik, sitemapist väljas". 1h tokeni aegumine on aktsepteeritav kompromiss. Ei vaja implementatsioonitööd.

---

### Leid 3 (registrid OSINT) — rate limit jah, DTO filter ei

Rate limit on mõistlik. DTO filter oleks üleliigne töö minimaalse kasuga — andmed on projekti väärtus ja intentsioon on neid avalikult eksponeerida.

Rate limit lisada samale infrastruktuurile mis juba on: `server/rate_limit.py` `RateLimiter` klassi instantside lisamine prosopograafia routerisse. Konservatiivne limiit: 60 päringut/min IP kohta list/query/map/facets endpointidel.

---

### Leid 4 (CSP unsafe-inline) — oluline, aga keerulisem kui paistab

`script-src 'unsafe-inline'` eemaldamine on prioriteet. `style-src 'unsafe-inline'` on keerulisem, sest Tailwind genereerib runtime-i stiilid — seda jätta esialgu.

Ainult `script-src` kitsendamine tühistaks inline event handler XSS vektori (Leid A) ilma Tailwindiga probleeme tekitamata. CSP muutus läheb `nginx.host.conf`-i (serveril) — pärast muutust tuleb testida, et CodeMirror, modal dialoogid jt JS-raskemad komponendid jätkavad töötamist.

**Leid 4 ja Leid A seos:** kui `script-src 'unsafe-inline'` eemaldatakse, on Leid A (`renderVuttMarkup` atribuudid) praktilist mõju kaotamas — `onclick` atribuudid blokeeritakse CSP-ga. Aga mõlemad tuleks siiski parandada (kaitse sügavuti).

---

### Leid A (renderVuttMarkup) — kinnitatud, lihtne fix

**Kinnitatud koodis** (`renderVuttMarkup.ts:20`): regex jätab whitelistitud elemendid (`span`, `em`, `strong`, `mark`, `sup`, `hr`) koos kõigi atribuutidega läbi. Input tuleb leheküljetekstist mida saavad editorid `/save` endpoint kaudu vabalt kirjutada (ka otse API kaudu, CodeMirror ei kaitse serveri poolt).

**Fix — input pre-escape** (ei nõua DOMPurify sõltuvust):

```ts
export function renderVuttMarkup(text: string): string {
  // Enne töötlemist escape HTML mis pole VUTT-markup — kaitseb injektsiooni eest
  const sanitized = text.replace(/<(?!\/?(?:b|i|cs|m|hi|fn|pb)\b[^>]*>|pb\/>)/g, '&lt;');
  
  let html = sanitized
    .replace(/&/g, '&amp;')
    // ... ülejäänud asendusloogika jääb samaks
```

**NB:** `&` escape peab tulema pärast input sanitiseerimist, et `&lt;` ei saaks topelt-escapetud. Õige järjekord: input escape → siis töötlemine.

Alternatiiv (simpler): asenda `&` ja HTML tähemärgid enne töötlemist, seejärel asenda escape'd VUTT-tägid tagasi:

```ts
let html = text
  .replace(/&(?!amp;)/g, '&amp;')           // & → &amp;
  .replace(/<(?!\/?(?:b|i|cs|m|hi|fn|pb)\b)/g, '&lt;')  // < mis pole VUTT-tägi → &lt;
  // rida 8 (<pb/>) jne jätkavad tööd
```

Testimine: `renderVuttMarkup('<span onclick="alert(1)">tekst</span>')` peaks andma `&lt;span onclick="alert(1)">tekst&lt;/span>`.

---

### Leid B (kommentaarid XSS) — kinnitatud, tõsisem kui Leid A

**Kinnitatud koodis** (`SearchResults.tsx:158-218`): `highlightedComments = hit._formatted?.comments?.filter(c => c.text.includes('<em'))` — ainult Meilisearchi poolt highlightitud kommentaarid lähevad `dangerouslySetInnerHTML`-i. Meilisearch ei sanitise sisendit, seega `<img src=x onerror=alert(1)>` sisu jõuab renderdamiseni.

Ründeskenaarium: editor kirjutab kommentaari `hea <img src=x onerror=alert(1)>`, keegi otsib "hea" → kommentaar tagastatakse `_formatted`-is → `dangerouslySetInnerHTML` käivitab `onerror`.

**Fix — DOMPurify (soovitatav):**

```bash
npm install dompurify @types/dompurify
```

```tsx
import DOMPurify from 'dompurify';

// SearchResults.tsx, kommentaaride renderdamisel:
const safeCommentHtml = DOMPurify.sanitize(comment.text, { ALLOWED_TAGS: ['em'] });
<div dangerouslySetInnerHTML={{ __html: safeCommentHtml }} />
```

**Sama muster peaks kehtima ka `tagHtml` kohta** (rida 202) — `formattedTags` on tag-nimed Meilisearchist, sama XSS vektor kehtib kui tag-nimesse on HTML sisestatud. Ja `snippet` (rida 187) — `snippet` tuleb otsinguindekseeritud leheküljetekstist, sama risk.

**Kõik kolm Meilisearchi `_formatted` läbivad kohad** vajavad DOMPurify wrap'i:
- `rida 187` — `snippet` → `DOMPurify.sanitize(snippet.replace(/\n/g, '<br>'), { ALLOWED_TAGS: ['em', 'br'] })`
- `rida 202` — `tagHtml` → `DOMPurify.sanitize(tagHtml, { ALLOWED_TAGS: ['em'] })`
- `rida 218` — `comment.text` → `DOMPurify.sanitize(comment.text, { ALLOWED_TAGS: ['em'] })`

DOMPurify on väike (~35KB), laialdaselt kasutusel, SSR-ga ühilduv (jsdom mock vajalik testides).

---

### Leid C (meili-token rate limit) — kinnitatud, aga DoS risk väiksem

**Kinnitatud**: `generate_meili_token()` on puhas JWT signing (HS256 + `jwt.encode`), ei tee Meilisearchi API päringut. Seega mälu/CPU koormus ühe päringul on minimaalne.

DoS oht on olemas aga mitte kriitiline. Rate limit on siiski hea praktika — lisada olemasolevasse `rate_limit.py` infrastruktuuri. Konservatiivne limiit: 30 päringut/min IP kohta. Madalam prioriteet kui Leid B ja Leid A.

---

### Leid D (CSP test) — kinnitatud, lihtne fix

**Kinnitatud**: test `test_csp_no_unsafe_inline_in_nginx_config` SSH-ib produktsiooniserveri. Repo `nginx.host.conf` ei ole valideeritav lokaalsetes testides.

Fix:
```python
def test_csp_no_unsafe_inline_in_nginx_config():
    config_path = Path(__file__).parent.parent / "nginx.host.conf"
    content = config_path.read_text()
    assert "script-src 'unsafe-inline'" not in content
```

Pärast CSP fix'i (Leid 4) muutub see test automaatselt kasulikuks.

---

### Leid E (URL encoding) — praktiline risk olematu

**Nanoid alphabet** on `A-Za-z0-9_-` — kõik need märgid on URL-ohutud JA HTML-ohutud (ei sisalda `&`, `<`, `>`, `"`, `'`). `html.escape(work_id)` ja `urllib.parse.quote(work_id)` annavad `work_id` jaoks identse tulemuse. Seda ei pea parandama.

---

### Tegevuste prioritiseeritud järjekord

| # | Leitud | Fail | Töö maht |
|---|--------|------|----------|
| 1 | Leid 1 ✅ **parandatud** — `check_production_secrets()` (`config.py`) keeldub käivitumast vaikesaladustega kui `VUTT_ENV=production`; `docker-compose.yml` lisab `VUTT_ENV`; 7 testi. **Deploy-nõue:** sea serveri `.env`-i `VUTT_ENV=production` + reaalsed `MEILI_MASTER_KEY` ja `IMAGE_TOKEN_SECRET`. Umami saladused (eraldi konteinerid) hallata `.env`-is käsitsi. | `server/config.py` + `docker-compose.yml` | ~15 min |
| 2 | Leid B | `SearchResults.tsx` + `npm install dompurify` | ~20 min |
| 3 | Leid A | `renderVuttMarkup.ts` | ~10 min |
| 4 | Leid 4 | `nginx.host.conf` (`script-src` fix) + `Leid D` test | ~20 min |
| 5 | Leid 3 + C | `prosopography/router.py` + `main.py` rate limit | ~30 min |

---

## Katmata alad — backend-ründevektorid (2026-06-09, gap-review agentidega)

Eelnev ülevaade keskendus avalikule pinnale (SEO, XSS, CSP, saladused, rate limit) ja kattis selle põhjalikult. Täiendav audit kolme fokuseeritud agendiga kattis klassikalised backend-ründevektorid, mida algne ülevaade EI puudutanud: autoriseerimine/rollikontroll, path traversal, käsuinjektsioon, üleslaadimispipeline, SSRF ja andmeterviklus.

### Implementatsiooni seis (2026-06-09, õhtu)

| Leid | Seis | Märkus |
|------|------|--------|
| **F** — path traversal `person_id` | ✅ **parandatud** | `_safe_nanoid` + `realpath` kontroll `ops.py`-s; routeri history/diff/restore sanitiseeritud; getter'id tagastavad None vigase ID korral; 8 testi `test_security_fixes.py`-s |
| **H** — slug/upload_id sanitiseerimine | ✅ **parandatud** | `sanitize_slug` alati (idempotentne) `create_upload` + `admin_upload_create`; `_valid_upload_id` enne tmp-kirjutust `admin_upload_files` ja `admin_upload_thumb`; 7 testi |
| **J** — Wikidata-proksi rate limit | ✅ **parandatud** | `RATE_LIMITS['/prosopography/wikidata'] = (30, 60)`; `_check_wikidata_rate_limit` mõlemal avalikul endpointil |
| **G** — `allowed_collections` write-kontroll | ✅ **parandatud** | otsus: jah. `can_write_work` (`access_ops.py`) = `can_read_work` + nõuab autenditud kasutaja; rakendatud `/save` ja `/work/{id}/shareable`; ei mõjuta avalike teoste editeerimist; 5 testi `test_access_ops.py`-s |
| **I** — sessiooni rolli-hetktõmmis | ✅ **parandatud** | Variant B: invalideeri sessioonid muutmisel (null kulu päringu kohta). `delete_user_sessions` (`auth.py`) kutsutud `update_user_role`, `delete_user` ja kollektsiooni-ligipääsu muutmisel (`main.py`); parandab ka latentse lukuvea `delete_user`-is; 4 testi `test_session_invalidation.py`-s |
| **1** — vaikimisi saladused | ✅ **parandatud** | `check_production_secrets()` (`config.py`) `sys.exit` kui `VUTT_ENV=production` + vaikesaladus/puudub; `docker-compose.yml` `VUTT_ENV`; 7 testi. Deploy: serveri `.env`-is juba seatud |
| **B** — kommentaarid/snippet/tag XSS | ✅ **parandatud** | uus `src/utils/sanitizeHtml.ts` `sanitizeHighlight` (escape kõik, taasta ainult highlight-tägi); rakendatud `SearchResults.tsx` 3 kohas; highlight-tägi konstandid jagatud `searchService.ts`-ga. **NB:** valisin escape-restore mustri DOMPurify asemel (node test-env, 0 sõltuvust) |
| **A** — renderVuttMarkup atribuudid | ✅ **parandatud** | pre-escape kõik `<` mis pole VUTT-tägi (`renderVuttMarkup.ts`); 18 testi `sanitizeHtml.test.ts` + `renderVuttMarkup.test.ts` |
| **L** (uus) — PlacesMergeModal i18n XSS | ✅ **parandatud** | `escapeValue:false` + `dangerouslySetInnerHTML` + kohanimi → `escapeHtml(sourceName)` enne `t()`; editor/admin-skoobis, kuid kaitse sügavuti |
| **K** — lost-update isikufailides | ⏸ ootab | per-isiku lukk; andmeterviklus, mitte turvaauk |
| **4/D** — CSP unsafe-inline + test | ⏸ ootab | vajab elava frontendi testimist (CodeMirror, modaalid) pärast `script-src` kitsendamist |
| Madal: Pillow bomb, enumeratsioon, SPARQL | ⏸ ootab | madala prioriteediga kõvendus |

Backend: kõik 307 testi läbivad. Frontend: kõik 276 testi läbivad + `npm run build` ok. (v.a SSH-sõltuv CSP-test, vt Leid D). Allpool leidude täiskirjeldus.

**Uus leid L (gap-review käigus, ei olnud algses ülevaates):** `escapeValue: false` (i18n.ts) tähendab, et react-i18next EI escape'i interpoleeritud väärtusi. Enamik `dangerouslySetInnerHTML` + `t()` kohti interpoleerib ainult arve (ohutu), AGA `PlacesMergeModal.tsx` interpoleeris kohanime (kasutaja/admin-sisend) → võimalik stored XSS editor/admin-skoobis. Parandatud `escapeHtml`-iga. `MarkdownPreview.tsx` kontrollitud — escape'ib sisendi esimesena (ohutu) ja pole praegu kasutusel.

### Kõrge — uus leid, osaliselt autentimata

#### Leid F: Path traversal prosopograafias `person_id` kaudu
* **Asukoht:** `server/prosopography/ops.py:49` (`_id_to_path`), `:994` (`_person_image_path`); marsruudid `server/prosopography/router.py` (`{person_id:path}`)
* **Mõju:** `person_id.removeprefix("vutt:P")` ei valideeri tulemust ja `{person_id:path}` lubab kaldkriipse. ASGI-tasandil kinnitatud, et `vutt:P../../../etc/passwd` jõuab handlerini ahendamata (uvicorn ei ahenda `..`). Tagajärjed:
  - `GET /prosopography/{person_id}/image` on **autentimata avalik** → suvalise `.jpg/.webp` faili lugemine kettalt (LFI).
  - `GET /prosopography/{person_id}` → suvalise `.json` lugemine (optional-user).
  - `DELETE .../delete` ja `delete_person_image` (editor/admin) → suvalise faili kustutamine `PROSOPOGRAPHY_DIR`-ist väljas.
* **Praktiline takistus:** kui nginx normaliseerib teed enne backendi, blokeerub toores `..`; aga `%2e%2e` URL-kodeering või proxy puudumine teeb selle elavaks.
* **Fix:** valideeri `person_id` keskselt regexiga `^vutt:P[a-z0-9]+$` (router-tasemel või `_id_to_path`-is) JA kontrolli `os.path.realpath(path).startswith(PROSOPOGRAPHY_DIR + os.sep)`. Madal vaev, suur mõju — tõsta töönimekirja etteotsa.

### Keskmine — kontseptuaalsed otsused + path traversal

#### Leid G: `allowed_collections` ei jõustu kirjutamisel
* **Asukoht:** `server/main.py:728` (`/save`), `:1788` (`/work/{id}/shareable`), prosopo editor-endpointid
* **Mõju:** Kollektsioonipõhine ligipääs jõustatakse AINULT lugemisel (`can_read_work`). Iga `editor` saab salvestada / shareable-lippu seada ükskõik millisesse teosesse, sh piiratud kollektsioonidesse, millele tal lugemisõigust polegi.
* **Otsus vajalik:** kas `allowed_collections` peaks piirama ka kirjutamist? Kui jah → lisa write-pathidele `can_write_work`-tüüpi kontroll. Kui ei → dokumenteeri, et `allowed_collections` on lugemis-only.

#### Leid H: Sanitiseerimata `slug` ja `upload_id` upload-voos
* **Asukoht:** `server/main.py:1291` (`slug = data.get('slug') or sanitize_slug(...)`), `:1310-1314` (`tmp_path = f"/tmp/vutt-upload-{upload_id}-..."`), `upload_ops.py:959` (`work_dir = os.path.join(BASE_DIR, slug)`)
* **Mõju:** Kliendi saadetud `slug` kasutatakse toorelt (sanitize ainult tühja fallbackil) → `../`-ga path traversal data-kaustast välja `import_as_work`-is. `upload_id` läheb `/tmp`-teesse ENNE `_valid_upload_id()` kontrolli → faili ülekirjutus `/tmp`-ist väljas. Admin-only, seega ründepind kitsas, kuid API ei jõusta frontendi eeldust.
* **Fix:** `slug = sanitize_slug(data.get('slug') or data.get('title',''))` alati serveripoolselt; `_valid_upload_id(upload_id)` endpointi alguses enne tmp-kirjutust.

#### Leid I: Sessioon hoiab rolli/kollektsiooni hetktõmmist — tühistamine pole kohene
* **Asukoht:** `server/auth.py:138-146` (`create_session`), `:185` (`require_token`)
* **Mõju:** Sessioon salvestab `user` dict'i (role + allowed_collections) sisselogimise hetkel. `update_user_role` ega kollektsiooniõiguse eemaldamine ei jõustu enne tokeni aegumist (24h) või väljalogimist — ainult `delete_user` kustutab sessioonid. Privileegide tühistamine ei ole kohene.
* **Fix:** lugeda roll/õigused `require_token`-is iga päringu juures `users.json`-ist (cache'itud) sessiooni hetktõmmise asemel, või invalideerida sessioonid rolli muutmisel.

#### Leid J: Autentimata + rate-limititeta Wikidata-proksi
* **Asukoht:** `server/prosopography/router.py:559` (`/places/wikidata-search`), `:565` (`/places/wikidata/{qid}`); `places_ops.py:482, 546`
* **Mõju:** Avalikud (auth puudub) endpointid teevad serveripoolse päringu Wikidatasse. Anonüümne kasutaja saab serverit Wikidata-proksina kuritarvitada (koormus, Wikidata IP-ban). **Mitte klassikaline SSRF** — sihthost on hardcode'itud, kasutaja ei saa hosti/skeemi muuta. Rate limit puudub.
* **Fix:** sama rate-limit-infrastruktuur mis Leid 3/C jaoks; kaaluda cache'i.

#### Leid K: Lost-update isikufailides (lukustamata read-modify-write)
* **Asukoht:** `reciprocal_ops.py:82, 100` (`sync_reciprocals`), `ops.py:1744` (`bulk_update_occupation`), `ops.py` ~1109 (`apply_enrichment`), ~980 (`add_identifier`)
* **Mõju:** `update_person` teeb optimistliku `updated_at` kontrolli (`ops.py:537`), AGA ülaltoodud teevad lukustamata read-modify-write ilma `updated_at` kontrollita. Taustal jooksev `sync_reciprocals` (best-effort iga `update_person` järel) võib üle kirjutada samaaegse otsemuudatuse → vaikne andmekadu (last-writer-wins). JSON ise ei korrumpeeru (atomic rename). Reaalne ka single-worker uvicornis, sest `BackgroundTasks` + daemon-thread'id jooksevad samas protsessis.
* **Fix:** per-isiku lukk (nagu jagatud indeksitel juba on) või laienda `updated_at` kontroll kõigile kirjutajatele, eriti `sync_reciprocals`-ile.

### Madal
* **Pillow decompression bomb / üleslaadimisel puudub failisuuruse piirang** — `upload_ops.py` + `main.py:1307` voogesitab keha kettale ilma max-suuruseta; JPEG/PNG/TIFF teisendatakse Pillow'ga ilma `MAX_IMAGE_PIXELS`-ita. Admin-only.
* **Kasutajanimede enumeratsioon + rate-limit puudub** — `/register/username-preview` (`main.py:235`), `/invite/{token}` (`:242`), `/verify-token` (`:172`). Tokenid on UUIDv4 (122 bit), brute-force ebareaalne; risk peamiselt info-leke.
* **SPARQL string-interpolatsioon** — `enrichment.py:111+`, `people_ops.py` GND fetch; ainult `Q`-prefiksi kontroll, mitte täielik valideerimine. Editor-only, read-only → kosmeetiline.

### Kontrollitud ja korras (et fookus ei läheks raisku)
* **Käsuinjektsioon** — `git_ops.py` GitPython `repo.git.*` + `subprocess.run([...])` argv-listidena, mitte `shell=True`; `rm -rf` upload-stagingu kustutamisel kasutab serveri-genereeritud nanoid'i. OK.
* **CSRF** — puhas Bearer-token (Authorization header / query-param, localStorage), mitte cookie-põhine. OK.
* **Parooliräsistus** — bcrypt soolaga, automaatne upgrade; `hmac.compare_digest` HMAC-il; serveripoolne parooli tugevuse valideerimine. OK.
* **Mass assignment / privilege escalation** — kasutaja ei saa oma rolli muuta; `create_user_from_invite` hardcode'ib rolli; prosopo/user-settings whitelistivad väljad. OK.
* **image_server.py traversal** — `_is_safe_image_path` kontrollib `realpath().startswith(base + os.sep)` + laiendi whitelist. OK.
* **`/save` path traversal** — `os.path.basename()` nii `original_path` kui `file_name` peal. OK.
* **XXE** — sitemap genereerib XML-i string-konkatenatsiooniga (ei parsi); üheski kohas väliseid XML-e ei parsita. OK.

### Dokumentatsiooni vastuolu (kõrvalleid)
CLAUDE.md ütleb, et versiooni taastamine on admin-õigus ja contributor → pending edits. Koodis `/git-restore` nõuab **editorit** (`main.py:1113`) ja registreerimine loob kõik editorina (`registration.py:322`) — contributor-roll ja pending-edits voog on praktikas implementeerimata. Viia CLAUDE.md ja kood kooskõlla, et turvaeeldused ei läheks lahku.

