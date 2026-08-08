# Prosopograafia ühte asukohta — disainidokument

**Kuupäev:** 2026-08-08
**Issue:** #221
**Staatus:** kinnitatud, ootab plaani

## Probleem

Prosopograafia elab kahes kohas korraga. Kaardid migreeriti 2026-05-25
`data/config/prosopography/` alla, aga migratsioonieelne asukoht jäi alles ja
kogus enda ümber kasutajaid. Seis serveris 2026-08-08:

| Koht | Sisu | Staatus |
|---|---|---|
| `data/config/prosopography/*.json` | 2355 kaarti | ELAV |
| `state/prosopography/*.json` | 2243 kaarti | külmunud 2026-05-25 |
| `state/prosopography/images/` | 21 pilti, 7,6 MB | **ELAV** |
| `data/prosopography/` | 2244 faili, 17 MB | surnud koopia, `data/` gitis |

Kaks tagajärge, mõlemad juba realiseerunud:

1. **Seitse skripti kirjutab surnud kataloogi.** `mass_enrich_prosopography.py` ja
   `cleanup_place_duplicates.py` teevad `json.dump` otse `state/prosopography/`-sse;
   viis ülejäänut loevad sealt. Käivitamine muudaks 2243 surnud kaarti, elavad 2355
   jääksid puutumata — muudatus näiks õnnestuvat, aga ei jõuaks kunagi rakendusse.
2. **„Surnud" kataloog sisaldab elavat vara.** `state/prosopography/images/` on
   iga isikukaardi `image_url` allikas. Ilmne koristus (`rm -rf state/prosopography`)
   teeks kõik isikupildid 404-ks. See on praegu ainult hoiatuskommentaar
   `docs/vutt-backup.md`-s — nõrgem kaitse kui olematu kataloog.

Duplikaadi hind ei ole ketas, vaid see, et iga tee näeb töökorras välja.

## Otsus

Kogu prosopograafia elab `data/config/prosopography/` all. Teised asukohad
kaovad — mitte ei märgita aegunuks.

```
data/config/prosopography/{nanoid}.json     elavad kaardid (gitis, save_with_git)
data/config/prosopography/images/{id}.jpg   pildid — UUS asukoht
state/prosopography/                        KAOB
data/prosopography/                         KAOB
```

### Miks pildid `data/` alla, kuigi need pole gitis

`data/.gitignore:3` (`*.jpg`) katab ka `config/prosopography/images/`, seega pildid
jäävad **jälgimata failideks jälgitava puu sees** — täpselt nagu lehe-skaneeringud
`data/{teos}/`-s. See on juba olemasolev muster, mitte uus erand.

Varundust see ei muuda: `vutt_backup.py` rsync'ib `data/` ja `state/` tervikuna,
git'ist sõltumata. Kõrvalkasu: `server_update.sh` samm 5 chown'ib `data/` kausta,
mis parandab ühtlasi piltide praeguse `root`/`meelisf` segaomandi.

Alternatiiv (pildid jäävad `state/`-i, sest on runtime-sisu) lükati tagasi: see
säilitaks kaks asukohta, mis on kogu selle töö põhjus.

## Muudatused

### Kood

Sisuline muudatus on üks rida — kõik tarbijad käivad juba konstandi kaudu:

```python
# server/config.py
PROSOPOGRAPHY_IMAGES_DIR = os.path.join(DATA_CONFIG_DIR, "prosopography", "images")
```

`person_crud.py` (üleslaadimine, serveerimine, kustutamine) kasutab seda
`state.py` re-ekspordi kaudu. `image_url` on API-marsruut
(`/api/files/prosopography/{id}/image`), mitte salvestatud failitee — ükski
kaardi-JSON ei muutu ja URL-e migreerima ei pea.

### Skriptid

Kustutada (kulunud ühekordsed, sisu jääb git-ajalukku):
`import_aa_persons.py`, `enrich_aa_persons.py`, `fix_aa_person_names.py`,
`import_persons_from_aliases.py`, `bulk_fill_gender_status.py`.

Suunata `DATA_CONFIG_DIR` peale (jätkuv väärtus): `mass_enrich_prosopography.py`,
`cleanup_place_duplicates.py`. Import käib fake-package mustriga, nagu teistes
standalone-skriptides.

### Dokumentatsioon

- `CLAUDE.md` — `state/` rida (`prosopography/images/` kaob loetelust)
- `docs/vutt-backup.md` — 2026-08-08 lisatud HOIATUS asendub uue paigutuse
  kirjeldusega; oht, mille eest see hoiatab, lakkab olemast
- issue #221 sulgub

## Migratsioon serveris

Lihtne teisaldamine seisatud backendiga. Config-fallback („loe uut, kukku tagasi
vanale") ja symlink lükati tagasi: mõlemad jätavad alles legacy-haru, mis on
sama duplikaat teises vormis. 21 faili ja 7,6 MB ei vaja nullseisakuga skeemi.

Järjekord:

1. Kontrolli, et kaks külmunud koopiat on baithaaval identsed
   (`state/prosopography/*.json` vs `data/prosopography/`)
2. Seiska backend
3. `mv state/prosopography/images data/config/prosopography/images`
4. Kontrolli: 21 faili kohal, õigused korras
5. `rm -rf state/prosopography`
6. Kustuta `data/prosopography/` — commit **AINULT sellele teele**; `data/` repos on
   sõltumatut committimata muutust (`labels.json`, `person_aliases.json`,
   `person_to_works.json`), mis EI TOHI kaasa minna
7. Deploy (`server_update.sh --no-cache`) ja restart
8. Ava isikukaart, millel on pilt

Taastatavus: mõlema külmunud koopia sisu vastab `data/`-repo commitile `3ea574c9b`
(„Prosopograafia backup 2026-05-25, 2243 kaarti"); kustutamine on omaette commit,
seega ajalugu jääb alles. Lisaks katab loss-serveri öine snapshot.

## Testid

Olemasolevad `test_prosopography_git.py`, `test_prosopography_side_writes.py` ja
`test_security_fixes.py` puudutavad pildi-teid ja patchivad baaskataloogi, seega
järgivad konstanti.

Uus valvur: test, mis kinnitab, et `PROSOPOGRAPHY_IMAGES_DIR` laheneb
`DATA_CONFIG_DIR` alla. See on regressioon, mis lahutaks asukohad vaikselt
uuesti — täpselt see, mille pärast see töö tehakse.

## Riskid

| Risk | Leevendus |
|---|---|
| Pildid kaovad teisaldamisel | Samm 1 kontroll + loss-snapshot; `mv` samas failisüsteemis on aatomiline |
| `data/` repo commit haarab kaasa võõrast muudatust | Samm 6: commit ainult `prosopography/` teele |
| Docker kirjutab pilte root'ina | `server_update.sh` samm 5 chown'ib `data/` — nüüd katab ka pildid |
| Mõni AA-skript osutub veel vajalikuks | Sisu on git-ajaloos; taastamine on `git show` |
