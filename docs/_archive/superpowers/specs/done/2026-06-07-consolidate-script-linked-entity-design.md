# Spetsifikatsioon: `1-1_consolidate_data.py` LinkedEntity konsolideerimine

Kuupäev: 2026-06-07

## Kontekst

`scripts/1-1_consolidate_data.py` sisaldab 7 LinkedEntity abifunktsiooni (read 203–330), mis on koopiad `server/utils.py`-st. Need funktsioonid on algselt copy-paste teel tekkinud ja on nüüd lahknenud: skripti `get_labels_by_lang` ei võta `labels_store` argumenti ega kasuta `data/config/labels.json` kanooniliste siltide registrit. Selle tulemusel võib Meilisearchi indekseerimise käigus (skript) kirjutada erineva sildi kui runtime'is (server) — eriti siis, kui `labels.json` registris on Q-koodile uuem kanooniline silt.

## Eesmärk

- Eemaldada ~130 rida duplikaatkoodi skriptist
- Tagada, et indekseerimine kasutab sama `labels_store` loogikat mis server runtime
- Skripti käitumine ei muutu muus osas

## Muudatused

### 1. Projekti juurkausta lisamine sys.path-i ja import

`scripts/1-1_consolidate_data.py` faili algusesse (pärast stdlib-importide blokki):

```python
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from server.utils import (
    capitalize_first, get_label, get_id, get_all_labels,
    get_primary_labels, get_labels_by_lang, get_all_ids
)
```

`server/config.py` kasutab ainult stdlib-i, seega import ei too kaasa raskeid sõltuvusi.

### 2. `labels.json` laadimine

Konstantide blokki lisatakse:

```python
LABELS_FILE = os.path.join(CONFIG_DIR, 'labels.json')
```

`main()` funktsioonis laaditakse `labels_store` koos teiste konfifailidega:

```python
labels_store = {}
if os.path.exists(LABELS_FILE):
    with open(LABELS_FILE, 'r', encoding='utf-8') as f:
        labels_store = json.load(f)
```

Ebaõnnestumine on vaikne (tühi dict) — sama käitumine mis `server/meilisearch_ops.py:load_labels_store()`.

### 3. `get_labels_by_lang` väljakutsed uuendatakse

8 kohta saavad `labels_store` argumendi:

| Rida | Väli |
|------|------|
| 576 | `type_et` |
| 577 | `type_en` |
| 582 | `genre_et` |
| 583 | `genre_en` |
| 605 | `tags_et` |
| 606 | `tags_en` |
| 622 | `page_tags_et` |
| 623 | `page_tags_en` |

### 4. Duplikaatfunktsioonid eemaldatakse

Read 203–330 (7 funktsiooni: `capitalize_first`, `get_label`, `get_id`, `get_all_labels`, `get_primary_labels`, `get_labels_by_lang`, `get_all_ids`) kustutatakse.

## Testid

`tests/test_consolidate_data.py` jääb muutmata juhul, kui see impordib funktsioonid skriptist — need on mooduli nimeruumis kättesaadavad ka pärast muudatust (Python paneb imporditud nimed mooduli nimeruumi). Kui testid defineerivad ise LinkedEntity objekte, piisab testide käivitamisest ilma muudatusteta.

Käivitamine: `.venv/bin/python -m pytest tests/test_consolidate_data.py -v`

## Serveris deploy

Pärast muudatuse merge'imist:

```bash
ssh vutt
cd ~/VUTT
git pull
./scripts/server_seed_data.sh   # käivitab 1-1 + laeb Meilisearchi
```

## Väljaspool skoopi

- `server/utils.py` ei muutu
- Frontend label fallback (`labelUtils.ts`, `metadataUtils.ts`) jääb eraldi ülesandeks
- Muud skriptid, mis võivad samuti LinkedEntity funktsioone dubleerida, jäävad käesoleva muudatuse väljapoole
