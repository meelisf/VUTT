# Markdown-redaktor märkuste/eluloo väljadele — disain

**Kuupäev:** 2026-06-29
**Staatus:** kinnitatud disain, ootab implementatsiooniplaani

## Probleem

Prosopograafia isiku **Märkmed** väli (`person.notes`) on praegu vormindamata:
salvestus tavaline string, kuva `whitespace-pre-wrap`, toimetamine paljas
`<textarea rows={3}>`. Kasutajad kleebivad sinna mh **hiigelpikki URL-e**, mis
ajavad paigutuse laiali ja teevad teksti raskesti loetavaks/toimetatavaks.

Soov: lubada **piiratud vormindus** (pealkirjad, paks, kursiiv, lingid, loendid)
ja teha toimetamine mugavamaks ning **kasutajale selgelt avastatavaks**.

## Olemasolev kontekst (kontrollitud)

- `react-markdown` ^10.1.0 on deps; **juba kasutuses** Eluloo (`biography`)
  renderdamiseks `PersonDetailPage`-l (`<ReactMarkdown>{person.biography}`).
- `rehype-raw` ^7.0.0 on deps, **aga ei ole kusagil kasutuses** → praegune
  `<ReactMarkdown>` escape'ib toore HTML-i (turvaline vaikekäitumine).
- `remark-gfm` **puudub** → paljad URL-id ei muutu praegu klikitavaks.
- `@tailwindcss/typography` (`prose`) **puudub**; ainus markdown-CSS on
  `.markdown-preview p` (`src/index.css:385`). `##` pealkirjad renderduvad seetõttu
  peaaegu stiilitult (Tailwind base reset võtab pealkirjastiili maha).
- CodeMirror 6 (`@codemirror/*`) on projektis (transkriptsiooni-editor), aga
  `VuttMarkupExtension` ei ole siia taaskasutatav: see tunneb XML-tägisid (mitte
  markdownit) ega tunne pealkirju/linke/loendeid.
- `notes?: string | null` on tüüpides ka teostel (`src/types.ts:123,240,320`) ja
  isikul (`src/prosopography/types.ts`). Lehekülje/teose märkuste lahtrid on
  tuleviku-sihtmärgid.

## Otsused

