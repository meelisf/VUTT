# Prosopograafia ühte asukohta — disainidokument

**Kuupäev:** 2026-08-08
**Issue:** #221
**Staatus:** kinnitatud, ootab plaani

## Probleem

Prosopograafia elab kolmes kohas korraga. Kaardid migreeriti 2026-05-25
`data/config/prosopography/` alla, aga migratsioonieelne asukoht jäi alles ja
kogus enda ümber kasutajaid. Seis serveris 2026-08-08:

| Koht | Sisu | Staatus |
|---|---|---|
| `data/config/prosopography/*.json` | 2355 kaarti | ELAV |
| `state/prosopography/*.json` | 2243 kaarti | külmunud 2026-05-25 |
| `state/prosopography/images/` | 21 pilti, 7,6 MB | **ELAV** |
| `data/prosopography/*.json` | 2243 kaarti | külmunud 2026-05-25, `data/` gitis |
| `data/prosopography/images/` | 21 pilti, 7,6 MB | **elav peegeldus** kuni 2026-08-04, jälgimata |

Kolmas koopia leiti selle disaini kirjutamisel. `backup_prosopography.sh`
`rsync -a --delete` peegeldas ka pilte, kuni cron 2026-08-04 eemaldati; git jättis
need vahele (`data/.gitignore` → `*.jpg`), nii et skript logis „muudatusi pole",
kuigi kopeeris pilte edasi. Kontrollitud: `md5sum` kõigil 21 failil identne elava
komplektiga, uusim fail 2026-07-31. See on ka põhjus, miks `data/prosopography/`
sisaldab 2244 kirjet 2243 kaardi juures — 2244s on `images/` alamkataloog.

Kaks tagajärge, mõlemad juba realiseerunud:

1. **Seitse skripti kirjutab surnud kataloogi.** `mass_enrich_prosopography.py` ja
   `cleanup_place_duplicates.py` teevad `json.dump` otse `state/prosopography/`-sse;
   viis ülejäänut loevad sealt. Käivitamine muudaks 2243 surnud kaarti, elavad 2355
   jääksid puutumata — muudatus näiks õnnestuvat, aga ei jõuaks kunagi rakendusse.
2. **„Surnud" kataloog sisaldab elavat vara.** `state/prosopography/images/` on
   iga isikukaardi `image_url` allikas. Ilmne koristus (`rm -rf state/prosopography`)
   teeks kõik isikupildid 404-ks.

Duplikaadi hind ei ole ketas, vaid see, et iga tee näeb töökorras välja.

## Otsus

Kogu prosopograafia elab `data/config/prosopography/` all. Teised asukohad
kaovad — mitte ei märgita aegunuks.

```
data/config/prosopography/
├── {nanoid}.json          elavad kaardid (gitis, save_with_git)
└── images/{id}.jpg        pildid — UUS asukoht (jälgimata, nagu skaneeringud)
```

### Invariant

**Ükski prosopograafia runtime- ega hoolduskood ei tohi lugeda ega kirjutada
`state/prosopography` või `data/prosopography` kaudu.** Lõppseisus on üks juur,
mitte üks ametlik ja kaks aegunud asukohta.

Konfiguratsioon väljendab seda ise. `PROSOPOGRAPHY_DIR` on juba olemas
(`server/config.py:106`), aga pildikonstant ehitas tee `_STATE_DIR`-ist:

```python
# ENNE
PROSOPOGRAPHY_DIR = os.path.join(_DATA_CONFIG_DIR, "prosopography")
PROSOPOGRAPHY_IMAGES_DIR = os.path.join(_STATE_DIR, "prosopography", "images")

# PÄRAST — üks juur, selle all varatüübid
PROSOPOGRAPHY_DIR = os.path.join(_DATA_CONFIG_DIR, "prosopography")
PROSOPOGRAPHY_IMAGES_DIR = os.path.join(PROSOPOGRAPHY_DIR, "images")
```

Tee ei tohi tuletada `DATA_CONFIG_DIR`-ist literaali `"prosopography"` korrates —
kaks sõltumatut liitmist on täpselt see lahknemisviis, mille pärast see töö käib.

### Miks pildid `data/` alla, kuigi need pole gitis

`data/.gitignore:3` (`*.jpg`) katab ka `config/prosopography/images/`, seega pildid
jäävad **jälgimata failideks jälgitava puu sees** — nagu lehe-skaneeringud
`data/{teos}/`-s. Olemasolev muster, mitte uus erand.

**Deploy neid ei hävita.** `scripts/server_update.sh` ainus git-käsk on `git pull`
(rida 16) — ei `git clean`, ei checkout'i asendust, ei `rsync --delete` `data/`
vastu. Empiiriline tõend samast puust: `data/prosopography/images/` 21 jälgimata
pilti on üle elanud kõik deploy'd alates maist.

Varundust muudatus ei mõjuta: `vutt_backup.py` rsync'ib `data/` ja `state/`
tervikuna, git'ist sõltumata. Kõrvalkasu: `server_update.sh` samm 5 chown'ib
`data/` kausta, mis parandab piltide praeguse `root`/`meelisf` segaomandi.

Alternatiiv (pildid jäävad `state/`-i, sest on runtime-sisu) lükati tagasi: see
säilitaks kaks asukohta, mis on kogu selle töö põhjus.

## Muudatused

### Kood

