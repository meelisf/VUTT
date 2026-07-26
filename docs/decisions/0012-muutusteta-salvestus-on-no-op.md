# 0012 — Muutusteta salvestus on no-op: ei kirjuta, ei commiti, ei indekseeri

**Staatus:** kehtib

## Kontekst

Salvestamine on tööriista sagedaseim kirjutav tegevus ja kasutajad vajutavad
Ctrl+S harjumusest ka siis, kui midagi muutunud ei ole. Enne #173 maksis
selline salvestus täishinna:

- **Metaandmed.** Native Git CLI jättis tühja commiti küll vahele
  (`save_with_git` → `is_noop`), kuid `save_work_metadata` ei vaadanud seda
  tulemust. Järeltegevused — `work_collections_index.json`,
  `person_to_works.json`, `works_creators_index.json`, Meilisearchi sünk,
  Wikidata labelite rikastamine, cache'ide tühjendamine — käivitusid ikka.
  Tootmismõõtmine: 122 ms serveripoolset tööd + ~0,6 s taustaindekseerimist
  olematu muudatuse eest.

- **Leheküljed.** Klient lööb igale salvestusele uue `updated_at` ajatempli
  (`pageService.ts`). Git nägi seetõttu alati diffi ja tegi päris commiti:
  ajalukku tekkis müra, mille diff koosnes ainult ajatemplist.

Meilisearchi ja tuletatud indeksite mõttes on muutusteta salvestus definitsiooni
järgi tühitöö: sisend on identne sellega, millest need indeksid juba ehitati.

## Otsus

1. **Võrdlus on semantiline, mitte serialiseeritud.** `server/save_diff.py`
   võrdleb Pythoni struktuure (`old == new`), mitte `json.dumps` stringe.
   Võtmete järjekord ega vormindus ei tekita valemuudatust; **loendi järjekord
   loeb** (creators/collections järjestus on sisuline).

2. **`save_work_metadata` tagastab `(meta, changed)`.** `changed=False` korral
   lõpetab funktsioon enne Git commiti, tuletatud indekseid ja Meili sünki.
   Kutsuja vastutab sellega seotud taustatööde vahelejätmise eest
   (`/update-work-metadata` ei kutsu rikastamist ega `_invalidate_all_caches`).

3. **Kaks kaitsekihti.** Semantiline võrdlus enne kirjutamist ja
   `save_with_git` `is_noop` pärast — kui Git leiab, et kettal olev sisu on
   juba sama, jäävad järeltegevused samuti tegemata.

4. **`updated_at` on lenduv väli.** Lehekülje no-op võrdlus ignoreerib
   `VOLATILE_PAGE_FIELDS` välju. Muutusteta salvestusel ei kirjutata uut
   ajatemplit üldse kettale — muidu poleks võrdlus idempotentne ja iga teine
   salvestus tekitaks commiti.

5. **Puuduv fail on alati muudatus.** Uus lehekülg või puuduv
   `_metadata.json` läheb alati kettale ja commiti, ka siis kui sisu on tühi
   või kõik väljad filtreeriti välja.

6. **UX ei muutu.** Endpoint vastab endiselt `{"status": "success"}`, lisaks
   `changed: false`. Kasutaja jaoks õnnestub salvestus nagu varem.

## Tagajärjed

- **`save_work_metadata` kutsujad peavad tuple'i lahti pakkima.** Tagastustüüp
  on `Tuple[dict, bool]`; kutsuja, kes ootab dict-i, saab vaikse vea. Uus
  kutsuja peab otsustama, mida `changed=False` korral vahele jätta.

- **Salvestuse taga peituv „paranda ise" ei tööta enam.** Kui teose
  Meilisearchi dokument on kettaga lahku läinud (nt varasem ebaõnnestunud
  taustasünk), ei paranda seda enam sama sisu uuesti salvestamine — no-op
  jätab sünki tegemata. Taastamise teed on `scripts/server_seed_data.sh` ja
  `sync_work_to_meilisearch` otsekutse. Kui lahknemine muutub sagedaseks,
  vajab see eraldi kontrollitud parandusteed, mitte no-op'i tagasipööramist.

- **`ensure_prosopo_stubs` jääb võrdlusest ettepoole.** See asendab
  `updates`-is Wikidata Q-koodid `vutt:P` ID-dega, seega võrrelda saab alles
  pärast seda. Stub-kaartide loomine on idempotentne, aga muutusteta
  salvestusel siiski üleliigne — teadlik kompromiss võrdluse õigsuse kasuks.

- **Lenduvate väljade nimekiri on üks koht.** Kui klient hakkab saatma uue
  automaatse välja (nt `last_seen_by`), tuleb see lisada
  `VOLATILE_PAGE_FIELDS`-i, muidu naaseb ajatempli-müra ajalukku.

- **Ajalugu muutub hõredamaks.** Lehe ajaloo vaates ei teki enam kirjeid,
  mille diff on ainult `updated_at`. See on eesmärk, mitte kõrvalmõju.

## Viited

- Issue #173 (koondülevaade #182)
- `server/save_diff.py`, `server/metadata_ops.py`, `server/routers/editing.py`
- Testid: `tests/test_save_noop.py`
