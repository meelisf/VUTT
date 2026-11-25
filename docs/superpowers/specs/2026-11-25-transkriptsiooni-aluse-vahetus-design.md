# Transkriptsiooni aluse vahetus teise eksemplari vastu — disain

**Seis:** disain, kinnitamata (2026-11-25; parandatud sama päeva ülevaatuse järel, vt
[Ülevaatus](#ülevaatus-2026-11-25)). Seotud: [ADR 0076](../../decisions/0076-eksemplari-kiht.md)
(eksemplari kiht, p 3 tekstitunnistaja, p 4 lehtede päritolu),
[ADR 0079](../../decisions/0079-eksemplari-pildid.md) (eksemplari pildid),
[ADR 0030](../../decisions/0030-page-map-lahteleht-valjundlehtedeks.md) (`page_map`), [ADR 0054](../../decisions/0054-lehe-salvestus-liidab-baasseisu-vastu.md) (`/save` kolmesuunaline
liitmine), #696. Teostuse eel uus ADR (0089).

## Miks

Eksemplari kihi ja eksemplari piltidega (ADA import, üleslaadimine) tuleb VUTT-i järjest
paremaid koopiaid teistest eksemplaridest. Sageli on praegune transkriptsiooni alus kehvem:
`zxy68w` alus on fotostaatiline koopia (16 lk, halb kvaliteet), sama trükise TÜR-i
eksemplar `d3wgnz` on ADA-st imporditud 21 pildiga. Aluse vahetamine käib praegu käsitsi:
PDF ADA-st alla → teose haldus „Asenda sisu" → viisard → tunnistaja märge uuesti →
eelmise aluse lehed kaovad prügikasti. Kasutaja ootab, et vahetusi tuleb sagedamini, ja
käsitsi läbimine on tülikas.

## Eesmärgid

- Eksemplari lehel nupp **„Tee transkriptsiooni aluseks"**: valitud eksemplari pildid
  muutuvad teose lehtedeks olemasoleva üleslaadimise ja asenduse kaudu.
- **Eelmise aluse lehed jäävad alles** eksemplari piltidena, iga leht oma päritolu
  eksemplari all, kõrvutatavad nagu muud eksemplari pildid.
- Tunnistaja märge liigub uuele eksemplarile.
- Toimetatud teksti korral **hoiatus ja selge kinnitus**, mis kehtib just kinnitatud seisule.

## Mitte-eesmärgid

- **Teksti ülekanne** uutele lehtedele. Lehtede arv erineb sageli (16 vs 21). Hiljem
  võimalik eraldi režiim „vaheta ainult pildid, tekst jääb" (järjekorra järgi 1:1, ilma
  OCR-ita), kui lehti on sama palju — kasutaja on seda varem käsitsi teinud pildifaile üle
  kirjutades. Mitte selles töös.
- **Sama eksemplari parem skänn.** See ei ole uus eksemplar; selleks on olemas lehe pildi
  asendus ja „Asenda sisu".
- Mitme eksemplari lehtedest kokkupanek, automaatne tunnistaja valik.
- Teose metaandmete muutmine (vahetub ainult lehestik).

## Anti-eesmärgid (rike, isegi kui tehniliselt töötab)

- Eelmise aluse lehed kaovad vaikselt (ainult prügikasti).
- Toimetatud transkriptsioon asendub toore OCR-iga ilma, et kasutaja oleks just seda seisu
  kinnitanud.
- Vahetus jääb poolikuks (lehed asendatud, aga tunnistajat pole / vanad lehed ainult
  prügikastis) ja seda ei saa lõpule viia.
- Vana lehestiku pealt avatud redaktori salvestus liidetakse vaikselt uuele lehele.
- Teose metaandmed või töökollektsioonid muutuvad vahetuse kõrvalmõjuna.

## Lähenemised

| | Kirjeldus | Plussid | Miinused |
|---|---|---|---|
| **A (valitud)** | Nupp loob asendusrežiimis üleslaadimise, lähteks eksemplari pildid; kasutaja jätkab viisardis poolitamisest; asenduse järel lõpetamise sammud | kasutab olemasolevat (poolitus/kärbe, OCR LOSSis, `replace_work_content`); ADA pildid on sageli kahe lehe kaupa ja vajavad poolitust | mitu sammu ja ootamist nagu tavalisel üleslaadimisel |
| B | Otsene taustatöö: pildid kohe lehtedeks + re-OCR | üks klikk | poolituse/kärpe enne OCR-i pole → hiljem redaktoris + uus OCR |
| C | Ainult piltide vahetus 1:1, tekst jääb | säilitab toimetatud teksti | ainult võrdse lehtede arvu korral; vt mitte-eesmärgid |

Kasutaja valis A (2026-11-25).

## Edukriteerium

Vahetus on **lõpetatud** alles siis, kui kõik järgmine kehtib:

1. teose lehestik on asendatud ja commit'itud;
2. lehtede päritolu on nullitud (`reset_page_origins`);
3. iga vana leht on oma päritolu eksemplari (või kasutaja valitud sihi) piltide all;
4. lähteeksemplar on ainus tunnistaja;
5. lähteeksemplari teosesse imporditud pildid on eemaldatud.

Kuni see ei kehti, on vahetus **pooleli** ja seda saab jätkata (vt §5). „Lõpetatud" ei tähenda
hoiatusega edu.

## Kuidas see töötab

### 1. Sissepääs (frontend)

- Eksemplari lehel (`/work/:id/exemplar/:eid`, `ExemplarList` kaart) nupp
  „Tee transkriptsiooni aluseks". Nähtav adminile (`can_write_work` + `require_role("admin")`,
  nagu eksemplari toimetamine), kui eksemplaril on ≥ 1 pilt ja ta ei ole praegune tunnistaja.
