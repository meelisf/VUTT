# VUTT tervikbackup (`data/` + `state/`)

Skript: `scripts/vutt_backup.py`

Eesmärk: varundada VUTT **tervikuna** teisele masinale snapshot'idena:

- `~/VUTT/data/` täielikult, sh pildid (`jpg/png/tif`) ja `data/config/`
- `~/VUTT/state/`, sh `users.json`, sessioonid, `user_settings/`, isikupildid

`state/` sisaldab paroole/tokeneid/hash'e, seega peab backup-sihtkataloog olema privaatne
(`chmod 700`) ja seda ei tohi GitHubi ega avalikku pilve krüpteerimata panna.

## Päris seadistus (loss, alates 2026-08-04)

Backup **tõmmatakse**, mitte ei lükata: sihtmasin `loss` (füüsiliselt teine masin, ülikooli
võrgus) võtab VUTT serverist. Nii ei ole VUTT serveril kirjutusõigust backupidesse — kui
VUTT kompromiteeritakse, ei saa ründaja koopiaid kustutada.

| | |
|---|---|
| Sihtmasin | `loss` (`ssh loss`) |
| Skript sihtmasinas | `/home/mf/bin/vutt_backup.py` (koopia siit repost) |
| Snapshot'id | `/home/mf/vutt-backups/snapshots/`, `latest` symlink |
| SSH-alias | `vutt-backup` → `meelisf@193.40.22.30`, võti `~/.ssh/vutt_backup` |
| Cron | `15 3 * * *`, `--keep-days 365`, `logger -t vutt-backup` |
| Maht | 39 GB / snapshot, hardlinkidega ~55 GB/aasta (eelarve 200 GB) |

```bash
# käsitsi jooksutamine loss-is
~/bin/vutt_backup.py --source-host vutt-backup --source-root . --dest-root ~/vutt-backups
```

**`--source-root .` on KOHUSTUSLIK.** VUTT serveri `authorized_keys` piirab võtme
`command="rrsync -ro /home/meelisf/VUTT",restrict` abil ainult lugevale rsyncile.
`rrsync` juurib tee ise, seega absoluutne tee (`~/VUTT`) annab `Not allowed`.
Sama põhjusel ei saa selle võtmega jooksutada `ssh vutt-backup <mis-tahes-käsk>` —
see on tahtlik.

VUTT serveri `~/.ssh/authorized_keys` rida:

```text
command="rrsync -ro /home/meelisf/VUTT",restrict ssh-ed25519 AAAA... vutt-backup
```

Võti PEAB olema **paroolita**. Tavavõti `id_ed25519` on parooliga ja töötab ainult
interaktiivselt agendiga — cronis vaikselt ei tööta.

### Üldkuju

Vaikimisi loetakse allikas `vutt:~/VUTT/{data,state}`. Vajadusel:

```bash
./scripts/vutt_backup.py \
  --source-host vutt \
  --source-root ~/VUTT \
  --dest-root /srv/backups/vutt \
  --ssh-command "ssh -i ~/.ssh/vutt_backup"
```

Samu väärtusi saab anda env muutujatega:

```bash
VUTT_BACKUP_SOURCE_HOST=vutt
VUTT_BACKUP_SOURCE_ROOT=~/VUTT
VUTT_BACKUP_DEST_ROOT=/srv/backups/vutt
VUTT_BACKUP_SSH_COMMAND="ssh -i ~/.ssh/vutt_backup"
VUTT_BACKUP_HEALTHCHECK_URL=https://hc-ping.com/...
VUTT_BACKUP_KEEP_DAYS=90
```

## Eeltingimuse kontroll — loetavus

**`--dry-run` EI tabaks õiguste viga.** rsync ehitab kuivkäitusel ainult failinimekirja
(`readdir` + `stat`) ega ava faile; `failed to open ... Permission denied` tuleb välja alles
päris ülekandel. Loetavust kontrolli **allikas**, oma tavavõtmega (backup-võti on rrsync'iga
piiratud ega saa `find`-i käivitada):

```bash
ssh vutt 'find ~/VUTT/state ~/VUTT/data ! -readable'
```

Tühi väljund = korras. Kui midagi tuleb, otsusta iga kirje kohta eraldi:

- **tuletatud vahemälu** (taastub ise) → lisa `DEFAULT_EXCLUDES`-i skriptis;
- **päris andmed** → paranda õigused allikas, ÄRA excludeeri.

