# Lehevahetuse fade skaneeringul — teostusplaan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lehe vahetusel teeb skaneering lühikese täieliku fade'i (välja 90 ms, sisse 160 ms), et eellaetud, seega hetkeline lehepööre oleks kasutajale nähtav ka väga sarnase paigutusega lehtede puhul.

**Architecture:** Kogu otsustusloogika läheb puhtasse funktsiooni `imageFadeStyle` failis `src/utils/imageFadeTransition.ts` (sama muster mis `src/utils/imageViewerGeometry.ts` sama komponendi kõrval). `src/components/ImageViewer.tsx` hoiab ainult olekut — üks boolean `dipDone`, mille `pageNum`-i effect nullib ja timer taastab — ja rakendab funktsiooni tulemuse `<img>`-i inline-stiilina. Ükski teine fail ei muutu.

**Tech Stack:** React 19 + TypeScript, Tailwind, Vite, vitest (node-keskkond, ainult puhaste funktsioonide testid — repos pole testing-libraryt ega jsdom-i).

**Spec:** `docs/superpowers/specs/2026-07-25-lehevahetuse-fade-design.md`

## Global Constraints

- **Invariant:** animatsioon on seotud `pageNum` muutusega, MITTE laadimisolekuga. Laadimisoleku külge seotud tagasiside kaob täpselt siis, kui eellaadimine töötab — st alati, kui seda vaja oleks.
- Koodikommentaarid **eesti keeles** (CLAUDE.md).
- Kestused on nimetatud konstandid `FADE_OUT_MS = 90` ja `FADE_IN_MS = 160`. Testid **impordivad** need konstandid, ei kõvakodeeri arve — kiirust timmitakse pärast praktikas ja timmimine ei tohi teste lõhkuda.
- Ei muudeta: `Workspace.tsx` `pageLoading` riba, `loadedSrc`/`isImageLoading`/`showImageSpinner` loogikat, `resetPanToTop`-i, suumi/panni `transform`-i, tõlkefaile (uusi stringe ei tule).
- ADR 0010: lehe vahetus ei monteeri editorit maha. See plaan ei puutu tekstipaani ega CodeMirrorit — kui mõni samm sunniks neid muutma, on midagi valesti.
- Väravad enne igat commit'i: `npm run typecheck` ja `npm test` (mõlemad peavad läbi minema; `npm run build` üksi EI typecheck'i).

---

### Task 1: Puhas fade-funktsioon

**Files:**
- Create: `src/utils/imageFadeTransition.ts`
- Test: `src/utils/__tests__/imageFadeTransition.test.ts`

**Interfaces:**
- Consumes: mitte midagi (esimene ülesanne).
- Produces:
  - `export const FADE_OUT_MS: number` (väärtus 90)
  - `export const FADE_IN_MS: number` (väärtus 160)
  - `export function imageFadeStyle(params: { imageLoading: boolean; dipDone: boolean; reducedMotion: boolean }): { opacity: 0 | 1; durationMs: number }`

- [ ] **Step 1: Kirjuta kukkuv test**

Loo `src/utils/__tests__/imageFadeTransition.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { imageFadeStyle, FADE_IN_MS, FADE_OUT_MS } from '../imageFadeTransition';

describe('imageFadeStyle', () => {
  it('eellaetud pilt dipi ajal on peidetud ja kasutab väljumise kestust', () => {
    expect(imageFadeStyle({ imageLoading: false, dipDone: false, reducedMotion: false })).toEqual({
      opacity: 0,
      durationMs: FADE_OUT_MS,
    });
  });

  it('eellaetud pilt pärast dipi tuleb nähtavale sissetuleku kestusega', () => {
    expect(imageFadeStyle({ imageLoading: false, dipDone: true, reducedMotion: false })).toEqual({
      opacity: 1,
      durationMs: FADE_IN_MS,
    });
  });

  it('aeglane pilt jääb peidetuks ka pärast dipi lõppu', () => {
    expect(imageFadeStyle({ imageLoading: true, dipDone: true, reducedMotion: false })).toEqual({
      opacity: 0,
      durationMs: FADE_OUT_MS,
    });
  });

  it('reduced-motion korral pole üleminekut ja nähtavus sõltub ainult laadimisest', () => {
    expect(imageFadeStyle({ imageLoading: false, dipDone: false, reducedMotion: true })).toEqual({
      opacity: 1,
      durationMs: 0,
    });
    expect(imageFadeStyle({ imageLoading: true, dipDone: true, reducedMotion: true })).toEqual({
      opacity: 0,
      durationMs: 0,
    });
  });

  it('kestused on mõistlikus vahemikus ka pärast timmimist', () => {
    // Kaitse hooletu timmimise vastu: liiga lühike ei ole märgatav, liiga pikk
    // võtab tagasi selle, milleks eellaadimine tehti.
    expect(FADE_OUT_MS).toBeGreaterThanOrEqual(40);
    expect(FADE_OUT_MS).toBeLessThanOrEqual(200);
    expect(FADE_IN_MS).toBeGreaterThanOrEqual(60);
    expect(FADE_IN_MS).toBeLessThanOrEqual(400);
  });
});
```

