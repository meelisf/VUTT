# Ühtne salvestamata muudatuste dialoog

**Kuupäev:** 2026-07-28
**Staatus:** disain kinnitatud, plaan tegemata

## Probleem

Salvestamata muudatuste hoiatus käitub rakenduses neljal erineval moel. Kasutaja
ei saa käitumist ette aimata ja peab iga dialoogi eraldi lugema.

| Koht | Mehhanism | Nupud |
|---|---|---|
| `Workspace.tsx:782` (tekst) | `ConfirmModal` + `useUnsavedChangesGuard` | *Ei, lahku* (hall) / **Jah, salvesta** (sinine) — "jää" varianti ei ole |
| `PersonEditPage.tsx:949` (prosopo) | `ConfirmModal` + sama guard | *Jää* (hall) / **Lahku ilma salvestamata** (sinine primary) |
| `Places.tsx:288` (kohad) | käsitsi kirjutatud modaal, ainult koha vahetusel | *Jää siia* (hall) / **Lahku ilma salvestamata** (punane) |
| `WorkManage.tsx:369,377` | natiivne `window.confirm` | OK / Cancel |

Kaardistamisel leitud lisaprobleemid:

1. **Kohtade registris puudub lahkumiskaitse täielikult.** `useUnsavedChangesGuard`
   ega `beforeunload` ei ole ühendatud — muudatused kaovad vaikselt, kui lahkud
   lehelt või sulged tab-i.
2. **Prosopograafias on hävitav valik sinine primary-nupp** (`variant="warning"`
   annab `ConfirmModal`-is `bg-primary-600`) — kõige rõhutatum nupp on "kaota töö".
3. **Salvestusvea korral kaob töö.** `useEditorSave.ts:76-79` püüab vea kinni ja
   promise **resolvib**; `Workspace.tsx:518` navigeerib seetõttu alati ära. Kommentaar
   "alert on juba TextEditoris" on eksitav — see banner renderdub komponendis, mis
   on kohe lahkumas.
4. **Tekstiredaktoris ei saa dialoogist loobuda.** `onCancel` on seotud
   `handleConfirmLeave`-iga, mis lahkub; Esc ega taustaklõps ei reageeri.
5. **Kohtade dirty-lipp on vale.** `PlacesDetail.tsx:111`: `onDirtyChange?.(editing)`
   — lipp on püsti alati, kui redigeerimisrežiim on lahti, ka siis kui midagi pole
   muudetud.

## Eesmärk

Üks dialoog, üks käitumine, samad sõnad kõikjal. Kasutaja õpib selle korra selgeks
ja teab edaspidi ette, mis juhtub.

## Lahendus

### Dialoog

Uus komponent `src/components/UnsavedChangesDialog.tsx`. **Ei** ole `ConfirmModal`
laiendus: `ConfirmModal` on üldine kahe-nupu kinnitus (`extraText`/`onExtra` on
sinna juba jõuga lisatud kolmas nupp), salvestamata muudatuste dialoogil on püsiv
kolme-nupu kuju, oma salvestusloogika ja fikseeritud tekstid.

```
⚠  Salvestamata muudatused
Sul on salvestamata muudatusi.

[Loobu muudatustest]   [Jää siia]   [Salvesta ja jätka]
   bg-red-600         hall ääris      bg-amber-500
```

**Värvivalik lähtub olemasolevatest signaalidest, mitte üldistest konventsioonidest:**

- Kollane `bg-amber-500` = "siin on salvestamata töö, vajuta mind". Sama värv on
  juba SALVESTA nupul `EditorHeader.tsx:75-78`, mis muutub `bg-primary-600`-lt
  `bg-amber-500`-ks täpselt siis, kui `hasUnsavedChanges || statusDirty`.
- Punane `bg-red-600` = hävitav kinnitus. Sama värv juba `Places.tsx:302`.

### Invariandid

Need on "prognoositavuse" tegelik sisu ja neid ei tohi ükski kasutuskoht murda:

1. **Kollane nupp ei vii sihtkohta enne, kui salvestamine on õnnestunud.**
   Ebaõnnestumisel jääb dialoog avatuks, midagi ei kao.
2. **Salvestamise ajal on kõik kolm nuppu disabled**, kollasel spinner. Topeltklikk
   ei tekita kahte salvestust.
