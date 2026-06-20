# Lehekülgede hulgivalik: liigutamine ja kustutamine

**Kuupäev:** 2026-06-20
**Leht:** `/work/{workId}/manage` → "Leheküljed" tab (`src/pages/WorkManage.tsx`)
**Roll:** ainult admin (sama kui kogu manage-leht)

## Probleem

Manage-lehel saab praegu lehekülgi liigutada ja kustutada ainult **ükshaaval**:

- **Kustutamine** — iga lehe pisipildil on prügikasti-nupp; üks `DELETE /admin/work/{id}/page/{num}` korraga (eraldi git-commit + Meilisearch reindeks iga lehe kohta).
- **Liigutamine** — igal pisipildil on number-väli + üles/alla nooled; muudatused kogunevad `draftPositions`-mustrisse, salvestatakse `POST /admin/work/{id}/reorder-pages`-iga (üks commit).

Suurte dokumentide (kuni ~500 lk) puhul on mõlemad valusalt aeglased. Lisaks on praegune number-välja semantika segadusttekitav: et viia lk 1 kümnest kõige lõppu, tuleb trükkida `10` (mitte loomulik `11`), sest väli tähendab "millisesse pesasse see leht satub".

## Eesmärk

"Leheküljed" tabis:

1. **Vali mitu lehekülge** (märkeruut, shift-vahemik, "Vali kõik").
2. **Liiguta valitud plokk** uude kohta **sama teose sees**, lihtsa ja ettearvatava "lehe N järele" semantikaga.
3. **Kustuta valitud leheküljed** korraga (üks atomaarne operatsioon).

**Skoobist väljas:** lehekülgede liigutamine *teise teosesse* (eraldi, suurem projekt); drag-and-drop (ei skaleeru 500 lk peale); rippmenüü-põhine sihtvalik (nimekiri muutuks hiiglaslikuks).

## Liigutamise semantika — "lehe N järele"

Üks reegel, mis kehtib **kõikjal** (üksiku lehe liigutamine = ploki liigutamine, kus plokis on üks leht):

Sihtnumber `N` tähistab **lehekülge tema PRAEGUSE numbri järgi**, mille **järele** valitud plokk asetatakse. Ankur tuvastatakse füüsilise lehe identiteedi järgi, seega leitakse see ka pärast valitud lehtede väljavõtmist.

**Algoritm:**
1. Järjesta kõik lehed praeguse `page_num` järgi.
2. Plokk = valitud lehed nende praeguses järjekorras.
3. Ülejäänud = mittevalitud lehed praeguses järjekorras.
4. Aseta plokk sihtkoha järgi:
   - `N = 0` (või tühi) → ülejäänute **algusesse**;
   - `N ≥ viimase lehe number` → ülejäänute **lõppu**;
   - muidu → leia ülejäänutest leht, mille praegune number on `N`, ja aseta plokk **vahetult selle järele**.
5. Renummerda 1..n.

**Lenientsus (tahtlik):** number klammerdatakse tähendusrikkalt. 10-leheküljelise teose puhul saadavad nii `10` kui `11` ploki lõppu. See vastab kasutaja kahele eri intuitsioonile ("lehe 10 järele" vs "loomulik 11") ja on kooskõlas olemasoleva reorder-koodi klammerdusega (`Math.max(1, Math.min(pages.length, parsed))`), ainult et nüüd on klammerdus nähtav ja tähenduslik.

**Elav eelvaade:** trükkimise ajal kuvatakse välja all täpne sihtkoht:
- `→ lehtede 9 ja 10 vahele`
- `→ algusesse`
- `→ lõppu`

**Servajuht — ankur on valitud:** kui `N` osutab lehele, mis on ise valitud (nt vali 1–5, trüki 3), on see vasturääkiv. "Liiguta" nupp on keelatud + vihje (nt "Vali sihtleht väljaspool valikut").

**Näide (kasutaja oma):** 10 lehte, vali 1–5, trüki 9.
Plokk `[1,2,3,4,5]` välja → ülejäänud `[6,7,8,9,10]` → aseta lehe 9 järele → `[6,7,8,9,1,2,3,4,5,10]` → renummerda. Tulemus: 6,7,8,9 jäävad, valik tuleb nende järele, vana lk 10 jääb lõppu.

## Liides (Leheküljed tab)

**Pisipildi muutused:**
- Lisa **märkeruut** igale pisipildile (klõps lülitab; shift-klõps = vahemik viimasest klõpsust). Valitud = rõngas/ring-esiletõst.
- **Eemalda** segadusttekitav pisipildi number-väli + ↵-rakenda-nupp.
- **Säilita** üles/alla nooled (üksammuline nügimine, ühemõtteline).

**Valiku-riba** (ilmub kui ≥1 valitud, lehtede ruudustiku kohale):
- `Valitud: N`
- "Vali kõik" / "Tühista valik"
- sihtnumbri väli — silt *"lehe ___ järele"*
- elav eelvaade-tekst (vt ülal)
- **Liiguta** nupp
- **Kustuta valitud** nupp

