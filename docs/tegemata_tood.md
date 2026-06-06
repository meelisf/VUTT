# Tegemata tööd / Tehniline võlg

Siia kogutakse teadaolevad parandused ja puhtamad lahendused, mis on praegu edasi lükatud.

---

## `find_directory_by_id` — slug-match ilma `sanitize_id`-ta

**Fail:** `server/utils.py`, funktsioon `find_directory_by_id`, step 4

**Probleem:**  
Praegune kood võrdleb: `sanitize_id(entry.name) == target_id`  
`sanitize_id` stripib lõpus olevad alakriipsud ja teeb muid teisendusi, mistõttu slugid nagu `1633-19-..._precatione_` (lõpus `_`) ei leia vastet — kuigi kataloog täpselt selle nimega eksisteerib.

**Tagajärg:**  
Slug-põhised pildi-URLid (nt `/{slug}/pilt.jpg`) saavad 403, kui slug lõpeb alakriipsuga. Praegu toimib asi tänu `translate_path` fallback-ile `image_server.py`-s, mis teeb `os.path.join(DIRECTORY, *parts)` otse.

**Soovituslik parandus:**  
Step 4 peaks kasutama otse kataloognime, mitte `sanitize_id` versiooni:
```python
# Praegu (vale):
if sanitize_id(entry.name) == target_id:

# Parem:
if entry.name == target_id:
```

Kaaluda tuleks, kas `sanitize_id` kasutamine step 4-s oli algselt mõeldud mingil põhjusel (nt URL-dekooditav nimi vs. failisüsteem) — kui ei, siis otse-võrdlus on õige.

---

## Meilisearch `lehekylje_pilt` — slug vs. NanoID

**Failid:** `scripts/1-1_consolidate_data.py`, `server/meilisearch_ops.py`

**Probleem:**  
`lehekylje_pilt` väli Meilisearchis sisaldab slug-põhist teed (`slug/pilt.jpg`), mitte NanoID-põhist (`nanoid/pilt.jpg`). NanoID on nüüd kanooniline viide, slug on ebastabiilne (muudetav).

**Tagajärg:**  
Image server peab tegema slug → kataloog tõlkimise iga pildi-päringu puhul (aeglane, cache-miss). Slug muutumise korral lähevad pildi-URLid katki.

**Soovituslik parandus:**  
Uuendada `lehekylje_pilt` Meilisearchi indekseerimise käigus NanoID + failinimeks. Nõuab reindekseerimist (`server_seed_data.sh`).

---

## TODO CLAUDE.md-st (üle toodud siia)

| Ülesanne | Prioriteet |
|----------|-----------|
| Automaatne backup-süsteem | Kõrge (ootab IT-d) |
| JSON cleanup (`page_number` eemaldamine) | Madal |
| `crossLangTypeMap` eemaldamine AdvancedFilters-ist | Madal (kui kõigil teostel on `type_ids` indekseeritud) |
