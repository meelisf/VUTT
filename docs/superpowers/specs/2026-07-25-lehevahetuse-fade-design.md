# Lehevahetuse fade skaneeringul

**Kuupäev:** 2026-07-25
**Staatus:** disain kinnitatud, ootab teostust

## Probleem

Kõrvallehtede eellaadimine (`useAdjacentPagePrefetch`) tegi lehepöörde nii kiireks, et
kasutaja ei registreeri muutust. Väga sarnase paigutusega lehtede puhul (sama kiri,
sama veerulaius, sama marginaal) tekib change blindness: ekraan on uus, aga silm ei
näe, et midagi juhtus.

Olemasolev tagasiside ei kata seda:

- `Workspace.tsx` peenike riba ülaservas (`pageLoading`) vilksatab eellaetud lehe
  puhul ~20 ms — silm ei jõua seda registreerida, ja see on niikuinii ekraani servas.
- `ImageViewer` `transition-opacity duration-150` (rida 313) ei jõua mängida:
  vahemälust tulnud pildi puhul lahendub `complete`/`onLoad` sama kaadri jooksul,
  nii et `isImageLoading` ei ole kunagi ühe renderduskaadri jooksul tõene.

**Kaks eri probleemi ühe nime all.** Laadimise tagasiside (spinner) ütleb "oota".
Muutuse kinnitus ütleb "see on nüüd teine leht". Siin on vaja teist. Kui lahendada
see spinneri kunstliku miinimumkestusega, siis me teeskleme aeglust täpselt pärast
seda, kui tegime tööd kiiruse nimel — ja signaal jääks ekraani serva, mitte sinna,
kuhu kasutaja vaatab.

## Lahendus

Skaneering ise teeb lehe vahetusel lühikese täieliku fade'i: tuhmub välja ja tuleb
tagasi. Pildi taust on `bg-slate-900` (tume) ja skaneering hele, seega läbipaistvaks
laskmine annab hele → tume → hele muutuse, mis on tugev signaal ka identse paigutusega
lehtede puhul.

### Invariant

**Animatsioon on seotud `pageNum` muutusega, MITTE laadimisolekuga.** See on kogu
lahenduse mõte: laadimisoleku külge seotud tagasiside kaob täpselt siis, kui
eellaadimine töötab, st alati kui see oluline on.

### Käitumine

Iga `pageNum` muutus käivitab tsükli:

1. **Dip-out** — `opacity` → 0 üle `FADE_OUT_MS` (90 ms).
2. **Fade-in** — `opacity` → 1 üle `FADE_IN_MS` (160 ms), aga alles siis, kui
   **mõlemad** tingimused on täidetud: dip-out on läbi **ja** uue lehe pilt on laetud.

Sellest järelduvad ülejäänud juhud ilma eraldi loogikata:

| Olukord | Tulemus |
|---------|---------|
| Eellaetud pilt (tavajuht) | Laadimine on juba valmis, määravaks jääb 90 ms → üleminek on alati täies pikkuses nähtav |
| Aeglane pilt | Jääb tumedaks, 150 ms järel ilmub olemasolev spinner, fade-in käivitub kohalejõudmisel |
| Katkine pilt | `onError` → `setLoadedSrc(src)` (olemasolev), fade-in käivitub, `<img>` näitab alt-teksti |
| Uus pööre dipi keskel | Tsükkel algab otsast: `opacity` läheb praegusest väärtusest tagasi 0 poole |

Kiire lappamine (nooleklahv all) annab seega korduva vilkumise. See on teadlik valik:
lehtede visuaalseks skannimiseks on olemas grid view, mistõttu lehthaaval kiirlappamine
ei ole töövoog, mida optimeerida. `prefers-reduced-motion` on turvaklapp neile, keda
see häirib.

### prefers-reduced-motion

`(prefers-reduced-motion: reduce)` korral on fade välja lülitatud: pilt vahetub otse,
täpselt tänase käitumise järgi. Katab nii vestibulaarsed kui valgustundlikkuse mured
(WCAG 2.3.1 — kiire lappamine võiks muidu ületada 3 välgatust sekundis suurel alal).

### Hind

Uus leht ilmub 90 ms hiljem kui praegu. See on alla ~100 ms taju-läve, seega "kohene"
tunne säilib. See viivitus on tahtlik ja kannab kogu funktsiooni — vt kommentaar koodis.

## Ulatus

Ainult `src/components/ImageViewer.tsx` + üks uus util. `ImageViewer` on üks komponent
nii desktopil (`Workspace.tsx:683`) kui mobiilis (`WorkspaceMobileView.tsx:275`) ja saab
juba propina `pageNum`, seega mõlemad vaated saavad muudatuse korraga.

**Ei puutu:**

- Tekstipaani ega CodeMirrorit — ADR 0010 (lehe vahetus ei monteeri editorit maha)
  pole ohus, midagi ei monteerita maha ega lisata `pageSwapAnnotation` teele.
