# Marginaalia-editor: servajuhud, kaitsemehhanismid ja test-harness

> **Miks see fail on olemas.** Marginaalia kustutamis-/redigeerimisloogika CodeMirror 6-s
> on osutunud habras: peidetud atomic-tägide, kaitsefiltri ja avatud/suletud plokkide
> koosmõju tekitab mitte-ilmseid servajuhte, mida on raske käsitsi reprodutseerida.
> See dokument koondab (a) arhitektuuri, mida pead teadma enne muudatust, (b) konkreetsed
> bugid ja parandused, (c) servajuhtude loendi ning (d) **korratava Playwright-harnessi**,
> millega muudatusi verifitseerida ilma terve rakendust käivitamata.
>
> Seotud failid:
> - `src/components/editor/MarginaliaExtension.ts` — editor-loogika (see dokument keskendub siia)
> - `src/utils/marginaliaUtils.ts` — `findMarginaliaBlocks`, plokistruktuur
> - `docs/superpowers/plans/2026-06-13-marginalia-overlay-rendering.md` — overlay-arhitektuur
> - `server/marginalia_normalize.py` — salvestus-aegne normaliseerimine (`<m>` välimiseks, `strip_empty_tags`)
> - CLAUDE.md → "Marginaalia — normaliseerimine ja kopeerimine"

---

## 1. Arhitektuur, mida pead teadma enne muudatust

> **Kanooniline formaat (ADR 0009):** iga füüsiline marginaaliarida on eraldi
> `<m>…</m>` plokk. Parser ja allolevad kustutustestid toetavad legacy-andmete tõttu
> jätkuvalt ka vanu mitmerealisi plokke, kuid uued editoritoimingud ei tohi neid ega
> pesastatud `<m>` paare juurde luua.

### Plokistruktuur (`MarginaliaBlock`, `marginaliaUtils.ts`)

Iga `<m>…</m>` plokk parsitakse positsioonideks (märgi-offsetid dokumendis):

| Väli | Tähendus |
|------|----------|
| `from` | `<m>` tägi **algus** |
| `to` | `</m>` tägi **lõpp** |
| `contentFrom` | sisu algus = `from + 3` (`<m>` on 3 märki) |
| `contentTo` | sisu lõpp = `to - 4` (`</m>` on 4 märki) |
| `hideFrom` / `hideTo` | **peidetav ala**: ploki read koos ÜHE reavahetusega (lõpus või, dokumendi lõpus, ees) |
| `anchorPos` | ankrurea algus — rida, mille kõrval plokk veerus seisab |

Järjestikused plokid liidetakse **grupiks** (`groupMarginaliaBlocks`); grupi `hideFrom..hideTo`
on pidev. Avamine märgistab kogu grupi (vt allpool).

### Avatud vs suletud plokk — KRIITILINE eristus

- **Suletud plokk** (`openMarks` ei kata seda): sisu on **peidetud** block-replace'iga ja
  renderdatud eraldi DOM-ülekattena. Tekstis on tägid + sisu olemas, aga **atomic** — kursor
  ei saa sisse, ja `marginaliaProtectionFilter` **kaitseb peidetud vahemikku** kustutuste eest.
- **Avatud plokk** (muutmisrežiim, "kollane kast"): toortekst on inline nähtav, kursor liigub
  sees vabalt, kaitsefilter EI kehti (sest vahemik pole enam `hiddenBlockRanges`-is).

Olek: `marginaliaField` → `{ blocks, openMarks }`. Avatust hoitakse "markeriga" (positsioon
ploki sees), mida map'itakse läbi dokumendimuudatuste. `openMarginalia` / `closeMarginalia` /
`closeAllMarginalia` on eksporditud `StateEffect`-id.

### `marginaliaProtectionFilter` (transactionFilter)

Filtreerib AINULT `Transaction.userEvent`-iga tehinguid (kasutaja input/delete). Kui kasutaja
kustutus kattub peidetud (suletud) ploki vahemikuga, lõigatakse see osa muudatusest välja.
**Tagajärg testimisel:** suletud plokile suunatud programmaatiline kustutus, millel on
`userEvent`, BLOKEERITAKSE. See on ohutu käitumine (ei saa kogemata suletud kasti kustutada),
aga tähendab, et **servajuhte tuleb testida AVATUD plokil** — vastasel juhul mõõdad filtrit,
mitte oma loogikat.

### atomicRanges

