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
- `filename: str` — lehe pildifaili nimi (mitte jäik indeks; vt 3a, endpoint §2)
- `angle: float` (kraadid, vaikimisi `0.0`)
- `crop: Optional[dict]` — `{x, y, w, h}` normaliseeritud 0–1, vaikimisi `None` = terve pilt
- `username: str`

**Loogika (kindel, varundus-enne-muutust järjekord — arvustuse parandus):**
1. **Valideeri sisend ja leia fail (sh path-traversal kaitse — arvustuse turvapunkt).**
   `find_directory_by_id` → kaust. **Lükka tagasi**, kui `filename` sisaldab `/` või `\`
   või `os.path.basename(filename) != filename` (400). Seejärel kontrolli, et `filename`
   kuulub **rangelt** selle teose `get_sorted_images` nimekirja → alles siis tee failisüsteemi
   operatsioone. Puuduv/mittekuuluv → 404. (Nii `../../midagi` ei jõua kunagi FS-operatsioonini.)
2. **No-op kaitse (float-tolerantsiga — arvustuse punkt).** Kui `abs(angle) < 1e-4` JA
   `crop is None` → ära puutu faili, tagasta
   `{"success": True, "changed": False, "reason": "no_transform"}`. (Range `angle == 0`
   laseks sliderist tulnud `0.0000000003` mõttetu rekodeerimise teha.) Frontend ei tohiks
   sellist päringut üldse saata — see on kaitse. Valideeri `crop` ∈ [0,1], `w,h > 0`.
3. **Varunda ENNE muutmist.** Kopeeri praegune fail prügikasti
   `._trash/{work_id}/replaced_images/{base}_{timestamp}{ext}`. **Lisaks** kirjuta pristine
   originaal **üks kord** `._originals/{work_id}/{filename}` (ainult kui veel ei eksisteeri)
   — vt all "Kumulatiivse kvaliteedikao märkus". **NB (arvustuse punkt):** originals-koopia
   tehakse **enne** `exif_transpose`-i (100% muutumatu fail), seega see sisaldab veel algseid
   EXIF-orientatsiooni andmeid. Tulevane "Reset originaalist" peab originaalile **uuesti
   rakendama `exif_transpose`-i** enne kuvamist/kasutamist.
4. **Ava pilt → `ImageOps.exif_transpose(raw)`** (rakenda EXIF orientatsioon pikslitele).
5. **Värviruum.** Kui väljundformaat on JPEG ja pilt on `RGBA`/`LA`/`P` → lapenda valgele
   taustale / `convert("RGB")` (vajalik nii `fillcolor` kui JPEG-salvestuse jaoks).
6. **Pööre** sama matemaatikaga, mida frontend preview kasutab (vt §3 par-nõue):
   `img.rotate(SIGN*angle, expand=True, fillcolor=valge)`. `expand=True` säilitab nurgad.
   **Märgi konventsioon lukustatakse aktseptantsitestiga** (§Testimine).
7. **Crop pööratud pildi mõõtmetest (min-suurus PÄRAST klampimist — arvustuse punkt).**
   `W,H = img.size` (pärast pööret); pikslid `(x*W, y*H, (x+w)*W, (y+h)*H)`, klampi
   piiridesse. **Alles siis** kontrolli lõplikku suurust: `right-left >= 8` JA
   `bottom-top >= 8` → muidu 400. (Normaliseeritud `w,h` võivad tunduda kehtivad, aga
   pärast klampimist jääda sisuliselt tühjaks.) `img.crop(...)`.
8. **Salvesta ajutisse faili** (`{filename}.tmp`) **lähtefaili formaadis** (vt all).
   **NB (arvustuse punkt):** tmp-fail tuleb kirjutada **täpselt samasse kausta**, kus on
   originaalpilt — mitte `/tmp`-i — muidu võib `os.replace` visata `EXDEV` (cross-device
   link), kui temp asub teisel mount-point'il. Samas kaustas on `os.replace` garanteeritult
   atomaarne.
9. **Atomaarne asendus** `os.replace(tmp, orig)` — väldib pooliku faili nähtavust.
10. **Regenereeri thumbnail** (`_thumbs/_thumb_{filename}`). **Vea-poliitika (arvustuse
    punkt):** kui `os.replace` õnnestus, aga thumbnaili regenereerimine ebaõnnestub, **EI
    rollback'ita** pildimuutust (pilt on juba korrektselt asendatud; täis-rollback pärast
    edukat replace'i oleks habras). Tagasta `thumbnail_warning: True`; frontend näitab
    hoiatust ja lubab thumbnaili hiljem uuesti genereerida. (Backend võib enne loobumist
    proovida regenereerimist 1× uuesti.)
11. **Logi** `transform_image.log` (struktureeritud): timestamp, user, work_id, filename,
    angle, crop, varukoopia tee, vana mõõt → uus mõõt.
12. **Meilisearch: sync EI ole vajalik (arvustuse punkt).** Transform ei muuda midagi,
    mida Meili indekseerib — failinimi, lehtede arv, tekst, JSON ja `sequence` jäävad samaks
    (muutub ainult pildi pikslisisu + thumbnail). Seega **jäta `sync_work_to_meilisearch`
    vahele** — see kiirendab 20-lehelist batch'i oluliselt. (Erinevus poolitamisest, mis
    muudab failinimesid ja teksti → seal sync jääb.)
13. Tagasta `{"success": True, "changed": True, "filename": filename, "size": [W,H],
    "thumbnail_warning": <bool>}`.

**Väljundformaat (arvustuse punkt: PNG/värviruum).** Säilita lähtefaili konteiner:
`.jpg/.jpeg` → JPEG q95 (`convert("RGB")` enne); `.png` → PNG (kadudeta, väldib
kumulatiivset kadu nendel failidel). Failinimi ei muutu kunagi → lehe identiteet säilib.
(Olemasolevad lehed on valdavalt JPEG; PNG-d on harvad, aga `get_sorted_images` lubab neid.)

**Kumulatiivse kvaliteedikao märkus (arvustuse punkt).** JPEG-lehe iga transform
dekodeerib + rekodeerib → see **EI OLE mitte-destruktiivne töövoog**, q95 kaod kuhjuvad
mitme järjestikuse teisenduse korral. Leevendus: (a) säilib **konkreetse lehefaili esimene
transform-eelne versioon** `._originals/{work_id}/{filename}` all; (b) iga toimingu eelne
versioon säilib prügikastis (undo-last). Teisendus rakendub siiski alati **praegusele**
failile (inkrementaalne) — täielikku "rakenda originaalist uuesti" ahelat me YAGNI tõttu
ei ehita.

**`._originals` täpne tähendus (arvustuse punkt 1).** See on **konkreetse lehefaili esimene
transform-eelne versioon — MITTE tingimata teose esmane arhiiviskänn.** Kui leht tekkis
poolitamisest/asendamisest, on `._originals` selle lehefaili algolek, mitte algne import.

**Koostoime `replace-image`-iga (arvustuse punkt 2 — loogikaauk).** Stsenaarium: leht
transformitakse (`._originals` tekib) → kasutaja teeb sama failinime all "Asenda pilt" →
uus transform. Vana `._originals` ei kirjutataks üle → "reset originaalist" taastaks
**enne asendamist** olnud pildi (vale). **Lahendus:** `replace-image` endpoint peab vastava
`._originals/{work_id}/{filename}` kirje **kustutama** (või arhiveerima), sest asendatud
pilt on selle lehe uus pristine algolek; järgmine transform loob siis uue `._originals`.
(See nõuab olemasoleva `replace-image` endpointi väikest muudatust.)

**Orvuks jäänud `._originals` (väike koristus).** Poolitamine/kustutamine kaotab
originaalfaili → tema `._originals` kirje jääb orvuks (kahjutu kettajääk). Võib hiljem
koristada; ei blokeeri midagi.

**Git:** pildid ei ole git-tracked → commiti pole vaja (nagu `split_page` piltidega).
`._originals/` ja `._trash/` asuvad väljaspool teose kausta → `get_sorted_images` neid ei
skanni (ei teki "fantoom-lehti").

### 2. Endpoint (`server/main.py`)

**Failinime-põhine** (arvustuse punkt: `page_num` on pärast mutatsioone habras — split
muudab arvu ja indekseid; failinime-ankur on stabiilne):

```
POST /admin/work/{work_id}/page-image/{filename}/transform
body: { "angle": float, "crop": {"x","y","w","h"} | null }
require_role("admin")
```

Kutsub `transform_page_image(work_id, filename, ...)`. Vea käsitlus: 400 vigastele
parameetritele, 404 puuduvale failile. `filename` URL-kodeeritakse (sisaldab nanoidi +
laiendit). **NB:** poolitamise (`/split`) endpoint jääb esialgu `page_num`-põhiseks, AGA
frontend peab `page_num`-i alati võtma **viimati laetud `pages` nimekirjast** (modaal
positsioneerib niikuinii failinime-ankru järgi), mitte säilitama vana indeksit.

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

**KRIITILINE: preview ↔ serveri geomeetria peab olema matemaatiliselt sama** (arvustuse
kõige riskantsem punkt). `CSS transform: rotate(...)` muudab ainult visuaalset
bounding-box'i, mitte `naturalWidth/naturalHeight`-i — kui kärpe-koordinaadid arvutatakse
valest baasist, lõikab server *mujalt* kui kasutaja nägi. Nõue:
- Frontend renderdab pööratud pildi **expand'itud bounding-box'i** (sama valem kui Pillow
  `rotate(expand=True)`: `W' = |W·cos θ| + |H·sin θ|`, `H' = |W·sin θ| + |H·cos θ|`) ja
  joonistab kärpe **selle** kasti suhtes, mitte algse pildi suhtes.
  **NB (arvustuse punkt):** JS `Math.cos/sin` ootavad **radiaane** — teisenda
  `θ_rad = θ_deg × π/180` enne valemisse andmist (kraadid → radiaanid).
- Crop saadetakse **normaliseeritud pööratud-pildi koordinaatides** (`x,y,w,h ∈ [0,1]`
  pööratud W'×H' suhtes). Server rakendab pööret esimesena, siis kärpe samadest
  normaliseeritud väärtustest → identne tulemus.
- Pöördenurga **märk** (CSS `rotate(+θ)` vs Pillow `rotate(SIGN·θ)`) lukustatakse
  aktseptantsitestiga (§Testimine), et vältida "vasak/parem" nihet.

**Navigeerimine (mõlemas režiimis):**
- ← → noole-nupud päises + klaviatuuri `ArrowLeft`/`ArrowRight`.
- **Klahvi-kaitse (arvustuse punkt 8):** nooleklahvid navigeerivad **ainult siis, kui fookus
  ei ole interaktiivsel kontrollil** (deskew-slider, number-input, kärpe-handle). Muidu
  sliderist/inputist tulev ←→ ei tohi ootamatult lehte vahetada. (Kontrolli
  `document.activeElement` / `e.target` tüüpi enne navigeerimist.)
- Modaal saab propsiks **kogu järjestatud lehtede nimekirja** (`pages`) + jooksva indeksi.
  Pilt, token ja lehe number tulevad nimekirjast.
- Navigeerimine lähtestab parajasti pooleli oleva (rakendamata) teisenduse — iga leht
  algab puhtalt lehelt (nurk 0, kärbe puudub). Kui kasutajal on rakendamata muudatus,
  küsi kinnitust enne lahkumist (lihtne `confirm` või "rakendamata muudatused" hoiatus).
- Päises lehe-loendur "Leht X / N".

**Salvestamine + auto-edasi (batch-töövoo tuum):**
- "Rakenda" **ei sulge modaali**. Edukal toimingul liigub modaal automaatselt **järgmise
  päris-skänni juurde** (vt nimekirja-sünk allpool).
- **Kinnitus batch-sõbralikuks (arvustuse punkt — peaaegu vajalik, mitte mugavus).**
  Vaikekäitumine: esimene toiming seansis küsib kinnitust ("vana pilt säilib prügikastis 90
  päeva; tekst ja metaandmed jäävad muutmata") + linnuke **"ära küsi selles aknas uuesti"**.
  Linnukese märkimisel rakenduvad järgnevad toimingud kohe ja modaal liigub automaatselt
  edasi. Linnuke on modaali-seansi-skoobis (sulgemisel lähtestub).
- **Poolitamise järel auto-edasi on hea, aga kasutaja tahab tihti tulemust kontrollida
  (arvustuse punkt).** Pärast `split`-i liigu vaikimisi järgmisele originaal-skännile, AGA
  näita toast'i "Leht poolitatud" tegevuslingiga **"Vaata uusi pooli"** (kerib/positsioneerib
  kahe uue poole esimesele). Crop/rotate'il piisab lihtsast õnnestumis-toastist.

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
poole järgmise päris-skänni juurde; crop/rotate'il viib lihtsalt +1 võrra edasi.

**Servajuht — viimane leht (arvustuse punkt):** kui praegune leht oli dokumendi viimane,
järgmist failinime ei eksisteeri. Siis:
- **Poolitamisel** positsioneeri end kahe uue poole **esimesele** (need on uued viimased
  lehed; saab kohe tulemust kontrollida — haakub split-toasti "vaata uusi pooli" loogikaga).
- **Crop/rotate'il** jää samale (nüüd töödeldud) lehele ja näita selget teadet
  **"Kõik lehed läbi töödeldud"** + luba modaal mugavalt sulgeda. Fallback ankur, kui
  vaja: eelmise lehe failinimi.

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
  ┌─ Pööra & kärbi → { angle, crop } → POST /admin/work/{id}/page-image/{filename}/transform
  └─ Poolita       → { split_x }     → POST /admin/work/{id}/page/{n}/split  (n viimasest pages-st)
       → server: VARUNDA enne (trash + esmane originals) → Pillow exif→rotate(expand)→crop
                 → tmp samas kaustas → atomaarne os.replace → thumbnail regen → log
                 (transform EI sünki Meilit; split sünkib, sest failinimi+tekst muutuvad)
  → onPagesChanged → WorkManage laeb pages uuesti → propsina tagasi
  → modaal positsioneerib end ankur-failinime järgi → JÄRGMINE leht (ei sulgu)
```

