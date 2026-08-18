# ADR 0022 — Välise identifikaatori kanooniline kuju on paljas ID

**Kuupäev:** 2026-08-18
**Staatus:** vastu võetud

## Kontekst

Prosopograafia kaardi `identifiers[]` kirje on `{scheme, id}`. Andmetesse oli
kogunenud sama identifikaator kahel kujul:

| Skeem | Paljas | Prefiksiga |
|---|---|---|
| `gnd` | 134 | 22 (`GND:1029967695`) |
| `viaf` | 149 | 11 (`VIAF:316024504`) |
| `album_academicum` | 178 | 1603 (`AA:341`) |
| `wikidata` | 159 (`Q20933569`) | 0 |

Kuju sõltus sellest, kust ID tuli: isikuvormi salvestus eemaldas prefiksi
(ja ainult `gnd` + `aa` jaoks), `EntityPicker`, rikastuse otsing ja
`add_identifier` salvestasid selle, mis sisse tuli.

See ei olnud kosmeetiline. Kaks tarbijat võtavad `id` välja **stringina**:

1. **Rikastuse URL.** `_fetch_gnd` ehitab `lobid.org/gnd/{id}.json`.
   Kontrollitud 2026-08-18: `GND:1029967695` → HTTP 404, `1029967695` → 200.
   22 kaardil ebaõnnestus rikastus vaikselt („Andmete laadimine ebaõnnestus"),
   ilma et miski oleks vihjanud, et süüdi on vorming.

2. **Dublikaadikontroll.** `ext_id_index` võti on `f"{scheme}:{ext_id}"`, seega
   `gnd:GND:123` ja `gnd:123` olid eri võtmed. `_find_by_external_id` ei
   leidnud olemasolevat kaarti ja `ensure_prosopo_for_entity` tegi selle asemel
   uue — ehk **vorming tootis dublikaate**, mis on üks issue #240 juurtest.

## Otsus

**Kanooniline kuju on paljas identifikaator** — `1029967695`, `104367439X`,
`316024504`, `341`, `Q20933569`. Skeem on juba eraldi väli; prefiks selle sees
on üleliigne info, mis ei tee midagi peale stringivõrdluste lõhkumise.

Reegel elab kahes peegelduvas moodulis, ühe kirjelduse all:

- `server/prosopography/ext_ids.py` → `normalize_ext_id(scheme, id)`
- `src/prosopography/utils/externalIds.ts` → `normalizeExtId(scheme, id)`

Normaliseeritakse **nii kirjutus- kui lugemisteel**:

| Koht | Miks |
|---|---|
| `create_person`, `update_person`, `add_identifier` | uus andmestik on kohe kanooniline |
| `ensure_prosopo_for_entity` | metaandmete salvestus ei tee prefiksi pärast dublikaati |
| `fetch_and_diff` | rikastuse URL on terve ka vana kirje pealt |
| `ext_id_index._key` | **vana andmestik on kaetud ilma migratsioonita** |

Võõra skeemi prefiksit ei eemaldata: `AA:341` `gnd`-väljal on andmeviga, mitte
vormingu küsimus, ja vaikne parandus peidaks selle ära (vt
[ADR 0014](0014-inline-sildid-vs-labels-register.md) ja üldisemat mustrit „vaikne
fallback peidab vea").

## Tagajärjed

- **Migratsioon ei ole kohustuslik.** Kuna võti normaliseeritakse ka lugemisel,
  töötab segane andmestik õigesti. `scripts/migrate_ext_id_format.py` on
  kosmeetika (dry-run vaikimisi); ta puudutab ainult `gnd`, `viaf`, `wikidata` —
  **`album_academicum` jäetakse teadlikult rahule**, sest see on staatiline
  baas, kust midagi juurde ei tule, ja 1603 kaardi ümberkirjutamine annaks
  ainult git-müra.
- Uus skeem tuleb lisada `_PREFIXES` tabelisse **mõlemas otsas**.
- `normalize_ext_id` tagastab tühja stringi tühja sisendi peale; kutsuja
  otsustab, kas see tähendab „ära salvesta" või „viga".
