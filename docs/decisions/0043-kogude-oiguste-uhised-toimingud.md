# ADR 0043 — Kogude õigustel on ühised toimingud ja rollipõhised vaated

**Kuupäev:** 2026-09-14
**Staatus:** kehtib (teostatud 2026-09-14/15, #318)
**Seotud:** ADR 0031, 0038, 0042; #318, #354
**Spekk:** [Kasutajad ja kogude ligipääs](../superpowers/specs/2026-09-14-kasutajad-ja-kogude-ligipaas-design.md)

## Kontekst

Õigusi on vaja hallata nii inimese kui ka kogu juurest. Praegune
`PUT /admin/collections/{id}` kirjutab `allowed_users` kaudu samu
`allowed_collections` andmeid kui kasutajahaldus, kuid ilma selle
rollihierarhia, sanitiseerimise, järjestuse ja no-op reegliteta. Kahe
kirjutustee erinevused põhjustavad määrangute vaikset muutumist.

Kollektsioonide leht on tervikuna superadmin-only, kuigi kogu õiguste
lugeja `GET /admin/collections/{id}/users` ja kasutajahaldus on adminile
lubatud. Admin peab seetõttu koguga seotud ülesande tegemiseks minema
kasutajate juurde. Ühise vaate avamine ei tohi anda talle kogu seadete
muutmise õigust ega toimetajale kasutajate üldloendit.

## Otsus

1. Autoriteet jääb `users.json` väljadele `allowed_collections` ja
   `edit_collections` ning töökollektsiooni `access`-kaardile. Kogu juures
   olev paneel on teine sisenemistee samadele toimingutele, mitte õiguste
   koopia. Töökollektsiooni määrang ei anna teoste lugemis- ega kirjutamisõigust.
2. `allowed_users` kirjutusharu eemaldatakse kollektsiooni PUT endpoint'ist.
   Vana sisend lükatakse tagasi enne kõrvalmõjusid. `CollectionEditor` ja
   kasutajadetail kasutavad ühist määrangute delta-toimingut; olemasolevad
   kasutajahelperid jagavad selle valideerimist ja lukustust. Lugemiseks
   laiendatakse olemasolevat GET users endpoint'i, uut paralleelset lugejat
   ei tehta. Avalikule kollektsioonile lugemismäärangut ei lisata.
3. Kasutajate jagatud cache-objekti loe-kontrolli-muuda-salvesta tsükkel
   toimub tervikuna olemasoleva `users_lock` all. See hõlmab kolme
   `update_user_*` helperit, uut delta-toimingut ja teisi sama objekti
   kirjutajaid. Ainult `save_users` sees olev lukk ei kaitse serialiseerimist
   teise lõime muudatuste eest. Kasutajate kopeeritud hetktõmmis võetakse
   `users_lock` all; lukk vabastatakse enne `_work_sets_lock` võtmist.
   Neid lukke ei hoita korraga ega võeta kasutajalukku koguluku sees.
   Kogutoiming valideerib selle hetktõmmise järgi; samaaegset kustutamist
   talutakse inertse jäänukina, mitte failideülese atomaarse tehinguna.
4. Kollektsioonide loend ja õiguste haldus on admin+; kollektsiooni seadete
   ja struktuuri muutmine jääb superadminile. Õiguste muutmise sihtkasutaja
   piirid jõustab server. Ühine navigeerimine ei ühenda rolle ega andmemudeleid.
5. Töökollektsiooni haldur näeb oma kaarti kasutajanimedega lugemisvaates;
   ainult admin+ saab üldloendist inimesi otsida ja määranguid jagada.
   Uusi admin+ määranguid ei looda, sest nende haldusõigus tuleneb rollist.
   Vana kirje võib säilida muutmatult; enda või madalama rolli vana kirje
   eemaldamine on koristuserand. Admin ei muuda superadmini kirjet.
6. Paneel kogub mustandi ja salvestab nupust. Kollektsiooniõiguste pakett
   invalideerib iga muutunud kasutaja sessioonid üks kord ning kasutajaliides
   ütleb enne salvestust, et need inimesed peavad uuesti sisse logima.
   Töökollektsiooni access-muudatus sessioone ei invalideeri. Revision-konflikti
   korral täisasendust automaatselt uuesti ei saadeta.
7. `PUT access` jääb teadlikult täisasenduseks koos olemasoleva teenusega.
   Klient säilitab ka kõik lukustatud ja puutumata pärandkirjed; server
   klassifitseerib vana/uue kaardi diffi koguluku all. Puuduv võti tähendab
   eemaldamist, üks keelatud muudatus lükkab terve salvestuse tagasi.
8. Kustutatud kasutajanimed reserveeritakse püsivalt state-registris.
   `delete_user` salvestab reserveeringu enne konto eemaldamist ning
   `registration.create_user_from_token` kontrollib registrit koos nimevaliku
   ja konto salvestusega ühe kasutajaluku all. Konto loomisel kogufaile ei
   skannita; vanade surnud access-nimede import on ühekordne juurutuse eelsamm.

## Tagajärjed

Teostatud tervikuna: etapp 1a (serveri ja konto elutsükli parandus,
`POST /admin/users/collection-rights` delta), etapp 1b (töökollektsiooni
ligipääsupaneel), etapp 2 (kollektsiooniõiguste delta kasutuselevõtt,
kaks telge koos alusega, `allowed_users` kirjutusharu eemaldamine, kogude
loend ja ligipääs adminile, seaded superadminile), etapp 3 (otsitav
kasutajanimekiri ja `/admin/users/:username` detail, §1) ning etapp 4
(ühine „Kogud” sisenemiskoht `CollectionsHub` tüübifiltriga, kollektsiooni
detailvaade kolme plokiga, §4).

Kaks kohta lahendati plaanitust teisiti. Hall märkeruut, mida ei saa
lülitada, segab ka ilma seletava sildita: reegel on „lüliti ainult seal,
kus lülitamine muudab tegelikku ligipääsu" ja seda otsustab `rightsControl`
(`collectionRightsDraft.ts`), mitte sildi peitmine. Aegunud sessioon on
vaates oma veateade (`isSessionExpired`, `utils/apiErrorText.ts`) — ilma
selleta luges väljalogimine kasutajale andmekaona, sest sessioonid elavad
mälus ja iga juurutus logib kõik välja.

Kollektsioonipaneel näitab selle kaudu antud õigusi. Teose mitmesse kogusse
kuulumise, avalikkuse või jagatava lingi tõttu ei ole see täielik ligipääsuaudit.
Avalikuks muutmine kasutajaid ei kirjuta. Alles jäänud määrangud kuvatakse
inertsena ja neid saab käsitsi eemaldada; uuesti piiramine võib alles oleva
lugemismäärangu taas jõustada. Ka editor'i salvestatud kirjutamisulatus
näidatakse inertse määranguna, mitte ei peideta rollifiltriga. Kirjutamisulatus
jääb eraldi teljeks. Kollektsiooni kustutamisel
koristatakse nii lugemisõigus kui kirjutamisulatus ühise lukustatud toiminguga.

Kasutaja kustutamine ei kirjuta kõigi töökollektsioonide faile ümber.
Admin saab surnud kirje eemaldada; muutmata vana kirje ei blokeeri teiste
muudatuste salvestamist. Uus tundmatu kasutajanimi lükatakse tagasi.
Konto loomine ei tohi vanadesse access-kaartidesse alles jäänud kasutajanime
taaskasutamisega taastada kustutatud inimese õigusi. Täpsed legacy-kirjete,
mahupiiri ja veakäsitluse reeglid on speki §5-s.

Adminifiltrid (`rights_collection`, `rights_work_set`) ei muuda aktiivset
töökogu ega kasuta `useCollectionUrlSync`-i. Mõlemad paneelid kasutavad
olemasolevaid `workSetAccess.ts` puhtaid funktsioone; õiguste isikupõhiseid
vastuseid ei hoita `server/cache.py` globaalses vahemälus.