Taust: backend kirjutab Dockerist root'ina. Enamik `state/` faile tuleb moodiga 0644
(`users.json`, `invite_tokens.json`, `notifications/`) ja on `meelisf`-ile loetavad, aga
`historical_regions_cache/` tuli 0600 root:root → esimene backup (2026-08-04) kukkus rsync
exit 23-ga. `data/` sama probleemi ei ole, sest `server_update.sh` teeb selle peale
`sudo chown -R meelisf:meelisf data/`.

## Snapshot-mudel

Skript loob kataloogid:

```text
/srv/backups/vutt/
├── latest -> snapshots/20260706T120000Z
└── snapshots/
    ├── 20260705T120000Z/
    │   ├── data/
    │   └── state/
    └── 20260706T120000Z/
        ├── data/
        └── state/
```

Iga uus snapshot kasutab eelmist `--link-dest` allikana: muutumata failid on hardlinkid,
aga iga snapshot on iseseisvalt taastatav tervikvaade. `--delete` on siin lubatud, sest
kustutatud failid kaovad ainult uuest snapshot'ist; vanad snapshot'id säilitavad need.

**Pooleli jäänud jooks jäetakse alles.** Ebaõnnestumisel jääb `<ts>.partial` kataloog
kettale ja **järgmine jooks jätkab sealt** (rsync jätab identsed failid vahele) — 40 GB
uuesti tõmbamine mõne vea pärast oleks ebaproportsionaalne. Kustutamiseks on
`--discard-partial`. Kuivkäitus ei kaaperda ega kustuta olemasolevat `.partial`-it.

**Hardlink-hoiatus:** ära muuda faile snapshot'i sees kohapeal — need on jagatud
varasemate snapshot'idega ja in-place muudatus muudaks neid kõiki korraga. Loe snapshot'ist,
kirjuta mujale. Sama kehtib snapshot-puu kopeerimisel teisele kettale: **`rsync -aH`**
(ilma `-H`-ta kaovad hardlingid ja maht kordistub).

## Snapshot on ka LLM-treeningu lähteandmestik

