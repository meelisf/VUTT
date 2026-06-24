# Aasta-väljade ühendamine üheks sisendiks

**Kuupäev:** 2026-06-24
**Issue seos:** sõltub #31 (parse_year_range parandused)
**Staatus:** disain kinnitatud, ootab implementatsiooniplaani

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
`year`-sisend eemaldatakse UI-st. Numbrilised väljad (`year`, `year_start`,
`year_end`) **tuletatakse** sisendist. Olemasolevad andmed jäävad muutmata,
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
| `"XVII saj"` (ei parsi) | 0 | `"XVII saj"` |

**Reegel:** `/^\d{1,4}$/` → puhas number, `year_display=""`. Muidu → `year_display=raw`,
`year =` keskpaik `(start+end)//2` funktsioonist `parseYearDisplayRange(null, raw)`,
või `0` kui ei parsi.

**Järjepidevus:** sajand käsitletakse oma vahemikuna ja `year` tuletatakse sama
reegliga nagu iga vahemik. "17. saj" = (1601, 1700) → keskpaik 1650, identne
sisendiga "1601–1700". Keskpaik säilitab ka `meili_doc.py:524` praeguse käitumise,
nii et sortimine ei muutu.

## Faseering

Esialgne "UI nüüd + skeemikustutus hiljem" plaan **lahustub**: kuna `year` jääb
legitiimseks salvestuseks puhaste aastate jaoks, eraldi skeemikustutuse faasi pole
vaja. Jääb kaks faasi:

### Phase 0 — parser (#31), eeltingimus

`parse_year_range` saab numbrilise `year`-i ainsaks tuleallikaks, seega #31 vead
tuleb parandada ENNE, et servajuhud ei korrumpeeriks tuletatud `year`-it. Mõlemas
peeglis (`server/utils.py` + `src/utils/yearDisplayUtils.ts`):

1. **Tagurpidi vahemik:** `(years[0], years[-1])` → `(min(years), max(years))`.
   "1690-1670" → (1670, 1690).
2. **Sajandivahemik:** uus muster `^(\d{1,2})\.?\s*[-–]\s*(\d{1,2})\.?\s*saj`
   → `((N-1)*100+1, M*100)`. "17.-19. saj" → (1601, 1900).
3. Uuenda lukustatud testid `test_peatatud_reverse_vahemik_on_sortimata` ja
   `test_peatatud_sajandite_vahemik_tagastab_none` (`tests/test_year_range.py`) +
   `src/utils/__tests__/yearDisplayUtils.test.ts`, et nad kinnitaksid uut käitumist.

### Phase 1 — üks sisendväli + tuletamine + validatsioon

**Tuletamisfunktsioon.** Uus puhas funktsioon `deriveYearFields(raw): { year, year_display }`
failis `src/utils/yearDisplayUtils.ts`, kasutab olemasolevat `parseYearDisplayRange`-i.

**Kutsumiskoht.** `buildMetadataPayload` (`src/utils/buildMetadataPayload.ts`) — üks
autoriteetne, juba testitud puhas funktsioon. `MetadataFormData` väli
`year: number; year_display: string` → asendub ühe `yearInput: string`-iga; payloadi
ehitamisel kutsutakse `deriveYearFields(yearInput)`.

**UI muudatused:**
- `src/components/MetadataModal.tsx` — eemalda numbriline `year`-input, jäta üks
  tekstilahter. Eeltäitmine redigeerimisel: `year_display || String(year) || ''`.
  Placeholder nt `"1680, ca. 1680, 1670–1690, 17. saj"`.
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
