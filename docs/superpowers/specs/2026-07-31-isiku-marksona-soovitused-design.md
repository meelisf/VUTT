# Isiku märksõnade soovitused juba kasutusel olevatest märksõnadest

**Kuupäev:** 2026-07-31
**Staatus:** kinnitatud, ootab teostusplaani

## Probleem

Isikule märksõna lisades (`TagsList` redigeerimisvaates, inline-`EntityPicker`
detailvaates) minnakse otse Wikidatasse. Kasutaja ei näe, milliseid märksõnu on
teistel isikutel juba kasutatud, ja valib seetõttu juhuslikke variante. Tulemuseks
on ebasüsteemne sõnavara.

Mujal süsteemis see muster **on olemas**: `EntityPicker` võtab `localSuggestions`
propi ja kuvab juba kasutusel olevad väärtused merevaigukollaselt (`bg-amber-50/60`,
`Database` ikoon — `EntityPicker.tsx:720-741`), enne Wikidata tulemusi. Ka
prosopograafias kasutatakse seda juba: `PersonEditPage` annab ameti-, seisuse- ja
kohapickeritele `localSuggestions={entityLabels}` (`labels.json`-ist).

**Märksõnad on ainus koht, kus seda ei tehta** — `PersonEditPage.tsx:786` renderdab
`<TagsList tags={draft.tags} onChange={…} />` ilma ühegi soovituseta, ja
`PersonDetailPage`-i inline-picker samuti.

## Lahendus

### Andmeallikas: olemasolev facet

`GET /prosopography/facets` → `tags` (lisatud PR #206) annab juba täpselt vajaliku:

```json
{ "value": "Q193664", "label": "pietism", "labels": {"et": "pietism", "en": "Pietism", …}, "count": 1 }
```

Iga isikutel kasutusel olev märksõna koos Q-koodi, mitmekeelsete labelite ja
kasutuskordade arvuga, **sagedus-järjestuses** (`-count`, siis label).

**Backendi ei muudeta. Uut endpointi ei looda.**

### Uus hook

`src/prosopography/hooks/usePersonTagSuggestions.ts` — uus `hooks/` kaust
(praegu on `components/`, `pages/`, `services/`, `utils/`).

**Puhas teisendus, eraldi eksporditud:**

```ts
mapTagFacetsToSuggestions(
  facetTags: { value: string; label: string; labels?: Record<string, string> | null; count: number }[],
  lang: string,
): { label: string; id: string | null; labels?: Record<string, string> | null }[]
```

Tagastustüüp on täpselt `EntityPicker`-i `SuggestionItem` (`EntityPicker.tsx:14-18`),
seega eraldi teisendust pickerile ei ole vaja.

- `label` = `labels[lang] ?? labels.et ?? labels.en ?? label` (kuvatav ja salvestatav);
- `id` = `value`, kui `isQCode(value)` (`src/utils/qcodeUtils.ts`), muidu `null` —
  Q-koodita märksõnal on facetis `value` = label, mis ei ole identifikaator;
- `labels` antakse muutmata edasi, et valitud märksõna säilitaks mitmekeelsuse;
- **järjestust ei muudeta** — facet on juba sageduse järgi järjestatud;
- vigased/tühjad kirjed jäetakse vahele.

**Hook ise:**

- pärib `getPersonFacets()` ja jooksutab tulemuse läbi `mapTagFacetsToSuggestions`;
- **mooduli-tasemel vahemälu, TTL 5 min** — isikult isikule liikudes ei päri uuesti.
  `get_person_facets` skaneerib iga kutse peale ~2072 indeksikirjet, seega see ei ole
  kosmeetika;
- võtab **`enabled` lipu ja ei päri üldse, kui see on `false`**. `PersonDetailPage`-i
  picker renderdub ainult `canEdit` korral; ilma liputa käivitaks iga anonüümne
  külastaja igal isikulehel täisskaneeringu;
- vea korral tagastab tühja loendi — soovitused on abivahend, mitte blokeerija.

### Tarbijad

| Fail | Muudatus |
|------|----------|
| `TagsList.tsx` | uus valikuline prop `suggestions`, edasi `EntityPicker`-i `localSuggestions`-ina |
| `PersonEditPage.tsx:786` | kutsub hooki (`enabled: canEdit`), annab `suggestions` `TagsList`-ile |
| `PersonDetailPage.tsx:619-640` | sama hook, `localSuggestions` `canEdit`-haru inline-pickerile |

### `EntityPicker`-it ei muudeta

Sagedus-järjestus säilib tasuta: komponent sordib kohalikke vasteid **ainult**
prefiksi-vaste järgi (`EntityPicker.tsx:249-253`) ja JS-i `Array.prototype.sort` on
stabiilne, seega kutsuja järjestus püsib ämbrite sees. Enim kasutatud märksõnad
jõuavad kolme nähtava soovituse hulka (`.slice(0, 3)`).

## Teadaolev piirang

Q-koodiga kohaliku soovituse valimine läheb ikkagi `EntityPicker`-i Wikidata-harusse:
tingimus real 395 on `result.isLocal && !/^Q\d+$/.test(result.id)`, seega Q-koodiga
kirje langeb `else`-harusse ja `getEntityLabels` tõmbab labelid Wikidatast.

**See ei ole regressioon** — teoste märksõnad käituvad täpselt nii juba praegu.
Soovitus juhib **valikut**, mitte ei väldi võrgupäringut. Süsteemsuse eesmärk täitub
sellest hoolimata; võrgupäringu vältimine oleks eraldi töö, mis puudutaks jagatud
komponenti.

## Testid

**Vitest** `mapTagFacetsToSuggestions`-ile:
- keele-eelistus: `labels[lang]` → `et` → `en` → `label`;
- sagedus-järjestus säilib (sisendjärjestust ei muudeta);
- Q-kood läheb `id`-ks; Q-koodita väärtus annab `id: null`;
- `labels` antakse muutmata edasi;
- tühi sisend ja vigased kirjed ei kukuta.

**Lisaks:** `npm run typecheck`.

**Komponenditeste ei kirjutata** — projektis ei ole `@testing-library`-t ega jsdom'i
ja ühtki `.test.tsx` faili ei eksisteeri. Pickeri käitumine kontrollitakse käsitsi.

## Mida teadlikult EI tehta

- **`EntityPicker`-i muutmine** — ei ordering'u, ei kirjeldusrea pärast.
- **Kasutuskordade arvu kuvamine** — järjestus kannab sama signaali ilma jagatud
  komponenti puutumata.
- **Teoste märksõnavara liitmine** (`/get-metadata-suggestions` → `tags`) — see
  endpoint nõuab editor-rolli ja toob sisse teose-tasandi sõnavara (nt "Loengukava"),
  mis isikule ei sobi.
- **`labels.json` kasutamine allikana** — hulk on liiga lai (ametid, kohad, seisused),
  see tekitaks müra, mitte süsteemsust.
- **Uus backend-endpoint või vahemälu serveris.**
