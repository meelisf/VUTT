# Isiku märksõnade soovitused — teostusplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Isikule märksõna lisades pakutakse esmalt neid märksõnu, mis on teistel isikutel juba kasutusel — sagedasemad eespool.

**Architecture:** Andmed tulevad olemasolevast `GET /prosopography/facets` → `tags` väljast (PR #206). Puhas teisendusfunktsioon `src/prosopography/utils/`-is, React-hook `src/prosopography/hooks/`-is (uus kaust), kaks tarbijat. Backendi ega jagatud `EntityPicker`-it ei puutu.

**Tech Stack:** React 19 + TypeScript, vitest, olemasolev `prosopographyService.getPersonFacets`.

**Spec:** `docs/superpowers/specs/2026-07-31-isiku-marksona-soovitused-design.md`

## Global Constraints

- **Kommentaarid koodis on eesti keeles.**
- **Uusi tõlkevõtmeid ei lisandu** — soovitused kasutavad `EntityPicker`-i olemasolevat kuva.
- **`EntityPicker.tsx`-i EI muudeta** — ei ordering'u, ei kirjeldusrea, ei tüüpide pärast.
- **Backendi EI muudeta** — uut endpointi ega serveripoolset vahemälu ei tule.
- **Sagedus-järjestust ei sordita ümber** — facet on juba `(-count, label)` järjestuses ja `Array.prototype.sort` `EntityPicker`-is on stabiilne, seega järjestus säilib.
- **Testid:** `npm run typecheck` ja `npm test`. Komponenditeste ei kirjutata — projektis pole `@testing-library`-t ega jsdom'i.
- **Vahemälu TTL:** 5 minutit (`300_000` ms).

## File Structure

| Fail | Roll | Tegevus |
|------|------|---------|
| `src/prosopography/utils/tagSuggestions.ts` | puhas teisendus facet → `SuggestionItem[]` | **loo** |
| `src/prosopography/utils/__tests__/tagSuggestions.test.ts` | vitest | **loo** |
| `src/prosopography/hooks/usePersonTagSuggestions.ts` | päring + vahemälu + `enabled` värav | **loo** (uus `hooks/` kaust) |
| `src/prosopography/components/personForm/TagsList.tsx` | uus `suggestions` prop | muuda |
| `src/prosopography/pages/PersonEditPage.tsx` | hook + prop `TagsList`-ile | muuda |
| `src/prosopography/pages/PersonDetailPage.tsx` | hook + `localSuggestions` inline-pickerile | muuda |

**Kõrvalekalle spetsist (teadlik):** spets ütles, et puhas funktsioon eksporditakse hooki
moodulist. Panen selle hoopis `src/prosopography/utils/`-i, kus on juba `estonianName.ts`
ja `mapYear.ts` koos `__tests__/` kaustaga. Nii ei impordi puhas test Reacti ja fail
jääb ühe vastutusega. Käitumine on identne.

**Ülesannete järjekord:** 1 (puhas funktsioon) → 2 (hook) → 3 ja 4 (tarbijad) → 5 (kontroll).

---

### Task 1: Puhas teisendusfunktsioon

**Files:**
- Create: `src/prosopography/utils/tagSuggestions.ts`
- Test: `src/prosopography/utils/__tests__/tagSuggestions.test.ts`

**Interfaces:**
- Produces: `export interface TagFacetItem { value: string; label: string; labels?: Record<string, string> | null; count: number }`
- Produces: `export interface TagSuggestion { label: string; id: string | null; labels?: Record<string, string> | null }` — kattub täpselt `EntityPicker`-i `SuggestionItem`-iga (`EntityPicker.tsx:14-18`)
- Produces: `export function mapTagFacetsToSuggestions(facetTags: TagFacetItem[] | null | undefined, lang: string): TagSuggestion[]`

- [ ] **Step 1: Kirjuta kukkuv test**

Loo `src/prosopography/utils/__tests__/tagSuggestions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mapTagFacetsToSuggestions } from '../tagSuggestions';

const pietism = {
  value: 'Q193664',
  label: 'pietism',
  labels: { et: 'pietism', en: 'Pietism', de: 'Pietismus' },
  count: 3,
};
const kantsler = {
  value: 'Q373085',
  label: 'kantsler',
  labels: { et: 'kantsler', en: 'chancellor' },
  count: 7,
};

describe('mapTagFacetsToSuggestions', () => {
  it('eelistab aktiivse keele labelit', () => {
    expect(mapTagFacetsToSuggestions([pietism], 'en')[0].label).toBe('Pietism');
    expect(mapTagFacetsToSuggestions([pietism], 'et')[0].label).toBe('pietism');
  });

  it('langeb tagasi et → en → label, kui keelt pole', () => {
    expect(mapTagFacetsToSuggestions([pietism], 'fr')[0].label).toBe('pietism');
    const onlyEn = { value: 'Q1', label: 'raw', labels: { en: 'printer' }, count: 1 };
    expect(mapTagFacetsToSuggestions([onlyEn], 'fr')[0].label).toBe('printer');
    const noLabels = { value: 'Q2', label: 'raw', labels: null, count: 1 };
    expect(mapTagFacetsToSuggestions([noLabels], 'fr')[0].label).toBe('raw');
  });

  it('säilitab sisendjärjestuse (facet on juba sageduse järgi)', () => {
    const result = mapTagFacetsToSuggestions([kantsler, pietism], 'et');
    expect(result.map(r => r.label)).toEqual(['kantsler', 'pietism']);
  });

  it('Q-kood läheb id-ks', () => {
    expect(mapTagFacetsToSuggestions([pietism], 'et')[0].id).toBe('Q193664');
  });

  it('Q-koodita väärtus annab id: null', () => {
    const bare = { value: 'kantsler', label: 'kantsler', labels: null, count: 1 };
    expect(mapTagFacetsToSuggestions([bare], 'et')[0].id).toBeNull();
  });

  it('annab labels muutmata edasi', () => {
    expect(mapTagFacetsToSuggestions([pietism], 'et')[0].labels).toEqual(pietism.labels);
  });

  it('talub tühja ja puuduvat sisendit', () => {
    expect(mapTagFacetsToSuggestions([], 'et')).toEqual([]);
    expect(mapTagFacetsToSuggestions(null, 'et')).toEqual([]);
    expect(mapTagFacetsToSuggestions(undefined, 'et')).toEqual([]);
  });

  it('jätab labelita kirjed vahele', () => {
    const broken = [
      { value: '', label: '', labels: null, count: 1 },
      { value: 'Q9', label: '   ', labels: null, count: 1 },
      pietism,
    ];
    expect(mapTagFacetsToSuggestions(broken as any, 'et')).toHaveLength(1);
  });

  it('kasutab ainult keele baasosa (en-GB → en)', () => {
    expect(mapTagFacetsToSuggestions([pietism], 'en-GB')[0].label).toBe('Pietism');
  });
});
```

- [ ] **Step 2: Käivita, veendu et kukub**

Run: `npm test -- tagSuggestions`
Expected: FAIL — `Cannot find module '../tagSuggestions'`

- [ ] **Step 3: Kirjuta teisendus**

Loo `src/prosopography/utils/tagSuggestions.ts`:

```ts
import { isQCode } from '../../utils/qcodeUtils';

/** Üks kirje `/prosopography/facets` vastuse `tags` väljast. */
export interface TagFacetItem {
  value: string;
  label: string;
  labels?: Record<string, string> | null;
  count: number;
}

/** Kattub EntityPicker'i SuggestionItem-iga (EntityPicker.tsx:14-18). */
export interface TagSuggestion {
  label: string;
  id: string | null;
  labels?: Record<string, string> | null;
}

/**
 * Teisendab märksõna-facetid EntityPicker'i kohalikeks soovitusteks.
 *
 * Järjestust EI muudeta — facet tuleb juba sageduse järjekorras ja
 * EntityPicker'i sort on stabiilne, seega sagedasemad jäävad ettepoole.
 */
export function mapTagFacetsToSuggestions(
  facetTags: TagFacetItem[] | null | undefined,
  lang: string,
): TagSuggestion[] {
  if (!facetTags?.length) return [];
  const baseLang = (lang || 'et').split('-')[0];
  const result: TagSuggestion[] = [];
  for (const item of facetTags) {
    if (!item) continue;
    const labels = item.labels ?? null;
    const label = (
      labels?.[baseLang] ?? labels?.['et'] ?? labels?.['en'] ?? item.label ?? ''
    ).trim();
    if (!label) continue;
    // Q-koodita märksõnal on facetis `value` = label, mis ei ole identifikaator.
    result.push({ label, id: isQCode(item.value) ? item.value : null, labels });
  }
  return result;
}
```

- [ ] **Step 4: Käivita test**

Run: `npm test -- tagSuggestions`
Expected: PASS (9 testi)

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0

- [ ] **Step 6: Commit**

```bash
git add src/prosopography/utils/tagSuggestions.ts src/prosopography/utils/__tests__/tagSuggestions.test.ts
git commit -m "feat(prosopo): märksõna-facetide teisendus soovitusteks"
```

---

### Task 2: Hook koos vahemälu ja väravaga

**Files:**
- Create: `src/prosopography/hooks/usePersonTagSuggestions.ts` (uus `hooks/` kaust)

**Interfaces:**
- Consumes: `mapTagFacetsToSuggestions`, `TagFacetItem`, `TagSuggestion` (Task 1)
- Consumes: `getPersonFacets(params?, token?)` (`src/prosopography/services/prosopographyService.ts`) — tagastab `{ origin_groups, institutions, tags, occupations }`
- Produces: `export function usePersonTagSuggestions(lang: string, enabled: boolean, token?: string): TagSuggestion[]`

- [ ] **Step 1: Kirjuta hook**

Loo `src/prosopography/hooks/usePersonTagSuggestions.ts`:

```ts
import { useEffect, useMemo, useState } from 'react';
import { getPersonFacets } from '../services/prosopographyService';
import { mapTagFacetsToSuggestions, type TagFacetItem, type TagSuggestion } from '../utils/tagSuggestions';

const CACHE_TTL_MS = 300_000; // 5 min

// Mooduli-tasemel vahemälu: isikult isikule liikudes ei päri uuesti.
// get_person_facets skaneerib serveris ~2000 indeksikirjet iga kutse peale.
// Hoiame TOORE facet-vastuse — see on keelest sõltumatu, teisendus käib eraldi.
let cachedFacetTags: TagFacetItem[] | null = null;
let cachedAt = 0;

/**
 * Isikutel juba kasutusel olevad märksõnad EntityPicker'i kohalike
 * soovitustena, sagedasemad eespool.
 *
 * @param lang   aktiivne UI keel (nt "et", "en-GB")
 * @param enabled kas päring üldse teha — anna `canEdit`, muidu käivitaks
 *                iga anonüümne külastaja serveris täisskaneeringu
 * @param token  autentimistoken (valikuline, endpoint lubab ka anonüümset)
 */
export function usePersonTagSuggestions(lang: string, enabled: boolean, token?: string): TagSuggestion[] {
  const [facetTags, setFacetTags] = useState<TagFacetItem[]>(() =>
    cachedFacetTags && Date.now() - cachedAt < CACHE_TTL_MS ? cachedFacetTags : [],
  );

  useEffect(() => {
    if (!enabled) return;
    if (cachedFacetTags && Date.now() - cachedAt < CACHE_TTL_MS) {
      setFacetTags(cachedFacetTags);
      return;
    }
    let cancelled = false;
    getPersonFacets(undefined, token)
      .then(data => {
        const items = (data.tags || []) as TagFacetItem[];
        cachedFacetTags = items;
        cachedAt = Date.now();
        if (!cancelled) setFacetTags(items);
      })
      // Soovitused on abivahend, mitte blokeerija — vea korral jääb loend tühjaks.
      .catch(() => { if (!cancelled) setFacetTags([]); });
    return () => { cancelled = true; };
  }, [enabled, token]);

  return useMemo(() => mapTagFacetsToSuggestions(facetTags, lang), [facetTags, lang]);
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exit 0

**NB:** kui typecheck kaebab, et `data.tags` puudub, siis `getPersonFacets` tagastustüüpi
ei ole veel `tags` välja — see lisati PR #206-s (`prosopographyService.ts`, `getPersonFacets`
tagastustüüp). Kontrolli, et haru on `main`-ist hargnenud pärast #206 merge'i.

- [ ] **Step 3: Commit**

```bash
git add src/prosopography/hooks/usePersonTagSuggestions.ts
git commit -m "feat(prosopo): usePersonTagSuggestions hook vahemälu ja väravaga"
```

---

### Task 3: TagsList ja PersonEditPage

**Files:**
- Modify: `src/prosopography/components/personForm/TagsList.tsx` (props + `EntityPicker` kutse)
- Modify: `src/prosopography/pages/PersonEditPage.tsx:786` (`TagsList` kutse) ja hooki lisamine

**Interfaces:**
- Consumes: `usePersonTagSuggestions(lang, enabled, token)` (Task 2), `TagSuggestion` (Task 1)
- Produces: `TagsList` uus valikuline prop `suggestions?: TagSuggestion[]`

- [ ] **Step 1: Lisa `TagsList`-ile prop**

`TagsList.tsx` — lisa import ja laienda propside tüüpi:

```tsx
import type { TagSuggestion } from '../../utils/tagSuggestions';

const TagsList: React.FC<{
  tags: TagDraft[];
  onChange: (v: TagDraft[]) => void;
  suggestions?: TagSuggestion[];
}> = ({ tags, onChange, suggestions }) => {
```

- [ ] **Step 2: Anna `EntityPicker`-ile edasi**

`TagsList.tsx` — `<EntityPicker …>` kutsele lisa üks rida:

```tsx
        localSuggestions={suggestions}
```

Täielik kutse pärast muudatust:

```tsx
      <EntityPicker
        placeholder={t('tagsList.placeholder')}
        type="topic"
        value={pickerValue}
        onChange={v => { if (v) add(v); else setPickerValue(null); }}
        lang="et"
        localSuggestions={suggestions}
      />
```

- [ ] **Step 3: Ühenda `PersonEditPage`-is**

Lisa import:

```tsx
import { usePersonTagSuggestions } from '../hooks/usePersonTagSuggestions';
```

Lisa hooki kutse **pärast rida 79** (`const canEdit = isAtLeast(user?.role, 'editor');`).
`lang` on real 70 ja `authToken` tuleb real 38 olevast `const { user, authToken } = useUser();`
— mõlemad on selleks hetkeks defineeritud:

```tsx
  // Isikutel juba kasutusel olevad märksõnad — soovitused TagsList'ile.
  const tagSuggestions = usePersonTagSuggestions(lang, canEdit, authToken ?? undefined);
```

Ja `TagsList` kutse real ~786:

```tsx
          <TagsList tags={draft.tags} onChange={v => set({ tags: v })} suggestions={tagSuggestions} />
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: exit 0

- [ ] **Step 5: Commit**

```bash
git add src/prosopography/components/personForm/TagsList.tsx src/prosopography/pages/PersonEditPage.tsx
git commit -m "feat(prosopo): TagsList pakub juba kasutusel olevaid märksõnu"
```

---

### Task 4: PersonDetailPage inline-picker

**Files:**
- Modify: `src/prosopography/pages/PersonDetailPage.tsx:628-645` (inline `EntityPicker` `canEdit`-harus)

**Interfaces:**
- Consumes: `usePersonTagSuggestions(lang, enabled, token)` (Task 2)

- [ ] **Step 1: Lisa import ja hooki kutse**

Lisa import:

```tsx
import { usePersonTagSuggestions } from '../hooks/usePersonTagSuggestions';
```

Lisa hooki kutse **pärast rida 254** (`const canEdit = isAtLeast(user?.role, 'editor');`).
`lang` on real 240 ja `token` real 253 — mõlemad on selleks hetkeks defineeritud.
`tagsSaving` oleku juurde (rida 251) seda panna EI TOHI: `canEdit` ei ole seal veel
defineeritud ja tekiks TDZ-viga.

```tsx
  // Isikutel juba kasutusel olevad märksõnad — soovitused märksõna-pickerile.
  const tagSuggestions = usePersonTagSuggestions(lang, canEdit, token);
```

**NB:** hook peab olema komponendi tipptasemel, MITTE `canEdit &&` tingimuse sees —
Reacti hookide reegel. Värav käib `enabled` parameetri kaudu.

- [ ] **Step 2: Anna pickerile edasi**

Inline-`EntityPicker` kutsele (`canEdit`-haru) lisa üks rida:

```tsx
                    localSuggestions={tagSuggestions}
```

Täielik kutse pärast muudatust:

```tsx
                  <EntityPicker
                    placeholder={t('tagsList.add', 'Lisa märksõna…')}
                    type="topic"
                    value={null}
                    onChange={async v => {
                      if (!v?.label?.trim()) return;
                      const newTag = { label: v.label, ...(v.id ? { id: v.id } : {}), ...(v.labels ? { labels: v.labels } : {}) };
                      const newTags = [...(person.tags ?? []), newTag];
                      setPerson({ ...person, tags: newTags });
                      setTagsSaving(true);
                      try { await updatePerson(person.id, { tags: newTags, updated_at: person.updated_at } as any, token); }
                      catch { setPerson({ ...person }); }
                      finally { setTagsSaving(false); }
                    }}
                    lang={lang}
                    localSuggestions={tagSuggestions}
                  />
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exit 0

- [ ] **Step 4: Commit**

```bash
git add src/prosopography/pages/PersonDetailPage.tsx
git commit -m "feat(prosopo): detailvaate märksõna-picker pakub kasutusel olevaid"
```

---

### Task 5: Lõppkontroll, käsitsi kontroll ja PR

**Files:** puuduvad (ainult kontroll)

- [ ] **Step 1: Testid ja typecheck**

Run: `npm run typecheck && npm test`
Expected: exit 0, kõik testid PASS

- [ ] **Step 2: Lint**

Run: `npx eslint . --max-warnings 56`
Expected: exit 0

**NB:** kui uus hoiatus tekib `react-hooks/exhaustive-deps` reeglist `usePersonTagSuggestions`
sisemise `useEffect`-i pärast, kontrolli deps-listi (`[enabled, token]`) — `cachedFacetTags`
ja `cachedAt` on mooduli-tasemel muutujad, mitte reaktiivsed sõltuvused, ja neid deps-listi
lisada EI tohi.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: exit 0

- [ ] **Step 4: Käsitsi kontroll**

```bash
npm run dev
```

Ava toimetaja rollis isiku redigeerimisvaade ja detailvaade. Kontrolli:

1. märksõnavälja fookustades / paar tähte tippides ilmuvad **merevaigukollased**
   soovitused (`Database` ikoon) enne Wikidata tulemusi;
2. sagedasem märksõna on eespool (praegustes andmetes: `kantsler` 3 kaardil);
3. juba lisatud märksõna ei tule soovitusena uuesti;
4. soovituse valimine salvestab Q-koodi ja mitmekeelsed labelid — kontrolli, et
   detailvaates kuvatakse silti ka inglise keeles õigesti;
5. **anonüümse kasutajana** isikulehel ei tehta `/prosopography/facets` päringut
   (brauseri Network-vahekaart) — `enabled` värav peab hoidma.

**NB:** kohalik dev-backend peab olema kättesaadav (`vite.config.ts:6`, `DEV_BACKEND`).
Kui ei ole, tuleb see kontroll teha pärast deploy'd tootmises.

- [ ] **Step 5: Ava PR**

```bash
git push -u origin feat/prosopo-marksona-soovitused
gh pr create --base main --title "feat(prosopo): märksõna-soovitused juba kasutusel olevatest" --body "$(cat <<'EOF'
Isikule märksõna lisades mindi otse Wikidatasse, ilma et oleks näidatud
teistel isikutel juba kasutatud märksõnu. Tulemuseks ebasüsteemne sõnavara.

Nüüd pakub `EntityPicker` esmalt kasutusel olevaid märksõnu (merevaigukollane,
`Database` ikoon) — sagedasemad eespool.

- andmed olemasolevast `GET /prosopography/facets` → `tags` (PR #206)
- puhas teisendus `src/prosopography/utils/tagSuggestions.ts` + 9 vitesti
- hook `usePersonTagSuggestions` — 5 min vahemälu, `enabled` värav (`canEdit`),
  et anonüümne külastaja ei käivitaks igal isikulehel täisskaneeringut
- kaks tarbijat: `TagsList` (redigeerimisvaade) ja detailvaate inline-picker

Backendi ega jagatud `EntityPicker`-it ei muudetud.

Spec: `docs/superpowers/specs/2026-07-31-isiku-marksona-soovitused-design.md`
Plaan: `docs/superpowers/plans/2026-07-31-isiku-marksona-soovitused.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Deploy pärast merge'i**

Ainult frontend — backendis muudatusi ei ole:

```bash
npm run build && rsync -avz --delete dist/ vutt:~/VUTT/dist/
```
