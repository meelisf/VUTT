# 0076 — Eksemplari kiht: `exemplars` on ainus salvestatud kuju, `archive_refs` tuletatakse

**Staatus:** vastu võetud 2026-11-01, teostamata (#696 etapp 2, #702, #703)

## Kontekst

VUTT-i teos on korraga bibliograafiline väljaanne ja üks digiteeritud eksemplar (#696).
Hoidja ja kohaviit elavad teose väljal `archive_refs` (`{archive_id, reference, url?}`). Seda
välja kirjutavad üldine metaandmete salvestus, upload ja ADA import. Konvoluut (#702),
defektsus, köide ja vesimärgid (#696 etapp 3) on aga **eksemplari** omadused: sama
raamatukogu võib hoida sama trükist kahes konvoluudis (TÜR R Est.B-954 ja R Est.B-954 (I)).

Arutelu, kaks ülevaatust ja kavandi täpsustused:
`docs/superpowers/specs/2026-10-19-eksemplari-kiht-ja-paber-arutelu.md`,
`docs/reviews/2026-10-31-eksemplari-kiht-*.md`. Nõuded, mis sealt ADR-i tulevad:

- `clean_archive_refs` (server) ja `cleanArchiveRefs` (klient) ehitavad kirje kolmest väljast
  uuesti. Kui `archive_refs`-i lihtsalt laiendada, kaoksid lisaväljad iga tavalise
  salvestusega (jk. §1).
- Üks viide ei tõesta üht füüsilist eksemplari. Esimest viidet ei tohi automaatselt
  tekstitunnistajaks valida (jk. §2).
- Eksemplari andmed täidab suures osas agent ESTERi põhjal (#703). Väljad peavad olema
  struktureeritud ja kandma allikaviidet.

Tootmises (2026-11-01) on `archive_refs` 131 teosel, igaühel täpselt üks kirje: 116
käsikirja ja 15 trükist. Konvoluuti mainib neist 5. Ühelgi konvoluudil pole VUTT-is teist
liiget. 244 teosel on võti tühja loendiga.

## Otsus

### 1. Salvestus: ainult `exemplars`

- `_metadata.json` väli `exemplars[]` on eksemplaride **ainus salvestatud kuju**. Migratsiooni
  järel `_metadata.json`-is võtit `archive_refs` ei ole.
- `archive_refs` jääb **lugemiskujuks** (`{archive_id: holder, reference: shelfmark, url}`).
  Tuletus on **üks funktsioon** `derive_archive_refs(meta)`, mida kasutavad kõik lugejad:
  `meili_doc` (ka `archive_refs_text`), `/get-work-metadata`, `metadata_handler`,
  `work_relations._first_archive_ref` ja upload'i meta-vaade. Meili, MCP, `WorkCard` ja
  `WorkInfoPanel` töötavad seega muutmata edasi, kuni neid ümber ei tehta.
- Kahte salvestatud tõeallikat ei ole. Seepärast ei ole ka sünkroniseerimist, mis võiks
  lahku minna.

### 2. Eksemplari kirje

Kõik väljad peale `id` ja `holder` on valikulised. Näide on erandlehega eksemplar (mitte
tunnistaja), mis on konvoluudi liige, agendi rikastatud ja veel üle vaatamata.
Tekstitunnistajal oleks `"text_witness": true` ja `pages`-i võtit ei oleks (p 3, 4).

```jsonc
{
  "id": "x7Kq2m",                 // server annab (generate_nanoid(6)), ei muutu kunagi
  "holder": "TÜR",                // archives.json võti; kohustuslik
  "shelfmark": "R Est.B-954 (konvoluut)",  // kohaviit nagu hoidja kataloogis
  "url": "https://…",             // väline digikoopia
  "pages": ["0007"],              // ainult reegli 5 erand: lehetüvede hulk (vt p 4)
  "condition": "defektne: puuduvad A2, B1–2",  // vabatekst
  "binding": "pärgamentköide",    // köide = köitmine, vabatekst
  "provenance": "…",              // vabatekst
  "convolute": {                  // ainult konvoluudi liikmel
    "reference": "R Est.B-954",   // konvoluudi kohaviit; hoidja = eksemplari hoidja
    "position": 1,                // 0 = põhiteos, N = N. kaasköide, null = teadmata
    "total": 13,                  // trükiste arv köites, null = teadmata
    "contents": "…"               // sisukord vabatekstina, kui teada
  },
  "notes": "…",
  "source": {                     // kust kirje tuli
    "kind": "ester",              // ester | ada | upload | migration | manual
    "ref": "b2648642",            // ALATI string: ESTERi kirje, DSpace handle,
                                  // migratsioonil "TÜR: R Est.B-954 (konvoluut)"
    "at": "2026-11-01"
  },
  "needs_review": true            // vt allpool
}
```

- **ID on püsiv.** Kohaviida või hoidja parandus ID-d ei muuda. Hilisemad vaatlused
  (etapp 3) viitavad ID-le.
- **Massiivi järjekord on kuvamisjärjekord.**
- **Väärtuseta väli = võtme puudumine.** `_metadata.json`-i ei salvestata võtit väärtusega
  `null`, `false`, `""` ega `[]` (`text_witness`, `pages`, `needs_review`, `url`,
  `convolute` …). Normaliseerimine käib iga kirjutuse eel nagu `drop_empty_relations`
  (ADR 0075). Muidu tekitaks `false` vs puuduv võti no-op salvestusel commiti (ADR 0012).
  NB! `work_parts` hoiab `needs_review: false` alles. Eksemplarid seda mustrit ei järgi.
- **`needs_review`** tähendab: **kirje vastavus füüsilisele eksemplarile on kontrollimata.**
  Server paneb lipu ise igale **automaatselt loodud** kirjele: migratsioon, upload'i ja ADA
  `archive_refs`-i teisendus, agendi ettepanekust loodud eksemplar. Sama kehtib, kui seos
  lehtedega läheb kahtlaseks: tühjaks jäänud `pages`, lehestiku asendus. Liputa on
  ainult eksemplaride vormis käsitsi loodud kirje. Lipu võtab maha ainult inimene
  selgesõnalise toiminguga (vormis või ettepaneku kinnitusel eraldi valik). Muu salvestus
  ega agendi ettepaneku kinnitus seda automaatselt ei eemalda. Agent ei saa lippu panna
  ega eemaldada.
- Katalooginumbrid, mis kirjeldavad väljaannet (Jaanson, VD17, ESTERi kirje), on teose
  väljad, mitte eksemplari omad. `ester_id` on juba teosel.
- Eksemplari pildid, tüpograafia ja paberiandmed ei kuulu siia. Need tulevad etapi 3 ADR-iga
  (pildid `_exemplars/{id}/`, pildiserveri laiendus).
- **Käsikirjal on üks eksemplar** (`type.id == Q87167`): dokument ise. Ka täpne ümberkiri on
  teine dokument, sest aeg ja kirjutaja on teised. Seega on see eraldi teos ja seotakse
  variandiseosega (`isVersionOf`, ADR 0075), mitte teise eksemplarina. Kirjutustee
  lükkab käsikirja eksemplaride arvu kasvu üle ühe tagasi (400, sõnum suunab
  variandiseose juurde). Keelatud on **ainult kasv**: kui teos on hiljem käsikirjaks
  muudetud ja tal on juba mitu eksemplari, saab neid muuta ja kustutada.
  Käsikirja ainus `archive_refs`-i viide **on** see eksemplar, seepärast ei saa
  teisendus (migratsioon, upload) talle `needs_review`-lippu. Mitu viidet käsikirjal on
  vastuolu, mille lahendab inimene: kõik saavad lipu, midagi ei visata ära.

### 3. Tekstitunnistaja

- Teosel on **0 või 1** eksemplari, millel on `text_witness: true`. Server jõustab selle
  ühes kirjutuses:
  - uus tunnistaja kaotab oma `pages`-i (tema lehed on nüüd niikuinii vaikimisi tema omad);
  - eelmine tunnistaja kaotab märke. Kuna tal `pages`-i polnud, ei ole tal pärast seda ühtki
    lehte. See on tahtlik: vahetus tähendab, et skaneering on teise eksemplari oma.
- Märke paneb ainult inimene (vorm või ettepaneku kinnitus). Migratsioon ja agent seda
  automaatselt ei pane. Kontrollimata seos jääb määramata.
- **Teose kogu lehestiku asendus** (`replace_work_content`, upload „asenda sisu") nullib
  kogu lehtede päritolu. Tunnistaja kaotab märke, kõigi eksemplaride `pages` ja
  `exemplar_unknown_pages` (p 4) eemaldatakse ning iga mõjutatud eksemplar saab
  `needs_review: true`. Asendus genereerib failinimed teose ja lehenumbri järgi, seega
  oleksid vanad tüved uutel lehtedel samad. Ilma nullimiseta päriks uus skaneering vana
  päritolu: tunnistajalt vaikimisi, erandeksemplarilt tüve kaudu.

### 4. Lehed

- **Lehe eksemplar** lahendatakse selles järjekorras:
  1. see eksemplar, mille `pages` sisaldab lehe tüve;
  2. teadmata, kui tüvi on teose väljal `exemplar_unknown_pages`;
  3. muidu tekstitunnistaja;
  4. tunnistaja puudumisel teadmata.

  `exemplar_unknown_pages` kuulub eksemplari kihti: seda kirjutab ainult `work_exemplars`,
  seda sünkroniseeritakse nagu `pages`-i ja väärtuseta võtit ei salvestata. Ilma selleta ei
  saaks teadmata päritoluga lehte märkida teosel, millel on tunnistaja.
- Tekstitunnistajal ei ole kunagi `pages`-i. `pages` on ainult erandlehtedega eksemplaril
  (reegel 5: teise eksemplari leht täiendab tunnistajat). Leht saab olla ainult ühe
  eksemplari `pages`-is. Erandlehti tohib märkida ka siis, kui teosel tunnistajat veel pole:
  ühe lehe päritolu võib olla teada enne kogu skaneeringu oma.
- Lehetoimingud sünkroniseerivad `pages`-i sama ühenduskohaga nagu osad (ADR 0057):
  `refresh_work_mentions` kutsub eksemplaride sünki, poolitus annab `renamed`-i (mõlemad
  pooled pärivad lähtelehe eksemplari) ja kustutatud tüvi eemaldatakse. Tühjaks jäänud
  `pages` → `needs_review: true`. Eksemplari ennast ei kustutata.
- **Üksiku lehe pildi asendus** (`replace-image`) säilitab tüve. Seepärast nõuab ta teosel,
  millel on vähemalt üks eksemplar, selgesõnalist päritolu: `same` (sama eksemplari uus
  skaneering, muutust ei ole), eksemplari `id` või `unknown`. Valitud päritolu kirjutatakse
  samas `work_lock`-is: tüvi eemaldatakse teiste eksemplaride `pages`-ist ja
  `exemplar_unknown_pages`-ist ning lisatakse valitule. Tunnistaja valimisel tüvi ainult
  eemaldatakse. Tühjaks jäänud `pages` → `needs_review`. Vaikimisi valikut ei ole. Erandseose
  eemaldamine üksi ei aitaks, sest siis päriks leht vaikimisi tunnistaja (jk. §3).
- **Lehtede lisamine teose haldusse** (`insert_prepared_pages`, ADR 0074) küsib sama
  päritolu kõigile lisatavatele lehtedele. Uus leht päriks muidu vaikimisi tunnistaja.
  Eksemplarideta teosel neid küsimusi ei esitata.

### 5. Kirjutustee

- `exemplars` muutub **ainult** oma otspunktidega (`server/work_exemplars.py`, router
  `server/routers/work_exemplars.py`), nagu osad: loomine, muutmine, kustutamine ja
  järjestus `metadata_lock`-i all `bulk_update_works` kaudu, üks commit, Meili sünk.
  Õigus on sama mis praegu `archive_refs`-il: `require_role("admin")` + `can_write_work`.
- `/update-work-metadata` lükkab tagasi nii `exemplars`-i kui `archive_refs`-i (400).
  `MetadataModal`-i arhiiviviidete sektsioon asendub eksemplaride sektsiooniga, mis kutsub
  uusi otspunkte.
- **Uue teose loomine** (`import_as_new_work`, ADA import) võib endiselt saata
  `archive_refs`-i. Server teisendab selle loomisel eksemplarideks (`source.kind` =
  `upload` / `ada`). Loomisel ei ole samaaegset toimetajat, seega see ei ole teine
  kirjutustee.
- **Olemasoleva teose sisu asendus** (`replace_work_content`) EI kirjuta eksemplare ega
  `archive_refs`-i: väli jäetakse `metadata_updates`-ist välja ja upload'i vorm ei näita
  seda asendusrežiimis. Asenduse mõju tunnistajale: p 3.
- Hoidja kustutamise kontroll (`collections._find_works_with_archive`) loeb `exemplars`-i.

### 6. Konvoluut

- Samas konvoluudis on eksemplarid, millel on sama `holder` ja sama **normaliseeritud**
  `convolute.reference`. Rühm tuletatakse lugemisel. Eraldi konvoluudikirjet ei looda ja
  VUTT-is puuduv trükis kirjet ei saa: temast räägivad `total` ja `contents`.
- Normaliseerimine on **üks funktsioon** `convolute_key(holder, reference)`, mida kasutavad
  server ja agent. Ta rakendub **ainult `convolute.reference`-ile**, kust liikme koht on juba
  `position`-isse eraldatud, mitte toorele `shelfmark`-ile. Reeglid:
  - märge „konvoluut“ (sulgudes või ilma) eemaldatakse;
  - tähesuurus ühtlustatakse, samuti tühikud, ka punkti ja sidekriipsu ümber
    (`R Est. B-954` = `R Est.B-954`, `R Bergm.357` = `R Bergm. 357`);
  - köite rooma number jääb võtmesse ühtsel kujul (`R Est.B-954 I` = `R Est.B-954 (I)`;
    `R Est.B-954` on teine rühm).

  Testid kasutavad tootmise ja ESTERi päris kujusid.
- `convolute.reference` on selgesõnaline väli, mitte `shelfmark`-ist tuletatud: kohaviit võib
  sisaldada liikme numbrit (`R Bergm. 357(8)` → konvoluut `R Bergm. 357`, koht 8). Sulgude
  tähendus sõltub kataloogist, seega lahutab need inimene või agent, mitte funktsioon.
- **Kaaslaste leidmine:** tuletatud read-model `convolute_index.json` (`{võti: [work_id, …]}`,
  ADR 0007). See ehitatakse `rebuild_indices`-is ja uuendatakse samas kohas, kus
  `works_creators_index`-i (`update_work_facts`). `GET /works/{id}/exemplars` lahendab
  kaaslased indeksi kaudu nagu `resolve_relations` (ADR 0075): pealkiri ja aasta loetakse
  kettalt, piiratud kaaslane `readable: false`, vastus ei lähe `server/cache.py`-sse.
  Meilisse uut filtreeritavat välja ei tule. Ligipääsufilter peidaks piiratud kaaslase
  täielikult, #701 kuvab ta aga pealkirjaga.
- **Täiendus 2026-11-01 (#702):** Meili teosedokument kannab **kuvamisvälja**
  `convolute_count` (`len(convolute_keys(meta))`, väärtuseta = puudub). Väli ei ole
  filtreeritav ega otsitav. Teosekaart ja infopaneel otsustavad selle järgi, kas
  küsida `GET /works/{id}/exemplars`. Ilma selleta peaks iga kaart tegema päringu.
  Liikmeid ega võtmeid Meilisse ei kirjutata: kaaslased tulevad endiselt indeksist.
  `/get-work-metadata` annab sama arvu, et `MetadataModal` saaks Workspace'i teose
  pärast eksemplari salvestust värskendada.

### 7. Agendi ettepanek

- Uus liik `exemplars` olemasolevas agendikoodis (`agent_handoff.KINDS`, ADR 0058 täiendus
  2026-10-20), oma hoidla `state/exemplar_proposals.sqlite3`. Sihtmärk on üks teos või kõik
  teosed. Nagu teised liigid, on see esialgu ainult superadminil.
- Ettepaneku rida on kas **uus eksemplar** või **väljade muudatus olemasolevale eksemplarile**
  (`id` järgi). Iga rida kannab `source`-i. Agent ei saa määrata `text_witness`-it,
  `pages`-i ega `needs_review`-d. Uuest eksemplarist loodud kirje saab kinnitusel lipu
  serverilt (p 2): ettepaneku kinnitus tähendab, et toimetaja nõustub andmetega, mitte et
  füüsiline vastavus on kontrollitud.
- **Konflikti kontroll on rea tasemel, mitte kogu loendi räsiga.** Muudatusrida kannab
  muudetavate väljade baasväärtusi. Kinnitusel peab eksemplar `id`-ga olemas olema ja need
  väljad peavad baasiga kattuma. Muidu on rida `stale` ja teisi ridu see ei blokeeri. Nii ei
  aegu sama teose teine rida ainult seetõttu, et esimene kinnitati.
- Ülevaatus käib teose kaupa. Toimetaja võib kinnitada valitud read **ühe partiina** (üks
  commit) või ükshaaval. Kinnitus käib samade `work_exemplars` funktsioonide kaudu nagu
  käsitsi muutmine. `needs_review` selle käigus ei muutu (p 2).

### 8. Migratsioon

Üks skript, kuivkäivitus vaikimisi. Iga `archive_refs` kirje → üks eksemplar
(`source.kind: "migration"`, `source.ref` = algne kirje stringina `"{archive_id}: {reference}"`,
`url` üle, `needs_review: true` (käsikirja ainsal viitel mitte, p 2), `text_witness` puudub).
Seejärel eemaldatakse `archive_refs`, ka tühi loend. Hoidjata viide peatab skripti, sest
hoidja on kohustuslik ja viide kaoks: hoidja lisatakse enne käsitsi. Kõik teosed lähevad
ühe commitiga.

**Kasutuselevõtt.** Vana ja uus server ei tohi kumbki näha teise kuju. Vana server kirjutaks
`archive_refs`-i tagasi, uus server peidaks migreerimata viited. VUTT-il hooldusrežiimi ei ole,
seega peatatakse kirjutused backendi seiskamisega:

0. Serveri `data/.gitignore`-i lisatakse `config/convolute_index.json` (tuletatud
   read-model, p 6).
1. `docker stop vutt-backend`. Kõik kirjutused (ja lugemine API kaudu) on peatatud. Meili
   ja pildiserver jäävad tööle, nii et otsing ja pildid toimivad.
2. Migratsioon uue image'iga, enne päriselt kuivkäivitus. Raport: teoste arv, eksemplaride
   arv, `archive_refs`-iga teoseid järel 0.
3. `server_update.sh --no-cache` käivitab uue backendi. Seejärel frontendi rsync.
4. Kontroll: täisreindeks (`server_seed_data.sh`), proovteose infopaneel, `MetadataModal`-i
   eksemplaride sektsioon.

Kirjutused avanevad koos 3. sammuga. Brauseris vahemällu jäänud vana klient saadab
`archive_refs`-i, uus server lükkab selle tagasi (400) ja andmed ei muutu. Uue serveri
stardikontroll annab `record_server_error`-i, kui mõni `_metadata.json` kannab veel
`archive_refs`-i, nii et migreerimata teos ei jää märkamatuks. `derive_archive_refs` vana
välja varuvariandina ei loe: muidu oleks jälle kaks tõeallikat.

## Mida teadlikult EI tehtud

- `archive_refs`-i ei laiendatud eksemplariks. See oleks jätnud kaks puhastajat ja üldise
  vormi, mis kogu massiivi üle kirjutab (jk. §1).
- Konvoluut ei ole oma kirje ega otsingufilter (#702).
- Lehtedeta teos (digiteerimata eksemplariga bibliograafiline kirje) ei kuulu siia. See vajab
  oma tööd: indekseerimine, `lehekylje_number = 1` filtrid, kaanepilt (jk. §5).
- Vaatlused, nende nähtavus ja pildid kuuluvad etapi 3 ADR-i.

## Tagajärjed

- Uus eksemplari väli = rida skeemis + valideerimine `work_exemplars`-is. Kirjutustee jääb
  samaks.
- Uus `exemplars`-it kirjutav tee peab minema `work_exemplars` kaudu. Muidu jääb
  tekstitunnistaja reegel ja ID püsivus jõustamata.
- Uus lehefaile muutev tee saab eksemplaride sünki `refresh_work_mentions` kaudu (ADR 0055,
  0057).
- Uus tee, mis kirjutab lehele **uue pildi** (asendus, lisamine, import olemasolevasse
  teosesse), peab eksemplaridega teosel küsima päritolu (p 4). Muidu pärib pilt vaikselt
  tunnistaja või vana tüve päritolu.
- Kui keegi loeb `_metadata.json`-ist `archive_refs`-i otse (mitte Meilist), saab ta
  migratsiooni järel tühja tulemuse. Praegused otselugejad tuleb viia
  `derive_archive_refs`-ile või `exemplars`-ile samas PR-is, kus migratsioon tehakse:
  - `meili_doc`, `metadata_handler`, `work_relations._first_archive_ref`;
  - `collections._find_works_with_archive`;
  - `/get-work-metadata` (`MetadataModal` laeb sealt);
  - upload'i meta-vaade (`upload_ops`, `UploadMetaForm` asendusrežiimis).
- Uus eksemplari väli, mis peab jõudma konvoluudi rühmitusse või otsingusse, läheb
  `update_work_facts` / `meili_doc` kaudu. Uut paralleelset indeksi kirjutajat ei looda.
