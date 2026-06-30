# Marginaalia ülekatte-renderdus (mõõdetud overlay) — tehniline plaan

**Kuupäev:** 2026-06-13
**Staatus:** kavand, alustamine 2026-06-14
**Otsus:** kasutaja valis "mõõdetud ülekate" (variant 1) vs lihtne in-flow (variant 2)

## Probleem ja kontekst

Praegune marginaalia editor-renderdus on **habras ja ettearvamatu** — tekst kaob
visuaalselt valiku→marginaalia järel, plokid ei renderdu ettearvatavalt. Korduvad
plaastrid (open/close olek, plokkide liitmine, ankru-nihked, `content`-väli) pole
stabiilsust toonud.

**Juurpõhjus (täpne):** praegune kood paneb ühe CM-dekoratsiooni tegema kahte tööd:
(1) peidab marginaalia voost `Decoration.replace({block:true})`-ga, (2) renderdab
selle null-laiusega ääre-widgetina ploki PIIRIL. Teine osa on CM6 kõige
ebausaldusväärsem nurk — CM võib widgeti siduda peidetud plokiga ja jätta
materialiseerumata → "kadus". Mitte peitmine pole katki, vaid see widget-tehnika.
(NB: code folding kasutab block-replace'i usaldusväärselt — aga widget on seal ploki
SEES, mitte eraldi piiril.)

## Mis JÄÄB (valmis, ära puutu)

Andmepool on kindel ja deploy'tud — see EI ole osa sellest tööst:
- ✅ `server/marginalia_normalize.py` — `<m>` kanooniliseks (välimiseks); commit 54185ff
- ✅ `split_marginalia` normaliseerib (live + seed); `/save` + `import_as_work` normaliseerivad
- ✅ Migratsioon tehtud (78 faili), `data/` commit 4da225a, reindeks tehtud
- ✅ Eraldi `marginaalia_tekst` otsinguväli töötab
- ✅ `findMarginaliaBlocks`, `stackMarginalia`, `marginaliaFromSelection`,
  `cleanMarkupSpecs` (`src/utils/marginaliaUtils.ts`) — loogika taaskasutatav

## Mis ASENDUB / EEMALDATAKSE

Kogu habras renderdus-masinavärk `src/components/editor/MarginaliaExtension.ts`-is:
- block-replace + null-laiusega ääre-widget (MarginNoteWidget side:-1)
- open/close olekumasin (openMarginalia/closeMarginalia/closeAllMarginalia,
  MarginCloseWidget, klikk-ava)
- kaitsefilter peidetud plokkidele (marginaliaProtectionFilter)
- plokkide liitmine + `content`-väli (commitimata "muul viisil" muudatus)
- MarginInlineMarkerWidget, MarginBadgeWidget anchor-häkid

**NB: töökataloogis on commitimata "muul viisil" tehtud muudatused** (MarginaliaExtension.ts,
marginaliaUtils.ts, TextEditor.tsx) — need on habras versioon. Homme: `git stash` või
`git checkout` need failid HEAD-ile (54185ff) ja alusta puhtalt. Kontrolli `git status`
ja `git diff` enne.

## Sihtarhitektuur: mõõdetud ülekate (Hypothes.is / Google Docs muster)

Eralda kaks rolli, mida marginaalia kannab:
- **tekst dokumendis** (säilib, muudetav, salvestatav) → CM-i töö
- **visuaalne element ankru kõrval** → eraldi ülekatte-kihi töö (mitte CM-widget)

### Editor (CodeMirror)

1. **Ahenda marginaalia read voost** — `Decoration.replace({ block: true })` ploki
   `hideFrom..hideTo` peal, ILMA widgetita. Puhas ahendus on usaldusväärne (nagu folding).
   Põhitekst jääb pidevaks.
2. **Eraldi DOM-ülekate** (`.cm-editor` sees, position:absolute kiht, mida MEIE
   kontrollime) renderdab iga märkuse. EI ole CM-widget → ei saa materialiseerumata jääda.
   Sisu renderdatakse `renderVuttMarkup`-iga (XSS-turvaline, sisemine märgendus).
3. **ViewPlugin mõõdab ja paigutab:** iga ploki ankru jaoks `view.coordsAtPos(anchorPos)`
   → y-koordinaat (suhtes `.cm-content`-i). Paiguta märkuse-div vasakveergu sellele
   kõrgusele. Kollisioonid → olemasolev `stackMarginalia`. Uuenda `requestMeasure`-iga:
   `update()` kui docChanged/viewportChanged/geometryChanged; lisaks scroll-kuular ja
   ResizeObserver (juba olemas praeguses layout-pluginis — taaskasuta).
