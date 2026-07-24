# 0011 — i18n laeb ühe keele korraga; `fallbackLng` on väljas ja asendatud pariteeditestiga

**Staatus:** kehtib

## Kontekst

`src/i18n.ts` importis staatiliselt mõlema keele kõik 12 nimeruumi ja andis
need `resources`-ina i18nextile. Entry chunk kandis seega 34,6 kB gzip
tõlkeid, millest pool oli igal külastusel kasutu.

Laisale laadimisele üleminekul selgus kaks piirangut, mis määrasid lahenduse
kuju:

1. **`fallbackLng` sunnib i18nexti varukeele paki laadima.** Kui jätta
   `fallbackLng: ['en', 'et']`, laeb eestikeelne kasutaja ikkagi mõlemad ja
   kogu võit kaob.

2. **Keeletuvastus peab toimuma enne init'i**, et osata laadida ainult üht
   pakki. `i18next-browser-languagedetector` teeb tuvastuse init'i ajal, mis
   on liiga hilja.

## Otsus

1. **Keelepakid laetakse dünaamiliselt**, laisa i18next backendi kaudu.
   `src/locales/{et,en}/index.ts` koondab ühe keele nimeruumid üheks mooduliks
   → üks chunk keele kohta. Nimeruumide kaupa importimine annaks 12 chunki.

2. **Keeletuvastus tehakse käsitsi** (`src/utils/detectLanguage.ts`) enne
   init'i. Järjekord kordab senist käitumist: localStorage `vutt_language` →
   brauseri keeled → inglise.

3. **`fallbackLng: false`.** Keeltevahelist vaikset varundust ei kasutata.

4. **Varuvõrk on asendatud, mitte eemaldatud.**
   `src/locales/__tests__/localeParity.test.ts` nõuab, et eesti ja inglise
   tõlgetel oleksid täpselt samad võtmed. Lahknevus katkestab build'i.

   Otsuse eeldus kontrolliti enne tegemist: lokaadid olid juba täpselt
   sünkroonis (0 lahknevat võtit kummaski suunas), st varuvõrk ei rakendunud
   praktikas kunagi.

## Tagajärjed

- **Uus tõlkevõti tuleb lisada mõlemasse keelde korraga.** Varem võttis
  puuduva võtme vaikselt teine keel; nüüd katkeb build. See on teadlikult
  rangem — vaikne fallback laseks puuduva tõlke märkamatult teise keele teksti
  taha kaduda.

- **Uus nimeruum** tuleb lisada nii `src/locales/namespaces.ts`-i kui mõlemasse
  keelekausta; `localeParity` test kontrollib vastavust.

- **Kolmanda keele lisamine** nõuab: uus kaust, kirje `SUPPORTED_LANGUAGES`-is,
  laadija `LOADERS`-is. Pariteeditest laieneb automaatselt.

- **`NAMESPACES` elab `src/locales/namespaces.ts`-is**, mitte `i18n.ts`-is:
  viimase importimine käivitab i18nexti initsialiseerimise, mida testid ja
  tööriistad ei tohi kõrvalmõjuna vallandada.

- **Kompromiss:** keelepakk laeb järjestikku pärast entry chunki (~100 ms RTT).
  See kulu tabab ainult esimest külastust — failinimi on hashitud ja
  `/assets/` on `expires 1y`. Väiksem entry chunk ja vahemälus püsiv
  `vendor-react` kaaluvad selle korduvkasutuses üles. Kui esmakülastuse
  latentsus muutub oluliseks (nt SEO), tuleb see otsus üle vaadata.

- Käivitustee on kaetud otsast-otsani testiga (`i18nBootstrap.test.ts`) päris
  init'iga, mitte mockidega: ilma `fallbackLng`-ta ei visata tõlkevea korral
  enam viga, kasutaja lihtsalt näeks tõlkevõtmeid.

## Viited

- Issue #187, #188; PR #192
- Mõõdetud: entry chunk 193,22 → 59,13 kB gzip; esmane laadimine ~221 → ~202 kB
