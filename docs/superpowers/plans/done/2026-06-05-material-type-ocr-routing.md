# Materjali tüüp — OCR mudeli suunamine Implementation Plan

> **STAATUS: VALMIS** (implementeeritud, kuid erineb plaanist — vt märkus allpool)

**Goal:** Lisada upload viisardisse "Materjali tüüp" valik (trükis / käsikiri), mis suunab faili õigesse OCR alamkausta ja kasutab OCR serveris vastavat mudelit.

**Implementatsioonimärkus:** Plaanitud `material_type: "print" | "hand"` eraldi välja asemel kasutab tegelik implementatsioon metadata standardset `type` välja (Wikidata Q-kood). Käsikiri = `Q87167`, trükis = `Q1261026`. Backend tuletab OCR mudeli `type.id`-st — eraldi `material_type` välja ei lisatud.

**Architecture:** VUTT backend tuletab OCR mudeli `type.id == 'Q87167'` kontrollides ja kasutab seda remote path-is (`AUTO-OCR/print/` vs `AUTO-OCR/hand/`). OCR server jälgib mõlemat alamkausta eraldi, laadib mudeli laiskalt (unload → load) ainult tüübivahel, mitte iga töö juures. Käsikirja puhul on aasta valikuline.

**Tech Stack:** Python (FastAPI, upload_ops.py), TypeScript/React (Upload.tsx), i18n (react-i18next), PyTorch / unsloth (OCR server)

---

## Alasüsteem A: VUTT backend + frontend

### Task 1: Lisa `material_type` upload_ops.py-sse

**Files:**
- Modify: `server/upload_ops.py`
- Test: `tests/test_backend_smoke.py` (olemasolev fail, lisa sinna)

- [x] **Samm 1: Kirjuta katkev test**

Lisa `tests/test_backend_smoke.py` lõppu:

```python
def test_create_upload_material_type_print(backend_env):
    """Vaikimisi material_type on 'print', remote path sisaldab 'print/'."""
    upload_ops = backend_env["upload_ops"]
    state = upload_ops.create_upload({
        "title": "Test teos",
        "year": "1680",
        "slug": "test-teos",
        "material_type": "print",
    })
    assert state["meta"]["material_type"] == "print"
    assert "AUTO-OCR/print/" in state["remote_staging_path"]


def test_create_upload_material_type_hand(backend_env):
    """Käsikiri: material_type='hand', remote path sisaldab 'hand/'."""
    upload_ops = backend_env["upload_ops"]
    state = upload_ops.create_upload({
        "title": "Käsikirjaline materjal",
        "year": "",
        "slug": "kasikiri-test",
        "material_type": "hand",
    })
    assert state["meta"]["material_type"] == "hand"
    assert "AUTO-OCR/hand/" in state["remote_staging_path"]
    assert "AUTO-OCR/hand/" in state["remote_work_path"]


def test_create_upload_material_type_default(backend_env):
    """Kui material_type puudub, kasutatakse 'print' vaikeväärtust."""
    upload_ops = backend_env["upload_ops"]
    state = upload_ops.create_upload({
        "title": "Ilma tüübita teos",
        "year": "1700",
        "slug": "ilma-tyybita",
    })
    assert state["meta"]["material_type"] == "print"
    assert "AUTO-OCR/print/" in state["remote_staging_path"]
```

- [x] **Samm 2: Käivita test — veendu et kukub**

```bash
.venv/bin/python -m pytest tests/test_backend_smoke.py::test_create_upload_material_type_print -v
```

Oodatav: `FAILED` — `AssertionError` (remote_staging_path ei sisalda 'print/')

- [x] **Samm 3: Muuda `create_upload` funktsiooni**

`server/upload_ops.py`, `create_upload` funktsioon. Leia:
```python
    upload_id = generate_nanoid()
    while os.path.isdir(_upload_dir(upload_id)):
        upload_id = generate_nanoid()

    year = str(meta.get('year', ''))
    slug = meta.get('slug', sanitize_slug(meta.get('title', '')))
```

Lisa `material_type` lugemine ja kasuta seda path-ides:

```python
    upload_id = generate_nanoid()
    while os.path.isdir(_upload_dir(upload_id)):
        upload_id = generate_nanoid()

    year = str(meta.get('year', ''))
    slug = meta.get('slug', sanitize_slug(meta.get('title', '')))
    material_type = meta.get('material_type', 'print')
    if material_type not in ('print', 'hand'):
        material_type = 'print'
```

