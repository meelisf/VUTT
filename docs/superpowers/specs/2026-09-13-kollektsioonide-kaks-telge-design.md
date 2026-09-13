# Kollektsioonide kaks telge: struktuurne päritolu ja temaatiline kogu

**Kuupäev:** 2026-09-13
**Seotud:** #319 (valiku-modaal ja haldus), ADR 0031 (kirjutamisõigus), ADR 0007 (read-modelid),
ADR 0040 (jälgitav fail on autoriteetne)
**Staatus:** disain kinnitatud, ADR 0042 kirjutatakse teostusel

## Probleem

Kasutajad tahavad koguda teoseid töö ümber: Fischeri konverents, Klingeriana, doktoritöö
materjal. Osa neist on juba olemas (`pedagoogilis-filoloogilineseminar` on doktoritöö kogu),
osa saabub. Tahame, et neid saaks juurde tulla ilma et neid saaks *ise* tekitada.

„Lubame lihtsalt rohkem kollektsioone" ei tööta, sest `collections` ei ole VUTT-is silt, vaid
kolme süsteemi ühine võti:

1. **Nähtavus** — `meili_doc.py:493`: `is_public = any(kogu on avalik)`. Uus kogu sünnib ilma
   `visibility` väljata ehk avalikuna (`admin_create_collection`). Piiratud teose lisamine
   uude kogusse teeks ta avalikuks.
2. **Kirjutamisulatus** — `can_write_work` (`access_ops.py`) nõuab contributor'ilt
   `edit_collections ∩ work.collections`. Kommentaar failis ütleb otse: *„Kollektsioonita teos
   ei ole contributor'ile kirjutatav (fail-closed)."*
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

`collections.json`-i `type` väli laieneb: `"structural"` (vaikimisi, kui puudub) |
`"thematic"` | `"virtual_group"` (olemas). TS-tüüp `collectionService.ts:20` laieneb samamoodi.

Piir ei ole suurus ega teema, vaid **funktsioon**:

- **Struktuurne** — ütleb, kust materjal pärineb. Määrab `is_public`-u ja kirjutamisulatuse.
- **Temaatiline** — ütleb, mida materjal puudutab. Ei määra kumbagi.

### O2 — Temaatiline kogu ei määra nähtavust ega ulatust

Invariant, mis on ehituslik, mitte meeldejäetav: `access_ops` ja `is_public` loevad **ainult**
`_metadata.json`-i `collections` välja, kuhu temaatiline liikmesus ei jõua (O3). Seega:

- Temaatilisse kogusse lisamine ei saa teha piiratud teost avalikuks.
- Kuraator ei saa teost oma kogusse tõmmates laiendada kolmanda inimese kirjutusõigust.

Temaatilisel kogul ei ole `visibility` ega `allowed_users` välja; haldus neid ei paku.

### O3 — Liikmesus elab seal, kus väide sünnib

| Liik | Asukoht | Git | Kirjutaja |
|---|---|---|---|
| Struktuurne | `_metadata.json` → `collections[]` | teose kausta commit | `save_work_metadata` |
| Temaatiline | `data/config/collection_members/{id}.json` | `data/` config-commit | `save_config_with_git` (ADR 0040) |

„See teos kuulub Fischerianasse" on kogu kuraatori väide, mitte teose oma. Kolm tagajärge:
õigus on õige suurusega (kogu-õigus, mitte 803 teose kirjutusõigus), teose git-ajalugu ei
täitu siltidega, ja kogu kustutamine on üks fail, mitte skann üle 1396 teose.

### O4 — Temaatilise kogu liikmel peab olema struktuurne kodu

Valvur API-s ja test. Ilma selleta jääksid `is_public` ja ulatus määratlemata (69 teost 79-st
oleks täna täpselt selles seisus). „Määramata" juur (O6) teeb nõude **alati täidetavaks** —
uus materjal ei jää kunagi ukse taha sellepärast, et tema päris kodu on veel otsustamata.

### O5 — Kasv on kontrollitud kolme väljaga, mitte lubadusega

- **Loomine ja kustutamine jääb superadminile.** Kogusid ei teki ise, nad tellitakse.
- **`curators: [kasutajanimi]`** — kuraator täidab ja tühjendab oma temaatilist kogu. Ta ei saa
  luua uut kogu, ei puuduta teiste omi ega saa teoste teksti muuta. „Lisan kogusse" ja
  „toimetan teost" on kaks eri õigust.
- **`status: "active" | "archived"`** — lõppenud konverentsi kogu kaob valiku-modaalist, aga
  link `?collection=fischeriana` ja andmed jäävad. Ajutisus lahendatakse arhiveerimisega,
  mitte kustutamisega; see on ainus aus vastus kogule, millele on viidatud artiklis.

### O6 — Struktuuritelje juured

