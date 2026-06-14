# SEO Dynamic Rendering — Disainispetsifikatsioon

**Kuupäev:** 2026-06-09  
**Staatus:** Kinnitatud

## Eesmärk

Muuta VUTT teoste lehed Google'is leitavaks, kasutades dynamic rendering mustrit: Googlebot saab serveri poolt renderdatud HTML-i, tavalised kasutajad saavad React SPA-d. 1264 teost peaksid olema leitavad pealkirja, autorite ja aasta järgi.

## Praegune seis

Infrastruktuur on 80% valmis:

- nginx `$is_bot` kaart sisaldab juba `googlebot` ja `bingbot`
- `/work/{id}` rewrite boti jaoks → `/api/files/meta/work/{id}` on olemas
- `server/main.py`: `GET /meta/work/{work_id}` endpoint on olemas
- `server/metadata_handler.py`: `build_meta_html()` on olemas (sotsiaalmeedia OG tagid)
- `robots.txt` lubab `/work/` ja keelab `/api/`

Puudub: rikkalik sisukas HTML Googlele, COinS, sitemap, robots.txt sitemap-viide.

## Komponendid

### 1. `server/metadata_handler.py` — `build_meta_html()` uuendus

Praegune HTML on sotsiaalmeedia jagamise jaoks (ainult OG tagid + meta refresh). Google jaoks lisatakse:

**`<head>` muudatused:**
- `<link rel="canonical" href="https://vutt.utlib.ut.ee/work/{work_id}">` — Google indekseerib sisu kanooniline URL alla (SPA leht)
- `meta http-equiv="refresh"` **jääb alles** — kaitseb juhuks kui inimene jõuab otse sellele endpointile
- Dublin Core meta tagid: `DC.title`, `DC.creator` (kõik autorid), `DC.date`, `DC.publisher`, `DC.language`
- COinS span: `<span class="Z3988" title="{coins_string}">` — identne frontendi `generateCoins()` loogikaga; Zotero tuvastab automaatselt ka Google'ist leitud lehelt

**COinS väljad** (koostatakse `_metadata.json` põhjal):
- `ctx_ver=Z39.88-2004`
- `rft_val_fmt=info:ofi/fmt:kev:mtx:book`
- `rft.genre=book`
- `rft.btitle` — pealkiri
- `rft.au` — praeses/auctor roll
- `rft.contributor` — respondens roll
- `rft.date` — aasta
- `rft.place` — trükikoht (LinkedEntity `label` väli)
- `rft.pub` — trükkal (LinkedEntity `label` väli)
- `rft.language` — keeled komaga eraldatult
- `rft_id` — `external_url` kui on https URL

**`<body>` muudatused:**
- `<h1>` pealkiri
- Autorid rollidega (`<dl>` loend): praeses, auctor, respondens
- Aasta
- Trükikoht ja trükkal (trükiste puhul) või arhiiviviited (käsikirjade puhul)
- Permalink link SPA-le

Kõik väljad HTML-escapitud (`html.escape()`).

**LinkedEntity label eraldamine:** `_metadata.json`-is on `location` ja `publisher` LinkedEntity objektid kujul `{"label": "Tartu", "id": "Q3258", ...}`. Sitemapis ja HTML-is kasutame ainult `label` välja.

### 2. `server/main.py` — `/sitemap.xml` endpoint

```
GET /sitemap.xml
```

- Loeb kõigi teoste `_metadata.json` failid (kasutab `build_work_id_cache()` tulemust)
- Filtreerib: ainult `is_work_public(meta)` → True (konservatiivne — `shareable`-only teosed ei leki)
- `<lastmod>` — `_metadata.json` faili `os.path.getmtime()`, ISO 8601 kuupäev
- Cache: in-memory, TTL 1h (`time.time()` põhjal)
- `Content-Type: application/xml`
- Tagastab standard sitemap XML:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://vutt.utlib.ut.ee/work/{work_id}</loc>
    <lastmod>2024-01-15</lastmod>
  </url>
  ...
</urlset>
```

### 3. nginx — `/sitemap.xml` proxy

Lisatakse üks `location` plokk serverile (`/etc/nginx/sites-available/vutt`):

```nginx
location = /sitemap.xml {
    proxy_pass http://backend:8002/sitemap.xml;
}
```

Asukoht: enne `location /` plokki. `/sitemap.xml` on robots.txt-s lubatud (pole `Disallow` all).

### 4. `public/robots.txt` — sitemap viide

Lõppu lisatakse:

```
Sitemap: https://vutt.utlib.ut.ee/sitemap.xml
```

Fail asub `public/robots.txt`, jõuab `dist/`-i `npm run build`-iga.

## Andmevoog

```
Googlebot GET /work/{id}
  → nginx: $is_bot=1
  → rewrite → /api/files/meta/work/{id}
  → proxy → backend:8002/meta/work/{id}
  → FastAPI: _load_work_metadata() + can_read_work(meta, None)
  → build_meta_html(): loeb _metadata.json, genereerib HTML
  → 200 HTML (canonical + OG + DC + COinS + body sisu)

Googlebot GET /sitemap.xml
  → nginx: location = /sitemap.xml
  → proxy → backend:8002/sitemap.xml
  → FastAPI: loeb kõik _metadata.json failid, filtreerib is_work_public()
  → 200 XML (kuni ~1264 URL-i)
```

## Ligipääsukontroll

- **Bot HTML endpoint** (`/meta/work/{id}`): `can_read_work(meta, None)` — piiratud teos tagastab 403
- **Sitemap**: `is_work_public(meta)` ainult — `shareable`-only piiratud teosed ei ilmu sitemapis

## Muudatuste ulatus

| Fail | Muudatus |
|------|----------|
| `server/metadata_handler.py` | `build_meta_html()` laiendus: canonical, DC, COinS, body |
| `server/main.py` | Uus `GET /sitemap.xml` endpoint + cache |
| `/etc/nginx/sites-available/vutt` (serveril) | 3 rida: `location = /sitemap.xml` plokk |
| `public/robots.txt` | 1 rida: `Sitemap:` viide |

## Ei muudeta

- nginx `$is_bot` kaart — juba sisaldab Googleboti
- `/work/` rewrite reegel — juba toimib
- `can_read_work()` / `is_work_public()` loogika — ei puututa
- Frontendi COinS (`generateCoins()`) — jääb muutmata
