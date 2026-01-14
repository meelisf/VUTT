# VUTT Paigaldamine ja Kolimine

See juhend kirjeldab, kuidas liigutada VUTT rakendus ja andmed uude serverisse kasutades Dockerit ja Nginxi.

## Eeldused
- Uus server (Linux)
- Installitud **Docker** ja **Docker Compose**

## 1. Failide ettevalmistamine

1. Kopeeri kogu **VUTT koodikataloog** uude masinasse (nt `/opt/vutt`).
2. Kopeeri andmekataloog (`04_sorditud_dokumendid`) uude masinasse (nt `/opt/vutt/data`).
3. OLULINE: Enne kopeerimist ehita frontend valmis:
   ```bash
   # Sinu oma arvutis:
   npm install
   npm run build
   # Tekib 'dist' kaust. See PEAB olema serveris kaasas!
   ```

Struktuur serveris (`/opt/vutt/`):
```
/opt/vutt/
  ├── docker-compose.yml
  ├── Dockerfile
  ├── nginx.conf
  ├── dist/                  <-- Builditud frontend (kopeeri oma arvutist!)
  ├── data/                  <-- Andmed
  └── ... (muud failid)
```

## 2. Seadistamine

1. Ava `docker-compose.yml` ja vaata üle `volumes` real:
   `- ./data:/data`
   Veendu, et sinu andmed on tõesti kaustas `data` (Dockerfile kõrval).

2. (Valikuline) Määra Meilisearchi võti:
   - Loo `.env` fail: `MEILI_MASTER_KEY=sinu_võti`

## 3. Käivitamine

```bash
cd /opt/vutt
docker compose up -d
```

Pärast käivitamist on VUTT kättesaadav serveri IP-aadressil pordil 80 (ehk lihtsalt `http://SERVERI_IP`).

- Pildid ja API on kättesaadavad läbi Nginxi (`/api/images/...`, `/api/files/...`).
- Meilisearch on kättesaadav aadressil `/meili/`.

## Probleemide korral
- `docker compose logs -f` - näitab logisid
- `docker compose restart` - taaskäivitab teenused

## 5. HTTPS Seadistamine (vutt.utlib.ut.ee)

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
# Kopeeri dist/ sisu serverisse /var/www/vutt/
```

### Taustateenused (mitte-Docker variant)
```bash
cd /home/mf/Dokumendid/LLM/tartu-acad
./start_services.sh
```

## 6. Turvalisuse Checklist (Tootmisserver)

Enne avalikku kasutamist veendu, et kõik punktid on täidetud:

### Kohustuslik (HTTPS ja võrk)

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

- [ ] **CORS piiratud** - Pärast domeeni saamist muuda `file_server.py`:
  ```python
  # Asenda '*' konkreetse domeeniga:
  allowed_origins = ['https://vutt.utlib.ut.ee'] #nt
  origin = self.headers.get('Origin')
  if origin in allowed_origins:
      self.send_header('Access-Control-Allow-Origin', origin)
  ```

### Kohustuslik (Kasutajad ja paroolid)

- [ ] **users.json loodud** - Fail peab eksisteerima (automaatselt ei looda!)
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

  NB: Rakendus loob automaatselt `.backup.*` faile iga salvestusega (max 10 versiooni + originaal).

- [ ] **Logide monitooring** - Jälgi kahtlast tegevust
  ```bash
  docker compose logs -f --tail=100
  ```

- [ ] **Uuendused** - Docker images ja OS turvauuendused

### Põhiasjad

1. **Kus andmed asuvad?** - Serveris `/opt/vutt/data/`, varukoopiad [asukoht]
2. **Kes pääseb ligi?** - Ainult autenditud kasutajad (users.json)
3. **Mis pordid on avatud?** - Ainult 80/443 (Nginx reverse proxy)
4. **Kas HTTPS?** - Jah, Let's Encrypt / ülikooli sertifikaat
5. **Kas andmed on tundlikud?** - Ajaloolised tekstid, pole isikuandmeid
6. **Kes haldab?** - Meelis Friedenthal meelis.friedenthal@ut.ee

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

