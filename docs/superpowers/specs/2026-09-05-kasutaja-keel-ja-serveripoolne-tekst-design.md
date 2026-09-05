# Kasutaja keel-eelistus ja serveripoolne kasutajale nähtav tekst

**Kuupäev:** 2026-09-05
**Issue:** #299 (seotud: #298 — saatmiskanal, blokeeritud)
**Staatus:** disain kinnitatud, plaan kirjutamata

## Probleem

Kasutajaskond on rahvusvaheline, aga VUTT-il ei ole kasutaja keelt kuskil
enne tema esimest sisselogimist, ja serveris tekkiv kasutajale nähtav tekst on
kõik eesti keeles.

Kolm mõõdetud kohta:

1. **Keele-eelistust ei salvestata.** `add_registration`
   (`server/registration.py:41`) kirjutab nime, e-posti, asutuse ja
   motivatsiooni; keelt seal ei ole. `create_invite_token:182` ei kanna seda
   edasi ja `create_user_from_invite:319` kirjutab `users.json`-i ilma
   keeleta. `user_settings.language` tekib alles siis, kui inimene on sisse
   loginud ja seadet käsitsi muutnud.

2. **Kutsekirja tekst on kõvakodeeritud eesti keeles frontendis**, `mailto:`
   URL-i sees (`src/pages/admin/Registrations.tsx:255-262`). Esimene kiri,
   mille inimene VUTT-ist saab, on alati eestikeelne — ka siis, kui ta täitis
   registreerimisvormi inglise keeles.

3. **Teavituse pealkiri salvestatakse eestikeelse lausena.**
   `create_notification` kirjutab faili `f"{nimi} vastas sinu kommentaarile"`
   (`server/routers/notifications.py:99`). Frontendis on tüübipõhine
   tõlkerada olemas (`Notifications.tsx:31`), aga rida 30 eelistab salvestatud
   pealkirja — seega see rada on praktikas surnud, ka eestikeelsel kasutajal.
   Kord kirjutatud lause ei muutu enam kunagi lugeja keele järgi, ka siis kui
   sama inimene keelt vahetab.

Punktid 2 ja 3 on sama viga kahes väljundis: **serveris sündinud lause on
lukus selle keele külge, milles ta sündis.** Punkt 1 on eeltingimus punkti 2
lahendamiseks (kiri lahkub süsteemist, seega saaja keel peab olema salvestatud),
aga MITTE punkti 3 jaoks (teavitust loetakse rakenduses, kus lugeja keel on
niikuinii teada).

## Otsus

### A. Keel püütakse vormil ja kandub nelja kihti

Uus väli `language` väärtustega `et` | `en`.

**Vorm.** `Register.tsx` saab nähtava valiku („Suhtluskeel" / „Language"),
vaikeväärtus = hetkel aktiivne UI keel (`i18n.language`). Nähtav, mitte vaikne:
eestikeelset lehte sirviv inimene võib soovida ingliskeelset kirja, ja enne
esimest sisselogimist ei ole tal ühtki muud kohta, kus seda öelda.

**Ahel.** `POST /register` → `add_registration(..., language)` →
`pending_registrations.json` → `create_invite_token(..., language)` → token →
`create_user_from_invite` → `users.json` kirje `language`.

**Normaliseerimine ühes kohas.** Reegel: väiksed tähed, `-`-i eest võetud osa,
seejärel `et` | `en`, muidu `et`. Nii annab `"EN"` ja `"en-GB"` (brauseri
`i18n.language` võib olla piirkonnaga) `en`, ja tundmatu (`"de"`), tühi või
puuduv väärtus `et` — saidi vaikekeel. Normaliseerimine käib kirjutusteel JA
lugemisteel, nii et vanad kirjed ilma väljata käituvad nagu `et` ilma
migratsioonita (sama muster mis ADR 0022 välise ID kanoonilise kujuga).

