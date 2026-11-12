# 0083 — Isiku nimeajalugu: üks nimeloend

**Staatus:** vastu võetud 2026-11-12, teostamata
**Seotud:** ADR 0082 (eristav täiend), ADR 0058 (MCP ettepanekud), ADR 0048 (kaardi salvestus)
**Issue:** #795

## Kontekst

Sama isik esineb allikates eri aegadel eri nime all ja näib esmapilgul kahe
isikuna. Johannes Erici Stregnensis on disputatsioonides selle nime all, hiljem
igal pool Johan Stiernstråle. Emundus Figrelius aadeldati nimega Gripenhielm.
Nimemuutused on aadeldamine, ladinastamine, abielu, pseudonüüm ja ordunimi.

Praegu on teine nimi kas
- lameda aliasena (`name.aliases`, ilma aja ja liigita), segamini kirjaviisi
  variantidega („Strognensis”), või
- kanoonilise nime sees („Johannes Erici Stregnensis Stiernstråle”), või
- valel väljal (`name.qualifier` = „Gripenhielm”, parandatud ADR 0082 käigus).

Leidmine pole peamine probleem: otsing leiab aliaste järgi ka teoste
autoriotsingus (`person_aliases.json` → `authors_text`). Probleem on selles, et
kaardilt ega tulemusest ei paista, et teine nimi on sama isiku teine nimi ja
millal see muutus.

Kasutajate peamine häda (2026-11-12) on vormi suurus: lahtreid on palju, õiget ei
leita ja info läheb valesse kohta. Helilooja Fischeri kaardil olid saksakeelne
Vikipeedia tekst eestikeelse eluloo väljal ja rikastuse müra aliastes. Seepärast
**ei tohi nimeajalugu tulla uue eraldi lahtrina**, mille kasutaja peab ise üles
leidma ja aliastest eristama.

## Otsus

1. **Kanooniline nimi** (`name.label`) on nimi, mille all isik **meie korpuses**
   põhiliselt esineb. Raamatukogude tava („hilisem või tuntum nimi”) siin ei
   kehti, sest VUTT-i kasutaja kohtab isikut tekstides. Kahe nime kokku panemine
   üheks kanooniliseks nimeks lõpetatakse.
2. **Teose juures ei muutu midagi.** `creators[].name` jääb nagu praegu.
   Ajastule vastava nime näitamist teose juures ei tehta.
3. **Üks nimeloend kasutaja jaoks.** Vormis ja isikulehel on üks plokk
   „Nimed ja nimekujud”. Iga rida on kuju ja selle liik on vaikimisi
   „kirjaviis”. Kui liik muudetakse (sünni- või patronüümiline nimi, ladinastatud
   kuju, aadlinimi, abielunimi, pseudonüüm, ordunimi), ilmuvad väljad „alates”,
   „kuni” ja „allikas”. Uut lahtrit ei tule: nimed on seal, kus need on alati
   olnud.
4. **Andmekuju.** Kirjaviisi variandid jäävad `name.aliases`-sse (stringid, kõik
   praegused lugejad jäävad tööle). Liigiga nimi elab `name.names[]`-is:
   `{label, type, from, to, source, notes}`. Liigi määramine tõstab kuju aliastest
   `names`-i ja liigi eemaldamine tagasi. Otsinguindeks (`person_aliases.json`,
   isikuindeksi `aliases`) võtab mõlemad. `maiden_name` jääb seniseks
   (eraldi otsus, kas see sulandub `names`-i).
5. **Leitavus ilma avastamiseta.**
   - **Vihje muutmise hetkel:** kui lisatud kuju ei sarnane kanoonilise nime
     ühegi sõnaga (nt „Stiernstråle” vs „Johannes Erici Stregnensis”, mitte
     „Strognensis” vs „Stregnensis”), märgib vorm rea küsimusega „Teine nimi?”
     ja pakub liigi valiku. Masin ei otsusta, toimetaja otsustab.
   - **Tööjärjekord:** isikute loendis filter „Võimalik nimemuutus”: kaardid,
     kus mõni alias ei sarnane kanoonilise nimega ja `names` on tühi. Täidetakse
     järk-järgult.
   - **Isikuleht** näitab nimesid ajajärjestuses
     („Johannes Erici Stregnensis → Johan Stiernstråle (aadlinimi, alates …)”).
     Valija ja loend näitavad „ka: …”, kui otsing tabas teise nime.
6. **Automaatne abi käib ADR 0058 kaudu, mitte vormi sees.** Agent võib
   tööjärjekorra läbi käia ja esitada ootel ettepaneku (nimi, liik, aasta,
   allikas), mille toimetaja kinnitab. Keelemudeli päringut vormis (nt Gemini
   Flash) praegu ei tehta. Klassifitseerimisega saab punkti 5 reegel hakkama
   peaaegu tasuta. Faktid (aadeldamise aasta) peavad tulema allikaga, mitte
   väljale ilmuva väärtusena.

## Tagajärjed

- Skeemi lisandub `name.names[]`. Kirjutus käib ainult kaardi salvestustee kaudu
  (`_save_person_locked`, ADR 0048) ja `strip_server_fields` seda ei puuduta
  (kliendi väli).
- Rikastus (Wikidata P1477/P1448) võib hiljem pakkuda `names`-i ridu, aga ainult
  ettepanekuna.
- Kanoonilise nime põhimõte (p 1) tähendab, et sama isiku kanooniline nimi võib
  erineda Wikidata/GND eelistatud nimest. See on teadlik.
- Laiem vormi kasutatavuse küsimus (lahtrite hulk, agendi koostatud kaart, mille
  inimene üle vaatab) on eraldi mõttekogumise issue (#799). See ADR seda ei lahenda.