3. **Esc ja taustaklõps = "Jää siia".** Alati, igas kasutuskohas.
4. **Fookus avanemisel on "Jää siia" peal.** Enter ei tee midagi hävitavat.
5. **Nuppude järjekord, värv ja tekst on kõikjal identsed** — ka siis, kui dialoog
   tuli lehepöördest, mitte lahkumisest. Sihtkohta nupusildid ei nimeta.
6. **Kolm nuppu alati.** `onSave` on kohustuslik prop; kõigis kasutuskohtades
   salvestusfunktsioon eksisteerib. Ei ole olekut, kus dialoog näeb teistsugune välja.

### Salvestamise leping

```ts
onSave: () => Promise<boolean>   // true = salvestatud, false = ebaõnnestus
```

Boolean, mitte erind. Põhjus: kõik kolm salvestusteed **juba** püüavad vea kinni ja
kuvavad selle oma veabanneris (`useEditorSave` → `setSaveError`, `PersonEditPage` →
`setError`, `PlacesDetail` → `setSaveError`). Erindite läbi laskmine tähendaks selle
kihi ümberehitust ja tekitaks käsitlemata rejection'eid tavalise SALVESTA nupu teel.

`false` korral kuvab dialoog lühikese rea "Salvestamine ebaõnnestus — muudatused on
alles"; detailne põhjus jääb lehe enda veabannerisse.

### Hook

`src/hooks/useUnsavedChangesGuard.ts` kirjutatakse ümber objekt-argumendile:

```ts
const { dialogProps, confirmAction } = useUnsavedChangesGuard({
  isDirty,
  onSave,    // () => Promise<boolean>
  skipRef,   // olemasolev muster jääb alles
});

<UnsavedChangesDialog {...dialogProps} />

// Lehesisesed üleminekud (lehepööre, koha vahetus):
confirmAction(() => navigate(`/work/${workId}/${newPage}`, { replace: true }));
```

`confirmAction(fn)`: kui puhas → käivitab `fn()` kohe; kui dirty → avab dialoogi ja
jätab `fn` ootele. See on üldistus sellest, mida `Workspace.tsx` teeb praegu käsitsi
`pendingNavigation`-iga viies kohas ja `Places.tsx` `pendingKey`-ga. Mõlemad käsitsi
mehhanismid kaovad.

Hook katab kolm sisendit ühe dialoogiga:

- React Routeri `useBlocker` — lehelt lahkumine
- `beforeunload` — tab-i sulgemine (brauseri oma dialoog, seda me ei kontrolli)
- `confirmAction` — lehesisene üleminek

### Puhas loogikamoodul

`src/hooks/unsavedChangesFlow.ts` — otsustusloogika DOM-i ja Reactita, sama
muster mis `markdownEditorHelpers.ts`. Siin elab kriitiline invariant: ootel tegevus
käivitub ainult siis, kui `onSave` tagastas `true`.

## Ulatus

| Fail | Muudatus |
|---|---|
| `components/UnsavedChangesDialog.tsx` | **uus** — kolme-nupu dialoog, Esc/taust, spinner, veerida |
| `hooks/unsavedChangesFlow.ts` | **uus** — puhas otsustusloogika |
| `hooks/__tests__/unsavedChangesFlow.test.ts` | **uus** — node-testid |
| `hooks/useUnsavedChangesGuard.ts` | ümber kirjutatud: objekt-argument, `onSave`, `confirmAction`, `dialogProps` |
| `pages/Workspace.tsx` | `pendingNavigation` kaob (read 152, 375, 395, 479, 494) → `confirmAction`; `handleSaveAndLeave` ei navigeeri vea korral |
| `components/editor/useEditorSave.ts` | `runSave` ja `handleSaveWithDrafts` tagastavad `boolean` |
| `prosopography/pages/PersonEditPage.tsx` | `handleSave` jagatud `savePerson()` + nupu-handleriks (praegu navigeerib ise, read 208/213); `ConfirmModal` → `UnsavedChangesDialog` |
| `pages/admin/Places.tsx` | guard lisatud (puudus täiesti), käsitsi modaal (288-309) kaob, `pendingKey` → `confirmAction` |
| `pages/admin/PlacesDetail.tsx` | päris dirty-arvutus `editing` asemel; `handleSave` `boolean`-iks ja `saveRef` kaudu üles |
| `pages/WorkManage.tsx` | 2× `window.confirm` → `ConfirmModal`; guard `changedCount > 0` peale; `onSave` = järjekorra salvestus **ilma** pesastatud kinnituseta |
| `components/ConfirmModal.tsx` | Esc + taustaklõps = tühista |
| `locales/{et,en}/common.json` | uued `unsavedChanges.*` võtmed |
| `locales/{et,en}/admin.json` | `places.unsaved*` kustutatud |
| `locales/{et,en}/workspace.json` | `confirm.*` kustutatud |

