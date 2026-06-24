# Aasta-väljade ühendamine üheks sisendiks

**Kuupäev:** 2026-06-24
**Issue seos:** Phase 0 = #31 (parse_year_range parandused) — ✅ tehtud (commit 0f12cae)
**Staatus:** disain kinnitatud, Phase 0 valmis, ootab Phase 1 implementatsiooniplaani

## Probleem

Teose dateering on praegu kasutaja jaoks **kaks eraldi sisendlahtrit**:
- `year` (number) — käsitsi sisestatav, kasutatakse sordiks/filtriks/seosteks
- `year_display` (string) — käsitsi sisestatav kuva ("ca. 1680", "1670–1690", "17. saj")

Nende eraldi käsitsi hoidmine ei anna sisulist väärtust: parsimisloogika
(`parse_year_range`) oskab numbrilise aasta juba kuvastringist tuletada. Tekib
"kumba lahtrit ma täidan?" segadus, mida reedab koodis olev fallback-jada
(`work?.year || page.year || page.aasta`).

## Eesmärk

Kasutajale jääb **üks nähtav tekstilahter** (praegune `year_display`). Numbriline
`year`-sisend eemaldatakse UI-st. `year` (number) **tuletatakse sisendist
salvestamisel**. `year_start`/`year_end` **tuletatakse endiselt backend'is
indekseerimisel** (`meili_doc.py`, muutmata) ega ole `_metadata.json`/payloadi
väljad — neid see disain ei puuduta. Olemasolevad andmed jäävad muutmata,
migratsiooni ega reindeksit ei vajata.

## Andmemudel — "tark sisend, duaalne salvestus"

`_metadata.json` säilitab MÕLEMAD väljad (`year` number + `year_display` string),
aga ainult `year_display`-stiilis sisend on **autoriseeritav**; `year` tuletatakse
salvestamisel. See hoiab kõik backend-lugemiskohad muutmatuna (`year` on endiselt JSON-is).

Tuletamise reegel sisendstringist `raw`:

| Sisend | year | year_display |
|--------|------|--------------|
| `"1680"` (puhas number) | 1680 | `""` |
| `"ca. 1680"` | 1680 | `"ca. 1680"` |
| `"1670–1690"` | 1680 (keskpaik) | `"1670–1690"` |
| `"17. saj"` | 1650 (keskpaik) | `"17. saj"` |
| `"1601–1700"` | 1650 (keskpaik) | `"1601–1700"` |
| `""` (tühi) | 0 | `""` |
| `"XVII saj"` (ei parsi, **uus** väärtus) | 0 | `"XVII saj"` |
| `"XVII saj"` (ei parsi, **muutmata** + olemasolev `year=1650`) | 1650 (säilitatud) | `"XVII saj"` |

**Funktsiooni signatuur:**
```ts
deriveYearFields(
  raw: string,
  existing?: { year?: number; year_display?: string },
): { year: number; year_display: string }
```

