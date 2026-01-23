# VUTT Paigaldus- ja Migratsioonijuhend (2026)

> **KIIRVIIDE:** Igapäevaseks halduseks vaata [docs/CHEAT_SHEET.md](CHEAT_SHEET.md).
> Seal on käsud uuendamiseks, andmete laadimiseks ja frontendi saatmiseks.

See dokument kirjeldab VUTT rakenduse migreerimist uuele serverile (`vutt.utlib.ut.ee`) ja selle seadistamist.

**Viimati uuendatud:** 21. jaanuar 2026

## 1. Serveri Nõuded

Tellitud server (TÜ ITO / VMware):

*   **OS:** Ubuntu 24.04 LTS
*   **CPU:** 4 vCPU
*   **RAM:** 16 GB
*   **Ketas:** 120 GB (soovituslik) või 90 GB
*   **Võrk:**
    *   Väline IP olemas
    *   DNS: `vutt.utlib.ut.ee`
    *   Tulemüür: Alguses suletud (v.a SSH haldus-IP-lt ja TÜ sisevõrk)

## 2. Ettevalmistus (Uus server)

Kõik käsud käivitatakse uues serveris `root` või `sudo` õigustega kasutajana.

### 2.1 Süsteemi uuendamine ja vajalik tarkvara
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git rsync nginx python3-pip unzip ufw
```

### 2.2 Docker'i paigaldus
Soovituslik on kasutada Ubuntu ametlikku repot (stabiilsem, auditeeritud):

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2
# Käivita ja luba automaatne start
sudo systemctl enable --now docker
```

*Alternatiiv (kui on vaja kõige uuemat versiooni):* Installi `download.docker.com` ametlikust repost (vt eelmist juhendi versiooni).

### 2.3 Rakenduse koodi paigaldus
```bash
# Loome kausta /opt/vutt
sudo mkdir -p /opt/vutt
sudo chown $USER:$USER /opt/vutt

# Kloonime repo (kasuta oma Git kasutajat või HTTPS-i)
git clone https://github.com/meelisf/VUTT.git /opt/vutt
cd /opt/vutt
```

## 3. Andmete Migratsioon (Vanast Uurde)

Andmed kopeerime vanast serverist `rsync` abil. See on turvalisem kui terve ketta kloonimine.

**Mida on vaja kopeerida:**
1.  **Andmefailid** (pildid, tekstid) -> `/opt/vutt/data/`
2.  **Olekufailid** (kasutajad, tokenid) -> `/opt/vutt/state/`
3.  **Sertifikaadid** (kui on olemas) -> `/etc/nginx/certs/`

**Mida EI kopeeri:**
*   `meili_data/` (Meilisearchi indeks) - selle ehitame uuesti, et vältida versioonikonflikte.

### Käsk (käivita VANAS serveris või kohalikus masinas, kus andmed asuvad):

```bash
# Näide: Kopeeri andmed uue serveri IP-le (asenda 1.2.3.4 uue serveri IP-ga)
rsync -avz --progress ./data/ root@1.2.3.4:/opt/vutt/data/
rsync -avz --progress ./state/ root@1.2.3.4:/opt/vutt/state/

# Veendu, et users.json on olemas
# Kui ei ole, loo see käsitsi uues serveris (vt vana deployment_guide.md näidet)
```

## 4. Rakenduse Käivitamine (Docker)

**TÄHELEPANU VÕRGUGA:** Ülikooli sisevõrgus (172.16.x.x - 172.31.x.x) võib tekkida konflikt Dockeri vaikevõrkudega.
Selle vältimiseks on soovitatav `docker-compose.yml` failis defineerida kindel alamvõrk (nt 192.168.x.x) või seadistada `/etc/docker/daemon.json`.

### 4.1 Seadista keskkonnamuutujad
Loo `.env` fail `/opt/vutt/.env`:
```bash
cp .env.example .env
# Või loo uus:
# MEILI_MASTER_KEY=genereeri_pikk_suvaline_string
```

### 4.2 Muuda docker-compose.yml (Valikuline)
Tuleviku mõttes on hea, kui Dockeris jooksevad ainult `backend` ja `meilisearch`, ning `nginx` teenus on kommenteeritud välja, kui kasutame hosti Nginxi. Aga see pole kriitiline - kui Docker Nginx käib, siis ta lihtsalt ei pruugi porti 80 kätte saada, kui hosti Nginx ees on.

Soovituslik käivitus (jättes Nginxi Dockeris tähelepanuta või seadistades hosti Nginxi proxyma lokaalsetele portidele):

Veendu, et `docker-compose.yml` backend ja meilisearch pordid on kättesaadavad `localhost`ile.
Muuda `docker-compose.yml` vajadusel, et pordid oleks avatud:
```yaml
  backend:
    ports:
      - "127.0.0.1:8001:8001"
      - "127.0.0.1:8002:8002"
  meilisearch:
    ports:
      - "127.0.0.1:7700:7700"
```

