# 0082 — Isiku eristav täiend

**Staatus:** vastu võetud 2026-11-12, teostamata
**Seotud:** ADR 0048 (isikukaardi ülevaatus ja ID-d), ADR 0058 (MCP ettepanekud), ADR 0059 (ameti- ja asutuseregister)
**Issue:** #794 (teostus), #795 (nimemuutus elu jooksul, p 7)

## Kontekst

Kasutaja kaebus (2026-11-12): kahte samanimelist isikut ei saa valijas ega loendis
eristada. Tootmises on 46 nime, mille all on kokku 95 isikut, näiteks patronüümilised
nimed (Magnus Erici, Johannes Erici) ja levinud nimed (Johannes Holm). Isikuvalija
(`ProsopoPersonPicker`) näitab nime kõrval ainult eluaastaid. Kui need on teadmata,
ei ole midagi. Kasutaja ei pruugi aastaid peast teadagi.

Skeemis on väljad `name.qualifier` ja `name.qualifier_type` olemas (kõigil 2472
kaardil), aga nende tähendus on segane. Vormis on silt „täiend” ja vihje
„von, van, de…”, ehk nimeosake. Andmetes on väli täidetud 7 kaardil: 4× „von”
(nimeosake), „Junior”, „noorem” (eristavad) ja „Gripenhielm” (Emundus Figrelius
aadlinimi, ehk nimemuutus elu jooksul). `qualifier_type` ei ole kordagi täidetud.
Server kasutab `qualifier`-it ainult sortimisnime tuletamisel
(`person_search.py`, perekonnanimeta isikul eemaldatakse nime lõpust).

Kaaluti automaatset eristavat rida ametist ja kohast. See lükati tagasi:
- 2179 isikul 2472-st pole ühtegi ametit, ametiga isikuid on 293;
- 731 ametist on dateeritud 159, nii et ka „viimast” ametit ei saa usaldusväärselt
  valida;
- esimene või juhuslik amet ei iseloomusta isikut. Parrot oli esmalt koduõpetaja,
  tuntud on ta ülikooli professorina. Masin ei tea, mille järgi isikut tuntakse.

Raamatukogude normandmete tava (RDA, GND) eristab samanimelisi eluaastatega, nende
puudumisel tegevusajaga ja seejärel ametiga või tiitliga. Wikidata näitab valijas
nime all lühikest kirjeldust. Vikipeedia sulud on sama asi pealkirja sees, kuna
muud kohta seal pole.

## Otsus

1. **Automaatselt näidatakse ainult kuupäevi.** Eluaastad (`birth`/`death`), nende
   puudumisel floruit (`fl. 1626–1645`). Need on faktid ja nende puhul pole midagi
   valida. Ametit, kohta ega staatust automaatselt EI tuletata.
2. **`name.qualifier` on käsitsi kirjutatav eristav täiend.** Lühike vabatekst,
   mille kirjutab toimetaja, näiteks „ülikooli professor”, „noorem”, „raehärra
   Riias”. Täiend **ei ole nime osa**: `name.label` jääb muutmata, otsing ja
   sortimine ei sõltu sellest ning tsitaat jääb puhtaks. Vormi silt muutub
   („Eristav täiend”, vihje „nt ülikooli professor, noorem”).
3. **Kuvamine.** Rikkas kasutajaliideses näidatakse nime järel hallilt eristavat
   rida: täiend ja kuupäevad (`Johannes Holm · ülikooli professor · 1608–1660`).
   Kus on võimalik ainult tavatekst (võrgustiku kaardi sildid, MCP vastused,
   eksport), on kuju `Johannes Holm (ülikooli professor, 1608–1660)`. Mõlemad
   kujud ehitab ÜKS funktsioon kliendis ja ÜKS serveris (eristava rea tuletus),
   et vaated ei hakkaks lahknema. Kohad: isikuvalija, isikute loend ja kaart,
   isikuleht, sarnaste isikute hoiatus, ühendamise modaal, võrgustiku kaart, teose
   autorite rida (kui isiku ID on teada) ning MCP `search_persons`/`get_person`.
4. **Abi toimetajale, aga automaatset valikut mitte.**
   - Vormis pakutakse kaardi ameteid ühe klikiga täiendiks. Toimetaja valib
     pakkumise või kirjutab ise.
   - **Samanimeliste vihje:** kui sama `name.label`-iga (tõstutundetult) on veel
     mõni isik ja täiend puudub, näitavad isikuleht ja vorm vihjet
     „Samanimelisi isikuid: N — lisa eristav täiend”. Ka uue isiku loomisel tuleb
     vihje kohe. Nii saab olemasolevad kollisioonid järk-järgult läbi käia ilma
     eraldi kampaaniata.
5. **Olemasolevad andmed.** 4× „von” viiakse perekonnanime juurde (nimeosake kuulub
   sinna, vormi perekonnanime vihje on juba „von Münchhausen”). „Junior” ja
   „noorem” jäävad. „Gripenhielm” eemaldatakse täiendist (ta on aliaste hulgas
   juba olemas) ja nimemuutuse mudel lahendatakse eraldi (vt p 7). Teisendus
   käib kaardi salvestustee kaudu (`_save_person_locked`, ADR 0048), mitte otse
   failidesse.
6. **`qualifier_type`** jääb kasutamata. Kui hiljem on vaja eristada põlvkonda
   („noorem”) muust täiendist, kasutatakse seda, mitte uut välja.
7. **Nimemuutus elu jooksul EI OLE täiend.** Näited: Johannes Erici Stregnensis →
   Johan Stiernstråle, Emundus Figrelius → Gripenhielm. Sama isik esineb
   allikates eri aegadel täiesti eri nime all ja näib esmapilgul kahe isikuna.
   See vajab ajaga seotud nimekirjet (nimi + liik, nt aadlinimi, + alates) ning
   kuvamist ja otsingut, mis selle sidet näitab. See on eraldi otsus ja eraldi
   issue. Täiend seda ei lahenda ega tohi selleks kasutada.

## Tagajärjed

- Valijas ja loendis on samanimelised eristatavad niipea, kui kuupäev või täiend on
  olemas. Ilma kumbagita on vihje nähtav seal, kus toimetaja saab selle parandada.
- Kaardi skeem ei muutu (väli on olemas). Muutuvad vormi silt ja vihje,
  kuvamiskohad ja isikuindeksi kirje (eristav rida peab loendisse jõudma ilma iga
  kaarti eraldi laadimata).
- Automaatne amet on teadlikult välja jäetud. Kui ametiandmed tulevikus paranevad
  (dateeritud, „põhiamet” märgitud), saab selle otsuse üle vaadata. Seni oleks
  vale täiend halvem kui puuduv.