- [ ] **Step 2: Käivita test ja veendu, et see kukub**

Run: `npx vitest run src/utils/__tests__/imageFadeTransition.test.ts`
Expected: FAIL — `Failed to resolve import "../imageFadeTransition"`.

- [ ] **Step 3: Kirjuta minimaalne implementatsioon**

Loo `src/utils/imageFadeTransition.ts`:

```ts
/**
 * Skaneeringu fade lehe vahetusel.
 *
 * **Invariant: fade on seotud lehenumbri muutusega, MITTE laadimisolekuga.**
 * Kõrvallehtede eellaadimine (`useAdjacentPagePrefetch`) teeb pöörde nii
 * kiireks, et laadimisoleku külge seotud tagasiside vilksatab paar kaadrit ja
 * kaob — täpselt siis, kui eellaadimine töötab. Väga sarnase paigutusega
 * lehtede puhul ei registreeri kasutaja seetõttu, et leht üldse vahetus
 * (change blindness). Seepärast sunnib `dipDone` pildi vähemalt `FADE_OUT_MS`
 * jaoks peitu, sõltumata sellest, kui kiiresti pilt kohal oli.
 */

/** Väljumine: kiire kadu. */
export const FADE_OUT_MS = 90;
/** Sissetulek: rahulikum tagasitulek — leht justkui settib. */
export const FADE_IN_MS = 160;

interface ImageFadeParams {
  /** Uue lehe skaneering pole veel laetud. */
  imageLoading: boolean;
  /** Väljumisfaas on läbi (timer `FADE_OUT_MS` järel). */
  dipDone: boolean;
  /** Kasutaja on OS-is liikumise vähendamise sisse lülitanud. */
  reducedMotion: boolean;
}

/**
 * Pildi läbipaistvus ja ülemineku kestus antud olekus.
 *
 * Pilt tuuakse nähtavale alles siis, kui MÕLEMAD tingimused on täidetud:
 * väljumisfaas on läbi ja pilt on laetud. Sellest järelduvad ülejäänud juhud
 * ilma eraldi loogikata — aeglane pilt jääb lihtsalt tumedaks kuni kohale
 * jõudmiseni ja `ImageViewer`-i olemasolev spinner katab ooteaja.
 */
export function imageFadeStyle({
  imageLoading,
  dipDone,
  reducedMotion,
}: ImageFadeParams): { opacity: 0 | 1; durationMs: number } {
  // Liikumise vähendamine: ei mingit fade'i, pilt vahetub otse. Katab nii
  // vestibulaarsed kui valgustundlikkuse mured (kiirel lappamisel oleks tegu
  // korduva hele–tume välgatusega suurel alal).
  if (reducedMotion) {
    return { opacity: imageLoading ? 0 : 1, durationMs: 0 };
  }

  const visible = !imageLoading && dipDone;
  return { opacity: visible ? 1 : 0, durationMs: visible ? FADE_IN_MS : FADE_OUT_MS };
}
```

- [ ] **Step 4: Käivita testid ja veendu, et need lähevad läbi**

Run: `npx vitest run src/utils/__tests__/imageFadeTransition.test.ts`
Expected: PASS, 5 testi.

- [ ] **Step 5: Väravad**

Run: `npm run typecheck && npm test`
Expected: mõlemad läbivad, ükski olemasolev test ei katke.

