# VUTT Administraatori Spikker

Siin on lühikesed käsud serveri haldamiseks. Asukoht serveris: `~/VUTT`

## 🔄 Rakenduse Uuendamine
Kui oled teinud koodimuudatusi ja need Giti saatnud:

```bash
cd ~/VUTT
./scripts/server_update.sh
```
*See teeb: git pull, docker rebuild, restart.*

## 📤 Frontendi Uuendamine
Frontend ehitatakse sinu **kohalikus arvutis** ja saadetakse serverisse.

1.  **Sinu arvutis:**
    ```bash
    # Veendu, et .env on korras (VITE_MEILI_SEARCH_API_KEY)
    npm run build
    rsync -avz --delete dist/ meelisf@vutt.utlib.ut.ee:~/VUTT/dist/
    ```

## 🗄️ Andmebaasi (Otsingu) Lähtestamine
Kui otsing on katki või tühi:

```bash
cd ~/VUTT
./scripts/server_seed_data.sh
```

## 🔍 Andmete Indekseerimine Manuaalselt
Kui soovid skripte käivitada otse serveri terminalis (väljaspool Dockerit):

```bash
cd ~/VUTT
source .venv/bin/activate

# 1. Konsolideeri andmed (genereerib JSONL faili)
python3 scripts/1-1_consolidate_data.py

# 2. Lae andmed Meilisearchi
# Kuna .env-s on URL Dockeri jaoks (http://meilisearch:7700), 
# peab käsitsi käivitades andma ette localhost aadressi:
MEILISEARCH_URL=http://127.0.0.1:7700 python3 scripts/2-1_upload_to_meili.py
```

## 📊 Analüütika (Umami)
Andmete kogumine on avalik, aga halduspaneel on turvalisuse huvides peidetud.

**1. Sisselogimine paneeli (SSH tunnel):**
Käivita **oma arvutis** terminal:
```bash
ssh -L 3000:localhost:3000 meelisf@vutt.utlib.ut.ee
```
Nüüd ava brauseris: `http://localhost:3000`

**2. Jälgimiskood:**
Jälgimine toimib läbi Nginxi proxy. Failis `index.html` peab olema:
```html
<script defer src="/umami.js" data-website-id="..."></script>
```

## 🔑 Võtmed ja Paroolid
*   **Kus nad asuvad:** `~/VUTT/.env`
*   **Otsingu API võti:**
    ```bash
    # Küsi Meilisearchilt kehtivat võtit (vajab MASTER_KEY-d .env failist)
    # Asenda 'MASTER_KEY' oma tegeliku võtmega
    curl -H "Authorization: Bearer MASTER_KEY" http://127.0.0.1:7700/keys
    ```

## 🛠️ Tõrkeotsing

**1. "Bad Gateway" (502)**
*   Kas Docker konteinerid töötavad?
    `docker compose ps`
*   Kas serveri Nginx töötab?
    `sudo systemctl status nginx`

**2. "Invalid API Key"**
*   Kontrolli, kas frontend saadab õige võtme (Network tab -> Headers).
*   Vaata punkti "Võtmed ja Paroolid" ja uuenda `.env` faili nii serveris kui oma arvutis.

**3. Serveri logid**
*   Backend: `docker compose logs -f backend`
*   Nginx (server): `sudo tail -f /var/log/nginx/vutt_error.log`
