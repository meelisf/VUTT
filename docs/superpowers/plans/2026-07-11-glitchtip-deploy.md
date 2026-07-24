# GlitchTip self-hosted deploy — vea-aggregatsioon (issue #133)

**Seis:** integratsioonikiht on koodis olemas (PR #170, `docs/error-reporting.md`).
See plaan katab **infrastruktuuri** — GlitchTipi püstitamine ja DSN-ide sidumine.

**Otsus:** GlitchTip jookseb **eraldi VM-il/instantsis** (mitte VUTT-serveril), et
vea-tööriist elaks üle ka VUTT-i seisaku. Domeen nt `errors.vutt.ut.ee`.

**Eeltingimus (IT):** eraldi VM (≥2 vCPU, 4 GB RAM, ~20 GB ketas), Docker + Docker
Compose, DNS-kirje `errors.vutt.ut.ee` → VM IP, 443/80 avatud.

---

## Arhitektuur

```
Brauser ──uncaught/React vead──┐
                                ├─► errors.vutt.ut.ee (nginx+TLS)
FastAPI backend ──erindid──────┘         │
                                          ▼
                        GlitchTip stack (eraldi VM, Docker Compose)
                        ├── web (Django)      ── UI + ingestion API
                        ├── worker (Celery)   ── sündmuste töötlus
                        ├── postgres          ── sündmuste andmebaas
                        └── redis             ── järjekord/cache
```

Kaks eraldi GlitchTip-**projekti**: `vutt-frontend` ja `vutt-backend` → kaks DSN-i.

---

## Samm 1 — GlitchTip stack VM-il

`~/glitchtip/docker-compose.yml` (GlitchTipi ametlik näidis, kinnitatud versiooniga):

```yaml
x-environment: &default-environment
  SECRET_KEY: ${GLITCHTIP_SECRET_KEY}          # genereeri: openssl rand -hex 32
  DATABASE_URL: postgres://postgres:${PG_PASS}@postgres:5432/postgres
  REDIS_URL: redis://redis:6379/0
  EMAIL_URL: ${GLITCHTIP_EMAIL_URL}            # nt smtp://... UT SMTP kaudu
  GLITCHTIP_DOMAIN: https://errors.vutt.ut.ee
  DEFAULT_FROM_EMAIL: errors@vutt.ut.ee
  CELERY_WORKER_AUTOSCALE: "1,3"
  # Avalik registreerimine KINNI — ainult kutsutud kasutajad:
  ENABLE_OPEN_USER_REGISTRATION: "False"

services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: ${PG_PASS}
    volumes: [pg-data:/var/lib/postgresql/data]
    restart: unless-stopped
  redis:
    image: redis:7
    restart: unless-stopped
  web:
    image: glitchtip/glitchtip:v4.x        # pinni konkreetne tag, mitte latest
    depends_on: [postgres, redis]
    ports: ["127.0.0.1:8080:8080"]         # ainult localhost → nginx proksib
    environment: *default-environment
    restart: unless-stopped
  worker:
    image: glitchtip/glitchtip:v4.x
    command: celery -A glitchtip worker -l info
    depends_on: [postgres, redis]
    environment: *default-environment
    restart: unless-stopped
  migrate:
    image: glitchtip/glitchtip:v4.x
    command: ./manage.py migrate
    depends_on: [postgres]
    environment: *default-environment
    restart: on-failure

volumes:
  pg-data:
```

`.env` (VM-il, mitte gitis):
```env
GLITCHTIP_SECRET_KEY=<openssl rand -hex 32>
PG_PASS=<tugev parool>
GLITCHTIP_EMAIL_URL=smtp://...
```

Käivita: `docker compose up -d` → `migrate` loob skeemi → esimene kasutaja luuakse
UI-s (kuna open-registration kinni, kasuta `./manage.py createsuperuser` või esimest
registreerimist enne kinni-panekut).

## Samm 2 — nginx + TLS (VM-il, hostis)

Sama muster mis VUTT nginx (hostis, mitte Dockeris). `errors.vutt.ut.ee`:

```nginx
server {
    server_name errors.vutt.ut.ee;
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 40M;   # source map / suured payload'id
    }
}
```
TLS: `certbot --nginx -d errors.vutt.ut.ee`.

## Samm 3 — Projektid ja DSN-id

GlitchTip UI-s: loo organisatsioon → kaks projekti:
1. `vutt-backend` → kopeeri DSN
2. `vutt-frontend` → kopeeri DSN

**Inbound filtrid** (frontend DSN on avalik JS-bundlis → müra-oht):
- Projekti seaded → rate limit / spam-protection sisse.
- Vajadusel `Inbound filters` → ignoreeri teadaolev müra (nt browser-extension vead).

## Samm 4 — Backend sidumine (VUTT-server)

`~/VUTT/.env`-i:
```env
ERROR_REPORTING_DSN=https://<key>@errors.vutt.ut.ee/<backend-project-id>
ERROR_REPORTING_ENVIRONMENT=production
ERROR_REPORTING_RELEASE=vutt-2026-07-11   # nt git commit või kuupäev
```
Docker Compose loeb need automaatselt (PR #170 lisas muutujad). Rakenda:
```bash
ssh vutt && cd ~/VUTT
./scripts/server_update.sh --no-cache    # rebuild backend uue sentry-sdk sõltuvusega
```
Kontroll: `docker logs vutt-backend` → ei tohi olla sentry init-viga; tekita testerind
ja vaata, kas GlitchTipi jõuab.

## Samm 5 — Frontend sidumine (lokaalne build)

Frontendi DSN kompileeritakse buildi. Lokaalses masinas `.env.production` (gitti EI):
```env
VITE_SENTRY_DSN=https://<key>@errors.vutt.ut.ee/<frontend-project-id>
VITE_SENTRY_ENVIRONMENT=production
VITE_SENTRY_RELEASE=vutt-2026-07-11
```
```bash
npm run build
rsync -avz dist/ vutt:~/VUTT/dist/
```

## Samm 6 — Source map'id (loetavad frontend-stack-trace'id)

Minifitseeritud build → ilma source map'ideta on trace loetamatu. Valik:
- **6a (soovitus):** laadi source map'id buildi järel GlitchTipi ja **kustuta `dist/`-ist**
  (ära serveeri avalikult). `@sentry/cli` või GlitchTipi API, sama `release` string.
  ```bash
  npx @sentry/cli sourcemaps upload --url https://errors.vutt.ut.ee \
    --org <org> --project vutt-frontend --release vutt-2026-07-11 dist/assets
  # seejärel eemalda dist/**/*.map enne rsync'i
  ```
- **6b:** jäta source map'id tegemata → trace jääb minifitseerituks (kiirem, aga
  raskem lugeda). OK, kui maht väike.

## Samm 7 — Retention ja privaatsus

- GlitchTip UI → event retention **30–90 päeva** (vähendab ketast + GDPR-pinda).
- Ligipääs UI-le **ainult admin(id)ele** (open-registration kinni, samm 1).
- Meeldetuletus (PR #170 jääkrisk): erindite *sõnumeid* ei skrubita → GlitchTipi
  ligipääs peab olema kitsas.

## Samm 8 — Valideerimine (end-to-end)

- [ ] Backend: tekita test-erind (nt ajutine `/debug/boom` või olemasolev viga) →
      ilmub GlitchTipi `vutt-backend` projekti; kontrolli, et `request` sisaldab ainult
      URL+method, ei ole tokenit/keha/küpsiseid.
- [ ] Frontend: viska React-komponendis erind → `vutt-frontend` projekti; kontrolli
      scrub (ei kasutaja-ID, ei query-parameetreid).
- [ ] Daemon-thread: kontrolli, et taustaloopi erind jõuab kohale (seos #88 heartbeat'iga).
- [ ] DSN-ita dev: kohalik build ilma `VITE_SENTRY_DSN`-ita → SDK ei käivitu.

---

## Avalikustamise seos

Issue #133 on avalikustamise eeltingimus (`project_public_launch_plan`). Kui GlitchTip
töötab ja valideeritud, saab #133 sulgeda.

## Lahtised otsused (vaja kinnitust)
1. VM olemasolu / IT-taotlus — **blokeerib kõik**.
2. Source map'id: 6a (üleslaadimine) vs 6b (jätame). Vaikimisi soovitus: 6a.
3. E-post: kas UT SMTP kaudu (nõuab `EMAIL_URL`) või alerdid mõnda muusse kanalisse.
4. `release` string konventsioon: git-commit SHA vs kuupäev.
```

