# Lehe pilditööriistad: pööra + kärbi

**Kuupäev:** 2026-06-18
**Staatus:** Disain kinnitatud, ootab spetsi-ülevaatust

## Probleem

Teatud käsikirjadel on skaneeringud, mis vajavad pildi parandust enne/järel
transkribeerimist:

- **Orientatsioon** — leht on küljel või tagurpidi (90°/180° pööre).
- **Viltus (deskew)** — leht on paar kraadi viltu, vaja sirgeks ajada.
- **Servad** — pildil liigne taust, naaberleht, sõrm vms; vaja kärpida tekstialani.
- **Poolitusjääk** — pärast topeltlehe poolitamist jääb servale ribake naaberlehte.

Praegu on lehekülgede haldus (`WorkManage.tsx`, admin) olemas: järjekord, poolitamine,
kustutamine, pildi asendamine, lehe lisamine, prügikast. Crop/rotate puudub.

## Põhimõte ja arhitektuuriline koht

**Crop ja rotate erinevad poolitamisest põhimõtteliselt.** Poolitamine (`split_page`)
loob *kaks uut lehte* (uued nanoid-failid, tekst lõigatakse `<pb/>` juures, originaal
prügikasti). Crop/rotate **muudab ühe lehe pilti kohapeal**, säilitades lehe
identiteedi: tekst, JSON ja `sequence` jäävad muutmata.

See on peaaegu täpselt see, mida `replace-image` endpoint juba teeb (Pillow-konteksti
asemel teisendus): vana pilt → prügikast → kirjuta üle → regenereeri thumbnail →
`replace_image.log` → `sync_work_to_meilisearch`. Uus funktsioon taaskasutab seda mustrit.

**Tehniline valik:** klient saadab **parameetrid** (pöördenurk + kärpe-ristkülik
normaliseeritud koordinaatides), **server rakendab Pillow'ga täisresolutsioonis
originaalile** — täpselt nagu `split_page` juba teeb (`split_x` → Pillow serveris).
Põhjendus: arhiivikvaliteet säilib (canvas kliendis kaotaks resolutsiooni), üks tõeallikas
(Pillow), taaskasutab `replace-image` varundus-/thumbnail-loogikat.

**Skoop:** ainult üksikleht (mitte bulk). Iga leht on veidi erinev, seega ühe ristküliku
masskärbe poleks kasulik. Server-funktsioon kirjutatakse siiski bulk-sõbralikult (per-page),
nii et "pööra kõik 90°" oleks hiljem odav lisada, kui orientatsioonipartii ette tuleb.

## Komponendid

### 1. Backend: `transform_page_image()` (`server/admin_page_ops.py`)

Uus per-page funktsioon.

**Sisend:**
- `work_id: str`
- `page_num: int` (1-indekseeritud)
- `angle: float` (kraadid, vaikimisi `0.0`)
- `crop: Optional[dict]` — `{x, y, w, h}` normaliseeritud 0–1, vaikimisi `None` = terve pilt
- `username: str`

**Loogika (alati sama järjekord):**
1. Leia kaust ja lehe failinimi (`find_directory_by_id`, `get_sorted_images`) — sama
   valideerimine nagu `split_page`/`replace-image` (404 kui leht puudub).
2. Ava pilt → `ImageOps.exif_transpose(raw)` (rakenda EXIF orientatsioon pikslitele).
3. Kui `angle != 0`: `img.rotate(-angle, expand=True, fillcolor=(255,255,255))`.
   `expand=True` säilitab kõik nurgad; valge täide. (Nurga märk täpsustatakse
   implementatsioonis nii, et UI sleider ja tulemus klapivad.)
4. Kui `crop` antud: arvuta pikslikoordinaadid **pööratud** pildi mõõtmetest
   (`x*W, y*H, (x+w)*W, (y+h)*H`), klampi piiridesse, `img.crop(...)`.
5. Salvesta JPEG q95 **üle sama failinime** (lehe identiteet säilib).
6. Vana pilt → `._trash/{work_id}/replaced_images/{base}_{timestamp}.jpg` (sama kui
   `replace-image`).
7. Regenereeri thumbnail (`_thumbs/_thumb_{img_name}`).
8. Kirjuta `replace_image.log` (või eraldi `transform_image.log` — täpsustatakse).
9. `sync_work_to_meilisearch(folder_name)`.
10. Tagasta `{"success": True, "filename": img_name}`.

