# Lehe salvestus: kolmesuunaline liitmine vana avatud redaktori vastu (#455)

**Kuupäev:** 2026-09-26 · **Issue:** #455 · **Eelnev:** #416, ADR 0053 (lehelukk)

> **Ülevaatamiseks:** kasutaja kinnitas lähenemise (serveripoolne liitmine luku all,
> klient saadab baasseisu) ja ambitsiooni (automaatne liitmine, küsi ainult päris
> kokkupõrkel). Allpool **[otsustatud ilma kasutajata]** märgitud punktid valisin
> ise, sest kasutaja palus töö lõpuni viia ja oli eemal.

## Probleem

Redaktori Ctrl+S (`/save`) saadab lehe `meta_content`-i **tervikuna**, sh kommentaarid.
Kui vahepeal muutis lehte keegi teine (vastas kommentaarile, salvestas teises aknas,
taastas versiooni, re-OCR), kirjutab vana avatud redaktor selle vaikselt üle.

Lisaks: redaktor laeb lehe **Meilisearchist**, mis uueneb pärast salvestust
asünkroonselt. Oma salvestuse järel samale lehele tagasi tulles võib redaktor
näidata vana seisu ja järgmine Ctrl+S kirjutab oma eelmise muudatuse üle.

## Eelkontroll (tootmine, 2026-09-26)

