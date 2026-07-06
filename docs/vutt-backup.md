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