- [ ] **Step 6: Commit**

```bash
git add src/utils/imageFadeTransition.ts src/utils/__tests__/imageFadeTransition.test.ts
git commit -m "feat: lisa skaneeringu fade'i olekufunktsioon"
```

---

### Task 2: Ühenda fade `ImageViewer`-iga

**Files:**
- Modify: `src/components/ImageViewer.tsx` (import rida 4 kõrvale; olek ~rida 34 järele; uus effect; `<img>` read 310–324)

**Interfaces:**
- Consumes: `imageFadeStyle`, `FADE_OUT_MS` failist `../utils/imageFadeTransition` (Task 1).
- Produces: mitte midagi uut väljapoole — `ImageViewer`-i props ja käitumine väljastpoolt vaadatuna ei muutu.

**Konteksti hetkeseis** (loe fail enne muutmist läbi, read võivad olla nihkunud):
- Rida 32–34: `loadedSrc` olek, `const isImageLoading = !!src && src !== loadedSrc;`, `showImageSpinner` olek.
- Rida 310–324: `<img ref={imgRef} … className={...transition-opacity duration-150 ${isImageLoading ? 'opacity-0' : 'opacity-100'}} />`.
- `pageNum` on juba olemas propina (rida 11, 18). Uut propi vaja ei ole.

- [ ] **Step 1: Lisa import**

Rea 4 (`import { panOffsetForTop } …`) järele:

```ts
import { imageFadeStyle, FADE_OUT_MS } from '../utils/imageFadeTransition';
```

- [ ] **Step 2: Lisa `reducedMotion` lugemine**

`CONTROLS_GAP_PX` konstandi järele (rida 7 järele), mooduli tasandile:

```ts
/**
 * Loeb OS-i liikumise-eelistuse. Väljaspool komponenti, et SSR-i/testide korral
 * puuduv `matchMedia` ei kukutaks renderdust.
 */
function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
}
```

- [ ] **Step 3: Lisa `dipDone` olek ja selle effect**

`showImageSpinner` oleku deklaratsiooni järele (rida 34 järele):

```ts
  // Lehe vahetuse dip: pilt sunnitakse korraks peitu, et eellaetud (seega
  // hetkeline) pööre oleks üldse märgatav. Vt `imageFadeTransition.ts` —
  // seotud PAGENUM-i, mitte laadimisolekuga. `false` esmasel renderdusel on
  // ohutu: pilt on siis niikuinii laadimisel, seega tulemus on tänasega sama.
  const [dipDone, setDipDone] = useState(false);
  const reducedMotion = prefersReducedMotion();

  useEffect(() => {
    setDipDone(false);
    const timer = setTimeout(() => setDipDone(true), FADE_OUT_MS);
    return () => clearTimeout(timer);
  }, [pageNum]);

  const fade = imageFadeStyle({ imageLoading: isImageLoading, dipDone, reducedMotion });
```

**NB:** effect peab olema `isImageLoading` deklaratsiooni **järel** (rida 33), sest `fade` kasutab seda.

- [ ] **Step 4: Rakenda `<img>`-il**

Asenda `<img>`-i `className` ja `style` (read 310–316). Enne:

```tsx
            className={`max-w-none shadow-2xl sepia-[0.3] pointer-events-none transition-opacity duration-150 ${
              isImageLoading ? 'opacity-0' : 'opacity-100'
            }`}
            style={{ maxHeight: '85vh', maxWidth: '85vw' }}
```

Pärast:

```tsx
            className="max-w-none shadow-2xl sepia-[0.3] pointer-events-none"
            style={{
              maxHeight: '85vh',
              maxWidth: '85vw',
              opacity: fade.opacity,
              // Inline, mitte Tailwindi klass: väljumise ja sissetuleku kestus
              // erinevad, klassipaar seda ei väljenda.
              transition: `opacity ${fade.durationMs}ms ease-out`,
            }}
```

Tailwindi `transition-opacity duration-150` ja `opacity-0`/`opacity-100` peavad kaduma — muidu võitleks klass inline-stiiliga.

- [ ] **Step 5: Väravad**

Run: `npm run typecheck && npm test`
Expected: mõlemad läbivad.

- [ ] **Step 6: Commit**

