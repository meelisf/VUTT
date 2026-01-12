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

## 5. HTTPS Seadistamine (SSL)

Praegu töötab lahendus HTTP peal (port 80). Turvalisuse huvides (eriti sisselogimisel) on soovitatav kasutada HTTPS-i.

### Vajalik
1. **Domeeninimi** (nt `vutt.utlib.ut.ee` või `midagi.ee/vutt`). IP-aadressiga on HTTPS keeruline (v.a self-signed).
2. **SSL Sertifikaat** (nt Let's Encrypt - tasuta).

### Seadistamine (Certbot + Nginx)

1. Muuda `docker-compose.yml`:
   ```yaml
   nginx:
     ports:
       - "80:80"
       - "443:443"  <-- Ava HTTPS port
     volumes:
       - ./certs:/etc/nginx/certs:ro <-- Sertifikaatide kaust
   ```

2. Muuda `nginx.conf`:
   ```nginx
   server {
       listen 443 ssl;
       server_name sinu.domeen.ee;

       ssl_certificate /etc/nginx/certs/fullchain.pem;
       ssl_certificate_key /etc/nginx/certs/privkey.pem;

       # ... (sama sisu mis enne: location / ja location /api ...)
   }
   
   # Suuna HTTP -> HTTPS
   server {
       listen 80;
       server_name sinu.domeen.ee;
       return 301 https://$host$request_uri;
   }
   ```

3. Sertifikaatide saamine (serveris):
   Võid kasutada `certbot` tööriista otse host-masinas või eraldi konteineris, et genereerida failid kausta `./certs`.

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

