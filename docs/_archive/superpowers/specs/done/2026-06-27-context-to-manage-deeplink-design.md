# Disain: kontekstist `/manage`-isse — lehe-haldus käeulatusse

**Kuupäev:** 2026-06-27
**Staatus:** kinnitatud disain, ootab implementatsiooniplaani

## Probleem

Arhiividokumentide üleslaadijad (peamine tagasiside-allikas) töötavad sageli
**topeltlehekülgedega**, mida on vaja **poolitada** (sage) ja vahel sirgendada/kärpida
(harvem). Tööd tehes jääb silma, et lahtiolev leht vajab parandust, aga:

1. `/manage` ei ava seda lehte, kus kasutaja oli — peab käsitsi otsima.
2. Pisipildid on väikesed → ei näe kohe, kus oldi / mis viga on.
3. Kogu `/manage` kogemus pole nii mugav kui Workspace'i grid-view.

## Mittelahendus (tahtlikult välistatud)

Operatsioonide killustamine üle pindade — nt crop ImageViewerisse, aga poolita ainult
`/manage`-is. Kuna **poolitamine on kõige sagedasem** ja kasutaja peas tähendab
"paranda see leht" just poolitamist, tekitaks osaline operatsioonide komplekt ühel pinnal
*suurema* segaduse ("miks ma siin croppida saan, aga poolitada ei"). Seetõttu:

- Ei dubleerita ühtki operatsiooni.
- Ei tooda struktuuri-loogikat (poolita/reorder/kustuta/re-OCR) aktiivsesse
  tekstisessiooni (Workspace'i).
- Ei muudeta privileege: `/manage` jääb admin-only; Workspace jääb anonüümselt vaadatavaks.

**Põhimõte:** `/manage` jääb ainsaks koduks kõigile lehe-operatsioonidele. Teeme ta
*kontekstist kättesaadavaks* ja *ergonoomiliseks*.

## Lahendus

### 1. Deep-link kontekstist (Workspace → `/manage`)

ImageVieweris **admin-only nupp** ("Halda lehte"), mis navigeerib:

```
/work/:workId/manage?focus=<pageNum>
```

- `pageNum` = kanoniseeritud leheküljenumber, **mille järgi Workspace praegust lehte
  laeb** (source of truth). Praktikas `currentPageNum` / `page.page_number`; kui see
  mingis seisus puudub/nihkes, fallback URL-i `:pageNum` paramile.
- Query-param, sest marsruut `/work/:workId/manage` ei võta lehe-segmenti. Laiendatav
  (nt `?focus=12&mode=...`), kui `/manage` kunagi keerukamaks läheb.
- Nupp **tööriista-stiilis** (mitte prominentne) — adminile käeulatuses, aga ei
  konkureeri lugemise/toimetamise põhitegevusega. Nähtav ainult kui
  `user?.role === 'admin'` (sama gate nagu `/manage` ise).
- **Asukoht ja ikoon:** lisandub olemasolevasse ImageVieweri tööriistaribasse
  (`ZoomIn` · `ZoomOut` · reset · `LayoutGrid` · `Download`). Ikoon **`Scissors`**
  (seob nupu pildiredaktoriga, mida admin juba tunneb; "lõika/poolita" = sagedaseim
  toiming), title "Halda lehte".
- **Seotud parandus — reset-nupu ikoon:** praegu kasutab reset-nupp (`handleReset`,
  title "Taasta vaade") ikooni **`RotateCcw`**, mis näeb välja nagu pööramine ja eksitab.
  Vahetada **`Maximize2`** (loeb kui "mahuta/lähtesta vaade"). `RotateCcw`/`RotateCw`
  jäävad reserveeritud pildiredaktori *päris* pööramisele — reset'i jaoks neid kasutada
  oleks topelt-eksitav.

### 2. Fookus `/manage`-is

`WorkManage` loeb `useSearchParams()` → `focus`.

- **`focus` parsimine:** ainult positiivne täisarv. `focus=abc`, `focus=-1`,
  `focus=12.5`, puuduv → tavavaade, ei scrolli, ei crashi.
- Pärast lehtede laadimist (`visibleSorted` valmis): leiab kaardi, mille
  `visibleNumByFile[filename] === focus`. **`filename`** on selle koodibaasi
  kanooniline lehevõti (`draftPositions`, `selectedFiles`, `visibleNumByFile` kõik
  võtmestatud `filename`-iga); kuvanimi (`imageName`/`lehekylje_pilt`) on eraldi.
- **Kerib vaatesse** (`scrollIntoView({ behavior: 'smooth', block: 'center' })`).
  `PageCard` pildiala on `aspect-[3/4]` (fikseeritud kuvasuhe → kaardikõrgused ei
  reflow'gi piltide laadimisel), seega üks `requestAnimationFrame` pärast esmast
  renderit on scrolli jaoks piisav; layout-effect tantsu pole vaja.
- **Tõstab esile** lühikese efektiga (ring/glow ~2s, siis hääbub). Austab
  `prefers-reduced-motion`: animatsiooni asemel staatiline lühike outline/taust.
- **Fookus rakendub AINULT esmasel lehtede laadimisel.** `handledFocusRef` guard
  väldib korduvat käivitumist (sh React StrictMode topelt-effect). Hilisemad
  salvestamata reorder-muudatused EI käivita uut scroll'i ega muuda highlight'i.
- **EI ava** automaatselt pildiredaktorit (kasutaja otsus: ohutum, vähem üllatav).
  Kasutaja vajutab ise edasi (poolita/crop/rotate).
- Servajuhud: kui `focus` puudub või ei leita vastet → tavaline `/manage` vaade,
  ilma fookuseta (graatsiline degradatsioon).

### 3. Tagasitee (`/manage` → Workspace)

**Olemasoleva tagasinupu fookus-teadlikuks tegemine — EI lisata uut nuppu.**
`WorkManage.tsx:578` on juba lehe ülaservas tagasinupp (`ArrowLeft` +
`manage.backToWork`), aga see navigeerib praegu **alati `/work/${workId}/1`**
(leht 1, ükskõik kust tuldi — latentne puudus selle voo jaoks).

Muudatus:
- `focus` olemas → tagasinupp viib `/work/:workId/<focus>` (õige leht); silt
  konkreetsem, nt "← Tagasi lehele {n}".
- `focus` puudub (tuldi mujalt) → senine käitumine ja silt (`manage.backToWork`,
  leht 1).
- **Parima-püüde link.** Poolitamise järel numeratsioon võib nihkuda, aga tagasi-leht
  jääb kehtivaks (poolitatud lehe esimene pool kannab sama numbrit). Kui leht on
  vahepeal kustutatud või numeratsioon muutunud, käitub Workspace oma tavapärase
  puuduv-leht-loogika järgi (graatsiline degradatsioon) — me ei püüa seda ennustada.
- **Tahtlik valik — EI tee "elegantset" varianti** (jäta failivõti meelde → arvuta
  jooksev nähtav number). Põhjus: `/manage` kuvab **salvestamata** draft-positsioone,
  Workspace navigeerib **salvestatud** järjekorra järgi. Nähtava numbri arvutamine
  draft'ist võiks saata kasutaja valele salvestatud lehele. Lihtne `focus`-number =
  saabumishetke salvestatud number, mis vastab sellele, mida Workspace kasutab —
  salvestamata muudatuste korral hoopis õigem.

### 4. Grid-ergonoomika

Praegu `WorkManage` grid on fikseeritud: `grid-cols-3 sm:grid-cols-4 md:grid-cols-5`.

Toome `ThumbnailGrid`-i juba olemasoleva **veeru-reguleerimise** loogika `/manage`-isse:

- Veergude arvu reguleerija (min 3, max 10 — sama vahemik nagu `ThumbnailGrid`/Workspace
  grid-view, vt `Workspace.tsx` `gridCols`). Käsitsi/kiire klikkimine ei vii väljapoole
  3–10 (clamp).
- Vähem veerge = suuremad pisipildid → näeb kohe lehe seisu (viltu/topelt).
- Olek lokaalne `WorkManage`-is (`useState`), võib hiljem püsistada `user_settings`-i,
  aga see EI ole selle skoobi osa (YAGNI).
- `ThumbnailGrid`-il on slider juba olemas (`MIN_COLS`/`MAX_COLS`, `cols`/`onColsChange`).
  Implementatsiooniplaan otsustab: kas eraldada slider väikeseks jagatud komponendiks
  või replikeerida (väike, ~10 rida). Kumbki sobib; ei kirjuta uut loogikat nullist.

## Mõjutatud failid

| Fail | Muudatus |
|------|----------|
| `src/components/ImageViewer.tsx` | Admin-only "Halda lehte" nupp (`Scissors`) ribasse → `?focus=` link; reset-nupu ikoon `RotateCcw` → `Maximize2` |
| `src/pages/Workspace.tsx` | Annab ImageViewerile admin-lipu + workId/pageNum (kui pole juba) |
| `src/pages/WorkManage.tsx` | `useSearchParams` focus; scrollIntoView+highlight; **olemasolev** tagasinupp fookus-teadlikuks; veeru-reguleerija |
| `src/pages/manage/PageCard.tsx` | `ref` + highlight-klass (forwardRef või wrapper) |
| `src/locales/{et,en}/*.json` | Uued sildid: "Halda lehte", "Tagasi toimetajasse", veeru-reguleerija |

Backend muudatusi **ei vaja** — kõik operatsioonid on juba `/manage`-is olemas.

## Testid

- ImageVieweri "Halda lehte" nupp nähtav ainult adminile; mitte-admin ei näe nuppu;
  otselingi puhul jääb `/manage` olemasoleva admin-kaitse alla (`WorkManage.tsx:117`).
- Nupp navigeerib õige `?focus=<pageNum>` URL-iga.
- `WorkManage` fookus: õige kaart keritakse vaatesse + esiletõst.
- `focus` vigane string / negatiivne / mittetäisarv → ei scrolli, ei crashi, tavavaade.
- `focus` viitab lehele, mida pole nähtavas listis → tavavaade.
- Highlight rakendub ainult ühele kaardile ja kaob pärast timeout'i.
- Tagasitee (olemasolev nupp): kui `focus` olemas → `/work/:workId/<focus>` (mitte
  leht 1); kui `focus` puudub → senine käitumine (leht 1, `manage.backToWork`).
- Veeru-reguleerija muudab grid-veergude arvu vahemikus 3–10; ei välju vahemikust.

## Riskid ja leevendus

- **Numeratsiooni nihe poolitamisel** → tagasitee kasutab `focus` numbrit, mis jääb
  kehtivaks (esimene pool). Madal risk.
- **`focus` vs hilisem draft-reorder** → fookus rakendub AINULT esmasel laadimisel
  (`handledFocusRef` guard). Hilisemad salvestamata reorder-muudatused ei käivita uut
  scroll'i ega kerimist tagasi fookuskaardile. Probleem pole "degradeerumine", vaid
  "ära fokuseeri korduvalt" — guard lahendab. Madal risk.
- **Privileegide leke** → "Halda lehte" nupp range admin-gate taga; `/manage` ise
  juba kontrollib rolli (`WorkManage.tsx:117-123`).
