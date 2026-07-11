# Spec: teose nanoid katalooginimes

**Kuupäev:** 2026-06-15
**Staatus:** kinnitatud, ootab implementatsiooniplaani

## Probleem

Teose kaust on praegu alati `data/{slug}/`. `work_id` (nanoid) on igas **failinimes**
(`{slug}-{work_id}-{lk}.jpg`), aga **kausta nimes mitte**. Aastata käsikirjad
(nt `adam-koljo-kirja-tolge/`) saavad seetõttu lihtsa pealkirja-põhise kaustanime ilma
unikaalse identifikaatorita ja on kalduvad nimekonfliktidele (`kirjad/`, `eesti-naiste-kirjad/`).

Praegune konfliktilahendus lisab juhusliku 4-tähelise sufiksi (`eesti-naiste-kirjad-ks6h/`),
mis ei ole teose `work_id`, vaid eraldi juhuslik string.

## Eesmärk

Iga **uue** üleslaadimise kaust saab kuju `{slug}-{work_id}`, kus `work_id` on teose
kanooniline nanoid (`_metadata.json` `id` väli). See annab unikaalse, jälgitava kaustanime
ja kaotab vajaduse juhu-sufiksite järele.

## Skoop

- **Millised teosed:** kõik uued üleslaadimised (mitte ainult aastata teosed).
- **Olemasolevad kaustad:** jäävad puutumata. Lookup käib `work_id` järgi, seega vanad
  kaustad töötavad edasi.
- **Olemasolevate migreerimist EI tehta** selles töös.

## Miks see ohutu on

Teosed leitakse `find_directory_by_id()` kaudu `_metadata.json` `id` (nanoid) järgi, mitte
kausta nime järgi (`server/utils.py:188`). Tee rekonstrueerimine bare slug'ist puudub:

- `reocr_ops` saab `slug = os.path.basename(path)` reaalsest kaustast (`server/main.py:1419`).
- Thumbnailid on glob/scan-põhised (`server/image_server.py`), mitte slug'ist rekonstrueeritud.
- Lehekülgede `original_path`/`file_name` ei kirjutata impordil ega loeta meili/consolidate
  poolt — leheküljed avastatakse kataloogiskanniga.

Invariant **`metadata.slug === kausta basename`** kehtib täna (mõlemad = `slug`) ja säilitatakse
(mõlemad = `{slug}-{work_id}`). `work_id` tähestik on `a-z0-9` (`server/utils.py:65`), seega
`{slug}-{work_id}` on ise kehtiv saniteeritud slug.

## Lähenemine

`work_id` genereeritakse **kohe `create_upload`-is** ja küpsetatakse slug'i sisse. Edasine
import-protsess jääb sisuliselt samaks — slug kannab `work_id`'d algusest peale. Tulemus:
failinimed on **identsed** tänasega, muutub ainult kausta nimi ja `metadata.slug` väärtus.

## Muudatused

### 1. `create_upload` (`server/upload_ops.py`)

Genereeri `work_id` ja lisa see slug'i. Salvesta nii `meta.slug` kui ka `meta.work_id`.

```python
work_id = generate_nanoid()
base = sanitize_slug(meta.get('slug') or meta.get('title', ''))
slug = f"{base}-{work_id}"          # nt "adam-koljo-kirja-tolge-pcdm0f"
# state["meta"]["slug"] = slug
# state["meta"]["work_id"] = work_id
```

`remote_work_path` jms kasutavad seda slug'i edasi muutmatult.

### 2. `/admin/upload/create` endpoint (`server/main.py:1313`)

Eemalda `check_slug_conflict` kutse. Kuna `data/{base}-{work_id}/` on `work_id` tõttu alati
unikaalne, on kontroll tarbetu ja tekitaks koledaid topelt-sufikseid (`kirjad-xyz1-{work_id}`),
kui `data/kirjad/` juba olemas. Eemaldamine kõrvaldab ka tarbetu paralleeluploadi-valve
(kaks paralleelset "kirjad" uploadi saavad eri `work_id`'d → eri slug'id → konflikti pole).