## Pöördumatusele kindel

- **Varundus toimub ENNE ülekirjutust** (arvustuse parandus) — iga toimingu eelne versioon
  `._trash/{work_id}/replaced_images/` (sama 90-päeva muster kui `replace-image`).
- **Pristine originaal säilib üks kord** `._originals/{work_id}/{filename}` → algne skänn
  alati puhtalt taastatav (vt kumulatiivse kao märkust §1).
- Atomaarne `os.replace` → poolikut faili ei jää kunagi nähtavale.
- Tekst, JSON, `sequence` ei muutu kunagi.
- Toiming logitakse `transform_image.log`-i (struktureeritud väljad).

## Roll ja õigused

**Ainult admin** (`require_role("admin")`) — järgib praegust mustrit (poolitamine,
asendamine, kustutamine on kõik admin-only).

## Testimine

- Backend: `transform_page_image` ühiktestid — 90° pööre muudab mõõtmeid õigesti;
  deskew + `expand=True` säilitab sisu; crop normaliseeritud koordinaadid → õiged pikslid;
  **varundus jõuab prügikasti ENNE faili muutmist** (loe varukoopiat → võrdne *vana*
  pildiga, mitte uuega); **pristine originals kirjutatakse ainult esimesel korral**
  (teine transform ei kirjuta üle); **formaadi säilitus** (.jpg→JPEG, .png→PNG);
  RGBA/P → RGB enne JPEG-i; thumbnail regenereeritakse; tekst/JSON/sequence puutumata;
  veapiir (puuduv fail → 404, vigane crop / liiga väike → 400, **no-op → `changed:False`**).
