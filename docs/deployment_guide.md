# VUTT Paigaldamine ja Kolimine

See juhend kirjeldab, kuidas paigaldada VUTT rakendus tootmisserverisse.

*Viimati uuendatud: 2026-01-19*

## Eeldused

- Linux server (testitud Ubuntu 22.04+)
- Python 3.10+ koos pip-iga
- Node.js 18+ (fronti ehitamiseks)
- Nginx (reverse proxy)
- Git (versioonihaldus tekstidele)

## 1. Failide ettevalmistamine

1. Klooni repositoorium serverisse:
   ```bash
   cd /opt
   git clone https://github.com/... vutt
   cd /opt/vutt
   ```

2. Kopeeri andmekataloog (`04_sorditud_dokumendid`) serverisse:
   ```bash
   # nt /opt/vutt/data/
   ```

3. Ehita frontend:
   ```bash
   npm install
   npm run build
   # Tekib 'dist/' kaust - kopeeri see Nginxi kausta
   cp -r dist/* /var/www/vutt/
   ```

Struktuur serveris (`/opt/vutt/`):
```
/opt/vutt/
  ├── server/                <-- Backend moodulid (Python)
  │   ├── __init__.py        <-- Eksportide koondus
  │   ├── file_server.py     <-- Peamine HTTP server
  │   ├── image_server.py    <-- Pildiserver
  │   ├── config.py          <-- Seadistused
  │   ├── auth.py            <-- Autentimine ja sessioonid
  │   ├── git_ops.py         <-- Git versioonihaldus
  │   ├── meilisearch_ops.py <-- Meilisearchi sünkroonimine
  │   ├── pending_edits.py   <-- Kaastööliste muudatused
  │   ├── registration.py    <-- Kasutajate registreerimine
  │   ├── rate_limit.py      <-- Rate limiting
  │   ├── cors.py            <-- CORS käsitlus
  │   └── utils.py           <-- Abifunktsioonid
  ├── state/                 <-- Andmefailid
  │   ├── users.json         <-- Kasutajad (loo käsitsi!)
  │   ├── pending_registrations.json
  │   ├── invite_tokens.json
  │   └── pending_edits.json
  ├── scripts/               <-- Migratsiooniskriptid
  ├── .env                   <-- Konfig (Meilisearch võti)
  └── data/                  <-- Andmekataloog (symlink või koopia)
```

## 2. Seadistamine

### 2.1 Keskkonnamuutujad (.env)

Loo `.env` fail projekti juurkausta:
```bash
MEILISEARCH_URL=http://127.0.0.1:7700
MEILISEARCH_MASTER_KEY=sinu_meilisearch_võti
VUTT_DATA_DIR=/opt/vutt/data
```

### 2.2 Kasutajate fail (state/users.json)

Loo fail käsitsi (automaatselt EI looda!):
```json
{
  "admin": {
    "password_hash": "sha256_hash_siia",
    "name": "Admin Nimi",
    "email": "admin@example.com",
    "role": "admin"
  }
}
```

Parooli hashi saad:
```bash
echo -n 'tugev_parool' | sha256sum
```

### 2.3 Python sõltuvused

```bash
pip install meilisearch GitPython
```

## 3. Käivitamine

### Teenuste käivitamine

```bash
cd /opt/vutt
./start_services.sh
```

Skript käivitab:
- **Meilisearch** (port 7700) - otsingu- ja dokumendimootor
- **Image server** (port 8001) - pilditeenindus
- **File server** (port 8002) - API ja failide salvestamine

Logid kirjutatakse `./logs/` kausta.

### Taustaprotsessid

File server käivitab automaatselt:
- **Metadata watcher** - tuvastab uued teosed ja indekseerib need Meilisearchi

## 4. HTTPS Seadistamine (vutt.utlib.ut.ee)

> [!IMPORTANT]
> **Meilisearch SDK nõue**: Meilisearch JavaScript SDK **ei toeta suhtelisi URL-e** (nt `/meili`). `config.ts` failis peab `MEILI_HOST` olema absoluutne URL: `${window.location.origin}/meili`. Pildid ja failid (`/api/images`, `/api/files`) töötavad suhteliste URL-idega.

### Praegune töötav konfiguratsioon

**Sertifikaadid**: `/etc/nginx/certs/vutt/`
- `vutt_utlib_ut_ee_bundle.pem`
- `vutt_utlib_ut_ee.key`

**Nginx konfiguratsioonifail**: `/etc/nginx/sites-available/vutt`

