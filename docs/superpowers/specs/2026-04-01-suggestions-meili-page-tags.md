# Spetsifikatsioon: page_tags suggestions Meilisearchist

Kuupäev: 2026-04-01

## Probleem

`_build_suggestions()` (`server/cache.py`) skännib iga 5 minuti tagant ~20 000 lehekülje `.json` faili, et koguda `page_tags` suggestions-i. Leheküljed on tägidega kaetud hõredalt, seega saadav infohulk on väike võrreldes I/O kuluga.

`page_tags` on juba Meilisearchis indekseeritud kujul `page_tags_suggest_et` ja `page_tags_suggest_en` väljadena, formaadis `"label|||Q-kood"`. See lubab lehekülje-skänni asendada ühe facets-päringuga.

## Muutuse ulatus

Muudetakse ainult `server/cache.py` faili — üks funktsioon (`_build_suggestions`). Meilisearchi skeem, frontend ja kõik teised komponendid jäävad puutumata.

## Disain

### Eemaldatav kood

`_build_suggestions()` sisemise tsükli osa, mis loeb lehekülje `.json` faile:

```python
# EEMALDATAKSE:
for page_file in os.scandir(entry.path):
    if page_file.name.endswith('.json') and page_file.name != '_metadata.json':
        page_data = json.load(...)
        for pt in source.get('page_tags', ...): add_item(tags, pt, 'tags')
```

### Asendus

Pärast välimise `for entry in os.scandir(BASE_DIR)` tsükli lõppu lisatakse üks Meilisearchi päring:

```python
# page_tags Meilisearchist (asendab leheküljefailide skänni)
try:
    facet_field = f"page_tags_suggest_{preferred_lang}"
    url = f"{MEILI_URL}/indexes/{INDEX_NAME}/search"
    body = json.dumps({"q": "", "limit": 0, "facets": [facet_field]}).encode()
    req = urllib.request.Request(url, data=body, method='POST')
    req.add_header('Content-Type', 'application/json')
    req.add_header('Authorization', f'Bearer {MEILI_KEY}')
    with urllib.request.urlopen(req, timeout=5) as resp:
        result = json.loads(resp.read())
    facet_dist = result.get('facetDistribution', {}).get(facet_field, {})
    for entry_str in facet_dist:
        label, _, id_code = entry_str.partition('|||')
        label = label.strip()
        if label:
            add_item(tags, {'label': label, 'id': id_code or None}, 'tags')
except Exception as e:
    logger.warning(f"page_tags suggestions Meilisearchist ebaõnnestus: {e}")
    # Metadata-taseme tägid jäävad alles, page_tags jäävad lihtsalt tühjaks
```

### Impordid

`server/cache.py` praegu importib `.config`-ist ainult `BASE_DIR, COLLECTIONS_FILE, VOCABULARIES_FILE`. Lisatakse:

```python
import urllib.request  # uus
from .config import BASE_DIR, COLLECTIONS_FILE, VOCABULARIES_FILE, MEILI_URL, MEILI_KEY, INDEX_NAME  # täiendatakse
```

## Veatöötlus

- Kui Meilisearch ei vasta (timeout, võrgu viga, vale võti): `page_tags` jäävad lihtsalt tühjaks, metadata-taseme tägid on endiselt olemas. Hoiatus logitakse.
- Ei visata erandit ülespoole — suggestions-i ehitus ei tohi kukkuda Meilisearchi kättesaamatuse tõttu.

## Mõju

| | Enne | Pärast |
|--|------|--------|
| Failisüsteemi lugemisi / cache rebuild | ~21 300 | ~1300 |
| Meilisearchi päringuid / cache rebuild | 0 | 1 |
| Cache TTL | 300s | 300s (muutmata) |
| Tagastusstruktuur | `{authors, tags, places, printers, types, genres}` | sama |

## Testimine

1. Käivita server lokaalses arenduskeskkonnas (või serveril)
2. `POST /get-metadata-suggestions` koos `{"lang": "et"}` ja editor tokeniga
3. Kontrolli, et `tags` sisaldab nii metadata-taseme tage kui page_tags-e
4. Kontrolli logist, et leheküljefailide skänni enam ei toimu
5. Testi Meilisearchi kättesaamatuse stsenaarium: lülita Meilisearch ajutiselt välja → suggestions peaks endiselt tagastama (ilma page_tags-ita)