Leia `state` dict-is:
```python
        "remote_staging_path": f"AUTO-OCR/{upload_id}",
        "remote_work_path": f"AUTO-OCR/{upload_id}/{slug}",
```

Asenda:
```python
        "remote_staging_path": f"AUTO-OCR/{material_type}/{upload_id}",
        "remote_work_path": f"AUTO-OCR/{material_type}/{upload_id}/{slug}",
```

Lisa `material_type` ka `meta` dict-i (otsi `"tags": meta.get('tags', []),` rida ja lisa selle järele):
```python
            "tags": meta.get('tags', []),
            "material_type": material_type,
```

- [x] **Samm 4: Käivita testid — veendu et läbivad**

```bash
.venv/bin/python -m pytest tests/test_backend_smoke.py::test_create_upload_material_type_print tests/test_backend_smoke.py::test_create_upload_material_type_hand tests/test_backend_smoke.py::test_create_upload_material_type_default -v
```

Oodatav: kõik 3 `PASSED`

- [x] **Samm 5: Käivita kõik testid**

```bash
.venv/bin/python -m pytest tests/ -q
```

Oodatav: kõik läbivad (172+ passed)

- [x] **Samm 6: Commit**

```bash
git add server/upload_ops.py tests/test_backend_smoke.py
git commit -m "feat: lisa material_type upload_ops.py-sse — print/hand OCR suunamine"
```

---

### Task 2: Lisa i18n tõlked

**Files:**
- Modify: `src/locales/et/upload.json`
- Modify: `src/locales/en/upload.json`

- [x] **Samm 1: Lisa eestikeelsed tõlked**

`src/locales/et/upload.json`, `"step1"` bloki sisse (nt `"timeEstimate"` järele):

```json
    "materialTypeLabel": "Materjali tüüp",
    "materialTypePrint": "Trükitekst",
    "materialTypeHand": "Käsikiri",
    "materialTypeHandYearHint": "Käsikirjaliste materjalide puhul on dateering sageli umbkaudne või teadmata — aasta võib jätta tühjaks või sisestada vahemiku (nt 17. saj I pool).",
    "yearLabelOptional": "Aasta (valikuline)",
```

- [x] **Samm 2: Lisa ingliskeelsed tõlked**

`src/locales/en/upload.json`, `"step1"` bloki sisse:

```json
    "materialTypeLabel": "Material type",
    "materialTypePrint": "Printed text",
    "materialTypeHand": "Manuscript",
    "materialTypeHandYearHint": "For manuscripts, dating is often approximate or unknown — leave the year empty or enter a range (e.g. early 17th c.).",
    "yearLabelOptional": "Year (optional)",
```

- [x] **Samm 3: Commit**

```bash
git add src/locales/et/upload.json src/locales/en/upload.json
git commit -m "feat: lisa materialType i18n tõlked upload viisardile"
```

---

### Task 3: Lisa "Materjali tüüp" valik Upload.tsx viisardi 1. sammu

**Files:**
- Modify: `src/pages/Upload.tsx`

- [x] **Samm 1: Lisa `materialType` state ja uuenda `handleStep1Submit`**

Leia `Upload.tsx` sees `const [year, setYear] = useState('');` ja lisa selle kõrvale:

```tsx
  const [materialType, setMaterialType] = useState<'print' | 'hand'>('print');
```

Leia `handleStep1Submit` sees `if (!title.trim() || !year.trim() || !authToken) return;` ja asenda:

```tsx
    if (!title.trim() || !authToken) return;
    if (materialType === 'print' && !year.trim()) return;
```

Leia `body: JSON.stringify({` blokk `handleStep1Submit`-is ja lisa `material_type`:

```tsx
          body: JSON.stringify({
            title: title.trim(),
            year: year.trim(),
            slug: candidateSlug,
            collections: selectedCollection ? [selectedCollection] : [],
            replace_work_id: replaceWorkId || null,
            material_type: materialType,
          }),
```

- [x] **Samm 2: Lisa UI radio-valik ja tingimuslik aasta hint**

Leia step 1 JSX-is `yearLabel` / `yearPlaceholder` välja render. See tõenäoliselt näeb välja midagi sellist:

```tsx
<label ...>{t('step1.yearLabel')}</label>
<input ... value={year} onChange={...} />
```

