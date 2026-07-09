# 0005 — Meilisearch: prefixSearch jääb sisse, cold-start lahendab keep-warm

**Staatus:** kehtib

## Kontekst

Pärast pikka indekseerimispausi võttis esimene Meilisearchi update ~60s
(cold-start). Põhjus: `prefixSearch: "indexingTime"` skaneerib kogu
sõnavara FST-i igal update'il ja esimesel korral pärast pausi on LMDB
B-puu külm.

Ahvatlev „fix" oleks `prefixSearch: "disabled"` — see kaotaks cold-starti,
AGA lõhuks otsingu: „risin" ei leiaks enam „Risingh" (2 editi ületab
typo-tolerantsi piiri; ainult prefiks-otsing katab selle).

## Otsus

- `prefixSearch` jääb sisse — otsingukvaliteet on tähtsam.
- Cold-start lahendatakse **keep-warm** tsükliga (`meilisearch_ops.py`
  `_keepwarm_loop`): iga 2h sync-itakse üks teos, mis hoiab B-puu soojas
  (`MEILI_KEEPWARM_INTERVAL`).

## Tagajärjed

- ÄRA lülita `prefixSearch`-i välja, isegi kui indekseerimise jõudlus
  näib probleemina — mõõda enne otsingukvaliteedi mõju.
- Keep-warm loop peab serveri restardil taas käivituma (daemon-lõim
  stardil); heartbeat jälgib taustatöid (`/admin/health/background`, #88).
- Kui indekseerimismaht kasvab oluliselt (5x+ korpus), on õige lahendus
  batch'imine, mitte prefixSearchi kaotamine.
