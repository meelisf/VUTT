# Tehnilised Märkmed ja Arhitektuuri Detailid

See fail sisaldab olulist tehnilist informatsiooni, mis eemaldati peamisest `deployment_guide.md` failist lihtsustamise käigus, kuid on arenduseks ja süvitsi debugimiseks kriitilise tähtsusega.

## 1. Frontend ja Meilisearch SDK eripärad

> [!IMPORTANT]
> **Meilisearch SDK URL nõue**
> 
> Meilisearch JavaScript SDK **ei toeta suhtelisi URL-e** (nt `/meili`). 
> Failis `src/config.ts` peab `MEILI_HOST` olema defineeritud absoluutse URL-ina:
> ```typescript
> // src/config.ts
> export const MEILI_HOST = `${window.location.origin}/meili`;
> ```
> 
> Vastupidiselt sellele töötavad pildid ja failid (`/api/images`, `/api/files`) edukalt suhteliste URL-idega.

## 2. Serveri Arhitektuur ja Moodulid

Backend koosneb Pythoni moodulitest `server/` kaustas:

| Moodul | Kirjeldus |
|--------|-----------|
| `file_server.py` | Peamine HTTP server (port 8002), haldab kõiki failioperatsioone ja API endpointe. |
| `image_server.py` | Eraldiseisev pildiserver (port 8001), optimeeritud skaneeritud piltide serveerimiseks. |
| `config.py` | Tsentraalne konfiguratsioon: failiteed, pordid, `rate_limits`, `CORS origins`. |
| `auth.py` | Autentimisloogika, sessioonid ja kasutajahaldus. |
| `git_ops.py` | Git versioonihaldus (commitid, ajalugu, failide taastamine). Asendab vana `.backup` süsteemi. |
| `meilisearch_ops.py` | Suhtlus Meilisearchiga: indekseerimine ja sünkroonimine. |
| `pending_edits.py` | Kaastööliste (contributor roll) muudatuste haldus ja järjekord. |
| `registration.py` | Uute kasutajate registreerimistaotlused ja `invite token`id. |
| `rate_limit.py` | Brute-force kaitse (Rate limiting). |
| `cors.py` | CORS (Cross-Origin Resource Sharing) päiste dünaamiline käsitlus. |
| `utils.py` | Abifunktsioonid (ID sanitariseerimine, metaandmete genereerimine). |

### API Endpointide Ülevaade

**Autentimine:**
- `POST /login` - Sisselogimine
- `POST /logout` - Väljalogimine
- `GET /verify-token` - Tokeni valiidsuse kontroll

**Andmete muutmine:**
- `POST /save` - Faili salvestamine (editor+ õigused). Loob Giti commiti.
- `POST /save-pending` - Kaastöölise muudatus (contributor). Läheb ülevaatusjärjekorda.
- `GET /backups` - Faili versiooniajalugu (Git log).
- `POST /restore` - Vana versiooni taastamine.
- `GET /recent-edits` - Viimased muudatused süsteemis.

**Admin ja Kasutajad:**
- `GET /admin/registrations` - Ootel registreerimised.
- `POST /admin/registrations/{id}/approve` - Kasutaja kinnitamine.
- `GET /admin/users` - Kasutajate nimekiri.
- `POST /admin/users/{username}/role` - Rolli muutmine.
- `DELETE /admin/users/{username}` - Kasutaja kustutamine.

**Metaandmed:**
- `GET /metadata-suggestions` - Autocomplete soovitused (autorid, kohad).
- `POST /update-metadata` - Teose metaandmete (json) uuendamine.

## 3. Git Versioonihaldus (Data kaustas)

Rakendus kasutab andmekaustas (`data/`) asuvat Git repositooriumi tekstifailide versioonihalduseks. See asendab varasemat failipõhist `.backup.timestamp` süsteemi.

### Loogika
- Iga `POST /save` tekitab uue Giti **commiti**.
- Commiti autoriks märgitakse muudatuse teinud kasutaja.
- Esimene commit faili ajaloos on alati originaal OCR (see võimaldab alati algseisu taastada).
- Admin kasutajaliideses "Ajalugu" tab kuvab `git log` väljundit.

### Failide liigutamine (Refactoring)
Kui on vaja faile kaustade vahel liigutada (nt pilt kuulub teise teose juurde), tuleb seda teha nii, et Git ajalugu säiliks:

```bash
cd /opt/vutt/data

# 1. Liiguta failid (txt + jpg)
mv vana_kaust/leht5.txt uus_kaust/
mv vana_kaust/leht5.jpg uus_kaust/

# 2. Registreeri muudatus Gitis (OLULINE!)
git add -A
git commit -m "Liiguta leht5 kausta uus_kaust"

# 3. Uuenda Meilisearch indeks
# See on vajalik, et otsingumootor teaks uut asukohta
python3 /opt/vutt/scripts/sync_meilisearch.py --apply
```

### Vanade backupide migratsioon
Skript `scripts/migrate_backups_to_git.py` on mõeldud vana `.backup` süsteemi konverteerimiseks Giti ajalooks.
- See otsib üles kõik `.backup` failid.
- Järjestab need aja järgi.
- Teeb igaühe kohta tagantjärele Giti commiti (kasutades `--date` lippu).

## 4. Turvalisuse Detailne Kontroll

### Nginx Konfiguratsiooni detailid
Nginx peab edastama kindlad päised, et rakendus teaks, kes päringu tegi (IP aadress logimiseks ja rate-limiti jaoks).

```nginx
# Vajalikud päised proxy_pass blokis:
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
```

### CORS Seadistus
Failis `server/config.py` on nimekiri lubatud domeenidest.
```python
ALLOWED_ORIGINS = [
    'https://vutt.utlib.ut.ee',
    # Arenduse ajal võib olla ka:
    # 'http://localhost:3000'
]
```

### Andmete varundamise strateegia
Kuigi Git hoiab ajalugu, on vaja välist varukoopiat (`off-site backup`).
- **Pildid (.jpg):** Muutuvad harva. Piisab ühekordsest koopiast + uute lisandumisel sünkroonimine.
- **Tekstid (.txt, .json, .git):** Muutuvad pidevalt. `rsync` kogu `data/` kaustast on parim lahendus, sest see haarab ka `.git` kausta kaasa.
- **Meilisearch:** Indeksit **ei ole mõtet** varundada. See on alati taastatav (re-indexed) algandmete pealt (`scripts/sync_meilisearch.py`).