Lisa sellele **enne** (enne aasta väljarakendust) Materjali tüüp radio:

```tsx
{/* Materjali tüüp */}
<div className="mb-4">
  <label className="block text-sm font-medium text-gray-700 mb-1">
    {t('step1.materialTypeLabel')}
  </label>
  <div className="flex gap-4">
    {(['print', 'hand'] as const).map((mt) => (
      <label key={mt} className="flex items-center gap-2 cursor-pointer">
        <input
          type="radio"
          name="materialType"
          value={mt}
          checked={materialType === mt}
          onChange={() => setMaterialType(mt)}
          className="accent-primary-600"
        />
        <span className="text-sm text-gray-700">
          {mt === 'print' ? t('step1.materialTypePrint') : t('step1.materialTypeHand')}
        </span>
      </label>
    ))}
  </div>
</div>
```

Leia aasta `<label>` element ja muuda dünaamiliseks:

```tsx
<label className="block text-sm font-medium text-gray-700 mb-1">
  {materialType === 'hand' ? t('step1.yearLabelOptional') : t('step1.yearLabel')}
</label>
```

Lisa käsikirja hint aasta välja alla (otsi `yearHint` transl. key):

```tsx
{materialType === 'hand' && (
  <p className="text-xs text-amber-700 bg-amber-50 rounded px-2 py-1 mt-1">
    {t('step1.materialTypeHandYearHint')}
  </p>
)}
```

- [x] **Samm 3: Uuenda slug genereerimist käsikirja jaoks**

Leia `useEffect` kus slug auto-genereeritakse (`setSlug(sanitizeSlug(...))`). Praegu:

```tsx
if (!slugManual) setSlug(sanitizeSlug((year ? year + '-' : '') + title));
```

See töötab juba — käsikirja puhul ilma aastata genereeritakse slug ainult pealkirjast.

- [x] **Samm 4: Uuenda `handleStep1Submit` valideering käsikirja puhul**

Leia ka `if (!title.trim() || !year.trim() || !slug.trim() ...)` või sarnane — veendu et ainult print nõuab aastat (samm 1 muudatus).

- [x] **Samm 5: Build**

```bash
npm run build 2>&1 | tail -5
```

Oodatav: `✓ built in X.XXs`

- [x] **Samm 6: Commit**

```bash
git add src/pages/Upload.tsx
git commit -m "feat: Materjali tüüp valik Upload viisardis — käsikiri vs trükis"
```

---

### Task 4: Deploy VUTT muudatused serverisse

**Files:** ei muutu

- [x] **Samm 1: Push**

```bash
git push origin main
```

- [x] **Samm 2: Deploy serverisse**

```bash
npm run build
rsync -avz dist/ vutt:~/VUTT/dist/
ssh vutt "cd ~/VUTT && git pull && docker compose build --no-cache backend && docker compose up -d backend"
```

- [x] **Samm 3: Kontrolli backend logid**

```bash
ssh vutt "docker logs vutt-backend --tail=20"
```

Oodatav: `VUTT FastAPI käivitus.` ilma errorita

---

## Alasüsteem B: OCR server

**NB:** OCR server asub eraldi masinas (`~/Dokumendid/LLM/qwen3.5/`), eraldi git repo (`meelisf/qwen-mudeli-treenimine`). Järgmised muudatused tehakse seal.

### Task 5: Loo alamkaustad ja laisk mudeli vahetus OCR serveris

**Files:**
- Modify: `kataloogi-jalgimine-ja-ocr.py`

- [x] **Samm 1: Uuenda seadistuse blokk (Sektsioon 1)**

Asenda:
```python
JALGITAV_KAUST = "/home/mf/Dokumendid/LLM/AUTO-OCR"

MODEL_PATH = "models/qwen3.5-ocr-lora"
```

Asendusega:
```python
BASE_OCR_KAUST = "/home/mf/Dokumendid/LLM/AUTO-OCR"

# Iga tüübi jaoks eraldi alamkaust ja mudel
MODEL_CONFIGS = {
    "print": "models/qwen3.5-ocr-lora",
    "hand":  "models/qwen3.5-ocr-hand-lora",
}

# Tagavarateekond kui alamkaust puudub — kasuta vana käitumist
LEGACY_KAUST = BASE_OCR_KAUST
```

- [x] **Samm 2: Asenda mudeli laadimise blokk laiska laadimisega (Sektsioon 2)**