- **Aktseptantsitest — preview ↔ server geomeetria (arvustuse kõige tähtsam):** sama
  `(angle, crop)` rakendatuna frontend preview valemiga ja serveri Pillow'ga annab
  **sama bounding-box'i ja sama kärbitud ala ±1–2 px tolerantsiga** (Pillow rotate teeb
  ümardusi/filtreerib — matemaatiline ideaal ei lange pikslitäpselt kokku); **pöördenurga
  märk lukku** (+2° UI-s ⇒ pööre samas suunas kui server) — sünteetiline test markeriga
  pildil (nt must ruut teadaolevas nurgas → kontrolli, kuhu ta pärast pööret+kärbet satub).
- **Replace-image + `._originals` (arvustuse loogikaauk):** test, et `replace-image`
  kustutab/arhiveerib vastava `._originals` kirje → järgmine transform loob uue pristine
  algoleku (mitte ei taasta enne asendamist olnud pilti).
- **Thumbnaili-vea poliitika:** kui regen ebaõnnestub pärast edukat `os.replace`-i →
  pilt jääb muudetuks, `thumbnail_warning: True`, mitte rollback.
- **Frontend klahvi-kaitse:** ←→ ei vaheta lehte, kui fookus on slideril/inputil/handle'il.
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
- **Täielik mitte-destruktiivne parameetri-ajalugu** ("rakenda alati pristine originaalist
  uuesti, hoia teisenduste ahelat") — me EI ehita. Säilitame pristine originaali üks kord
  + iga toimingu eelse versiooni prügikastis (undo-last), aga teisendus rakendub
  inkrementaalselt praegusele failile (vt §1 kumulatiivse kao märkust).
- Perspektiivi-/trapets-korrektsioon (ainult pööre + ristkülik-kärbe).