| Otsus | Valik |
|-------|-------|
| Redaktori tüüp | Markdown-nupuriba + eelvaade (mitte WYSIWYG, mitte CodeMirror) |
| Ulatus nüüd | Märkmed **ja** Elulugu, ühe taaskasutatava komponendiga |
| Formaat | **Ainult markdown** (toores HTML escape'itud, XSS-kindel) |
| GFM ulatus | `remark-gfm` autolinkide jaoks, AGA renderdus piiratud `allowedElements`-iga (vt MarkdownView) |
| Nupud | v1: ainult **lisavad** süntaksit; olemasoleva vormingu eemaldamist (toggle) ei tuvastata |
| Avastatavus | Nupuriba alati nähtav + "?" spikker + "Eelvaade" lüliti (vaikimisi **Kirjuta**) |
| Salvestus | Muutusteta — tavaline markdown-string; migratsiooni pole |

## Disainiprintsiip: üldotstarbeline primitiiv

Komponendid elavad `src/components/`-s ja on **domeeni-neutraalsed** — ei tea
midagi isikust/eluloost/märkmetest. API on lihtsalt tekst sisse/välja. Eesmärk:
sama komponenti saab hiljem kasutada **lehekülje ja teose märkuste** lahtrites
(neid kohti praegu ei implementeeri, kuid API ei tohi neid välistada).

## Komponendid

### 1. `MarkdownEditor.tsx` (uus, `src/components/`)

Toimetamiskomponent. Domeeni-neutraalne API:

```ts
interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minRows?: number;          // vaikimisi nt 3; Elulugu kasutab suuremat
  id?: string;               // <label htmlFor> sidumiseks (label on kutsuja oma)
  disabled?: boolean;
}
```

Paigutus (ülevalt alla):
- **Nupuriba** (alati nähtav, raamitud): **B** paks, **I** kursiiv, **H** pealkiri,
  **🔗** link, **•** loend. Ikoonid (lucide-react) + eestikeelsed tooltipid.
- **"Kirjuta" / "Eelvaade" lüliti** (kaks tabi). **Vaikimisi Kirjuta**; Eelvaade
  on valikuline kontroll, mitte põhivaade. Kitsas vormiveerus eelistatud
  kõrvuti-vaatele.
- **Tekstiala** markdown-lähtetekstiga (font-mono, `resize-y`), `minRows`.
- **"?" spikker** — väike popover lühikese süntaksi-näidisega.

Nupukäitumine (manipuleerib `selectionStart/End`, kutsub `onChange`, taastab
valiku). **v1: nupud ainult lisavad süntaksit; olemasoleva vormingu eemaldamist
ei tuvastata** (nt **paks** valiku peal nupp ei eemalda `**`-e):
- **Paks**: mähib valiku `**…**` (või lisab `**paks**` kohahoidja, kui valikut pole).
- **Kursiiv**: `*…*`.
- **Pealkiri**: lisab rea algusesse `## `.
- **Loend**: lisab `- ` igale valitud reale, **mis seda veel ei alga** (väldib
  topeldamist; ei eemalda olemasolevat prefiksit).
- **Link** (hiigellinkide lahendus): avab pisi-popoveri kahe väljaga — "Lingi tekst"
  ja "URL"; lisab `[tekst](url)`. Pikk URL kaob lühikese sõna taha.
  **Valiku eeltäide:**
  - kui valik näeb välja nagu URL (algab `http://`/`https://`/`www.`) → URL-väli =
    valik, lingitekst tühi (fookus lingitekstil);
  - muidu → lingitekst = valik, URL-väli tühi.

**Testitavus:** kogu tekstiteisendus eraldatakse puhasteks funktsioonideks
`src/components/markdownEditorHelpers.ts`-i, nt:

```ts
applyWrap(text, start, end, marker): { text, start, end }   // paks/kursiiv
applyLinePrefix(text, start, end, prefix): { text, start, end } // pealkiri/loend
insertLink(text, start, end, label, url): { text, start, end }
```

Need on DOM-vabad ja unit-testitavad.

**Käitumisdetailid (DOM-pool):**

- **Dünaamiline kõrgus:** `useLayoutEffect` seab kõrguse `scrollHeight` järgi
  (kasvab sisuga). Alampiir = `minRows`, ülempiir ~500px → seejärel
  `overflow-y-auto`. Ei lisata uut sõltuvust (mitte `react-textarea-autosize`,
  mitte `field-sizing: content` brauseritoe-lünga tõttu).
- **Lingi-popoveri fookus / A11y:**
  - enne popoveri avamist salvestatakse textarea valik (`selectionStart/End`);
  - avamisel liigub fookus automaatselt esimesele väljale (URL-eeltäite korral
    "Lingi tekst", muidu samuti esimesele loogilisele väljale);
  - Tab liigub väljade ja nuppude vahel popoveris;
  - sulgemine (Salvesta / Loobu / **Esc**) tagastab fookuse textarea-sse **täpselt
    salvestatud valikule** (insert toimub salvestatud positsioonile).
- **Undo/Redo piirang (v1, teadlik):** programmiline väärtuse muutmine võib mõnes
  brauseris lõhkuda textarea natiivse Ctrl/Cmd+Z ajaloo (Undo võib eemaldada
  oodatust suurema tüki). Aktsepteeritud v1-s. Kui testimisel kriitiline →
  eelistada lisamis-teel `document.execCommand('insertText', …)`-i (ametlikult
  deprecated, kuid säilitab natiivse undo-ajaloo) või hallata lihtsat lokaalset
  undo-stacki komponendi olekus.

### 2. `MarkdownView.tsx` (uus, `src/components/`)

Renderduskomponent:

```ts
interface MarkdownViewProps {
  content: string;
  className?: string;
}
```

- `<ReactMarkdown remarkPlugins={[remarkGfm]}>` `.vutt-md` konteineris.
- **Uus dep: `remark-gfm`** — vajalik paljaste URL-ide autolinkimiseks (vanade
  märkmete jaoks). NB: gfm lisab ka tabelid, footnote'd, tasklist'id — neid me
  **ei taha**, seega piiratakse renderdus allow-listiga (allpool).
- **`allowedElements`** allow-list (tehniliselt piiratud markdown):
  `p, strong, em, del, a, ul, ol, li, h1, h2, h3, blockquote, code, br`.
  Pluss **`unwrapDisallowed`** → keelatud element (nt tabel) ei kao tervenisti,
  vaid säilitab oma tekstisisu.
- Markdown-only: **ei kasuta `rehype-raw`-i** → toores HTML escape'itud.
- Kohandatud `a`-komponent: `target="_blank" rel="noopener noreferrer"`.
- **URL-turvalisus:** react-markdowni vaikimisi `urlTransform` lubab ainult kindlaid
  protokolle (http, https, mailto, suhtelised); `javascript:` ei kuulu lubatute
  hulka.
- **Tühi sisu:** kui `content` on tühi/ainult tühikud → tagastab `null` (ei renderda
  tühja `.vutt-md` blokki). Sektsiooni kuvamise otsustab kutsuja (nt `person.notes &&`).

### 3. CSS `.vutt-md` (`src/index.css`)

Renderdatud markdowni stiil, kitsalt skoobitud `.vutt-md` alla (et ei lekiks
transkriptsiooni `.markdown-preview`-sse):
- pealkirjad h1–h3 (taastab suurused, mille Tailwind reset maha võttis), paks, kursiiv;
- `.vutt-md p { margin: 0 0 0.75rem; }` (lõiguvahe);
- `.vutt-md ul, .vutt-md ol { padding-left: 1.5rem; }` + loendi-markerid (`list-style`);
- `.vutt-md a` — sinine, alla-joonitud, **`overflow-wrap: anywhere`** (väga pikad
  arhiivi-URL-id murduvad usaldusväärsemalt kui `break-word`);
- `.vutt-md` üldine **`overflow-wrap: break-word`** muu teksti jaoks.

## Integratsioon

| Koht | Enne | Pärast |
|------|------|--------|
| `PersonEditPage` Märkmed | `<textarea rows={3}>` | `<MarkdownEditor minRows={3}>` |
| `PersonEditPage` Elulugu | `<textarea rows={8}>` + "(markdown)" vihje | `<MarkdownEditor minRows={8}>` |
| `PersonDetailPage` Märkmed | `<p whitespace-pre-wrap>` | `<MarkdownView>` |
| `PersonDetailPage` Elulugu | paljas `<ReactMarkdown>` | `<MarkdownView>` (gfm + stiil) |

## Andmed / salvestus

Muutusteta. `notes` ja `biography` jäävad tavalisteks markdown-stringideks.
**Migratsiooni pole.** Vanad väärtused renderduvad: tavatekst nagu on, paljad
URL-id muutuvad klikitavaks. Backend ei muutu.

## Turvalisus

Markdown-only, `rehype-raw` väljas → toores HTML escape'itud (XSS-kindel).
Lingi-URL-id: react-markdowni vaikimisi `urlTransform` lubab ainult kindlaid
protokolle (http, https, mailto, suhtelised), `javascript:` ei kuulu lubatute
hulka. `allowedElements` allow-list piirab renderduva DOM-i täiendavalt.

## i18n

Tooltipid (paks/kursiiv/pealkiri/link/loend), "Eelvaade"/"Kirjuta", spikri tekst,
lingi-popoveri sildid → lisada nii `src/locales/et/` kui `src/locales/en/`
(prosopography või common namespace).

## Testid ja värav

`markdownEditorHelpers.ts` puhaste funktsioonide unit-testid, sh konkreetsed
juhtumid:
1. **Link valikuga** (mitte-URL tekst): `Johann Fischer` → `[Johann Fischer](url)`,
   lingitekst eeltäidetud valikuga.
2. **Link ilma valikuta**: lisab kohahoidja `[tekst](url)`, valik lingitekstil.
3. **Link valik = URL**: valik `https://…` → URL-väli eeltäidetud, lingitekst tühi.
4. **Mitmerealine loend, osa ridu juba `- ` prefiksiga**: prefiks lisatakse ainult
   prefiksita ridadele (topeldamist ei teki).
5. **Paks tühja valikuga** → `**paks**` kohahoidja.

Frontend-värav: `npm run typecheck` (mitte ainult `build`).

**Käsitsi QA (DOM/brauser):**
- Lingi-popoveri fookus: avaneb fookusega väljal, Tab töötab, Esc/Salvesta/Loobu
  viib fookuse tagasi textarea-sse.
- Undo (Ctrl/Cmd+Z) käitumine pärast nupuvajutust — kontrolli, kas piirang on
  talutav.
- Dünaamiline kõrgus kasvab sisuga ja peatub ~500px juures (siis scroll).
- **Kleebitud GFM-tabel** renderdub `unwrapDisallowed` tõttu joosva tekstina (ei
  kao ära) — visuaalselt vastuvõetav, mitte liiga segadusttekitav.

## YAGNI (teadlikult välja)

Kõrvuti-eelvaade, **tabelid/footnote'd/tasklist'id** (gfm lubab need süntaksina,
aga `allowedElements` ei renderda neid struktuurina — tekst säilib), pildid,
värvid, fondisuuruse valik, vormingu-eemaldamise toggle, WYSIWYG,
CodeMirror-integratsioon, lehekülje/teose märkuste lahtrite tegelik ümberlülitus
(ainult API valmidus).

## Tuleviku-sihtmärgid (ei implementeeri nüüd)

- Lehekülje märkuste lahter → `<MarkdownEditor>` / `<MarkdownView>`.
- Teose märkused (`work.notes`) → sama.