| Juur | Sisu | Seis |
|---|---|---|
| `universitas-dorpatensis-1` (virtuaalgrupp) | AG + AGC + O9 laps | olemas |
| `keiserlik-ulikool` „Keiserlik ülikool (1802–1918)" | Klingeriana, PFS | **uus** |
| `vennastekoguduse-materjalid` | 52, piiratud | olemas, jääb juureks |
| `maaramata` „Määramata" | ajutine hoiukoht | **uus** |

**Klingeriana ja PFS ei ole temaatilised kogud** — nad on päritolu- ja institutsioonikogud,
käituvad nagu AG (ainult väiksemalt) ja neil on päris kasutajad päris kirjutusulatusega.
Mõlemad jäävad struktuurseks ja saavad `parent: keiserlik-ulikool`. Mõõtmine toetab:
Klingeriana on tervikuna 1803–1831, PFS 1821–1836.

„Määramata" on **hoiukoht, mitte lõplik kodu**: halduses näitab arvu ja kihutab tagant; kui
materjali koguneb (nt 1711–1801 või Liivimaa kirikutrükised), tehakse uus juur ja teosed
liiguvad sinna. Vaikeväärtusena pakkumine on lubatud ainult impordil, kus kodu ei ole teada.

### O7 — Sorteerimine ja kuvamine on andmeleping, mitte heuristika

#319 modaal rühmitab ja järjestab **nende väljade järgi**, ilma hierarhiat tõlgendamata:

1. **Rühm** = `type`. Struktuurne (puuvaates, hierarhiaga) enne temaatilist (lame loend).
   `virtual_group` on struktuurse puu sõlm, mitte oma rühm.
2. **Järjekord rühma sees** = `order` kasvavalt, sama vanema laste hulgas. `order`-ita kogud
   tulevad järjestatute järel, praeguse keele nime järgi tähestikuliselt. Deterministlik, ilma
   „vaikimisi sorteerib nagu juhtub" olekuta.
3. **`status: archived`** ei kuvata valikus; URL-iga ligipääs töötab; halduses on oma filter.
4. **Arvud** tulevad Meili fassetist sama filtriahelaga, millega kasutaja ise otsib (#319
   invariant). Temaatilised kogud loevad kaasa **ilma eraldi loendusteeta**, sest liitmine
   toimub indekseerimisel (O8), mitte vaates.

`order` tuleb hallatavaks (praegu on väli olemas, aga PUT seda vastu ei võta ja UI ei kasuta).

### O8 — Liitmine toimub indekseerimisel

`meili_doc.build_work_documents` saab kaardi `{work_id: [temaatilised kogud]}` argumendina ja
liidab ta `collections` + `collections_hierarchy` väljadesse. Mõlemad indekseerimisteed
(`meilisearch_ops.py` ja `scripts/1-1_consolidate_data.py`) peavad kaardi kaasa andma —
CLAUDE.md invariant. `meili_doc` jääb side-effect-vabaks: faili ta ise ei loe.

Tagajärg: otsing, fassetid, `?collection=`, statistika, MCP, `WorkCard` ei muutu üldse.

`work_collections_index.json` (read-model, `/persons` filter) peab temaatilise liikmesuse
kaasa võtma — `rebuild_indices()` loeb liikmefailid, `prosopography/indices.py` üksikuuendus
samuti.

### O9 — Virtuaalgrupp ei kanna teoseid

`universitas-dorpatensis-1` kannab täna 1 teost otse (1698. a kirjad ülikoolile) ja sinna
lisanduks `acad-sekundaar`-i 2 teost. See on kaks korda vale: virtuaalgrupi mõte on „endal
teoseid ei ole", ja `collectionService.ts:246` jätab virtuaalgrupid **kirjutusulatuse
valikust välja** — nende teoste jaoks ei saaks ulatust kunagi anda.

Lahendus: uus struktuurne laps `universitas-dorpatensis-1` all — `ulikooli-allikad`
„Ülikooli arhivaalid ja allikapublikatsioonid". Sinna lähevad 1698. a kirjad ning
`acad-sekundaar`-i kaks teost (1932, 1984). Nende sisuline seos Rootsi aja ülikooliga on
seejuures **temaatiline** väide, mida kannab `acad-sekundaar` (O10) — struktuurselt on nad
20. sajandi väljaanded.

### O10 — Migratsioon kahes laines

**Laine 1 (selle töö osa):**

