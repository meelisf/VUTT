# Andmete Migratsiooni Plaan (v1 -> v2)

See dokument kirjeldab tegevuskava üleminekuks vanalt andmemudelilt (v1: `pealkiri`, `aasta`, `koht`, `trükkal`) uuele, standardiseeritud andmemudelile (v2: `title`, `year`, `location`, `publisher`).

**Eesmärk:** Eemaldada koodibaasist ja andmebaasist dubleerivad väljad, mis tekitavad segadust ("zombie-andmed") ja tehnilist võlga.

---

## 1. Faas: "Verejooksu" peatamine (Backend & Modal)

Praegu salvestatakse vanad väljad uuesti, sest backend teeb `update()` ja frontend saadab vanad väljad tagasi.

### 1.1. Backend: `server/main.py` - Sanitaarkontroll
Muuta `update_work_metadata` funktsiooni nii, et see ei teeks pimedat `meta.update(data)`, vaid kirjutaks faili ainult lubatud (v2) väljad.

**Tegevus:**
* Defineerida `ALLOWED_METADATA_FIELDS` nimekiri (title, year, location, publisher, creators, tags, collection, type, genre, languages, ester_id, external_url).
* Salvestamisel luua uus sõnastik ainult nende võtmetega.
* See kustutab automaatselt `_metadata.json` failist vanad `pealkiri`, `aasta` jms väljad järgmisel salvestamisel.

### 1.2. Frontend: `src/components/MetadataModal.tsx`
Peatada vanade väljade "ringlusesse" saatmine pärast salvestamist.

**Tegevus:**
* Funktsioonis `handleSave` -> `onSaveSuccess` eemaldada objektist kõik v1 vasted:
    * Eemalda: `pealkiri`, `aasta`, `koht`, `trükkal`, `autor`, `respondens`.
    * Jäta alles: `title`, `year`, `location`, `publisher`, `creators`.

---

## 2. Faas: Frontendi normaliseerimine (Service Layer)

Isolatsioonikihi loomine, et komponendid ei peaks tegelema v1/v2 loogikaga.

### 2.1. `src/services/meiliService.ts`
Tsentraliseerida andmete puhastamine. Komponendid ei tohi enam teha `hit.year ?? hit.aasta`.

**Tegevus:**
* Luua abifunktsioon `normalizeWork(hit: any): Work`.
* See funktsioon võtab Meilisearchi "toore" vastuse (kus võivad olla `aasta` jne filtreerimiseks) ja tagastab puhta `Work` objekti, kus on **ainult** `year`, `title` jne.
* Kõik komponendid (`SearchPage`, `WorkCard`, `Workspace`) peavad kasutama seda puhastatud objekti.

---

## 3. Faas: Koodi puhastus (The Type Shock)

See on kõige radikaalsem, kuid vajalik samm, et leida üles kõik kohad, mis veel vanu andmeid kasutavad.

### 3.1. `src/types.ts`
Eemaldada `Work` ja `Page` liidestest (interface) kõik `@deprecated` väljad.

**Tegevus:**
* Kustuta:
    ```typescript
    // KUSTUTA NEED READ:
    pealkiri?: string;
    aasta?: number;
    koht?: string;
    trükkal?: string;
    autor?: string;
    respondens?: string;
    originaal_kataloog?: string;
    ```

### 3.2. Vigade parandus
Pärast tüüpide muutmist muutub projektis ~20 faili "punaseks". Need tuleb käsitsi läbi käia ja asendada uute väljadega.

* **Ohtlikud kohad:** `Workspace.tsx`, `SearchPage.tsx`, `TextEditor.tsx`.
* **Lahendus:** Kasuta ainult v2 välju. Kui v2 väli on `undefined`, siis on see `undefined` – ära otsi enam `hit.aasta` tagavaraks. (Eeldab, et Faas 2 on tehtud).

---

## 4. Faas: Andmete puhastus (Data Cleanup Script)

Lõplik puhastus serveris, et eemaldada failisüsteemist ajalooline taak.

### 4.1. Pythoni skript
Luua skript `scripts/cleanup_metadata_v1.py`, mis:
1. Käib läbi kõik kaustad `reference_data/` (või andmekataloogis).
2. Loeb sisse `_metadata.json`.
3. Kustutab võtmed: `pealkiri`, `aasta`, `koht`, `trükkal`, `autor`, `respondens`, `trükikoda`.
4. Salvestab faili uuesti ainult siis, kui midagi muutus.

---

## Kokkuvõte

| Faas | Tegevus | Mõju |
| :--- | :--- | :--- |
| **1** | Backend & Modal fix | Peatab uue prahi tekkimise ja salvestamise. |
| **2** | Service Normalizer | Peidab vana andmekuju komponentide eest. |
| **3** | Type Cleanup | Sunnib koodi kasutama ainult uusi välju (compile errors). |
| **4** | Data Script | Puhastab ajaloolised failid kettal. |