Suletud ploki tägid (ja overlay) on `EditorView.atomicRanges` — kursor hüppab üle. Avatud
ploki **tägid** (`<m>`, `</m>`) on `Decoration.replace({})` (peidetud, ei võta ruumi), aga
sisu on tavaline redigeeritav tekst.

---

## 2. Bugiklass ja konkreetne parandus (2026-06-17)

### Sümptom (kasutaja raport)

> "Kui löön tühja rea (kollase kasti sees) ja selle kustutan, siis rida kustub, aga kast
> ei säili — tekib mitte-marginaalia rida ja lõhub olemasoleva pika marginaalia ploki kaheks,
> ning sellele tühjale reale eelnev ja järgnev rida muutuvad ka tavatekstiks."

### Juurpõhjus

`<m>humanam\nChristi na-\nturam … adaptavit.</m>` tüüpi **mitme reaga sisu** korral:

1. Kursor sisu **lõpus** (vahetult PEIDETUD `</m>` ees). Enter → tekib nähtaval-tühi rida,
   mis kannab peidetud `</m>`-i.
2. Edasi-suunaline **Delete** sööb atomic `</m>` tägi ära → plokk muutub `…adaptavit.` ilma
   sulgeva tägita → kogu sisu muutub tavatekstiks ja järgnev `<m>`-plokk "imendub", lõhkudes
   ploki kaheks.

Brute-force (vt §4) näitas: **Backspace oli puhas, Delete lõhkus**. Algne handler kattis
ainult **täiesti tühja** plokki (`<m></m>` / `<m>\n</m>`), mitte nähtaval-tühja rida
mitte-tühja ploki sees.

### Parandus — `deleteMarginaliaEmptyLine(view)`

Seotud `Backspace` ja `Delete` külge (`marginaliaKeymap`). Kaks juhtu:

1. **Täiesti tühi plokk** (`contentFrom..contentTo` trim = `''`) → eemalda KOGU plokk
   (`hideFrom..hideTo`) ühe vajutusega. (Vana käitumine, säilitatud.)
2. **Nähtaval-tühi rida MITTE-tühja ploki sees** → eemalda ainult **eelnev reavahetus**
   (liida rida üles, `from: line.from - 1, to: line.from`); tägid jäävad alles, plokk ei
   lõhene. Eeltingimused: rida tag-strip'i järel tühi JA `line.from > blk.from` (mitte
   esimene rida — pole eelnevat `\n`).

Mõlemad dispatch'ivad `userEvent: 'delete.marginalia'`. Tagastab `false`, kui rida pole
nähtaval-tühi → vaikimisi kustutus jätkub. Kood: `MarginaliaExtension.ts` ~rida 455–502.

> **NB tähelepanek juhtumi 2 kohta:** parandus eemaldab `line.from - 1` reavahetuse
> sõltumata Backspace/Delete'ist. See on tahtlik — eesmärk on liita nähtaval-tühi rida üles,
> mitte sööta atomic-tägi. Kui tulevikus muudad, säilita invariant "tägi ei tohi kustuda".

---

## 3. Servajuhtude loend (invariandid, mida muudatus EI TOHI rikkuda)

| # | Stsenaarium | Oodatud tulemus |
|---|-------------|-----------------|
| E1 | Avatud kast, tühi rida sisu **keskel**, Enter+Backspace | tühi rida kaob, plokk terve, `<m>`/`</m>` tasakaalus |
| E2 | Avatud kast, tühi rida sisu **keskel**, Enter+Delete | sama kui E1 |
| E3 | Avatud kast, Enter sisu **lõpus** (enne `</m>`), siis Delete | `</m>` EI kustu, plokk ei lõhene |
| E4 | Avatud kast, Enter sisu **alguses** (pärast `<m>`), siis Backspace | `<m>` EI kustu, plokk ei lõhene |
| E5 | **Avatud** täiesti tühi plokk (`<m>\n</m>`), Backspace/Delete | kogu plokk kaob (`<m>` arv −1), tasakaalus |
| E6 | **Suletud** plokk, kursor "sees", kustutus | kaitsefilter blokeerib → plokk puutumata (ohutu) |
| E7 | Suvaline kustutus | `<m>` arv == `</m>` arv (tagid tasakaalus, ei jää orvuks `<m><m>`/`</m></m>`) |
| E8 | Marginalia-nupp avatud marginaalias | no-op; uut ega pesastatud `<m>` paari ei teki |
| E9 | Mitmerealine valik → Marginalia | iga füüsiline rida saab oma `<m>…</m>` paari |