**Seeme, mitte migratsioon.** Esimesel sisselogimisel ei kirjutata ühtki faili:
`GET /user-settings` täidab puuduva `language` välja `users.json`-i keelest.
`UserContext.tsx:88` kutsub sealt edasi juba olemasoleva ahela kaudu
`i18n.changeLanguage`. Kui kasutaja Seadetes keelt muudab, kirjutatakse
`user_settings` ja see võidab edaspidi — `users.json` keel on algväärtus, mitte
autoriteet kasutaja praeguse valiku üle.

Olemasolevaid kasutajaid ei migreerita: puuduv väli = `et`, ja kellel
`user_settings.language` juba on, sellel see niikuinii võidab.

**Kes küsib kasutaja keelt, küsib seda ühest funktsioonist.** `users.json`
kannab keelt, mille inimene registreerudes valis; kui ta hiljem Seadetes keelt
muudab, kirjutatakse `user_settings`, MITTE `users.json` — kaks kirjutuskohta
lahkneksid ajas. Seetõttu ei tohi ükski saatja lugeda `users.json`-i otse:
`server/user_language.py` funktsioon `get_user_language(username)` annab
`user_settings.language` → `users.json.language` → `et` ja on ainuõige allikas.

Ilma selleta saaks kasutaja, kes Seadetes keele vahetas, järgmise kirja ikka
vanas keeles — viga, mis ei ilmneks enne #298 saatmiskanali valmimist ja mille
põhjus oleks siis juba ammu kirjutatud. Kahekordset kirjutamist (uuenda ka
`users.json`) EI tehta: üks kirjutuskoht, üks lugemisfunktsioon.

`users.json` keel on niisiis algväärtus ja varuallikas, mitte autoriteet
kasutaja praeguse valiku üle.

### B. Kirjamallid on repos, tekstifailidena

`server/email_templates/invite.et.txt` ja `invite.en.txt`. Kuju:

```
VUTT – konto aktiveerimise link

Tere $name,
...
$url
```

Esimene rida = pealkiri, tühi rida, ülejäänu = keha. Platseholderid
`string.Template` kujul (`$name`, `$username`, `$url`, `$expires_hours`) —
stdlib, uut sõltuvust ei tule.

**Laadimine normaliseerib reavahetused** (CRLF → LF) enne pealkirja ja keha
eraldamist ning strip'ib pealkirja. Windowsis toimetatud mall jätaks muidu
pealkirja lõppu nähtamatu `\r`-i, mis läheb otse kirja `Subject:` päisesse.
Mall ilma tühja reata on viga, mitte pealkirjata kiri: selge erind, mille
püüavad kinni mallide renderdustestid.

**Kuupäeva mallis ei ole.** Tokeni eluiga on konstant (`timedelta(hours=48)`,
`registration.py:209`), seega mall ütleb „$expires_hours tundi" /
„$expires_hours hours" ja arv tuleb sellestsamast konstandist. Nii ei teki
küsimust, kas kuupäev vormindada `05.09.2026 kell 18:00` või `Sep 5, 2026` —
lokaaditundlikku kuupäeva ei sünni üldse. Reegel tulevastele mallidele: **kui
mall siiski vajab kuupäeva, vormindab selle kutsuja saaja keeles ja annab
mallile valmis stringi** — `render_mail` ei võta vastu `datetime`-i.

**Renderdaja:** `server/mail_templates.py`, funktsioon
`render_mail(template_name, lang, **ctx) -> (subject, body)`. Kasutab
`Template.substitute`, MITTE `safe_substitute` — puuduv võti peab andma
`KeyError` testis, mitte saatma kasutajale kirja, milles seisab `$username`.
Tundmatu keel → `et`. Puuduv mallifail on programmeerimisviga, mitte
käitusaja-olukord: viga logisse ja `et` fail.

