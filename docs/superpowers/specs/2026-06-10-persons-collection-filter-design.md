# Isikute lehe (`/persons`) kollektsioonifilter

**Kuupäev:** 2026-06-10
**Staatus:** Kinnitatud

## Taust

`https://vutt.utlib.ut.ee/persons` (`PersonsPage`) ei reageeri praegu päise
kollektsioonivalikule — kuvab alati kõiki isikuid, sõltumata sellest, milline
kollektsioon on `CollectionContext`-is valitud. Dashboard, otsing jt lehed
arvestavad valitud kollektsiooniga (`collections_hierarchy = "X"`), aga
isikute leht mitte.

## Eesmärk

Kui päises on valitud kollektsioon, näitab `/persons` ainult neid isikuid, kes
**esinevad vähemalt ühes selle kollektsiooni (või alamkollektsiooni) teoses**
mõnes rollis:

- **autor** (`creator`)
- **kirjastaja** (`publisher`)
- **teose märksõna** (`subject` — teose `tags[]` isikuviide)
- **lehekülje märksõna** (`mentioned` — lehekülje `page_tags` isikuviide)

Kõik neli rolli on juba `person_to_works.json`-is olemas.

Nii **isikute nimekiri** kui ka **külgriba facet-loendurid** (päritolugrupp,
haridusasutus jne) arvestavad valitud kollektsiooniga.

Kui kollektsioon pole valitud → senine käitumine (kõik isikud).

---

## Sektsioon 1: Andmemudel — uus indeks `work_collections_index.json`

Uus püsiv read-model fail kõrvuti olemasolevatega (`person_to_works.json`,
`works_creators_index.json`):

| Fail | Asukoht | Sisu |
|------|---------|------|
| `work_collections_index.json` | `data/config/` | `work_id → [teose enda kollektsiooni-id-d]` |

**Oluline:** salvestatakse teose **enda** kollektsioonid (`meta.collections`),
**mitte** esivanematega laiendatud hierarhia. Hierarhia laiendamine
(esivanemad/järglased) toimub päringuajal `get_cached_collections()` põhjal.
Nii jääb indeks korrektseks ka siis, kui keegi muudab kollektsioonide
**hierarhiat** (paigutab kollektsiooni ümber teise vanema alla) ühtegi teost
puutumata.

Struktuur:
```json
{
  "abc123nanoid": ["academia-gustaviana"],
  "def456nanoid": ["academia-gustaviana", "dissertatsioonid"]
}
```

Config-konstant (`server/config.py`):
```python
WORK_COLLECTIONS_INDEX_FILE = os.path.join(_DATA_CONFIG_DIR, "work_collections_index.json")
```

---

## Sektsioon 2: Indeksi haldus

### 2.1 Ehitamine (`rebuild_indices()`)

`rebuild_indices()` juba itereerib kõiki teosekaustu ja loeb iga
`_metadata.json`-i (`person_to_works` ja `works_creators_index` ehitamiseks).
Lisame samasse läbikäigusse `work_collections` kogumise — **uut skannimist ei
teki**. 1273+ teose täisläbikäik toimub ainult serveri stardil / käsitsi
taastamisel, nagu tänagi.

```python
wc: dict[str, list] = {}
# ... olemasolevas teoste läbikäigus:
wc[work_id] = meta.get("collections") or []
# ...
atomic_write_json(WORK_COLLECTIONS_INDEX_FILE, wc)
```

### 2.2 Inkrementaalne uuendus (`update_work_collections`)

Uus funktsioon `server/prosopography/ops.py`-s, mis kirjutab ümber ühe kirje:

```python
def update_work_collections(work_id: str, collections: list) -> None:
    """Uuendab work_collections_index.json üht kirjet teose salvestamisel."""
    with _work_collections_lock:
        data = _load_work_collections()
        if collections:
            data[work_id] = list(collections)
        else:
            data.pop(work_id, None)
        atomic_write_json(WORK_COLLECTIONS_INDEX_FILE, data)
```

Uus `threading.Lock()` (`_work_collections_lock`) ja loader
`_load_work_collections()` olemasolevate mustrite eeskujul.

### 2.3 Kutsumiskohad

**KRIITILINE:** `update_work_collections` peab jooksma **tingimusteta**
(mitte `call_ptw` taga). Kollektsioonimuudatused toimuvad just nimelt
bulk-collection teel, kus `call_ptw=False` (vt `metadata_ops.py:130`). Kui
gateida selle taha, jääks indeks bulk-collection muudatustel uuendamata
(drift).

| Koht | Tegevus |
|------|---------|
| `metadata_ops.py` `save_work_metadata` | Lisa tingimusteta kutse pärast salvestamist (nii sync kui background_tasks variant) |
| `upload_ops.py` import (`import_as_work`) | Lisa kutse teose loomisel (kus juba `update_person_to_works`) |
| Teose kustutamine | Eemalda kirje (kui kustutusteel pole juba indeksipuhastust, lisa `update_work_collections(work_id, [])`) |