Lisaks: salvestusel `server/marginalia_normalize.py` koristab jääk-tühjad tägid
(`strip_empty_tags`) ja teeb `<m>` välimiseks — seega editori-poolne väike "lohakus"
(nt jääk-tühi rida ploki sees) normaliseeritakse niikuinii. Editor peab tagama AINULT, et
**tagid ei lähe tasakaalust välja ega leki sisu tavatekstiks**.

---

## 4. Test-harness — kuidas see ehitati ja kuidas seda jooksutada

Harness laseb testida marginaalia-editorit **isoleeritult** (ainult CM6 + extensionid, ilma
React-rakenduse, autentimise, serverita) päris Chrome'is (vajalik, sest klaviatuuri-, atomic-
ja clipboard-käitumine ei reprodutseeru jsdom'is).

### 4.1 `repro/` kaust (git-is, dev-only — ei lähe production-buildi)

```
repro/
├── index.html    # minimaalne leht: #editor div + module-skript
├── main.ts       # ehitab EditorView samade extensionidega kui päris app
└── pagetext.ts   # PAGE_TEXT — päris lehe toortekst (mitme reaga <m> plokid, tühjad plokid)
```

`main.ts` võtmekohad:
- Impordib **samad** extensionid mis päris editor: `vuttMarkupExtension`,
  `marginaliaExtension('column')`, `vuttTheme`, ja `cut`/`paste` domEventHandlerid
  (clipboard-loogika peegeldus `TextEditor.tsx`-ist).
- Ekspordib `window`-ile testimis-konksud:
  - `window.__view` — `EditorView`
  - `window.__mf` — `marginaliaField` (oleku lugemiseks)
  - `window.__findBlocks` — `findMarginaliaBlocks`
  - `window.__openBlockContaining(marker)` — leiab markeriga ploki ja dispatchib
    `openMarginalia.of(blk.contentFrom)` → **avab kasti nagu kasutaja klikiks**

`pagetext.ts` sisaldab tahtlikult keerulist päris-lehte: mitme reaga sisuga plokid
(`<m>humanam\nChristi na-\nturam…adaptavit.</m>`), täiesti tühjad plokid (`<m>\n</m>`),
ristuvaid `<i>` jms.

### 4.2 Harnessi taasloomine (kui `repro/` on kustutatud)

1. Loo `repro/index.html`, `repro/main.ts`, `repro/pagetext.ts` (vt struktuur ülal). Lihtsaim:
   võta `PAGE_TEXT` mõne päris teose lehe `.txt` sisust, kus on rikkalikult marginaaliat.
2. `main.ts` peab importima `MarginaliaExtension`-ist **ka** `openMarginalia` ja eksponeerima
   `window.__openBlockContaining`. ILMA selleta saad testida ainult suletud plokke (kus
   kaitsefilter varjab su loogika — vt §1).
3. Vite serveerib `repro/index.html` automaatselt: `npm run dev` → `http://localhost:3000/repro/index.html`
   (port tuleb `vite.config`-ist; vaata `npm run dev` väljundist).

### 4.3 Playwright-skript

Playwright-core on juba olemas npx-cache'is. **Gotcha:** paigaldatud `playwright-core` võib
oodata uuemat Chromium-buildi kui on alla laetud (`Executable doesn't exist at …
chromium_headless_shell-1228…`). Lahendus — suuna otse olemasolevale binaarile:

```js
import pw from '/home/mf/.npm/_npx/<hash>/node_modules/playwright-core/index.js';
const browser = await pw.chromium.launch({
  executablePath: '/home/mf/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome'
});
```

(Leia binaar: `find ~/.cache/ms-playwright/chromium-* -name chrome -type f`.)

Tüüpiline trial-funktsioon (taaslaeb dokumendi iga katse jaoks, avab ploki, seab kursori
**markeri järgi** — mitte fikseeritud offset, sest see hägustub teisendustes):

```js
async function trial(label, marker, off, keys) {
  await page.reload();
  await page.waitForFunction(() => window.__view && window.__view.state.doc.length > 100);
  await page.evaluate((m) => window.__openBlockContaining(m), marker);      // ava kast
  const pos = await page.evaluate(([m,o]) =>
    window.__view.state.doc.toString().indexOf(m)+o, [marker, off]);
  await page.evaluate((p) => {
    window.__view.dispatch({ selection: { anchor: p } }); window.__view.focus();
  }, pos);
  for (const k of keys) await page.keyboard.press(k);
  const out = await page.evaluate(() => {
    const t = window.__view.state.doc.toString();
    return { m:(t.match(/<m>/g)||[]).length, eq:(t.match(/<\/m>/g)||[]).length };
  });
  console.log(`[${label}] <m>=${out.m} </m>=${out.eq}`);   // tasakaal = tervis
}
```