**Reegel** (sisend alati `value = raw.trim()` enne regex'i ja salvestust):
1. `value === ""` → `{ year: 0, year_display: "" }`
2. `/^\d{1,4}$/.test(value)` → puhas number: `{ year: parseInt(value), year_display: "" }`
3. parsib (`parseYearDisplayRange(null, value) !== null`) → `{ year: (start+end)>>1, year_display: value }`
4. **ei parsi, AGA `value === existing?.year_display?.trim()` ja `existing.year` olemas**
   → säilita vana: `{ year: existing.year, year_display: value }`
5. ei parsi ja uus/muudetud väärtus → `{ year: 0, year_display: value }`

**Põhjus reeglile 4 (vaikse rikkumise vastu):** olemasolevas kirjes võib olla käsitsi
korras `year` parssimata `year_display` kõrval (nt `{ year: 1650, year_display: "XVII saj" }`).
Kui kasutaja redigeerib mõnda muud välja ega puuduta dateeringut, EI tohi seda `year`-it
vaikselt nullida. Säilitamine kehtib AINULT kui kuvastring on muutmata — kui kasutaja
muudab stringi, tuletatakse uuesti (reegel 5).

**Järjepidevus:** sajand käsitletakse oma vahemikuna ja `year` tuletatakse sama
reegliga nagu iga vahemik. "17. saj" = (1601, 1700) → keskpaik 1650, identne
sisendiga "1601–1700". Keskpaik säilitab ka `meili_doc.py:524` praeguse käitumise,
nii et sortimine ei muutu.

## Faseering

Esialgne "UI nüüd + skeemikustutus hiljem" plaan **lahustub**: kuna `year` jääb
legitiimseks salvestuseks puhaste aastate jaoks, eraldi skeemikustutuse faasi pole
vaja. Jääb kaks faasi:

### Phase 0 — parser (#31), eeltingimus — ✅ TEHTUD (commit 0f12cae)

`parse_year_range` saab numbrilise `year`-i ainsaks tuleallikaks, seega #31 vead
tuli parandada ENNE, et servajuhud ei korrumpeeriks tuletatud `year`-it. Tehtud
mõlemas peeglis (`server/utils.py` + `src/utils/yearDisplayUtils.ts`):

1. **Tagurpidi vahemik:** `(years[0], years[-1])` → `(min(years), max(years))`.
   "1690-1670" → (1670, 1690). ✅
2. **Sajandivahemik:** uus muster (`_CENTURY_RANGE_RE`)
   → `((N-1)*100+1, M*100)`. "17.-19. saj" → (1601, 1900). ✅
3. Lukustatud testid `test_peatatud_*` (`tests/test_year_range.py`) +
   `src/utils/__tests__/yearDisplayUtils.test.ts` uuendatud uut käitumist kinnitama;
   +16 testi, kõik rohelised. ✅
4. Serveri andmekontroll: 0 sajandi-mustrit / 0 reverse-vahemikku tootmises
   (kinnitab, et tegu robustsus-parandusega, mitte olemasoleva data parandusega). ✅

### Phase 1 — üks sisendväli + tuletamine + validatsioon

**Tuletamisfunktsioon.** Uus puhas funktsioon `deriveYearFields(raw, existing?)` (vt
signatuur ja reeglid ülal) failis `src/utils/yearDisplayUtils.ts`, kasutab olemasolevat
`parseYearDisplayRange`-i.

**Kutsumiskoht.** `buildMetadataPayload` (`src/utils/buildMetadataPayload.ts`) — üks
autoriteetne, juba testitud puhas funktsioon. `MetadataFormData` väli
`year: number; year_display: string` → asendub ühe `yearInput: string`-iga. Payloadi
ehitamisel kutsutakse `deriveYearFields(yearInput, existing)`, kus `existing` on vormi
avamisel laetud algsed `{ year, year_display }` (reegel 4 säilitamiseks);
`buildMetadataPayload` saab `existing` lisaparameetrina.

**UI muudatused:**
- `src/components/MetadataModal.tsx` — eemalda numbriline `year`-input, jäta üks
  tekstilahter. Eeltäitmine redigeerimisel: `year_display || (year ? String(year) : '')`
  (väldib `year=0` korral lahtrisse `"0"` tekkimist). Säilita vormi avamisel algsed
  `year`/`year_display` (vaja reegel 4 jaoks). Placeholder nt
  `"1680, ca. 1680, 1670–1690, 17. saj"`.
- `src/components/UploadMetaForm.tsx` — sama (üleslaadimise viisard).

**Live-eelvaade + pehme validatsioon.** Lahtri all üks komponent, kolm olekut
(`parseYearDisplayRange(null, raw)` põhjal):
- **parsib** → neutraalne: "→ 1601–1700" (või "→ 1680" kui start==end)
- **ei parsi** (mittetühi, tagastab null) → merevaik hoiatus: "⚠ Ei oska aastat
  tuletada — formaadid: 1680, ca. 1680, 1670–1690, 17. saj"
- **tühi** → vaikne (kuupäevata teos on legitiimne)

Hoiatus on **pehme — EI blokeeri salvestamist.** Põhjus: ajaloomaterjalis on
legitiimseid formaate, mida parser ei taba ("s.a.", "post 1700", "enne 1650", rooma
numbrid). String kuvatakse niikuinii toorelt; parssimata teos lihtsalt ei ilmu
aastafiltris (year=0).

## Mis EI muutu

- Backend salvestuskiht ja kõik lugemiskohad (`work_relations_ops.py`, `git_ops.py`,
  prosopograafia) — `year` on endiselt `_metadata.json`-is.
- `meili_doc.py` keskpaiga-fallback (rida 524) jääb kaitseks.
- `formatYearDisplay` (kuvaloogika `yearDisplayUtils.ts`-s) töötab muutmata.
- Olemasolevad `_metadata.json` failid; reindeks pole vajalik.

## Testid

- **Phase 0:** uuendatud `tests/test_year_range.py` (`test_peatatud_*` kinnitavad uut
  käitumist) + `src/utils/__tests__/yearDisplayUtils.test.ts` (reverse + sajandivahemik).
- **Phase 1:** `deriveYearFields` unit-testid (puhas number / ca. / vahemik / sajand /
  tühi / parssimata prügi); `src/utils/__tests__/buildMetadataPayload.test.ts` laiendus
  (yearInput → year + year_display).

## Riskid ja kaalutlused

- **Parseri peegelduvus.** `parse_year_range` (Python) ja `parseYearDisplayRange` (TS)
  peavad jääma samaväärseks. Phase 0 muudatused tuleb teha MÕLEMASSE; testid mõlemal pool.
- **Upload-tee.** `UploadMetaForm` läbib sama `buildMetadataPayload`/`deriveYearFields`
  loogika; backend `import_as_work` salvestab payloadis tulnud `year`+`year_display`.
- **Andmemuutust pole** — olemasolevad teosed jäävad oma `year`/`year_display`
  väärtustega; vaid uued redigeerimised läbivad ühtse välja.
- **Autoriteetsuse piir (LAHTINE OTSUS).** Kui derivatsioon on ainult frontend'i
  `buildMetadataPayload`-s, kehtib invariant (sh reegel 4 vaikse rikkumise vastu) ainult
  **UI kaudu salvestamisel**. API otsekutse võiks saata vastuolulise `year` + `year_display`.
  Praktikas on metaandmete kirjutaja ainult admin/editor-UI. Kaks varianti:
  **(A)** jätta frontend-only ja sõnastada invariant "UI kaudu salvestamisel"; või
  **(B)** lisada sama derivatsioon/kontroll backend'i ainsasse lehtrisse
  `save_work_metadata` (`metadata_ops.py`), kus on ligi ka olemasolev `_metadata.json`
  (reegel 4 robustsem) — tõeline invariant, aga lisab kolmanda peegli (Python).
