# 0083 — Isiku nimeajalugu: üks nimeloend

**Staatus:** vastu võetud 2026-11-12, teostatud 2026-11-12 (#795)
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
   „Nimed ja nimekujud”. Kuju on vaikimisi kirjaviisi variant (kiip, nagu
   aliased alati olid). Kiibi noolega tõstetakse kuju liigiga nimeks (sünni- või
   patronüümiline nimi, ladinastatud kuju, aadlinimi, abielunimi, pseudonüüm,
   ordunimi, muu); siis ilmuvad väljad „alates”, „kuni” ja „allikas”, ja
   „variandiks” viib tagasi. Uut lahtrit ei tule: nimed on seal, kus need on
   alati olnud. Plokk avaneb vormis ise, kui kaardil on liigiga nimi või
   punkti 5 vihje.
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
     järk-järgult. Filter on toimetaja vahend (külgriba sektsioon
     „Tööjärjekord”, `editor`+); URL-i param `name_change`.
   - **Isikuleht** näitab liigiga nimesid ajajärjestuses struktureeritud info
     esimese reana („Johan Stiernstråle (aadlinimi, alates …) · allikas”);
     kirjaviisi variandid jäävad reale „Nimevariandid”.
     Valija ja loend näitavad „ka: …”, kui otsing tabas teise nime
     (`matchedOtherName`; väliste ID-de aliaste tabamust klient ei näe).
6. **Automaatne abi käib ADR 0058 kaudu, mitte vormi sees.** Agent võib
   tööjärjekorra läbi käia ja esitada ootel ettepaneku (nimi, liik, aasta,
   allikas), mille toimetaja kinnitab. Keelemudeli päringut vormis (nt Gemini
   Flash) praegu ei tehta. Klassifitseerimisega saab punkti 5 reegel hakkama
   peaaegu tasuta. Faktid (aadeldamise aasta) peavad tulema allikaga, mitte
   väljale ilmuva väärtusena.

## Teostus

- **Reegel „teine nimi?”** on kahes kohas samana: `server/prosopography/person_names.py`
  (`looks_like_other_name`) ja `src/prosopography/utils/personNames.ts`
  (`looksLikeOtherName`). Eesnimesid ei võrrelda (Olof/Olaus on keelekuju),
  ladina lõpud võetakse maha, kuju on variant, kui ta sisaldab kanoonilist
  perekonnanime või tema perekonnanimi sarnaneb kanoonilise mõne
  mitte-eesnimelise sõnaga. Testid jagavad juhtumeid (`OTHER_NAME_CASES` ↔
  `CASES`) — **muuda mõlemat koos**. Tootmisandmetel (2026-11-12) märgib reegel
  79 kaarti, enamik päris nimemuutused.
- **Salvestus:** `_apply_card_update` puhastab `names[]` (`normalize_name_obj`:
  tundmatu liik → `other`, aastad 3–4 kohta, korduv kuju välja) ja eemaldab
  liigiga kuju `aliases`-ist. Klient, kes `names` võtit ei saada (vana vorm,
  rikastus, skriptid), nimeajalugu EI kustuta — vana `names` kantakse üle.
- **Liitmine** ühendab `names` kuju järgi, sihtkaardi kirjed ees.
- **Indeks:** isikuindeksi kirjel `names` (kuvamiseks), `aliases` sisaldab ka
  liigiga kujusid (otsing) ja `possible_name_change` (filter);
  `card_search_names` (→ `person_aliases.json` → `authors_text`) võtab ka
  liigiga nimed.
- **MCP** `get_person` näitab nimeajalugu.

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