`loss`-is olev qwen-treeningu repo (`~/Dokumendid/LLM/qwen3.5`,
[qwen-mudeli-treenimine](https://github.com/meelisf/qwen-mudeli-treenimine)) ehitab
treeningandmestiku **otse snapshot'ist** — `build_vutt_dataset.py` vaikimisi allikas on
`~/vutt-backups/latest/data`. Eraldi tõmmet (`vutt_sync.py` → `data/vutt-raw/`) enam ei ole;
see kataloog kustutati 2026-08-04 (36 GB) ja skript on märgitud aegunuks.

Kaks tagajärge, mida tasub teada:

- **Backup on nüüd treeningu eeltingimus.** Kui öine jooks kukub, on järgmine andmestik vana.
  `journalctl -t vutt-backup --since today` enne ehitamist.
- **Andmestik on reprodutseeritav.** Ehitus kirjutab `data/vutt/SOURCE.txt`, kus on
  lahendatud snapshot'i tee (`.../snapshots/20260804T143956Z/data`), ehitusaeg ja lehtede arv.
  Skript resolvib `latest` symlingi ÜKS kord käivitamisel, seega samal ajal lõppev backup ei
  vaheta allikat töö keskel.

Vana `vutt_sync.py` jooksis **ilma `--delete`-ita**, seega serverist kustutatud lehed jäid
kohalikku koopiasse alles ja rändasid vaikselt treeningandmestikku. Snapshot on autoriteetne.

## Cron ja valve

Paigaldatud `loss`-is (`crontab -l`), üks rida:

```cron
15 3 * * * VUTT_BACKUP_HEALTHCHECK_URL=https://hc-ping.com/UUID /home/mf/bin/vutt_backup.py --source-host vutt-backup --source-root . --dest-root /home/mf/vutt-backups --keep-days 365 2>&1 | logger -t vutt-backup
```

Skript pingib healthchecks.io-d kolmes kohas: `/start` alguses, õnnestumisel puhas URL,
veal `/fail` koos erindi tekstiga. **Ping ei saa backup'i kukutada** — pingiviga ainult
logitakse.

Seaded healthchecks.io poolel: **Period 1 day, Grace 3 h.** Grace peab katma kõige aeglasema
realistliku jooksu, mitte tavalise. Esimene täisjooks võttis 57 min (100 Mbit link),
igapäevane inkrementaalne paar minutit — aga suur upload-partii või eelmisest jooksust
jäänud `.partial`-i jätkamine venitab. Liiga napp grace annab valehäireid, mis õpetavad
teate ignoreerima; tund hiljem saabuv päris häire ei muuda öise varunduse puhul midagi.

**Cron-keskkonda testi eraldi.** Kõige tavalisem vaikne rike on see, et käsk töötab sinu
shellis, aga mitte cron'i minimaalses keskkonnas (PATH, `~/.ssh/config`, agendi puudumine):

```bash
env -i HOME=/home/mf PATH=/usr/bin:/bin /bin/sh -c \
  'rsync --list-only vutt-backup:state/users.json'
```

Logide kontroll:

```bash
journalctl -t vutt-backup --since today
```

## Restore-test

**Backup, mida ei ole taastatud, ei ole backup.** Tee seda vähemalt korra pärast iga
seadistusmuudatust. Sisu võrdlus peab käima **räsidega**, mitte failiarvuga.

```bash
# loss-is: taasta üks teos + users.json ajutisse kohta
W=$(ls ~/vutt-backups/latest/data | grep -v '^config$' | head -1)
rm -rf /tmp/vutt-restore-test && mkdir -p /tmp/vutt-restore-test
rsync -a ~/vutt-backups/latest/data/"$W" ~/vutt-backups/latest/state/users.json /tmp/vutt-restore-test/
cd /tmp/vutt-restore-test/"$W" && find . -type f | LC_ALL=C sort | xargs md5sum | md5sum

# vutt-is: sama teos, sama arvutus
ssh vutt "cd ~/VUTT/data/$W && find . -type f | LC_ALL=C sort | xargs md5sum | md5sum"
```

`LC_ALL=C` on oluline: kahe masina erinev `LC_COLLATE` sorteerib punktiga algavad failid
(`.vutt-lock`) eri kohta ja summad lahknevad, kuigi sisu on identne. Kui summad ikka
erinevad, võrdle failikaupa (`diff` kahest `md5sum`-loendist) — nii näeb, KUMB fail lahkneb.

Tehtud 2026-08-04: 47 faili, kõik identsed; `users.json` bait-täpselt sama.

Täisrestore uuele serverile:

```bash
rsync -a /srv/backups/vutt/latest/data/  new-vutt:~/VUTT/data/
rsync -a /srv/backups/vutt/latest/state/ new-vutt:~/VUTT/state/
```

Pärast restore'i kontrolli õiguseid:

```bash
ssh new-vutt 'chmod 700 ~/VUTT/state && cd ~/VUTT && docker compose ps'
```

## Vana `backup_prosopography.sh` — cron eemaldatud 2026-08-04, skript kustutatud 2026-08-08

Kuni 2026-08-04 jooksis VUTT serveri cronist (`50 1 * * *`) skript
`scripts/backup_prosopography.sh`, mis kopeeris `state/prosopography/` →
`data/prosopography/` ja commitis selle, et öine git-push viiks kaardid GitHubi.

Prosopograafia JSON-id migreeriti 2026-05-25 `data/config/prosopography/` alla (kus need on
juba gitis). `state/prosopography/` jäi külmunud migratsioonieelsesse seisu — 2243 vana
kaarti, samal ajal kui elavaid on 2352. Skript kopeeris seega **surnud andmeid**: viimane
sisuline commit on 2026-05-25 ja iga öö pärast seda logis see „muudatusi pole".

Skript **kustutati**, mitte ei märgitud aegunuks: selle `rsync -a --delete` oleks kirjutanud
`data/prosopography/` üle 2026-05-25 seisuga, ehk käivitamine oli aktiivselt kahjulik.
Vajadusel `git log -- scripts/backup_prosopography.sh`.

Katte võtab üle `vutt_backup.py`, mis varundab `state/` tervikuna, sh isikupildid
(`state/prosopography/images/`). Serveri crontab'is on eemaldamise kohta selgitav
kommentaar; varukoopia vanast crontab'ist: `vutt:~/crontab.bak-20260804`.

> **2026-08-08 seisuga on prosopograafia ühes kohas.** `state/prosopography/` ja
> `data/prosopography/` on kustutatud; kaardid ja pildid elavad
> `data/config/prosopography/` all (pildid `images/` alamkaustas). Pildid ei ole
> gitis — `data/.gitignore` ignoreerib `*.jpg` —, aga `vutt_backup.py` katab nad,
> sest rsync ei vaata git'i. Vt issue #221.

Vahepealne seis oli ohtlik ja tasub teada, miks: `state/prosopography/` sisaldas
külmunud JSON-kaarte JA elavaid isikupilte samas kataloogis, nii et ilmne koristus
(`rm -rf state/prosopography`) oleks teinud kõik isikupildid 404-ks. Kolmas koopia
`data/prosopography/images/` oli `rsync -a --delete` tõttu elav peegeldus kuni
2026-08-04. Sellepärast on pildid nüüd kaartide kõrval ja
`PROSOPOGRAPHY_IMAGES_DIR` tuletatakse `PROSOPOGRAPHY_DIR`-ist.
