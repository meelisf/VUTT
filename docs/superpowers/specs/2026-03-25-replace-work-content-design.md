# Design: Teose sisu asendamine (Replace Work Content)

**Kuupäev:** 2026-03-25
**Staatus:** Kinnitatud

---

## Kontekst

Mõnikord on vaja olemasoleva teose skäneeritud pildid asendada parema kvaliteediga skäniga, kus lehekülgede arv või jaotus on erinev (nt. 25 topeltlehte → 50 üksikut lehte). Praegune "asenda üksik pilt" funktsioon ei sobi — vajalik on kõigi lehekülgede korraga asendamine. Metadata (pealkiri, autorid, žanr jms) säilitatakse.

---

## Kasutajavoog

1. Admin avab upload wizard (`/upload`)
2. **Samm 1 (Metadata):** valikuline "Asenda olemasolevat teost" otsinguväli — otsib meiliService kaudu. Valiku korral täidetakse metadata automaatselt olemasolevast teosest.
3. **Samm 2 (Upload):** muutusteta — fail läheb OCR serverisse
4. **Samm 3 (Review):** import-nupul on punane "Asenda: *[pealkiri]*" (tavapärase rohelise "Impordi VUTT-i" asemel)
5. Pärast asendust suunatakse asendatud teose lehele

---

## Frontend

**Fail:** `src/pages/Upload.tsx` (+ `src/components/upload/UploadMetaForm.tsx` kui eraldi komponent)

### Uus state
```ts
replaceWorkId: string | null    // work_id asendatavast teosest
replaceWorkTitle: string | null // kuvamise jaoks
```

### Samm 1 muudatused
- Uus valikuline otsinguväli "Asenda olemasolevat teost"
- Debounced Meilisearch otsing (teksti järgi), tulemused dropdown-is
- Valiku korral: `GET /admin/work/{work_id}/metadata` (uus lihtne GET endpoint) → täidab kõik metaandme-väljad
- Tühistamisnupp (×) eemaldab valiku ja puhastab väljad

### Samm 3 muudatused
- Kui `replaceWorkId` on seatud: punane nupp "Asenda: *[replaceWorkTitle]*"
- Nupp kutsub `POST /admin/upload/{upload_id}/replace-work/{work_id}` (mitte praegust `/import`)

---

## Backend

### Uus endpoint
```
POST /admin/upload/{upload_id}/replace-work/{work_id}
```
Ligipääs: ainult `admin` roll

### Uus funktsioon `replace_work_content()` (`server/upload_ops.py`)

1. **Valideeri:** upload on `'done'`/`'reviewing'`, `work_id` eksisteerib Meilisearchis
2. **Leia teos:** slug + `data/{slug}/` asukoht Meilisearchi kaudu
3. **Arhiveeri vanad pildid:** `*.jpg` → `data/._trash/{work_id}/replaced_content/{timestamp}/`
4. **Kustuta vanad lehed:** `*.txt` + `*.json` (v.a. `_metadata.json`) → `git rm`
5. **Kopeeri uued lehed (SFTP):** sama loogika nagu `import_as_work()`:
   - `{slug}_pg_NNN.jpg` → `data/{slug}/{slug}-{work_id}-{NNN:03d}.jpg`
   - `{slug}_pg_NNN.txt` → `data/{slug}/{slug}-{work_id}-{NNN:03d}.txt`
   - Loob `{slug}-{work_id}-{NNN:03d}.json` (`sequence: NNN*100, status: "Toores"`)
6. **Uuenda metadata** (kui kasutaja muutis samm 1-s): `save_work_metadata()` kaudu
7. **Git commit:** `"Asenda sisu: {slug} ({work_id})"`
8. **Meilisearch sync:** sünkroonne
9. **Märgi upload:** `state.json` → `'imported'` + `replace_work_id`
10. Return: `{"work_id": work_id, "slug": slug}`

**Veatöötlus:** kui midagi läheb pärast sammu 3 valesti, tuleb trash-ist taastamine teha käsitsi (samad reeglid nagu delete-page trash-iga).

### `create_upload()` muudatus
- Valikuline väli `replace_work_id` payload'is (salvestatakse `state.json`-i, info jaoks)

---

## Muudetavad failid

| Fail | Muudatus |
|------|----------|
| `server/upload_ops.py` | Uus `replace_work_content()` + `replace_work_id` create-upload payload |
| `server/main.py` | Uus endpoint `POST /admin/upload/{upload_id}/replace-work/{work_id}` + `GET /admin/work/{work_id}/metadata` |
| `src/pages/Upload.tsx` | Uus state + samm 1 otsinguväli + samm 3 punane nupp |

---

## Olemasolevad utiliidid (taaskasuta)

- `import_as_work()` (`server/upload_ops.py`) — SFTP loogika kopeerimine/refaktoreerimine
- `save_work_metadata()` (`server/metadata_ops.py`) — metadata uuendamine
- `sync_work_to_meilisearch()` (`server/meilisearch_ops.py`) — sünkroonne Meili sync
- `fetchWithTimeout()` (`src/utils/fetchWithTimeout.ts`) — frontend fetch
- `getAuthHeaders()` (`src/utils/fetchWithTimeout.ts`) — Bearer auth

---

## Testimine

1. Loo test-teos tavapäraselt (wizard → import)
2. Ava wizard uuesti, vali samm 1-s eelmine teos asendamiseks
3. Lae üles erineva lehekülgede arvuga PDF/pildid
4. Vaata samm 3-s "Asenda" nuppu
5. Kinnita: vanad pildid on `._trash/` kaustas, uued lehed on `data/{slug}/`-s, `_metadata.json` on muutumata, Meilisearch tagastab uued lehed, git log näitab "Asenda sisu:" commiti
