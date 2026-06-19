# Pisipildi käärid-ikoon + asenda pilt modaali

**Kuupäev:** 2026-06-19
**Failid:** `src/pages/WorkManage.tsx`, `src/components/PageImageEditorModal.tsx`

## Probleem

Iga pisipildi all paremas nurgas on ⋮-overflow-menüü nelja kirjega: Laadi pilt
alla, Asenda pilt, Pööra-ja-kärbi, Poolita. Pööra-ja-kärbi ning Poolita viivad
nagunii samale redaktori-modaalile (seal on tabid), nii et menüü on vajalikust
keerulisem. Laadi-alla on juba olemas avalikul teose-lehel (`/work/{id}/{n}`).

## Lahendus

Üks **käärid-ikoon** pisipildi nurgas → avab redaktori-modaali. ⋮-menüü kaob.

### 1. Pisipilt (`WorkManage.tsx`)

- Eemalda kogu `⋮`-menüü ja selle 4 kirjet (Laadi alla, Asenda pilt,
  Pööra-ja-kärbi, Poolita) ning seotud olek (`openMenuPage`, klikk-väljaspool
  kuular, kui pole mujal kasutuses).
- Asenda **ühe käärid-ikooniga** (all paremal, sama positsioon kus praegu ⋮),
  mis avab modaali `tab: 'edit'`-iga.
- Kustuta-nupp (üleval paremal) ja staatus-badge (üleval vasakul) jäävad.
- **Laadi alla** kaob pisipildilt (saadaval teose-lehel; vajadusel hiljem
  lihtne modaali lisada).
- Per-lehe **Asenda pilt** kolib modaali. `handleReplaceImage(file, pageNum)`
  jääb `WorkManage`-i (thumbnail cache-bust + sessionStorage elavad seal) ja
  antakse modaalile propsina. Pisipildi-tasandi `replaceInputRef` /
  `replaceTargetPage` / ⋮-kaudu-avamine eemaldatakse.
- Eraldi "Asenda leheküljed" tab (`activeTab === 'replace'`, upload-viisard)
  **jääb puutumata** — eraldi feature.

### 2. Redaktori-modaal (`PageImageEditorModal.tsx`)

- Uus prop: `onReplaceImage(file: File, pageNum: number) => Promise<void>`.
- Päisesse diskreetne **"Asenda pilt"** nupp (Upload-ikoon) + oma peidetud
  `<input type="file">`. Klõps → failivalik → `onReplaceImage(file,
  current.page_num)`.
- Pärast õnnestumist modaal **värskendab eelvaadet**: cache-bust loendur, mis
  lisatakse pildi-URL-i query-parameetrisse, `imgNatural=null` (uued mõõdud
  uuesti mõõta) ja **lähtestab teisendused** (`resetTransforms`), sest uus pilt
  → vana kärbe/pööre ei kehti.
- Asendamise ajal nupp disabled + spinner.

### 3. Navigatsioon pärast "Rakenda" — muutust ei vaja

Mõlemad tabid liiguvad juba praegu järgmisele lehele (`computeNextAnchor` /
`resolveIndexAfter`), tab püsib oleku kaudu. Vastab kokkuleppele:
edit → järgmine leht, edit-tab; split → järgmine leht, split-tab.

## Mida EI tehta

- Laadi-alla modaali (hiljem vajadusel triviaalne lisada).
- "Asenda leheküljed" upload-viisardi tab.
- Navigatsiooniloogika muutmine.