**Põhiline tervisemõõdik:** `<m>` arv == `</m>` arv ENNE ja PÄRAST, ning baseline'i suhtes
(ootamatu kasv = plokk lõhenes; kahanemine ainult E5 tühja-ploki kustutuse korral).

### 4.4 Verifitseerimise jooksutamine

```bash
# 1) käivita dev-server (taustal)
(npm run dev > /tmp/vite.log 2>&1 &); sleep 4

# 2) jooksuta skript
node /tmp/verify.mjs

# 3) ÄRA võta serverit maha enne kui kõik servajuhud rohelised
```

2026-06-17 verifitseerimise tulemused (avatud kast, päris lehe andmed):
- E1/E2 (tühi rida keskel, Enter+Backspace/Delete): `<m>=38 </m>=38`, tühi rida eemaldatud, sisu pidev
- E3 (Enter sisu lõpus + Delete): `<m>=38 </m>=38`, `</m>` säilis
- E4 (Enter sisu alguses + Backspace): `<m>=38 </m>=38`
- E5 (avatud tühi plokk, Backspace/Delete): `<m>` 38 → 37 (delta −1), tasakaalus
- E6 (suletud plokk): kaitsefilter blokeeris, plokk puutumata

### 4.5 Deploy-verifitseerimine

Pärast `npm run build` kontrolli, et fix jõudis bundlesse (funktsiooninimi minifitseeritakse,
aga string-literaal `delete.marginalia` säilib):

```bash
grep -l "delete.marginalia" dist/assets/*.js   # → Workspace-*.js
```

Frontend deploy: `rsync -avz dist/ vutt:~/VUTT/dist/`

### 4.6 Harnessi mahavõtmine

Kui servajuhud on rohelised ja oled valmis, võta harness maha:

```bash
# 1) peata dev-server
pkill -f vite

# 2) korista ühekordsed verify-skriptid (need ei ole git-is)
rm -f /tmp/verify*.mjs

# 3) kinnita, et server on maas
curl -s -o /dev/null -w "%{http_code}\n" --max-time 3 http://localhost:3000/ || echo down
ps aux | grep -E "node.*vite|vite/bin" | grep -v grep || echo "fully down"
```

**Gotcha:** `pgrep -f vite` annab pärast tapmist sageli valepositiivse — `pgrep`-i ENDA
käsurida sisaldab sõna "vite" ja matchib iseennast. Kontrolli `ps aux | grep node.*vite`
asemel, või ignoreeri ainsat järelejäänud rida, mis on su grep-käsk ise.

`repro/` jääb alles (git-is, korduvkasutuseks). Järgmisel korral piisab `npm run dev`-ist —
harnessi ei pea uuesti ehitama.

---

## 5. Juhised tulevasele tööle siin

- **Testi alati AVATUD plokil.** Suletud plokil mõõdad `marginaliaProtectionFilter`-it, mitte
  oma loogikat (§1, E6).
- **Tervisemõõdik on tagide tasakaal** (`<m>` == `</m>`), mitte visuaalne väljanägemine. Jääk-
  tühjad read ploki sees on talutavad — `strip_empty_tags` koristab salvestamisel.
- **Ära söö atomic-tägi.** Iga uus kustutus-/Enter-handler peab tagama, et `<m>`/`</m>`
  ei satu muudatusse. Eelista "liida rida üles" (eemalda `\n`) lähenemist tägi-positsiooni
  kustutamisele.
- **Keymap-järjekord:** marginaalia handlerid `Backspace`/`Delete` peavad jooksma ENNE
  CM-i vaikimisi kustutust ja tagastama `true`, kui käsitlesid; `false`, kui mitte (lased edasi).
- **Kaitsefilter peab jääma extension-listi viimaseks** (vt CLAUDE.md VuttMarkupExtension reegel).
- Brute-force lähenemine bugi LEIDMISEKS (kui sümptom on ähmane): ava grupp, proovi
  Enter+Backspace ja Enter+Delete **paljudes kursoripositsioonides** ja flag'i iga tulemus,
  kus tekib `</m><m>` ühel real, orb-tägi või tasakaalu-muutus. Nii leiti see konkreetne bug.
- Harnessi `repro/` on git-is (dev-only vite-entry, ei satu production-buildi). Verify-
  skriptid (`/tmp/verify*.mjs`) on ühekordsed ja git-is ei hoita — taaslooda §4.3 mustri järgi.
