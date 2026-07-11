# Kleepuv kärpe-suurus (sticky crop size)

**Kuupäev:** 2026-06-25
**Fail:** `src/components/PageImageEditorModal.tsx`

## Probleem

Manage-lehe pildiredaktoris (`PageImageEditorModal`) kärbib admin järjestikuseid
lehekülgi. Pärast kärpe rakendamist liigutakse automaatselt järgmisele lehele, kuid
kärpekast lähtestatakse täielikult (`resetTransforms`). Järjestikused skännid on sageli
sama suuruse ja paigutusega, seega oleks mugav, kui järgmisel lehel oleks kohe **sama
suur** kärpekast ette antud — admin teaks lehte täpselt samale suurusele kärpida.

## Lahendus

Jäta meelde viimati kasutatud kärpekasti **suurus** (normaliseeritud, proportsionaalne).
Iga uue lehe avamisel ilmub sama suur tühi kast pildi **keskele**, kalle nullitud.
Kasutaja lohistab selle õigesse kohta ja vajadusel kallutab.

**Otsused (kasutajaga kokku lepitud):**
- Üle kantakse **ainult suurus** (mitte asukoht ega kalle). Kast ilmub keskele,
  kasutaja lohistab ise õigesse kohta.
- Toimub **kõigil lehevahetustel** — nii pärast "Rakenda" automaatset edasiliikumist
  kui ka käsitsi ←/→ navigeerimisel.
- Kalle (`boxAngle`, deskew) **alati nullitakse** — iga leht on erinevalt kaldu.

## Muudatused (ainult `PageImageEditorModal.tsx`)

1. **Uus ref** `lastCropSizeRef = useRef<{ w: number; h: number } | null>(null)` —
   hoiab viimase kasti normaliseeritud mõõtu (`cropRect.w` / `cropRect.h`). Ref, mitte
   state → ei tekita re-render'it ega püsi üle modaali sulgemise (iga seanss algab puhtalt).

2. **Püüdmine:** `useEffect(…, [cropRect])` — kui `cropRect` on olemas, salvesta
   `{ w: cropRect.w, h: cropRect.h }` ref'i. Suurus jääb meelde joonistamisel, suuruse
   muutmisel ja rakendamisel.

3. **Taastamine:** olemasolevas reset-effektis (`[current?.filename, cacheBust]`) **kohe
   pärast** `resetTransforms()` (samas efektis, et `boxAngle` jääks garanteeritult 0 ega
   ükski vana nurga-olek taastuks):
   ```
   resetTransforms()
   if (lastCropSizeRef.current) {
     const w = Math.min(Math.max(lastCropSizeRef.current.w, 0.01), 0.98)
     const h = Math.min(Math.max(lastCropSizeRef.current.h, 0.01), 0.98)
     setCropRect({ x: (1 - w) / 2, y: (1 - h) / 2, w, h })
   }
   ```
   **Clamp [0.01, 0.98]** kaitseb imeliku/vahepealse oleku eest — kast ei saa kogemata
   üle ääre ulatuda. Esimesel avamisel on ref tühi → kasti ei teki (nagu praegu).

4. **Selge "unustamine":** CircleX (kärpe-reset) nupp nullib lisaks `cropRect`/`boxAngle`-le
   ka `lastCropSizeRef.current = null` → lõpetab kleepumise, järgmine leht algab puhtalt.
   Tooltip täpsustatakse (`cropReset` locale): "Eemalda kärpekast ja unusta viimati
   kasutatud suurus" / "Remove crop box and forget last used size".

**Märkus püüdmise semantika kohta:** `useEffect([cropRect])` salvestab iga `cropRect`
muutuse peale. See on aktsepteeritav, sest joonistamise lõpetamine (`onCropUp`) viskab
`MIN_DRAG_PX`-st väiksemad kastid ära (`setCropRect(null)`) → liiga väikest kogemata kasti
ei salvestata. Suuruse muutmisel kirjutab viimane (lõplik) olek vahepealsed üle, seega
navigeerimise hetkeks hoiab ref õiget lõppsuurust.

## Mida tahtlikult EI tehta

- Ei taastata kasti `grossAngle` (90/180) muutmisel — tahtlik per-leht tegevus, kast kustub.
- Ei säilitata üle modaali sulgemise/avamise.
- Ei säilitata asukohta ega kallet — ainult suurus.

## Servajuhud

- Pärast pildi asendust või poolitust uueneb `cacheBust` → kast taastub tsentreerituna
  (kahjutu, kasutaja saab CircleX-iga eemaldada).
- Viimasel lehel pärast "Rakenda" jääb index samaks, kuid `cacheBust` muutub → kast ilmub
  uuesti tsentreerituna (kahjutu).
- Taastatud kast teeb "Rakenda" nupu aktiivseks (`noEditChange` on false), kuid rakendamine
  nõuab kinnitusdialoogi → kogemata kärpimise risk minimaalne.

## Testimine

Manuaalne (väike puhtalt-frontend muudatus, normaliseeritud geomeetria):
1. Kärbi leht → Rakenda → kontrolli, et järgmisel lehel on sama suur kast keskel, kalleta.
2. Liigu käsitsi ←/→ → sama suur kast ilmub.
3. **Muuda kärpekasti suurust lehel A, ÄRA rakenda, liigu käsitsi lehele B → lehel B
   ilmub viimane suurus keskele** (kinnitab, et suurus jääb meelde ka ilma rakendamiseta).
4. Vajuta CircleX → kast kaob, järgmine leht algab puhtalt.
5. Esmaavamine: kasti ei ole enne esimest kärbet.
