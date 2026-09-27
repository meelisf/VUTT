# VUTTi turva- ja andmelekkeülevaade — 2026-09-27

Ajend: TÜ raamatukogu e-raamatupoe võimalik kliendiandmete leke. Kasutaja
kinnitusel ei jaga VUTT e-raamatupoega serverit, kontosid ega SSH-võtmeid.
See välistab nimetatud ühised ligipääsuteed, mitte kõiki võimalikke seoseid.

**Hinnang:** läbivaadatud teedes ei tuvastatud anonüümset kasutajate nimekirja
või parooliräside allalaadimise võimalust. See ei ole tõend, et sissemurdmine
on võimatu või et server pole varem kompromiteeritud. Leiti konkreetsed
seadistuspuudused, mis suurendavad ühe teenuse või kohaliku konto rikke mõju,
ning otsingutokenite tühistamise ja uuendamise puudused.

## Ulatus ja tõendite piirid

- Kohalik lähtepunkt `2ddfe6d5`; tootmise hoidla `789d6202` (PR #494).
  Tootmise Git HEAD ei tõenda iseenesest konteinerisse ehitatud koodi versiooni.
- Loetud viimase koondülevaatuse turvaleiud, varasem turvaülevaade, ADR-id,
  auth/deps, admini kasutaja- ja registreerimisteed, paroolitaaste osi,
  tokenite väljastamine, avalikud allalaadimis- ja metaandmete teed,
  konteinerid/nginx ning OCR-i SSH-ühenduse loomine.
- Tootmises ainult lugemine: konteinerite pordid, kasutajad, mount'id,
  valitud keskkonnaseadete **olek**, failide õigused, nginx, SSH ja tulemüür.
  Saladuste väärtusi ega päris kasutajaandmeid ei väljastatud.
- Tootmise anonüümsed POST-proovid `/admin/users` ja `/admin/registrations`
  jäid tegemata: automaatne turvakontroll blokeeris terve kontrollkäsu
  võimalike kõrvalmõjude tõttu. Nende teede kaitse hinnang tugineb koodile
  ja kohalikele testidele, mitte tootmise HTTP-proovile.
- Ülevaatuse ajal toimus töökaustas teine arendustöö (teose osade ettepanekud).
  Käesoleva töö koodimuudatus on ainult `server/routers/auth.py`; lisaks uus
  `tests/test_meili_refresh_security.py`, käesolev aruanne ja docs-register.
- Ei tehtud koormustesti, sissemurdmise simulatsiooni, logide kohtuekspertiisi,
  välisvõrgu pordiskanni ega kogu koodibaasi rea kaupa auditit.

## Leiud tähtsuse järjekorras

### S27-01 — hosti saladused ja kasutajaandmed on kohalikele kasutajatele loetavad

**Kinnitatud tootmises.** `.env` režiim 0664, `state/` 0775 ja
`state/users.json` 0644. Vanemad `/home` 0755, kasutaja kodu 0751 ja
`VUTT/` 0775 lubavad teistele läbimist. Tavapäraste Unix-õiguste järgi saab
teine kohalik kasutaja teadaoleva teega faili lugeda. Täiendavaid ACL-e ega
seda, millised teised kohalikud kontod on kasutatavad, ei inventeeritud.

Mõju: kohaliku konto või selle õigustes jooksva teenuse kompromiteerimine
võib anda rakenduse saladused ning kasutajate nimed, e-postid ja parooliräsid.
See ei tõenda failide avalikku serveerimist HTTP kaudu.

**Esimene parandus:** `.env` 0600, `state/` 0700, kontrollitud omanikud.
Esmalt kontrollida backend-konteineri ja varunduskonto ligipääsu. Üksnes
`users.json` chmod pole püsiv lahendus: fail asendatakse salvestamisel.
Privaatne vanemkataloog kaitseb ka uusi faile. Varunduse dokumentatsioon
juba nõuab privaatset state-kausta taastamisel.

**Staatus 2026-09-27: PARANDATUD tootmises.** Enne: `.env` 664, `state/` 775
(tagasipööramine: `chmod 664 .env; chmod 775 state`, salvestatud
`/tmp/s27-01-rollback.txt`). Pärast: `.env` 600, `state/` 700, omanik
`meelisf`. Sõltuvused kontrollitud enne muudatust: ükski konteiner ei mount'i
`.env`-i (compose loeb seda `meelisf`-ina); backend kirjutab `state/`-i
konteineri root'ina; `server_update.sh` muudab ainult `data/` omanikku, seega
õigused püsivad. Teine sisselogitav kohalik konto on `badmin` (uid 1000).
Järelkontroll: backend kirjutab `state/`-i, `docker compose config` loeb
`.env`-i, kõik konteinerid terved, sait ja API 200, **päris varundustee**
(loss → `vutt-backup`, rrsync -ro) loeb `state/`-i (sh `users.json`).
Kõrvalleid: `state/prosopo_enrichment_proposals.sqlite3` on `root 600` ja
jääb varundusest välja (ajutised ootel ettepanekud, ADR 0058 — aktsepteeritav).

### S27-02 — Umami töötab vaikesaladustega ja teiste teenustega samas võrgus

**Kinnitatud tootmise konteinerikeskkonnas:** `vutt-umami` `APP_SECRET` ning
`vutt-umami-db` `POSTGRES_PASSWORD` võrdusid compose'i teadaolevate
arendusvaikeväärtustega. PostgreSQL-i juba loodud kasutaja tegelikku parooli
sisselogimisega ei testitud: keskkonnamuutuja ei tõenda olemasoleva andmeköite
parooli. Umami port on localhostil, andmebaasil puudub hosti avaldatud port;
nginx avaldab analüütika skripti ja kogumisotspunkti.

Mõju: nõrgad saladused ja ühine Dockeri võrk vähendavad teenuste eraldatust.
See **ei tähenda**, et Umami andmebaas sisaldab VUTTi kasutajate parooliräsisid.
VUTTi kasutajafail on eraldi backendi state-köites.

**Parandus:** vaheta mõlemad saladused; olemasoleva PostgreSQL-köite korral
muuda ka andmebaasi kasutaja parooli, mitte ainult `.env`-i. Eemalda tootmise
compose'ist vaikimisi saladuste fallback'id. Eralda Umami/DB võrk VUTTi
backendist, pildiserverist ja Meilisearchist. Kontrolli analüütika toimimist
pärast muudatust.

**Staatus 2026-09-27: PARANDATUD tootmises (PR #498).** Uued juhuslikud
`UMAMI_DB_PASSWORD` / `UMAMI_APP_SECRET` genereeriti serveris otse `.env`-i
(väärtusi ei väljastatud); olemasoleva andmeköite kasutaja parool muudeti
`ALTER USER`-iga. Compose nõuab mõlemat (`${VAR:?}`) ja Umami + PostgreSQL on
eraldi võrgus `vutt_analytics`. Sõltuvused kontrollitud enne: backend ei
suhtle Umamiga, nginx kasutab ainult `127.0.0.1:3000`, Umami andmeköide pole
varunduses (analüütika; teadlik). Järelkontroll: vana vaikeparool lükatakse
**võrgu kaudu** tagasi, uus töötab; heartbeat 200, `umami.js` 200,
`/api/send` salvestab (testkirje kustutati); backend ei lahenda `db-umami`
nime. Tagasipööramine: `.env.bak-s27-02` (600) + `ALTER USER` vana parooliga +
compose'i eelmine versioon. Kõrvalmõju: Umami halduspaneeli sessioonid
kehtetud (uus `APP_SECRET`).

### S27-03 — sessiooni tühistamine ei tühista juba antud otsingutokenit

**Kinnitatud koodis ja arhitektuuris.** `USER_MEILI_TOKEN_TTL_SECONDS` on
24 tundi; nginx suunab `/meili/` päringud otse Meilisearchi. VUTTi
`delete_user_sessions` eemaldab API-sessiooni, kuid Meilisearchi JWT jääb
oma aegumiseni kehtima. See kehtib väljalogimise, konto kustutamise,
paroolitaaste ja õiguste vähendamise järel.

Mõju: varem väljastatud tokeni valdaja võib jätkata talle tokenis lubatud
piiratud teoste otsimist/lugemist kuni 24 tundi. Admini tokeni otsingureegel
on piiranguta. See pole kasutajahaldusõigus ega juurdepääs `users.json`-ile.
Teosepõhised viewer-tokenid ja pildiallkirjad kestavad eraldi kuni tund.

[Meilisearchi spetsifikatsiooni](https://github.com/meilisearch/specifications/blob/main/text/0089-tenant-tokens.md)
järgi ei saa üksikut tenant-tokenit tühistada; allkirjastava API-võtme
kustutamine tühistab kõik selle võtmega antud tokenid.

**Parandusettepanek:** lühenda autenditud otsingutoken 5–15 minutile ning
kontrolli olemasoleva automaatvärskenduse ja taustatabide käitumist. Kohene
õiguste eemaldamine vajab sessioonikontrolliga otsinguproksit või eraldi
võtmete/tühistamise lahendust. Pelk lühem TTL piirab, aga ei kõrvalda akent.
See vajab eraldi muudatust: praegune test nõuab teadlikult sessiooniga sama TTL-i.

### S27-04 — otsingutokeni värskendus jättis sessiooni aegumise kontrollimata

**Kinnitatud regressioonitestiga; lokaalselt parandatud, deploy tegemata.**
`server/routers/auth.py` kasutas `get_session`-it, mis ei kontrolli aegumist.
Enne viieminutilist taustapuhastust sai aegunud sessiooniga väljastada uue
24-tunnise otsingutokeni. Lisaks asendati sessiooni koguõigused teise
allika, kasutajafaili õigustega, vastuolus ADR 0046-ga.

Parandus kasutab ühist `deps.get_user` kontrolli. Testid näitasid enne
parandust kaht ebaõnnestumist (aegunud token sai HTTP 200; õiguste allikas
lahknes); pärast parandust läbivad aegunud, kehtiva ja tühistatud sessiooni
kontrollid. Parandus ei lahenda S27-03 juba antud tokenite tühistamist.

### S27-05 — konteinerite ligipääs on ülesannetest laiem

**Kinnitatud tootmises ja compose'is:** backend ja pildiserver jooksevad
konteineris root'ina, ilma `no-new-privileges` seadeta. Need pole privileged
konteinerid; root konteineris ei tähenda automaatselt root'i hostis.
Backendile on loetavalt mountitud kogu hostikasutaja `.ssh` kaust.
Pildiserveril puudub state-mount (hea), kuid on kirjutatav kogu data-köide
ja keskkonnas Meilisearchi peavõti, mida piltide teenindamine ei vaja.

Mõju: backendi koodikäivituse korral suureneb SSH-võtmete kaudu edasiliikumise
võimalus; pildiserveri kompromiteerimise korral suureneb korpuse muutmise
ja otsinguandmete lugemise/muutmise võimalus. Read-only SSH-mount takistab
võtmete muutmist, mitte lugemist. Võtmete tegelikku õiguste ulatust ei uuritud.

**Parandus:** eraldi piiratud OCR-võti ja ainult vajalikud võtmefailid;
pildiserverilt Meili peavõti ära (enne kohandada config'i käivituskontroll);
eraldi pisipiltide kirjutusala, põhikorpus võimalusel read-only;
seejärel teenusekasutajad ning `cap_drop`/`no-new-privileges` koos
failiõiguste ja töövoogude kontrolliga.

### S27-06 — OCR-i SSH-ühendus ei kontrolli serveri hostivõtit

**Kinnitatud koodis:** `server/upload/ocr_client.py:get_or_create_ssh` teeb
`Transport.connect()` ilma hostkey argumendita ja seejärel `auth_publickey`.
Serveri võtme võrdlust usaldatud võtmega selles tees ei ole.

Mõju eeldab võrgus vahendamist või sihtaadressi ümbersuunamist: vale server
saab vastu võtta OCR-ile saadetavad failid ja tagastada võltsitud tulemused.
SSH privaatvõtit ei saadeta avaliku võtmega autentimisel serverile.

**Parandus:** pin'itud hostivõti või kontrollitud `known_hosts`; vale või
puuduva võtme korral keeldumine. Võtme usaldus tuleb kinnitada sõltumatu
kanali kaudu, mitte esimesest kontrollimata ühendusest automaatselt.

### S27-07 — hosti võrgupiirid vajavad administraatoriga täpsustamist

**Kinnitatud:** `sshd -T` näitab `passwordauthentication yes` ja
`permitrootlogin without-password`; UFW on mitteaktiivne. Kuulavad avalikel
liidestel 22, 25, 80, 443 ja 10050; rakenduspordid 3000/7700/8001/8002 on
127.0.0.1 peal. Loetud nftables'i väljavõttes olid Dockeri reeglid, kuid
see oli pikkuse tõttu osaline; kogu hosti INPUT-kaitse puudumist ei tõendatud.
Ülikooli välise tulemüüri reegleid ega SSH Match-plokkide tingimuslikku
mõju ei kontrollitud. Kuulamine ei tõenda internetist ligipääsetavust.

**Parandusettepanek:** kinnitada IT-ga lubatud lähtevõrgud SSH-le, SMTP-le ja
monitooringule. Võtmega ligipääsu ning varutee kontrollimise järel keelata
SSH parooliautentimine. UFW-d ei tohi pimesi sisse lülitada: arvestada
Dockerit, SMTP-releed ja monitooringut.

## Mis kontrolliti ja oli korras

- Tootmise VUTT backend/images kasutavad `VUTT_ENV=production`; Meili ja
  pildi-HMAC võtmed on seatud ega võrdu kontrollitud arendusvaikeväärtustega.
  See ei mõõda nende juhuslikkust ega tõenda, et need pole varem lekkinud.
- Tootmise nginx-vhost vastab serveri hoidla koopiale; päringupiirangute
  tsoonid on olemas ja `server_tokens off`. CSP keelab inline-skriptid.
- Kasutajate ja registreerimiste loendid nõuavad koodis admini; kasutajate
  vastusest jäetakse parooliräsid välja. Oma seadete tee kasutab sessiooni
  kasutajanime ja lubatud väljade loendit.
- Pildiserveril pole state-köidet ega SSH-kausta. Docker socket'i mount'i
  kontrollitud konteineritel ei olnud.
- Varasemad lehefailide ja piltide ligipääsu regressioonitestid läbivad.
- Frontendi toores HTML-renderdus on koondatud `SafeHtml` komponendile;
  eraldi uut frontendi XSS-testimist selles töös ei tehtud.

## Testid ja sõltuvused

- Kogu backend-testide värav: **3000 läbis, 2 deselected**, 135 sekundit.
  Testitud selle hetke ühises töökaustas, kus toimus ka teine arendustöö.
- Esimene turvakomplekt: **136 läbis** (security_fixes, auth_password,
  access_ops, restricted_work_endpoint_access, image_access_http,
  page_write_filename, session_invalidation, token_lugeja_uks_reegel).
- Paranduse ja seotud API komplekt: **108 läbis** (meili_refresh_security,
  backend_smoke, deps, access_ops, password_reset). Komplektid osaliselt
  kattuvad; neid ei tule liita unikaalsete testide arvuks.
- `npm audit --omit=dev --json`: 4 paketileidu (3 high, 1 moderate):
  `@humanfs/node`, `brace-expansion`, `flatted`, `js-yaml`.
  `npm explain` viis kõik ESLinti sõltuvusahelasse; Recharts toob sisse
  `eslint-plugin-react-perf`, mistõttu need ilmuvad ka omit=dev raportis.
  Need leiud ei tõenda brauseris või VUTTi Python-serveris kasutatavat
  ründeteed. Lukufaili hooldus on vajalik, kuid automaatset `audit fix`-i
  selle ülevaatuse käigus ei tehtud.
- Tootmise Pythoni paketiversioonid loeti ja vastavad vaadatud lukule;
  Pythoni, OS-i ja konteinerite täielik CVE-skann jäi tegemata.

## Järgmine konkreetne töö

1. Piira hosti `.env` ja `state/` õigused, kontrollides varunduse ligipääsu.
2. Vaheta Umami saladused koos olemasoleva andmebaasi parooliga ja eemalda
   tootmise vaikimisi väärtused; eralda analüütika võrk.
3. Deploy siin parandatud sessioonikontroll; seejärel lühenda otsingutokenite
   eluiga koos kliendi värskenduse testidega.
4. Piira SSH-mount ja pildiserveri õigused; lisa OCR hostivõtme kontroll.
5. Kinnita IT-ga välise tulemüüri ja SSH piirid; kontrolli varukoopia
   taastatavust ning lisa regulaarne sõltuvuste turvaskann.

Serveriseadistusi, saladusi ega tootmise rakendust selles ülevaatuses ei
muudetud. Tootmisparandused vajavad eraldi rakendamist ja järelkontrolli.