**Tarbija täna.** `POST /admin/registrations/approve` tagastab lisaks
`invite_url`-ile ka `mail_subject` ja `mail_body`, renderdatuna saaja keeles.
`Registrations.tsx` `mailto:` kasutab neid; kõvakodeeritud eestikeelne tekst
kaob frontendist. Kui #298 lahti läheb, pistab saatja sisse sama malli — teksti
ei kirjutata kaks korda ega kahte kohta.

**Miks repos, mitte `data/config/`-is.** Need kirjad lähevad välja ülikooli
nimel; tekstimuudatus väärib ülevaatust. Repos olev tekstifail rahuldab issue
nõude „toimetatav ilma koodi puutumata" (muudatus on tekstifaili PR, mitte
koodimuudatus) ja annab lisaks selle, mida `data/config/` ei annaks: puuduv või
katkine mall kukub CI-s, mitte kasutaja postkastis.

**Admin saab keelt parandada enne kutse loomist.** Heakskiitmise ekraan on
juba koht, kus valitakse roll ja kirjutamisulatus (`Registrations.tsx`), seega
keel läheb samasse valikute ritta: taotluse kaardil on näha, mille inimene
valis, ja admin saab selle enne kutse loomist ümber lülitada.
`POST /admin/registrations/approve` võtab valikulise `language` parameetri —
puudumisel kasutatakse taotluses salvestatut. See on ainus korrektsioonipunkt
enne kirja väljaminekut: otsekutse-teed (kutse ilma taotluseta)
koodis ei ole — `create_invite_token`-i ainus kutsuja on
`admin.py:62` — ja kui see kunagi lisandub, peab ka tema keele küsima.

**Ulatusest väljas:** `password_reset` mall. Parooli-taastamise vool
(`/admin/users/reset-password`) annab admini ekraanile ainult kopeeritava
lingi, `mailto:` nuppu seal ei ole — mallil ei oleks täna tarbijat. Tuleb koos
#298-ga või koos reset-mailto nupuga, kumb enne.

### C. Teavitused: masina lause renderdatakse lugemisel

**Invariant:** *server ei salvesta lugejale nähtavat lauset, mille ta oskaks
teavituse tüübist tuletada.*

Kaks selgelt eristuvat liiki:

| Liik | Näide | Tekst sünnib | Keel |
|---|---|---|---|
| **Masina teade** | `comment_reply` | tüübist + `actor_name` + `metadata` | lugeja praegune UI keel |
| **Inimese kiri** | admini saadetud sõnum, `sent_notification` | inimene kirjutas | jääb nii, nagu kirjutati |

Masina teate pealkirja renderdab frontend `type` + `actor_name` põhjal
locales'ist. Rada on juba olemas (`Notifications.tsx:31`,
`notifications.commentReplyFallback`), aga rida 30 ei jõua sinna kunagi —
parandus on eelistada tüübipõhist renderdust salvestatud pealkirjale
**teadaolevate süsteemitüüpide korral, tingimusel et kõik tõlkevõtme nõutavad
parameetrid on päriselt olemas**. Puuduv `actor_name` (vana kirje, katkine
metadata) tähendab tagasilangust salvestatud `title`-le — eestikeelne lause on
halb, „undefined vastas sinu kommentaarile" on hullem. Mõju on tagasiulatuv: juba salvestatud teavitused
kannavad `type` ja `actor_name` välju, seega nad hakkavad samuti lugeja keeles
kuvama.

Inimese kirjutatud teksti EI tõlgita ega asendata. Masintõlget ei tehta üheski
suunas — admini kirjutatud sõnum jõuab saajani täpselt sellisena, nagu ta
kirjutati, ka siis kui keeled ei kattu.

Server jätab masina teate `title` välja endiselt kirja: vana klient ja iga
tundmatu tüüp langevad selle peale tagasi. Ta ei ole enam kuvamise autoriteet,
vaid varuvõimalus.

`UserMenu.tsx` kuvab sama teavituste loendit ja peab kasutama sama
renderdusfunktsiooni — kaks kuvamiskohta ei tohi lahkneda. Renderdus tõstetakse
jagatud abifunktsiooni (`src/utils/notificationText.ts` või sarnane), mida
mõlemad kutsuvad.

