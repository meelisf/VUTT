# Kirjaotsing: kiri kui otsinguüksus (#526, samm 1)

**Kuupäev:** 2026-10-07 · **Issue:** #526 · **Seotud:** #464 / ADR 0057 (teose osad),
ADR 0006 (Meili väljanimed), ADR 0013 (sünk teose kaupa), ADR 0042 (töökollektsioonid),
ADR 0046 (sessioon = õiguste tõde), spekk `2026-09-26-teose-osad-design.md` §6 (CMIF)

## Probleem

Kirju ei saa otsida kirjadena. Autori, adressaadi, aasta ega saatmis- või sihtkoha järgi
ei saa üle korpuse filtreerida. Teose osad (#464) andsid kirjadele registri teose sees,
aga Meili otsing osade kaupa jäi v1-st välja.

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
  "date_start": "1684-01-02",      // dating.start (ADR 0037 kuju)
  "year": 1684,                    // date_start-ist, filtriks
  "date_text": "…",                // dating.source_text, kuvamiseks
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
Isik või koht ilma ID-ta on ainult nimena otsitav ja filtreerimisel tahk ei ole. VUTT ei
oleta.

**Seaded** (`server/meili_settings.py`, uued konstandid kõrvuti `teosed` omadega):

| | Väljad |
|---|---|
| `LETTERS_SEARCHABLE_ATTRIBUTES` (järjekorras) | `names_text`, `title`, `incipit`, `abstract`, `letter_text`, `archive_refs_text`, `work_title` |
| `LETTERS_FILTERABLE_ATTRIBUTES` | `id` (aegunute kustutus filtriga), `work_id`, `is_public`, `collections_hierarchy`, `author_ids`, `addressee_ids`, `authors`, `addressees`, `year`, `place_from`, `place_to`, `place_from_id`, `place_to_id`, `languages` |
| `LETTERS_SORTABLE_ATTRIBUTES` | `date_start`, `year` |

Tahud kasutavad v1-s silte (`authors`, `addressees`, `place_from`, `place_to`), sest
kohtade sidumine registriga on lõpetamata (#526 p. 9). ID-väljad on filtreeritavad juba
praegu, et seotud andmetele üleminek ei vajaks reindeksit.

## 2. Ehitus ja sünk

**Põhimõte:** kirjadokument tuletatakse sama teose juba ehitatud lehedokumentidest. Nii
tulevad ligipääsuväljad ja puhastatud tekst täpselt sealt, kust `teosed`-is, ja indeksid
ei saa neis lahku minna.

- `meili_doc.build_letter_documents(meta, page_documents, people_data) -> list[dict]` on
  puhas funktsioon. Ta kaardistab `parts[].pages` (tüved) lehedokumentideks ja liidab
  teksti teose järjekorras. Leht, mis kuulub kahte kirja, läheb mõlemasse.
- Live-tee (`meilisearch_ops`) ja seed-tee (`scripts/1-1_consolidate_data.py`) kutsuvad
  sama funktsiooni (CLAUDE.md: uus indekseeritav väli ainult `meili_doc.py`-sse).

**Kirjutusteed:**

| Tee | `kirjad`-is |
|---|---|
| `sync_work_to_meilisearch` | upsert uued, siis kustuta selle `work_id` aegunud id-d (`work_id = X AND id NOT IN [uued]`); kirjadeta teosel ainult kustutus |
| `index_new_work` | sama |
| `delete_work_from_meilisearch` | kustuta `work_id` järgi |
| `update_collection_is_public_async` | uuenda `is_public` ka kirjadokumentidel (id-d `_metadata.json` `parts`-ist). **Lekkekoht:** see tee ei ehita dokumente uuesti, vaid uuendab ainult ühte välja |
| seed (`1-1` → `2-1_upload_to_meili.py`, `server_seed_data.sh`) | ehitab `kirjad`-i nullist |

- Osade muutmine (`/works/{id}/parts`) peab käivitama teose Meili-sünki. Plaan kontrollib
  seda ja lisab sünki, kui see puudub.
- **Järjekord on upsert → aegunute kustutus**, mitte vastupidi: kahe Meili töö vahel
  tehtud otsing ei tohi näha teost ilma kirjadeta (sama muster mis `_delete_extra_pages`).
- **Vead:** kirjade upsert'i ebaõnnestumine märgib teose dirty'ks samamoodi kui `teosed`
  (ADR 0013). Ühe indeksi viga ei blokeeri teise kirjutust, mõlemad logitakse.
- **Seaded jooksvale instantsile:** `_ensure_letters_index()` (stardil, nagu
  `_ensure_filterable_attributes`) loob indeksi, kui seda pole, ja rakendab seaded.
  Deploy ei vaja käsitsi Meili sammu.
- **Esmane täitmine:** `scripts/sync_meilisearch.py --letters` (kõik osadega teosed) või
  täis-seed.
- **Paarsus:** `scripts/verify_meili_seed_live_parity.py` võrdleb ka kirjadokumente.

## 3. Ligipääs

**Põhimõte:** üks funktsioon annab ligipääsufiltri ja mõlemad indeksid saavad sama stringi.

- `meilisearch_ops._access_filter(user) -> str | None` (`None` = admin, piiranguta).
  `generate_meili_token` ehitab `searchRules = {"teosed": R, "kirjad": R}`, kus `R` on
  mõlemal sama.
- `generate_work_scoped_meili_token` (lingiga jagatud teos) `kirjad`-i **ei anna**.
  Jagatav teos on avatav, mitte otsitav (ADR 0042 `is_search_visible`).
- **Otsinguvõti.** Meili võtme `indexes` loendit ei saa pärast loomist muuta. Deploy
  esimene samm kontrollib serveris `GET /keys`. Kui `MEILI_SEARCH_KEY` on piiratud
  `["teosed"]`-iga, luuakse uus otsinguvõti (`actions: ["search"]`,
  `indexes: ["teosed", "kirjad"]`) ja vahetatakse env-is `MEILI_SEARCH_KEY` /
  `MEILI_SEARCH_KEY_UID` (ADR 0021 nimed). Juba antud tokenid aeguvad ise (15 min / 1 h).
- **nginx:** `/meili/` proksi ei vali indeksit. Plaan kontrollib seda `nginx.host.conf`-is.

## 4. Kasutajaliides

**Lüliti.** `/search`-il on kollektsiooni kiibi reas segmentlüliti **Täistekst | Kirjad**
(en: *Full text | Letters*), seotud URL-i parameetriga `unit=letters` (vaikimisi puudub).
- Lülitamine säilitab `q` ja kollektsiooni/töökollektsiooni, aga eemaldab
  režiimispetsiifilised filtrid ja seab lehe 1-le. Teise režiimi jäänud nähtamatut filtrit
  ei teki.
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
  **autor → adressaat · kuupäev (või `date_text`) · saatmiskoht → sihtkoht**, teine rida
  teose pealkiri, kolmas rida esiletõstuga katke `letter_text`-ist. Puuduv väli jäetakse
  välja, „[teadmata]" ei näidata.
- Sortimine: asjakohasus (päringuga) / kuupäev ↑↓. Ilma päringuta on vaikimisi kuupäev ↑.
- Pagineerimine on sama mis lehekülgedel (`page` / `hitsPerPage`).

SearchPage hargneb `unit` järgi. Olemasolevaid lehekülgede hooke ei muudeta.

**Kirja avamine:** `/work/{work_id}/{first_page}?part={part_id}`. Workspace avab `?part=`
korral `WorkPartsPanel`-is selle osa. Uut marsruuti ei tule.

**i18n:** võtmed `search:letters.*` lisatakse mõlemasse keelde korraga (ADR 0011).

## 5. Testimine

**Backend (`tests/`):**
- `build_letter_documents`:
  - ainult `letter`;
  - katkendlikud lehed liidetakse teose järjekorras;
  - leht kahes kirjas läheb mõlemasse;
  - lehtedeta osa jääb välja;
  - aliased jõuavad `names_text`-i;
  - koht ilma ID-ta annab sildi, aga `*_id` puudub;
  - `year` tuleb `date_start`-ist;
  - `attributesToSearchOn` väljad on alati olemas.
- **Ligipääsufilter tuleb lehedokumendist.** Mutatsioonitest: kui lehedokumendi
  `is_public` / `collections_hierarchy` muudetakse, peegeldub muutus kirjas.
- **Ligipääsu valvurid.** **Kaitstud kirjakogu tootmises praegu ei ole**, seega kaetakse
  see mockitud andmetega:
  - mockitud piiratud kogu teos kirjaga annab kirjadokumendi, kus `is_public: false` ja
    kogu on `collections_hierarchy`-s;
  - dekodeeritud tokenis `searchRules["kirjad"]["filter"] == searchRules["teosed"]["filter"]`
    kõigi rollide korral: anonüümne, contributor kogudega ja ilma, admin;
  - teosele piiratud tokenis puudub `kirjad`;
  - `update_collection_is_public_async` kirjutab mõlemasse indeksisse (mock-Meili).
- Sünkiteed: `sync_work_to_meilisearch`, `index_new_work`, `delete_work_from_meilisearch`
  puudutavad mõlemat indeksit. Mock-Meili laia `except`-i all kasutab `pytest.fail`-i.
- Osa muutmine käivitab teose Meili-sünki.
- Seadete leping: iga searchable/filterable väli esineb `build_letter_documents`-i
  väljundis (sama muster mis `mcp/tests/test_meili_contract.py`).

**Frontend (vitest):**
- `useLetterSearch` filtriehitus: kogu piirang on alati kaasas ja laadimata töökollektsioon
  viskab.
- URL `unit` ↔ režiim. Lülitus eemaldab režiimifiltrid ja säilitab `q` ja kogu.
- `LetterResults` (jsdom): puuduvad väljad jäetakse välja.
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

1. Serveris `GET /keys`: kas otsinguvõti katab `kirjad`-i? Vajadusel uus võti ja env-i
   vahetus (§3).
2. Backend: `./scripts/server_update.sh --no-cache`. Stardil luuakse `kirjad` ja selle
   seaded.
3. `scripts/sync_meilisearch.py --letters` (serveris host-venviga) täidab indeksi.
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
