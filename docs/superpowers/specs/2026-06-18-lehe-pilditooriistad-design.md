# Lehe pildiredaktor: pööra, kärbi, poolita (navigeeritav)

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

**Töövoo-probleem:** sageli vajab terve dokument (nt 20 topeltlehte) sama toimingut järjest.
Praegu peab iga lehe puhul modaali uuesti avama — monotoonne. Vaja **navigeeritavat
modaali**, mis jääb avatuks ja laseb nooltega lehelt lehele liikuda, et terve dokument
ühe seansiga läbi töödelda.

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

### 3. Frontend: `src/components/PageImageEditorModal.tsx` (ühendatud navigeeritav)

**Üks modaal, mis sisaldab mõlemat tööriista** (crop/rotate + poolitamine) ja navigeerib
lehtede vahel ilma sulgumata. Asendab senise plaani kaks eraldi modaali; olemasolev
`SplitPageModal` loogika tõstetakse selle modaali poolitamis-tabi alla (või refaktoreeritakse
jagatud osa välja).

**Tabid / režiimid** modaali sees:
- **Pööra & kärbi** — 90° nupud (←/→/180°) + deskew-sleider (±10°), pilt pöördub elavalt
  CSS-transformiga; vaba kärpe-ristkülik *pööratud* pildil. "Rakenda" → `POST .../transform`.
- **Poolita** — lõikejoone-drag (praegune `SplitPageModal` loogika). "Rakenda" →
  `POST .../split`.

**Navigeerimine (mõlemas režiimis):**
- ← → noole-nupud päises + klaviatuuri `ArrowLeft`/`ArrowRight`.
- Modaal saab propsiks **kogu järjestatud lehtede nimekirja** (`pages`) + jooksva indeksi.
  Pilt, token ja lehe number tulevad nimekirjast.
- Navigeerimine lähtestab parajasti pooleli oleva (rakendamata) teisenduse — iga leht
  algab puhtalt lehelt (nurk 0, kärbe puudub). Kui kasutajal on rakendamata muudatus,
  küsi kinnitust enne lahkumist (lihtne `confirm` või "rakendamata muudatused" hoiatus).
- Päises lehe-loendur "Leht X / N".

**Salvestamine + auto-edasi (batch-töövoo tuum):**
- "Rakenda" **ei sulge modaali**. Edukal toimingul liigub modaal automaatselt **järgmise
  päris-skänni juurde** (vt nimekirja-sünk allpool).
- Kinnituse-samm säilib poolitamisel ja teisendusel ("vana pilt säilib prügikastis 90
  päeva; tekst ja metaandmed jäävad muutmata"). Batch-monotoonsuse vältimiseks kaalu
  "ära küsi uuesti selles seansis" linnukest (täpsustatakse implementatsioonis).

**Props:** `workId`, `pages` (järjestatud), `initialIndex`, `imageTokenLookup`/`imageToken`,
`onClose`, `onPagesChanged` (kutsutakse pärast iga mutatsiooni, et `WorkManage` laeks
nimekirja uuesti).

### 3a. Nimekirja-sünk pärast mutatsiooni (kriitiline)

Crop/rotate ja poolitamine käituvad nimekirja suhtes erinevalt — modaal peab end
**failinime järgi** positsioneerima, mitte jäiga indeksi järgi:

- **Crop/rotate** — lehtede arv ei muutu, failinimi säilib. "Järgmine" = praeguse järel
  olev leht nimekirjas.
- **Poolitamine** — originaalfail kustub, asemele kaks uut nanoid-faili; arv kasvab.

**Ühtne ankur-reegel:** enne "Rakenda" jäta meelde **järgmise lehe failinimi**
(praegusele järgnev). Pärast `onPagesChanged` → uus `pages` jõuab propsina tagasi → leia
selle ankur-failinime indeks → liigu sinna. Poolitamisel hüppab see õigesti üle mõlema uue
poole järgmise päris-skänni juurde; crop/rotate'il viib lihtsalt +1 võrra edasi. Kui
praegune oli viimane leht, jää viimasele (või sulge) ja näita "viimane leht".

### 4. Frontend: `WorkManage.tsx` integratsioon — overflow-menüü

Praegu on pisipildi alumises servas `justify-between` 3 nuppu laiali (Lae alla · Asenda ·
Poolita). Crop oleks 4. nupp → läheb tihedaks (eriti 5-veerulises ruudustikus). Selle
asemel **koondatakse kõik lehe-toimingud ühte overflow-menüüsse:**

- Pisipildi alumises-paremas nurgas üks `⋮` nupp (`MoreVertical`, lucide-react).
- Klõps avab popover-menüü toimingutega (ikoon + tekst igal real):
  - **Lae alla** (`Download`) — säilib `<a download>` linkina (sama token-URL loogika).
  - **Asenda pilt** (`Upload`) — käivitab peidetud failisisendi (`replaceInputRef`).
  - **Pööra / kärbi** (`Crop` v `Frame`) — avab `PageImageEditorModal` selle lehe indeksil,
    "Pööra & kärbi" tabil.
  - **Lõika leht kaheks** (`Scissors`) — avab sama `PageImageEditorModal`, "Poolita" tabil.
- **Kustuta** jääb eraldi üleval-paremas nurgas (`Trash2`), **lehe nr/staatus** üleval-vasakul
  — destruktiivseim tegevus eraldi, ei peitu menüüsse.
- Menüü sulgub väljaklõpsul (outside-click handler) ja toimingu valikul. Korraga avatud
  ainult ühe lehe menüü (`openMenuPage: number | null` state).
- `onPagesChanged` → sama värskendus nagu praegu poolitamisel (thumbnaili cache-bust,
  `loadPages`).

## Andmevoog

```
PageImageEditorModal (klient) — jääb avatuks üle lehtede
  ┌─ Pööra & kärbi → { angle, crop } → POST /admin/work/{id}/page/{n}/transform
  └─ Poolita       → { split_x }     → POST /admin/work/{id}/page/{n}/split
       → server (Pillow): exif_transpose → rotate(expand)/crop VÕI split
       → vana pilt prügikasti, thumbnail regen, log, meili sync
  → onPagesChanged → WorkManage laeb pages uuesti → propsina tagasi
  → modaal positsioneerib end ankur-failinime järgi → JÄRGMINE leht (ei sulgu)
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
- Frontend: modaali interaktsioon (pööre + kärbe → õige `{angle, crop}` payload;
  poolitamine → `{split_x}`); kinnituse-samm; tabide vahetus.
- Frontend navigeerimine (kõige olulisem uus loogika): ← → liigutab lehte; **ankur-reegel**
  — pärast poolitamist hüppab üle mõlema uue poole järgmise päris-skänni juurde; pärast
  crop/rotate'i liigub +1; viimasel lehel ei lähe üle piiri; rakendamata muudatuse hoiatus
  enne navigeerimist.

## Skoobist väljas (YAGNI)

- Bulk-toimingud (per-page funktsioon jääb bulk-sõbralikuks, aga ei ehita) — terve
  dokumendi läbitöötlemine lahendatakse hoopis navigeeritava modaaliga (üks leht korraga,
  aga sujuvalt järjest), mitte ühe massipäringuga.
- Mittedestruktiivne (parameetrite) ajalugu — säilitame ainult viimase varundatud pildi
  prügikastis, mitte teisenduste ahelat.
- Perspektiivi-/trapets-korrektsioon (ainult pööre + ristkülik-kärbe).