```bash
git add src/components/ImageViewer.tsx
git commit -m "feat: fade skaneeringul lehe vahetusel"
```

---

### Task 3: Käsitsi kontroll brauseris

**Files:** ei muudeta ühtegi (kui viga leitakse, parandus läheb Task 1 või 2 failidesse).

**Interfaces:**
- Consumes: Task 1 + Task 2 valmis implementatsioon.
- Produces: kinnitus, et funktsioon töötab päris brauseris — puhta funktsiooni testid ei kata ajastust ega DOM-i.

- [ ] **Step 1: Käivita dev-server**

Run: `npm run dev`
Ava `http://localhost:5173`, mine mõne teose tööalale.

- [ ] **Step 2: Kontrolli põhijuhtu**

Lappa edasi-tagasi teoses, kus järjestikused lehed on peaaegu identse paigutusega (sama kiri, sama veerulaius).
Oodatav: iga pööre annab selgelt tajutava tuhmumise; ekraan ei jää kunagi tumedaks kinni.

- [ ] **Step 3: Kontrolli suumi ja panni**

Suumi sisse (+ nupp või hiireratas), keri pilti, siis vaheta lehte.
Oodatav: fade toimub, aga suurendustase ja pildi asend käituvad täpselt nagu varem (suum säilib, asend läheb ülaserva).

- [ ] **Step 4: Kontrolli mobiilivaadet**

DevTools → seadme emuleerimine (nt iPhone), lappa lehti.
Oodatav: sama fade — `WorkspaceMobileView` kasutab sama `ImageViewer`-it.

- [ ] **Step 5: Kontrolli aeglast laadimist**

DevTools → Network → throttling "Slow 4G", lappa mõni leht kaugemale (mitte naaberlehele, et eellaadimine vahele jääks).
Oodatav: pilt tuhmub välja, jääb tumedaks, ~150 ms järel ilmub olemasolev keerlev spinner, pilt tuleb kohalejõudmisel fade'iga sisse.

- [ ] **Step 6: Kontrolli reduced-motion'it**

DevTools → Rendering → "Emulate CSS prefers-reduced-motion: reduce", laadi leht uuesti, lappa.
Oodatav: fade'i pole, pilt vahetub otse.

- [ ] **Step 7: Kontrolli ADR 0010 puutumatust**

Ava redaktoris leht, ära muuda teksti, vaheta lehte.
Oodatav: salvestamise kinnitust EI küsita (kinnitab, et editori tee jäi puutumata). Seejärel muuda teksti ja vaheta lehte — kinnitust KÜSITAKSE, nagu varem.

- [ ] **Step 8: Timmi kestused, kui vaja**

Kui fade tundub liiga aeglane või liiga vaevumärgatav, muuda `FADE_OUT_MS` / `FADE_IN_MS` failis `src/utils/imageFadeTransition.ts`. Testid ei tohi katkeda (nad impordivad konstandid; vahemikutest lubab 40–200 / 60–400 ms).

Kui timmisid:

```bash
npm run typecheck && npm test
git add src/utils/imageFadeTransition.ts
git commit -m "tune: timmi lehevahetuse fade'i kestust"
```

---

## Enesekontroll (plaani kirjutaja tehtud)

- **Spec-i kaetus:** dip-out + tingimuslik fade-in → Task 1 (`imageFadeStyle`) + Task 2 (`dipDone` effect); reduced-motion → Task 1 haru + Task 3 Step 6; aeglane pilt ja katkine pilt → olemasolev `isImageLoading`/`onError` loogika muutmata, kaetud Task 1 kolmanda testiga ja Task 3 Step 5-ga; konstantide timmitavus → Task 1 Step 1 viimane test + Task 3 Step 8; ulatuse piirid → Global Constraints; käsitsi kontrolli nimekiri spec-ist → Task 3 sammud 2–7.
- **Kohatäited:** puuduvad — iga koodisamm sisaldab lõplikku koodi.
- **Tüübi-järjekindlus:** `imageFadeStyle` signatuur ja väljakutse Task 2-s kattuvad (`imageLoading` ← `isImageLoading`, `dipDone`, `reducedMotion`); `FADE_OUT_MS` kasutatakse Task 2-s timeri kestusena, `FADE_IN_MS` ainult Task 1-s.
