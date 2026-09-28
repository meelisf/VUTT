# ADR 0060 — Töölaua perioodiliselt muutuv sõltuvus ei lae juba laetud lehte uuesti

**Kuupäev:** 2026-09-28
**Staatus:** vastu võetud
**PR:** #513 · **Seotud:** ADR 0010 (lehe vahetus), ADR 0004 (auth-aegumine), S27-03

## Kontekst

Workspace'i lehe laadimise effect sõltub lisaks teosest ja lehenumbrist ka
`effectiveIndex`-ist, `authToken`-ist, `sessionExpired`-ist ja `user`-ist —
need on vajalikud *esmakordseks* laadimiseks (piiratud teos, värske tab,
viewer-token). Kuni need väärtused püsisid terve seansi jooksul samad, ei
olnud vahet, kas effect jookseb ühe korra või mitu.

S27-03 (2026-09-27) lühendas kasutaja Meili-tokeni 15 minutile; klient uuendab
seda 5 min enne aegumist → iga ~10 min uus `index`-objekt → effect laadis
**sama lehe** uuesti → `useEditorState` `page`-effect asendas redaktori
dokumendi serveri versiooniga. Salvestamata töö kadus ilma hoiatuseta
(kkrxpe lk 1, 2026-09-28). Sama juhtus uuesti sisselogimisel.

Viga ei olnud tokeni uuenduses ega redaktoris eraldi, vaid eelduses, et
„effect jookseb uuesti" = „kasutaja tahab uut lehte". Perioodiline sõltuvus
murrab selle eelduse vaikselt — ADR 0010 remount-probleemi peegelpilt:
seal lähtestas olekut remount, siin uus laadimine.

## Otsus

1. **Laadimisel on võti.** `pageLoadKey(workId, pageNum, viewerToken)`
   (`src/pages/workspacePageLoad.ts`) kirjeldab, *mis* on laetud. Effect
   laadib ainult siis, kui võti erineb viimati edukalt laetust
   (`loadedPageKeyRef`). Võtmesse kuulub ainult see, mis muudab lehe sisu
   või lugemisõigust: teos, leht, viewer-token. **Mitte** `index`, `authToken`,
   `sessionExpired` ega `user` — need tohivad olla deps'is (esmalaadimine
   vajab neid), aga ei tohi juba laetud lehte uuesti tuua.
2. **Vea või puuduva lehe korral võti nullitakse**, et järgmine effecti
   käivitus (nt pärast sisselogimist) prooviks uuesti.
3. **Teine kaitsekiht redaktoris.** `keepEditorText` (`editorPageSync.ts`):
   sama lehe värskendus EI kirjuta redaktorit üle, kui serverist tuli
   täpselt viimati salvestatud tekst — serveril pole midagi uut ja redaktori
   erinev sisu on salvestamata töö. Salvestuse vastus tuleb teise tekstiga
   (`savedState` on siis veel vana) ja asendub nagu enne.

Teadlikult EI tehtud: tokeni TTL-i pikendamist (turvaotsus S27-03 jääb) ega
`effectiveIndex`-i eemaldamist deps'ist (esmalaadimine ja viewer-tokeni
ümberlaadimine vajavad seda).

## Tagajärjed

- **Uus Workspace'i lehe-effecti sõltuvus, mis võib muutuda perioodiliselt
  või auth-sündmusest (token, sessioon, kasutaja, indeks), EI TOHI juba
  laetud lehte uuesti laadida.** Kas ta kuulub `pageLoadKey`-sse, otsusta
  küsimusega: „kas selle muutumisel on lehe sisu või lugemisõigus teine?"
  Kui ei, jääb ta võtmest välja.
- Sama lehe sisu uuendus käib **otse `setPage`-iga** (salvestus, metaandmed,
  ajaloo taaste `handlePageRestored`), mitte effecti uuesti käivitamisega.
  Uus toiming, mis vajab värsket lehte, uuendab `page`-i ise.
- Sama reegel kehtib iga pika eluga redaktorivaate kohta: perioodiline
  taustasündmus ei tohi kasutaja pooleliolevat sisendit asendada. Diagnoosis
  vaata esmalt `data/` git-ajalugu — kas kadus salvestatud või ainult
  salvestamata tekst.
- Väljalogimine samal lehel ei peida enam juba laetud piiratud lehte
  automaatselt (võti ei muutu); ligipääs lõpeb järgmisel laadimisel ja
  kirjutamine nõuab niikuinii kehtivat sessiooni.
- Valvurid: `src/pages/__tests__/workspacePageLoad.test.ts`,
  `src/components/editor/__tests__/editorPageSync.test.ts`.