1000 juhuslikku lehte 29 395-st: redaktori väljad (`text_content`, `status`,
`comments`, `text_annotations`, `page_tags_object`) on Meilis ja kettal **baitides
võrdsed** (0 erinevust). Valekonflikti risk projektsiooni erinevusest on madal.
Meili kommentaarid läbivad `normalize_eszett`-i (ß → ss, #228) — valimis 0 sellist
lehte, aga võrdlus peab seda arvestama.

## Lahendus

Klient saadab salvestusega kaasa **baasseisu** — lehe väljad nii, nagu ta need
laadis või viimati salvestas. Server võrdleb lehe luku all (ADR 0053) baasseisu
kettal olevaga (*theirs*) ja kliendi uue seisuga (*mine*) ning liidab väljade kaupa.

### Leping

`POST /save` keha saab valikulise välja:

```json
"base": {
  "text_content": "...", "status": "Töös", "page_tags": [...],
  "comments": [...], "text_annotations": [...]
}
```

- **`base` puudub** → senine käitumine (vana vahemälus bundle). **[otsustatud ilma
  kasutajata]** Vana bundle kaob `--delete` rsynciga ja brauseri cache aegumisel;
  range nõue murraks salvestuse neil, kellel vana tab lahti.
- **Liitmine puhas, *theirs* ei panustanud** → vastus nagu praegu.
- **Liitmine puhas, *theirs* panustas** → kirjutatakse liidetud seis; vastuses
  `"merged": true` ja `"page": {text_content, status, page_tags, comments,
  text_annotations}` — klient võtab selle üle.
- **Kokkupõrge** → **409**, midagi ei kirjutata:
  `{"conflict": true, "fields": ["text", "comments:c1", ...], "current": {...}}`.

### Liitmisreeglid (`server/page_merge.py`, puhas funktsioon)

`merge_page(base, mine, theirs) -> (merged, conflicts)`. Iga üksuse kohta:
`mine == base` → *theirs*; `theirs == base` → *mine*; `mine == theirs` → *mine*;
muidu kokkupõrge.

- **Tekst + `text_annotations` on ÜKS üksus** (`"text"`): ankrud elavad tekstis
  (ADR 0041), eraldi liitmine võiks kirje ankrust lahutada.
- **`status`** ja **`page_tags`** — kumbki oma üksus.
- **Kommentaarid id kaupa** (`"comments:<id>"`):
  - ainult ühel pool lisatud → võetakse;
  - mõlemas olemas → üldreegel (kommentaar tervikuna, sh `replies`);
  - ühel pool kustutatud: teine pool muutmata → kustutatakse; muudetud
    (nt vastus lisatud) → kokkupõrge;
  - järjekord: *theirs* järjekord, *mine* uued lõppu.
- **Võrdlus normaliseeritud kujul:** kommentaari `text` läbi `normalize_eszett`,
  kõik väljad kanoonilise JSON-ina (`sort_keys`). Nii ei tee Meili ß → ss kuju
  valekonflikti; kui *mine* = *base* (normaliseeritult), võetakse *theirs* toores
  väärtus — puutumata kommentaar säilitab kettal ß-i (parandab senise vaikse
  ß → ss tagasikirjutuse).

### Server

`_save_page_locked` (`server/routers/editing.py`) luku all:

1. Loe *theirs* kettalt sama projektsiooniga mis `meili_doc` (`.txt`, fallback JSON
   `text_content`; `meta_content`/juur; `page_tags` → `tags` fallback; staatus
   vaikimisi `Toores`). Projektsioon ühes funktsioonis (`page_merge.read_page_view`).
2. `base` olemas → `merge_page`. Kokkupõrge → 409 info.
3. Kirjuta liidetud tekst ja `meta_content` (kliendi `history`/`work_id`/`updated_at`
   + liidetud väljad + serveripoolsed väljad nagu praegu).

### Klient

- `EditorSavedState` saab välja **`text`** (baastekst). Lähtestatakse lehevahetusel
  (ADR 0010 — `useEditorState` isSwap-haru), uuendatakse salvestusel, taastel
  (`savedStateAfterRestore` → `r.content`).
- `onSave(updatedPage, base)` → `savePage` → `/save` keha `base`.
- **`merged: true`** → redaktor võtab üle kommentaarid, staatuse, märksõnad,
  tekstiannotatsioonid; tekst asendatakse `pageSwapAnnotation`-iga **ainult siis,
  kui redaktori tekst on endiselt see, mis saadeti** (kasutaja ei trükkinud päringu
  ajal). Muidu jääb baastekst vanaks, et järgmine salvestus tuvastaks lahknemise.
- **409** → konfliktidialoog (`z-[1300]`), mis loetleb konfliktis üksused
  (tekst / staatus / märksõnad / kommentaar „…"). **[otsustatud ilma kasutajata]**
  Kolm valikut:
  1. **„Salvesta minu versioon"** — uus baas = vana baas, kus konfliktis üksused on
     asendatud *theirs* väärtusega; korduv salvestus → konfliktis üksustes võidab
     *mine*, teiste poolt muudetud mittekonfliktsed üksused jäävad alles.
  2. **„Võta serveri versioon"** — redaktor võtab üle `current`; eelnevalt kopeeritakse
     kasutaja tekst lõikelauale (turvavõrk). Salvestamata muudatused kaovad.
  3. **„Tühista"** — midagi ei muutu, muudatused jäävad salvestamata.
  Erinevuse (diff) vaadet **ei ole** (YAGNI; saab lisada).

### Mida see EI lahenda

- Sama teksti samaaegne toimetamine kahes aknas annab konflikti, mitte tekstiliitmise
  (reaviisiline tekstiliitmine on eraldi projekt).
- Kommentaarivastuse, taaste jms teed ei kontrolli baasi — nad on juba lukus
  (ADR 0053) ja muudavad ainult oma osa.

## Testimine

- `tests/test_page_merge.py` — reeglid puhta funktsioonina (iga haru, ß, järjestus).
- Endpoint: vastus-samal-ajal-kui-tekst (tüüpjuht) liidab ilma küsimata; sama välja
  muutus → 409 ja ketas puutumata; `base` puudub → senine käitumine; aegunud Meili
  (base = eelmine seis) → liitmine.
- Klient: `pageSave` puhas abi (`buildRetryBase`, vastuse parsimine) vitestiga;
  lehevahetus lähtestab baasteksti.

## ADR

ADR 0054: lehe salvestus liidab kolmesuunaliselt baasseisu vastu; tekst +
tekstiannotatsioonid on üks üksus; võrdlus Meili-projektsioonis.