4. **Muutmine (lahuta kuvamisest):**
   - klikk märkusel → effekt "paljasta see plokk" (eemalda ahendus-dekoratsioon selle
     ploki jaoks) → toortekst `<m>…</m>` ilmub inline, kursor sees
   - Esc / klikk mujale → ahenda tagasi
   - KRIITILINE: isegi kui paljastus glitchiks, tekst on inline NÄHTAV — kunagi mitte
     nähtamatu. "Kadumise" võimalus arhitektuurselt välistatud.
   - Tähele: paljastatud olek on `Set<blockFrom>` StateField-is, mapitakse muudatuste
     läbi (sarnane praegusele openMarks-ile, aga lihtsam — ainult muutmiseks)

### Avalik lugemisvaade (boonus, eraldi/lihtsam)

Avalik `/work/:id/:page` lugemisvaade ei vaja CM-i. `renderVuttMarkup` toodab staatilist
HTML-i → **puhas CSS-sidenote (Tufte-stiil)**, bulletproof, ilma mõõtmiseta. Kaalu spec'i
muutmist: avalik vaade = HTML-sidenotes (mitte CM readOnly). See on eraldi väiksem tükk,
võib teha pärast editorit.

## Tasks (homme, järjekorras)

- **Task 0:** Puhasta tööpuu — `git checkout`/stash commitimata MarginaliaExtension.ts,
  marginaliaUtils.ts, TextEditor.tsx (habras "muul viisil" versioon). Kinnita testid
  rohelised baasil. Otsusta: kas `findMarginaliaBlocks` jääb per-`<m>` (liitmine
  visuaalselt overlay's) või liidab — **kasutaja tahab visuaalselt ühte blokki liita**,
  seega liitmine tehakse OVERLAY paigutuses (järjestikused märkused üks kaart), MITTE
  parseris dokumendi-positsioone segades. Hoia parser puhas (per-`<m>` plokid).
- **Task 1:** Ahendus-dekoratsioon (block-replace ilma widgetita) + atomic. Testid:
  blokk ahendatud, kursor hüppab üle, tekst doc-is alles.
- **Task 2:** Ülekatte-DOM kiht + ViewPlugin: mõõda `coordsAtPos(anchor)`, renderda
  märkuse-divid vasakveergu. CSS. Käsitsi browser-verify.
- **Task 3:** Kollisioon/virnastamine olemasoleva `stackMarginalia`-ga; järjestikuste
  märkuste visuaalne grupeerimine üheks kaardiks.
- **Task 4:** Paljasta-muutmine: klikk → reveal effect → inline toortekst → Esc/blur →
  re-collapse. StateField paljastatud-plokkidele. Käsitsi verify: undo, kirjutamine,
  erimärgid, salvestus (txt baidi-täpne).
- **Task 5:** `insertMarginalia` (TextEditor) — valik → `<m>…</m>` (taaskasuta
  `marginaliaFromSelection`); ilmub kohe märkusena, ei kao. Tühi valik → tühi märkus.
- **Task 6:** Kustutamine — selgita UX (hover × märkusel või tavaline tekstivalik+del).
- **Task 7 (eraldi):** Avalik vaade — CSS-sidenotes `renderVuttMarkup`-is.
- **Task 8:** Käsitsi browser-verifitseerimine kõigil mustritel (jyxgrs/4, nopt05/3,
  ij7337/4); deploy.

## Lahtised otsused (homme alguses)

- **Virnastamise grupeerimine:** järjestikused `<m>` read → üks visuaalne kaart vai
  eraldi kaardid? Kasutaja: "üheks blokiks liitmine on plaanitud" → grupeeri overlay's.
- **Ahenduse vs ankru kõrgus:** ahendatud plokil pole coords; ankur = JÄRGMINE nähtav
  rida (olemasolev ankrureegel). Verifitseeri, et `coordsAtPos(anchorPos)` annab õige y
  ahendatud ploki KÕRVAL.
- **readOnly editoris vs eraldi HTML avalik vaade** — kumb enne.
- **Mõõtmise jõudlus** — palju marginaale lehel; `requestMeasure` batch'imine.

## Verifitseerimine

Vaate-kihti EI saa node-vitestis täielikult testida. Loogika (parser, stack, fromSelection,
collapse-spec) → vitest. Renderdus → **päris brauser** (headless ebausaldusväärne CM6-le).
Testlehed: jyxgrs/4 (ristuvad, parandatud andmetes), nopt05/3 (lõpuklaster), ij7337/4
(valik→marginaalia kadus).

## Viited

- CM6 API: `view.coordsAtPos(pos)`, `view.requestMeasure({read,write})`, `layer` primitiiv
- Olemasolev mõõtmis-loogika: praegune `marginaliaLayoutPlugin` (ResizeObserver, stack)
- Disainispec (vana, osaliselt aegunud): docs/superpowers/specs/2026-06-11-marginalia-display-design.md
- Intsident, mis paljastas single-worker tundlikkuse: project_outage_ocr_ssh_blocking.md