## Andmemudel

```jsonc
// pending_registrations.json (uus väli)
{ "id": "...", "name": "...", "email": "...", "language": "en", ... }

// invite_tokens.json (uus väli)
{ "token": "...", "email": "...", "language": "en", ... }

// users.json (uus väli)
{ "kasutaja": { "name": "...", "role": "editor", "language": "en", ... } }
```

Kõik kolm on valikulised: puuduv väli = `et`.

## Testid

**Backend**

- keel kandub ahelas: `add_registration` → `create_invite_token` →
  `create_user_from_invite` → `users.json`;
- normaliseerimine kirjutus- JA lugemisteel: `"EN"` ja `"en-GB"` → `en`;
  `"de"`, `""`, `None` → `et`;
- vana kirje ilma `language` väljata käitub nagu `et` (tagasiühilduvus);
- `GET /user-settings` tagastab `users.json` keele, kui `user_settings`-is
  keelt ei ole; ei kirjuta faili;
- `get_user_language`: `user_settings.language` võidab `users.json` keelt, kui
  mõlemad on olemas; kummagita → `et`; keele muutmine Seadetes EI kirjuta
  `users.json`-i, aga `get_user_language` tagastab uue keele;
- iga mall igas keeles renderdub täieliku kontekstiga ja tulemuses ei ole ühtki
  `$` alles;
- puuduv platseholder annab `KeyError` (mitte vaikset `$name`-i kirjas);
- `approve` vastus sisaldab `mail_subject`/`mail_body` saaja keeles;
- `approve` `language` parameeter kirjutab taotluses salvestatu üle, puudumisel
  mitte;
- CRLF-iga mallifail annab sama tulemuse mis LF-iga ja pealkirja lõpus ei ole
  tühimärke;
- mall ilma tühja reata annab selge erindi;
- renderdatud kiri mahub `mailto:` eelarvesse: `encodeURIComponent(subject) +
  encodeURIComponent(body)` alla 1800 märgi. Outlook lõikab pika `mailto:` URL-i
  vaikselt katki, seega on see mõõdetav lävi, mitte soovitus „hoia lühike".

**Frontend**

- `comment_reply` teavitus kuvab tüübist tuletatud pealkirja MÕLEMAS keeles,
  ka siis kui salvestatud `title` on eestikeelne;
- admini saadetud sõnumi pealkiri jääb muutumatuks;
- tundmatu tüüp langeb salvestatud pealkirja peale tagasi;
- teadaolev tüüp PUUDUVA `actor_name`-iga langeb samuti salvestatud pealkirjale,
  mitte ei renderda `undefined`-i;
- `Notifications.tsx` ja `UserMenu.tsx` kuvavad sama teavitust identselt (sama
  jagatud funktsioon);
- `localeParity` (ADR 0011): uued võtmed mõlemas keeles.

## Väravad

`.venv/bin/pytest tests/` · `npm run typecheck` · `npm test` ·
`npm run lint:ci` (lävi 49, ei tõuse).

## ADR

Töö lõpetab ADR, mis fikseerib C-osa invariandi ja B-osa keelevaliku:
serveris sündiv kasutajale nähtav tekst on kas (a) rakenduses loetav → server
salvestab tüübi ja parameetrid, lause renderdab lugeja pool, või (b) süsteemist
lahkuv → server renderdab saaja **salvestatud** keeles, mallist, mitte koodi
sisse kirjutatud stringist.

## Mis EI muutu

Rollid, kutselingi turvapiir (`create_invite_token` rollifiltrid, ADR 0031),
tokeni eluiga, `users.json` ülejäänud kuju, teavituste failipõhine salvestus ja
200-kirje piir, `mailto:` kui kohaletoimetamise viis (kanal on #298),
`encodeURIComponent` mailto parameetritel (juba olemas,
`Registrations.tsx:254-262`).
