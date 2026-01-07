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
1. **Domeeninimi** (nt `vutt.ut.ee` või `midagi.ee/vutt`). IP-aadressiga on HTTPS keeruline (v.a self-signed).
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

