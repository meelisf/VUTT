# ADR 0067 — Interlineaarne lisandus on `<add>` oma lisamiskohas

**Kuupäev:** 2026-10-12
**Staatus:** ettepanek

## Kontekst

Käsikirjas (Klingeri kirjad, #576) on lisandused sageli rea kohal, harvem all või
veerisel; sinna, kuhu nad lauses kuuluvad, osutab tihti lisamismärk. VUTT-is ei ole
selle jaoks märgendust ega reeglit. Klingeri ülevaatusel (2026-10-12) kirjutati
lisandus **omaette reale** põhirea ette, näiteks:

```
u empörend ist! Und wer steht
oder dieses
dafür, daß künftiges Jahr, durch
```

Sellel on kolm viga:

- Otsingutekst (`lehekylje_tekst`) muutub valeks: „Und wer steht oder dieses dafür“.
- Mudel peab arvama, kuhu lisandus kuulub. Interlineaar on sageli rea keskel ja
  ülevalt alla liikudes ei ole selle koht ilmne.
- Kurrendi GT on **juba segamini** (kontrollitud LOSSis 2026-10-12):
  - PAGE XML-i allikates (Transkribus, suurem osa v4-st) on lisandus omaette
    `TextLine`. `parse_pagexml` paneb read üksteise järele, seega on ka GT-s
    lisandus omaette rida ja märgendita. Allikas ei ole lisandust märgitud:
    alles olevas toor-XML-is (`zh_rrb`, `dta_komplett`, `ubtue-gt`, `gwalther`,
    `leibniz`, ~173 000 faili) ei ole ühtki `add`-tägi, `custom` kannab ainult
    `readingOrder`, `textStyle`, `unclear` ja `gap`. Kurrent_xix toor-XML
    (`hf_cache`) on kustutatud ja seda ei saanud kontrollida.
  - DTA TEI-s (Kosmos, Geusau, Sanders, ~3 500 lk) on lisandus
    `<add place="superlinear|across|intralinear">` **oma lisamiskohas**.
    `build_dta_kosmos.py` jätab sisu alles ja tägi ära, seega on DTA GT-s
    lisandus lause sees ja märgendita. Superlineaarseid on ~1 450, `across` ~3 000.

  Mudel õpib seega kahte reeglit, mida ta ei saa eristada.

## Otsus

1. **Interlineaarne lisandus on `<add>…</add>` oma lisamiskohas** (TEI nimi).
   Lisandust ei kirjutata omaette reale. Läbikriipsutatud sõna, mille asemele
   lisandus tuleb, jääb välja nagu praegu.
2. `<add>` on VUTT-i paaristäg samas süsteemis kui `<i> <b> <cs> <m> <hi> <ann>`.
   Veerise tekst eristatakse funktsiooni järgi:
   - **iseseisev ääremärkus** (kommentaar, kuupäev, viide, hilisem käsi) jääb
     `<m>`-iks (ADR 0003, 0009). `split_marginalia` viib selle põhitekstist
     `marginaalia_tekst`-i — õigesti, sest ta ei kuulu lausesse;
   - **veerisel olev lisandus, mis kuulub põhilausesse** (lisamismärgiga või
     konteksti järgi ilmselt sinna) on `<add>` oma lisamiskohas, MITTE `<m>`.
     Muidu jääks lause otsingus puudulikuks — sama viga, mida see otsus parandab.
   Kahtluse korral `<m>` ja kommentaar lehele.
3. **Otsing:** `clean_text_for_search` eemaldab tägid, aga jätab sisu alles
   (üldine `</?[a-z]+\d*>`), seega jõuab lisandus `lehekylje_tekst`-i õigesse
   kohta ilma muudatuseta. Kontrolli teostuses testiga.
4. **Treeningandmed (LOSS, v5):**
   - DTA ehitaja kirjutab `place="superlinear"` ja `"sublinear"` kujule
     `<add>…</add>`. `across` ja `intralinear` jäävad märgendita: DTA-s on
     `across` peaaegu alati ülekirjutus (`<subst><del rendition="#ow">…</del>
     <add place="across">…</add></subst>`, kontrollitud 2026-10-12), st asendus on
     füüsiliselt real.
   - **Asenduses (`<subst>`) jäetakse kustutatud osa ALATI välja**, ka `del #s`
     — treeningsiht ei tohi kanda mõlemat sõna, kui VUTT-i reegel (punkt 1) jätab
     vana välja. Üksik `<del>` väljaspool `<subst>`-i jääb praeguse ehitaja
     reegli järgi; üldine läbikriipsutuse otsus on lahtine (vt allpool).
   - PAGE XML-i allikaid ei teisendata: lisamiskoht puudub ja omaette rida jääb.
     Neid on rohkem kui DTA-d, seega jääb vana kuju ka v5-s.
   - VUTT-i eksport (`build_vutt_dataset.py`) annab `<add>` edasi nagu on.
5. **Olemasolev VUTT-i tekst:** Klingeri ülevaatuse lehed (671arc, ffqg7z, t9zd42,
   ~40 kohta) teisendatakse pildi järgi `<add>`-iks enne „Valmis“-staatust.
   Sealhulgas t9zd42 lk 140 veeriselisandus „dieses Buch,“ (praegu `<m>`, kuulub
   lausesse „schrieb über dieses Buch“); lk 67 veeris ja lk 133 kuupäev jäävad
   `<m>`-iks. Muu
   korpust ei migreerita automaatselt, sest omaette rea lisamiskoht ei ole tekstist
   tuletatav.

## Lahtised küsimused

- **Visuaalne esitus redaktoris.** CodeMirror peidab tägid (mark-dekoratsioon +
  `atomicRanges`, ADR 0044) ja kasutaja ei tohi neid näha. `<add>` vajab oma
  `cls`-i, mis eristub `<m>`-ist ja `<hi>`-st (nt väiksem tõstetud kiri või
  lisamismärk ^ ees). Lisaks sisestus: nupp + kiirklahv nagu `wrapWithTag`-il.
  Lehe lugemisvaates sama esitus (`MarkdownView` on eraldi süsteem, ei puutu).
- **Asendus** (kasutaja 2026-10-12, otsustatud): kui asendus on kirjutatud rea
  kohale/alla, on see `<add>`. Kui asendus järgneb läbikriipsutatud sõnale
  **samal real** (`~~sõna~~ asendus`) või on ülekirjutus, jääb see märgendita.
- **Läbikriipsutatud tekst** on praegu ebaühtlane: mudel transkribeerib seda
  vahel, vahel mitte, ja tugevalt läbi kriipsutatud tekst ei ole üldse loetav.
  VUTT-i toimetaja jätab välja, DTA jätab `del #s` alles, `ubtue-gt` PAGE XML
  märgib `textStyle strikethrough:true` (sisu alles). Üks võimalus on `<del>…</del>`
  loetava läbikriipsutuse jaoks (loetamatu jääb välja): GT kannab info, eksport
  otsustab, kas treenida sisu, tägiga või ilma. Otsustamata.
- **Mudel peab nägema `<add>`-i piisavalt palju.** Kui v5-s on `<add>` ainult
  DTA-s ja Klingeris, võib PAGE XML-i vana kuju domineerida. Mõõda v5 holdoutil
  eraldi, kas mudel paneb lisanduse õigesse kohta.

## Tagajärjed

- Uus täg tähendab muudatust kohtades, kus täge on loetletud: `VUTT_TAGS`
  (`VuttMarkupExtension.ts`), `src/utils/renderVuttMarkup.ts` (lugemisvaade),
  `src/utils/marginaliaUtils.ts`, sanitiseerija/orvutägide loogika, vorminduse
  eemaldamise käsk (`cleanMarkup`, `EditorToolbar.tsx`), marginaalia
  normaliseerija ja `strip_empty_tags`, eksport, transkribeerimisjuhendid
  (`public/transcription_guide.html` + `_en.html`).
- Praegune mudel `<add>`-i ei kirjuta (GT-s seda ei ole). Kuni v5-ni lisab
  `<add>`-i ainult toimetaja; OCR-väljundis on lisandus kas omaette real või
  märgendita lause sees.
- Mudelite võrdlus: ainult tägi eemaldamine EI tee CER-i võrreldavaks, sest
  lisanduse ümbertõstmine muudab ka sõnajärge (omaette rida vs lause sees).
  Mõlemat mudelit mõõdetakse SAMA käsitsi kontrollitud etaloni vastu, milles
  lisandus on lisamiskohas; tägi eemaldatakse mõlemast poolest. Lisamiskoha
  õigsust (kas `<add>` on õiges kohas) mõõdetakse eraldi meetrikana.
