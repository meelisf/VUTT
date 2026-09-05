# ADR 0033 — Serveripoolne kasutajale nähtav tekst

**Kuupäev:** 2026-09-05
**Staatus:** vastu võetud
**Seotud:** ADR 0011 (i18n), ADR 0002 (blokeeriv I/O), ADR 0021 (env-nimed)
**Spekk:** `docs/superpowers/specs/2026-09-05-kasutaja-keel-ja-serveripoolne-tekst-design.md`

## Kontekst

Kasutajaskond on rahvusvaheline, aga VUTT-il ei olnud kasutaja keelt kuskil
enne esimest sisselogimist, ja serveris tekkiv kasutajale nähtav tekst oli
kõik eesti keeles. Kaks mõõdetud kohta olid sama viga kahes väljundis:
teavituse pealkiri kirjutati faili valmis eestikeelse lausena
(`f"{nimi} vastas sinu kommentaarile"`, `server/routers/notifications.py`)
ja kutsekiri oli kõvakodeeritud eesti keeles frontendis, `mailto:` URL-i sees
(`src/pages/admin/Registrations.tsx`). Mõlemal juhul oli serveris sündinud
lause lukus selle keele külge, milles ta sündis — ka siis, kui lugeja või
saaja keel oli teine.

See viga kordub iga uue teavitustüübi ja iga uue kirjaga, kui invariant ei
ole fikseeritud registris: iga järgmine arendaja, kes lisab uue teavituse
või kirja, seisab uuesti sama valiku ees ilma, et keegi oleks talle
põhjust öelnud.

## Otsus

### 1. Serveris sündiv kasutajale nähtav tekst jaguneb kaheks

**Rakenduses loetav (teavitus).** Server salvestab tüübi ja parameetrid
(`type`, `actor_name`, `metadata`), mitte valmis lauset. Lause renderdab
lugeja pool, tema PRAEGUSES keeles, lugemise hetkel — ka juba salvestatud
kirjete jaoks, sest need kannavad samu välju. Renderdus elab
`src/utils/notificationText.ts` funktsioonis `notificationTitle`.

**Süsteemist lahkuv (kiri).** Server renderdab saaja SALVESTATUD keeles,
mallist, `render_mail` funktsiooniga (`server/mail_templates.py`), enne kui
kiri väljub.

**Põhjus.** Teavitust loetakse seal, kus lugeja keel on teada — brauser on
lahti, `i18n.language` on käes, keele saab igal hetkel üle kontrollida.
Kiri läheb sinna, kus seda ei ole: postkast ei kanna endaga kaasas saaja
hetkeseisu, ainult see, mis kirja sees juba oli, jõuab kohale. Sama
renderdusstrateegia mõlemas suunas oleks vale ühes neist — kas teavitus
jääks lukku vananenud keelde (nagu see praktikas oligi, kuni parandati) või
kiri üritaks renderdada keeles, mida serveril väljasaatmise hetkel enam
küsida ei ole kust.

Inimese kirjutatud teksti (nt admini saadetud `sent_notification` sõnum) EI
tõlgita ega asendata üheski suunas — masintõlget ei tehta, tekst jõuab
saajani täpselt nii, nagu ta kirjutati.

### 2. Kasutaja keelt küsitakse ühest funktsioonist

`get_user_language(username)` (`server/user_language.py`):
`user_settings.language` → `users.json.language` → `et`. Üks kirjutuskoht
(Seadetes tehtud muudatus kirjutab `user_settings`), üks lugemiskoht.

**Põhjus.** `users.json` kannab keelt, mille inimene registreerudes valis.
Kui Seadetes tehtud muudatus kirjutataks tagasi ka `users.json`-i, oleks
kaks kirjutuskohta, mis lahkneksid ajas — mõni tulevane kirjutustee unustaks
ühe neist uuendada. Selline lahknemine ei ilmneks kohe: viga jääks
märkamatuks kuni hetkeni, mil esimene automaatkiri pärast keele vahetust
välja läheb, mis on ammu pärast seda, kui vale kirjutuskoht kirjutati.
Üks lugemisfunktsioon, mis teab prioriteeti (`user_settings` võidab
`users.json`-i), välistab selle klassi vea täielikult — ükski saatja ei loe
`users.json`-i otse.

`normalize_language()` (samast moodulist) käib nii kirjutus- kui
lugemisteel: väiksed tähed, `-`-i eest võetud osa, seejärel `et` | `en`,
muidu `et`. Vanad kirjed ilma `language` väljata käituvad nagu `et` ilma
migratsioonita (sama muster mis ADR 0022 välise ID kanoonilise kujuga).

