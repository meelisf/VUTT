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