Leia ja **kustuta** kogu plokk alates:
```python
logger.info(f"Laen mudelit: {MODEL_PATH} ...")
model, tokenizer = FastVisionModel.from_pretrained(
```
kuni:
```python
FastVisionModel.for_inference(model)
logger.info("Mudel laetud ja ootel.")
```

Asenda järgmisega:

```python
# Laisk mudeli haldus — laadime ainult kui vaja, vahetame tüübivahel
_current_model_type: str | None = None
model = None
tokenizer = None


def _setup_tokenizer(tok):
    """Seadistab tokenizeri — identne eelmine inline seadistusega."""
    tok.image_processor.size = {
        "longest_edge": 5_120_000,
        "shortest_edge": tok.image_processor.size.get("shortest_edge", 65536),
    }
    if tok.chat_template and "enable_thinking" in tok.chat_template:
        tok.chat_template = tok.chat_template.replace(
            "enable_thinking=True", "enable_thinking=False"
        )
    return tok


def ensure_model(model_type: str):
    """Laadib mudeli kui pole laetud või tüüp on muutunud."""
    global _current_model_type, model, tokenizer

    if _current_model_type == model_type:
        return  # Juba õige mudel

    if model is not None:
        logger.info(f"Vabastab mudeli '{_current_model_type}'...")
        del model
        del tokenizer
        model = None
        tokenizer = None
        gc.collect()
        torch.cuda.empty_cache()
        logger.info("Mudel vabastatud.")

    model_path = MODEL_CONFIGS[model_type]
    logger.info(f"Laen mudelit '{model_type}': {model_path} ...")
    m, tok = FastVisionModel.from_pretrained(
        model_name=model_path,
        load_in_4bit=True,
    )
    tok = _setup_tokenizer(tok)
    FastVisionModel.for_inference(m)
    model = m
    tokenizer = tok
    _current_model_type = model_type
    logger.info(f"Mudel '{model_type}' laetud.")
```

- [x] **Samm 3: Uuenda `get_chat_template` ja `CHAT_TEMPLATE`**

Leia:
```python
def get_chat_template():
    return tokenizer.apply_chat_template(
        ...
    )

CHAT_TEMPLATE = get_chat_template()
```

Asenda — `CHAT_TEMPLATE` peab olema dünaamiline (tokenizer vahetub):

```python
def get_chat_template():
    """Tagastab chat template praegu laetud tokenizeri jaoks."""
    return tokenizer.apply_chat_template(
        [{"role": "user", "content": [
            {"type": "text", "text": INSTRUCTION},
            {"type": "image"},
        ]}],
        add_generation_prompt=True, tokenize=False,
        enable_thinking=False,
    )
```

Eemalda `CHAT_TEMPLATE = get_chat_template()` — see on nüüd dünaamiline.

- [x] **Samm 4: Uuenda `process_batch` et kasutaks dünaamilist template'i**

Leia `process_batch` funktsioonist:
```python
    inputs = tokenizer(
        images_pil,
        [CHAT_TEMPLATE] * len(images_pil),
```

Asenda:
```python
    chat_template = get_chat_template()
    inputs = tokenizer(
        images_pil,
        [chat_template] * len(images_pil),
```

- [x] **Samm 5: Uuenda `main_loop` — kaks alamkausta, rühmitamine tüübi järgi**

Asenda kogu `main_loop` funktsioon:

