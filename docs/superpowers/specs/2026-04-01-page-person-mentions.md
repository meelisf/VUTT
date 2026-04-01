# Spetsifikatsioon: Lehekülje tasandi isikuviited prosopograafias

Kuupäev: 2026-04-01

## Probleem

Editorid saavad lisada lehekülje tägidesse isikuid, kuid:
1. `EntityPicker` kasutab `type="topic"` — lokaalseid `vutt:P` isikuid ei saa valida
2. `vutt:P` tägid ei kuvata lingina `/persons/` lehele
3. `/save` endpoint ei kutsu `update_person_to_works` — lehekülje isikuviited ei jõua prosopograafiasse

## Lahendus

Lisa uus roll `"mentioned"` (et: "Mainitud") `person_to_works.json`-i. Üks isik võib esineda samas teoses mitmes rollis:
```json
"vutt:Pabc": [
  {"work_id": "xyz", "role": "subject"},
  {"work_id": "xyz", "role": "mentioned"}
]
```

## Muutused

### 1. Backend — uus funktsioon `update_page_person_mentions`

**Fail:** `server/prosopography/ops.py`

Uus funktsioon loeb kõik teose lehekülje `.json` failid, kogub `page_tags` kirjed millel `id.startswith("vutt:P")`, ja uuendab ainult `"mentioned"` rolle `person_to_works`-is. Töötab `_works_lock` all, kirjutab `atomic_write_json`-ga.

```python
def update_page_person_mentions(work_id: str, work_dir: str):
    """Uuendab person_to_works 'mentioned' rolle antud teose lehekülje page_tags põhjal."""
    person_ids: set[str] = set()
    try:
        for fname in os.listdir(work_dir):
            if not fname.endswith('.json') or fname == '_metadata.json':
                continue
            fpath = os.path.join(work_dir, fname)
            with open(fpath, 'r', encoding='utf-8') as f:
                page = json.load(f)
            source = page.get('meta_content', page)
            for tag in source.get('page_tags', []):
                if isinstance(tag, dict):
                    pid = tag.get('id') or ''
                    if pid.startswith('vutt:P'):
                        person_ids.add(pid)
    except Exception as e:
        print(f"update_page_person_mentions viga: {e}")
        return

    with _works_lock:
        data = _load_person_to_works()
        # Eemalda kõik "mentioned" viited sellele teosele
        for pid_entries in data.values():
            pid_entries[:] = [e for e in pid_entries if not (e.get('work_id') == work_id and e.get('role') == 'mentioned')]
        # Lisa uued
        for pid in person_ids:
            if pid not in data:
                data[pid] = []
            data[pid].append({'work_id': work_id, 'role': 'mentioned'})
        atomic_write_json(PERSON_TO_WORKS_FILE, data)
```

### 2. Backend — `/save` endpoint

**Fail:** `server/main.py`

Pärast lehe salvestamist lisa async background task:
```python
from .prosopography.ops import update_page_person_mentions

# /save endpointis, pärast save_with_git():
background_tasks.add_task(update_page_person_mentions, work_id, work_dir)
```

`work_id` saadakse lehekülge JSON-i `meta_content.work_id` väljalt.
`work_dir` = `os.path.dirname(json_path)`.

### 3. Backend — `rebuild_indices`

**Fail:** `server/prosopography/ops.py`

`rebuild_indices` funktsioon peab pärast töö-tasandi andmete agregeerimist kutsuma `update_page_person_mentions` iga teose kohta. Kõige lihtsam: pärast `person_to_works.json` kirjutamist, käi üle kõik teoste kaustad ja kutsu `update_page_person_mentions` iga `work_id` kohta.

Alternatiiv: integreeri otse `rebuild_indices` tsüklisse — kõige efektiivsem, sest kaustad on juba iteratsioonis:
```python
# rebuild_indices tsüklis, kus juba loetakse meta:
for work_entry in os.scandir(_DATA_DIR):
    # ... olemasolev creators/tags/publisher aggregeerimine ...
    # Lisa ka page_tags:
    for fname in os.listdir(work_entry.path):
        if fname.endswith('.json') and fname != '_metadata.json':
            page = json.load(open(...))
            source = page.get('meta_content', page)
            for tag in source.get('page_tags', []):
                if isinstance(tag, dict) and (tag.get('id') or '').startswith('vutt:P'):
                    ptw.setdefault(tag['id'], []).append({'work_id': work_id, 'role': 'mentioned'})
```

### 4. Frontend — EntityPicker isiku-toggle

**Fail:** `src/components/editor/AnnotationsTab.tsx`

Muuda EntityPicker kutset (rida ~576):
```tsx
<EntityPicker
  type="topic"
  showPersonToggle={true}   // ← lisa
  authToken={authToken}     // ← lisa
  value={null}
  onChange={(val) => { ... }}
  placeholder={t('workspace:metadata.tagsPlaceholder')}
  lang={lang}
  localSuggestions={mergedTagSuggestions}
/>
```

### 5. Frontend — page_tags kuvamine

**Fail:** `src/components/editor/AnnotationsTab.tsx`

Lehekülje tägide kuvamisel (rida ~533-570): kui `tag.id?.startsWith('vutt:P')` → rendi nagu teose isiku-tägid (Link `/persons/${tag.id}`, User ikoon, sinine pill). Kui mitte — jätab senise kuvamise muutmata.

```tsx
const isPersonTag = typeof tag !== 'string' && (tag as any).id?.startsWith('vutt:P');
// isPersonTag → <Link to={`/persons/${(tag as any).id}`} ...>
```

### 6. Tõlked

**Failid:** `src/locales/et/workspace.json` ja `src/locales/en/workspace.json`

Lisa `metadata.roles` sektsiooni:
- et: `"mentioned": "Mainitud"`
- en: `"mentioned": "Mentioned"`

`PersonDetailPage` kasutab `t('workspace:metadata.roles.mentioned', { defaultValue: 'mentioned' })` — tõlge ilmub automaatselt rollide filtris ja teose kaartidel.

## Andmevoog

```
Editor lisab page_tag (vutt:P isik)
  → EntityPicker tagastab LinkedEntity {id: "vutt:Pxxx", label: "...", entity_type: "person"}
  → AnnotationsTab lisab page_tags listi
  → Kasutaja salvestab → /save endpoint
  → page .json kirjutatakse (page_tags sees)
  → Meilisearch sync (juba toimub)
  → update_page_person_mentions() taustal
     → loeb kõik teose lehekülje .json failid
     → uuendab person_to_works["vutt:Pxxx"] += {work_id, role: "mentioned"}
  → PersonDetailPage näitab isikut töö juures rolliga "Mainitud"
```

## Veatöötlus

- `update_page_person_mentions` viga: logitakse `print()`, ei peata salvestust
- `work_id` puudub `meta_content`-is: funktsioon ei tee midagi (varajane return)
- Lehekülje .json loendusviga: üksiku faili viga logistatakse, ülejäänud töödeldakse

## Testimine

1. Lisa leheküljelekuva tägisse `vutt:P` isik → salvesta → kontrolli `person_to_works.json` serveril
2. Eemalda isiku tag lehelt → salvesta → kontrolli et "mentioned" kirje eemaldatakse
3. Sama isik on nii teose `tags` (subject) kui lehe `page_tags` (mentioned) → mõlemad rollid on kirjes
4. `rebuild_indices` käivitamine → "mentioned" rollid taastutatakse
5. PersonDetailPage → isiku juures kuvatakse "Mainitud" rolliga teos
