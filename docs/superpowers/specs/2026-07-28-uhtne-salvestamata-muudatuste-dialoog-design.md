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
kolme-nupu kuju ja fikseeritud tekstid.

**Dialoog on puhas presentatsioonikiht.** Async-salvestusvoogu ta ei oma — see kuulub
hook'ile, otsused puhtale moodulile. Dialoog renderdab, hoiab fookust, kuulab klahve
ja teatab kasutaja sündmustest:

```ts
type UnsavedChangesDialogProps = {
  open: boolean;
  saving: boolean;
  saveFailed: boolean;
  onDiscard: () => void;
  onStay: () => void;
  onSaveAndContinue: () => void;
};
```

Nii jääb otsus "kas ootel tegevus käivitub" täielikult JSX-ist välja ja puhta mooduli
testid katavad selle päriselt.

```
⚠  Salvestamata muudatused
Sul on salvestamata muudatusi.

[Loobu muudatustest]   [Jää siia]   [Salvesta ja jätka]
   bg-red-600         hall ääris      bg-amber-600
```

**Värvivalik lähtub olemasolevatest signaalidest, mitte üldistest konventsioonidest:**

- Kollane = "siin on salvestamata töö, vajuta mind". Sama signaal on juba SALVESTA
  nupul `EditorHeader.tsx:75-78`, mis vahetub `bg-primary-600`-lt kollaseks täpselt
  siis, kui `hasUnsavedChanges || statusDirty`.
- Punane `bg-red-600` = hävitav kinnitus. Sama värv juba `Places.tsx:302`.

**Kollane toon: `bg-amber-600 text-white`.** Rakenduses on kollane praegu kahes toonis:
`amber-500` (`EditorHeader.tsx:76`, `PageActionBar.tsx:116`) ja `amber-600`
(`MetadataModal.tsx:922`, `UploadMetaForm.tsx:676`, `DashboardBulkActionBar.tsx:64`,
`PageImageEditorModal.tsx:856`). Dialoog võtab enamuse tooni `amber-600`.

Kontrast valge tekstiga: `amber-500` 2,15:1, `amber-600` 3,18:1, `amber-700` 5,02:1.
`amber-600` on kahest olemasolevast parem, aga ei ulatu WCAG AA nõudeni (4,5:1 väikese
teksti korral). **Kontrasti ei parandata siin ühepoolselt** — kollase nupu äratundmine
sõltub sellest, et see näeb kõikjal ühesugune välja. Üleminek `amber-700`-le või tumedale
tekstile on eraldi ülesanne, mis puudutab kõiki kuut kasutuskohta korraga.

### Invariandid

Need on "prognoositavuse" tegelik sisu ja neid ei tohi ükski kasutuskoht murda:

1. **Kollane nupp ei vii sihtkohta enne, kui salvestamine on õnnestunud.**
   Ebaõnnestumisel jääb dialoog avatuks, midagi ei kao.
2. **Salvestamise ajal on kõik kolm nuppu disabled**, kollasel spinner. Topeltklikk
   ei tekita kahte salvestust.
3. **Esc ja taustaklõps = "Jää siia", kui salvestamist ei toimu.** Salvestamise ajal
   on nupud, Esc ja taustaklõps kõik blokeeritud — muidu sulguks dialoog, salvestus
   jätkuks taustal ja hiljem saabuv vastus käivitaks navigeerimise ajal, mil kasutaja
   juba jätkab redigeerimist. Salvestuse katkestamist (`AbortController`) ei tehta.
4. **Fookus avanemisel on "Jää siia" peal.** Enter ei tee midagi hävitavat.
5. **Nuppude järjekord, värv ja tekst on kõikjal identsed** — ka siis, kui dialoog
   tuli lehepöördest, mitte lahkumisest. Sihtkohta nupusildid ei nimeta.
6. **Kolm nuppu alati.** `onSave` on kohustuslik prop; kõigis kasutuskohtades
   salvestusfunktsioon eksisteerib. Ei ole olekut, kus dialoog näeb teistsugune välja.
7. **"Loobu muudatustest" taastab baasseisu enne ootel tegevuse käivitamist.**
   Vt "Loobumise leping" allpool.
8. **Esimene ootel tegevus võidab.** Kui dialoog on avatud või salvestamine käib, ei
   asenda uus `runGuarded` kutse olemasolevat ootel tegevust — seda ignoreeritakse.
   Vastasel juhul muutuks "Salvesta ja jätka" sihtkoht kasutaja jaoks ettearvamatuks.
   Ootel tegevus nullitakse alati: pärast "Jää siia", pärast edukat jätkamist ja
   pärast loobumist.

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

Leping täpsemalt:

- `true` — kõik vajalik on **püsivalt** salvestatud ja kohalikud dirty-lipud ning
  salvestatud baasseis on uuendatud. Mitte lihtsalt "HTTP päring lõppes".