**Liigutamise voog:** "Liiguta" arvutab uue täisjärjekorra (vt algoritm), kirjutab selle olemasolevasse **`draftPositions`** olekusse → amber-eelvaade süttib lehtedel → kasutaja vaatab üle ja vajutab olemasolevat **"Salvesta järjekord"** nuppu, mis POST-ib `/reorder-pages`-i. **Liigutamine ei vaja uut backend-endpointi.** Salvestamise eel on muudatus täielikult ülevaadatav ja tühistatav.

**Kustutamise voog:** "Kustuta valitud" → kinnitusdialoog (N lehega) → uus `POST /admin/work/{id}/delete-pages` → värskenda. Pehme kustutus → taastatav "Prügikast" tabist (käitumine ei muutu).

## Backend

### Liigutamine — muudatusi pole

Taaskasutab täielikult olemasolevat `POST /admin/work/{work_id}/reorder-pages`-i (`server/admin_page_ops.py::reorder_pages`). Frontend arvutab uue failinimede järjekorra ja saadab selle. Backend valideerib (samad failid, sama arv) ja kirjutab `sequence` väärtused + üks git-commit.

### Kustutamine — uus batch-endpoint

Olemasoleva `DELETE .../page/{page_num}`-i **tsüklis kutsumine on vigane**: pärast lehe `3` kustutamist saab lehest `4` leht `3`, seega positsiooni-põhine tsükkel kustutaks valed lehed. Lisaks teeks see N git-commit'i + N reindeksit.

**Uus endpoint:** `POST /admin/work/{work_id}/delete-pages`
- Body: `{ "base_names": ["slug_pg_001", "slug_pg_002", ...] }` (lahendatud failinime-tüvi, mitte positsioon — nihke-immuunne).
- Roll: `require_role("admin")`.
- Loogika (`work_lock` all):
  1. Lahenda kõik `base_names` praeguste failide vastu; tundmatud → kogu listi vastusesse (`not_found: [...]`), kustuta ülejäänud (osaliselt edukas) VÕI tagasta 400 kui ükski ei sobi — **otsus: kustuta leitud, tagasta `not_found` nimekiri**, et UI saaks teavitada.
  2. Liiguta iga `.jpg` prügikasti (`BASE_DIR/._trash/{work_id}/pages/`), nagu üksik-kustutus.
  3. Kustuta kõigi lehtede `.txt` + `.json` gitist **ühe commit'iga**.
  4. **Üks** `sync_work_to_meilisearch(folder_name)` kõigi järel.
  5. Tagasta `{ status, deleted: [...], not_found: [...], new_page_count }`.
- Uus op-funktsioon `server/admin_page_ops.py::delete_pages(work_id, base_names, username)` — batch-versioon olemasolevast loogikast; vajab `delete_page_from_git`-i batch-varianti VÕI mitme tee lisamist ühte commit'i (`repo.index.remove([...])` + üks `commit`).

## Testitavus

**Frontend — puhas funktsioon:** ekstrakti ploki-liigutamise loogika eraldi utiliiti (sama muster mis `src/utils/bulkAddChunks.ts`):

`src/utils/blockReorder.ts` → `computeBlockMoveOrder(pages, selectedFilenames, targetN): string[]`

Üksuse testid (`*.test.ts`):
- plokk algusesse (`N=0`);
- plokk lõppu (`N=last`, `N>last` → mõlemad lõppu);
- plokk keskele (kasutaja näide: 1–5 → lehe 9 järele);
- üks leht (plokk pikkusega 1);
- järjestikused vs hajutatud valikud (säilitab valiku suhtelise järjekorra);
- servajuht: `N` osutab valitud lehele → funktsioon ei tohi tekitada vigast järjekorda (kutsuja keelab nupu, aga funktsioon peab olema turvaline).

**Backend — `tests/test_*`:**
- bulk-delete mitu lehte → üks commit, üks reindeks (mock `sync_work_to_meilisearch`, kontrolli kutsete arvu = 1);
- olematu `base_name` → `not_found`-is, ülejäänud kustutatud;
- kustutatud `.jpg` on prügikastis, `.txt`/`.json` gitist eemaldatud;
- `new_page_count` korrektne.

## i18n

Uued võtmed `src/locales/{et,en}/workspace.json` alla `manage`-sse, nt:
- `manage.select.all`, `manage.select.clear`, `manage.select.count`
- `manage.move.label` ("lehe ___ järele"), `manage.move.button`
- `manage.move.previewBetween`, `manage.move.previewStart`, `manage.move.previewEnd`
- `manage.move.anchorInSelection` (vihje)
- `manage.bulkDelete.button`, `manage.bulkDelete.confirm` (count), `manage.bulkDelete.partial` (not_found)

## Maht

| Osa | Hinnang |
|-----|---------|
| Backend `delete-pages` op + endpoint + testid | ~0.5 päeva |
| Frontend: valiku-UI, `blockReorder.ts` + testid, riba, eelvaade, kustutus-juhtmestik | ~0.5–1 päeva |
| i18n + manuaaltest serveris | väike |
| **Kokku** | **≈ 1–1.5 päeva**, madal risk |

Madal risk, sest liigutamine sõidab täielikult tõestatud reorder-draft/save-voo peal, kustutamine on olemasoleva koodi batch-versioon, ja ainus tõeliselt uus loogika on väike puhas (testitav) ploki-paigutuse matemaatika + valiku-liides.
