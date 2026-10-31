# Eksemplari kiht ja paber.ut.ee (#696) — ülevaatus vastu koodibaasi

**Kuupäev:** 2026-10-31  
**Alus:** Issue [#696](https://github.com/meelisf/VUTT/issues/696) ja arutelufail [`docs/superpowers/specs/2026-10-19-eksemplari-kiht-ja-paber-arutelu.md`](../superpowers/specs/2026-10-19-eksemplari-kiht-ja-paber-arutelu.md).  
**Eesmärk:** Kontrollida kavandatud andmemudelit (Teos → Eksemplar → Vaatlus ← Vorm) ja töövoogu VUTT-i tegeliku koodi ja kehtivate ADR-ide vastu enne etappide 2–4 ADR-i kirjutamist.

## Kokkuvõte

Kontseptuaalne raamistik — eriti reegel **„teosel üks tekstitunnistaja"** ning teksti ja paberi lahus hoidmine — sobib VUTT-i arhitektuuriga hästi. Koodibaasi vastu kontrollides tuli välja **7 arhitektuurset kokkupuutepunkti**, kus praeguse koodi invariandid või juba olemasolevad andmestruktuurid seavad etappidele 2–4 otsesed tingimused.

| § | Teema | Põhileid koodis | Mõjutatud etapp |
|---|---|---|---|
| 1 | `archive_refs` ja `archives.json` | Hoidja + kohaviit + URL ja otsinguindeks (`archive_refs_text`) on juba teose tasemel olemas | Etapp 2 (Eksemplar) |
| 2 | Vaatluse asukoht vs ADR 0070 | `page_address.py` töötab ainult käsikirjadel (`Q87167`); trükiste signatuurid (`<sig>`) ei kata kõiki lehti (`a4`) ega transkribeerimata eksemplare | Etapp 3 (Vaatlused) |
| 3 | Lehtedeta bibliograafiline kirje | `build_work_documents` tagastab 0 pildiga teosele `[]` → teost ei indekseerita Meilis ega kuvata töölaual | Etapp 2–3 (Töövoog p. 1) |
| 4 | Eksemplari ja vaatluse pildid | Juurkausta `.jpg`/`.png` loetakse teose lehtedeks; `image_server.py` keelab alamkaustad (`403`) | Etapp 2–3 (Pildid) |
| 5 | Lehtede seos eksemplariga (`nri7ga`) | Lehetoimingud nihutavad numbreid; sidumine peab käima failitüvede (`page_stems`) ja `sync_work_parts` mustri kaudu | Etapp 2 (Eksemplar) |
| 6 | Vaatluste salvestuskoht ja õigused | Iga `_metadata.json` salvestus käivitab `person_to_works` ja kõigi lehtede Meili sünki; `/update-work-metadata` nõuab `admin` rolli | Etapp 2–3 |
| 7 | `paber.ut.ee` sobitus ja pealkirjasabad | `7zot7j` leidumus on pealkirja sabas, `archive_refs` tühi, Jaansoni nr-l ja DSpace'i viitel puudub kindel väli | Etapp 1 → 2 |

---

## Detailne analüüs ja soovitused

### 1. Olemasolev `archive_refs` ja `archives.json` vs uus Eksemplari kiht

Arutelufailis ei ole mainitud, et VUTT-is on juba kasutusel teose väli `archive_refs` ja mäluasutuste register `data/config/archives.json`:

- **Andmetüüp ja puhastus:** [`ArchiveRef`](../../src/types.ts#L61-L65) sisaldab välju `{ archive_id: string, reference: string, url?: string }` ning [`clean_archive_refs()`](../../server/metadata_ops.py#L40-L60) valideerib neid salvestamisel. Sisuliselt ongi see juba **hoidja + kohaviit + väline digikoopia**.
- **Hoidjate register:** [`server/routers/collections.py`](../../server/routers/collections.py#L32-L99) haldab `/config/archives` otspunkte (`archives.json`) ja kontrollib kustutamisel kasutust [`_find_works_with_archive()`](../../server/routers/collections.py#L296-L313) abil.
- **UI ja otsing:** Välja muudetakse [`MetadataModal.tsx`](../../src/components/MetadataModal.tsx#L745-L788) ja [`UploadMetaForm.tsx`](../../src/components/UploadMetaForm.tsx#L561-L595) kaudu, kuvatakse [`WorkInfoPanel.tsx`](../../src/components/editor/WorkInfoPanel.tsx#L311-L336) ja [`WorkCard.tsx`](../../src/components/WorkCard.tsx#L62-L63) peal ning indekseeritakse Meilisearchis otsitavaks väljaks `archive_refs_text` nii `teosed` kui ka `kirjad` indeksis ([`server/meili_doc.py`](../../server/meili_doc.py#L580-L597), [`server/meili_settings.py`](../../server/meili_settings.py#L30)).

**Soovitus:**
1. **Ära loo `archive_refs` kõrvale teist paralleelset kohta** hoidja ja kohaviida jaoks. Etapis 2 peaks `archive_refs` **kasvama eksemplaride kihiks** (või migreeruma selleks), kus iga praegune `archive_refs` kirje ongi üks eksemplar ning otsinguväli `archive_refs_text` jääb edasi tööle kõigi eksemplaride hoidjate ja kohaviitade pealt.
2. **Hoidja identiteet:** `archives.json` kasutab lühikoode (`TÜR`, `EAA`, `LVVA`, `UUB`), mis töötavad kohaviitade kuvamisel väga hästi. Kui on soov siduda hoidja prosopograafia asutuseregistriga ([`server/prosopography/registries.py`](../../server/prosopography/registries.py), [ADR 0059](../decisions/0059-ameti-ja-asutusregistri-voti.md)), tasub lisada valikuline viide `archives.json` kirjesse, mitte asendada lühikoodi.

---

### 2. Vaatluse asukoht vs „VUTT-i üldine viitamisviis" (ADR 0070)

Arutelu pakub ([rida 144–147](../superpowers/specs/2026-10-19-eksemplari-kiht-ja-paber-arutelu.md#L144-L147)):
> *„Ettepanek: vaatluse asukoht = VUTT-i üldine viitamisviis. Poognasignatuurid, foliatsioon ja paginatsioon on transkriptsioonis juba tägidega märgitud → teos + signatuur / folio / lehekülg (eriti kirjade puhul), eraldi välja pole vaja."*

Koodi ja [ADR 0070](../decisions/0070-lehe-tahistus-ja-lehe-aadress.md) / [speki 2](../superpowers/specs/2026-10-19-lehe-aadress-sisukorras-design.md) vastu vaadates tekib siin neli vastuolu:

1. **`page_address.py` töötab ainult käsikirjadel (`Q87167`):** [`work_scheme()`](../../server/page_address.py#L34-L40) kontrollib `t.get("id") == MANUSCRIPT_TYPE` ja tagastab kõigil trükistel `None`. Spekk 2 ([rida 18–22, 40](../superpowers/specs/2026-10-19-lehe-aadress-sisukorras-design.md#L18-L22)) välistas trükised ja `<sig>` tägid teadlikult, sest trükiste signatuuride erijuhud (`A ij`, `Ccij`, `)2(`, laotuspildid) viisid tupikusse.
2. **Signatuuri ei trükitud igale poogna lehele:** Näites `7zot7j` ([arutelu rida 71–78](../superpowers/specs/2026-10-19-eksemplari-kiht-ja-paber-arutelu.md#L71-L78)) on vaatlus `7/2` kohal **`a4`** ja `7/6` kohal **`c4, d2`**. Kvartformaadis trükistel trükiti signatuur tavaliselt vaid poogna esimesele 2–3 lehele (`a2`, `a3`), lehel `a4` trükitud signatuuri (ega `<sig>` tägi) ei ole.
3. **Transkribeerimata lehed ja teised eksemplarid:** `7zot7j` lehed 2–25 on olekus `Toores` (ilma `<sig>` tägideta); samuti tehakse vaatlusi eksemplaridel B ja C, mida VUTT-is üldse ei transkribeerita.
4. **Eeslehed ja köiteosad:** Vesimärk on sageli eeslehel või tühjal lõpulehel, millel puudub nii `<fw>` kui ka `<sig>`.

**Soovitus:**
- Vaatlusel **peab olema oma asukohaväli** (nt `locus`: `"a2, a3"`, `"a4"`, `"c4, d2"`, `"fol. 10"`, `"eesleht"`). See võimaldab `paber.ut.ee` poognatähised kadudeta importida sõltumata sellest, kas teos on transkribeeritud.
- Lisaks võib vaatlusel olla **valikuline** viide VUTT-i lehetüvele/tüvedele (`pages: list[str]`), kui vaatlus on tehtud digiteeritud tekstitunnistajal ja uurija soovib osutada konkreetsele VUTT-i leheküljele.

---

### 3. „Bibliograafiline kirje ilma lehtedeta" ei ilmu praegu otsingusse ega töölauale

Töövoo punkt 1 ([arutelu rida 91](../superpowers/specs/2026-10-19-eksemplari-kiht-ja-paber-arutelu.md#L91)) ütleb:
> *„1. Leia teos otsingust. Puudub (nt digiteerimata käsikiri) → bibliograafiline kirje ilma lehtedeta."*

Praeguses koodis on Meilisearchi `teosed` indeks leheküljepõhine. [`build_work_documents()`](../../server/meili_doc.py#L742-L747) käitub järgmiselt:
```python
jpg_files = enumerate_page_images(doc_path)
if not jpg_files:
    return teose_id, []
```
Kui teose kaustas pole ühtegi `.jpg`/`.png` lehepilti:
- Meilisearchi ei teki mitte ühtegi dokumenti (`{work_id}-1` puudub);
- teost **ei saa otsingust leida** ega töölaual avada;
- pildiserver ([`get_first_image`](../../server/image_server.py#L161-L176)) ja lehehaldus ([`admin_page_ops.py`](../../server/admin_page_ops.py)) eeldavad vähemalt ühe lehepildi olemasolu.

**Soovitus:**
Enne etappi 2/3 tuleb otsustada, kuidas lehtedeta teos VUTT-is käitub:
- **Variant A (koodimuudatusega):** [`build_work_documents()`](../../server/meili_doc.py#L729-L747) ehitab 0 pildiga teosele ühe sünteetilise dokumendi (`id: "{work_id}-0"`, `lehekylje_number: 0`, `teose_lehekylgede_arv: 0`), ning `WorkCard` ja `Workspace` oskavad avada 0-lehelist teost metaandmete/eksemplaride vaates.
- **Variant B (konventsiooniga):** Igal VUTT-i lisataval teosel on vähemalt üks pilt (nt tiitellehe foto, arhiivisäiliku kaanefoto või genereeritud tiitelkaardi pilt).

---

### 4. Eksemplari ja vaatluse pildid vs leheloendurid ja `image_server.py`

Arutelu järgi võivad nii teistel eksemplaridel (nt `7zot7j` Uppsala UB kseroks, 25 faili, praegu `data/._trash/7zot7j/replaced_images/`) kui ka vaatlustel (vesimärgifotod läbivas valguses) olla oma pildid, mille teksti ei transkribeerita.

Koodis kehtivad praegu kaks vastandlikku piirangut:
1. **Juurkausta pildid = teose leheküljed:** [`enumerate_page_images()`](../../server/meili_doc.py#L224-L246), [`get_sorted_images()`](../../server/admin_page_ops.py#L166-L176) ja [`get_first_image()`](../../server/image_server.py#L161-L173) loevad kõik teose juurkaustas olevad `.jpg`/`.png` failid, mille nimi ei alga `_`-ga, teose lehekülgedeks.
2. **Alamkaustad on pildiserveris keelatud:** [`ImageRequestHandler._handle_image_request()`](../../server/image_server.py#L443-L507) lubab ainult:
   - `/{work}/_thumb` ja `/{work}/_og`
   - `/{work}/_thumbs/_thumb_{fail}.jpg`
   - `/{work}/{fail.jpg}` (`len(parts) == 2` ja ei alga `_` ega `.`-ga)  
   Iga alamkaust (nt `/{work}/exemplars/...`) saab praegu `403 Keelatud`.

**Soovitus:**
- Hoia eksemplaride ja vesimärkide pildid teose kausta sees **`_`-prefiksiga alamkaustas** (nt `_exemplars/{ex_id}/...` ja `_watermarks/{obs_id}/...`). `_`-prefiks tagab, et ükski olemasolev leheloendur ega skript ei pea neid teose lehekülgedeks.
- Laienda [`server/image_server.py`](../../server/image_server.py#L480-L507) lubatud teede kontrolli ja pisipiltide genereerimist nii, et need alamkaustad on sama teose ligipääsukontrolli ([`_check_image_access`](../../server/image_server.py#L65-L75)) all serveeritavad.

---

### 5. Lehtede sidumine eksemplariga (`nri7ga`) — failitüved (`page_stems`), mitte lehenumbrid

Reegel 5 ([arutelu rida 35](../superpowers/specs/2026-10-19-eksemplari-kiht-ja-paber-arutelu.md#L35)):
> *„`nri7ga`-juhtum → teose lehed märgitakse eksemplari järgi („lk 2 = eksemplar B")."*

Nagu on kirjeldatud [ADR 0057-s](../decisions/0057-teose-osad.md), on VUTT-i leheküljenumber positsioon pildijärjestuses, mida lehetoimingud (ümberjärjestamine, poolitamine, kustutamine) nihutavad. Seetõttu viitavad teose osad lehtedele **failitüvede** (`page_stems`) kaudu ([`server/work_parts.py`](../../server/work_parts.py#L151-L155)) ning [`sync_work_parts()`](../../server/work_parts.py#L371-L415) uuendab tüvesid `refresh_work_mentions` ahelas igal lehetoimingul.

**Soovitus:**
1. **Vaikimisi kuuluvad kõik teose lehed tekstitunnistajale (`is_text_witness: true`)** — ära kopeeri kõiki 25 või 500 lehetüve eksemplari kirjesse, kui kogu skaneering pärineb ühest eksemplarist.
2. Ainult komposiitkoopiate (`nri7ga`) või teisest eksemplarist asendatud üksiklehtede korral salvesta eksemplari juurde erandlikud **lehetüved (`page_stems`)** ning haagi nende ümberarvutus [`remap_parts()`](../../server/work_parts.py#L371-L389) / `sync_work_parts()` eeskujul `refresh_work_mentions` külge.

---

### 6. Kus hoida vaatlusi, et vältida liigset Meili sünki ja õiguste konflikti?

Praeguses koodis kehtib kaks olulist piirangut `_metadata.json` muutmisel:
1. **Järeltegevuste hind:** Iga [`save_work_metadata()`](../../server/metadata_ops.py#L241-L371) ja [`bulk_update_works()`](../../server/metadata_ops.py#L196-L224) muudatus `_metadata.json`-is käivitab `update_work_collections`, `update_work_facts`, `update_person_to_works` ning `sync_work_to_meilisearch` (mis loeb kõik teose `.txt` ja `.json` failid kettalt ja saadab Meilisearchi).
2. **Õigused:** Üldine `/update-work-metadata` on `admin`-õigusega; `parts` tõsteti eraldi [`server/routers/work_parts.py`](../../server/routers/work_parts.py#L86-L109) alla (`editor`-õigus, `work_lock` → `metadata_lock`), et vältida samaaegsete muutjate ülekirjutusi ([ADR 0057](../decisions/0057-teose-osad.md)).

**Soovitus:**
- **Eksemplarid (`exemplars[]`)** sobivad `_metadata.json` sisse (muudetavad oma otspunktiga `/works/{id}/exemplars` analoogselt `/works/{id}/parts`-iga), sest eksemplari hoidja ja kohaviit peavadki minema Meilisearchi teose otsingusse.
- **Vaatlused (vesimärgid)** tasub hoida `_metadata.json`-ist **eraldi failis** (nt `_watermarks.json` teose kaustas, versioonitud git-is `save_with_git`-iga teose luku all):
  - Uurija saab arhiivis salvestada poolikuid vaatlusi ja mõõte ilma, et iga salvestus indekseeriks 500-lehelise teose täisteksti uuesti Meilisearchi.
  - Lahtised küsimused **õiguste** (nt paberiuurija roll või õigus) ja **avalikustamise** kohta (kas vaatlused on enne doktoritöö ilmumist peidetud) lahenevad ühes eraldi routeris ilma teose põhimetaandmete koodi keerukaks ajamata.

---

### 7. Etappide järjekord ja muud kokkupuutepunktid

1. **Kuivkäivitusega sobituskatse kohe Etapi 1 järel (enne Etapi 2 ADR-i):**
   - `7zot7j` metaandmetes on leidumus praegu pealkirja sabas (`"... Tartu ÜR; Rīga LAB; Uppsala UB R Bergm. 357(8)"`), samas kui `archive_refs` on tühi ning Jaansoni numbrit (`Jaanson 946`) ega DSpace'i viidet (`10062/25368`) väljades ei ole.
   - Kui Etapis 1 kraabitakse `paber.ut.ee` 522 kirjet tabeliks, tasub kohe kirjutada **kuivkäivitusega sobitusskript** vastu VUTT-i `_metadata.json` faile. See näitab enne Etapi 2 andmemudeli lukustamist ära:
     - kui suur osa 522-st sobitub automaatselt ja mille taha ülejäänud jäävad;
     - kas bibliograafilistele katalooginumbritele (Jaanson, VD17, ESTER, DSpace) on vaja struktureeritud välja;
     - millistel VUTT-i teostel on pealkirja sabas leidumused, mida saab migratsiooniskriptiga (esmalt ülevaatustabel, seejärel `bulk_update_works`) eksemplarikirjeteks tõsta.
2. **Variantväljaannete seos (Reegel 4):**
   - *„Sisuliselt erinev eksemplar → eraldi teos seosega „sama väljaanne, variant""* jaoks on [`Relation`](../../src/types.ts#L69-L73) tüüp (`rel_type: 'isVersionOf'` + `label`) ja kuvamine juba olemas — uut mehhanismi pole vaja ehitada.
3. **Vormiregister (Etapp 4) vs `registries.py` (ADR 0059):**
   - [`server/prosopography/registries.py`](../../server/prosopography/registries.py#L65-L125) on ehitatud eeldusel, et kirjel on mitmekeelsed `labels`, `variants` ja valikuline Wikidata Q-kood (`id`). Paberivormil Q-koodi ega tõlgitavat nimesilti ei ole (on kood/nimetus, IPH klass, veski, kaksikvorm, Bernstein/WZIS/Briquet viited).
   - [ADR 0059-st](../decisions/0059-ameti-ja-asutusregistri-voti.md) tasub üle võtta **tehniline muster** (VUTT-i püsivõti, `_LOCK` + `save_config_with_git`), kuid hoida vormiregistri valideerimisskeem `occupations`/`institutions` omast eraldi (veski väli võib seejuures viidata `institutions.json` või `places.json` võtmele).
