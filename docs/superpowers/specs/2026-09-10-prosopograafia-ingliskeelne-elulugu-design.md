# Prosopograafia: elulugu ka inglise keeles

**Kuupäev:** 2026-09-10
**Seotud:** ADR 0002 (blokeeriv I/O), ADR 0007 (tuletatud indeksid on read-modelid),
ADR 0008 (markdown allow-list), ADR 0011 (i18n ilma fallbackita), ADR 0021 (üks nimi
ühe saladuse/seade kohta), ADR 0031 (kirjutamisõigus); uus **ADR 0039** (sisuvälja
keel on väljanimes, mitte väljas)
**Staatus:** disain ülevaatamiseks, teostamata

## Probleem

VUTT-i liides on kahes keeles, sisu ei ole. Isikukaardi `biography` on üks vabateksti
väli ilma keeleta: ingliskeelne lugeja saab isikulehel ette teksti, mida ta ei loe, ja
alternatiivi ei ole. Kasutajaskond on rahvusvaheline (ADR 0033 lähtekoht) ja
prosopograafia on VUTT-i kõige „loetavam" osa — isikuleht on sageli esimene, mis
otsingust ette satub.

**Mõõdetud seis tootmises 2026-09-10** (`data/config/prosopography/*.json`):

| | arv |
|---|---|
| isikukaarte | 2389 |
| `biography` täidetud | 371 |
| … millest **Album Academicumi toorik** | **308** |
| … millest **inimese kirjutatud proosa** | **63** |
| `notes` täidetud | 7 |
| proosa maht | ~310 kB; mediaan 336 märki, max 30 590 |

Mõõtmine paljastas, et `biography` kannab kahte eri asja. AA-toorik on
masinkopeeritud struktureeritud allikakirje, valdavalt saksakeelsete lühenditega ja
eestikeelse päisereaga:

```
Immatrikuleerimise kuupäev: 20. September 1634
154. Lünaeus (Lynaeus, Lineus), Emundus, Smål., * 1604, † 1693. V.: Joh. L.
Imm. Uppsala 1. 8. 1639. AG: Dep. 18. 9. 1634; Konv. 1. 11. 1634—36; …
```

Seda ei ole mõtet tõlkida — see ei ole tekst, vaid kirje. Päris tõlkimisküsimus
puudutab 63 kirjet. See arv otsustas kogu kuju: **automaatne partiitõlge oleks
ehitatud 308 kirje jaoks, mida ei tohi tõlkida, ja 63 jaoks, mida keegi peaks niikuinii
üle lugema.**

## Otsused

### 1. Keel on väljanimes: `biography` = eesti keel, muud keeled laiendiga

`biography` jääb kettal ja avalikus API-s täpselt selleks, mis ta on; juurde tuleb
`biography_en: str | null`. Kolmas keel (`biography_de`) on plaanis ja mahub samasse
mustrisse ilma skeemimuudatuseta.

**Kaalutud alternatiiv:** `biography` → `{et, en}` objekt, nagu projekti enda inline
`labels{et,en}` muster (ADR 0014). Sümmeetriline ja laieneb ilusamini, aga muudab
**avaliku, autentimata `GET /prosopography/{id}` välja kuju** — MCP `get_person`,
SEO-prerender, snippet, `merge_ops`, frontendi tüübid ja vorm tuleks korraga läbi käia,
ja 308 saksakeelset AA-toorikut satuksid `et`-võtme alla. Lugemispool tuleb mõlemal
juhul üle käia (iga kuvamiskoht peab nüüd keele valima), nii et objektikuju ostaks
sümmeetria API-katkestuse hinnaga. Kui kolmas ja neljas keel kunagi tulevad, on
migratsioon endiselt tehtav — laiendiga väljadest objektiks on mehaaniline teisendus.

