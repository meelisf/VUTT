# Kirjaotsing: kiri kui otsinguüksus (#526, samm 1)

**Kuupäev:** 2026-10-07 · **Issue:** #526 · **Seotud:** #464 / ADR 0057 (teose osad),
ADR 0006 (Meili väljanimed), ADR 0013 (sünk teose kaupa), ADR 0042 (töökollektsioonid),
ADR 0046 (sessioon = õiguste tõde), spekk `2026-09-26-teose-osad-design.md` §6 (CMIF)

## Probleem

Kirju ei saa otsida kirjadena. Autori, adressaadi, aasta ega saatmis- või sihtkoha järgi
ei saa üle korpuse filtreerida. Teose osad (#464) andsid kirjadele registri teose sees,
aga Meili otsing osade kaupa jäi v1-st välja.

## Korpus (tootmine, 2026-10-07)

132 kirja-osa (`kind == "letter"`); neist 27 dateeringuta ja 126 ilma koha ID-ta. Lisaks
13 lisa, 24 luuletust, 7 proosat, 4 kõnet.

## Otsused arutelust

1. **Kandja.** Rara digib **mapi kaupa**, ka siis, kui köide on konserveerimiseks lahti
   võetud. Seega rara materjal on **mapp = teos, kiri = osa** (ADR 0057), sama mis
   köitena säilinud koodeksil (`o17ekb`). Eraldi kandjat „1 kiri = 1 teos" ei ole. Üksi
   digitud kiri on **teos ühe osaga**. Kirjaindeksi allikas on ainult osad.
2. **Kahekordne kataloogimine.** Komplekti kirje on teose `archive_refs`. Üksikkirja
   kirje (nt ESTER b4074892: „Kiri säilikust: Correspondenz [Bd.4], F 3,Mrg DCVIII",
   l. 246v–247) kuulub **osale**. Osa kataloogiviide ja foliatsiooni silt on **järgmine
   samm**, mitte see spekk (vt „Väljaspool skoopi").
3. **Sisenemine.** Esilehele uut sisenemiskohta ei tule. Kirjaotsing on täisteksti otsingu
   (`/search`) režiim. Lüliti **Täistekst | Kirjad** on kollektsiooni kiibi reas.
4. **Täistekst.** Kirjade režiimis otsib päring ka kirja teksti seest.
5. **`teosed` ei muutu.** Lehekülgede otsing leiab kirjade teksti nagu praegu. Kirjade
   režiim on sama korpuse kitsam vaade, kus tabamus on kiri.
6. **Indeks.** Eraldi Meili indeks `kirjad`, üks dokument kirja kohta. Variant „kirjaväljad
   lehedokumentidele" jäeti kõrvale: tabamus oleks leht, tahud loeksid lehti ja kahe
   kirja piirileht segaks filtreid.

## 1. Dokument

Üks dokument iga osa kohta, mille `kind == "letter"` ja millel on vähemalt üks leht.

```jsonc
{
  "id": "o17ekb__p7f3kq",          // work_id + "__" + part_id
  "work_id": "o17ekb",
  "part_id": "p7f3kq",

  // ligipääs: kopeeritakse sama teose lehedokumendist, EI arvutata uuesti
  "is_public": true,
  "collections_hierarchy": ["…"],

  // kiri
  "title": "Spener Fischerile",
  "incipit": "Cum et pro…",
  "abstract": "…",                 // abstract_et + abstract_en (ADR 0063), otsinguks
  "authors": ["Philipp Jakob Spener"],     // role == auctor, kuvanimi
  "author_ids": ["vutt:P…"],               // ainult ID-ga isikud
  "addressees": ["Johann Fischer"],        // role == addressee
  "addressee_ids": ["vutt:Pu837uz"],
  "names_text": "…",               // kõigi osa isikute nimed + aliased (person_aliases)
  "place_from": "Frankfurt",       // osa `place` silt
  "place_from_id": "Q1794",        // ainult kui id olemas
  "place_to": "Sulzbach",
  "place_to_id": "Q…",
  // dateering: ADR 0037, sama abi mis teosed-is (work_dating.index_dating osa `dating`-ule)
  "dating": { "start": "1684", "end": "1686", "source_text": "…" },  // kuvamiseks, nagu salvestatud
  "date_start": 16840101,          // arvuline alumine piir (bound)
  "date_end": 16861231,            // arvuline ülemine piir
  "date_sort": 16840101,           // dateeringuta kiri: väli puudub (vt allpool)
  "languages": ["deu"],
  "letter_text": "…",              // kirja lehtede lehekylje_tekst teose järjekorras
  "first_page": 6,                 // osa esimese lehe number teose järjekorras
  "page_count": 3,

  // teose kontekst
  "work_title": "…",
  "archive_refs_text": "…",        // sama denormalisatsioon mis teosed-indeksis
  "needs_review": false
}
```

**Väljanimed on ingliskeelsed.** ADR 0006 legacy-nimed kehtivad `teosed`-indeksis.
Uus indeks ei pea neid kordama (ADR 0065).

**Lünkade käsitlus:** puuduv väli jäetakse dokumendist välja (mitte `""`/`null`), v.a
`attributesToSearchOn` väljad, mis peavad dokumendis alati olemas olema (tühi string).
VUTT ei oleta.

**Dateering.** Kuvamine käib `dating` objektist (vahemik ja `source_text` jäävad nähtavaks),
mitte arvulisest piirist — alguskuupäev üksi annaks eksliku täpsuse mulje. Aastavahemiku
filter on **kattuvusfilter** nagu `teosed`-is: kiri `[date_start, date_end]` kuulub
vahemikku `[A, B]`, kui `date_start <= B1231 AND date_end >= A0101` (1684–1686 kiri tuleb
1685 otsingus välja). Dateeringuta kirjal `date_*` välju ei ole: ta ei tule aastafiltriga
välja ja kuupäeva järgi sortides on ta **lõpus** mõlemas suunas (Meili paneb sorditava
välja puudumisel dokumendi lõppu). `index_dating`-u `year_range`-i varuvariant (teose aasta)
kirjadele EI kehti — teose aasta ei dateeri kirja.

**Tahud on sildipõhised kõigile nimetatud kirjetele** (v1). Autor, adressaat, saatmis- ja
sihtkoht on filtreeritavad sildi järgi ka siis, kui ID puudub. **Teadlik piirang:**
samanimelised eri isikud (või kohad) langevad tahus kokku ja sama isik eri nimekujudes
läheb lahku. ID-väljad (`author_ids`, `place_from_id` …) on filtreeritavad juba praegu,
et ID-põhisele tahule üleminek ei vajaks reindeksit.

**Seaded** (`server/meili_settings.py`, uued konstandid kõrvuti `teosed` omadega):

| | Väljad |
|---|---|
| `LETTERS_SEARCHABLE_ATTRIBUTES` (järjekorras) | `names_text`, `title`, `incipit`, `abstract`, `place_from`, `place_to`, `letter_text`, `archive_refs_text`, `work_title` |
| `LETTERS_FILTERABLE_ATTRIBUTES` | `id` (aegunute kustutus filtriga), `work_id`, `is_public`, `collections_hierarchy`, `author_ids`, `addressee_ids`, `authors`, `addressees`, `date_start`, `date_end`, `place_from`, `place_to`, `place_from_id`, `place_to_id`, `languages` |
| `LETTERS_SORTABLE_ATTRIBUTES` | `date_sort` |

`place_from` / `place_to` on otsitavad, sest ID-ta koht on leitav ainult nime järgi.

## 2. Ehitus ja sünk

**Põhimõte:** kirjadokument tuletatakse sama teose juba ehitatud lehedokumentidest. Nii
tulevad ligipääsuväljad ja puhastatud tekst täpselt sealt, kust `teosed`-is, ja indeksid
ei saa neis lahku minna.

- `meili_doc.build_letter_documents(meta, page_documents, people_data) -> list[dict]` on
  puhas funktsioon. Ta kaardistab `parts[].pages` (tüved) lehedokumentideks ja liidab
  teksti teose järjekorras. Leht, mis kuulub kahte kirja, läheb mõlemasse.
  **Teadlik piirang:** piirilehe sõna annab tabamuseks mõlemad kirjad, ka siis, kui sõna
  kuulub tegelikult ainult ühte. Lehe sisest kirjapiiri VUTT ei tea.
- Live-tee (`meilisearch_ops`) ja seed-tee (`scripts/1-1_consolidate_data.py`) kutsuvad
  sama funktsiooni (CLAUDE.md: uus indekseeritav väli ainult `meili_doc.py`-sse).

**Kirjutusteed:**

| Tee | `kirjad`-is |
|---|---|
| `sync_work_to_meilisearch` | upsert uued; **alles pärast upsert-task'i edukat lõppu** (`wait_for_task` = `succeeded`) kustuta selle teose aegunud id-d (`work_id = X AND id NOT IN [uued]`). Kirjadeta teosel ainult kustutus (`work_id = X`) |
| sama, lehedokumente pole (viimane leht kustutatud, kaust tühi) | praegu väljub funktsioon `if not documents: return False` enne ühtki kirjutust. Uus järjekord: **kirjade kustutus `work_id` järgi tehakse enne seda väljumist** |
| `index_new_work` | sama mis `sync_work_to_meilisearch` |
| `delete_work_from_meilisearch` | kustuta `work_id` järgi |
| `update_collection_is_public_async` | vt allpool „Nähtavuse massuuendus" |
| seed (`1-1` → `2-1_upload_to_meili.py`, `server_seed_data.sh`) | ehitab `kirjad`-i nullist |

- Osade muutmine (`/works/{id}/parts`) peab käivitama teose Meili-sünki. Plaan kontrollib
  seda ja lisab sünki, kui see puudub.
- **Järjekord on upsert → aegunute kustutus**, mitte vastupidi: kahe Meili töö vahel
  tehtud otsing ei tohi näha teost ilma kirjadeta (sama muster mis `_delete_extra_pages`).
- **Sünk õnnestub ainult siis, kui KÕIK neli sammu õnnestuvad:** lehtede upsert, lehtede
  aegunute kustutus, kirjade upsert, kirjade aegunute kustutus — igaüks oma task'i
  `succeeded`-iga. Ükskõik milline tõrge (sh kustutuse oma) → `sync_work_to_meilisearch`
  tagastab `False` → `mark_error("meilisearch_async_sync")`. Kirjade samm jookseb ka siis,
  kui lehtede samm ebaõnnestus (ei blokeeri teineteist), aga tulemus on ebaõnnestunud.
- **Korduskatse — mida lubatakse ja mida mitte.** Dirty-lipp (ADR 0013) kordab ainult
  **aktiivse sünki ajal saabunud** muudatust; ebaõnnestunud tööd ta automaatselt ei korda.
  See spekk automaatkordust EI lisa (ühtne `teosed`-iga). Ebaõnnestunud sünk on nähtav
  tervisekontrollis (`mark_error`) ja logis; taaste = teose järgmine salvestus või
  `scripts/sync_meilisearch.py` (sh `--letters`). Aegunud kirjadokument, mis jäi
  kustutusvea tõttu alles, ei leki nähtavuse muutusel (vt allpool).
- **Nähtavuse massuuendus** (`update_collection_is_public_async`). Parandatud eraldi
  PR-is #561: tee luges id-d valelt väljalt (`work_id`, tootmises 0/1422) ega jõudnud
  kunagi Meilisse, ja kirjutus oli POST (*add-or-replace*). Nüüd `id` + **PUT**
  (*add-or-update*). Kirjade jaoks:
  - sihtmärk on **kõik indeksis olevad** selle teose kirjadokumendid, mitte `_metadata.json`
    praegused osad — id-d küsitakse Meilist (`POST /indexes/kirjad/documents/fetch`,
    `filter: work_id = X`, `fields: ["id"]`), et kustutusvea tõttu alles jäänud vana kiri
    ei jääks avalikuks;
  - uuendus PUT-iga `{id, is_public}`.
- **Isikuregistri muudatused.** Nimed denormaliseeritakse kirjadokumenti, seega peab nime
  muutus kirjadeni jõudma:
  - `_propagate_name_to_works` (`person_crud.py`) uuendab praegu ainult teose `creators`,
    `tags`, `publisher`. Laiendus: ka `parts[].creators` sildid. Osad muutuvad ADR 0057
    järgi ainult `metadata_lock`-i all, seega osade sildiuuendus käib `work_parts`-i abi
    kaudu luku all, mitte praeguse lukuta otsekirjutusena. Muutunud teos läheb
    Meili-sünki nagu praegu.
  - Aliaste muutus (`person_aliases.json`, `people_ops`) ei käivita praegu ka `teosed`-i
    `authors_text` uuendust; kirjad jagavad sama piirangut, taaste = reindeks. Ühtne
    käitumine, mitte uus auk.
- **Seaded jooksvale instantsile:** `_ensure_letters_index()` (stardil, nagu
  `_ensure_filterable_attributes`) loob indeksi, kui seda pole, ja rakendab seaded.
  Deploy ei vaja käsitsi Meili sammu.
- **Esmane täitmine:** täis-seed (`server_seed_data.sh`: `1-1` kirjutab `kirjad.jsonl`,
  `2-1` loob ja täidab `kirjad`-i). Eraldi skripti ei tehtud (plaani otsus).
- **Paarsus:** `scripts/verify_meili_seed_live_parity.py` võrdleb ka kirjadokumente.

## 3. Ligipääs

**Põhimõte:** üks funktsioon annab ligipääsufiltri ja mõlemad indeksid saavad sama stringi.

- `meilisearch_ops._access_filter(user) -> str | None` (`None` = admin, piiranguta).
  `generate_meili_token` ehitab `searchRules = {"teosed": R, "kirjad": R}`, kus `R` on
  mõlemal sama.
- `generate_work_scoped_meili_token` (lingiga jagatud teos) `kirjad`-i **ei anna**.
  Jagatav teos on avatav, mitte otsitav (ADR 0042 `is_search_visible`).
- **Otsinguvõti** (kontrollitud 2026-10-07): `MEILI_SEARCH_KEY` = „Default Search API Key",
  `indexes: ["*"]`. Uut võtit ega env-i muudatust ei ole vaja; indeksite piiramine käib
  ainult tenant-tokeni `searchRules`-i kaudu — **indeks, mida `searchRules`-is pole, on
  tokenile kättesaamatu**, seega `kirjad` peab sinna selgesõnaliselt minema.
- **nginx:** `/meili/` proksi ei vali indeksit. Plaan kontrollib seda `nginx.host.conf`-is.

## 4. Kasutajaliides

**Lüliti.** `/search`-il on kollektsiooni kiibi reas segmentlüliti **Täistekst | Kirjad**
(en: *Full text | Letters*), seotud URL-i parameetriga `unit=letters` (vaikimisi puudub).
- Lülitamisel **säilivad** `q` ja kogu token (`collection` / töökollektsioon, ADR 0038).
  **Eemaldatakse** `p` (leht → 1) ja kõik režiimispetsiifilised parameetrid:
  - Täistekst → Kirjad: `scope`, `work`, `author`, `pageTags`, `teoseTags`, `type`,
    `genre`, `langs`, `ys`, `ye`, `sort` ja ülejäänud `useSearchUrlParams` filtrid;
  - Kirjad → Täistekst: kirjade parameetrid (`la`, `lad`, `lpf`, `lpt`, `llang`, `lys`,
    `lye`, `lsort`).
  Täpne nimekiri tuleb `useSearchUrlParams`-ist plaanis; põhimõte on valge nimekiri
  (säilivad ainult `q`, kogu, `unit`), mitte must — uus filter ei jää kogemata ellu.
- Lüliti on alati nähtav. Kirjadeta kogus näitab kirjade režiim tavalist tühja tulemust.
- Kogu sünk URL-iga jääb `useCollectionUrlSync`-i (ADR 0038). `unit` on tavaline
  otsinguparameeter ega puuduta kogu tokenit.

**Kirjade režiim** elab `src/pages/search/letters/`-is:
- `useLetterSearch`: päring `kirjad`-indeksisse (sama tenant-token), filtrid, tahud.
  Kogu/töökollektsiooni piirang käib `scopeClauses`-i kaudu
  (`src/services/selectionFilter.ts`). Kutsuja ootab `useSelectionScope().ready` ära ja
  laadimata töökollektsioon viskab (ADR 0042).
- `LetterFilters`: autor, adressaat, aastavahemik, saatmiskoht, sihtkoht, keel.
- `LetterResults`: tulemuse rida =
  **autor → adressaat · dateering · saatmiskoht → sihtkoht**, teine rida teose pealkiri,
  kolmas rida katke. Puuduv väli jäetakse välja, „[teadmata]" ei näidata.
  - **Dateering** kuvatakse `dating` objektist: vahemik vahemikuna, muidu `source_text`
    kui see on olemas, mitte arvuline piir.
  - **Varukuva:** kui autor, adressaat ja dateering kõik puuduvad, on esimene rida kirja
    `title`, selle puudumisel `incipit` (lõigatud), selle puudumisel „Kiri, lk N"
    (`first_page`). Rida ei ole kunagi tühi.
  - **Katke:** Meili `attributesToCrop`/`attributesToHighlight` `letter_text`-ile ja
    `abstract`-ile. Kui vaste on ainult nimes, kohas või pealkirjas, ei näidata
    tekstikatket — esiletõst on siis esimese rea väljadel; `abstract`-i vaste korral
    näidatakse `abstract`-i katket. Ilma päringuta (ainult filtrid) katket ei ole.
- Sortimine: asjakohasus (päringuga) / kuupäev ↑↓. Ilma päringuta on vaikimisi kuupäev ↑.
- Pagineerimine on sama mis lehekülgedel (`page` / `hitsPerPage` Meilis, URL-is `p`).

SearchPage hargneb `unit` järgi. Olemasolevaid lehekülgede hooke ei muudeta.

**Kirja avamine:** `/work/{work_id}/{first_page}?part={part_id}`. Workspace avab `?part=`
korral `WorkPartsPanel`-is selle osa. Uut marsruuti ei tule.

**i18n:** võtmed `search:letters.*` lisatakse mõlemasse keelde korraga (ADR 0011).

## 5. Testimine

**Backend (`tests/`):**
- `build_letter_documents`:
  - ainult `letter`;
  - dateering: vahemik → `date_start`/`date_end` piirid; dateeringuta kiri → `date_*`
    puuduvad (teose aasta EI asenda); `dating` objekt kantakse kuvamiseks üle;
  - katkendlikud lehed liidetakse teose järjekorras;
  - leht kahes kirjas läheb mõlemasse;
  - lehtedeta osa jääb välja;
  - aliased jõuavad `names_text`-i;
  - koht ilma ID-ta annab sildi, aga `*_id` puudub;
  - `attributesToSearchOn` väljad on alati olemas.
- **Ligipääsufilter tuleb lehedokumendist.** Mutatsioonitest: kui lehedokumendi
  `is_public` / `collections_hierarchy` muudetakse, peegeldub muutus kirjas.
- **Ligipääsu valvurid.** **Kaitstud kirjakogu tootmises praegu ei ole**, seega kaetakse
  see mockitud andmetega:
  - mockitud piiratud kogu teos kirjaga annab kirjadokumendi, kus `is_public: false` ja
    kogu on `collections_hierarchy`-s;
  - dekodeeritud tokenis `searchRules["kirjad"] == searchRules["teosed"]` (terve reegel,
    mitte ainult `filter` võti) kõigi rollide korral: anonüümne, contributor kogudega ja
    ilma, admin (adminil on reegel `{}` ilma `filter`-ita — test võrdleb reegleid, mitte
    `["filter"]`-i, mis annaks `KeyError`-i);
  - teosele piiratud tokenis puudub `kirjad`;
  - `update_collection_is_public_async` kasutab **PUT**-i (mitte POST) mõlemas indeksis
    ja saadab ainult `id` + `is_public` — test kontrollib meetodit, sest pelgalt
    „kirjutab mõlemasse" ei püüa asendusviga;
  - nähtavuse uuendus sihib Meilist küsitud kirjadokumente: mockitud indeksis on aegunud
    kiri, mida `_metadata.json`-is enam ei ole → ka see saab `is_public: false`.
- Sünkiteed: `sync_work_to_meilisearch`, `index_new_work`, `delete_work_from_meilisearch`
  puudutavad mõlemat indeksit. Mock-Meili laia `except`-i all kasutab `pytest.fail`-i.
  Juhtumid:
  - aegunute kustutus käib alles pärast upsert-task'i `succeeded`-i; upsert'i tõrke korral
    kustutust ei tehta;
  - kustutuse tõrge → sünk tagastab `False`;
  - **viimane kiri eemaldatud** → kirjadokumente 0, vana kustutatud;
  - **osa liik `letter` → muu** → kirjadokument kustutatud;
  - **viimane leht kustutatud** (lehedokumente 0) → kirjad kustutatakse enne `return False`.
- Isikunime muutus: isik, kes esineb **ainult kirja osas** (mitte teose `creators`-is) →
  `parts[].creators` silt uueneb `metadata_lock`-i all ja teos läheb Meili-sünki.
- Osa muutmine käivitab teose Meili-sünki.
- Seadete leping (sama muster mis `mcp/tests/test_meili_contract.py`): iga
  `LETTERS_SEARCHABLE_ATTRIBUTES` väli on **alati** dokumendis olemas; filterable/sortable
  väljad on kas olemas või loetletud valikuliste väljade nimekirjas (`*_id`, `date_*`,
  `languages` …) — valikulise välja puudumine on lubatud, tundmatu väli mitte.

**Frontend (vitest):**
- `useLetterSearch` filtriehitus: kogu piirang on alati kaasas ja laadimata töökollektsioon
  viskab.
- URL `unit` ↔ režiim. Lülitus säilitab ainult `q`, kogu tokeni ja `unit`-i; `p` ja kõik
  režiimifiltrid kaovad mõlemas suunas.
- Kattuvusfilter: `[A, B]` → `date_end >= A0101 AND date_start <= B1231`.
- `LetterResults` (jsdom): puuduvad väljad jäetakse välja; varukuva ahel
  (`title` → `incipit` → „Kiri, lk N"); vahemikdateering kuvatakse vahemikuna; nimevaste
  korral tekstikatket ei näidata.
- `localeParity` katab uued võtmed.

## 6. ADR ja dokumentatsioon

- **ADR 0065 — kirjaindeks:**
  - kiri on otsinguüksus kandjast sõltumata (v1-s ainult osad);
  - `kirjad` tuletatakse lehedokumentidest;
  - ligipääsufilter tuleb ühest funktsioonist ja jagatud teose token indeksit ei näe;
  - uues indeksis on ingliskeelsed väljanimed.
- CLAUDE.md „Invariandid": üks rida, mis viitab ADR 0065-le. „Arhitektuur": indeks
  `kirjad`.

## 7. Deploy

1. Eeldus: PR #561 (nähtavuse massuuendus) on main'is. Otsinguvõti katab juba kõik
   indeksid (§3), võtmesammu pole.
2. Backend: `./scripts/server_update.sh --no-cache`. Stardil luuakse `kirjad` ja selle
   seaded.
3. `./scripts/server_seed_data.sh` täidab mõlemad indeksid.
4. Frontend: `npm run build && rsync -avz --delete dist/ vutt:~/VUTT/dist/`.
5. Kontroll tootmises:
   - anonüümne kasutaja näeb `o17ekb` kirju kirjade režiimis;
   - anonüümse tokeni `searchRules`-is on `kirjad` sama filtriga mis `teosed`.

   Piiratud kogu kirja tootmises ei ole. Selle juhtumi katavad §5 mockitud valvurid.

## Väljaspool skoopi (järgmised sammud #526-s)

- **Osa kataloogiviide** (üksikkirja ESTER-i kirje, säilikutähis) ja **foliatsiooni silt**
  (1r, 1v…). Alles nende järel saab tulemuse real näidata „F 3,Mrg DCVIII, l. 246v–247".
- `part_ids` lehedokumentidel: lehekülgede režiimis „see leht on kirjas X".
- Eelmine/järgmine kiri ja lehenumbrist sõltumatu püsilink.
- MCP `search_letters`.
- CMIF eksport (#464 PR 4).
- Partii-import ESTER-i MARC-ist, laotused → lugemisjärjekord, kalendri kontroll, kohtade
  sidumine, `o17ekb` koodeksi roll (#526 p. 6–10).