### 4.3 Käivita teenused
```bash
cd /opt/vutt
docker compose up -d backend meilisearch
```

Kontrolli:
```bash
docker compose ps
# Peaksid nägema 'vutt-backend' ja 'vutt-meili' olekus 'Up'.
```

### 4.4 Taasindekseerimine
Kuna me ei kopeerinud indekseid, tuleb need uuesti luua. See võib võtta aega.

```bash
# Siseneme backendi konteinerisse
docker exec -it vutt-backend bash

# Käivitame sünkroonimise
python3 scripts/sync_meilisearch.py --reset --apply

exit
```

## 5. Veebi ja SSL Seadistamine (Host Nginx)

See on "Hübriidlahendus": Docker jooksutab rakendust, Hosti Nginx teeb SSL-i ja serveerib staatilist sisu.

### 5.1 Ehita Frontend
Kasutame Ubuntu repos leiduvat Node.js versiooni (stabiilne ja turvaline).

```bash
# Paigalda Node.js ja npm
sudo apt install -y nodejs npm

# Kontrolli versiooni (v18 või v20 on väga head)
node -v 

cd /opt/vutt
npm install
npm run build
# Tulemus on kaustas /opt/vutt/dist
```

### 5.2 Nginx Konfiguratsioon
Kopeeri sertifikaadid kausta `/etc/nginx/certs/vutt/`.

Loo fail `/etc/nginx/sites-available/vutt`:

```nginx
server {
    listen 80;
    server_name vutt.utlib.ut.ee;
    # Suuna kõik HTTPS-ile
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name vutt.utlib.ut.ee;

    # SSL Sertifikaadid (TÜ omad või Let's Encrypt)
    ssl_certificate /etc/nginx/certs/vutt/vutt_utlib_ut_ee_bundle.pem;
    ssl_certificate_key /etc/nginx/certs/vutt/vutt_utlib_ut_ee.key;

    # Turvalisus
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    
    # Logid (vajalikud statistika jaoks)
    access_log /var/log/nginx/vutt_access.log;
    error_log /var/log/nginx/vutt_error.log;

    root /opt/vutt/dist;  # Otse ehitatud kaustast
    index index.html;

    # Frontend (React Router tugi)
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API Proxy (Dockerisse)
    location /api/files/ {
        proxy_pass http://127.0.0.1:8002/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        client_max_body_size 50M;
    }

    location /api/images/ {
        proxy_pass http://127.0.0.1:8001/;
        proxy_set_header Host $host;
    }

    location /meili/ {
        proxy_pass http://127.0.0.1:7700/;
        proxy_set_header Host $host;
        # Oluline Meilisearchi jaoks:
        proxy_set_header Authorization $http_authorization; 
    }
}
```

Aktiveeri sait:
```bash
sudo ln -s /etc/nginx/sites-available/vutt /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

## 6. Turvalisus ja Tulemüür (UFW)

Enne avalikustamist piira ligipääs.

```bash
# Luba SSH
sudo ufw allow ssh

# Luba Zabbix Agent (kui monitooring on peal)
sudo ufw allow 10050/tcp comment 'Zabbix Agent'

# Luba veeb (80/443) - ligipääs on nüüd avatud kõigile, kes serverini jõuavad
# (TÜ väline tulemüür kaitseb veel välismaailma eest)
sudo ufw allow 'Nginx Full'

# Keela muu
sudo ufw default deny incoming
sudo ufw enable
```

## 7. Statistika ja Monitooring

### 7.1 Serveri logide analüüs (GoAccess)
Kuna me ei kasuta Google Analyticsit, on parim viis statistikat saada serveri logidest. Soovitame `goaccess` tööriista.

```bash
sudo apt install goaccess
# Vaata raportit konsoolis
sudo goaccess /var/log/nginx/vutt_access.log --log-format=COMBINED
```

Soovi korral võib seadistada GoAccessi genereerima HTML raportit, mida serveeritakse parooli taga oleval aadressil.

## 8. Kontrollnimekiri enne "Live" minekut

1.  [ ] **DNS:** `vutt.utlib.ut.ee` suunab uuele IP-le.
2.  [ ] **SSL:** Sertifikaat kehtib ja brauser ei hoiata.
3.  [ ] **Otsing:** Proovi otsida midagi – kas Meilisearch vastab?
4.  [ ] **Pildid:** Kas pildid laevad? (Kontrolli `/opt/vutt/data` õigusi).
5.  [ ] **Logid:** `docker compose logs -f` ei näita vigu.

Kui kõik töötab sisevõrgus/VPN-iga, palu IT-l avada väline tulemüür pordile 443 (ja 80).