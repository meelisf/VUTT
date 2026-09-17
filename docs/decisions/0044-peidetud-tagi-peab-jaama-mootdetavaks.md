# ADR 0044 — Peidetud tägi peab jääma mõõdetavaks

**Kuupäev:** 2026-09-17
**Staatus:** kehtib (teostatud 2026-09-17)
**Seotud:** ADR 0003, 0009, 0010; #133 vealogi 2026-09-16, PR #394

## Kontekst

VUTT-i paaristägid (`<i>`, `<b>`, `<cs>`, `<m>`, `<hi>`, `<ann>`) peidetakse
DOM-is mark-dekoratsiooniga, mis kannab klassi `.vutt-hidden-tag`, ja
registreeritakse `EditorView.atomicRanges`-i. Tüüp on teadlikult **mark**, mitte
`Decoration.replace` — replace murdis plain-kursori nooleliikumise (CLAUDE.md
invariant, ADR 0003/0009). See osa ei muutu.

Klass ise oli `display: none`. Sellel on tagajärg, mida atomicRanges ei kata,
sest ta puudutab hoopis **mõõtmist**.

`posAtCoords` (@codemirror/view) skaneerimissilmus, mida kasutab AINULT
vertikaalne kursoriliikumine (`scanY`), küsib iga kandidaat-rea kohta ühe
koordinaadi:

```js
let rect = view.docView.coordsAt(scanY < 0 ? block.from : block.to,
                                 scanY > 0 ? -1 : 1);
if (rect && (scanY < 0 ? rect.top <= yOffset + docTop
                       : rect.bottom >= yOffset + docTop))
    break;          // ainult siin jääb kursor sellele reale
```

Alla liikudes mõõdetakse rea **lõppu**, üles liikudes rea **algust**.
`display: none` sisul ei ole DOM-kasti → `coordsAt` tagastab `null` → `break`
jääb ära → silmus läheb järgmisele reale. Rida, mis algab `<i>`-ga või lõpeb
`</i>`-ga, on vertikaalsele liikumisele **olematu**.

Sümptomid, mis sellest järgnesid ja millega oli aastaid lepitud:

- segasel lehel hüppab kursor üle italic/cs-ridade;
- **üleni italic lehel** ei peata silmust ükski rida: nool alla annab
  `doc.length` (kasutaja vaates kaob kursor ära), nool üles nulli;
- horisontaalne liikumine on korras, sest see ei käi sellest silmusest läbi.

Sama eeldus („igal real on vähemalt üks mõõdetav koht") tekitas ka crashi
`InlineCoordsScan.scan`-is, mille ülesvool parandas 6.43.1-s (PR #394). Crash
sai valvuri; **mõõtmise pool jäi meie kanda.**

## Otsus

Peidetud tägi peidetakse **null-laiusega, aga olemasoleva kastiga**, mitte
`display: none`-iga:

```
.vutt-hidden-tag {
  display: inline-block;
  width: 0;
  overflow: hidden;
  vertical-align: top;
}
```

`coordsAt` saab ristküliku ja silmus peatub õigel real.

**`display: none` selle klassi peal on keelatud.** See on ilmselge tagasipööre,
mis „paistab õigem" ja mille tagajärg ei ole ei veateade ega punane test, vaid
kursori vaikne kadumine italic-lehel.

## Tagajärjed

- Vertikaalne kursoriliikumine töötab italic- ja cs-ridadel.
- Rida, mille kogu sisu on peidetud tägid, saab kõrguse (varem kollapseerus).
  `MarginaliaExtension`-i klass `vutt-marg-open-empty` lahendas sedasama
  kitsamalt avatud marginaalia-kastis; ta jääb alles, aga ei ole enam ainus
  kaitse.
- **Lõikelauda see ei puuduta.** Kopeerimine ja lõikamine on täielikult kinni
  püütud (`useCopyPastePlainMarkup`): `preventDefault()` + `setData` tekstiga,
  mis lõigatakse dokumendi olekust ja puhastatakse regexiga. DOM ei ole
  kopeeritava teksti allikas, seega `overflow: hidden` ei too tägi teksti kaasa.
- Dekoratsiooni tüüp EI muutu — mark + atomicRanges jääb.

## Miks mitte kitsamalt

Silmus mõõdab ainult rea esimest ja viimast positsiooni, seega piisaks
teoreetiliselt sellest, kui mõõdetav oleks ainult reapiiril olev tägi. See
nõuaks reateadlikku dekoratsiooni ehitust `VuttMarkupExtension`-is. Lisakood on
ise regressioonirisk ega kaota kumbagi tagajärge (reapiiril olev tägi on just
see, mis kõrguse annab). CSS-i tasandi lahendus on väikseim muudatus, mis
probleemi päriselt lahendab.