### WorkManage'i erisus

`handleReorderSave` (`WorkManage.tsx:375`) küsib ise kinnitust `window.confirm`-iga.
Kui kasutaja valib lahkumisdialoogist "Salvesta ja jätka", ei tohi järjekorra
kinnitus uuesti ette hüpata. Salvestus jagatakse: `saveReorder()` (ilma kinnituseta,
kasutab dialoog) + nupu-handler, mis küsib kinnituse ja kutsub `saveReorder()`.

`handleDiscardReorder` (`WorkManage.tsx:368`) jääb kahe-nupu kinnituseks
(`ConfirmModal`) — see ei ole lahkumisdialoog, vaid "viska N muudatust ära".

### Tõlked

Mõlemad keeled korraga, muidu katkeb build (`localeParity.test.ts`, `fallbackLng`
on välja lülitatud — ADR 0011).

`common:unsavedChanges`:

| Võti | et | en |
|---|---|---|
| `title` | Salvestamata muudatused | Unsaved changes |
| `message` | Sul on salvestamata muudatusi. | You have unsaved changes. |
| `discard` | Loobu muudatustest | Discard changes |
| `stay` | Jää siia | Stay here |
| `saveAndContinue` | Salvesta ja jätka | Save and continue |
| `saveFailed` | Salvestamine ebaõnnestus — muudatused on alles. | Save failed — your changes are still here. |

## Ulatusest väljas

- `MetadataModal` ja teised modaalid, mille sulgemisel võib olla salvestamata sisu.
- `admin/Collections.tsx` (`CollectionEditor`) — salvestab kohe, dirty-olekut ei teki.
- Kolme-nupu dialoogi kasutamine hävitavate tegevuste (kustutamine) kinnitamiseks —
  need jäävad `ConfirmModal`-i.

## Testimine

`src/hooks/__tests__/unsavedChangesFlow.test.ts`, vitest `environment: 'node'`,
uusi sõltuvusi ei lisata. Kaetavad juhud:

- ootel tegevus käivitub, kui `onSave` tagastab `true`
- ootel tegevus **ei** käivitu, kui `onSave` tagastab `false`; dialoog jääb avatuks
- "Loobu muudatustest" käivitab ootel tegevuse salvestamata
- "Jää siia" tühistab ootel tegevuse
- `confirmAction` puhta oleku korral käivitab tegevuse dialoogi avamata
- salvestamise ajal saabuv teine kutse ei tekita teist salvestust

Dialoogi visuaal, fookus ja Esc-käitumine kontrollitakse käsitsi kõigis neljas
kohas (jsdom/testing-library infrat projektis ei ole ja seda ei lisata).

Väravad: `npm run typecheck` ja `npm run test`.

## Otsuste põhjendused

**Miks kollane salvestusnupule, mitte sinine primary?** Esialgu pakkusin sinist
primary-nuppu üldise konventsiooni järgi (ohutu tegevus on rõhutatud). Rakenduses on
aga kollane juba tähenduses "siin on salvestamata töö" (`EditorHeader.tsx:76`).
Sinine katkestaks olemasoleva signaali; kollane jätkab seda.

**Miks samad sõnad ka lehepöördel?** Sihtkoha järgi kohandatud sildid ("Salvesta ja
mine", "Salvesta ja vaheta") on täpsemad, aga tekitavad kolm variatsiooni. Eesmärk on
prognoositavus: sama kolm nuppu, samad sõnad, sama järjekord, olenemata sellest,
kust dialoog tuli.

**Miks eraldi komponent, mitte `ConfirmModal`?** Vt "Dialoog" ülal.
