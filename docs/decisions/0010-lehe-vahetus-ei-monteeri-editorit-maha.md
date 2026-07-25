# 0010 — Lehe vahetus ei monteeri editorit maha; programmaatiline sisuvahetus on märgistatud

**Staatus:** kehtib

## Kontekst

Workspace näitas lehe vahetusel täisekraani spinnerit (`if (loading) return
<spinner>`), mis võttis kogu komponendipuu maha, sh CodeMirrori ja
ImageVieweri. #185 raames spinner eemaldati sama teose sees toimuvalt
pöördelt — pööre on tööriista sagedaseim tegevus ja editori taasmonteerimine
igal pöördel oli nii aeglane kui visuaalselt rahutu.

See paljastas neli viga, mis olid koodis juba olemas, kuid mida remount
varjas. Kõigi ühine juur: **komponendisisene olek lähtestus ainult
remounti kõrvalmõjuna**, mitte teadliku koodi tõttu.

Kõige tõsisem neist: `useCodeMirrorLifecycle` updateListener seab iga
`docChanged` peale `isDirty = true`. Lehe vahetus asendab kogu dokumendi ühe
dispatch'iga — see on samuti `docChanged`, seega märgiti iga uus leht kohe
muudetuks ja lahkumisel küsiti salvestamist, kuigi kasutaja polnud midagi
teinud.

## Otsus

1. **Spinner ainult teose vahetusel või esmalaadimisel.** Sama teose sees
   lehte vahetades jääb raam püsima; sisu vahetamise eest vastutab
   `useEditorState` `page`-effect.

2. **Programmaatiline dokumendi asendus on märgistatud** `pageSwapAnnotation`
   annotatsiooniga (`src/components/editor/editorAnnotations.ts`).
   `updateListener` ei loe sellist tehingut kasutaja muudatuseks.

3. **See märgistus EI TOHI olla `Transaction.userEvent`.**
   `marginaliaProtectionFilter` (MarginaliaExtension.ts) ja `vuttAutoSanitizer`
   (VuttMarkupExtension.ts) tegutsevad mõlemad ainult userEvent-tehingutel.
   Kui lehe vahetus kannaks userEvent'i, hakkaks automaatne sanitiseerija
   kettalt laetud teksti muutma — see kirjutaks kasutaja andmed vaikselt ümber.

4. **Iga leht algab algusest.** Suurendustase säilib (sama suurendus järgmisel
   lehel on lappamisel kasulik), aga asend viiakse ülaserva nii pildil kui
   tekstis. Pildi nihe arvestab pealkattuvate juhtnuppude kõrgust, mis
   mõõdetakse DOM-ist, mitte ei kodeerita konstandina.

5. **`page`-objekti asendumine EI OLE lehevahetus.** Lehevahetust tuvastatakse
   `page.id` järgi (`editorPageSync.ts` → `isPageSwap`), mitte objekti-
   identiteedi järgi. `Workspace` kutsub `setPage`-i kolmes kohas: lehe
   laadimisel, teksti salvestamisel (`setPage(savedPage)`) ja metaandmete
   salvestamisel (`handleMetadataSaved`). Ainult esimene neist on lehevahetus.
   Punkti 4 lähtestused ja redaktori oleku lähtestused käivad **ainult** siis.

## Tagajärjed

- **Enne komponendi remountist vabastamist tuleb tema sisemine olek läbi
  käia.** Iga `useState`, mis eeldas mount-aegset lähtestamist, muutub
  pikaealiseks. Lehe vahetuse effect peab need selgesõnaliselt lähtestama —
  seni: `isDirty`, `annotationDraftDirty`, `saveError`, kerimispositsioon,
  pildi asend.

- **Lehepõhine taustatöö olek vajab lehe-võtit, mitte mount-guardi.**
  `useReOcr` hoidis re-OCR seisu (banner "Transkriptsioon käib", tulemuse
  ülekate) ühekordse mount-kontrolliga (`didCheckStoredJobRef`) — see eeldas
  remounti. Ilma remountita rippus eelmise lehe banner igal järgmisel lehel ja
  valmiv töö kuvas võõra lehe teksti, mille "Rakenda" oleks kirjutanud
  praegusesse dokumenti. Muster: identiteedivõti (`reocrPageIdentity` →
  `work_id/failinimi`) effecti dep-listis, mis lähtestab oleku, + `pageKeyRef`
  valve iga async-vastuse ees, et vana lehe poll ei kirjutaks uue lehe olekusse.
  Sama põhjusel on `PageCommentsPanel`-il `key={page.id}` — mustandiväljad on
  lehepõhised.

- **Punkti 1 sõnastus "sisu vahetamise eest vastutab `page`-effect" oli lõks:**
  effect on kirjutatud lehevahetuse jaoks, aga jookseb iga `page`-objekti
  asendumise peale. See tekitas kaks viga, mõlemad avastatud 2026-07-25.
  *Kerimine:* `view.scrollDOM.scrollTop = 0` jooksis ka salvestamisel, nii et
  kasutaja kaotas keset tööd salvestades oma koha lehel. *Andmekadu (#194):*
  `setIsDirty(false)` jooksis metaandmete salvestamisel ja kustutas
  salvestamata teksti hoiatuse — lahkumisel ei küsitud salvestamist ja
  muudatused läksid kaotsi; sama kirjutas üle salvestamata `status`,
  `comments` ja `page_tags` valikud. Salvestamise järel teeb oleku korda
  `useEditorSave.runSave` täpselt sellega, mis salvestati — effect ei tohi
  seda dubleerida.

- Teadlikult **säilivad** üle lehepöörete: redaktori sakk, suurendustase,
  otsingupaneeli olek, marginaaliavaate režiim. Need on lappamisel soovitud.

- Uus programmaatiline dokumendimuudatus editoris peab otsustama, kas ta on
  kasutaja muudatus (märgista `userEvent`) või mitte (märgista
  `pageSwapAnnotation` või lisa oma annotatsioon). Märgistamata `docChanged`
  loetakse alati kasutaja muudatuseks.

- Kaetud testidega: `editorAnnotations.test.ts` lukustab ka invariandi 3
  (lehe vahetus ei kanna userEvent'i).

## Viited

- Issue #185, #186; PR #190
- Issue #194 ja commitid `3b4ca17`, `9dc208a` — punkti 5 ajend
- ADR [0009](0009-marginaalia-iga-fuusiline-rida-eraldi.md) — marginaalia parser,
  mille sanitiseerija invariant 3 kaitseb
