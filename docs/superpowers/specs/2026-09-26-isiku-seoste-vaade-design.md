# Isiku seoste vaade: üks võrgustiku-leping, kolm vaadet (#461)

**Kuupäev:** 2026-09-26 · **Issue:** #461 · **Seotud:** #464 (teose osad, adressaat),
#465 (toimumiskoht), #463 (eluteekond), #460 (seoste kaart eirab kogu)
· **Mockup:** https://claude.ai/artifact/HFjqXcRj9KF2GMkeCpzDKK (v4, päris andmed)

## Probleem

Isikulehe seosed on praegu kahes kohas ja kumbki vastab ainult osale küsimustest:

- `WorkRelationsCard` (`GET /prosopography/work-relations/{id}`) loetleb isikud, kellega
  isik jagab teost. Allikas on **ainult `creators[]`** (`works_creators_index.json`):
  märksõna-isikud (`subject`, 108 seost), lehe mainimised (`mentioned`, 22) ja trükkalid
  (`publisher`, 1048) jäävad välja. Näide: Fischeri magistripromotsiooni kutse
  (`jy30do`, Altdorf 1659) seob Fischeri märksõnana; promootor Schwäger on `auctor`.
  Seda seost ei näe kusagil.
- Seoste kaart (`/persons?view=map&related_to=`) paigutab seotud isikud
  **päritolu** järgi. See vastab küsimusele „kust nad pärit on", mitte küsimustele
  „kes kellega", „mis rollis" või „kus".

Rollipaar ei ole kõikjal võrdne. Praeses ↔ respondens ja programmi autor ↔ kõneleja on
isiklik akadeemiline akt. Kaasgratulandid seisavad lihtsalt samal lehel. Dau 45 seotud
isikust on 23 kaaspühendajad ühes trükises.

## Mõõdetud seis (tootmine, 2026-09-26)

- 2125 isikut, 670 isikul vähemalt üks teosekaaslane (mediaan 3). Suurimad: Vogel 241,
  Luden 159, Brendeken 155 (trükkalid ja professorid).
- `person_to_works` rollid: publisher 1048, praeses 764, respondens 505, auctor 432,
  gratulator 184, subject 108, aui 84, dedicator 34, mentioned 22.
- Päritolu on teada 849 isikul. Struktureeritud seoseid (`relations[]`) on 65 isikul.

## Otsused mockup'i arutelust

1. **Seoste allikas on kõik `person_to_works` rollid**, mitte ainult `creators`.
2. **Seose liik tuleneb rollipaarist ühes kohas** (reeglite tabel allpool, serveris).
   Liike on kuus: kolm tugevat (värviga) ja kolm nõrka (hall).
3. **Trükikoht ei tõenda kohtumist.** Ka disputatsioon võidi trükkida Riias ja pidada
   Tartus. Kaardil nimetatakse trükikohta trükikohaks. Toimumiskoht tuleb hiljem
   #465-st ja kirja kirjutamiskoht #464-st.
4. **Servamudel on üldine**, et #464 (osad, adressaat) ja #465 (toimumiskoht) sobituksid
   hiljem ilma vaadete ümberehituseta.