**Teadaolev pinge, mis läheb ADR-i kirja:** deklareeritud tähendus („`biography` on
eesti keeles") ei vasta täna 308 kaardil olevale sisule. Täna see ei maksa midagi,
sest tõlget kutsub inimene, kes teksti vaatab. `biography_de` lisamise päeval muutub
see päris otsuseks: kas AA-toorik kolib omaette välja (`aa_raw`) või jääb erandiks.

### 2. Masintõlge on käsitsi kutsutav abiline, mitte konveier

Toimetaja vajutab vormis nuppu, saab mustandi, toimetab selle üle ja salvestab.
Salvestatud tekst on **alati inimese kinnitatud tekst** — seetõttu ei ole vaja
„masintõlge, kinnitamata" lippu, kinnitusolekut ega partiitööde masinavärki.

Nuppu näeb ainult **`editor` ja üles** isiku muutmise vormis. Avalikul isikulehel
lugejale tõlkenuppu ei tule: see oleks anonüümne LLM-endpoint (kulu- ja
kuritarvitusrisk) ja tulemus ei jõuaks kunagi korpusesse.

### 3. Tõlke-endpoint on olekuta ega puuduta kaarti

`POST /prosopography/translate`, keha `{text, target_lang}`, vastus `{text}`.
Kaardifaili ei avata, git-i ei commitita, lukku ei võeta. Salvestamine käib tavalist
`update_person` teed.

**Põhjus:** isikufailidesse kirjutamine on täna ühe tee taga (`update_person` →
`save_with_git`, optimistlik konkurentsikontroll `updated_at` järgi). Teine kirjutaja
tähendaks teist võimalust see kontroll mööda minna. Olekuta endpoint ei ole
mugavusvalik, vaid invariandi hoidmine.

### 4. Kuvamisreegel: vali keel, varuvariant alati olemas

```
i18n.language === 'en' && biography_en ? biography_en : biography
```

Kui näidatakse varuvarianti, käib teksti juurde väike keelemärge („Estonian"), et
lugeja teaks, miks tekst on teises keeles. Eestikeelsele lugejale näidatakse alati
`biography`-t; `biography_en` ei ole talle kunagi nähtav.

**Miks mitte peita plokk, kui tõlget ei ole:** täna kaoks nii ingliskeelse lugeja eest
kõik 371 elulugu korraga. **Miks mitte näidata mõlemat kõrvuti:** leht muutub pikaks
ja UI keele valik ei tähendaks enam midagi.

### 5. Nimekirja katke läheb kaasa

`biography_snippet` (`prosopography_index.json`) saab paarilise `biography_snippet_en`.
Ilma selleta näeks ingliskeelne kasutaja isikute nimekirjas eestikeelset katket ja
detaillehel ingliskeelset teksti. Indeks on read-model, mis ehitatakse nullist üles
(ADR 0007), nii et lisandus ei nõua migratsiooni — ainult `rebuild_indices()` läbimist.

## Mida EI tehta, ja miks

**SEO-prerender jääb eestikeelseks.** `server/metadata_handler.py` on läbivalt
kõvakodeeritud eesti keeles („Elulugu", „Sündinud …", `description` eestikeelsest
biograafiast). Ingliskeelne elulugu jääb seega Google'i eest varju. Selle
kakskeelseks tegemine on omaette töö (keele valik bot-teel, `hreflang`, kaks
URL-kuju), mitte selle spiku osa. Kirjas eraldi lahtise punktina.

**MCP `get_person` jääb originaali näitama.** Agent loeb korpust, mitte lugejaliidest;
ingliskeelne tõlge on tuletis, mitte allikas.

**AA-toorikut ei kolita eraldi välja.** Vt pinge otsuse 1 all — praegu see ei blokeeri
midagi ja migratsioon 308 kaardil ei teeni ühtki selle spiku eesmärki.

**Partiitõlget ei tule.** Vt otsus 2.

## Puutepunktid (kontrollitud koodis)

| Fail | Mida teha |
|---|---|
| `src/prosopography/types.ts` | `biography_en` `Person`-i; `biography_snippet_en` list-item-tüüpi |
| `src/prosopography/components/personForm/types.ts` | draft-väli + algväärtus |
| `src/prosopography/components/personForm/helpers.ts` | `fromPerson` / `toPayload` (`biography_en`) |
| `src/prosopography/pages/PersonEditPage.tsx` | eluloo plokk → keeletabid + tõlkenupp |
| `src/prosopography/pages/PersonDetailPage.tsx` | kuvamisreegel + keelemärge |
| `src/prosopography/components/PersonCard.tsx` | katke valik UI keele järgi |
| `src/locales/{et,en}/prosopography.json` | uued võtmed **mõlemasse** (ADR 0011) |
| `server/prosopography/person_crud.py` | uue kaardi skeem; `_make_snippet` mõlemale keelele |
| `server/prosopography/person_search.py` | indeksikirje `biography_snippet_en` |
| `server/prosopography/merge_ops.py` | ühendamisel: allikas täidab ainult tühja sihtvälja |
| `server/prosopography/router.py` | uus `POST /translate` |
| `server/text_translate.py` | **uus** olekuta tõlkeklient |
| `server/config.py` | `GEMINI_TRANSLATE_MODEL`, sisendi ülempiir |

**Mis EI vaja muutmist — kontrollitud, et mitte ehitada olematut probleemi:**

- `update_person` teeb `person.update(data)` — merge, mitte ülekirjutus, ja
  välja-lubaloendit ei ole. Uus võti läheb läbi. (Vastupidi lehe JSON-ile, kus
  `SERVERIPOOLSED_LEHE_VALJAD` puudumine kaotaks välja esimese salvestusega.)
- `compute_person_diff` käib üle kõigi võtmete peale `_DIFF_IGNORED_FIELDS`-i —
  git-ajalugu ja „Ajalugu"-tab näitavad `biography_en` muudatusi ilma koodita.

## Tõlkemoodul (`server/text_translate.py`)

Olekuta, samas vaimus nagu `server/ocr_providers/gemini.py`: sisse tekst + sihtkeel,
välja tekst + normaliseeritud usage. Ei impordi prosopograafiat, ei loe faile.

**Pakkuja: Gemini** — võti, retry, timeout ja sisufiltri-keeldumise käsitlus (#292,
prefiksimuster) on juba olemas ja tootmises. Mudel oma env-nimes
`GEMINI_TRANSLATE_MODEL` (ADR 0021), ülejäänu jagab `GEMINI_API_KEY` /
`GEMINI_REQUEST_TIMEOUT` / `GEMINI_MAX_RETRIES` väärtusi. Claude API annaks eesti↔inglise
teadustekstis tõenäoliselt parema tulemuse, aga nõuaks uut võtit, uut saladuse
stardikontrolli ja teist veakäsitlust — kui tõlkekvaliteet osutub praktikas kehvaks, on
pakkuja vahetus selle mooduli sees üks funktsioon.

**Juhis mudelile:** säilita Markdown; jäta nimed, kuupäevad, kohanimed ja tsitaadid
muutmata kujule; ära lisa midagi juurde; tagasta ainult tõlge.

**Piirid ja vead:**
- Sisendi ülempiir (praegune pikim elulugu on 30 590 märki) — üle piiri **selge viga**,
  mitte vaikne lõikamine.
- Tühi või ainult tühikutest sisend → 400, mitte mudelikutse.
- Pakkuja viga jõuab kasutajani sõnumina, mis ei sisalda võtit ega vastuse keha
  (`GeminiError` konventsioon).

## Endpoint

- `POST /prosopography/translate`, `Depends(_require_role("editor"))`.
- **Marsruudi järjekord:** `router.py` lõpus on `GET /{person_id:path}` ja
  `PUT /{person_id:path}`. Uus konkreetne tee tuleb registreerida enne neid.
- ADR 0002: keha lugev route → `run_in_threadpool`, mitte blokeeriv I/O `async def`
  sees.
- App-tasandi rate-limit `server/rate_limit.py` kaudu (LLM-kutse on kulukas ka
  autenditud kasutaja käes).

## Frontend

**Vorm.** Eluloo plokk saab keeletabid **ET | EN** (skaleerub `de`-le). EN-tabil nupp
„Tõlgi eesti keelest": kutsub endpointi, paneb tulemuse kasti; kast jääb tavaliseks
`MarkdownEditor`-iks (ADR 0008 allow-list kehtib edasi). Nupp on väljas, kui ET on
tühi; kui EN on juba täidetud, küsib enne ülekirjutamist kinnitust. Salvestamata
muudatuste valve on olemas (`useUnsavedChangesGuard`) ja katab uue välja automaatselt,
kui see on draftis.

**Kuvamine.** `PersonDetailPage` ja `PersonCard` valivad keele otsuse 4 reegli järgi.
Kõik uued i18n-võtmed lähevad **korraga et- ja en-faili** — `fallbackLng` on väljas ja
puuduv võti katkestab buildi (ADR 0011, `localeParity.test.ts`).

## Testid

**Backend**
- `text_translate` üksustestid mockitud HTTP-ga. Mock-vastuse kuju peab olema
  **elava vastuse vastu kontrollitud**, mitte välja mõeldud — Gemini faas A õpetas, et
  mockitud leping ei ole leping.
- Endpointi rollikontroll (`contributor` → 403, `editor` → 200), pikkuspiir, tühi sisend.
- `merge_ops`: `biography_en` täidab ainult tühja sihtvälja, ei kirjuta olemasolevat üle.
- `_make_snippet`: mõlema keele katked, markup maha, 120 märki.
- Indeksikirje sisaldab `biography_snippet_en`.

**Frontend**
- Kuvamisreegel: EN + tõlge olemas → tõlge; EN + tõlget ei ole → originaal + keelemärge;
  ET → alati originaal.
- Vormi tabid: EN-i kirjutamine ei puuduta ET-välja ja vastupidi.
- Tõlkenupp: väljas tühja ET korral, küsib kinnitust täidetud EN korral.
- i18n pariteet jookseb olemasolevate valvuritega.

## Lahtised punktid (ei blokeeri teostust)

1. **SEO-prerender kakskeelseks** — eraldi töö, oma issue.
2. **`biography_de`** — lisandub sama mustriga; siis tuleb otsustada AA-tooriku saatus.
3. **Tõlkekvaliteet** — kui Gemini eesti↔inglise teadustekstis alt veab, on pakkuja
   vahetus `text_translate.py` sees lokaalne muudatus.
