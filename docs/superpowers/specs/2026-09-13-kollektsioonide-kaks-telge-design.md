# Kollektsioonide kaks telge: struktuurne kodu ja temaatiline kogu

**Kuupäev:** 2026-09-13 (rev 2, arvustuse järel)
**Seotud:** #319 (valiku-modaal ja haldus), ADR 0031 (kirjutamisõigus), ADR 0007 (read-modelid),
ADR 0013 (Meili sünk teose kaupa), ADR 0040 (jälgitav fail on autoriteetne)
**Staatus: ASENDATUD** (2026-09-13) → `2026-09-13-tookollektsioonid-design.md`.
Mehhanismiks valiti eraldi töökollektsioon (indekseerimata liikmesus), mitte olemasoleva
kollektsiooni laiendamine. Selle dokumendi mõõtmised ja leiud kehtivad edasi; struktuuripuu
korrastamine (Keiserliku ülikooli juur, „Määramata", 69 kodutut teost) jääb eraldi tööks #319 all.
Kandev põhjus asendamiseks: tenant-tokeni filter (`meilisearch_ops.py:586`) kasutab
`collections_hierarchy`-t lugemisõiguse andmiseks, seega ei ole see väli „ainult otsing"
ja O8 liitmine oleks jätnud õigusteteljele augu.

## Probleem

Kasutajad tahavad koguda teoseid töö ümber: Fischeri konverents, Klingeriana, doktoritöö
materjal. Osa on juba olemas (`pedagoogilis-filoloogilineseminar` on doktoritöö kogu), osa
saabub. Tahame, et neid saaks juurde tulla ilma et neid saaks *ise* tekitada.

„Lubame lihtsalt rohkem kollektsioone" ei tööta, sest `collections` ei ole silt, vaid kolme
süsteemi ühine võti:

1. **Nähtavus** — `meili_doc.py:493`: `is_public = any(kogu on avalik)`; uus kogu sünnib ilma
   `visibility` väljata ehk avalikuna. Klient kordab sama loogikat
   (`WorkCard.tsx:104` `isRestrictedWork`, `HistoryTab.tsx:375`).
2. **Kirjutamisulatus** — `can_write_work` (`access_ops.py`) nõuab contributor'ilt
   `edit_collections ∩ work.collections`.
3. **Nimeruum** — kogu-ID on globaalne: valiku-modaal, fassetid, statistika, MCP, URL-param.

## Mõõdetud lähteolukord (tootmine, 2026-09-13)

1396 teost, 8 kogu.

| Kogu | Teoseid | Ilma teise koguta | Ajavahemik |
|---|---|---|---|
| `academia-gustaviana` | 804 | — | 1632–1665 |
| `academia-gustavo-carolina` | 455 | — | 1690–1710 |
| `vennastekoguduse-materjalid` | 52 | — | (piiratud) |
| `matusetrykised` | 30 | **20** | 1591–1817, neli perioodi |
| `pedagoogilis-filoloogilineseminar` | 25 | **25** | 1821–1836 |
| `klingeriana` | 22 | **22** | 1803–1831 |
| `acad-sekundaar` | 2 | **2** | 1932, 1984 |
| `universitas-dorpatensis-1` (virtuaalgrupp) | 1 otse | 1 | 1698 |
| *(kollektsioonita)* | 15 | — | 1516–1999 |

Kaks leidu, mis kujundasid disaini:

- **Kolmel contributoril on `edit_collections` = `klingeriana` / `pedagoogilis-filoloogilineseminar`.**
  Liikmesuse viimine teose metaandmetest välja võtaks neilt kirjutusõiguse vaikselt ja
  pöördumatult — ulatust ei saaks enam millegi külge riputada.
- **Struktuuritelg katab ainult Rootsi aega.** 137 teost ripuvad juurtasandil, sest hilisemal
  materjalil ei ole kuhugi minna. #319 kaebus „juurtasandi loend on semantiliselt segu" on
  selle sümptom.

## Otsused

### O1 — Kollektsioonil on liik

`collections.json`-i `type`: `"structural"` (vaikimisi, kui väli puudub) | `"thematic"` |
`"virtual_group"` (olemas). TS-tüüp `collectionService.ts:20` laieneb samamoodi.

Piir on **funktsioon**, mitte suurus ega teema:

- **Struktuurne** — teose kodu korpuses. Määrab `is_public`-u ja kirjutamisulatuse.
- **Temaatiline** — ristuv väide sisu kohta. Ei määra kumbagi.

### O2 — Temaatiline liikmesus ei jõua kunagi õiguste arvutusse

Invariant on ehituslik, sest temaatiline liikmesus ei puutu kordagi neid andmeid, mille peal
õigused arvutatakse. Kolm Meili välja, igal üks tähendus:

| Väli | Sisu | Tarbija |
|---|---|---|
| `collections` | **ainult struktuurne** (= `_metadata.json`) | `is_public`, `WorkCard.isRestrictedWork`, `HistoryTab`, `WorkInfoPanel`, `MetadataModal` |
| `collections_thematic` | **uus**, ainult temaatiline | kuvamine (kiibid) |
| `collections_hierarchy` | struktuurne (koos esivanematega) **+ temaatiline** | AINULT otsing, filter, fassetid |

Mõõdetud: kollektsioonifilter kasutab kõikjal eranditult `collections_hierarchy`-t
(`searchService.ts` 6 kohta, `Statistics.tsx` 2), ja ükski facet ei käi `collections` peal.
Seega ei ole vaja `collections` välja puutuda — ja kuna `is_public` ning kliendipoolne
piirangukontroll loevad just seda, on nähtavus kaitstud struktuurselt, mitte reegliga.

Temaatilisel kogul ei ole `visibility` ega `allowed_users` välja; haldus neid ei paku.

### O3 — Liikmesus elab seal, kus väide sünnib

| Liik | Asukoht | Git | Kirjutaja |
|---|---|---|---|
| Struktuurne | `_metadata.json` → `collections[]` | teose kausta commit | `save_work_metadata` |
| Temaatiline | `data/config/collection_members/{id}.json` | `data/` config-commit | `save_config_with_git` (ADR 0040) |

„See teos kuulub Fischerianasse" on kogu kuraatori väide, mitte teose oma. Õigus on õige
suurusega (kogu-õigus, mitte 803 teose kirjutusõigus), teose git-ajalugu ei täitu siltidega ja
kogu kustutamine on üks fail, mitte skann üle 1396 teose.

### O4 — Lahusus jõustatakse KÕIGIS kirjutusteedes

Neli valvurit, mitte üks:

1. **Lisamine** (`POST /collections/{id}/works`): kogu peab olema temaatiline, kutsuja peab
   teost nägema (`can_read_work`), teosel peab olema vähemalt üks struktuurne kogu.
2. **Teose metaandmete salvestamine** (`save_work_metadata`): `collections[]` **tõrjub tagasi**
   temaatilise ja `virtual_group` ID-d (400, nimeliselt). Ilma selleta saaks temaatilise kogu
   metaandmete kaudu õiguste teljele tagasi tuua.
3. **Viimase struktuurse kodu eemaldamine**: kui teosel on temaatiline liikmesus, tagastab
   salvestus 409 ja nimetab kogud. Vaikset ümbertõstmist `maaramata`-sse EI tehta — kodu
   valimine on kuraatori otsus.
4. **Struktuurse kogu kustutamine**: teosed, kes jääksid ilma koduta, liiguvad `maaramata`-sse
   (kustutamine on juba täna teoseid puudutav toiming ja kinnitatakse eraldi).

Frontend: `getWritableCollectionOptions` (`collectionService.ts:242`) välistab täna ainult
`virtual_group`-i — **peab välistama ka `thematic`-u**, muidu pakub UI temaatilist kogu
kirjutamisulatuseks, mida `can_write_work` kunagi ei rahulda.

Täpsustus: kollektsioonita teose nähtavus ei ole täna „määratlemata" — ta on **avalik**
(`is_public` vaikeväärtus) ja contributor'ile **mittekirjutatav** (fail-closed). O4 ei paranda
viga, vaid hoiab ära uue: temaatilise liikmesuse, mille all ei ole struktuurset alust.

### O5 — Kasv on kontrollitud kolme väljaga, mitte lubadusega

- **Loomine ja kustutamine jääb superadminile.** Kogusid ei teki ise, nad tellitakse.
- **`curators: [kasutajanimi]`** — kuraator täidab ja tühjendab oma temaatilist kogu. Ei saa
  luua uut kogu, ei puuduta teiste omi, ei muuda teoste teksti. „Lisan kogusse" ja „toimetan
  teost" on kaks eri õigust.
- **`status: "active" | "archived"`** — lõppenud konverentsi kogu kaob valikust, aga link
  `?collection=fischeriana` ja andmed jäävad. Ajutisus lahendatakse arhiveerimisega, mitte
  kustutamisega.

### O6 — Struktuuritelje juured

| Juur | Sisu | Seis |
|---|---|---|
| `universitas-dorpatensis-1` (virtuaalgrupp) | AG + AGC + `ulikooli-allikad` | olemas |
| `keiserlik-ulikool` „Keiserlik ülikool (1802–1918)" | `klingeriana`, `pedagoogilis-filoloogilineseminar` | **uus** |
| `vennastekoguduse-materjalid` | 52, piiratud | olemas |
| `maaramata` „Määramata" | ajutine hoiukoht, `visibility: "public"` (selgesõnaline) | **uus** |

**Klingeriana ja PFS jäävad struktuurseks.** Põhiargument on ühilduvus, mitte aastaarv: neil on
päris kasutajad päris kirjutusulatusega (kolm contributorit), ja temaatiliseks muutmine võtaks
selle ära ilma asenduseta. Aastavahemikud (1803–1831, 1821–1836) toetavad `parent`-i valikut,
aga ei tõesta päritolu iseenesest.

`maaramata` on **hoiukoht, mitte vaikeväärtus**: halduses nähtav arv, mis kihutab tagant.
Impordi tee teda automaatselt ei määra — teos jääb kodu valimiseni kollektsioonita, nagu täna.
Nähtavus on selgesõnaliselt `public`, sest kõik praegused kodutud teosed on juba avalikud;
piiratud materjal ei tohi kunagi `maaramata` kaudu korpusesse tulla.

### O7 — Sorteerimine ja loendamine on andmeleping

#319 modaal rühmitab ja järjestab nende väljade järgi, hierarhiat ise tõlgendamata:

1. **Rühm** = `type`. Struktuurne (puuvaade, hierarhiaga) enne temaatilist (lame loend).
   `virtual_group` on struktuurse puu sõlm, mitte oma rühm.
2. **Järjekord** = `order` kasvavalt sama vanema laste hulgas; `order`-ita kogud järjestatute
   järel, praeguse keele nime järgi tähestikuliselt. Deterministlik ka siis, kui `order`
   puudub (täna on ta 3 kogul 8-st). `order` tuleb PUT-iga hallatavaks.
3. **`status: archived`** ei kuvata valikus; URL-iga ligipääs töötab; halduses oma filter.
4. **Arv = unikaalseid TEOSEID**, mitte lehekülgi. Indeksis on üks dokument lehekülje kohta ja
   `facetDistribution` ei arvesta `distinct`-iga (`searchService.ts:541`). Loendus käib
   olemasolevat teed pidi — `fetchWorkLevelFacets`, mis piirab dokumendihulga iga teose
   esimese leheküljega (`lehekylje_number = 1`; eeldus kontrollitud 1264/1264) — facet-väljaks
   `collections_hierarchy`, filtriahel sama, millega kasutaja ise otsib (#319 invariant: muidu
   lekib piiratud kogu suurus). Teos ilma leheküljeta 1 jääb loendurist välja; see on
   olemasolev, dokumenteeritud puudujääk, mitte selle töö oma.

### O8 — Liitmine toimub indekseerimisel, ainult ühte välja

`meili_doc.build_work_documents` saab kaardi `{work_id: [temaatilised kogud]}` **eraldi
argumendina** ja kasutab teda AINULT `collections_thematic` ja `collections_hierarchy`
täitmiseks. `is_public` ja `collections` arvutatakse muutumatult struktuursest sisendist.
`meili_doc` jääb side-effect-vabaks: faili ta ise ei loe.

Mõlemad indekseerimisteed (`meilisearch_ops.py`, `scripts/1-1_consolidate_data.py`) peavad
kaardi kaasa andma (CLAUDE.md invariant). `collections_thematic` lisandub
`attributesToRetrieve` loenditesse seal, kus kiipe kuvatakse (`meiliService.ts`,
`workService.ts`). Filtreeritavaks teda EI tehta — filter käib `collections_hierarchy` kaudu,
üks tee.

`work_collections_index.json` (read-model, `/persons` filter) võtab temaatilise liikmesuse
kaasa: `rebuild_indices()` loeb liikmefailid, `prosopography/indices.py` üksikuuendus samuti.

Teadaolev kõrvalmõju: `Workspace.tsx:475` valib „otsi selle teose kogus" jaoks
`collections_hierarchy[0]` — pärast liitmist võib see olla temaatiline kogu. Eelistus tuleb
seada struktuursele (`collections[0]`, hierarhia varuvariandina).

### O9 — Virtuaalgrupp ei kanna teoseid; struktuur on KODU, mitte päritolutõend

`universitas-dorpatensis-1` kannab täna 1 teost otse (1698. a kirjad ülikoolile). See on kaks
korda vale: virtuaalgrupi mõte on „endal teoseid ei ole", ja `collectionService.ts:242` jätab
virtuaalgrupid kirjutusulatuse valikust välja — nende teoste jaoks ei saaks ulatust kunagi anda.

Lahendus: uus struktuurne laps `ulikooli-allikad` „Ülikooli arhivaalid ja allikapublikatsioonid"
`universitas-dorpatensis-1` all. Sinna lähevad 1698. a kirjad ja `acad-sekundaar`-i kaks teost
(1932, 1984).

**Määratluse täpsustus (arvustuse leid):** struktuurne telg tähendab **teose kodu korpuses** —
administratiivset paigutust, mille kuju on enamasti päritolu, aga mitte tingimata. Kui telg
tähendaks rangelt trükise päritolu, oleks 1932. ja 1984. a väljaande paigutamine Rootsi aja
ülikooli alampuusse vastuolu. „Kodu" määratlus lubab selle ja on kooskõlas sellega, kuidas
telg juba töötab (`vennastekoguduse-materjalid` on materjalikorpus, mitte trükikoda).
Teosele jääb seejuures ka temaatiline väide `acad-sekundaar` („on sekundaarkirjandus /
allikapublikatsioon"), mis on eri telg ja eri väide.

### O10 — `type` ja `parent` muutmine on migratsioonileping, mitte tavaline PUT

- **`type` vahetus on lubatud ainult tühjal, lasteta kogul.** Struktuurne → temaatiline muudab
  liikmesuse asukohta, nähtavust ja kasutajate õigusi korraga; seda ei tohi teha ühe PUT-iga.
  Olemasolevad üleminekud teeb migratsiooniskript (O11), mis liigutab liikmesuse, kontrollib
  `is_public` muutumatust ja resünkib.
- **`parent` valideerib tsükleid** (uus vanem ei tohi olla enda järeltulija) ja **keelab
  temaatilise vanema** (temaatiline kogu on lame, tal ei ole `parent`-it ega lapsi).
- **Alampuu resünk vajab järeltulijate läbimist.** `_find_works_with_collection` leiab ainult
  otseliikmed; `parent`-i muutmisel tuleb koguda ID-d rekursiivselt (`_collect_descendants`) ja
  resünkida iga järeltulija teosed, sest `collections_hierarchy` on tuletatud väli.

### O11 — Samaaegsus, taastumine ja kustutamine

- **Liikmefaili kirjutus on lukustatud loe-muuda-salvesta.** Uus `collection_members_lock`
  (`threading.RLock`, sama muster nagu `metadata_lock`) + kliendilt kaasa tulev `updated_at`;
  kui fail on vahepeal muutunud, 409 ja klient loeb uuesti. Ilma selleta kirjutavad kaks
  kuraatorit teineteise muudatuse üle. **Piirang:** lukk on protsessi-lokaalne — mitme
  workeriga gunicorni juures vajab protsessideülest lukku (sama hoiatus nagu
  `RENDER_SEMAPHORE`).
- **Osaline ebaõnnestumine.** Liikmefail on autoriteetne, indeksid tuletatud (ADR 0007):
  kirjutus õnnestub → resünk puudutatud teostele ADR 0013 dirty-lipu teed pidi; kui resünk
  kukub, jääb lipp püsti ja täisreindeks (`server_seed_data.sh`) taastab seisu failist.
  Vastupidist suunda ei ole: indeksist liikmefaili ei ehitata.
- **Kogu kustutamine** eemaldab liikmefaili, resünkib kõik endised liikmed (muidu jääb
  `collections_hierarchy`-sse kummitus-ID) ja uuendab `work_collections_index.json`-i.
  Sama tee käib `status: archived` puhul **läbi ainult siis**, kui arhiveerimine muudab
  otsitavust — esimeses versioonis ei muuda: arhiveeritud kogu jääb indeksisse, kaob ainult
  valiku-modaalist.
- **Tundmatu `work_id`** liikmefailis (kustutatud teos) filtreeritakse lugemisel vaikselt
  välja; kogu ei tohi katkise viite pärast tühjaks minna ega vigastada indekseerimist.

### O12 — Migratsioon kahes laines

**Laine 1 (selle töö osa), skriptiga, kuivkäivitus vaikimisi, jooksutatakse KONTEINERIST:**

| Samm | Teoseid | Mõju |
|---|---|---|
| Uus juur `keiserlik-ulikool` | — | — |
| `klingeriana`, `pedagoogilis-filoloogilineseminar` → `parent: keiserlik-ulikool` | 47 | alampuu resünk; **liikmesus ja ulatus ei muutu** |
| Uus juur `maaramata` (`visibility: public`) | — | — |
| Uus laps `ulikooli-allikad` | 3 | 1698 + 2 sekundaari teost saavad struktuurse kodu |
| `acad-sekundaar` → temaatiline, liikmed faili | 2 | `is_public` muutumatu (kontrollitakse enne/pärast) |
| 20 kodutut matusetrükist → struktuurne kodu | 20 | vaikimisi `maaramata`; trükikoja järgi AG/AGC või Keiserlik, kui kuraator määrab — aastaarv üksi ei ütle trükikoda |
| `matusetrykised` → temaatiline, liikmed faili | 30 | alles pärast eelmist sammu (O4 valvur) |
| 15 kollektsioonita teost → `maaramata` või päris kodu | 15 | muudab nad ulatatavaks; `is_public` ei muutu (olid avalikud) |

Skript logib enne ja pärast: iga puudutatud teose `is_public`, ja kolme contributori
kirjutusõiguse **nimelise** loendi. Erinevus = katkesta.

**Laine 2 (eraldi):** Fischeriana kui esimene sündinud-temaatiline kogu. Koodimuudatust ei vaja.

**Ei migreeru:** `vennastekoguduse-materjalid` (määrab nähtavust), AG, AGC.

## Andmemudel

```jsonc
// data/config/collections.json
{
  "name": { "et": "Matusetrükised", "en": "Funeral prints" },
  "type": "thematic",              // structural (vaikimisi) | thematic | virtual_group
  "status": "active",              // active (vaikimisi) | archived
  "order": 10,
  "color": "amber",
  "curators": ["kasutajanimi"],    // ainult temaatilisel
  "description": { "et": "…", "en": "…" }
  // temaatilisel EI OLE: visibility, allowed_users, parent, children
}
```

```jsonc
// data/config/collection_members/matusetrykised.json
{
  "collection": "matusetrykised",
  "works": ["v7Kq2mXp", "agu8di"],   // work_id, mitte slug
  "updated_at": "2026-09-13T10:00:00Z",
  "updated_by": "kasutajanimi"
}
```

Fail on **autoriteetne, mitte tuletatud** → `save_config_with_git` (ADR 0040).

## API

| Endpoint | Roll | Valvurid |
|---|---|---|
| `POST /collections/{id}/works` | kuraator või admin | O4.1; `updated_at` (O11) |
| `DELETE /collections/{id}/works` | kuraator või admin | sama |
| `PUT /admin/collections/{id}` | superadmin | laieneb: `name`, `parent`, `order`, `type`, `curators`, `status`; `type` ainult tühjal lasteta kogul (O10); `parent` tsüklikontroll |
| `GET /admin/collections/{collection_id}/works-count` | admin | arvestab temaatilist liikmesust |

## Väravad

- **i18n** — uued võtmed mõlemasse keelde korraga (ADR 0011).
- `npm run typecheck`, `npm test`, `.venv/bin/pytest tests/`.
- **Valvurtestid:**
  (a) temaatiline kogu ei muuda `is_public`-ut ega `collections` välja;
  (b) temaatiline liikmesus ei anna `can_write_work`-i;
  (c) `save_work_metadata` tõrjub temaatilise/virtuaalse ID `collections`-ist;
  (d) viimase struktuurse kodu eemaldamine temaatilise liikmesuse juures = 409;
  (e) lisamine ilma struktuurse koduta = 400;
  (f) mõlemad indekseerimisteed annavad sama `collections_hierarchy` (contract-test);
  (g) sorteerimine on deterministlik `order`-ita kogude korral;
  (h) `parent`-i tsükkel = 400; alampuu resünk puudutab järeltulijaid;
  (i) paralleelne liikmefaili kirjutus ei kaota muudatust (`updated_at` 409);
  (j) `getWritableCollectionOptions` ei paku temaatilist kogu.
- Dashboardi esmalaadimise aeg enne/pärast (#319 nõue).

## Skoobist väljas

- Isiklikud ajutised nimekirjad (üks kasutaja, jagamata) — eraldi mõiste, eraldi issue.
- Avalik sirvimisleht `/collections`; kogu-ID muutmine.
- #319 valiku-modaali sisu (arvud, kirjeldused, otsinguväli, klaviatuur) — see spekk annab
  `type`, `order`, `status` ja loendusühiku lepingu, modaal ise jääb #319-sse.

## Riskid

- **Kaks liikmesuse allikat.** Projekt on selle mustri käes varem kannatanud
  (`person_to_works`, `person_aliases`). Erinevus: võtmeruumid on lahus, liitmine ühesuunaline
  tuletatud väljadesse (O8), ja õiguste pool ei näe temaatilist poolt üldse (O2).
- **Migratsioon puudutab kirjutusõigust.** Kolme contributori ulatus logitakse nimeliselt enne
  ja pärast; erinevus katkestab skripti.
- **„Määramata" muutub prügikastiks.** Vastumeede: halduses nähtav arv, mitte vaikevalik, ja
  import teda ei määra.