5. **Pühendatule uut rolli ei tule.** Pühendus on sageli nõrk seos.
6. Hüpikaken kinnitub klikiga ja sisaldab linke isiku- ja teoselehele. Rollid kuvatakse
   nimedega („Sjöberg: pühendaja · Dau: pühendaja"), mitte „tema / fookus".

## Seose liigid ja reeglid

Serv tekib fookusisiku ja teise isiku vahel **iga ühise teose kohta**. Liik määratakse
esimese sobiva reegliga (järjekord on oluline). `F` = fookuse rollid selles teoses,
`O` = teise isiku rollid. `looja` = üks rollidest `praeses, respondens, auctor,
gratulator, dedicator, editor, aui`.

| # | Liik | Kood | Tugev | Reegel | Suund |
|---|---|---|---|---|---|
| 1 | Akadeemiline akt | `academic` | jah | praeses ↔ respondens; `aui` ↔ `auctor` | praeses → respondens; aui → auctor |
| 2 | Teos isikule / isikust | `dedicated` | jah | looja (v.a `dedicator`) ↔ `subject`; `gratulator` ↔ `auctor` / `respondens` | looja → subject; gratulant → autor |
| 3 | Kaastekst | `cotext` | ei | mõlemad on loojad (nt gratulant–gratulant, aui–gratulant, pühendaja–pühendaja); `dedicator` ↔ `subject` | suunata |
| 4 | Trükkal | `printer` | ei | kumbki on `publisher` (ka siis, kui teine on `mentioned`) | suunata |
| 5 | Mainimine | `mention` | ei | kumbki on `mentioned`; või mõlemad on `subject` (kaasmärksõnad) | suunata |
| — | Perekond / muu | `family` | jah | isikukaardi `relations[]` (mitte teosest) | kaardi järgi |

**Täpsustused:**

- `looja` hõlmab ka rolli `creator`, mis on vaikeväärtus puuduva rolli korral
  (`indices.py`; tootmises 1 kirje).
- **Tundmatu roll** (ei ole looja, `subject`, `mentioned` ega `publisher`) ei osale
  ühegi reegli sobitamisel. Kui paar ei sobitu ühegi reegliga (näiteks mõlemal on
  ainult tundmatud rollid), on liik `cotext`. Ehitaja logib tundmatu rolli **üks kord
  rolli kohta**, et uus roll ei jääks märkamata.
- **Suund** määratakse reeglis nimetatud rollipaari järgi. Kui sama reegel sobitub
  mõlemat pidi (näiteks mõlemad on `auctor` + `subject`), on serv `directed: false`
  ja `from`/`to` järjestatakse ID järgi.
- **Sümmeetria:** paari (A, B) serv teose W kohta on sama, olgu fookus A või B.
  Liik, `directed` ja `from`/`to` ei sõltu sellest, kelle vaatest arvutatakse.

Kontrollnäited, mis on ühtlasi testid (vt Testimine):

- Dalinus `auctor`, Luden `aui` („Oratio de pietate") → `academic`.
- Dalinus `gratulator`, Luden `aui` („De libertate politica oratio") → `cotext`.
- Schwäger `auctor`, Fischer `subject` (`jy30do`) → `dedicated`, Schwäger → Fischer.
- Dau `dedicator`, 23 isikut `dedicator` samas teoses → `cotext`.
- Dau `praeses`, Fischer `mentioned` lk 2 (`3ix06q`) → `mention`, `pages: [2]`.

**Isiku liik ja suurus arvutatakse kliendis nähtavatest servadest**, mitte serveris.
Järjekord on:

1. rakenda liigifilter servadele;
2. eemalda isikud, kellel ei jäänud ühtki nähtavat serva;
3. arvuta iga isiku liik (tugevaim nähtav serv: `academic > dedicated > family >
   cotext > mention > printer`), sõlme suurus ja päise loendurid.

Kui isiku tugevaim serv on filtriga peidetud, saab ta värvi järgmisest nähtavast
servast. „Ühiste teoste arv" on **unikaalsete `evidence.work_id`-de** arv, mitte servade
arv, sest samas teoses võib olla mitu rolli.

## Andmeleping

### Endpoint

`GET /prosopography/{person_id}/network?collection=<id>`

- Avalik, nagu `GET /prosopography/{id}` ja `work-relations`. Sync `def` (ADR 0002):
  loeb read-model faile. Route PEAB olema routeris enne üldist
  `GET /{person_id:path}`-i, muidu neelab see `…/network` tee isiku-ID-na.
- `collection` (valikuline): servad ainult nende tõenditega, mille teos kuulub sellesse
  kogusse või selle alamkogusse. Kogud tulevad `work_collections_index.json`-ist, mitte
  teoste indeksist (vt Read-model). `family` servad jäävad alles, sest neil ei ole teost.
- Vastus ei sõltu kutsujast (vt Ligipääs), nii et `server/cache.py` võib selle
  vahemällu panna võtmega `(person_id, collection)`. Kasutajapõhist vastust seal ei hoita
  (ADR 0042).

### Vastuse kuju

```jsonc
{
  "focus":   { "id": "vutt:Pu837uz", "label": "Johann Fischer", "birth_year": 1636, "death_year": 1705,
               "origin": { "place": "Lübeck", "place_id": "Q2843", "coordinates": { "lat": 53.87, "lon": 10.69 } } },
  "persons": [ { "id": "vutt:Pay7st5", "label": "Johann Leonhard Schwäger", "birth_year": null,
                 "death_year": null, "origin": null },
               { "id": "vutt:P5p7qhj", "label": "Theodoricus Hackspan", "birth_year": 1607,
                 "death_year": 1659, "origin": { "place": "Weimar", "place_id": "Q3955",
                 "coordinates": { "lat": 50.98, "lon": 11.33 } } } ],
  "works":   [ { "work_id": "jy30do", "title": "Legitimum Certamen …", "year": 1659,
                 "place": { "id": "Q435295", "label": "Altdorf bei Nürnberg", "coordinates": null },
                 "genres": ["disputatsioon"], "restricted": false } ],
  "edges":   [ { "kind": "dedicated", "from": "vutt:Pay7st5", "to": "vutt:Pu837uz", "directed": true,
                 "roles": { "vutt:Pay7st5": ["auctor"], "vutt:Pu837uz": ["subject"] },
                 "year": 1659,
                 "place": { "id": "Q435295", "kind": "print" },
                 "evidence": { "work_id": "jy30do", "pages": [] } },
               { "kind": "family", "from": "vutt:P5p7qhj", "to": "vutt:Pu837uz", "directed": false,
                 "records": [ { "source_id": "vutt:Pu837uz", "target_id": "vutt:P5p7qhj", "type": "õpetaja" },
                              { "source_id": "vutt:P5p7qhj", "target_id": "vutt:Pu837uz", "type": "õpilane" } ],
                 "year": null, "place": null, "evidence": null } ]
}
```

(Pereserv on illustratiivne. Fischeri kaardil struktureeritud seoseid tegelikult ei ole.)

**Invariandid** (kontrollitakse testides):
- iga serv puudutab fookust (`from` või `to` on `focus.id`);
- iga serva teine otspunkt leidub `persons`-is ja fookus ise ei ole `persons`-is;
- iga `evidence.work_id` leidub `works`-is.

**Pereseosed:**
- leitakse mõlemast suunast: fookuse kaardi `relations[]` ja teiste kaartide
  `relations[]`, mille `target_id` on fookus. See on praeguse
  `get_person_relation_network_ids` käitumine ja see säilib;
- tombstone-kaarte ei arvestata;
- sama isikupaari kirjed ühendatakse **üheks** servaks, aga algkirjed säilivad
  `records: [{source_id, target_id, type}]` kujul. Iga kirje ütleb, **kelle kaardil**
  seos on (`source_id`) ja kellele see osutab. „isa" ja „poeg" ei ole kaks alternatiivset
  silti, vaid sama seose kaks otsa, ning suund peab säilima. Serv ise on fookusest
  sõltumatu: `from`/`to` järjestatakse ID järgi, `directed: false`. **Kuvateksti
  valib klient** fookuse järgi. Eelistatud on kirje, mille `source_id` on fookus; muidu
  näidatakse teise kaardi kirjet koos allikaga („Hackspani kaardil: õpilane").
  Tüübita kirje (`reciprocal_auto`, 9 tootmises) jääb `records`-isse `type: null`-iga.
- Isikul, kellel on ainult pereserv, ei ole aastat ega teost. Ajatelg näitab teda
  „Aeg teadmata" veerus (vt Vaated).
- `edges[].place.kind` on täna alati `print`. #465 lisab `event`, #464 lisab `sent_from`.
  Vaated ei tohi eeldada, et `print` on kohtumiskoht.
- `edges[].evidence.part_id` lisandub #464-ga (teose osa). Täna seda välja ei ole.
- `edges` sisaldab ainult fookusega seotud servi. „Kaaslaste jooned" (kes esinevad
  omavahel samas teoses) arvutab klient `evidence.work_id` põhjal. Nii ei kasva vastus
  ruutkasvuga (Ludeni 159 isiku puhul oleks kaaslaste paare tuhandeid).

### Ligipääs

Järgib `POST /prosopography/work-titles` poliitikat: piiratud kogu teose **pealkiri ei
ole salajane**, see kuvatakse märkega `restricted: true` ja lingita. Teksti ega lehti
vastus ei sisalda, `pages` on ainult leheküljenumbrid. `restricted` = `not
is_work_public(meta)`, seega ei sõltu vastus kutsujast.

### Read-model

Vaja on iga teose kohta: pealkiri, aasta, trükikoht (id + silt), žanrid, kogud.
`works_creators_index.json` hoiab praegu ainult pealkirja, aastat ja loojaid ning ainult
teoseid, **millel on loojaid**. Märksõna- või trükkalipõhise teose kohta seal kirjet pole.

Otsus: laiendada `works_creators_index.json`-it **ainult teose enda faktidega**:
- kirje tehakse **igale** teosele, millel on `_metadata.json` (ka `creators: []`);
- uued väljad on `location` (`{id, label}`) ja `genres` (sildid).

**Kogusid ja `restricted`-lippu teoste indeksisse ei kopeerita.** Need loetakse
päringu ajal `work_collections_index.json`-ist (+ `collections.json` nähtavus). Seda
indeksit uuendab juba **tingimusteta** `update_work_collections` kõigil teedel: üksik-
ja hulgisalvestus (`metadata_ops.py`), import (`import_work.py`) ja kustutus
(`admin.py`). Koopia uude indeksisse jääks vanaks teedel, kus `call_ptw=False`
(kogude hulgimuudatus, `public.py` jagamine, `upload_ops` asendus).

**Uuendustee:** teose faktid (pealkiri, aasta, `location`, `genres`, loojad) kirjutab uus
`update_work_facts(meta)`. Seda kutsutakse **tingimusteta, samas kohas mis
`update_work_collections`**: `save_work_metadata`-s ja `bulk_update_works`-is
muutunud teose kohta, ning `import_work`-is. Praegu sõltub `update_works_creators_index`
`call_ptw`-st, seega pealkirja või koha muutus hulgiteel ei jõua indeksisse. See viga
kaob samas. Teose kustutamine (`admin.py`, `update_work_collections(work_id, [])`)
eemaldab kirje.

**Vana kirjutaja eemaldatakse.** `update_person_to_works` (`indices.py`) kutsub praegu
`update_works_creators_index(work_id, creators, title, year)`-i. See kirjutab kirje
tervikuna üle vana kujuga (`{title, year, creators}`) ja **eemaldab** loojateta teose
kirje (`index.pop`). Kui see kutse jääks alles, kustutaks taustatöö pärast iga
`call_ptw=True` salvestust `location`/`genres` väljad ja märksõna- või trükkalipõhise
teose kirje. Seepärast:
- kutse eemaldatakse `update_person_to_works`-ist; teose faktid kirjutab ainult
  `update_work_facts`;
- `update_works_creators_index` eemaldatakse koos re-eksportidega (`ops.py`,
  `state.py`, `_compat._SYNC_NAMES`, `server/__init__.py`, kui seal on) ja seda
  patchivad testid viiakse üle;
- test: tavaline `call_ptw=True` salvestus (sh taustatööna jooksev
  `update_person_to_works`) jätab kirjesse `location` ja `genres` alles, ning
  loojateta teose kirje ei kao.

Lehe mainimised (`update_page_person_mentions`) ei muuda teose fakte. Kuna kirje
tehakse igale teosele, on esimese mainimisega teose kirje juba olemas.

ADR 0007: `build_works_creators_index()` (rebuild) ja `update_work_facts()` kasutavad
sama kirje-ehitajat (`_work_facts_entry(meta)`), nii et need ei saa lahku minna.
Koordinaadid ei ole indeksis: need tulevad päringu ajal kohtade registrist
(`_get_place_coordinates`), sest kohtade parandus ei tohi vajada teoste indeksi
ümberehitust. `get_work_relations` jääb tööle: ta itereerib `creators`-it ja tühi
loend on talle no-op.

### Üks tõde võrgustiku kohta

`get_person_relation_network_ids` (`/persons?view=map&related_to=`) hakkab kasutama sama
ehitajat (`build_person_network`) ja võtab isikud kõigist servadest peale `printer`-i.
Praegu on need kaks eraldi arvutust (`relations.py` vs `work_relations_ops.py`).

Ühisest ehitajast üksi ei piisa. `get_person_map_markers` filtreerib praegu **pärast**
võrgustiku leidmist isikuid `_persons_in_collection` järgi: kas isikul on
**ükskõik milline** teos kogus. Uus endpoint filtreerib aga **ühiseid teoseid** ja
säilitab pereseosed. Need annavad eri tulemuse. Seepärast läheb PR 1-sse:

- kui `related_to` ja `collection` on mõlemad antud, kutsub `get_person_map_markers`
  `build_person_network(related_to, collection=collection)`-i ega rakenda
  `_persons_in_collection`-it enam. `collection` jõuab serverisse ainult siis, kui
  klient on piiranud (#460 `related_scope=collection`), seega #460 kliendiloogika jääb
  samaks;
- **fookus jääb suurele kaardile** nagu praegu: `get_person_relation_network_ids`
  tagastab fookuse + seotud isikud (miinus `printer`). Kaart näitab fookust tema
  päritolukohas, kui see on teada. Endpointi `persons` fookust ei sisalda, sest fookus on
  eraldi `focus` väljal. Piiratud režiimis (`collection` antud) jääb fookus kaardile
  ainult siis, kui ta ise kuulub kogusse (`_persons_in_collection`). Nii säilib #460
  tühja kaardi vihje „… kuulub teise kollektsiooni";
- testid kahes astmes, nii ilma koguta kui koguga ja alamkoguga:
  1. **ID-hulk enne koordinaadifiltrit:** `get_person_relation_network_ids(id,
     collection)` == `{focus} ∪ build_person_network(id, collection).persons` miinus
     `printer`-ainult isikud;
  2. **markerid:** `/map?related_to=…` markerite isikud == eelmise hulga see osa, kelle
     indeksikirjel on `origin_coordinates`; `without_coordinates` == ülejäänute arv.

Link „Ava suurel kaardil" kannab kaasa `related_to`, aktiivse kogu ja ulatuse
(`related_scope=collection`, kui isikulehel on „Ainult kogus" sees).

`GET /work-relations/{id}` jääb muutmata, sest MCP (`mcp/vutt_mcp/persons.py`)
kasutab seda. Pärast `WorkRelationsCard`-i asendamist on see ainult MCP tee.

## Vaated (isikulehel)

`WorkRelationsCard` asendub sektsiooniga **„Seosed"** ja vahekaartidega
**Võrgustik · Ajatelg · Kaart · Loend**. Sektsioon laaditakse laisalt (oma chunk; kaart
eraldi, sest MapLibre on raske). Uut sõltuvust ei tule: võrgustik ja ajatelg on käsitsi
SVG (radiaalne paigutus ja lineaarne skaala). d3 ei ole vaja.

Ühine kõigile vaadetele:
- **Filtririba:** nõrgad liigid `cotext` ja `mention` on vaikimisi sees ja tuhmid;
  `printer` on vaikimisi väljas. Kui aktiivne kogu on valitud, tuleb lisaks lüliti
  „Ainult kogus: …" (`collection` parameeter, nagu #460).
- **Esiletõst:** hõljutus isikul tõstab ta esile kõigis vaadetes.
- **Hüpikaken:**
  - hõljutus näitab lühivaadet, klikk kinnitab (sulgub nupuga, klikiga mujale või Esc);
  - kinnitatud hüpikaknas on „Ava isikuleht" ja iga teos lingina `/work/{id}/{lk}`,
    mainimise korral õigele lehele;
  - piiratud teos on ilma lingita, märkega „kaitstud";
  - rollid kuvatakse nimedega: `Perekonnanimi: roll · Fookus: roll`.
- **Legend:** kolm tugevat liiki värviga (valideeritud palett, 3 slotti, vt allpool),
  nõrgad hallid ja kujuga eristatud. Värv ei ole kunagi ainus tunnus.

**Võrgustik** (kes kellega):
- fookus keskel, rõngaga ja sildiga;
- seotud isikud ringil, rühmitatud isiku liigi järgi ja järjestatud esimese ühise teose
  aasta järgi;
- joone jämedus ja sõlme suurus = servade arv;
- „Kaaslaste jooned" on lülitatav;
- üle 40 isiku korral on nimed ainult suurima seosega isikutel, teised hõljutusel.

**Ajatelg** (millal ja mis rollis): üks rida iga seotud isiku kohta, märk iga
**teose** kohta aasta kohal (kuju ja värv = serva liik).
- **Aeg teadmata:** telje paremal pool on eraldi veerg. Sinna lähevad aastata teoste
  servad ja pereservad. Isik, kellel on ainult aastata servad, järjestatakse lõppu.
- **Sama isik, sama aasta, mitu teost:** üks liitmärk koos arvuga (näiteks „3"),
  värviga tugevaima liigi järgi. Klikk avab hüpikakna, kus on selle aasta kõik teosed.
  Märke kõrvuti ei nihutata, sest see moonutaks aastaskaalat.
- Pikk loend keritakse oma konteineris. See on lubatud erand „kerib aken" reeglist,
  nagu Workspace.

**Kaart** (kus), kolm kihti:
- **Päritolu (vaikimisi):** seotud isikud päritolukoha järgi. Ring koha kohta, täidis
  näitab liikide jaotust.
- **Päritolu ja trükikoht:** joon ühendab isiku päritolukoha tema `academic` serva
  teose trükikohaga. Joon on **kahe koha ühendus, mitte teekond**: andmed ei tõenda, et
  isik rändas, ega seda, et akt toimus trükikohas (`academic` hõlmab ka oratsioone).
  Kui #465 toob `event_place`-i, kasutab kiht seda ja kihi nimi ning kirjeldus
  muutuvad.
- **Trükikohad:** ühiste teoste trükikohad. Täis osa = `academic` teosed, õõnes =
  ülejäänud.

Kaardi all on loendur „X / Y seotud isikul on päritolu kaardil" ja päritoluta nimed.
Link „Ava suurel kaardil" viib `/persons?view=map&related_to=` vaatesse.

**Loend:** tabel (isik, eluaastad, päritolu, liik, ühiseid teoseid, aastad, rollid).
See on ühtlasi ligipääsetav tekstivaade diagrammidele.

## Palett

Kolm tugevat liiki on „all-pairs" vormid (punktid, jooned, kaart), seega on lubatud
maksimaalselt 3 kategoorilist tooni. Valideeritud (`validate_palette.js --pairs all`):

| Liik | Hele | Tume |
|---|---|---|
| academic | `#2a78d6` | `#3987e5` |
| dedicated | `#eb6834` | `#d95926` |
| family | `#1baf7a` | `#199e70` |

Heleda režiimi `#1baf7a` kontrast on 2,74:1 (< 3:1). Seepärast kannab `family` ka kuju
(romb) ja katkendjoont, ning Loend-vahekaart on tekstivaade. Nõrgad liigid kasutavad
neutraalset halli ja kuju (täpp / õõnes ring / kolmnurk).

## Väljaspool skoopi

- #464 teose osad ja adressaat; #465 toimumiskoht; #463 eluteekond.
- Struktureeritud seose tüüpide ühtlustamine (`vend` / `Br.` / `Bruder`, 9 tüübita
  kirjet). Kuvatakse toorelt; ühtlustus on eraldi töö.
- MCP-tööriist võrgustiku jaoks.
- `/persons` seoste kaardi uued kihid. See vaade saab ainult ühise isikute hulga.
- „Teos isikule" vs „teos isikust" eristus (Luden → Gustav II Adolf). Seda eristab
  žanr või #464 osa.

## Testimine

- **Reeglid (pytest):** tabel-test, iga reegli rida + viis kontrollnäidet ülal, sh
  järjekord (aui+gratulator vs auctor → `academic`, mitte `cotext`), `creator`,
  tundmatu roll (→ `cotext`, üks logikirje) ja vastassuunaline vaste (→ suunata).
- **Sümmeetria:** iga testandmestiku paari (A, B) serv on identne, olgu fookus A või B.
- **Invariandid:** iga serv puudutab fookust, otspunktid on `persons`-is, tõendid
  `works`-is. Pereseosed tulevad mõlemast suunast, üks serv paari kohta.
- **Ehitaja:** `build_person_network` puhaste sisendite peal (ptw, teoste indeks, isikute
  indeks, kaart). Kontrollitakse `family` servi, `collection` filtrit (alamkogud),
  `restricted` lippu ja `mentioned` lehti.
- **Read-model (ADR 0007):** `build_works_creators_index()` ja `update_work_facts()`
  annavad sama kirje; ka teos ilma loojateta (ainult märksõna või trükkal) saab kirje.
- **Uuendusteed (integratsioon):** pealkirja/koha muutus hulgiteel (`call_ptw=False`)
  jõuab teose faktidesse; kogude hulgimuudatus muudab `collection`-filtri ja
  `restricted`-lipu tulemust ilma rebuildita; teose kustutamine eemaldab kirje.
- **Endpoint:** sync route (`test_async_endpoint_offload` muster), 404 tundmatu isiku
  korral, vastuse kuju.
- **Üks tõde:** kaheastmeline võrdlus (ID-hulk enne koordinaadifiltrit, siis markerid),
  fookus kaasa arvatud, ilma koguta ning kogu ja alamkoguga (vt „Üks tõde võrgustiku
  kohta").
- **Pereseoste suund:** vastastikused kirjed „isa"/„poeg" jäävad ühe serva `records`-isse
  mõlema `source_id`-ga; serv on sama, olgu fookus kumb tahes.
- **Vana kirjutaja:** `call_ptw=True` salvestus ei kustuta `location`/`genres` välju ega
  loojateta teose kirjet.
- **Frontend (vitest):** puhtad utiliidid (radiaalne paigutus, isikute järjestus, kaaslaste
  servad `evidence`-ist), filtreerimise järjekord (peidetud tugevaim serv → värv
  järgmisest; unikaalsed teosed, mitte servad), ajatelje „Aeg teadmata" ja liitmärk,
  i18n mõlemas keeles.

## Tükeldus PR-ideks

1. **Backend:** read-modeli laiendus (`update_work_facts` tingimusteta uuendusteedel) +
   `build_person_network` + endpoint + reeglite testid + `get_person_relation_network_ids`
   ja `get_person_map_markers` (`related_to` + `collection`) ümber ehitajale.
2. **Frontend 1:** „Seosed" sektsioon: Võrgustik, Ajatelg, Loend, filtrid, hüpikaken;
   `WorkRelationsCard` eemaldatakse isikulehelt.
3. **Frontend 2:** Kaart-vahekaart kolme kihiga.

Pärast PR 1 deploy'd tuleb käivitada `rebuild_indices` (serveri start teeb seda niikuinii),
et laiendatud read-model tekiks.
