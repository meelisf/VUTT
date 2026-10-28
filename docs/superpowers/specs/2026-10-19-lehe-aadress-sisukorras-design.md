# Lehe aadress sisukorras, käsikirjad — spekk 2 (#630, ADR 0070)

**Kuupäev:** 2026-10-19
**Staatus:** mustand, ülevaatusringid enne teostust (kasutaja nõue, ADR 0070); ülevaatused 1–3
sisse viidud, ulatus kitsendatud käsikirjadele 2026-10-19
**Eelneb:** spekk 1 `2026-10-16-lehe-tahistus-tagid-design.md` — tägid `<fw>`/`<sig>`/`<catch>`/`<rh>`,
`page_marks`, paneel (tootmises 17.10, PR #631–636).

## Eesmärk ja põhjus

Käsikirjalise teose osa (eelkõige kiri) peab olema **tsiteeritav köite enda aadressiga**.
VUTT-i lehenumber on positsioon pildijärjestuses ja jääb navigeerimiseks; viitamiseks on
vaja `fol. 10r–[10v]` või `p. 12–[13]`.

Kasutaja (2026-10-19): „sisuliselt ei ole vaja muud, kui viitamist". Kasutaja liigub
VUTT-is edasi VUTT-i lehekülgede järgi; aadressi järgi sirvimist ei tehta.

**Ainult käsikirjad** (kasutaja 2026-10-19: „trükiste erijuhud viivad lõpuks tupikusse").
Ülevaatusringid näitasid, et trükistel kasvab erijuhtude hulk kiiremini kui reeglid:
signatuuride kirjaviisid (`A ij`, `Ccij`, `)2(` — number tüve sees), tüvede järjestus,
laotuspildid (`rzk0ws`: peaaegu iga pilt kaks lehekülge), rooma eelmängud ja konvoluutide
taaskäivitused. Käsikirjade foliatsioon on lihtne ja seal on päris vajadus — kirjakogud
`o17ekb` (Fischer) ja `t9zd42` (Klinger).

**Sihtpilt** (sisukorra rida): `19–20, 22 (fol. 10r–[10v], [11v])`
— `o17ekb` osa `47w6yr`: lk 19 `<fw>10</fw>`, lk 20 tühi, lk 21 `<fw>11</fw>` (osast väljas),
lk 22 tühi, lk 23 `<fw>12</fw>`.

## Eesmärgid

1. Käsikirjalise teose metaandmetes **lehenummerduse skeem** (`foliation` | `pagination`),
   mille admin määrab.
2. Server arvutab osa **aadressiviite** lehel nähtavast `<fw>`-st + ühe sammu
   edasituletusest.
3. Viide kuvatakse **Workspace'i sisukorras** (`WorkPartsPanel`) lehenumbrite järel
   sulgudes ja **MCP `get_work_parts`** vastuses.

## Mittetaotlused (v1)

- **Trükised** (`type` ≠ `Q87167`) — mitte mingit aadressi, ka nähtavat mitte.
- **Signatuurid** (`<sig>`) aadressina — jäävad eksemplari kihi juurde.
- Rooma paginatsioon (käsikirjades harv) — v1-s parsimatu.
- Aadressi järgi navigeerimine, URL `/work/{id}/246v`, aadressi otsing/filter Meilis.
- Lehepõhine aadressi kuva Workspace'is, kirjaotsingu tulemusreal, IIIF, CMIF, TEI eksport.
- Käsitsi aadress (ADR 0070 p. 5), pikk loendus üle mitme lehe, `conflict`-lipp ja
  read-model (ADR 0070 p. 7).
- Laotuspildi (`<pb/>`) poolte eraldi aadressid (ADR 0070 lahtine küsimus).
- Skeemi automaatne tuvastus või ettepanek; ankru ettepanek (ADR 0070 p. 6/8).
- **Vastupidine suund** (poogen/leht → VUTT-i lehed; puuduv leht, vesimärk) — kasutaja:
  tuleb eksemplari kihiga, „täiesti omaette värk". **Nõue v1-le:** aadressi sisemine kuju
  on normaliseeritud ja masinloetav (`{scheme, n, side}`), mitte ainult kuvatekst.

## Anti-eesmärgid

- **Vale aadress kindla pähe.** Kahtluse korral pigem `?` kui vale. Tuletatud aadress on
  alati nurksulgudes (kasutaja 2026-10-19).
- Tekstis ei muudeta midagi; tuletus ei kirjuta lehe faile ega git-ajalugu.
- Reegleid ei laiendata trükiste juhtumite katmiseks — iga uus erijuht on v1-s `?`.

## Andmed

### Skeem — `_metadata.json` väli `page_numbering`

| Väärtus | Tähendus `<fw>`-le |
|---|---|
| `"foliation"` | foliatsioon: number tähistab lehte, `r`/`v` küljed |
| `"pagination"` | paginatsioon: number tähistab lehekülge |
| puudub / `null` | aadressi ei tehta |

**Aadress arvutatakse ainult siis, kui `type.id == "Q87167"` (käsikiri) JA skeem on
määratud.** Kontroll sama mis `reocr.py`-s (`type` on dict ja `type.id == "Q87167"`; vt ka `work_relations_ops.MANUSCRIPT_TYPE`); mõlemad katsejuhtumid on tootmises `Q87167` (kontrollitud 19.10). Kui teose tüüp hiljem muutub, väli jääb alles, aga aadressi ei arvutata.

- Kirjutus ainult `save_work_metadata` kaudu (`/update-work-metadata`): väli lisada
  `ALLOWED_METADATA_FIELDS`-i (`server/metadata_ops.py`), muidu heidetakse ta vaikselt
  kõrvale; valideerimine: ainult `foliation` | `pagination` | `null`, muu → 400.
- Õigus: sama mis muudel metaandmetel — `/update-work-metadata` ja `MetadataModal` on
  praegu **admin**. v1 seda ei muuda. *Minu otsus.*
- Ei indekseerita Meili (ADR 0006 — ei ole otsingu- ega filtriväli).
- UI: väli tuleb lisada **mõlemasse** loendisse: laadimine (`fetchServerMetadata`) ja
  payload (`src/utils/buildMetadataPayload.ts`); payload saadab välja ainult siis, kui ta
  laeti (olemasolev `!== undefined` muster) — muidu kustutab iga metaandmete salvestus
  skeemi. Test „salvestus säilitab skeemi".
- UI: `MetadataModal` — valik „Lehenummerdus: — / foliatsioon / paginatsioon", nähtav
  ainult käsikirjal (`type` = `Q87167`); i18n mõlemasse keelde (ADR 0011). `types.ts` väli.
- Skeem on **teose** tasemel. Osa tasemel skeemi v1-s ei ole.

### Allikas — lehe tekst

Aadressi sisend on lehe `.txt`-ist parsitud `<fw>` (`vutt_tags.page_mark_entries`, sama
tõlgendus mis `page_marks`-il). Arvutus käib **kettalt päringu ajal**, mitte Meilist:
`/parts` vastus peab peegeldama salvestatud teksti (Meili sünk on async).

Värskus kliendis: `WorkPartsPanel` laeb `/parts` teose avamisel (`workId`/`token`).
v1-s **ei** lisata salvestuse → paneeli uuenduskanalit; uus `<fw>` paistab sisukorras
järgmisel laadimisel. *Minu otsus.*

NB: MCP `get_pages` ei näita `<pb/>`-d — lehe teksti kaudu ei näe laotust. Kontrolli
fikstuure toorfailist (`ssh vutt`), mitte MCP-st.

## Aadressi reeglid

Iga VUTT-i leht on ühes neljast olekust:

| Olek | Millal | Aadress | Naabrile allikas |
|---|---|---|---|
| **laotus** | tekstis on `<pb/>` | ei | ei |
| **parsimatu** | on `<fw>`, aga see ei parsi skeemi järgi | ei | ei |
| **nähtav** | esimene `<fw>` parsib | jah, ilma sulgudeta | jah |
| **tähistuseta** | `<fw>`-d pole (ka tühi `<fw></fw>`) | ainult tuletusega | ei |

Naaber = teose eelmine/järgmine leht `page_stems` järjekorras (**teose**, mitte osa
tasemel — `47w6yr` lk 22 tuletub osast väljas olevast lk 21-st).

### Parsimine

Loetakse lehe **esimene** kehtiv `<fw>`; teised `<fw>`-d samal lehel ei lähe arvesse
(ADR 0070 p. 7 v1 piirang). Sisu tühikud normaliseeritakse.

- **Foliatsioon:** `^\d+\s*[rv]?$` (tõstutundetu) → `{n, side}`; side puudub → `r`.
  Kuva `10r`, `246v`. `n ≥ 1`.
- **Paginatsioon:** `^\d+$` → `{n}`, `n ≥ 1`. Kuva `12`.
- Muu (rooma, `Fol. 3a`, `86a`, lehel päriselt olev `[12]`, `0`) → **parsimatu**.
  Nurksulgudes lehel olev number on parsimatu ka seepärast, et ta läheks kuval segi
  tuletatud aadressiga.

### Tuletus (ainult tähistuseta lehele)

Üks samm, **ainult edasi, ainult eelmiselt lehelt** (ADR 0070 p. 7 „tagasi ei loendata").
Tuletatud aadressist edasi ei tuletata.

- **Foliatsioon:** eelmine leht on **nähtav recto** `Nr` → see leht on `[Nv]`.
  Eelmine leht on verso, tähistuseta, parsimatu, laotus või puudub → ei tuletata.
  Järgmisest lehest ei tuletata kunagi: `t9zd42` lk 5 (`261`) eelneb köites auk —
  tagasisuunas pakuks ta tähistuseta lk 4-le `[260v]`, õige on `[247v]` (lk 3 `247`).
  Verso ja tema recto on sama füüsiline leht; järgmine recto on juba teine leht.
- **Paginatsioon:** eelmine leht on nähtav `n` → see leht on `[n+1]`.
- **Kontroll järgmise lehega** (mõlemad skeemid): kui järgmine leht on **nähtav** ja ei
  ole tuletatud aadressi järglane (foliatsioon: `(N+1)r`; paginatsioon: `n+2`), siis **ei
  tuletata** — naabrid näitavad hüpet (`5`, tühi, `12` → `?`). Järgmine leht tähistuseta,
  parsimatu või laotus → kontroll ei takista.
- **Topeltnumber** (`o17ekb` lk 171 ja 173 mõlemad `<fw>86</fw>`): mõlemad nähtavad,
  näidatakse nii, nagu lehel on. Unikaalsust v1 ei väida (URL-i pole).

## Osa viide

Viide kirjeldab **kontrollitud vahemikke**, mitte ainult otspunkte: VUTT-i katkematu lõik
ei taga katkematut aadressijada (`10r, 10v, 25r, 25v` ei tohi anda `fol. 10r–25v`).

1. Osa lehed → katkematud VUTT-i lõigud (sama jaotus mis `pageRangeList`).
2. Iga VUTT-i lõigu **iga leht** saab aadressi (nähtav / tuletatud / teadmata). Lõik
   jagatakse **aadressilõikudeks** igal kohal, kus järgmine aadress ei ole eelmise
   **järglane**:
   - foliatsioon: `Nr → Nv → (N+1)r`;
   - paginatsioon: `n → n+1` (taaskäivitus `40 → 1`, hüpe `12 → 30` = uus aadressilõik);
   - teadmata aadressiga leht (tähistuseta ilma tuletuseta, parsimatu, laotus) katkestab
     alati ja kuvatakse `?`; järjestikused teadmata lehed = üks `?`.
3. Kuju: `prefiks alõik, alõik` — prefiks `fol.` / `p.` (sama mõlemas UI keeles),
   aadressilõik `algus–lõpp` või ühe lehe korral `algus`; tuletatud nurksulgudes. Näited:
   - lk `19–20, 22` → `fol. 10r–[10v], [11v]`
   - lk `1–4` (t9zd42) → `fol. 246r–247v`
   - aadressid `10r, 10v, 25r, 25v` ühes VUTT-i lõigus → `fol. 10r–[10v], 25r–[25v]`
   - lk 12 teadmata → `fol. 10r–11v, ?, 13r–14v`
4. Kui osa **ühelgi** lehel pole aadressi → viidet pole (sulud jäävad ära). *Minu otsus.*
5. Kokkutõmbeid (`10r–v`) v1 ei tee. Pikk viide lõigatakse sisukorras CSS-iga
   (`truncate` + `title`), mitte andmes. *Minu otsus.*

Viide arvutatakse **serveris ühes kohas** ja antakse valmis stringina — sisukord ja MCP
saavad sama teksti ilma kahe vormindajata. Lisaks struktureeritud kuju (eesmärk
„vastupidine suund").

## Liidesed

### `GET /works/{work_id}/parts` (`server/routers/work_parts.py`)

Juurde **ainult päringuparameetriga `?addresses=1`** (olemasolevate võtmete kõrvale,
ligipääsukontroll sama). Seda kasutavad `WorkPartsPanel` ja MCP `get_work_parts`;
`PartRedirect` ja MCP ettepanekuvoog (`pages_version`) ei maksa lugemise eest.
Trükisel või skeemita teosel: `page_numbering` nagu metaandmetes, `part_addresses: {}`,
lehti ei loeta.

```json
"page_numbering": "foliation",
"part_addresses": {
  "47w6yr": {
    "text": "fol. 10r–[10v], [11v]",
    "ranges": [
      {"from_page": 19, "to_page": 20, "from_stem": "…-019", "to_stem": "…-020",
       "from": {"scheme": "foliation", "n": 10, "side": "r", "derived": false},
       "to":   {"scheme": "foliation", "n": 10, "side": "v", "derived": true}},
      {"from_page": 22, "to_page": 22, "from_stem": "…-022", "to_stem": "…-022",
       "from": {"scheme": "foliation", "n": 11, "side": "v", "derived": true},
       "to":   {"scheme": "foliation", "n": 11, "side": "v", "derived": true}}
    ]
  }
}
```

Iga kirje on üks **aadressilõik** koos oma VUTT-i lehtede (`from_page`/`to_page` + tüved)
ulatusega; ühe lehe lõigul on `from_page == to_page` ja `from == to`. `null` aadressi
asemel tähendab AINULT „aadress teadmata" (`?` lõik: `from` ja `to` mõlemad `null`).
Paginatsioonis `side` puudub. Ilma viiteta osa on `part_addresses`-ist puudu. Täpsed
väljanimed on ehitaja otsus, kui eristused jäävad alles.

- Arvutus uues puhtas moodulis (nt `server/page_address.py`: sisend = tüvede järjekord +
  tüve → tekst + skeem; väljund = aadressid ja viited). Side-effect-vaba, nagu
  `meili_doc.py`; I/O teeb route.
- Route on sync `def` (ADR 0002). Lugeda tuleb **kõik osades olevad lehed + iga VUTT-i
  lõigu otsene eel- ja järelnaaber**; skeem ja tüüp tulevad metaandmetest.
- **Mõõdetud tootmises 2026-10-19** (`vutt-backend`, soe lehevahemälu): kõigi `.txt`
  lugemine + `page_mark_entries` — `o17ekb` 512 lk **17 ms**, suurim teos (706 lk) **24 ms**;
  `stat` 512 faili 3 ms. Olemasolev `list_parts` kutsub `page_stems`-i **kaks korda**
  (~20 ms kumbki) — ühekordseks tegemine korvab lisanduse. Tuletus on puhas CPU
  (mikrosekundid). Külma ketta aega ei saanud mõõta (`drop_caches` vajab root'i).
  **Vahemälu v1-s ei tehta.**

### Sisukord (`src/components/editor/WorkPartsPanel.tsx`)

Lõigu numbrite järel `(fol. 10r–[10v], [11v])` hallis ja väiksemas kirjas. Lehenumbrid
jäävad lingiks, viide on tavaline (kopeeritav) tekst. Tooltip: „Nurksulgudes aadress on
tuletatud eelmiselt lehelt" (i18n). Mobiilivaade (`WorkspaceMobileView`) kasutab sama
komponenti.

### MCP `get_work_parts` (`mcp/vutt_mcp/parts.py`)

Osale väli `address` (= `text`) ja teosele `page_numbering`. Tööriista kirjeldusse üks
lause: aadress on käsikirja enda viide (ainult käsikirjadel), nurksulgudes osa on
tuletatud, `pages` jääb VUTT-i numbriks. Uuenda `mcp/README.md`.

## Testid

- Puhas moodul, tabelitestid:
  - `o17ekb` `47w6yr` (sihtpilt) ja `t9zd42` lk 1–4 (`fol. 246r–247v`, päris andmed);
  - `t9zd42` auk **sünteetilise fikstuurina** (päris lk 4 kannab nähtavat `247v`;
    fikstuuris lk 4 tähistuseta → `[247v]`, mitte `[260v]`);
  - neli olekut: laotus (`<pb/>`), parsimatu (`Fol. 3a`, `xii`, `[12]`, `86a`, `0`),
    nähtav, tähistuseta; parsimatu ei tuletu ise ega naabrile (`10` → `Fol. 3a`);
  - tuletus ainult nähtavalt rectolt (verso → verso ei tule); tuletatust ei tuletata;
  - järgmise lehe kontroll: `5, ∅, 12` → `?`; `10r, ∅, 12r` → `?`; `10r, ∅, ∅` → `[10v], ?`;
  - kontrollitud vahemik: `10r,10v,25r,25v` → kaks aadressilõiku; paginatsiooni
    taaskäivitus `40 → 1`; struktureeritud kuju: ühe lehe lõik vs `?`-lõik eristuvad;
  - trükis skeemiga → viidet pole; käsikiri skeemita → viidet pole.
- Route: `?addresses=1` puudumisel uusi võtmeid pole; trükisel lehti ei loeta (mock);
  ligipääsuta 403 nagu enne.
- `page_numbering` valideerimine `/update-work-metadata`-s; salvestus säilitab skeemi.
- `WorkPartsPanel` komponenditest (jsdom-päis) — viide kuvatakse; ilma viiteta sulgusid pole.
- MCP: `test_parts`-is `address` väli.
- i18n paarsus (`localeParity`, `translationKeysResolve`).

## Teostuse järel

- ADR 0070 täiendus:
  - v1 = käsikirjad, `<fw>`, ühe sammu edasituletus (spekk 2); trükised, signatuurid,
    täisloendus, `conflict` ja käsitsi aadress edasi lükatud;
  - p. 7 „loendus … kuni osa piirini" ei kehti v1-le: naaber on teose tasemel
    (`47w6yr` lk 22 ← lk 21);
  - lahtistest suletuks: recto kuva (`10r`), kasutuskoht (sisukord + MCP);
  - uus juhtum lahtiste juurde: `rzk0ws` signatuur `)2(` (number tüve sees).
- `list_parts`: `page_stems` üks kord (praegu kaks).
- `o17ekb` ja `t9zd42` skeemiks `foliation` (admin, `MetadataModal` kaudu).
- MCP `get_pages`: `<pb/>` nähtavaks (eraldi väike parandus, mitte see spekk).

## Ehitajale jäetud

- Struktureeritud aadressi täpne JSON-kuju (piirangutega ülal).
- Kas route loeb tekstid otse või kasutab olemasolevat lehe lugemise abifunktsiooni.
- Sisukorra viite täpne paigutus ja stiil olemasolevas reas.