```python
def main_loop():
    last_heartbeat = time.time()

    # Loo alamkaustad kui puuduvad
    for mt in MODEL_CONFIGS:
        Path(BASE_OCR_KAUST, mt).mkdir(parents=True, exist_ok=True)

    while not shutdown_requested:
        # 1. Paki lahti PDF-id mõlemas alamkaustas (ja legacy kaustas)
        scan_roots = [Path(BASE_OCR_KAUST, mt) for mt in MODEL_CONFIGS]
        # Toeta ka vana AUTO-OCR/ otse-struktuuri (üleminek)
        legacy = Path(LEGACY_KAUST)
        for scan_root in [*scan_roots, legacy]:
            for pdf in list(scan_root.rglob("*.pdf")):
                # Ära liigu alamkaustadest üles (legacy scan ei peaks sisenema print/hand)
                if scan_root == legacy and pdf.parts[len(legacy.parts)] in MODEL_CONFIGS:
                    continue
                if shutdown_requested:
                    break
                expand_pdf(pdf)

        # 2. Kogu töötlemata pildid tüübi järgi
        tasks_by_type: dict[str, list] = {mt: [] for mt in MODEL_CONFIGS}

        for mt, scan_root in [(mt, Path(BASE_OCR_KAUST, mt)) for mt in MODEL_CONFIGS]:
            candidates = natsorted(
                [f for f in scan_root.rglob("*")
                 if f.suffix.lower() in EXTENSIONS and f.is_file()],
                key=lambda x: str(x)
            )
            tasks_by_type[mt] = [
                (str(img), str(img.with_suffix(".txt")))
                for img in candidates
                if not img.with_suffix(".txt").exists()
            ]

        total = sum(len(v) for v in tasks_by_type.values())

        # 3. Töötle tüüp-tüübi kaupa (minimeerib mudeli vahetusi)
        if total > 0:
            logger.info(f"Leidsin {total} pilti ({', '.join(f'{mt}:{len(tasks_by_type[mt])}' for mt in MODEL_CONFIGS)}).")
            for mt, tasks in tasks_by_type.items():
                if not tasks or shutdown_requested:
                    continue
                ensure_model(mt)
                for i in range(0, len(tasks), BATCH_SIZE):
                    if shutdown_requested:
                        break
                    batch = tasks[i:i + BATCH_SIZE]
                    logger.info(f"[{mt}] Töötlen {i+1}–{min(i+BATCH_SIZE, len(tasks))} / {len(tasks)}")
                    process_batch(batch)
                    gc.collect()
            logger.info("Kõik hetke tööd tehtud. Ootan uusi...")
            last_heartbeat = time.time()
        else:
            if time.time() - last_heartbeat >= HEARTBEAT_INTERVAL:
                logger.info("Heartbeat: teenus töötab, ootan uusi faile...")
                last_heartbeat = time.time()

        time.sleep(5)

    logger.info("Teenus peatatud.")
```

- [x] **Samm 6: Eemalda algne startup-logi mis viitab `MODEL_PATH`-ile**

Leia:
```python
logger.info(f"Mudel: {MODEL_PATH}")
```

Asenda:
```python
logger.info(f"Mudelid: {MODEL_CONFIGS}")
```

- [x] **Samm 7: Testi käsitsi — käivita teenus ja vaata logid**

```bash
# Peata teenus
sudo systemctl stop ocr-service

# Testi käsitsi (ctrl+C lõpetamiseks)
cd ~/Dokumendid/LLM/qwen3.5
venv/bin/python kataloogi-jalgimine-ja-ocr.py
```

Oodatav logi:
```
=== Käivitan In-Place OCR Teenuse (Qwen3.5-9B) ===
Mudelid: {'print': 'models/qwen3.5-ocr-lora', 'hand': 'models/qwen3.5-ocr-hand-lora'}
Heartbeat: teenus töötab, ootan uusi faile...
```

Teenus ei pea kohe mudelit laadima — see toimub esimesel tööl.

- [x] **Samm 8: Testi mudeli laadimist**

Kopeeri üks testpilt `AUTO-OCR/print/test-upload/test_pg_001.jpg` ja vaata logis:

```
Leidsin 1 pilti (print:1, hand:0).
Laen mudelit 'print': models/qwen3.5-ocr-lora ...
Mudel 'print' laetud.
[print] Töötlen 1–1 / 1
Transkribeeritud: test_pg_001.txt
```

- [x] **Samm 9: Taaskäivita teenus**

```bash
sudo systemctl start ocr-service
sudo systemctl status ocr-service
```

- [x] **Samm 10: Commit ja push (qwen repo)**

```bash
git add kataloogi-jalgimine-ja-ocr.py
git commit -m "feat: kaks OCR alamkausta (print/hand), laisk mudeli vahetus"
git push
```

---

## Spec coverage check

| Nõue | Task |
|------|------|
| Upload viisardi "Materjali tüüp" valik | Task 3 |
| Trükis → `AUTO-OCR/print/`, Käsikiri → `AUTO-OCR/hand/` | Task 1 |
| `material_type` state.json-is | Task 1 |
| Käsikiri: aasta valikuline | Task 3 |
| Käsikiri: umbkaudse dateeringu hint | Task 2 + 3 |
| OCR server: kaks alamkausta | Task 5 |
| OCR server: laisk mudeli vahetus (ei laadi mõlemat korraga) | Task 5 |
| Deploy | Task 4 |
