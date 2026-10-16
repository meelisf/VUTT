# VUTT turvalisuse, ligipääsukontrolli, samaaegsuse ja koodikvaliteedi ülevaade (2026-10-16)

**Kuupäev:** 2026-10-16
**Aluseks olev seis:** `HEAD` (`74989e89`)
**Seotud varasemad ülevaated:**
- `docs/reviews/2026-09-24-koodibaasi-koondylevaade.md` (`R24-01..R24-10`)
- `docs/reviews/2026-09-27-turva-ja-andmelekke-ulevaade.md` (`S27-01..S27-07`)
- `docs/tegemata_tood.md`

---

## 0. Seis 2026-10-16 õhtul (järelkontroll)

Ülevaade jagati koodi vastu üle kontrollituna issue'deks ja parandati PR-idega
#620–#628 (kõik `main`-is; serveri backend on `0171d689` peal). Allolev tabel
on **autoriteetne** — lõigud 2–5 on ülevaate algne tekst ja võivad olla
osaliselt aegunud või ekslikud (vt veerg „Märkus").

| Leid | Issue / PR | Seis | Märkus |
|---|---|---|---|
| **O16-01** rikastus kirjutab süsteemivälju | PR #620 | **Tehtud** | Identiteedi-/elutsükliväljad kaitstud; nimemuutus levib teostesse nagu `update_person`. |
| **O16-02** commit_hash / pathspec | PR #620 | **Tehtud (teisiti)** | Commiti viide = ainult räsi (+`^`), `rev-parse --verify --end-of-options`, diffi tee `:(literal)`. `len(parts)==2` piirangut EI tehtud (prosopograafia teed vajavad prefiksit) — literal-pathspec sulgeb sama augu. Restore'i „räsi faili ajaloos" kontroll **ei ole vajalik**: kehtiva räsi + literal-tee korral saab ainult sama faili versiooni, ligipääs on kontrollitud. |
| **O16-03** re-OCR rakendus | #615 / PR #621 | **Tehtud** | `page_lock` kõigil lehtedel lugemisest commitini — tehtud. Meili sünk oli juba olemas (`routers/reocr.py`) — **ülevaate väide vale**. `check_page_filename` reocr-teedel **tagasi lükatud**: see kaitseb `/save`-teid kirjutamisõigusega kasutaja eest (`_metadata.txt` → `_metadata.json` = admini toiming), re-OCR on aga ainult admin ja `basename` välistab läbimurde; pealegi on re-OCR-i `page_filename` pildi nimi, `check_page_filename` nõuab `.txt`-d. `refresh_work_mentions` **ei ole vajalik** — mainimised tulevad lehe JSON-i isikutägidest (`_scan_page_mentions`), re-OCR-i lepitus puudutab ainult tekstiannotatsioonide ankruid ega muuda lehenumbreid. |
| **O16-04** aliaste lukk, osade ettepanekud, liitmine | #615 / PR #621 | **Tehtud** | Üks `_aliases_lock`; liitmine + nimemuutus `bulk_update_works` kaudu (`metadata_lock`, üks commit, `update_work_facts`), osade loojad `work_parts.rebind_person`; ettepanekute otsused järjestatud, `override` ei pühi `attached_to`-d. |
| **O16-05** MCP submit oraakel | PR #620 | **Tehtud** | Kood kontrollitakse enne korpuse- ja kaardikontrolle. |
| **O16-06** üleandmiskoodide tühistus | #619 / PR #625 | **Tehtud** | Konto kustutusel ja rolli muutusel. |
| **O16-07** filtri escape | #616 / PR #623 | **Tehtud** | Üks reegel kolmes kohas (`_filter_value`, MCP `_quote`, `quoteFilterValue`); ~30 käsitsi kohta üle viidud. Turvaviga ei olnud (ligipääsu jõustab token). |
| **O16-08** viewer-token slug'iga | #617 / PR #622 | **Tehtud** | |
| **O16-09** MCP `search_pages` offset | #618 / PR #624 | **Tehtud** | Mitu akent kuni `MAX_SPREAD_ROUNDS`, klammerdus, aus järgmise lehe vihje. |
| **O16-10** registreerimine / reset | #619 / PR #625 | **Tehtud** | Registreerimise loe–muuda–kirjuta luku all. Reseti pool oli **juba atomaarne** (`_validate_and_consume_token`) — ülevaate väide aegunud. |
| **O16-11** p1 viimane leht jääb indeksisse | #617 / PR #622 | **Tehtud** | |
| **O16-11** p2 alamkogu nähtavus | #617 / PR #627 | **Tehtud + ADR 0069** | Tooteotsus: privaatse kogu alamkogu on privaatne; arvutus ainult `server/collection_tree.py`. |
| **O16-11** p3 kaanepilt (= R24-06) | #419 / PR #629 | **Tehtud** | Esilehe vahemälu signatuuriga (piltide nimed + JSON-ide mtime): korduspäring ei parsi JSON-e. Mõõdetud 1000 lk: külm 23 ms → soe 5 ms (jääb `glob` + `stat`). Ülevaate väide „välistab `strikethrough` lehed" oli vale — JSON-e loeti `sequence` järjestuse pärast. |
| **O16-12** GND / VIAF / ADA sisend | #619 / PR #625 | **Tehtud** | |
| **O16-13** p2 username-preview rate-limit | PR #620 | **Tehtud** | |
| **O16-13** p1 nginx `vutt_auth` `/reset/*` | PR #629 | **Tehtud** | `reset/validate` ja `reset/set-password` range tsooni alla; rakenduse `check_rate_limit` oli juba olemas. |
| **O16-14** p1 prügikast | #619 / PR #625 | **Tehtud** | |
| **O16-14** p2 `replace_work_content` lukk | #619 / PR #625, #626 / PR #628 | **Tehtud + leitud lisaviga** | Luku järel selgus, et asendus ei kutsunud `refresh_work_mentions`-it (ADR 0055) → #626, parandatud. |
| **O16-14** p3 `user_settings_ops` | — | **Tagasi lükatud** | `username` tuleb sessioonist, mitte kliendilt → tee-süst ei ole võimalik; võidujooks ainult sama kasutaja kahe tabi vahel. |
| **O16-15** sqlite 0644, `async def` I/O | #619 / PR #625 | **Tehtud** | |
| **O16-16** p1, p3 DOM-valvur, lingid, `encodeURIComponent` | #619 / PR #625 | **Tehtud** | |
| **O16-16** p2 `renderVuttMarkup` regex | — | **Tagasi lükatud** | Ülevaade ise tunnistab, et atribuutidega märgendid eemaldatakse järgmises sammus; muudatus oleks kosmeetiline. |
| **O16-17** dokumentatsioon / skriptid | #619 / PR #625 | **Tehtud** | `scripts/fix_filterable.sh` **eemaldati** (vana loend oleks `is_public` jt filtreerimatuks teinud). |

Kõrvalt samal päeval: **#612** (lehe teksti liitmine ridade kaupa + kokkupõrke
dialoog, PR #614) — ei ole selle ülevaate leid, aga puudutab sama
`page_merge.py` pinda.

**Lahti jääb:** ainult IT-ga arutatav — S27-05 jääk (teenusekasutajad,
read-only korpus) ja S27-07 (SSH parooliautentimine, tulemüür). Koodipoolseid
lahtisi leide selles ülevaates ei ole.

---

## 1. Juhtkokkuvõte ja varasemate leidude staatus

Võrreldes 24. ja 27. septembri ülevaadetega on VUTT-i koodibaasi turva- ja andmetervikluse tase oluliselt tõusnud: **9/10 `R24` leiust ja 5/7 `S27` leiust on lahendatud**. Lehekülje salvestamisel on 3-poolne tekstiühendamine (`server/page_merge.py`) ja faililukud (`server/page_locks.py`), lehefailide nimed valideeritakse tsentraalselt (`server/page_paths.py`), pildiserver on fail-closed (`server/image_server.py`), arhiivide allalaadimine kasutab lühiealisi HMAC-pileteid (`server/routers/public.py`) ning Meilisearchi ligipääs on seotud pordi `127.0.0.1:7700` ja 15-minutiliste tenant-tokenitega.

Käesolev ülevaade keskendub:
1. Varasemate paranduste äärejuhtudele ja veel avatud punktidele (`R24-06`, `S27-05`).
2. Vahepeal lisandunud funktsionaalsusele (prosopograafia rikastamine, MCP handoff-töövood, teoseosad `parts`, hulgi-re-OCR, kirjade otsing `kirjad` indeksis).
3. Samaaegsusele, lukustuse kooskõlale ja Meilisearchi sünkroonimisele.

Leitud uued või avatud kitsaskohad on tähistatud koodidega **`O16-01` .. `O16-17`** ja jagatud kolme prioriteeditasemesse (**P1**, **P2**, **P3**), et neid oleks mugav järjest lahendada.

### Varasemate leidude koondseis

| Varasem ID | Teema | Staatus 2026-10-16 | Märkused / viide uuele leiule |
|---|---|---|---|
| **R24-01** (#422) | `/save` puuduv failinime valideerimine | **Parandatud** (jääklünk `reocr.py`-s) | `server/page_paths.py` kaitseb `editing.py` otspunkte; `reocr.py` vajab sama kontrolli (**vt O16-03**). |
| **R24-02** (#423) | `image_server.py` fail-open ja sisekaustade leke | **Parandatud** | `server/image_server.py:46-75, 434-486`. (`docs/tegemata_tood.md:25-31` märge on aegunud, **vt O16-17**.) |
| **R24-03** (#416) | `/save` ja `/page-comments` võidujooks | **Parandatud** (jääklünk `reocr_apply.py`-s) | `page_lock` + `page_merge.py`. Hulgi-re-OCR ja sisuasendus vajavad lukke (**vt O16-03, O16-14**). |
| **R24-04** (#417) | `rebuild_indices` blokeerib stardi ja kirjutab üle | **Parandatud** | Taustalõim + `server/prosopography/fresh_merge.py`. |
| **R24-05** (#418) | Git commiti tõrke vaikne neelamine metainfo salvestusel | **Parandatud** | `MetadataSaveResult` ja `warning` väli. |
| **R24-06** (#419) | `get_first_image` loeb iga kaanepildi päringul kõik lehe JSON-id | **AVATUD** | Käsitletud allpool punktis **O16-11**. |
| **R24-07** (#420) | `/save` skaneerib kõik teose lehed ka muutmata isikutäägide korral | **Parandatud** | `server/routers/editing.py:152-180, 220-222`. |
| **R24-08** (#421) | `PersonsPage.tsx` võidujooks filtrite vahetamisel | **Parandatud** | `useLatestQuery` (`src/prosopography/pages/PersonsPage.tsx:235-254`). |
| **R24-09** (#424) | Isikuportreed serveeritakse täissuuruses | **Parandatud** | `server/prosopography/image_variants.py` (`?w=160\|320\|640`). |
| **R24-10** (#425) | `origin_place` URL-parameetri eiramine alglaadimisel | **Parandatud** | `src/prosopography/pages/PersonsPage.tsx:44`. |
| **S27-01** | Avalik `/files/` lekitab `state/` ja `/data/config/` | **Parandatud** | Nginxis eemaldatud, `vutt_backup.py:135-137` seab `state/` õiguseks `0700`. |
| **S27-02** | `/work/{work_id}/download` ja `/work-Archive` puuduv ligipääsukontroll | **Parandatud** | `download-ticket` (`server/routers/public.py:92-199`) ja `can_read_work` (`server/routers/pages.py:42-46`). |
| **S27-03** | Pika elueaga Meilisearchi tenant-tokenid | **Leevendatud** | Autentitud tokeni TTL on 15 min (`server/routers/auth.py:35`). |
| **S27-04** | `client-error` logimürgitamine ja tokenite leke logisse | **Parandatud** | `src/utils/scrubSensitive.ts` ja `server/routers/client_errors.py:61-127`. |
| **S27-05** | Konteinerite liigsed õigused (`root`, SSH võti, `MEILI_MASTER_KEY`) | **Osaliselt parandatud** | `no-new-privileges:true`, eraldi `~/.ssh/vutt_ocr_ed25519`, `vutt-images` ilma `MEILI_MASTER_KEY`-ta (`docker-compose.yml:22-67`). Jääk (teenusekasutajad, read-only korpus pildiserverile) — IT-ga arutada. |
| **S27-06** | `paramiko.AutoAddPolicy()` SSH MITM risk | **Parandatud** | `verify_host_key` (`server/upload/ocr_client.py:25-50`). |
| **S27-07** | Hosti võrgupiirid (SSH parooliautentimine, UFW) | **Avatud — IT-ga arutada** | Vt `2026-09-27` ülevaade; `badmin`-konto ligipääsuviis teadmata. (Ülevaate algne rida kirjeldas siin ekslikult kuupäevafiltrit.) |

---

## 2. Prioriteet 1 (Kõrge) — Turvalisus, ligipääsukontroll ja andmekao vältimine

---

### O16-01: `apply_enrichment` lubab `editor` rollil üle kirjutada kaitstud süsteemivälju (sh `id` -> teise isikukirje ülekirjutamine ilma lukuta)

- **Tõsidus:** Kõrge (Privileegide eskaleerimine / Andmeterviklus)
- **Failid ja read:**
  - `server/prosopography/person_crud.py:603-654` (`apply_enrichment`)
  - `server/prosopography/person_crud.py:100-115` (`_save_person_locked`)
  - `server/prosopography/router.py:711-733` (`POST /prosopography/{person_id:path}/enrich`)

#### Probleemi kirjeldus
Tavapärane isikukaardi salvestamine (`_apply_card_update`, `server/prosopography/person_crud.py:369-371`) eemaldab sisendist süsteemiväljad:
```python
for key in ("id", "created_at", "created_by", "schema_version",
            "import_batch_ids", "merged_into") + SECRET_FIELDS:
    data.pop(key, None)
```
Seevastu `apply_enrichment` (`person_crud.py:622-640`) eemaldab ainult `SERVER_FIELDS` (`{"review"}`), `"identifiers"`, `"_enrichment_scheme"`, `LEGACY_BIOGRAPHY` ja `ANCHOR_FIELDS` ning kirjutab seejärel tsüklis mis tahes punktiga eraldatud väljaraja otse `person` sõnastikku:
```python
for field_path, value in approved_fields.items():
    _deep_set(person, field_path, value)
```
Seejärel kutsub rida 651 välja `_save_person_locked(person, username, ...)`, mis arvutab salvestatava faili asukoha **muudetud** `person["id"]` põhjal (`_id_to_path(person["id"])`, rida 109).

#### Mõju
1. **Teise isikukaardi ülekirjutamine ilma lukuta:** Kui `editor` rollis kasutaja saadab `POST /prosopography/vutt:P_oma/enrich` kehas `{"approved": {"id": "vutt:P_ohver"}}`, võetakse `person_lock` ainult `vutt:P_oma` peale, kuid kettal kirjutatakse üle `vutt:P_ohver.json` ja `ext_id_index.update_for_person(person)` registreerib välised ID-d `vutt:P_ohver` nimele.
2. **Rollipiirangu (`admin` vs `editor`) möödaminek:** Isiku kustutamine (`DELETE /prosopography/{person_id}/delete`) ja liitmine (`POST /prosopography/{source_id}/merge`) nõuavad `admin` rolli, kuid `editor` saab `enrich` kaudu määrata `{"record_status": "tombstone", "merged_into": "vutt:P..."}` või muuta `verification_level`, `created_by`, `created_at` ja `SECRET_FIELDS` välju.
3. **Puuduv nime propagatsioon:** Kui `approved` muudab `name.label` välja, ei kutsuta välja `_propagate_name_to_works(person_id, new_label, username)` ega `fill_person_labels_from_registry(person)` (erinevalt `update_person` funktsioonist ridadel 454–475).

#### Soovitatav parandus
1. Kehtestada `apply_enrichment` sees lubatud rikastusradade valge nimekiri (või eemaldada `approved_fields` seest kõik kaitstud juurvõtmed: `id`, `record_status`, `verification_level`, `created_at`, `created_by`, `updated_at`, `updated_by`, `schema_version`, `import_batch_ids`, `merged_into`, `source_data` + `SECRET_FIELDS` ning nende `võti.*` alamrajad).
2. Võrrelda `old_label` ja `new_label` väärtusi `apply_enrichment` sees ning nime muutumisel kutsuda välja `fill_person_labels_from_registry(person)` ja pärast luku vabastamist `_propagate_name_to_works(person_id, new_label, username)`.

---

### O16-02: Valideerimata `commit_hash` ja mitmesegmendiline `filepath` Git otspunktides

- **Tõsidus:** Kõrge (Git argumentide/pathspeci süstimine ja ligipääsukontrolli möödaminek)
- **Failid ja read:**
  - `server/routers/editing.py:80-90` (`_catalog_from_filepath`)
  - `server/routers/editing.py:390-403` (`POST /commit-diff`)
  - `server/routers/editing.py:626-666` (`POST /git-restore`)
  - `server/git_ops.py:642-660` (`get_file_at_commit`) ja `696-755` (`get_commit_diff`)
  - `server/prosopography/router.py:857-886` (`GET /prosopography/{person_id}/diff`) ja `938-965` (`POST /prosopography/{person_id}/restore`)

#### Probleemi kirjeldus
1. **Puuduv `commit_hash` valideerimine:**
   - `page_comments_restore` (`editing.py:490`) ja `page_annotation_restore_as_comment` (`editing.py:550`) kontrollivad rangelt, et `commit_hash` kuulub `get_file_git_history` nimekirja.
   - Seevastu `POST /commit-diff`, `POST /git-restore`, `GET /prosopography/{person_id}/diff` ja `POST /prosopography/{person_id}/restore` annavad kasutaja sisestatud `commit_hash` stringi otse edasi `get_commit_diff` või `get_file_at_commit` funktsioonile ilma hex-SHA (`^[0-9a-f]{7,40}$`) kontrollita.
   - `get_commit_diff` (`server/git_ops.py:702`) käivitab `repo.git.rev_parse(commit_hash)` ilma `--verify` ja `--end-of-options` lippudeta. `contributor` rollis kasutaja saab saata `commit_hash` väärtuseks Git lippe (nt `--all`, `--branches`, `--local-env-vars`) või revisjoniavaldisi.
2. **`_catalog_from_filepath` (`editing.py:80-90`) ja Git pathspec-maagia:**
   ```python
   parts = [p for p in filepath.replace("\\", "/").split("/") if p and p != ".."]
   if len(parts) < 2:
       raise HTTPException(status_code=400, detail="Vigane filepath")
   catalog, filename = parts[-2], parts[-1]
   ```
   Funktsioon lubab `len(parts) >= 2`, kontrollib `_require_catalog_access(catalog, user)` ainult eelviimasel segmendil (`parts[-2]`), kuid tagastab `"/".join(parts)` (kõik segmendid). `get_commit_diff` (`git_ops.py:725`) käivitab `repo.git.diff(parent, resolved, "--", clean_path)`, kus Git tõlgendab `:(exclude)...` prefiksit pathspec-maagiana. Kui `contributor` saadab `filepath = ":(exclude)x/<avalik_kataloog>/fail.txt"` ja mõne mitut teost muutnud commiti räsi, läbib `parts[-2]` (`<avalik_kataloog>`) ligipääsukontrolli, kuid Git välistab selle raja ja tagastab commiti diffi teistest (sh piiratud kollektsiooni) failidest.

#### Soovitatav parandus
1. Valideerida `commit_hash` tsentraalselt `get_file_at_commit` (`git_ops.py:642`) ja `get_commit_diff` (`git_ops.py:696`) alguses:
   ```python
   if not isinstance(commit_hash, str) or not re.fullmatch(r"[0-9a-fA-F]{7,40}", commit_hash):
       return None  # või {"error": "Vigane commit_hash"}
   ```
2. `_catalog_from_filepath` (`editing.py:85`) sees nõuda täpselt `len(parts) == 2` ning kontrollida, et `catalog == os.path.basename(catalog)` ja ei alga `.` ega `:` märgiga.
3. `git_restore_endpoint` (`editing.py:645`) ja `person_restore` (`prosopography/router.py:952`) sees kontrollida lisaks, et `commit_hash` esineb antud faili `get_file_git_history` nimekirjas.

---

### O16-03: Hulgi-re-OCR rakendamine (`reocr_apply.py` / `routers/reocr.py`) eirab lukke, failinime valideerimist ja Meilisearchi sünkroonimist

- **Tõsidus:** Kõrge (Andmeterviklus / Otsinguindeksi triiv / Võidujooks)
- **Failid ja read:**
  - `server/reocr_apply.py:82-156` (`apply_ocr_results`)
  - `server/routers/reocr.py:46-265` (`get_page_ocr`, `delete_page_ocr`, `admin_reocr_page`, `admin_reocr_batch`, `admin_reocr_apply`, `admin_reocr_discard`)

#### Probleemi kirjeldus
1. **Meilisearch ja isikumainimised jäävad uuendamata:** `apply_ocr_results` kirjutab uued `.txt` ja lepitatud `.json` failid ning teeb Git commiti (`save_with_git`, rida 120), kuid ei kutsu välja `sync_work_to_meilisearch(folder_name)` ega `refresh_work_mentions(work_path, work_id)`. Pärast re-OCR tulemuste vastuvõtmist jääb Meilisearchi `teosed` indeksisse vana leheküljetekst.
2. **Puuduv `page_lock` / `work_lock`:** `apply_ocr_results` loeb lehe `.json` faili (`_reconcile_annotations`, rida 57) ja kirjutab `.txt`/`.json` failid üle ilma `page_lock` või `work_lock` lukuta. Samaaegne `/save` või `/page-comments/reply` samal lehel kirjutatakse üle.
3. **Puuduv `check_page_filename`:** Kõik `server/routers/reocr.py` otspunktid kasutavad ainult `os.path.basename(...)`, mitte `check_page_filename(...)` (`server/page_paths.py:21`). Kui `page_filenames` sisaldab nt `"_metadata.json"`, lõikab `_stem` (`reocr_apply.py:26`) `.json` maha ja otsib `_metadata.ocr` faili.

#### Soovitatav parandus
1. Asendada `os.path.basename` kontrollid `server/routers/reocr.py` sees `check_page_filename(fn)` väljakutsetega.
2. Hoida `apply_ocr_results` ajal `work_lock(os.path.basename(work_path), work_path)` (või iga lehe `page_lock`) lukku.
3. Kutsuda `admin_reocr_apply` (`server/routers/reocr.py:248`) või `apply_ocr_results` lõpus (kui `applied` ei ole tühi) välja `sync_work_to_meilisearch_async(os.path.basename(work_path))` ja `refresh_work_mentions(work_path, work_id)`.

---

### O16-04: Samaaegsuse ja lukustuse vead (`person_aliases.json`, `work_part_proposals.py`, `merge_ops.py`)

- **Tõsidus:** Kõrge (Vaikne andmekadu samaaegsetel operatsioonidel)
- **Failid ja read:**
  - `server/people_ops.py:13, 143-170, 268, 317-325` vs `server/prosopography/indices.py:286, 467, 509`
  - `server/work_part_proposals.py:402-440` (`decide`), `466-519` (`decide_many`), `529-558` (`resolve_person`)
  - `server/prosopography/person_crud.py:282-360` (`_propagate_name_to_works`) ja `server/prosopography/merge_ops.py:200-243` (`_merge_person_locked`)

#### Probleemi kirjeldus
1. **`person_aliases.json` kasutab kahes moodulis erinevat lukku:**
   - `server/people_ops.py:8, 13` impordib `PERSON_ALIASES_FILE as PEOPLE_FILE` ja lukustab selle lokaalse `PEOPLE_LOCK = threading.Lock()` lukuga.
   - `server/prosopography/indices.py:286, 467, 509` lukustab täpselt sama faili `state._aliases_lock` lukuga.
   - Kui `update_person_async` (`people_ops.py:140`) jookseb taustal samal ajal, kui salvestatakse prosopograafia kaarti (`_update_aliases_entry`) või jookseb `rebuild_indices`, kirjutab teine lõim esimese muudatused üle.
2. **`work_part_proposals.py` lukustamata read-modify-write ja `override` ülekirjutamisviga:**
   - `decide`, `decide_many` ja `resolve_person` loevad SQLite `proposal` kirje tavalise `SELECT`-iga, teostavad failisüsteemi ja Giti operatsioonid (`wp.create_part`, `wp.update_part`, `person_crud.create_person_checked`) ning kirjutavad lõpus mälus oleva `(items, persons)` objekti `UPDATE proposal SET payload=?` abil üle. Kaks kiiret järjestikust klikki osade ülevaatuse vaates kirjutavad teineteise otsused üle.
   - **Loogikaviga `decide` sees (`server/work_part_proposals.py:417-428`):**
     ```python
     if isinstance(item.get("attached_to"), int):
         ref = items[item["attached_to"]]
         if ref.get("status") != "accepted" or not ref.get("created_part_id"):
             raise ProposalError("parent_part_not_accepted")
         data["attached_to"] = ref["created_part_id"]
     ...
     if target:
         existing = _current_parts(work_dir).get(target)
         if not existing:
             raise ProposalError("part_not_found")
         if override is not None:
             data = dict(override)  # <-- KIRJUTAB real 421 seatud data["attached_to"] ÜLE!
     ```
   - Lisaks liidab `decide_many` (`work_part_proposals.py:486-505`) mitu sama `existing_id`-ga `update`-kirjet algse `current[item["existing_id"]]` vastu, mitte eelmise sammu tulemuse vastu.
3. **`_propagate_name_to_works` ja `_merge_person_locked` ilma `metadata_lock` lukuta ning puudulik `parts[].creators` uuendus:**
   - Nii `_propagate_name_to_works` (`person_crud.py:282-360`) kui ka `_merge_person_locked` (`merge_ops.py:200-243`) loevad ja kirjutavad `_metadata.json` faile otse ilma `metadata_lock` lukuta (`server/metadata_ops.py:26`).
   - `_merge_person_locked` (`merge_ops.py:214-232`) asendab `source_id -> target_id` ainult teose juurtaseme `creators`, `tags` ja `publisher` väljadel, kuid **jätab uuendamata `meta["parts"][*]["creators"]`** (kirjade saatjad/saajad ja teoseosade autorid, vrd `_propagate_name_to_works` ridadel 329–344, kus `parts` on olemas) ning ei kutsu välja `update_work_facts(meta, work_entry.path)`.

#### Soovitatav parandus
1. Asendada `server/people_ops.py:13` rida `PEOPLE_LOCK = threading.Lock()` impordiga `from .prosopography.state import _aliases_lock as PEOPLE_LOCK`.
2. Hoida `work_part_proposals.py` funktsioonides `decide`, `decide_many` ja `resolve_person` `wp.work_lock(work_id)` lukku üle kogu operatsiooni; eemaldada rida 428 (`if override is not None: data = dict(override)`, sest rida 415 juba tegi seda) ning uuendada `decide_many` tsüklis `current[item["existing_id"]] = data`.
3. Lisada `_merge_person_locked` (`merge_ops.py:229` järel) sisse `meta.get("parts") or []` loojate `source_id -> target_id` ümbersidumine ning teha `_metadata.json` kirjutamine `metadata_lock` all.

---

## 3. Prioriteet 2 (Keskmine) — Infolekke tõkestamine, filtri-ehitus ja servaolukorrad

---

### O16-05: Autentimata infoleke MCP handoff `submit` otspunktides enne handoff-koodi kontrollimist

- **Tõsidus:** Keskmine (Autentimata oraakel teoste olemasolu ja lehekülgede arvu kohta)
- **Failid ja read:**
  - `server/prosopography/enrichment_proposals.py:215-263` (`submit`)
  - `server/work_part_proposals.py:325-356` (`submit`) ja `server/routers/work_parts.py:137-160`

#### Probleemi kirjeldus
Mõlemad MCP `submit` otspunktid on autentimata (kaitstud ühekordse/tööpäevase `code` parameetriga ja IP rate-limitiga 30 päringut 5 minutis), kuid kontrollivad sisulisi eeltingimusi **enne** handoff-koodi räsi (`code_hash`) kontrollimist:
1. `enrichment_proposals.submit` käivitab real 236 `_check_vutt_pages(items)` ja real 242 `person.get("updated_at") != base_updated_at` enne rida 250 (`SELECT * FROM handoff WHERE code_hash=?`). `_check_vutt_pages` loeb kettalt mis tahes `work_id` (sh piiratud kollektsiooni teose) lehekülgede arvu ja tagastab HTTP 400 veateate: `"Vigane leheküljenumber {page} (teoses {work_id} on {counts[work_id]} lehekülge)"` või `"Tundmatu VUTT teos: {work_id}"`.
2. `work_part_proposals.submit` kontrollib real 333 `if version != pages_version(work_dir): raise ProposalError("stale_pages")` (tagastab HTTP 409) enne handoff-koodi kontrolli real 347.

#### Soovitatav parandus
Tõsta mõlemas `submit` funktsioonis handoff-koodi (`code_hash`) olemasolu, aegumise (`expires_at`), `used_at` ja `subject_id` kontroll **kõige esimeseks sammuks** enne failisüsteemi, `pages_version`, `updated_at` või `_check_vutt_pages` lugemist.

---

### O16-06: MCP handoff-koode ei tühistata kasutaja kustutamisel ega õiguste eemaldamisel

- **Tõsidus:** Keskmine (Kaitse sügavuti sessiooni/õiguste tühistamisel)
- **Failid ja read:**
  - `server/auth.py:387-505` (`update_user_role`, `apply_collection_rights_delta`, `delete_user`)
  - `server/work_part_proposals.py:34, 347-356`
  - `server/prosopography/enrichment_proposals.py:37, 250-262`

#### Probleemi kirjeldus
Kui admin kustutab kasutaja (`delete_user`), muudab tema rolli (`update_user_role`) või eemaldab kollektsiooniõigused (`apply_collection_rights_delta`), tühistatakse kasutaja sessioonid ja parooli lähtestamise tokenid, kuid kuni 8 tundi kehtivad MCP handoff-koodid jäävad SQLite andmebaasidesse kehtima.

#### Soovitatav parandus
Lisada `work_part_proposals.py` ja `enrichment_proposals.py` moodulitesse `revoke_user_handoffs(username: str)` (`DELETE FROM handoff WHERE issued_by=? AND used_at IS NULL`) ning kutsuda see välja `delete_user` ja `update_user_role` sees (või kontrollida `submit` hetkel, et `issued_by` kasutaja eksisteerib ja omab endiselt nõutavat rolli).

---

### O16-07: Meilisearchi filtri-stringide ekraniseerimine (`mcp/`, `src/`, `server/`)

- **Tõsidus:** Keskmine (Meilisearchi filtri süstimine / katkised otsingupäringud erimärkide korral)
- **Failid ja read:**
  - `mcp/vutt_mcp/queries.py:197-199` (`_quote`)
  - `src/utils/filterUtils.ts:8-39` (`buildTagFilter`, `buildPageTagFilter`, `buildGenreFilter`, `buildTypeFilter`, `buildPrinterFilter`)
  - `src/services/selectionFilter.ts:21, 26, 46`
  - `src/services/searchService.ts:288, 430, 433, 439, 458, 650, 689, 691, 716, 719, 925, 928`
  - `server/routers/upload.py:54-56` (`otsi_teos_external_url_jargi`)
  - `server/meilisearch_ops.py:351, 368, 418, 667, 720, 761`

#### Probleemi kirjeldus
1. **MCP `_quote` (`mcp/vutt_mcp/queries.py:197-199`):**
   ```python
   def _quote(value) -> str:
       return '"' + str(value).replace('"', '\\"') + '"'
   ```
   Funktsioon ei ekraniseeri kurakaldkriipsu (`\`) enne jutumärgi ekraniseerimist. Kui väärtus sisaldab `\"` või lõpeb `\`, muutub see `\\"`-ks, kus Meilisearch tõlgendab `\\` ekraniseeritud kurakaldkriipsuna ja `"` stringiliteraali lõpuna.
2. **Frontend (`filterUtils.ts`, `selectionFilter.ts`, `searchService.ts`):** Erinevalt `src/services/letterSearch.ts:62` funktsioonist (`const quote = (v: string) => JSON.stringify(v);`) pistavad ülejäänud frontendi filtriehitajad väärtused otse jutumärkidesse `"${val}"`. (Tenant-tokeni kollektsioonipiirangut sellega murda ei saa, sest Meilisearch jõustab tokeni reeglid eraldi, kuid URL-parameetri või märksõna sees olev `"` või `\` tekitab 400 vea või murrab kliendipoolsest filtriklauslist välja.)
3. **Backend (`upload.py:55`, `meilisearch_ops.py`):** `server/meilisearch_ops.py:270` defineerib küll turvalise `_filter_value(value: str)` (`json.dumps(value, ensure_ascii=False)`), kuid samas failis ridadel 351, 368, 418, 667, 720, 761 ja `upload.py:55` sees kasutatakse endiselt käsitsi vormindatud jutumärke.

#### Soovitatav parandus
- `mcp/vutt_mcp/queries.py:197`: asendada `return json.dumps(str(value), ensure_ascii=False)`-ga.
- `src/utils/filterUtils.ts`: eksportida `export const quoteFilterValue = (v: string): string => JSON.stringify(String(v));` ja kasutada seda kõigis `filterUtils.ts`, `selectionFilter.ts` ja `searchService.ts` filtrites.
- `server/meilisearch_ops.py` ja `server/routers/upload.py`: kasutada läbivalt `_filter_value(...)`.

---

### O16-08: `/work/{work_id}/viewer-token` kasutab sisendparameetrit `work_id` kanoonilise `meta["id"]` asemel

- **Tõsidus:** Keskmine (Katkine pildi/otsingu token, kui teose poole pöördutakse kaustanime või slugiga)
- **Failid ja read:** `server/routers/public.py:63-86` (`get_viewer_token`)

#### Probleemi kirjeldus
`get_viewer_token(work_id)` laeb `meta = _load_work_metadata(work_id)`, mis lubab `work_id` asemel ette anda ka kaustanime või `slug`-i (`find_directory_by_id`). Ridadel 75 ja 80 kasutab funktsioon aga toorest URL-i parameetrit `work_id`:
```python
meili_token = generate_work_scoped_meili_token(work_id)
...
image_msg = f"image:{work_id}:{image_exp}".encode()
```
Samal ajal kontrollib `image_server.py:448` HMAC-allkirja kanoonilise `meta["id"]` vastu (`f"image:{meta['id']}:{exp}"`) ja Meilisearchis on `work_id` võrdne `meta["id"]`-ga.

#### Soovitatav parandus
Kasutada `canonical_id = meta.get("id") or work_id` nii `generate_work_scoped_meili_token(canonical_id)` kui ka `f"image:{canonical_id}:{image_exp}"` arvutamisel.

---

### O16-09: MCP `search_pages` pagineerimise loogikaviga (`offset > 0` tagastab tühja tulemuse)

- **Tõsidus:** Keskmine (Funktsionaalne viga MCP otsingutööriistas)
- **Failid ja read:**
  - `mcp/vutt_mcp/queries.py:155-164` (`apply_spread_window`) ja `243-255` (`build_search_body`)
  - `mcp/vutt_mcp/server.py:155-172` (`search_pages`)

#### Probleemi kirjeldus
Kui `search_pages` kutsutakse ilma `work_id`-ta (`kapp = PAGES_PER_WORK = 3`), küsib `apply_spread_window` Meilisearchist alati `page = 1` kuni `MAX_FETCH = 60` vastet. Seejärel kärbib `cap_pages_per_work` (`server.py:163`) need 60 vastet nii, et igast teosest jääb alles maksimaalselt 3 lehekülge (nt 8 teose puhul jääb `hits` pikkuseks ≤24). Real 164 tehakse `hits = hits[offset:offset + limit]`. Kui agent küsib järgmise lehe (`offset=20` või `offset=60`, mida rida 171 ise soovitab: `Järgmine leht: offset=...`), on `offset >= len(hits)` ja tööriist tagastab `"Vasteid ei leitud."`, kuigi `totalHits` on suur. Lisaks ei klammerdata negatiivset `offset` väärtust (`offset < 0`).

#### Soovitatav parandus
1. Klammerdada `offset = max(0, int(offset))` ja `limit = max(1, min(int(limit), MAX_PAGE_LIMIT))`.
2. Arvestada `edasi` (`Järgmine leht: offset=...`) arvutamisel kärbitud akna tegelikku suurust (`len(capped_hits)` ja `MAX_FETCH`), või pagineerida Meilisearchi päringut, kui `offset` ületab esimese ületõmbeakna.

---

### O16-10: Konkurentsiauk `registration.py` ja `auth.py` parooli lähtestamise voos

- **Tõsidus:** Keskmine (Andmekadu samaaegsetel registreerimistel / ühekordse tokeni võidujooks)
- **Failid ja read:**
  - `server/registration.py:18, 52-91, 94-142, 154-164` (`add_registration`, `update_registration_status`)
  - `server/routers/auth.py:216-247` (`reset_set_password`)

#### Probleemi kirjeldus
1. `load_pending_registrations()` ja `save_pending_registrations()` võtavad `registrations_lock` luku ainult faili lugemise ja kirjutamise hetkeks. Erinevalt `create_invite_token` funktsioonist (`registration.py:315`), kus `with tokens_lock:` ümbritseb kogu read-modify-write tsüklit, on `add_registration` ja `update_registration_status` vahepealne töö lukustamata.
2. `reset_set_password` (`routers/auth.py:216-247`) kontrollib `validate_reset_token(token)`, kirjutab `users.json` ja kutsub alles seejärel `mark_reset_token_used(token)` ilma kogu operatsiooni katva lukuta.

#### Soovitatav parandus
Muuta `registrations_lock = threading.RLock()` ja hoida `with registrations_lock:` üle kogu `add_registration` ning `update_registration_status` funktsiooni; parooli lähtestamisel hoida `file_lock(PASSWORD_RESETS_FILE)` (või kontrollida ja märkida token kasutatuks atomaarselt).

---

### O16-11: Meilisearchi sünkroniseerimise servajuhud ja kaanepildi JSON-lugemine (`R24-06`)

- **Tõsidus:** Keskmine (Otsinguindeksi kooskõla ja jõudlus)
- **Failid ja read:**
  - `server/meilisearch_ops.py:215-219` (`sync_work_to_meilisearch`)
  - `server/meilisearch_ops.py:585-640` (`update_collection_is_public_async`)
  - `server/image_server.py:133-162, 302-316` (`get_first_image`, `get_or_create_thumbnail` — varasem **R24-06**)

#### Probleemi kirjeldus
1. **Viimase lehekülje kustutamine teosest (`meilisearch_ops.py:215-219`):** Kui teosest kustutatakse kõik leheküljed (`not documents`), kustutab rida 217 küll kirjad (`delete_work_letters`), kuid jätab kutsumata `_delete_extra_pages(meta.get('id') or teose_id, 0)`, mistõttu vanad leheküljed jäävad `teosed` indeksisse alles.
2. **Alamkollektsiooni avalikkus (`meilisearch_ops.py:600`, `meili_doc.py:502`, `access_ops.py:19`):** Teose `is_public` arvutatakse ainult otseste `work_cols` kollektsioonide `visibility` järgi. Kui vanemkollektsioon muudetakse privaatseks, kuid alamkollektsioonil endal `visibility` väli puudub (vaikimisi `"public"`), jäävad alamkollektsiooni teosed avalikuks.
3. **Avatud R24-06 (`image_server.py:302-316`):** `get_or_create_thumbnail` kutsub iga `/_thumb/{slug}` ja `/_og/{slug}` päringu alguses välja `get_first_image(work_path)` (mis avab ja parsib kõik teose lehekülgede `.json` failid, et välistada `strikethrough` lehed) **enne**, kui kontrollib, kas `_cover_v2_{size}_{page_base}.jpg` on kettal juba olemas.

#### Soovitatav parandus
1. Kutsuda `not documents` harus välja `_delete_extra_pages(meta.get('id') or teose_id, 0)`.
2. Kontrollida `get_or_create_thumbnail` alguses `glob` abil olemasolevat `_cover_v2_{size}_*.jpg` faili ja selle `mtime`-i `_metadata.json` vastu enne `get_first_image` käivitamist.

---

## 4. Prioriteet 3 (Madal) — Süvakaitse, välispäringud, Nginx ja hooldatavus

---

### O16-12: Välispäringute sisendite valideerimine (GND ID, VIAF XML, ADA `bitstream_uuid`)
- **Asukoht:**
  - `server/prosopography/enrichment.py:514-523` (`_fetch_gnd_dnb`), `618-627` (`_fetch_lobid_raw`), `650-659` (`_parse_viaf_rdf`)
  - `server/ada/fetch.py:178-181` ja `server/upload_ops.py:260`
- **Probleem:**
  - `_fetch_wikidata` kontrollib `^Q\d+$` ja `_fetch_viaf` kontrollib `.isdigit()`, kuid `_fetch_lobid_raw(gnd_id)` ja `_fetch_gnd_dnb(gnd_id)` panevad `gnd_id` otse URL-i sisse ilma `_GND_ID_RE` (`^[0-9]+[0-9X-]*$`, mis on `candidates.py:164` sees juba olemas) kontrollita.
  - `_parse_viaf_rdf` kasutab `xml.etree.ElementTree.fromstring(xml_text)` ja `resp.read()` ilma suuruspiirita (teoreetiline XML Entity Expansion / DoS oht vigase välisvastuse korral).
  - `ada/fetch.py:178` paneb `bitstream_uuid` URL-i sisse ilma UUID regulaaravaldise kontrollita.
- **Soovitus:** Valideerida `gnd_id` mustriga `^[0-9]+[0-9X-]*$`, `bitstream_uuid` UUID mustriga `^[0-9a-fA-F-]{36}$` ning kehtestada VIAF XML vastusele pikkuspiir (nt 2 MB) ja keelata `<!ENTITY` deklaratsioonid.

---

### O16-13: Nginxi `vutt_auth` rate-limit (`nginx.host.conf`) ja `/register/username-preview`
- **Asukoht:**
  - `nginx.host.conf:138`
  - `server/routers/auth.py:147-154` (`GET /register/username-preview`)
  - `server/rate_limit.py:87-103` (`get_client_ip`)
- **Probleem:**
  1. `nginx.host.conf:138` rakendab ranget `vutt_auth` (1 r/s, burst 5) tsooni ainult `location ~ ^/api/files/(login|register|invite/set-password)$` peal, jättes `/api/files/reset/validate` ja `/api/files/reset/set-password` üldise `vutt_api` (10 r/s, burst 20) alla.
  2. `GET /register/username-preview` on autentimata ja ilma rakendusesisese rate-limitita, võimaldades skriptiga kontrollida kasutajanimede hõivatust (`users.json`, `deleted_usernames.json`, `pending_registrations.json`, `invite_tokens.json`).
- **Soovitus:** Laiendada `nginx.host.conf:138` mustrit kujule `^/api/files/(login|register|invite/set-password|reset/validate|reset/set-password)$` ning lisada `/register/username-preview` otspunktile `check_rate_limit`.

---

### O16-14: Süvakaitse failiteedele ja lukkudele (`trash_ops.py`, `upload_ops.py`, `user_settings_ops.py`)
- **Asukoht:**
  - `server/trash_ops.py:92-125` (`restore_deleted_work`) ja `266-325` (`restore_deleted_page`)
  - `server/upload_ops.py:626-739` (`replace_work_content`)
  - `server/user_settings_ops.py:8-27` ja `server/routers/user_settings.py:62-83`
- **Probleem:**
  1. `restore_deleted_work(work_id)` ei valideeri `work_id` formaati (erinevalt `history_thumbs.py:22`, mis kontrollib `^[a-zA-Z0-9_-]{1,64}$`), vaid paneb selle `os.path.join(TRASH_DIR, work_id)` ja Git `--grep` regulaaravaldisse `f'\\[{work_id}\\]'`. `restore_deleted_page` ei kasuta `check_page_filename(filename)`.
  2. `replace_work_content` (`upload_ops.py:626`) asendab teose failid ilma `work_lock(slug, work_dir)` lukuta ning arvutab real 632 `trash_base` enne, kui rida 643 kirjutab `target_work_id = existing_meta.get('id')`.
  3. `user_settings_ops.py` ei kasuta `os.path.basename(username)` ega faililukku `load_user_settings` -> `save_user_settings` vahel.
- **Soovitus:** Valideerida `work_id` ja `filename` `trash_ops.py` sees, võtta `replace_work_content` ümber `work_lock` ning lisada `user_settings_ops.py`-sse lukk ja `os.path.basename(username)`.

---

### O16-15: `work_part_proposals.db` failiõigused ja `async def` blokeeriv I/O `notifications.py`-s
- **Asukoht:**
  - `server/work_part_proposals.py:58-65` (`_connect`)
  - `server/routers/notifications.py:213-220` (`get_notification_recipients`)
- **Probleem:**
  1. `enrichment_proposals._connect` (`server/prosopography/enrichment_proposals.py:55-60`) loob SQLite faili `os.open(..., 0o644)` ja `os.chmod(DB_PATH, 0o644)` abil, et hosti tavakasutaja (`vutt_backup.py`) saaks `root`-konteineri loodud `.db` faili lugeda. `work_part_proposals._connect` (`server/work_part_proposals.py:60`) teeb tavalise `sqlite3.connect(DB_PATH)` ilma `0o644` õigusteta.
  2. `get_notification_recipients` (`server/routers/notifications.py:213`) on `async def`, kuid kutsub sünkroonset `get_all_users()` otse event-loopis (rikub ADR 0002 reeglit).
- **Soovitus:** Lisada `work_part_proposals._connect` sisse sama `0o644` failiõiguste tagamine nagu `enrichment_proposals._connect` sees ning muuta `get_notification_recipients` tavaliseks `def` funktsiooniks.

---

### O16-16: Frontend HTML-kaitsetest (`dangerouslySetInnerHTMLGuard.test.ts`) ja välislinkide kodeerimine
- **Asukoht:**
  - `src/utils/__tests__/dangerouslySetInnerHTMLGuard.test.ts:25-26`
  - `src/utils/renderVuttMarkup.ts:10`
  - `src/pages/admin/Maintenance.tsx:346-349`
  - `src/utils/entityUrl.ts:20-30`, `src/prosopography/pages/PersonEditPage.tsx:741-747`, `src/pages/manage/parts/ProposedPersons.tsx:15-19`
- **Probleem:**
  1. `dangerouslySetInnerHTMLGuard.test.ts` otsib ainult `dangerouslySetInnerHTML\s*=`, jättes kontrollimata otse DOM-i `.innerHTML =`, `.outerHTML =` ja `.insertAdjacentHTML(` omistamised (nt `src/components/editor/MarginaliaExtension.ts:357`).
  2. `renderVuttMarkup.ts:10` kasutab `/<(?!\/?(?:b|i|cs|m|hi|add|fn|pb|ann\d+)\b)/g`, mis laseb esimesest sammust läbi atribuutidega märgendid (need eemaldatakse küll real 32, kuid `\s*\/?>` oleks juba esimeses sammus täpsem).
  3. `Maintenance.tsx:346` renderdab `<a href={info.url}>` ilma `/^https?:\/\//i.test(info.url)` kontrollita; `entityUrl.ts`, `PersonEditPage.tsx` ja `ProposedPersons.tsx` pistavad välised ID-d URL-i sisse ilma `encodeURIComponent(...)` kutseta.
- **Soovitus:** Laiendada `dangerouslySetInnerHTMLGuard.test.ts` mustrit (lisades `MarginaliaExtension.ts` teadlikult lubatud nimekirja), kontrollida `Maintenance.tsx` sees `^https?:\/\/` prefiksit ja kasutada `encodeURIComponent` väliste ID-de URL-ide ehitamisel.

---

### O16-17: Dokumentatsiooni ja skriptide pisivastuolud
- **Asukoht:**
  - `docs/tegemata_tood.md:25-31` — väidab endiselt, et `_check_image_access` tagastab `meta is None` korral `True` (tegelikult parandatud `server/image_server.py:438-440`, kus tagastatakse `False`).
  - `mcp/README.md:284` — väidab *"Skaneeringu piltide baite ei väljastata kunagi — ainult töölaua lingid"*, kuigi vahepeal lisati `get_page_image` tööriist (`mcp/README.md:86, 114`).
  - `scripts/fix_filterable.sh:6-9` — kasutab muutujat `$MEILI_KEY` (`$MEILI_MASTER_KEY` asemel).
  - `mcp/vutt_mcp/persons.py:86, 244` — `detail()` ja `_relations_section()` ei kasuta `_PERSON_ID.fullmatch(person_id)` ega `quote(person_id, safe='')` kontrolli, mis on `enrichment_context()` sees (rida 127) juba olemas.

---

## 5. Soovitatav tööjärjekord (tegevusplaan)

Seis: vt jaotis 0 (`[x]` tehtud, kõik tehtud). Allolev kontrollnimekiri on järjestatud nii, et iga samm on iseseisvalt testitav ja kommititav:

- [x] **Samm 1 (O16-01):** Kaitsta `apply_enrichment` (`server/prosopography/person_crud.py:603-654`) süsteemiväljade ülekirjutamise eest + lisada `name.label` muutumisel nime propagatsioon.
- [x] **Samm 2 (O16-02):** Lisada `commit_hash` hex-SHA valideerimine (`server/git_ops.py:642, 696`), piirata `_catalog_from_filepath` täpselt 2 segmendile (`server/routers/editing.py:80-90`) ning kontrollida `commit_hash` kuulumist faili ajalukku `git_restore_endpoint` ja `person_restore` sees.
- [x] **Samm 3 (O16-03):** Lisada `reocr.py` ja `reocr_apply.py` sisse `check_page_filename`, `work_lock`, `sync_work_to_meilisearch_async` ja `refresh_work_mentions`.
- [x] **Samm 4 (O16-04):** Ühtlustada `person_aliases.json` lukk (`server/people_ops.py:13`), parandada `work_part_proposals.py` lukustus ja rida 428 `override` viga ning lisada `_merge_person_locked` sisse `parts[].creators` uuendus ja `metadata_lock`.
- [x] **Samm 5 (O16-05, O16-06):** Tõsta handoff-koodi kontroll `enrichment_proposals.submit` ja `work_part_proposals.submit` algusesse ning tühistada kasutaja handoff-koodid kasutaja kustutamisel / rolli muutmisel.
- [x] **Samm 6 (O16-07, O16-08):** Parandada Meilisearchi filtri-stringide ekraniseerimine (`mcp/vutt_mcp/queries.py`, `src/utils/filterUtils.ts`, `src/services/selectionFilter.ts`, `src/services/searchService.ts`, `server/meilisearch_ops.py`, `server/routers/upload.py`) ja `canonical_id` kasutus `get_viewer_token` sees (`server/routers/public.py:63-86`).
- [x] **Samm 7 (O16-09, O16-10, O16-11):** Parandada MCP `search_pages` pagineerimine, `registration.py` lukustus, `meilisearch_ops.py` tühja teose lehekülgede kustutamine ja `image_server.py` kaanepildi vahemälu kontroll (**R24-06**).
- [x] **Samm 8 (O16-12 .. O16-17):** Süvakaitse ja hooldustööd (GND/VIAF/ADA valideerimine, Nginxi `vutt_auth` laiendamine `/reset/*` peale, `trash_ops.py` / `user_settings_ops.py` valideerimine, `work_part_proposals.db` `0o644` õigused, `dangerouslySetInnerHTMLGuard.test.ts` laiendamine ja dokumentatsiooni uuendamine).