- `Workspace.tsx` `pageLoading` riba — jääb alles päris aeglaste laadimiste jaoks.
- `loadedSrc` / `isImageLoading` / `resetPanToTop` loogikat `ImageViewer`-is.
- Suumi ja panni `transform`-i (rida 303) — fade käib `<img>`-i enda küljes, mis on
  transform-diivi sees ja ilma oma transformita.
- Tõlkeid — uusi stringe ei tule, seega `localeParity` riski pole.

## Struktuur

### Uus: `src/utils/imageFadeTransition.ts`

Puhas funktsioon, järgib sama komponendi kõrval olemas olevat mustrit
(`src/utils/imageViewerGeometry.ts` + `panOffsetForTop`).

```ts
export const FADE_OUT_MS = 90;
export const FADE_IN_MS = 160;

export function imageFadeStyle(params: {
  imageLoading: boolean;
  dipDone: boolean;
  reducedMotion: boolean;
}): { opacity: 0 | 1; durationMs: number };
```

Reeglid:

- `reducedMotion` → `{ opacity: imageLoading ? 0 : 1, durationMs: 0 }`.
- muidu `visible = !imageLoading && dipDone` →
  `{ opacity: visible ? 1 : 0, durationMs: visible ? FADE_IN_MS : FADE_OUT_MS }`.

`FADE_OUT_MS` ja `FADE_IN_MS` on siin ühes kohas nimetatud konstantidena just selleks,
et kiirust saaks pärast praktikas timmida — signaal peab olema märgatav, aga korduval
lappamisel mitte tüütu. Testid ei tohi neid väärtusi kõvakodeerida, vaid importima
konstandid, et timmimine ei lõhuks teste.

### Muudetud: `src/components/ImageViewer.tsx`

- Uus olek `dipDone: boolean`. `useEffect` `pageNum`-il: `setDipDone(false)`,
  `setTimeout(… FADE_OUT_MS)` → `setDipDone(true)`, cleanup `clearTimeout`.
  Esmasel monteerimisel jookseb effect samamoodi ja eraldi erijuhtu ei vaja: pilt on
  siis niikuinii laadimisel, seega `opacity` on 0 ja tulemus on tänasega identne.
- `reducedMotion` loetakse `window.matchMedia('(prefers-reduced-motion: reduce)')`-ist.
- `<img>` klassidest kaovad `transition-opacity duration-150` ja
  `opacity-0`/`opacity-100`; asemele inline-stiil
  `{ opacity, transition: \`opacity ${durationMs}ms ease-out\` }`, sest välja- ja
  sissetuleku kestus erinevad.
- Kommentaar eesti keeles, mis ütleb **miks** 90 ms viivitus seal on. Ilma selleta
  eemaldab järgmine jõudlusoptimeerija selle heas usus ära ja probleem tuleb tagasi.

## Testid

`src/utils/__tests__/imageFadeTransition.test.ts` — puhta funktsiooni testid (repos
pole testing-libraryt ega jsdom-i; kõik olemasolevad testid on puhtad funktsioonid):

1. Eellaetud pilt dipi ajal (`imageLoading: false`, `dipDone: false`) → `opacity 0`,
   `durationMs === FADE_OUT_MS`.
2. Eellaetud pilt pärast dipi (`dipDone: true`) → `opacity 1`, `durationMs === FADE_IN_MS`.
3. Aeglane pilt pärast dipi (`imageLoading: true`, `dipDone: true`) → `opacity 0`.
4. `reducedMotion: true` → `durationMs === 0`; `opacity` järgib ainult `imageLoading`-ut
   (mõlemad harud).

Väravad: `npm run typecheck` ja `npm test`.

## Käsitsi kontroll

1. Lappa teoses, kus järjestikused lehed on peaaegu identse paigutusega — muutus peab
   olema selgelt tajutav.
2. Sama mobiilivaates.
3. Suumi sisse ja lappa — fade ei tohi suumi ega panni asendit muuta.
4. DevTools network throttling → aeglane pilt: dip, siis spinner, siis fade-in.
5. OS-i "reduce motion" sisse → pilt vahetub otse, fade'i pole.
6. Redaktoris tekst muutmata → lehe vahetusel ei küsita salvestamist (kinnitab, et
   ADR 0010 tee jäi puutumata).

## Kaalutud ja kõrvale jäetud

- **Spinneri garanteeritud miinimumkestus** — signaal jääks ekraani serva, mitte sinna
  kuhu vaadatakse, ja tähendaks "laen" siis, kui midagi ei laeta.
- **Suunaline nihe (slide)** — annaks lisaks suunainfo, aga liikumine on tööriistas
  pidevalt korduvana rahutum kui vaikne tuhmumine.
- **3D lehepööramine** — vajaks 300–500 ms, mis võtaks tagasi selle, milleks
  eellaadimine tehti.
- **Fade ka tekstipaanil** — häiriks transkribeerimist ja nõuaks CodeMirrori ümbruse
  puutumist ilma vastava võiduta; pilt on see, mida vaadatakse.
- **Fade'i mahasurumine kiirel lappamisel** (nt < 400 ms vahega pöörded) — lisareegel,
  mille tarvet ei ole: kiireks lappamiseks on grid view.
