# Fable laiema plaani ülevaade — mis on kahe silma vahele jäänud

**Kuupäev:** 2026-07-05
**Mudel:** Claude Fable 5
**Skoop:** MITTE koodileiud (need on `2026-07-02-fable-*.md` + issued #111–#120 kaetud),
vaid struktuursed/strateegilised augud, mida koodi-review'd oma olemuselt ei näe.

**Seisu kontroll enne analüüsi:**
- Fable'i blindspot-leidudest suletud: B1 (#111), B2 (#112), B6/S1 (#113), B7 (#117), B13 (#120).
- Lahtised P2-d: B3 (#114), B4 (#115), B5 (#116), B8 (#118), B9 (#119) — kõik sama juure
  (failipõhine job-state) sümptomid, vt punkt 4.
- Kraapimine: robots.txt AI-opt-outidega olemas, monitooringuplaan (`monitoring-bot-traffic.md`)
  olemas, AGA #61 (nginx rate-limit /meili/ ja /api/images/ live rollout) on P0 ja LAHTISED.

---

## 1. Varundus — suurim struktuurne risk, ja praegune kate on osalisem kui paistab

Praegu (dokumentide järgi; serveris verifitseerimata):
- `data/` git → öine push privaatsesse GitHub reposse (`git-backup-setup.md`) — aga
  **ainult .txt + .json** (~47 MB), gitignore jätab jpg/png välja.
- `state/` **ei ole üldse varundatud**: `users.json` (kontod), sessioonid, `user_settings/`,
  `prosopography/images/` (isikute pildid).
- `backup_prosopography.sh` kopeerib `state/prosopography → data/prosopography` — tõenäoliselt
  AEGUNUD, sest prosopograafia JSON-id migreeriti 2026-05-25 `data/config/prosopography/`-sse
  (git-versioonihaldusega). Kontrolli, kas skript teeb veel midagi kasulikku (pildid?).

**Mis kaob serveri kettarikkes:**
1. Kõik skaneeringud (jpg) — sh **pildiredaktoriga tehtud käsitöö** (kärped, pöörded,
   poolitused). Originaal-PDF-idest taastamine = nädalate töö, redigeerimiskäsitöö = jäädavalt.
2. Kõik kasutajakontod (uus registreerimine kõigile).
3. Isikukaartide pildid.

**Soovitus:** ära oota IT-d ("ootab IT-d" on High-TODO olnud kuid). `restic`/`borgbackup` +
suvaline off-site sihtkoht (ülikooli võrguketas, S3, kasvõi kodune masin) on paari tunni
seadistus ja katab data/ TERVIKUNA (koos piltidega) + state/ (krüpteeritult — users.json
hashid ei tohi GitHubi minna). Alternatiiv miinimumprogramm: (a) `state/` öine krüpteeritud
tar off-site, (b) piltide ühekordne + inkrementaalne rsync teise masinasse.

### Otsustatud lähenemine (2026-07-05, kasutajaga arutatud)

OCR-serveris on juba olemas treeningandmete rsync-skript (`scripts/vutt_sync.py` seal repos),
mis tõmbab `~/VUTT/data/` sisu (jpg+txt+json). See võetakse backup'i vundamendiks, AGA
eraldi skriptina (`vutt_backup.py`), mitte treening-skripti laiendusena:

1. **Täisskoop:** `data/` TERVIKUNA (ilma treening-excludeta nagu `prosopography/`) +
   `~/VUTT/state/` (users.json, user_settings, isikupildid; sihtkataloog `chmod 700` —
   sisaldab hashe/tokeneid). Include ka `*.png`/`*.tif`, mitte ainult jpg.
2. **Snapshotid, mitte pelk peegel:** rsync `--link-dest` kuupäevastatud kataloogidega
   (hardlink-snapshotid) VÕI restic/borg peegli peal. ILMA snapshotideta kirjutab rikutud
   allikas ainsa koopia üle. Backup-profiilis mitte kasutada `--delete`-t ilma snapshotideta.
3. **Cron + veamärguanne:** vaikselt katki backup on halvem kui puuduv (`logger -t vutt-backup`
   miinimum, healthchecks.io-ping parem).
4. Teadlik piirang: OCR-server võib olla samas serveriruumis → ei kata maja-tasandi õnnetust;
   koos GitHubi txt+json pushiga on kate siiski mõistlik (tekst päris off-site, pildid teises
   masinas).

## 2. Andmete pikaealisus ja akadeemiline kestlikkus (ükski review seda ei vaata)

- **Eksport standardformaati puudub.** Andmemudel on bespoke JSON. Transkriptsioonidel pole
  TEI-eksporti, prosopograafial pole isegi dokumenteeritud CSV/JSON-dumpi. Kui server/projekt
  sureb, on andmed raskesti taaskasutatavad; kui elab, küsivad kolleegid varem või hiljem
  "kuidas ma selle korpuse kätte saan". Mitte tingimata täis-TEI — ka lihtne dokumenteeritud
  dump-formaat + konverter oleks suur samm.
- **Tsiteeritavus.** Püsi-URLid (nanoid) on olemas, aga pole versioneeritud viitamist.
  **Perioodiline Zenodo-deposit** (nt kord semestris: tekstid+metaandmed+prosopograafia dump)
  annaks korraga kolm asja: DOI/tsiteeritavus, off-site varundus, akadeemiline nähtavus.
  Odavaim suure mõjuga samm siin nimekirjas.
- **Sisu litsents on määramata.** MIT katab KOODI. Transkriptsioonide ja prosopograafia
  ANDMETE litsentsi (CC BY? CC0 andmetele?) pole kuskil deklareeritud. See on ka
  AI-kraapimise poliitika teine pool: praegu on olemas keeld (robots.txt), aga puudub
  positiivne avaldus, mis kasutus ON lubatud. Ja kaastööliste panuse küsimus: kes omab
  contributor'i tehtud transkriptsiooniparandusi? Üks lõik "Andmete kasutamine" lehel +
  rida registreerimisvormis lahendaks.

## 3. Operatsiooniline nähtavus — daemon-thread arhitektuuri pime nurk

Süsteem sõltub ~6+ in-process daemon-threadist (Meili keep-warm, reocr poll/batch-poll/cleanup,
upload-sync, sessiooni/rate-limit puhastus, metadata watcher). Kui mõni sureb erindiga,
**ei märka keegi** — sümptom ilmneb päevi hiljem ("OCR ei edene", "otsing külm").

- #88 (taustatööde health/status endpoint) on P2 — **tõstaks P1-ks**. Iga loop registreerigu
  "last heartbeat" timestamp'i; `/health` raporteerib; Zabbix (kui sügisel tuleb) saab seda
  pollida, seni kasvõi käsitsi vaadatav.
- **Error-aggregatsioon puudub** (nii backend kui frontend). Ühe-hooldaja projektis on
  Sentry (või self-hosted GlitchTip) suurim aja-kokkuhoid: frontendi vead, mida kasutajad
  kunagi ei raporteeri, muutuvad nähtavaks. Praegu on ainus signaal "kasutaja kirjutab meili".

## 4. OCR-integratsiooni arhitektuur — paranda juurt, mitte lehti

Viimase kuu bugivoog (orbude taaste, reaper, batch-mapping, revive, #114–#119 lahtised
race/atomicity-leiud) tuleneb ÜHEST disainiotsusest: **SFTP + failipõhine polling +
in-memory job-state kolmes eri JSON-failis**. Iga parandus on lisanud kihi
(reocr_state → recovery → reaper → batch-mapping → revive), ja Fable'i review leidis
just nende kihtide VAHELT uued augud.

Kaks taset, kumbki lahendaks lahtised P2-d hulgi:
- **Miinimum:** job-state (reocr jobs + batch mapping + reocr_log + upload state) ühte
  **SQLite** faili. Atomaarsus, lukud ja crash-safety tasuta; #114/#115/#116 kaovad
  klassina, mitte ükshaaval.
- **Parem:** kui OCR-serveri poolele saab lisada minimaalse HTTP API (job → staatus,
  valmis-failide loend), kaob polling-failisüsteemi-arheoloogia üldse. Küsimus pole
  "kas suudame SFTP-mustrit veel lappida" (suudame), vaid kas tasub.

## 5. CI on endiselt püsti panemata — protsessi-, mitte koodiauk

#64 (CI quality gate: pytest/typecheck/vitest/build) on **P0 ja lahtine alates 28.06**.
Testibaas on korralik (183+ testi), aga miski ei jookse neid automaatselt — kogu kvaliteedivärav
on "Claude jooksutas lokaalselt". See on täpselt see kategooria, mida koodi-review ei näe:
kood on OK, protsess mitte. GitHub Actions workflow on ~1h töö ja kaitseb ka selle vastu,
et AI-assisteeritud kiired PR-id (praegune töövoog!) regressiooni sisse ei vea.

## 6. Kraapimine — seis on OK, kaks lünka

- Robots.txt (treening-botid blokitud, AI-otsing lubatud — teadlik ja mõistlik poliitika) ✅,
  monitooringuplaan ✅. AGA:
- **#61 (nginx rate-limit /meili/ ja /api/images/) on P0 ja rakendamata.** Robots.txt on
  viisakuspalve; rate-limit on tegelik kaitse. Eriti `/meili/` — avalik search-key lubab
  suvalisi päringuid ja kraapija saab kogu korpuse otsingu-API kaudu kätte palju odavamalt
  kui HTML-ist. See on selle teema ainus päriselt tegemata töö.
- **Parim kraapimisvastane relv on ametlik dump** (vt punkt 2, Zenodo): kui andmed on
  legaalselt ja mugavalt allalaetavad koos litsentsi ja viitamisjuhisega, kaob motivatsioon
  saiti kraapida — ja need, kes ikka kraabivad, poleks nagunii küsinud.

## 7. Väiksemad struktuursed tähelepanekud

- **Teadmus elab hajusalt** (Claude'i mälu, MEMORY.md, docs/ eri failid). Kriitilised
  invariandid (auth-race gate, marginalia reeglid, meili degradation) on dokumenteeritud,
  aga inimesele, kes pole "see Claude", raskesti leitavad. Kui projekt peaks kunagi üle
  minema (või tööriist vahetub), oleks lühike ADR-stiilis otsuste logi (docs/decisions/)
  väärtuslik. Madal prioriteet, aga bus-factor = 1 projektis mainimist väärt.
- B14 (Meili tenant-token TTL 3600s vs sessioon 24h) jäi triaažis vahele — pole issue't.
  Self-heal katab enamiku, aga struktuurne fragiilsus on alles.
- `tegemata_tood.md` lõpus on triaažimata UX-küsimus (isik ilma seosteta + kollektsioonifilter
  + päritolukoha kaart) — väärib issue't, et mitte kaduma minna.

## Soovitatud järjekord (laiema plaani tööd)

1. **Varundus tervikuna** (pildid + state/, off-site) — ainus pöördumatu-kao risk. (p 1)
2. **#61 rate-limit live** + **#64 CI** — mõlemad P0, mõlemad väikesed, mõlemad seisavad. (p 5, 6)
3. **#88 health/heartbeat P1-ks** + kaalu Sentry't. (p 3)
4. **Zenodo dump + andmelitsentsi avaldus** — odav, suur akadeemiline väärtus. (p 2)
5. **Job-state SQLite'i** — sulgeb #114–#119 klassina, kui nende juurde asud. (p 4)