`check_slug_conflict` funktsioon ise jääb alles (ainus kutsuja oli see endpoint; eemalda
import kui kasutuks jääb).

### 3. `import_as_work` (`server/upload_ops.py`)

Kasuta `create_upload`-is genereeritud `work_id`'d (ära genereeri uut). Tahapoole-ühilduvus
enne deploy't loodud pooleliolevate uploadide jaoks (kus `meta.work_id` puudub) tuleb tasuta
sama `_page_base_name` abifunktsiooni `endswith`-loogikast:

```python
work_id = meta.get('work_id') or generate_nanoid()
base_name = _page_base_name(slug, work_id, pn)
metadata["id"] = work_id
```

- Uus upload: `meta.work_id` olemas, `slug` lõpeb `-{work_id}`-iga → `{slug}-{pn:03d}`.
- Vana pooleliolev upload: `work_id` genereeritakse, `slug` ei lõpe sellega → `{slug}-{work_id}-{pn:03d}`.

Read `metadata["slug"] = slug` ja `commit_new_work_to_git(slug, ...)` jäävad **muutmata** —
slug kannab juba `work_id`'d. Uue uploadi failinimed jäävad **identseks** tänasega
(`{base}-{work_id}-{lk}`).

### 4. `replace_work` (`server/upload_ops.py:1277`)

Toeta mõlemat konventsiooni. `slug = os.path.basename(work_dir)`, `work_id = existing_meta["id"]`:

```python
base_name = f"{slug}-{pn:03d}" if slug.endswith(f"-{work_id}") else f"{slug}-{work_id}-{pn:03d}"
```

Vanad kaustad (`data/kirjad/`) → `{slug}-{work_id}-{lk}` (vana muster).
Uued kaustad (`data/kirjad-ab12cd/`) → `{slug}-{lk}` (work_id juba slug'is).

### 5. Frontend (`src/pages/Upload.tsx`)

Pärast edukat `create`'i loe tagasi `d.upload.meta.slug` ja `setSlug(...)` reaalse kaustanime
kuvamiseks (samm 2). Live-vihje sammus 1 (`data/{slug}/`) näitab base-slug'i, kuna `work_id`
pole enne backendi vastust teada — kosmeetiline.

Juhu-sufiksi retry-loop (`Upload.tsx:399-432`) muutub surnud haruks (backend ei tagasta enam
409 `conflict`). Võib jätta alles (kahjutu) või lihtsustada üheks POST-iks.

## Testid

- **`create_upload` lisab work_id:** `meta.slug` lõpeb `-{6 märgilise nanoid}`-iga,
  `meta.work_id` on seatud ja `slug == base + "-" + work_id`.
- **`sanitize_slug` idempotentsus** säilib (olemasolev test `test_sanitize_slug_idempotent`).
- **`base_name` loogika** eraldatakse väikseks puhtaks abifunktsiooniks (nt
  `_page_base_name(slug, work_id, pn)`), mida testitakse mõlema konventsiooni jaoks:
  - uus (`slug` lõpeb `-{work_id}`) → `{slug}-{pn}`
  - vana (`slug` ei lõpe `-{work_id}`) → `{slug}-{work_id}-{pn}`
  Seda abifunktsiooni kasutavad nii `import_as_work` kui `replace_work`.

`import_as_work`/`replace_work` täielik test nõuab SFTP-d ja jääb skoobist välja; testitav
loogika on eraldatud abifunktsiooni.

## Mitte-eesmärgid (YAGNI)

- Olemasolevate kaustade migreerimine.
- Frontendi konflikti-retry loogika eemaldamine (jääb kahjutuna alles).
- Aastata vs dateeritud teoste eristamine — kõik uued saavad work_id sufiksi.