- Klõps avab dialoogi (oma modaal `z-[1300]`, üks täidetud nupp). Dialoog laeb serverist
  **eelvaate** (`GET …/promote/preview`, vt §2) ja näitab:
  - mitu pilti eksemplaril on → saavad teose lehtedeks (pärast poolitust võib arv muutuda);
  - teose praegune lehtede arv ja seisundite jaotus;
  - **kuhu läheb iga vana leht**: server lahendab päritolu ADR 0076 p 4 järgi (erandeksemplar
    → tunnistaja → teadmata). Kasutaja valib sihi **ainult teadmata päritoluga lehtedele**
    (üks valik kõigile neile; vaikimisi puudub, kui tunnistajat pole). Teada päritoluga lehti
    ei saa ümber suunata;
  - kui mõni leht on toimetatud (seisund ≠ Toores): punane hoiatus („N lehe toimetatud tekst
    asendub uue OCR-iga; vana tekst jääb ajalukku") ja kinnitusruut.
- Kinnitus → `POST …/promote` → vastuses `upload_id` → navigeeri `/upload?upload=<upload_id>`
  (uus parameeter: viisard jätkab antud üleslaadimist; praegu jätkab ta ainult
  `localStorage`-ist).
- Viisard näitab sammudes 3–4 bännerit „Aluse vahetus: eksemplar {hoidja · kohaviit} →
  teose lehed". Asendusrežiimi **metaandmete vormi ei näidata**.

### 2. Eelvaade ja loomine (backend)

`GET /admin/work/{work_id}/exemplars/{eid}/promote/preview` → `{pages: [{stem, page, status,
origin: exemplar_id|null, fingerprint}], edited: [...], images: n}`. `fingerprint` = lehe
`.txt` sisu räsi (sama, mida `/save` kasutab `base`-i võrdlemiseks, ADR 0054).

`POST /admin/work/{work_id}/exemplars/{eid}/promote`, keha
`{unknown_target: exemplar_id|null, confirmed_edited: {stem: fingerprint}}`. Sync `def`
(kettatöö, ADR 0002).

1. Õigus: `require_role("admin")` + `can_write_work` (ADR 0031).
2. Kontroll: eksemplar olemas ja tal on pilte; `eid` ei ole praegune tunnistaja;
   teadmata päritoluga lehti on → `unknown_target` olemas ja ≠ `eid`; teosel ei ole teist
   pooleliolevat asendusega üleslaadimist → muidu 409.
3. Toimetatud lehtede **hulk koos sõrmejälgedega** peab võrduma `confirmed_edited`-iga.
   Muidu 409 `{code: "edited_pages_changed", edited: {...}}`; klient näitab uut seisu ja
   küsib uuesti. (Kinnitus kehtib just sellele sisule, mitte arvule.)
4. Loob üleslaadimise teose `type`-iga (Q-kood, OCR-mudeli valikuks), `replace_work_id =
   work_id`.
5. Kopeerib eksemplari pildid manifesti järjekorras lähteks `source/pg_NNN.jpg`
   (`store_image_page` loogika): lähtefail (`{id}.orig.{ext}`), kui see on olemas, muidu
   `{id}.jpg`.
6. Kirjutab upload state'i välja `promote`:
   ```
   {exemplar_id, source_images: [{page: N, image_id}], manifest_revision,
    origins: {stem: exemplar_id},          # lahendatud enne nullimist; teadmata → unknown_target
    confirmed_edited: {stem: fingerprint},
    requested_by, at,
    phase: "prepared"}                     # → "replaced" → "done" (§5)
   ```

Midagi teoses ei muutu enne asendust: pooleli jäetud vahetus = tavaline kustutatav
üleslaadimine.

### 3. Viisard (muutmata)

Poolitus/kärbe, apply → OCR LOSSis, ülevaatus — kõik olemasolev (ADR 0028, 0049).
`page_map` (ADR 0030) kirjutatakse nagu alati.

### 4. Asendus (`replace-work`, kui state'is on `promote`)

**Lõppkontroll enne ühegi faili muutmist**, `work_lock`-i all:

1. URL-i `work_id` == state'i `replace_work_id` (kehtib KÕIGILE asendustele, mitte ainult
   `promote`-ile) → muidu 409.
