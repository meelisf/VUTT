# Cleanup Plan

## NanoID Migration Status

> **Staatus:** ✅ NanoID implementeeritud kõikjal (2026-01-26)
> **Puhastus:** Valikuline - tagasiühilduvuse kood töötab, aga pole enam vajalik

Kõik `_metadata.json` failid sisaldavad nüüd `id` välja (nanoid). URL-id kasutavad `work_id` parameetrit.

### Tagasiühilduvuse kood (võib eemaldada)

Järgmised koodilõigud toetavad vanu `teose_id` (slug) linke, aga pole enam vajalikud:

**1. Frontend (`src/services/meiliService.ts`)**
```typescript
// Praegu: filter: [`(work_id = "${workId}" OR teose_id = "${workId}")`]
// Pärast: filter: [`work_id = "${workId}"`]
```
Asukohad: read 219, 651, 931, 1014, 1248, 1323

**2. Backend (`server/utils.py`)**
- `find_directory_by_id()` funktsioon otsib fallback'ina ka `slug` ja kaustanime järgi
- Pärast puhastust: kasuta ainult `WORK_ID_CACHE` ja `id` välja

**3. Andmeskeem**
- `teose_id` / `slug` väljad võib jätta inimloetavuseks, aga loogika ei tohiks neid kasutada

### Miks mitte kohe puhastada?

- Tagasiühilduvus ei tekita probleeme (töötab korrektselt)
- Vanad järjehoidjad/lingid võivad veel eksisteerida
- Puhastamine nõuab hoolikat testimist
- Prioriteet on madal - "if it ain't broke, don't fix it"

### Puhastamise sammud (kui otsustad teha)

1. Eemalda `OR teose_id` kõigist Meilisearch filtritest
2. Lihtsusta `find_directory_by_id()` - eemalda slug fallback
3. Testi põhjalikult (kõik lingid, otsing, töölaud)
4. Reindekseeri Meilisearch (valikuline - `teose_id` väli võib jääda)