### 3. Mallid on repos, `Template.substitute`-ga

Kirjamallid (`server/email_templates/{nimi}.{keel}.txt`) on tekstifailidena
repos, platseholderid `string.Template` kujul (`$name`, `$username`, `$url`,
`$expires_hours`), renderdus `Template.substitute` (mitte `safe_substitute`).

**Põhjus.** Puuduv platseholder peab andma `KeyError` mallide
renderdustestis (`tests/test_mail_templates.py`), mitte saatma kasutajale
kirja, milles seisab sõna-sõnalt `$username`. `safe_substitute` peidaks vea
vaikimisi — kiri läheks välja, ainult katkiselt. `Template.substitute`
muudab sama vea CI punaseks, ammu enne kui ükski kiri saadeti.

Puuduv mallifail (`{nimi}.{keel}.txt` ei eksisteeri) annab `FileNotFoundError`.
See on **teadlik valik, mitte lohakus**: puuduv mall on programmeerimisviga
(vale malli nimi koodis, unustatud keelevariant) — käitusaja-olukord, mida
peaks graatsiliselt käsitlema, oleks nt tundmatu kasutaja sisend, mitte
koodi enda seisund. Graatsiline degradeerumine (logi + vaikimisi `et` fail)
peidaks vea tootmises vaikselt ja jätaks ta avastamata seni, kuni keegi
juhuslikult logi loeb — samas kui `FileNotFoundError` kukutab kohe, testis,
selle kirjutamise hetkel.

Kuupäevi mallides ei ole — kuupäev on lokaaditundlik (`05.09.2026 kell
18:00` vs `Sep 5, 2026`) ja tekitaks küsimuse, kumb vorming. Tokeni eluiga
tuleb konstandist `INVITE_EXPIRY_HOURS` (`server/registration.py`), mitte
mallisisesest kuupäevast: mall ütleb „$expires_hours tundi" / „$expires_hours
hours" ja arvväärtuse annab kutsuja sellestsamast konstandist. Kui mall
tulevikus siiski vajab kuupäeva, vormindab selle KUTSUJA saaja keeles ja
annab mallile valmis stringi — `render_mail` ei võta vastu `datetime`-i.

## Tagajärjed

Iga uus teavitustüüp, mille lause server oskaks tüübist + parameetritest
tuletada, läheb `notificationTitle` (`src/utils/notificationText.ts`)
renderdusloogikasse, mitte valmis lausena faili. Iga uus väljasaadetav kiri
kutsub `render_mail`-i ja saab endale mallipaari (`{nimi}.et.txt` /
`{nimi}.en.txt`), mitte kõvakodeeritud stringi kutsuja koodis. Iga uus
serveripoolne saatja, mis vajab kasutaja keelt, kutsub `get_user_language`-i
— mitte ei loe `users.json`-i ega `user_settings`-i otse.

Valvavad:

- `tests/test_user_language.py` — normaliseerimine (suured tähed,
  piirkonnavariandid, tundmatu/tühi/puuduv väärtus) ja `get_user_language`-i
  prioriteet (`user_settings` võidab `users.json`-i);
- `tests/test_mail_templates.py` — mõlemas keeles renderdub täieliku
  kontekstiga tulemuseta `$`-jäägita, puuduv platseholder annab `KeyError`,
  puuduv mall annab `FileNotFoundError`, tundmatu keel langeb `et`-le tagasi;
- `src/utils/__tests__/notificationText.test.ts` — sisaldab eristavat testi
  (`sent_notification actor_name-iga ei lähe masin-renderdusse`), mis kukub,
  kui `notificationTitle` hakkaks otsustama ainult `actor_name` olemasolu
  põhjal, mitte `type` põhjal. Ilma selle kontrollita renderdaks funktsioon
  admini käsitsi kirjutatud sõnumi masinlausena üle, kui see juhtumisi kannab
  ka `actor_name` välja — täpselt vastupidi otsusele 1.

## Mis EI muutu

Inimese kirjutatud teksti (kirjad, `sent_notification` sõnumid) ei tõlgita
ega asendata üheski suunas — see ADR reguleerib ainult serveris SÜNDIVAT
teksti. Server jätab masina teate `title` välja endiselt kirja salvestamisel
— see ei ole enam kuvamise autoriteet, aga jääb varuvõimaluseks vanale
kliendile ja tundmatule tüübile. `password_reset` mall ja saatmiskanal
(#298) on ulatusest väljas.