2. Lähte- ja sihteksemplarid on olemas.
3. **Toimetatud lehtede kontroll leheluku all:** võetakse kõigi vanade lehtede `page_lock`
   (järjekord: `work_lock` → lehelukud tüve järjekorras; `/save` võtab ainult lehe luku, seega
   tsüklit ei teki) ja hoitakse kuni vanade lehtede eemaldamiseni. Luku all arvutatakse
   toimetatud lehtede sõrmejäljed uuesti; kui need erinevad `promote.confirmed_edited`-ist →
   409 `edited_pages_changed`, klient küsib uuesti (uus kinnitus kirjutatakse state'i, siis
   kordus).

Seejärel olemasolev asendus **ilma metaandmete ja töökollektsioonide sammuta** (`promote`
korral jäetakse `state['meta']`-st kirjutamine ja `work_sets` lisamine vahele): paarid ära,
vanad JPG-d `._trash/{work_id}/replaced_content/{ts}/`, git rm, uued lehed, commit.
**Commit'i tõrge on `promote` korral viga** (rollback nagu git rm vea puhul), mitte hoiatus.
Kui commit õnnestus: `promote.phase = "replaced"`, `promote.trash_dir`,
`promote.old_head` (asenduse-eelne HEAD), `promote.old_order` (vanad tüved lehtede
järjekorras, `enumerate_page_images` enne liigutamist) kirjutatakse state'i. Siis lõpetamine (§5).

**Uutel lehtedel on sama tüvi kui vanadel** → aegunud redaktori kaitse: asendus kirjutab
iga uue lehe JSON-i serverivälja `content_generation` (uus väärtus asenduse kohta; lisatakse
`SERVERIPOOLSED_LEHE_VALJAD`-i). Redaktor saadab laetud lehe põlvkonna `/save`-ga; erinev →
409 „lehestik asendati, laadi leht uuesti" (mitte kolmesuunaline liitmine). Kehtib kõigile
asendustele.

