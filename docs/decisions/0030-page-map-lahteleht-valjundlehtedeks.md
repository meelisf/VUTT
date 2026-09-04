# ADR 0030 — `page_map` kaardistab lähtelehe kõigile temast tekkinud väljundlehtedele

**Kuupäev:** 2026-09-03
**Staatus:** vastu võetud
**Seotud:** ADR 0028 (VUTT materialiseerib OCR-i lehed), ADR 0022 (välise ID
kanooniline kuju)
**Spekk:** `docs/superpowers/specs/2026-09-03-ada-handle-import-design.md`

## Kontekst

ADA-import (vt spekk) peab pärast importi teadma, millisele VUTT-i leheküljele
konkreetne allalaaditud lähtefail (üks ADA bitstream) maandus, et kirjutada
sinna provenance-kommentaar ja `source`-väli. Probleem ei ole ADA-spetsiifiline
— see on üldine lünk `_transfer_pages`-is (`server/upload/prepress_apply.py`),
mis käib sammu 3 plaanist läbiviidud lähtelehti `n = 1..count`, jätab
väljajäetud (`excluded`) vahele ja annab avaldatud lehtedele järjestikuse
`out_index`-i — kuid ei salvesta kusagile, milline lähteleht millise
väljundnumbri sai.

Ilma selle kaardita ei ole sammu 3 väljajätmise ega poolitamise järel enam
võimalik usaldusväärselt öelda, millisele väljundlehele lähteleht `n` läks.
Sama lünk mõjutaks igat tulevast funktsiooni, mis peab lähtelehele tagasi
viitama (mitte ainult ADA-importi).

## Otsus

`_transfer_pages` kirjutab iga avaldatud lähtelehe kohta **järjestatud listi**
temast materialiseeritud väljundlehtedest:

```json
"prepress.page_map": {"1": [1], "2": [2, 3], "3": [4]}
```

Kirjutus toimub **mõlemas** kohas, kus `out_index` kasvab — baithaaval
kiirteel (muutmata pilt kopeeritakse otse) ja poolituse lõikesilmuses.
Mõlemas kohas käib see sama `mutate_prepress(applied_done=n, ...)` kutsega,
mis niikuinii juba edenemist kirjutab — täiendav võti, mitte täiendav
kirjutus. `mutate_prepress` on ADR 0028 järgi ainus lubatud tee `prepress`
alamväljade muutmiseks.

Kaart **nullitakse iga apply alguses** (`try_begin_applying`,
`server/upload/state.py`). Lähteleht, mis ei andnud ühtki väljundit (täielikult
`excluded`), kaardis ei esine.

### Miks list, mitte üks number

Sammu 4 `deleted` käib **väljundlehe**, mitte lähtelehe kohta
(`mark_page_deleted` sobitab `filename` järgi, `upload_ops.py`). Poolitatud
lähteleht annab kaks väljundlehte ja admin võib kustutada neist ainult ühe:

```
src 10 poolitatakse → out 17 (ülemine), out 18 (alumine)
admin kustutab sammus 4 out 17, jätab out 18
```

Üheainsa `int`-iga oleks ankur `17` — kustutatud leht — kuigi lähtefail ise on
VUTT-is täiesti olemas oleva `out 18` kaudu. Listiga leiab lugeja `18` ja
viide maandub õigesti. Semantiliselt on list ka õigem üldine mudel: üks
lähteleht annab 0, 1 või N väljundlehte, mitte alati täpselt ühe.

### Miks nullimine apply alguses

Apply CAS lubab üleminekut ka olekust `error` (`APPLY_START_STATUSES`,
`state.py`) ja loeb kordusi `apply_attempts`-i — kordus-apply on päris juhtum
ja võib joosta **teise plaaniga** kui esimene katse (nt admin muutis
väljajätmisi enne uut proovi). Kui vana kaardi võtmed jääksid alles, osutaksid
nad eelmise katse nummerdusele, mitte uuele — ankrud maanduksid vaikselt
valel leheküljel.

## Tagajärjed

**Rikkumise tagajärg on vaikne.** Kui kaart puudub, on osaline või kirjutatakse
ainult ühte `out_index`-i kohta (nt ainult kiirtee, mitte poolituse haru, või
vastupidi), maandub viide valele leheküljele — midagi ei kuku, testid ei
punase, tulemus on lihtsalt vale. See on halvim liik viga ja põhjus, miks see
ADR eksisteerib eraldi, mitte ainult koodikommentaarina.

`prepress` ise ei tea ADA-st ega ühestki konkreetsest tarbijast midagi — kaart
on üldine ja kasutatav iga tulevase funktsiooni poolt, mis peab lähtelehelt
väljundlehele viitama.

## Mis EI muutu

`page_map` ei asenda ega muuda sammu 3 `excluded`/`mode` ega sammu 4
`deleted` semantikat (mõlemad ADR 0028 ja ADR 0026 järgi endised) — ta on
puhtalt lugemismudel, mis registreerib, mida need otsused väljundile tegid.