**Git:** pildid ei ole git-tracked → commiti pole vaja (nagu `split_page` piltidega).

**Veapiir:** kui `angle == 0` ja `crop is None`, ära tee midagi (tagasta no-op või viga —
täpsustatakse). Valideeri `crop` väärtused vahemikus [0,1] ja `w,h > 0`.

### 2. Endpoint (`server/main.py`)

```
POST /admin/work/{work_id}/page/{page_num}/transform
body: { "angle": float, "crop": {"x","y","w","h"} | null }
require_role("admin")
```

Kutsub `transform_page_image(...)`, tagastab tulemuse. Vea käsitlus nagu
`admin_split_page` (400 valedele parameetritele, 404 puuduvale lehele).

**Bulk (hiljem, ei ehita praegu):** `POST /admin/work/{work_id}/transform-all` sama
per-page funktsiooni üle loopides.

### 3. Frontend: `src/components/ImageEditModal.tsx`

Uus kombineeritud modaal (eraldi `SplitPageModal`-ist, sest semantika erineb).

- **Pööramine:** 90° nupud (←/→/180°) + peenhäälestuse sleider (deskew, nt ±10°).
  Pilt pöördub elavalt CSS-transformiga eelvaates.
- **Kärbe:** vaba ristkülik, mille kasutaja joonistab *pööratud* pildil (sama
  drag-muster nagu `SplitPageModal` lõikejoonel, aga ristkülik).
- **Salvestamine:** saadab `{ angle, crop }` (mitte pilti) endpoindile. Kinnituse-samm
  nagu poolitamisel: "Vana pilt säilib prügikastis 90 päeva. Tekst ja metaandmed jäävad
  muutmata."
- Props sarnased `SplitPageModal`-ile: `workId`, `pageNum`, `imageFilename`,
  `imageToken`, `onClose`, `onSuccess`.

### 4. Frontend: `WorkManage.tsx` integratsioon

Lehe-real uus nupp (Crop-ikoon, lucide-react) `Lõika leht kaheks` (Scissors) nupu kõrvale.
Avab `ImageEditModal`. `onSuccess` → sama värskendus nagu poolitamisel (thumbnaili
cache-bust, lehtede uuesti laadimine).

## Andmevoog

```
ImageEditModal (klient)
  → kasutaja pöörab + joonistab kärpe → { angle, crop }
  → POST /admin/work/{id}/page/{n}/transform
    → transform_page_image()
       → Pillow: exif_transpose → rotate(expand) → crop → JPEG q95 üle sama faili
       → vana pilt prügikasti, thumbnail regen, log, meili sync
  → onSuccess → WorkManage värskendab thumbnaili (cache-bust)
```

## Pöördumatusele kindel

- Vana pilt säilib `._trash/{work_id}/replaced_images/` (sama 90-päeva muster kui
  `replace-image`).
- Tekst, JSON, `sequence` ei muutu kunagi.
- Toiming logitakse püsivasse logifaili.

## Roll ja õigused

**Ainult admin** (`require_role("admin")`) — järgib praegust mustrit (poolitamine,
asendamine, kustutamine on kõik admin-only).

## Testimine

- Backend: `transform_page_image` ühiktestid — 90° pööre muudab mõõtmeid õigesti;
  deskew + `expand=True` säilitab sisu; crop normaliseeritud koordinaadid → õiged pikslid;
  vana pilt jõuab prügikasti; thumbnail regenereeritakse; tekst/JSON/sequence puutumata;
  veapiir (puuduv leht → 404, vigane crop → 400, no-op).
- Frontend: modaali interaktsioon (pööre + kärbe → õige `{angle, crop}` payload);
  kinnituse-samm; `onSuccess` värskendab thumbnaili.

## Skoobist väljas (YAGNI)

- Bulk-toimingud (per-page funktsioon jääb bulk-sõbralikuks, aga ei ehita).
- Mittedestruktiivne (parameetrite) ajalugu — säilitame ainult viimase varundatud pildi
  prügikastis, mitte teisenduste ahelat.
- Perspektiivi-/trapets-korrektsioon (ainult pööre + ristkülik-kärbe).