- `false` — salvestamine või valideerimine ei õnnestunud.
- **visatud erind** — hook käsitleb seda kaitseks samamoodi nagu `false`. Ükski
  praegune kasutuskoht ei viska, aga tulevane refaktor ei tohi jätta dialoogi
  igaveseks `saving`-olekusse ega tekitada käsitlemata rejection'it.

```ts
try {
  const saved = await onSave();
  if (!saved) { showSaveFailed(); return; }
  runPendingAction();
} catch {
  showSaveFailed();
} finally {
  setSaving(false);
}
```

### Loobumise leping

"Loobu muudatustest" ei tohi eeldada, et komponent monteeritakse maha. Invariant:
**kohalik mustand taastatakse baasseisu enne ootel tegevuse käivitamist.**

Meie neljas kasutuskohas tagab selle juba olemasolev kood ja **eraldi `onDiscard`
propi ei lisata**:

| Kasutuskoht | Mis taastab baasseisu |
|---|---|
| Workspace, lehepööre | `useEditorState.ts:71-83` — `isSwap` haru lähtestab `isDirty`, `savedState`, `annotationDraftDirty`, `saveError` ja dokumendi sisu. Kirjutatud täpselt selleks, et editor ei monteeru lehepöördel maha (ADR 0010, #194) |
| Workspace, lahkumine | komponent monteeritakse maha |
| Places, koha vahetus | `PlacesDetail.tsx:106-108` — `useEffect(() => setEditing(false), [placeKey])`, mis lähtestab mustandi |
| Places / PersonEdit / WorkManage, lahkumine | komponent monteeritakse maha |

Kohustuslik prop, mis oleks igas kasutuskohas no-op, tekitaks topeltlähtestuse riski
ja valekindlust. Selle asemel on **plaanis verifitseerimissamm**: iga kasutuskoha
juures näidatakse, mis baasseisu taastab. Kui mõni tulevane `runGuarded` kutse teeb
tegevuse, mis ei navigeeri ega vaheta objekti, tuleb `onDiscard` siis lisada.

### Hook

`src/hooks/useUnsavedChangesGuard.ts` kirjutatakse ümber objekt-argumendile:

```ts
const { dialogProps, runGuarded, allowNextNavigation } = useUnsavedChangesGuard({
  isDirty,
  onSave,    // () => Promise<boolean>
});

<UnsavedChangesDialog {...dialogProps} />

// Lehesisesed üleminekud (lehepööre, koha vahetus):
runGuarded(() => navigate(`/work/${workId}/${newPage}`, { replace: true }));
```

`runGuarded(fn)`: kui puhas → käivitab `fn()` kohe, dialoogi avamata; kui dirty →
avab dialoogi ja jätab `fn` ootele. Nimi on `confirmAction`-ist täpsem: puhtas olekus
kinnitust ei küsita. See on üldistus sellest, mida `Workspace.tsx` teeb praegu käsitsi
`pendingNavigation`-iga viies kohas ja `Places.tsx` `pendingKey`-ga. Mõlemad käsitsi
mehhanismid kaovad.

Hook katab kolm sisendit ühe dialoogiga:

- React Routeri `useBlocker` — lehelt lahkumine
- `beforeunload` — tab-i sulgemine (brauseri oma dialoog, seda me ei kontrolli)
- `runGuarded` — lehesisene üleminek

### Möödapääs: sisemine ühekordne bypass + avalik meetod

Praegune avalik `skipRef` on lekkiv abstraktsioon: kasutuskoht peab teadma, kuidas
blokeerimisest mööda pääseb, ja võib jätta lipu kogemata püsti, mis avaks järgmise
päris lahkumise kaitseta. Jaotatakse kaheks.

**Sisemine, ühekordne.** Pärast edukat salvestust on `isDirty` Reacti järgmise
renderduseni tõenäoliselt veel `true`, seega ootel tegevuse `navigate()` käivitaks
guard'i kohe uuesti. Praegu hoiab seda koos `requestAnimationFrame` hack
`Workspace.tsx:522-528`. Hook saab sisemise `allowNextTransitionRef`, mis kehtib
**täpselt ühe** ülemineku kohta ja kustub kohe pärast selle läbilaskmist — mitte
ajapõhiselt. Hack kaob kasutuskohtadest. Kui ootel tegevus viskab erindi, taastatakse
bypass ja `saving` sama `finally`-plokis; guard ei jää lahtiseks.

**Avalik `allowNextNavigation()`.** Toore mutable ref'i asendus samale vajadusele, mis
`PersonEditPage.tsx:207,212` juba katab: leht salvestab **oma** nupuga ja navigeerib
ise (`/persons/{id}`), dialoogivoost sõltumatult. Meetod tähistab järgmise navigatsiooni
lubatuks, on ühekordne ja kehtib sama loogika järgi mis sisemine. Kutsuja ei tea ega
puutu ühtki ref'i.

### Ligipääsetavus

- `role="alertdialog"` koos `aria-labelledby` (pealkiri) ja `aria-describedby` (sõnum)
- fookus on dialoogi sees lõksustatud (Tab ei vii dialoogist välja)
- sulgemisel taastatakse fookus elemendile, mis ülemineku algatas
- salvestusvea rida `role="status"` / `aria-live="polite"`
- salvestamise ajal `aria-busy="true"` dialoogil
- fookusring on nähtav ka kollasel ja punasel nupul (`focus-visible:ring-2`
  kontrastse tooniga, mitte nupu enda värviga)

### Puhas loogikamoodul

`src/hooks/unsavedChangesFlow.ts` — otsustusloogika DOM-i ja Reactita, sama
muster mis `markdownEditorHelpers.ts`. Siin elab kriitiline invariant: ootel tegevus
käivitub ainult siis, kui `onSave` tagastas `true`.

## Ulatus

| Fail | Muudatus |
|---|---|
| `components/UnsavedChangesDialog.tsx` | **uus** — kolme-nupu dialoog, Esc/taust, fookuselõks, spinner, vearida |
| `hooks/unsavedChangesFlow.ts` | **uus** — puhas otsustusloogika |
| `hooks/__tests__/unsavedChangesFlow.test.ts` | **uus** — node-testid |
| `hooks/useUnsavedChangesGuard.ts` | ümber kirjutatud: objekt-argument, `onSave`, `runGuarded`, `allowNextNavigation`, `dialogProps`; sisemine ühekordne bypass |
| `pages/Workspace.tsx` | `pendingNavigation` kaob (read 152, 375, 395, 479, 494) → `runGuarded`; `handleSaveAndLeave` ei navigeeri vea korral; `requestAnimationFrame` bypass-hack (522-528) kaob |
| `components/editor/useEditorSave.ts` | `runSave` ja `handleSaveWithDrafts` tagastavad `boolean` |
| `prosopography/pages/PersonEditPage.tsx` | `handleSave` jagatud `savePerson()` + nupu-handleriks (praegu navigeerib ise, read 208/213); `skipGuardRef` → `allowNextNavigation()`; `ConfirmModal` → `UnsavedChangesDialog` |
| `pages/admin/Places.tsx` | guard lisatud (puudus täiesti), käsitsi modaal (288-309) kaob, `pendingKey` → `runGuarded` |
| `pages/admin/PlacesDetail.tsx` | päris dirty-arvutus `editing` asemel (vt allpool); `handleSave` `boolean`-iks ja `saveRef` kaudu üles |
| `pages/WorkManage.tsx` | 2× `window.confirm` → `ConfirmModal`; guard `changedCount > 0` peale; `onSave` = järjekorra salvestus **ilma** pesastatud kinnituseta |
| `components/ConfirmModal.tsx` | Esc + taustaklõps = tühista (vt tarbijate audit allpool) |
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

### Kohtade dirty-arvutus

`PlacesDetail.tsx:111` asendub võrdlusega **viimati laaditud või edukalt salvestatud
baasseisuga**, mitte "kas kasutaja on midagi puutunud". Nõutud käitumine:

- redigeerimisrežiimi avamine **ei** tee vormi dirty'ks
- välja muutmine teeb dirty'ks
- algväärtuse käsitsi taastamine teeb vormi jälle puhtaks
- edukas salvestamine muudab praegused väärtused uueks baasseisuks
- teise koha laadimine loob uue baasseisu
- loobumine taastab baasseisu
- normaliseeritud väärtused ei tekita valepositiivset dirty't: `undefined` vs tühi
  string, puuduv võti vs tühi objekt, trimmimata vs trimmitud — võrdlus käib
  normaliseeritud kujul, sama funktsiooniga, mida `handleSave` payload'i ehitamisel
  kasutab (`PlacesDetail.tsx:150-166`)

See on koht, kus vale arvutus muudaks ühtse dialoogi nähtavalt tüütuks: dialoog
hüppaks ette iga kord, kui kasutaja on koha andmeid lihtsalt vaadanud.

### ConfirmModal tarbijate audit

`ConfirmModal.tsx` Esc/taustaklõpsu lisamine mõjutab kõiki tarbijaid, mitte ainult
seda disaini. Praegu on neid kolm: `Workspace.tsx`, `PersonEditPage.tsx` (mõlemad
lähevad `UnsavedChangesDialog`-ile üle) ja pärast seda tööd `WorkManage.tsx`.

Enne muudatust kontrollida, et iga alles jääva tarbija `onCancel` on idempotentne ja
et taustaklõpsuga sulgemine ei jäta pooleliolevat kohalikku olekut. Kui mõni tulevane
kasutuskoht ei tohi taustaklõpsuga sulguda, lisatakse `closeOnBackdrop` valik
(vaikimisi `true`); globaalselt seda ilma auditita ei muudeta.

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
- **Jagatud `DialogShell` komponent** (fookuselõks, fookuse taastamine, overlay,
  Esc, aria-sidumine) `ConfirmModal`-i ja `UnsavedChangesDialog`-i vahel. Praegu ei
  dubleeriks see midagi: `ConfirmModal`-il ei ole fookuselõksu ega aria-sidumist
  üldse, seega kirjutan need ühe korra uude dialoogi. Ühise aluskomponendi
  väljavõtmine on omaette refaktor üle kolme tarbija.
- **Kollase nupu kontrasti parandus** (`amber-700` või tume tekst) — puudutab kõiki
  kuut kollast nuppu korraga, vt "Dialoog".
- Salvestuse katkestamine `AbortController`-iga.

## Testimine

`src/hooks/__tests__/unsavedChangesFlow.test.ts` — puhta mooduli testid Vitesti
node-keskkonnas, uusi sõltuvusi ei lisata. Kaetavad juhud:

**Põhivoog**

1. ootel tegevus käivitub, kui `onSave` tagastab `true`
2. ootel tegevus **ei** käivitu, kui `onSave` tagastab `false`; dialoog jääb avatuks
3. `onSave` viskab erindi → tegevust ei käivitata, `saving` lõpeb, dialoog jääb avatuks
4. pärast ebaõnnestunud salvestust saab kasutaja uuesti salvestada
5. "Loobu muudatustest" käivitab ootel tegevuse salvestamata
6. "Jää siia" eemaldab ootel tegevuse täielikult
7. `runGuarded` puhta oleku korral käivitab tegevuse dialoogi avamata

**Ootel tegevuse poliitika**

8. uus `runGuarded` ei asenda juba ootel tegevust (esimene võidab)
9. topeltklikk "Salvesta ja jätka" nupul käivitab täpselt ühe `onSave`
10. salvestamise ajal saabuv uus `runGuarded` ei muuda ootel tegevust

**Bypass'i elutsükkel**

11. pärast edukat jätkamist ei jää bypass aktiivseks
12. pärast loobumist ei jää bypass aktiivseks
13. ootel tegevuse enda erind ei jäta guard'i `saving` ega `pending` olekusse

### Käsitsi kontroll

Hook'i ja React Routeri integratsioon jääb kõige riskantsemaks osaks ja see ei ole
puhta mooduliga kaetud (jsdom/testing-library infrat projektis ei ole ja seda ei
lisata). Iga neljas kasutuskohas läbida:

| # | Stsenaarium |
|---|---|
| 1 | brauseri Back-nupp |
| 2 | rakendusesisene link |
| 3 | `runGuarded` lehesisese vahetuse jaoks (lehepööre / koha vahetus) |
| 4 | edukas salvestus dialoogist |
| 5 | nurjunud salvestus dialoogist (võta võrk maha) |
| 6 | "Loobu muudatustest" |
| 7 | "Jää siia" |
| 8 | kiire topeltklikk salvestusnupul |
| 9 | Back kaks korda järjest |
| 10 | **pärast ühe dialoogi kasutamist on järgmine lahkumine endiselt kaitstud** |
| 11 | Esc ja taustaklõps salvestamise ajal ei sulge dialoogi |

Stsenaarium 10 on kõige olulisem — just see paljastab lekkiva bypass'i.

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

**Miks ei ole kohustuslikku `onDiscard` propi?** Ülevaatuses soovitati seda, eeldusel
et lehesisene üleminek võib jätta vana mustandi mällu. Meie koodis on see juba
lahendatud: `useEditorState.ts:71-83` (ADR 0010, #194) ja `PlacesDetail.tsx:106-108`
taastavad baasseisu. Prop, mis oleks igas kasutuskohas no-op, tekitaks
topeltlähtestuse riski ja valekindlust. Põhimõte on üle võetud invariandina
(nr 7) ja plaani verifitseerimissammuna. Vt "Loobumise leping".

**Miks jääb avalik möödapääsu-meetod alles?** Ülevaatuses soovitati see täielikult
hook'i sisse peita. Sisemine ühekordne bypass tulebki (ja parandab päris võistluse,
mida praegu hoiab koos `requestAnimationFrame` hack), aga täielik eemaldamine ei ole
võimalik: `PersonEditPage.tsx:207,212` salvestab **oma** nupuga ja navigeerib ise
`/persons/{id}`-le, dialoogivoost sõltumatult. Toores mutable ref asendub
meetodiga `allowNextNavigation()`, mille elutsükkel on ühekordne ja hook'i sees.