```nginx
server {
    listen 80;
    server_name vutt.utlib.ut.ee;
    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name vutt.utlib.ut.ee;

    ssl_certificate /etc/nginx/certs/vutt/vutt_utlib_ut_ee_bundle.pem;
    ssl_certificate_key /etc/nginx/certs/vutt/vutt_utlib_ut_ee.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    root /var/www/vutt;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/files/ {
        proxy_pass http://127.0.0.1:8002/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/images/ {
        proxy_pass http://127.0.0.1:8001/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /meili/ {
        proxy_pass http://127.0.0.1:7700/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Frontend uuendamine
```bash
npm run build
cp -r dist/* /var/www/vutt/
```

### Taustateenused
```bash
cd /opt/vutt
./start_services.sh
```

## 5. Serveri moodulid

Backend koosneb moodulitest `server/` kaustas:

| Moodul | Kirjeldus |
|--------|-----------|
| `file_server.py` | Peamine HTTP server (port 8002), kõik API endpointid |
| `image_server.py` | Pildiserver (port 8001), serveerib skaneeritud pilte |
| `config.py` | Kõik seadistused: teed, pordid, rate limits, CORS origins |
| `auth.py` | Autentimine, sessioonid, kasutajahaldus |
| `git_ops.py` | Git versioonihaldus (commitid, ajalugu, taastamine) |
| `meilisearch_ops.py` | Indekseerimine ja sünkroonimine Meilisearchiga |
| `pending_edits.py` | Kaastööliste (contributor) ootel muudatuste haldus |
| `registration.py` | Registreerimistaotlused ja invite tokenid |
| `rate_limit.py` | Rate limiting brute-force kaitseks |
| `cors.py` | CORS päiste käsitlus |
| `utils.py` | Abifunktsioonid (sanitize_id, metadata genereerimine) |

### API endpointid

**Autentimine:**
- `POST /login` - Sisselogimine
- `POST /logout` - Väljalogimine
- `GET /verify-token?token=...` - Tokeni valideerimine

**Andmed:**
- `POST /save` - Lehekülje salvestamine (editor+)
- `POST /save-pending` - Kaastöölise muudatus ülevaatusele (contributor)
- `GET /backups?file=...` - Faili versiooniajalugu (admin)
- `POST /restore` - Versiooni taastamine (admin)
- `GET /recent-edits?token=...` - Viimased muudatused

**Registreerimine (avalik):**
- `POST /register` - Taotluse esitamine
- `GET /invite/{token}` - Tokeni kehtivuse kontroll
- `POST /invite/{token}/set-password` - Parooli seadmine

**Admin:**
- `GET /admin/registrations?auth_token=...` - Taotluste nimekiri
- `POST /admin/registrations/{id}/approve` - Kinnitamine
- `POST /admin/registrations/{id}/reject` - Tagasilükkamine
- `GET /admin/users?auth_token=...` - Kasutajate nimekiri
- `POST /admin/users/{username}/role` - Rolli muutmine
- `DELETE /admin/users/{username}` - Kasutaja kustutamine

**Viimased muudatused:**
- `GET /recent-edits?token=...` - Viimased Git commitid

**Metaandmed:**
- `GET /metadata-suggestions` - Autorite, kohtade, trükkalite soovitused
- `POST /update-metadata` - Teose metaandmete uuendamine (admin)

## 6. Turvalisuse checklist

- [ ] **HTTPS aktiveeritud** - Paroolid ja sessioonitokenid liiguvad üle võrgu
  - Domeeninimi olemas (nt `vutt.utlib.ut.ee`)
  - SSL sertifikaat paigaldatud (Let's Encrypt või ülikooli oma)
  - HTTP → HTTPS suunamine seadistatud
  - Port 443 tulemüüris avatud

- [ ] **Pordid suletud** - Ainult Nginx on välismaailmale nähtav
  - Port 80/443 (Nginx) - AVATUD
  - Port 7700 (Meilisearch) - SULETUD väljapoolt
  - Port 8001 (Image server) - SULETUD väljapoolt
  - Port 8002 (File server) - SULETUD väljapoolt
  - Kontrolli: `sudo ufw status` või `sudo iptables -L`

- [ ] **CORS piiratud** - Konfigureeritud `server/config.py` failis:
  ```python
  # ALLOWED_ORIGINS list failis server/config.py
  ALLOWED_ORIGINS = [
      'https://vutt.utlib.ut.ee',
      # ... jne
  ]
  ```

### Kohustuslik (Kasutajad ja paroolid)

- [ ] **state/users.json loodud** - Fail peab eksisteerima (automaatselt ei looda!)
  ```bash
  # Parooli hash:
  echo -n 'tugev_parool_123' | sha256sum
  ```

- [ ] **Tugevad paroolid** - Vähemalt 12 tähemärki, sisaldab numbreid/erimärke

- [ ] **Admin kasutajad minimaalsed** - Ainult need, kes tõesti vajavad

- [ ] **Vaikeparoolid muudetud** - Kui varem kasutasid `admin123`, muuda ära!

### Soovitatav (Lisaturvalisus)

- [ ] **Meilisearch master key** - Olemas `.env` failis:

- [ ] **Regulaarsed varukoopiad** - Mõistlik strateegia:

  | Andmetüüp | Muutub? | Strateegia |
  |-----------|---------|------------|
  | Pildid (.jpg) | Ei | Ühekordne koopia, harva |
  | Tekstid (.txt, .json) | Jah | Inkrementaalne (rsync) |
  | Meilisearch | Jah | Pole vaja - taastub failidest |

  ```bash
  # Inkrementaalne rsync (ainult muutunud failid):
  rsync -av --delete /opt/vutt/data/ /backup/vutt-data/

  # Cron (iga öö kell 3):
  0 3 * * * rsync -av --delete /opt/vutt/data/ /backup/vutt-data/
  ```

  NB: Rakendus kasutab Git versioonihaldust (iga salvestus = commit). Originaal OCR on esimene commit.

- [ ] **Logide monitooring** - Jälgi kahtlast tegevust
  ```bash
  tail -f logs/*.log
  ```

### Põhiasjad

1. **Kus andmed asuvad?** - Serveris `/opt/vutt/data/`, varukoopiad [asukoht]
2. **Kes pääseb ligi?** - Ainult autenditud kasutajad (users.json)
3. **Mis pordid on avatud?** - Ainult 80/443 (Nginx reverse proxy)
4. **Kas HTTPS?** - Jah, Let's Encrypt / ülikooli sertifikaat
5. **Kas andmed on tundlikud?** - Ajaloolised tekstid, pole isikuandmeid
6. **Kes haldab?** - Meelis Friedenthal meelis.friedenthal@ut.ee

## 7. Git Versioonihaldus

Rakendus kasutab Git-i tekstifailide versioonihalduseks (asendab vana `.backup.*` süsteemi).

### Kuidas töötab
- Andmekaustas (`/opt/vutt/data/` või `VUTT_DATA_DIR`) on Git repo
- Iga tekstifaili salvestus loob uue commiti kasutaja nimega
- Esimene commit iga faili jaoks = originaal OCR (alati taastatav)
- Admin näeb "Ajalugu" tabis kõiki versioone koos autoritega

### Vanade backup-failide migratsioon
Kui serveris on veel vanu `.backup.*` faile:
```bash
cd /opt/vutt/data
python3 /opt/vutt/scripts/migrate_backups_to_git.py --dry-run  # Vaata ette
python3 /opt/vutt/scripts/migrate_backups_to_git.py            # Käivita
python3 /opt/vutt/scripts/migrate_backups_to_git.py --delete-backups  # Kustuta vanad
```

### Git repo serveris
```bash
cd /opt/vutt/data
git log --oneline -20          # Viimased 20 muudatust
git log --oneline -- "*.txt"   # Ainult tekstifailid
git show abc1234:teos/leht.txt # Kindla versiooni vaatamine
git log --format="%h %an %s"   # Kes mida muutis
```

### Failide liigutamine kaustade vahel

Kui on vaja faile käsitsi ümber tõsta (nt pilt kuulub teise teose juurde):

```bash
cd /opt/vutt/data

# 1. Liiguta failid (txt + jpg)
mv vana_kaust/leht5.txt uus_kaust/
mv vana_kaust/leht5.jpg uus_kaust/

# 2. Registreeri muudatus Gitis
git add -A
git commit -m "Liiguta leht5 kausta uus_kaust"

# 3. Uuenda Meilisearch indeks
python3 /opt/vutt/scripts/sync_meilisearch.py --apply
```

**Miks see töötab:**
- Git tuvastab faili liikumise automaatselt (kui sisu on sama)
- Faili ajalugu säilib ka pärast liigutamist
- `sync_meilisearch.py` uuendab otsinguindeksi

**NB:** Vanad `.backup.*` failid pole enam vajalikud - Git hoiab kogu ajalugu.

### Kiire turvakontroll

```bash
# Kontrolli, et backend pordid pole väljast ligipääsetavad:
curl -I http://SERVERI_IP:7700  # Peaks andma timeout/refused
curl -I http://SERVERI_IP:8001  # Peaks andma timeout/refused
curl -I http://SERVERI_IP:8002  # Peaks andma timeout/refused

# Kontrolli HTTPS:
curl -I https://vutt.utlib.ut.ee  # Peaks töötama
curl -I http://vutt.utlib.ut.ee   # Peaks suunama HTTPS-le
```