`server/config.py` — pildikonstant tuletatakse `PROSOPOGRAPHY_DIR`-ist (ülal).
Rea 104 kommentaar („pildid — state-is") uueneb koos sellega.

Muud serverikoodi muutma ei pea: `person_crud.py` (üleslaadimine, serveerimine,
kustutamine) käib konstandi kaudu `state.py` re-ekspordist. `image_url` on
API-marsruut (`/api/files/prosopography/{id}/image`), mitte salvestatud failitee —
ükski kaardi-JSON ei muutu ja URL-e migreerima ei pea.

### Skriptid

Kustutada (kulunud ühekordsed, sisu jääb git-ajalukku):
`import_aa_persons.py`, `enrich_aa_persons.py`, `fix_aa_person_names.py`,
`import_persons_from_aliases.py`, `bulk_fill_gender_status.py`.

Suunata `PROSOPOGRAPHY_DIR` peale (jätkuv väärtus): `mass_enrich_prosopography.py`,
`cleanup_place_duplicates.py`. Import käib fake-package mustriga, nagu teistes
standalone-skriptides.

### Dokumentatsioon

- `CLAUDE.md` — `state/` rida (`prosopography/images/` kaob loetelust)
- `docs/vutt-backup.md` — 2026-08-08 lisatud HOIATUS asendub uue paigutuse
  kirjeldusega; oht, mille eest see hoiatab, lakkab olemast
- issue #221 sulgub

## Teostus kahes plokis

Repo-muudatus ja tootmisandmete migratsioon hoitakse lahus — see teeb rollback'i
mõtlemise lihtsaks ja hoiab hooldusakna lühikesena.

### Plokk A — repo

1. `server/config.py` pildikonstant
2. Viie kulunud skripti kustutamine, kahe ümbersuunamine
3. Testid (allpool)
4. Dokumentatsioon
5. `data/prosopography/` jälgitava koopia kustutamine `data/` repos — commit
   **AINULT sellele teele**. `data/` repos on sõltumatut committimata muutust
   (`labels.json`, `person_aliases.json`, `person_to_works.json`), mis EI TOHI
   kaasa minna.

### Plokk B — tootmisandmed

1. **Kontrolli külmunud koopiaid teadaoleva ajaloolise seisu vastu.** Ei piisa
   sellest, et `state/prosopography/*.json` ja `data/prosopography/*.json` on
   omavahel identsed — küsimus on, kas pärast 2026-05-25 on tekkinud muudatus,
   mida ei tohi maha visata. Mõlemad peavad vastama commitile `3ea574c9b`
   („Prosopograafia backup 2026-05-25, 2243 kaarti"). **Lahknevuse korral peatu
   ja vaata erinevused üle enne kustutamist.**
2. Seiska backend
3. `mv state/prosopography/images data/config/prosopography/images`
4. Kontrolli: 21 faili kohal, `md5sum` vastab, õigused korras
5. Deploy (`server_update.sh --no-cache`) ja restart
6. **Suitsutest:** ava isikukaart, millel on pilt; kontrolli, et pilt laeb
7. Alles siis `rm -rf state/prosopography`

Vana kataloogi ajutine olemasolu hooldusakna jooksul ei riku disaini — oluline on,
et lõppseisus seda pole ja rakendus ei oska sinna osutada. Enne sammu 7 on
rollback puhas failide tagasi-nihutamine.

Taastatavus: JSON-koopiate sisu on `data/`-repo commitis `3ea574c9b`, mille
kustutamine on omaette commit; pilte katab lisaks loss-serveri öine snapshot.

## Testid ja vastuvõtukriteeriumid

Olemasolevad `test_prosopography_git.py`, `test_prosopography_side_writes.py` ja
`test_security_fixes.py` puudutavad pildi-teid ja patchivad baaskataloogi, seega
järgivad konstanti.

**Uus valvur:** test, mis kinnitab, et `PROSOPOGRAPHY_IMAGES_DIR` laheneb
`PROSOPOGRAPHY_DIR` alla ja et `PROSOPOGRAPHY_DIR` on `DATA_CONFIG_DIR` all.

Vastuvõtukriteeriumid:

1. Repo-ülene otsing `state/prosopography`, `data/prosopography` ja
   `PROSOPOGRAPHY_IMAGES_DIR` järele annab **null runtime-koodi tabamust**.
   Lubatud on ainult migratsiooni ja ajalugu kirjeldav dokumentatsioon
   (`docs/vutt-backup.md`, see spekk, `docs/_archive/`).
2. `PROSOPOGRAPHY_IMAGES_DIR` on `PROSOPOGRAPHY_DIR` all (kaetud testiga).
3. Serveris eksisteerib täpselt üks prosopograafia juur; `state/prosopography`
   ja `data/prosopography` puuduvad.
4. Isikukaardi pilt laeb pärast migratsiooni.

Kriteerium 1 on selle issue tegelik mõõt: algne probleem ei tulnud
pildikonstandist, vaid seitsmest skriptist, mis osutasid vanale JSON-asukohale.
Kitsas konstandi-test üksi kataks pool probleemist.

## Riskid

| Risk | Leevendus |
|---|---|
| Pildid kaovad teisaldamisel | Plokk B samm 1 ja 4 kontrollid; kataloogi `mv` on samas failisüsteemis aatomiline `rename`, kuigi migratsioon tervikuna ei ole — backend on seisatud |
| Külmunud koopias on hilisem muudatus | Plokk B samm 1 võrdleb commitiga `3ea574c9b`, mitte ainult koopiaid omavahel; lahknevus peatab töö |
| `data/` repo commit haarab kaasa võõrast muudatust | Plokk A samm 5: commit ainult `prosopography/` teele |
| Deploy kustutab jälgimata pildid | `server_update.sh` teeb ainult `git pull`; tõendatud olemasolevate jälgimata piltidega samas puus |
| Docker kirjutab pilte root'ina | `server_update.sh` samm 5 chown'ib `data/` — nüüd katab ka pildid |
| Mõni AA-skript osutub veel vajalikuks | Sisu on git-ajaloos; taastamine on `git show` |
