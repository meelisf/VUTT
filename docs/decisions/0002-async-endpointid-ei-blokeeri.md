# 0002 — `async def` endpoint ei tohi kutsuda blokeerivat I/O-d

**Staatus:** kehtib (õpitud intsidendist)

## Kontekst

**2026-06-13 outage:** `async def` endpoint kutsus blokeerivat SSH/SFTP
operatsiooni → uvicorni event-loop külmus → KOGU server ei vastanud
(parandus a89e905). Sama klassi vead leiti hiljem süstemaatiliselt
(issue #111: blokeeriv SFTP/git/Meili I/O async endpointides).

FastAPI käitab `def` endpointe threadpoolis (blokeerimine on ohutu), aga
`async def` endpointid jooksevad otse event-loopis — üks blokeeriv kutse
peatab kõik.

## Otsus

- Endpoint, mis teeb blokeerivat I/O-d (SSH/SFTP, git, Meilisearch,
  failisüsteem suures mahus), on kas tavaline `def` (FastAPI threadpool)
  või kasutab `run_in_executor`/taustalõime.
- `async def` on lubatud AINULT siis, kui kogu tee on päriselt async.

## Tagajärjed

- Koodiülevaatusel on `async def` + blokeeriv kutse automaatne punane lipp.
- Pika I/O jaoks on mustrid olemas: ThreadPoolExecutor (Meili sync),
  daemon-lõimed (upload-sync, keep-warm), taustalõim (`rebuild_indices`).
- Sümptom, mille järgi seda viga ära tunda: KÕIK päringud hanguvad korraga,
  mitte ainult üks endpoint.
