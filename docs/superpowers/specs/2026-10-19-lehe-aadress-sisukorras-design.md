# Lehe aadress sisukorras — spekk 2 (#630, ADR 0070)

**Kuupäev:** 2026-10-19
**Staatus:** mustand, ülevaatusringid enne teostust (kasutaja nõue, ADR 0070); ülevaatus 1 (ehitaja-kontroll) ja 2 (kasutaja kaudu) sisse viidud 2026-10-19
**Eelneb:** spekk 1 `2026-10-16-lehe-tahistus-tagid-design.md` — tägid `<fw>`/`<sig>`/`<catch>`/`<rh>`,
`page_marks`, paneel (tootmises 17.10, PR #631–636).

## Eesmärk ja põhjus

Teose osa (kiri, kõne, …) peab olema **tsiteeritav köite enda aadressiga**. VUTT-i
lehenumber on positsioon pildijärjestuses ja jääb navigeerimiseks; viitamiseks on
vaja `fol. 10r–[10v]`, `p. 12–[13]`, `sig. A2r–[A2v]`.

Kasutaja (2026-10-19): „sisuliselt ei ole vaja muud, kui viitamist". Kasutaja liigub
VUTT-is edasi VUTT-i lehekülgede järgi; aadressi järgi sirvimist ei tehta.

**Sihtpilt** (sisukorra rida): `19–20, 22 (fol. 10r–[10v], [11v])`
— `o17ekb` osa `47w6yr`: lk 19 `<fw>10</fw>`, lk 20 tühi, lk 21 `<fw>11</fw>` (osast väljas),
lk 22 tühi, lk 23 `<fw>12</fw>`.

## Eesmärgid

1. Teose metaandmetes **lehenummerduse skeem**, mille toimetaja määrab.
2. Server arvutab osa **aadressiviite** lehel nähtavatest tähistustest + lühikesest
   naabertuletusest.
3. Viide kuvatakse **Workspace'i sisukorras** (`WorkPartsPanel`) lehenumbrite järel
   sulgudes ja **MCP `get_work_parts`** vastuses.

## Mittetaotlused (v1)

- Aadressi järgi navigeerimine, URL `/work/{id}/246v`, aadressi otsing/filter Meilis.
- Lehepõhine aadressi kuva Workspace'is, kirjaotsingu tulemusreal, IIIF, CMIF, TEI eksport.
- Käsitsi aadress (ADR 0070 p. 5), pikk loendus üle mitme lehe, `conflict`-lipp ja
  read-model (ADR 0070 p. 7). Need jäävad ADR-i; v1 on teadlikult lühem.
- Skeemi automaatne tuvastus või ettepanek (ADR 0070 p. 6/8).
- Ankru ettepanek (juba ADR 0070 p. 8 järgi väljas).
- **Vastupidine suund** (poogen `B ij` → VUTT-i lehed; puuduv poogen, vesimärk) —
  kasutaja: tuleb eksemplari kihiga, „täiesti omaette värk". **Nõue v1-le:** aadressi
  sisemine kuju on normaliseeritud ja masinloetav (`{scheme, value, side}`, nt
  `B`,`2`,`r`), mitte ainult kuvatekst — et seda saaks hiljem tagurpidi otsida.

## Anti-eesmärgid

- **Vale aadress kindla pähe.** Kahtluse korral pigem tühi kui vale. Tuletatud aadress
  on alati nurksulgudes (kasutaja 2026-10-19).
- Tekstis ei muudeta midagi; tuletus ei kirjuta lehe faile ega git-ajalugu.

## Andmed

### Skeem — `_metadata.json` väli `page_numbering`

| Väärtus | Tähendus `<fw>`-le |
|---|---|
| `"foliation"` | foliatsioon: number tähistab lehte, `r`/`v` küljed |
| `"pagination"` | paginatsioon: number tähistab lehekülge |
| `"signatures"` | viide tehakse `<sig>`-ist (`<fw>` ei lähe arvesse) |
| puudub / `null` | aadressi ei tehta |

Kolm väärtust nagu ADR 0070 p. 6. Teosel võivad olla korraga `<fw>` ja `<sig>` (trükis
lehekülje- ja poognanumbritega) — siis on skeem `pagination` (kasutaja: „ainult
paginatsioon, signatuur siis kui paginatsiooni pole"); `signatures` on trükisele, millel
paginatsiooni pole. Skeem on selgesõnaline, et route ei peaks kogu teost skaneerima
„kas `<sig>` on olemas?" otsustamiseks. *Minu otsus (ülevaatus 1).*

- Kirjutus ainult `save_work_metadata` kaudu (`/update-work-metadata`): väli lisada
  `ALLOWED_METADATA_FIELDS`-i (`server/metadata_ops.py`), muidu heidetakse ta vaikselt
  kõrvale; valideerimine: lubatud on ainult neli olekut, muu → 400.
- Õigus: sama mis muudel metaandmetel — `/update-work-metadata` ja `MetadataModal` on
  praegu **admin**. v1 seda ei muuda. *Minu otsus.*
- Ei indekseerita Meili (ADR 0006 — ei ole otsingu- ega filtriväli).
- UI: `MetadataModal` — valik „Lehenummerdus: — / foliatsioon / paginatsioon / signatuurid", i18n
  mõlemasse keelde (ADR 0011). `types.ts` väli.
- Skeem on **teose** tasemel. Osa tasemel skeemi v1-s ei ole.

### Allikas — lehe tekst

Aadressi sisend on lehe `.txt`-ist parsitud tähistus (`vutt_tags.page_mark_entries`,
sama tõlgendus mis `page_marks`-il). Arvutus käib **kettalt päringu ajal**, mitte Meilist:
`/parts` vastus peab peegeldama salvestatud teksti (Meili sünk on async).

Värskus kliendis: `WorkPartsPanel` laeb `/parts` teose avamisel (`workId`/`token`).
v1-s **ei** lisata salvestuse → paneeli uuenduskanalit; uus `<fw>` paistab sisukorras
järgmisel laadimisel. *Minu otsus (ülevaatus 1) — kui see osutub kasutuses tülikaks,
on lisa väike.*

## Aadressi reeglid

Iga VUTT-i leht saab kas **nähtava aadressi**, **tuletatud aadressi** või **mitte midagi**.
Naaber = teose järgmine/eelmine leht `page_stems` järjekorras (**teose**, mitte osa
tasemel — `47w6yr` lk 22 tuletub osast väljas olevast lk 21-st).

### Valitav jada

Skeem määrab ühe jada kogu teosele: `foliation`/`pagination` → `<fw>`, `signatures` →
`<sig>`. Lehe tasemel tagasilangust teisele jadale ei ole (`pagination`-teose lehel ilma
`<fw>`-ta ei kasutata `<sig>`-i; segatud viide `p. 12–sig. B1r` oleks segadus). *Minu otsus.*

### Parsimine (nähtav aadress)

Lehe kohta loetakse valitud liigi **esimene** kehtiv tähistus (`seg` = 0); teised sama
liiki tähistused samal lehel ei lähe arvesse (ADR 0070 p. 7 v1 piirang).

- **Foliatsioon:** `^\d+\s*[rv]?$` (tõstutundetu, tühikud lubatud) → `{n, side}`;
  side puudub → `r`. Kuva `10r`, `246v`.
- **Paginatsioon:** araabia `^\d+$` või rooma `^[ivxlcdm]+$` / `^[IVXLCDM]+$` (lõpu-`j` = `i`)
  → `{n, kind}`, kus **numeratsiooniliik** `kind` ∈ `arabic | roman_lower | roman_upper`.
  Kuva nagu lehel (`12`, `xii`). Segatud suurtähtedega rooma (`Xii`) on parsimatu.
- **Signatuur:** `tüvi + valikuline number` ADR 0070 p. 7 järgi (`A ij` → `A2`, `B` → `B1`,
  `)(` → `)(1`); signatuur tähistab recto't → `A2r`. Tüvi ilma numbrita = poogna 1. leht;
  `<sig>C</sig>` on poogen C, mitte rooma 100.
  Tüve ja numbri piir: tühiku olemasolul tühik (`A ij`, `Aa 3`). Tühikuta kujul (`Ciij`,
  `Aaij`, `ci`) on tüvi **lühim eesliide, mille järel ülejäänu on tühi, araabia number või
  väiketäheline rooma number** (`j` = `i`): `Ciij` → `C3`, `Aaij` → `Aa2`, `ci` → `c1`,
  `Bb` → `Bb1` (`b` ei ole rooma). Tüvi peab olema mittetühi. Suurtäheline numbriosa
  (`CIII`) on parsimatu. *Minu otsus (ülevaatus 1); fikstuurides kõik need kujud.*
- Lehel on seega kolm olekut: **tähistus puudub** (valitud liigi kehtivat tähistust pole),
  **parsitud** (nähtav aadress) ja **parsimatu** (tähistus on, nt `<fw>Fol. 3a</fw>`, aga
  skeemi järgi ei parsi). Parsimatu leht ei saa aadressi, **ei saa ka tuletatud aadressi**
  (tema tähistus osutab millelegi muule — `<fw>10</fw>` → `<fw>Fol. 3a</fw>` EI anna
  `[10v]`) ega ole naabrile allikas. Kuvatekstina teda v1 ei näita. (Ülevaatus 2.)

### Tuletus (ainult lehele, mille olek on „tähistus puudub")

Tuletus vaatab **ainult otsest naabrit**; mitme lehe kaugusele ei loendata.

- **Foliatsioon ja signatuur:** ainult **eelmisest** lehest. Kui eelmise lehe nähtav
  aadress on **recto** (`Nr`), on see leht `[Nv]`. Järgmisest lehest ei tuletata kunagi:
  `t9zd42` lk 5 (`261`) eelneb köites auk — tagasisuunas pakuks ta lk 4-le `[260v]`, aga
  õige on `[247v]` (lk 3 `247`). Verso ja tema recto on sama füüsiline leht; järgmine
  recto on juba teine leht.
- Eelmine leht on ise verso (nähtav `Nv` või tuletatud) või puudub → **ei tuletata**
  (signeerimata/foliieerimata recto on ebatavaline; pigem tühi kui vale).
- **Paginatsioon:** eelmine `n` → kandidaat `[n+1]`; järgmine `m` → kandidaat `[m−1]`.
  Kandidaat kannab allika numeratsiooniliiki ja kirjaviisi (`xii` → `[xiii]`, `XII` → `[XIII]`).
  Üks kandidaat → see. Kaks kandidaati on kokkulangevad ainult siis, kui **väärtus JA
  liik** on samad; muidu → **ei tuletata**. Nii ei anna `iv`, tühi, `6` (eelmäng → põhiosa)
  ei `[v]`-d ega `[5]`-t. Kandidaat `< 1` (järgmine leht on `1` või `i`) → kandidaati pole —
  1-st tagasi ei tuletata. (Ülevaatus 2.)
- Tuletatud aadressist ei tuletata edasi (ainult üks samm).
- **Laotuspilt** (lehel on `<pb/>`, ADR 0070 p. 4): v1-s ei saa ta nähtavat ega tuletatud
  aadressi ega ole naabrile allikas. *Minu otsus — füüsilise lehekülje identiteet on
  ADR 0070 lahtine küsimus.*
- **Topeltnumber** (`o17ekb` lk 171 ja 173 mõlemad `<fw>86</fw>`): mõlemad näidatakse nii,
  nagu lehel on. Unikaalsust v1 ei väida (URL-i pole).

## Osa viide

Viide kirjeldab **kontrollitud vahemikke**, mitte ainult otspunkte (ülevaatus 2): VUTT-i
katkematu lõik ei taga katkematut aadressijada. Aadressijada `10r, 10v, 25r, 25v` ei tohi
anda `fol. 10r–25v`. Paginatsiooniga teostes on tavalised eelmäng rooma numbritega, siis
araabia, ja konvoluudis uus algus `1`-st (kasutaja 2026-10-19) — need peavad viites näha olema.

1. Osa lehed → katkematud VUTT-i lõigud (sama jaotus mis `pageRangeList`).
2. Iga VUTT-i lõigu **iga leht** saab aadressi (nähtav / tuletatud / teadmata). Lõik
   jagatakse **aadressilõikudeks** igal kohal, kus järgmine aadress ei ole eelmise
   **järglane**:
   - foliatsioon: `Nr → Nv → (N+1)r`;
   - paginatsioon: `n → n+1` **sama liigi** piires (liigi vahetus `iv → 1`, taaskäivitus
     `40 → 1`, hüpe `12 → 30` = uus aadressilõik);
   - signatuur: `XNr → XNv → X(N+1)r`; `Xkv → Y1r` (uus tüvi poogna 1. lehena) loetakse
     järglaseks, sest poogna pikkust ei teata (ADR 0070 p. 7 „lubatud uus algus");
   - teadmata aadressiga leht (tähistus puudub ja tuletus ei õnnestunud, parsimatu,
     laotuspilt) katkestab alati ja kuvatakse `?`; järjestikused teadmata lehed = üks `?`.
3. Kuju: `prefiks alõik, alõik` — prefiks `fol.` / `p.` / `sig.` (sama mõlemas UI keeles),
   aadressilõik `algus–lõpp` või ühe lehe korral `algus`; tuletatud nurksulgudes. Näited:
   - lk `19–20, 22` → `fol. 10r–[10v], [11v]`
   - lk `1–4` (t9zd42) → `fol. 246r–247v`
   - lk `1–30`, eelmäng + põhiosa → `p. [i]–xiv, 1–16`
   - aadressid `10r, 10v, 25r, 25v` ühes VUTT-i lõigus → `fol. 10r–[10v], 25r–[25v]`
   - lk 12 teadmata → `fol. 10r–11v, ?, 13r–14v`
4. Kui osa **ühelgi** lehel pole aadressi → viidet pole (sulud jäävad ära). *Minu otsus.*
5. Kokkutõmbeid (`10r–v`) v1 ei tee. Viide võib olla pikk; sisukorras lõigatakse ta
   vajadusel CSS-iga (`truncate` + `title`), mitte andmes. *Minu otsus.*

Viide arvutatakse **serveris ühes kohas** ja antakse valmis stringina — nii saavad
sisukord ja MCP sama teksti ilma kahe vormindajata. Lisaks antakse struktureeritud kuju
(eesmärk „vastupidine suund").

## Liidesed

### `GET /works/{work_id}/parts` (`server/routers/work_parts.py`)

Juurde (olemasolevate võtmete kõrvale, ligipääsukontroll sama):

```json
"page_numbering": "foliation",
"part_addresses": {
  "47w6yr": {
    "text": "fol. 10r–[10v], [11v]",
    "ranges": [
      {"from_page": 19, "to_page": 20, "from_stem": "00019", "to_stem": "00020",
       "from": {"scheme": "foliation", "n": 10, "side": "r", "derived": false},
       "to":   {"scheme": "foliation", "n": 10, "side": "v", "derived": true}},
      {"from_page": 22, "to_page": 22, "from_stem": "00022", "to_stem": "00022",
       "from": {"scheme": "foliation", "n": 11, "side": "v", "derived": true},
       "to":   {"scheme": "foliation", "n": 11, "side": "v", "derived": true}}
    ]
  }
}
```

Iga kirje on üks **aadressilõik** koos oma VUTT-i lehtede (`from_page`/`to_page` + tüved)
ulatusega; ühe lehe lõigul on `from_page == to_page` ja `from == to`. `null` aadressi
asemel tähendab AINULT „aadress teadmata" (`?` lõik: `from` ja `to` mõlemad `null`).
(Ülevaatus 2.) Paginatsiooni aadress kannab `kind`-i, signatuur `stem`-i. Ilma viiteta
osa on `part_addresses`-ist puudu. Täpsed väljanimed on ehitaja otsus, kui eristused
jäävad alles.

- Arvutus uues puhtas moodulis (nt `server/page_address.py`: sisend = tüvede järjekord +
  tüve → tekst või tähistused + skeem; väljund = aadressid ja viited). Side-effect-vaba,
  nagu `meili_doc.py`; I/O teeb route.
- Route on sync `def` (ADR 0002). Lugeda tuleb **kõik osades olevad lehed + iga VUTT-i
  lõigu otsene eel- ja järelnaaber** (kontrollitud vahemik vajab sisemisi lehti); skeem
  tuleb metaandmetest. Kirjakogus (`o17ekb`) on see praktiliselt kogu teos (512 `.txt`)
  igal `/parts` päringul — **mõõda** enne ja pärast (ka MCP ja avalik sisukord kutsuvad).
  Kui vaja, protsessi-lokaalne parsitud tähistuste vahemälu võtmega
  `(tee, mtime_ns, size)`: värske konstruktsiooni poolest (salvestus muudab `mtime`-i),
  ei vaja invalideerimist ja ei ole kasutajapõhine (ligipääs kontrollitakse enne) —
  seega ei riku ADR 0042 `cache.py` reeglit. `stat` jääb iga lehe kohta alles.

### Sisukord (`src/components/editor/WorkPartsPanel.tsx`)

Lõigu numbrite järel `(fol. 10r–[10v], [11v])` hallis ja väiksemas kirjas. Lehenumbrid
jäävad lingiks, viide on tavaline (kopeeritav) tekst. Tooltip: „Nurksulgudes aadress on
tuletatud naaberlehelt" (i18n). Mobiilivaade (`WorkspaceMobileView`) sama, kui ta
kasutab sama komponenti.

### MCP `get_work_parts` (`mcp/vutt_mcp/parts.py`)

Osale väli `address` (= `text`) ja teosele `page_numbering`. Tööriista kirjeldusse üks
lause: aadress on köite enda viide, nurksulgudes osa on tuletatud, `pages` jääb VUTT-i
numbriks. Uuenda `mcp/README.md`.

## Testid

- Puhas moodul: tabelitestid kõigile reeglitele — ülaltoodud `o17ekb`/`t9zd42`/`04na2fu4`
  juhtumid fikstuurina (lehtede tekst lõigetena), sh `t9zd42` auk (lk 4 = `[247v]`, mitte
  `[260v]`), paginatsiooni lahknevad naabrid, laotuspilt, parsimatu `<fw>` (ei tuletu ise
  ega naabrile: `10` → `Fol. 3a`), skeemita teos (viidet pole), `pagination`-teos ainult
  `<sig>`-iga (viidet pole), rooma paginatsioon, `<sig>C</sig>`, tühikuta signatuurid.
  Kontrollitud vahemik: `10r,10v,25r,25v` → kaks aadressilõiku; `iv`, tühi, `6` → tühi
  jääb `?`; eelmäng → põhiosa (`xiv → 1`); konvoluudi taaskäivitus (`40 → 1`); `1` ees
  olev tühi leht (kandidaat 0 → `?`); signatuuri tüvevahetus `A4v → B1r` = järglane;
  struktureeritud kuju: ühe lehe lõik vs `?`-lõik eristuvad.
- Route: `part_addresses` + `page_numbering` vastuses; ligipääsuta 403 nagu enne.
- `page_numbering` valideerimine `/update-work-metadata`-s.
- `WorkPartsPanel` komponenditest (jsdom-päis) — viide kuvatakse; ilma viiteta sulgusid pole.
- MCP: `test_parts`-is `address` väli.
- i18n paarsus (`localeParity`, `translationKeysResolve`).

## Teostuse järel

- ADR 0070: punkt 7 märkida „v1 = naabertuletus (spekk 2), täisloendus edasi lükatud";
  lahtistest küsimustest suletuks: recto kuva (`10r`), mitme numeratsiooni eelistus
  (paginatsioon > signatuur teose tasemel), kasutuskoht (sisukord + MCP).
- ADR 0070 p. 7 „loendus … kuni osa piirini" ei kehti v1 naabertuletusele: naaber on
  teose, mitte osa tasemel (`47w6yr` lk 22 ← lk 21). Märkida ADR-i.
- `o17ekb` skeemiks `foliation` (admin, `MetadataModal` kaudu).

## Ehitajale jäetud

- Struktureeritud aadressi täpne JSON-kuju (piirangutega ülal).
- Kas route loeb tekstid otse või kasutab olemasolevat lehe lugemise abifunktsiooni.
- Sisukorra viite täpne paigutus ja stiil olemasolevas reas.