`background_tasks` korral lisatakse taustaülesandena, vastasel juhul sünkroonselt
(sama muster nagu `update_person_to_works`).

---

## Sektsioon 3: Päring — `_persons_in_collection`

Uus abifunktsioon `server/prosopography/ops.py`-s:

```python
def _collection_descendants(collection_id: str, collections: dict) -> set[str]:
    """Tagastab {collection_id} ∪ kõik järglased (rekursiivselt)."""
    target = {collection_id}
    changed = True
    while changed:
        changed = False
        for cid, col in collections.items():
            if col.get("parent") in target and cid not in target:
                target.add(cid)
                changed = True
    return target


def _persons_in_collection(collection_id: str) -> set[str]:
    """Isikute id-d, kes esinevad mõnes selle kollektsiooni (või
    alamkollektsiooni) teoses ükskõik mis rollis."""
    from ..cache import get_cached_collections
    collections = get_cached_collections() or {}
    target = _collection_descendants(collection_id, collections)
    wc = _load_work_collections()
    ptw = _load_person_to_works()
    return {
        pid for pid, entries in ptw.items()
        if any(target & set(wc.get(e["work_id"], ())) for e in entries)
    }
```

`target` (valitud kollektsioon + järglased) arvutatakse üks kord päringu kohta
mälusisesest (TTL-cache'itud) konfist. Iga teose **enda** kollektsioonide
ristumine `target`-iga annab sama "vanemkollektsioon hõlmab alamkollektsiooni
teoseid" käitumise nagu `collections_hierarchy = "X"` mujal.

Kulud: päringu kohta üks faililaadimine (`work_collections`), üks
(`person_to_works`) ja üks konfi-läbikäik. Mitte midagi ei skanni teoste kaupa.

---

## Sektsioon 4: Wiring läbi kihtide

### 4.1 `list_persons` ja `get_person_facets` (`ops.py`)

Mõlemale lisada `collection: Optional[str] = None`. Kui antud:

```python
collection_ids = _persons_in_collection(collection)
# ristu olemasoleva ids-filtriga (tavaliselt None)
if ids is not None:
    ids = [i for i in ids if i in collection_ids]
else:
    ids = list(collection_ids)
```

`get_person_facets` annab `collection` edasi `list_persons`-ile (millest ta
loendurid tuletab) — nii jäävad facet-loendurid automaatselt järjepidevaks.

### 4.2 Router (`server/prosopography/router.py`)

Persons-listingu ja facets-endpointid loevad `collection` query-parameetri ja
annavad edasi `list_persons` / `get_person_facets`-ile.

### 4.3 Frontend service (`src/prosopography/services/prosopographyService.ts`)

`listPersons` ja `getPersonFacets` saadavad `collection` parameetri (kui antud).

### 4.4 `PersonsPage.tsx`

- Loe `selectedCollection` `useCollection()`-ist.
- Anna `selectedCollection || undefined` edasi `listPersons` ja
  `getPersonFacets` kutsetes.
- Lisa `selectedCollection` `fetchPersons` ja `fetchFacets` `useCallback`
  sõltuvuste massiividesse → nimekiri ja loendurid värskenevad automaatselt,
  kui päise valik muutub (sama muster nagu Dashboard). Eraldi UI-elementi ei
  lisata.

Kaardivaade (`view=map`) saab sama skoobi tasuta, kuna markerid tulevad samast
indeksist.

---

## Sektsioon 5: Veapiirid

- **Kollektsioon valimata** → `collection` parameeter jäetakse ära → senine
  käitumine (kõik isikud).
- **Valitud kollektsioonis pole ühtegi isikut** → tühi nimekiri + olemasolev
  tühja-oleku kuva.
- **Kustutatud teos** indeksis → `person_to_works` ei viita pärast oma uuendust
  enam sellele; jääk-kirje on kahjutu, `rebuild_indices` puhastab.
- **Hierarhia muudatus** (kollektsiooni ümberpaigutus) → kajastub kohe, kuna
  järglased arvutatakse päringuajal cache'itud konfist.

---

## Sektsioon 6: Testid

Üksuse testid `_persons_in_collection` jaoks:

1. Ainult autori-seosega isik kollektsiooni teoses → kaasatud.
2. Ainult lehekülje-mainimise (`mentioned`) seosega isik → kaasatud.
3. Kirjastaja (`publisher`) seosega isik → kaasatud.
4. Alamkollektsiooni pärimine: teos alamkollektsioonis C, valitud vanem P →
   isik kuvatakse P all.
5. Ilma teosteta isik → välistatud.
6. Isik teises kollektsioonis → välistatud antud kollektsiooni puhul.

Lisaks `update_work_collections` test: bulk-collection muudatus
(`call_ptw=False`) uuendab indeksit.