| Samm | Teoseid | Mõju |
|---|---|---|
| Uus juur `keiserlik-ulikool` | — | — |
| `klingeriana`, `pedagoogilis-filoloogilineseminar` → `parent: keiserlik-ulikool` | 47 | alampuu Meili resünk; **liikmesus ja ulatus ei muutu** |
| Uus juur `maaramata` | — | — |
| Uus laps `ulikooli-allikad` | 3 | 1698 + 2 sekundaari teost saavad struktuurse kodu |
| `acad-sekundaar` → `type: thematic`, liikmed faili | 2 | nähtavus muutumatu (mõlemad avalikud) |
| `matusetrykised` → `type: thematic`, liikmed faili | 30 | 10-l on kodu (AG 7, AGC 3); **20 vajavad kodu enne** |
| 20 kodutut matusetrükist → periood või `maaramata` | 20 | vaikimisi `maaramata`; trükikoja järgi AG/AGC või Keiserlik, kui kuraator selle määrab — aastaarv üksi ei ütle trükikoda |
| 15 kollektsioonita teost → struktuurne kodu või `maaramata` | 15 | muudab nad contributor'ile ulatatavaks; `is_public` ei muutu |

**Laine 2 (eraldi, pärast):** Fischeriana kui esimene sündinud-temaatiline kogu. Koodimuudatust
ei vaja — ainult superadmini loomistoiming + kuraator.

**Ei migreeru:** `vennastekoguduse-materjalid` (määrab nähtavust), AG, AGC.

## Andmemudel

```jsonc
// data/config/collections.json — kogu kirje
{
  "name": { "et": "Matusetrükised", "en": "Funeral prints" },
  "type": "thematic",              // structural (vaikimisi) | thematic | virtual_group
  "status": "active",              // active (vaikimisi) | archived
  "order": 10,
  "color": "amber",
  "curators": ["kasutajanimi"],    // ainult temaatilisel
  "description": { "et": "…", "en": "…" }
  // temaatilisel EI OLE: visibility, allowed_users, parent
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

Fail on **autoriteetne, mitte tuletatud** → `save_config_with_git` (ADR 0040), mitte
`atomic_write_json`. Kustutatud teose `work_id` jääb faili kuni järgmise puudutuseni; lugemine
filtreerib tundmatud ID-d vaikselt välja (kogu ei tohi katkise viite pärast tühjaks minna).

## API

| Endpoint | Roll | Märkus |
|---|---|---|
| `POST /collections/{id}/works` | kuraator või admin | body `{work_ids: []}`; valvurid: kogu on temaatiline, kutsuja näeb teost (`can_read_work`), teosel on struktuurne kodu (O4) |
| `DELETE /collections/{id}/works` | kuraator või admin | sama |
| `PUT /admin/collections/{id}` | superadmin | laieneb: `name`, `parent`, `order`, `type`, `curators`, `status` (praegu ainult kirjeldus/värv/nähtavus/kasutajad) |
| `GET /admin/collections/{id}/works-count` | admin | arvestab temaatilist liikmesust |

`parent` muutmine nõuab alampuu teoste Meili resünki (`_find_works_with_collection` on olemas).
Temaatilise liikmesuse muutmine resünkib ainult puudutatud teosed.

## Väravad

- **i18n** — uued võtmed **mõlemasse keelde korraga** (ADR 0011).
- `npm run typecheck`, `npm test`, `.venv/bin/pytest tests/`.
- **Valvurtestid:** (a) temaatiline kogu ei muuda `is_public`-ut; (b) temaatiline liikmesus ei
  anna `can_write_work`-i; (c) temaatilisse kogusse lisamine ilma struktuurse koduta = 400;
  (d) mõlemad indekseerimisteed annavad sama `collections_hierarchy` (contract-test);
  (e) sorteerimisreegel O7 on deterministlik `order`-ita kogude korral.
- **Migratsiooniskript on kuivkäivitusega vaikimisi** ja käib KONTEINERIST (`data/` git commitib
  root'ina).
- Dashboardi esmalaadimise aeg enne/pärast — fasseti-päring ei tohi teda aeglustada (#319).

## Skoobist väljas

- Isiklikud ajutised nimekirjad (üks kasutaja, jagamata) — eraldi mõiste, eraldi issue.
- Avalik sirvimisleht `/collections` — #319 ütleb sama.
- Kogu-ID muutmine ja migratsioon.
- #319 valiku-modaali sisu (arvud, kirjeldused, otsinguväli, klaviatuur) — see spekk annab
  `type`, `order`, `status` lepingu, mille peal #319 ehitab; modaal ise jääb #319-sse.

## Riskid

- **Kaks liikmesuse allikat.** Projekt on selle mustri käes varem kannatanud
  (`person_to_works`, `person_aliases`). Erinevus: võtmeruumid on lahus (kumbki ei kirjuta
  teise faili) ja liitmine on ühesuunaline tuletatud välja (O8). Valvur = punkt (d).
- **Migratsioon puudutab kirjutusõigust.** Klingeriana/PFS `parent`-i muutmine ei tohi
  `collections` massiivi puutuda; kolme contributori ulatus kontrollitakse enne ja pärast
  (nimeline loend logisse).
- **„Määramata" muutub prügikastiks.** Vastumeede: halduses nähtav arv, mitte vaikevalik.
