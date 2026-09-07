# ADR 0034 — Kirjad hosti postfixi kaudu; saatmisviga ei kaota linki

**Kuupäev:** 2026-09-07
**Staatus:** vastu võetud
**Seotud:** ADR 0033 (serveripoolne kasutajale nähtav tekst), ADR 0021 (env-nimed),
ADR 0002 (blokeeriv I/O)
**Issue:** #298

## Kontekst

VUTT ei saatnud ühtki kirja. Kutselink ja parooli-taastamise link tekkisid
admini ekraanile ja admin toimetas need kasutajani käsitsi. #298 kaardistas
kolm võimalikku kanalit (ülikooli oma relee / M365 inbound connector / väline
teenus) ja jäi ootama ülikooli IT vastust.

Vastus (2026-09-07) tegi valiku triviaalseks: **serveris juba jookseb postfix
`relayhost = mailhost.ut.ee` seadega** ja see toimetab kirju ka väljapoole
`ut.ee`-d (IT testis `gmail.com` aadressiga). Kaks järeldust:

- Whitelist'i vaja ei ole — kiri lahkub `mailhost.ut.ee`-st, mis on
  `_smtp.ut.ee` sees, seega SPF läbib ja DMARC (`p=quarantine`) joondub,
  kui `From:` on `@ut.ee`. Relee lubabki ainult seda domeeni.
- M365 OAuth2-voogu ega välist teenust ei ole vaja. Ainus koodiks jääv osa on
  SMTP-klient localhost-kaugusel olevale releele.

Üks tegelik takistus oli mõõtmisel: backend jookseb Dockeris, postfix hostis.
Postfix kuulas küll kõigil liidestel, aga `mynetworks` oli ainult loopback —
konteinerist saadetud kiri oleks saanud `554 Relay access denied`. IT lisas
`192.168.201.0/24` (2026-09-07); kontroll konteinerist andis `MAIL FROM` +
`RCPT TO` välisele aadressile `250 Ok` (`DATA` saatmata).

## Otsus

**1. Kanal on hosti postfix, mitte otseühendus releega.** Konteiner saadab
`smtp-relay:25`-le (`extra_hosts: host-gateway`), postfix releeb edasi.
Otse `mailhost.ut.ee`-le saatmine töötaks samuti (NAT-i taga on sama IP), aga
kaotaks järjekorra ja kordused: releed puudutav tõrge jääks meie probleemiks
päringu ajal, mitte postfixi järjekorda.

**2. Docker-võrgu alamvõrk on FIKSEERITUD** (`192.168.201.0/24`
`docker-compose.yml`-is), sest sama vahemik on hosti `mynetworks`-is. Dockeri
poolist võetud aadress võib võrgu taasloomisel vahetuda ja siis lakkaks
saatmine töötamast ilma ühegi muudatuseta kummalgi pool.

**3. Autentimist ei ole ja saladusi ei ole.** Relee usaldab IP-d. `SMTP_HOST`,
`SMTP_PORT`, `SMTP_TIMEOUT`, `MAIL_FROM`, `MAIL_FROM_NAME` on tavalised
seaded ADR 0021 nimelepingu järgi; vaikeväärtus elab ainult `config.py`-s.

**4. Tühi `SMTP_HOST` või `MAIL_FROM` = saatmine välja lülitatud.** See on
kehtiv seisund (arendus, testid, esimene deploy enne aliase valmimist), mitte
viga. Vaikeväärtust „localhost" ei ole: see prooviks arenduses igal kutsel
ühendust ja peidaks tootmises seadistamata hosti vea müra sisse.

**5. `send_mail` ei viska kunagi** (`server/mailer.py`) — tagastab
`(ok, viga)`. Kutse- ja taastelink on saatmise hetkeks juba loodud ja kettal;
erind muudaks juba tehtud töö kutsuja jaoks veaks. Sama loogika, mis ADR 0033
täienduses malli renderduse kohta, laieneb nüüd saatmisele.

**6. Käsitsi-varutee jääb alles.** Mall renderdatakse ka õnnestunud saatmise
korral ja vastus kannab endiselt `mail_subject` / `mail_body` ning kopeeritavat
linki. Admini ekraan ütleb, kumb juhtus (`mail_sent`, `mail_error`).

**7. Saatja on `vutt-abi@ut.ee`, mis suunab elavasse postkasti.** Suunamiseta
`no-reply` neelaks bounce'id — täpselt selle vea, mille nähtavaks tegemine oli
#298 teine eesmärk. `Auto-Submitted: auto-generated` (RFC 3834) väldib
automaatvastuste ahelat.

## Tagajärjed

- Uus kirjatüüp = uus mallipaar `server/email_templates/{nimi}.{et,en}.txt` +
  `_render_and_send` kutse. Kutsuja EI kirjuta oma saatmis- ega veakäsitlust.
- Saaja aadress logis on maskitud (`m***@ut.ee`) — domeen jääb, sest vea
  otsimisel loeb just see.
- Tootmise `.env` vajab `SMTP_HOST=smtp-relay` ja `MAIL_FROM=vutt-abi@ut.ee`.
  Ilma nendeta käitub server täpselt nagu enne — link ekraanile, kirja ei tule.
- Iseteeninduslik „unustasin parooli" (#298 järgmine samm) on nüüd võimalik,
  aga EI ole selle otsusega tehtud: see endpoint peab vastama identselt
  olenemata konto olemasolust ja vajab oma rate-limiti.

## Alternatiivid

**Otse `mailhost.ut.ee`-le konteinerist.** Vähem liikuvaid osi (ei `mynetworks`,
ei fikseeritud alamvõrku), aga ilma järjekorrata: relee hooldusaken tähendaks
kaotatud kirja, mitte hilinenud kirja.

**Väline teenus (Postmark/Brevo/SES).** Annaks delivery/bounce webhookid ja
statistika. Kümne kirja juures kuus on see hind ja sõltuvus millegi eest, mille
ülikool juba tasuta pakub; DMARC-i jaoks oleks vaja alamdomeenile omad kirjed.

**Kirjade saatmine taustalõimes.** Postfix võtab kirja järjekorda kohe
(millisekundid), seega ei ole HTTP-päringu taga midagi oodata; taustalõim
peidaks vea admini eest, kes on ainus, kes selle peale reageerida saab.
