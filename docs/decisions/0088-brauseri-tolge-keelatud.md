# ADR 0088 — Brauseri automaattõlge on keelatud

**Kuupäev:** 2026-11-25
**Staatus:** vastu võetud
**Seotud:** ADR 0011 (i18n), #133 (kliendipoolsed vead)

## Kontekst

Chrome'i / Google Translate'i tõlge mähib tekstisõlmed `<font>`-i. React ei leia
neid enam üles ja järgmine renderdus kukub `insertBefore`/`removeChild`
`NotFoundError`-iga veapiirini (nt 2026-11-25 `/register`, türgi tõlge: taotlus läks
läbi, aga taotleja nägi kinnituse asemel viga). Kliendivigade raportöör märgib
need juba „lehekülg tõlgitud" (`detectPageTranslation`).

Lisaks on VUTT-i sisu varauusaegne alliktekst (ladina, saksa, rootsi, kreeka).
Automaattõlge moonutaks transkriptsiooni, metaandmeid ja isikunimesid ning
tõlgitud lehelt ei saa sisuliselt kaastööd teha.

## Otsus

Kogu rakendus kannab `<html translate="no">` + `<meta name="google"
content="notranslate">` (`index.html`). Kasutajaliides on eesti ja inglise keeles
(ADR 0011); uus kasutajakeel (nt saksa) lisatakse i18n-i kaudu, mitte
automaattõlkele lootes.

## Tagajärjed

- Tõlke-NotFoundError'id peaksid kaduma; `detectPageTranslation` jääb alles
  (kasutaja võib tõlke käsitsi peale sundida — siis on viga endiselt tõlke oma).
- Kasutaja, kes eesti/inglise keelt ei loe, ei saa liidest automaatselt tõlkida.
  Teadlik valik: allikate keelteta ei saa VUTT-is niikuinii panustada.
- Staatilised lehed (`about_en.html` jt) ei ole Reacti all ja jäävad tõlgitavaks.

## Alternatiivid

**React #11538 paik** (`Node.prototype.insertBefore`/`removeChild` ümbris, mis
neelab võõra vanemaga sõlme vea). Hoiaks tõlke lubatuna, aga peidab ka meie enda
DOM-vead ja tõlgitud leht jääks sisuliselt valeks (tõlge ei uuene Reacti
muudatustega).
