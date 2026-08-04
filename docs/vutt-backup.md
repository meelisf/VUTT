# VUTT tervikbackup (`data/` + `state/`)

Skript: `scripts/vutt_backup.py`

Eesmärk: varundada VUTT **tervikuna** teisele masinale snapshot'idena:

- `~/VUTT/data/` täielikult, sh pildid (`jpg/png/tif`) ja `data/config/`
- `~/VUTT/state/`, sh `users.json`, sessioonid, `user_settings/`, isikupildid

`state/` sisaldab paroole/tokeneid/hash'e, seega peab backup-sihtkataloog olema privaatne
(`chmod 700`) ja seda ei tohi GitHubi ega avalikku pilve krüpteerimata panna.

## Käivituskoht

Käivita backup **sihtmasinas** (nt OCR-serveris), mis tõmbab andmed VUTT serverist SSH/rsync abil:

```bash
cd ~/VUTT
./scripts/vutt_backup.py --dest-root ~/vutt-backups --dry-run
./scripts/vutt_backup.py --dest-root ~/vutt-backups
```

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

## Cron

Näide sihtmasina crontab'i:

```cron
# VUTT tervikbackup iga öö kell 03:15
15 3 * * * cd ~/VUTT && ./scripts/vutt_backup.py --dest-root /srv/backups/vutt --keep-days 120 2>&1 | logger -t vutt-backup
```

Healthchecks.io kasutamisel:

```cron
15 3 * * * cd ~/VUTT && VUTT_BACKUP_HEALTHCHECK_URL=https://hc-ping.com/UUID ./scripts/vutt_backup.py --dest-root /srv/backups/vutt --keep-days 120 2>&1 | logger -t vutt-backup
```

Logide kontroll:

```bash
journalctl -t vutt-backup --since today
```

## Restore-test

Osaline restore näiteks ühe isikupildi või ühe teose piltide kontrolliks:

```bash
# Vaata viimast snapshot'i
ls -la /srv/backups/vutt/latest/data
ls -la /srv/backups/vutt/latest/state

# Taasta fail ajutisse kohta
mkdir -p /tmp/vutt-restore-test
rsync -a /srv/backups/vutt/latest/state/users.json /tmp/vutt-restore-test/
```

Täisrestore uuele serverile:

```bash
rsync -a /srv/backups/vutt/latest/data/  new-vutt:~/VUTT/data/
rsync -a /srv/backups/vutt/latest/state/ new-vutt:~/VUTT/state/
```

Pärast restore'i kontrolli õiguseid:

```bash
ssh new-vutt 'chmod 700 ~/VUTT/state && cd ~/VUTT && docker compose ps'
```

## Vana `backup_prosopography.sh`

`scripts/backup_prosopography.sh` on ajalooline skript, mis kopeerib
`state/prosopography/` → `data/prosopography/` ja commitib selle. Pärast prosopograafia
JSON-ide migreerimist `data/config/prosopography/` alla ei kata see tervikbackup'i vajadust
ning ei varunda pilte ega `state/` tervikuna. Hoia alles ainult seni, kuni serveri cronid on
üle vaadatud; uut backup'i tee `vutt_backup.py` abil.