### 5. Lõpetamine ja jätkamine

Lõpetamine on **idempotentne** ja käivitub asenduse lõpus automaatselt; pooleli jäänud
vahetust saab jätkata otspunktiga `POST /admin/upload/{id}/promote/finish` (eksemplari lehel
ja üleslaadimiste nimekirjas nupp „Lõpeta aluse vahetus", kui `phase == "replaced"`).
`work_lock`-i all, sammud järjest, iga samm kontrollib, kas ta on juba tehtud:

1. **Päritolu nullimine** (`reset_page_origins`) — kordamine on ohutu.
2. **Vanad lehed eksemplaride piltideks** `promote.trash_dir`-ist `promote.old_order`
   järjekorras, igaüks `promote.origins[stem]` alla. Uus sisemine funktsioon
   `exemplar_images.add_internal(...)` (nagu `add_uploads`, aga serveri allikaliigiga):
   `source = {kind: "former_pages", ref: old_head, page, stem}`. **Dubleerimise vältimine:**
   enne lisamist jäetakse vahele tüved, mille kohta sihtmanifestis on juba pilt sama
   `source.ref` + `source.stem`-iga. `former_pages` on uus serveripoolne liik (ADR 0079),
   klient seda saata ei saa.
3. **Tunnistaja märge** `promote.exemplar_id`-le olemasoleva eksemplari kirjutusteega (server
   jõustab ühe tunnistaja, ADR 0076 p 3); selle eksemplari `needs_review` eemaldatakse.
4. **Imporditud lähtepiltide eemaldamine — ainult need, mis said teose lehtedeks:** lähteleht
   N on imporditud, kui `page_map[N]` on mittetühi (ADR 0030); tema `image_id` tuleb
   `promote.source_images`-ist. Eemaldatakse ainult need ID-d (prügikasti, uus
   `exemplar_images.remove_images_internal(ids)`), mitte kogu manifest:
   `remove_exemplar_images_locked` on eksemplari kustutuse jaoks ja viiks ka impordikirjed.
   **Alles jäävad:** välja jäetud lähtelehed, pärast `promote` loomist lisatud pildid ja
   impordikirjed (`imports`).
5. `promote.phase = "done"`; üleslaadimine `imported`.

Kuni `phase != "done"`, on üleslaadimise olek `replaced`-faasis nähtav („aluse vahetus
pooleli"), mitte `imported`. Lõpetamise tõrge salvestab vea state'i ja
`record_server_error`-i; kasutaja näeb põhjust ja nuppu „Lõpeta".

### 6. Andmed ja invariandid

- `promote` elab ainult upload state'is (`state/`), mitte `_metadata.json`-is.
- Pärast vahetust on kõik lehed uue tunnistaja omad (vaikimisi, ADR 0076 p 4).
- Pildipaarid: asendus eemaldab kõik (olemasolev); vanad lehed eksemplaride all on
  tavalised pildid ilma paarita.
- Lehenumbreid muutev tee → `refresh_work_mentions` (asendus teeb juba).
- Lukujärjekord: `work_lock` → `page_lock`-id (tüve järjekorras) → `metadata_lock` → git.

## Testid (ehitajale)

- Eelvaade: päritolu lahendus (erandeksemplar, tunnistaja, teadmata); sõrmejäljed.
- Loomine: õigused; kontrollid; 409 `edited_pages_changed` (muudetud toimetatud leht SAMA
  arvu juures; uus toimetatud leht); piltide kopeerimine järjekorras (lähtefail eelistatud);
  `promote` state'is; teos muutumata.
- Asendus: URL-i ja `replace_work_id` mittevastavus → 409 (ka tavaline asendus); OCR-i ajal
  toimetatud leht → 409; leheluku all toimuv `/save` ootab; metaandmed ja töökollektsioonid
  muutumata; commit'i tõrge → rollback.
- Aegunud redaktor: vana `content_generation`-iga `/save` → 409.
- Lõpetamine: vanad lehed õige päritolu eksemplari all õiges järjekorras; korduskäivitus ei
  dubleeri; tunnistaja vahetunud (täpselt üks); ainult `page_map`-is esinenud lähtepildid
  eemaldatud, välja jäetud ja hiljem lisatud alles, `imports` alles; katkestus iga sammu järel
  → `finish` lõpetab.
- Frontend: nupu nähtavus; dialoog (päritolu, teadmata sihi valik, kinnitusruut); `?upload=`
  jätkab õiget üleslaadimist; metaandmete vormi pole; „Lõpeta aluse vahetus".

## Kontrollitud koodist (2026-11-25)

- `replace_work_content` (`server/upload_ops.py`): `work_lock`, paarid ära, JPG-d prügikasti,
  git rm, commit (tõrge praegu ainult hoiatus), `state['meta']`-st metaandmed (pealkiri, aasta,
  isikud, žanr …) ja `work_sets`, `reset_page_origins` (tõrge praegu ainult logi), olek
  `imported` ka pärast neid tõrkeid.
- `admin_upload_replace_work` (`server/routers/upload.py`): `work_id` URL-ist, state'i
  `replace_work_id`-ga ei võrrelda.
- `/save` (`server/routers/editing.py`): ainult `page_lock`, kolmesuunaline liitmine `base`-i
  vastu; `SERVERIPOOLSED_LEHE_VALJAD = ("sequence", "source")`.
- `page_map` (`server/upload/prepress_apply.py`): lähteleht → väljundlehed.
- `exemplar_images.remove_exemplar_images_locked`: kogu eksemplari pildid + manifest
  (kustutuse abifunktsioon). `add_uploads`: kliendi allikaliigid.
- `store_image_page` (`server/upload/store_source.py`): `source/pg_NNN.jpg`.
- Viisard jätkab praegu ainult `localStorage`-ist.

## Ehitaja otsustada

- Dialoogi paigutus ja sõnastus (mõlemad keeled korraga, ADR 0011); ikoon `icons.ts`-ist
  (ADR 0086, uus mõiste → sõnavara + valvur).
- `?upload=` parameetri nimi ja koostöö `localStorage`-jätkamisega.
- `content_generation` väärtuse kuju (nt asenduse ajatempel või upload_id).

## Minu otsused (kasutaja kinnitab disaini lugedes)

- Lähteeksemplari pildid, mis said teose lehtedeks, eemaldatakse (prügikasti); välja jäetud
  jäävad.
- Teada päritoluga vana leht läheb alati oma eksemplari alla; kasutaja valib sihi ainult
  teadmata päritoluga lehtedele.
- Toimetatud lehtede kinnitus on sõrmejäljepõhine ja kontrollitakse asendusel leheluku all
  uuesti.
- `replace_work_id` sidumine ja aegunud redaktori kaitse tehakse kõigile asendustele, mitte
  ainult aluse vahetusele (sama viga on olemas ka „Asenda sisu" voos).

## Ülevaatus 2026-11-25

Teise agendi ülevaatus (commit `eec63cb1` vastu). Kõik kuus punkti kontrolliti koodi vastu ja
leiti paikapidavaks; parandused selles versioonis:

| Punkt | Parandus |
|---|---|
| P1 vahetus võib jääda poolikuks | Edukriteerium; `phase`; idempotentne lõpetamine + `finish`; commit'i tõrge = viga |
| P1 arv ei seo kinnitust sisuga | Sõrmejäljed; lõppkontroll leheluku all; `content_generation` aegunud redaktori vastu |
| P1 kogu manifesti kustutamine | Ainult `page_map`-is esinenud lähtepildid; alles jäävad välja jäetud, hiljem lisatud, `imports` |
| P1 metaandmed | `promote` korral metaandmete ja töökollektsioonide samm vahele; vormi ei näidata |
| P2 vanade lehtede päritolu | Päritolu lahendatakse enne nullimist lehe kaupa; valik ainult teadmata lehtedele |
| Otspunkti sidumine | URL-i `work_id` == `replace_work_id`, eksemplaride kontroll luku all |
