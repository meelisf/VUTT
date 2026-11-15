# MCP: töökollektsioonid — disain

**Kuupäev:** 2026-11-15
**Seotud:** ADR 0042 (liikmesust ei indekseerita), ADR 0058 (MCP ettepanekud), `mcp/README.md`

## Miks

Kasutaja tahab agendiga sageli tegutseda ühe töökollektsiooni piires
(„otsi Fischeri konverentsi teostest …"). MCP ei näe töökollektsioone üldse:
ta käib VUTT-i vastu ainult Meili otsinguvõtmega, sessiooni tal ei ole, ja
liikmesus on ADR 0042 järgi ainult serveri API-s (`/work-sets/{id}/works`,
sessioonipõhine). Anonüümselt näeks ta ainult `public` kogusid.

## Eesmärgid / mitte-eesmärgid

- **Eesmärk:** agent saab kogud loetleda ja piirata `search_works` /
  `search_pages` ühe kogu liikmetega.
- **Mitte-eesmärk:** kasutajapõhine MCP. Otsinguvõti näeb Meilis niikuinii kõiki
  teoseid; võti antakse ainult adminile (README). Kasutajapõhisus on mõttekas
  alles siis, kui ka võti muutub kasutajapõhiseks — eraldi projekt.
- **Anti-eesmärk:** liikmesus Meilisse (ADR 0042); kogu kirjutamine MCP-st.

## Lähenemised

1. **Ainult avalikud kogud** anonüümse API kaudu — serverimuudatuseta, aga
   töökogud on enamasti `members`, kasu väike.
2. **Otsinguvõti = admini-taseme lugemisluba** uutel `/mcp/…` teedel. **Valitud.**
   Adminid näevad niikuinii kõike; MCP ei pea seda piirama.
3. **Agendikood / sisselogimine** — kasutajapõhine, aga ei lisa turvalisust,
   kuni võti näeb kõike; sisselogimisel lisaks sessiooni aegumine, parool env-is,
   lockout'i risk. Tagasi lükatud.

## Disain

**Server** (uus router `server/routers/mcp_read.py`, ühendatud `main.py`-s):

- `GET /mcp/work-sets` → kõik kogud (ka arhiveeritud, lipuga `status`):
  `id`, `name{et,en}`, `description`, `status`, `visibility`, `count`.
- `GET /mcp/work-sets/{id}/works` → `{work_ids, count}`; puuduv kogu → 404.
- Autentimine: päis `X-Vutt-Search-Key`, võrdlus `hmac.compare_digest`-iga
  `config.MEILI_SEARCH_KEY` vastu. Puuduv/vale → 401; serveris võti seadmata → 503.
  `Authorization` päist EI kasutata — see on sessioonitokeni koht (`deps.py`).
- Õigused: olemasolevad `can_view_set` / `search_visible_work_ids` sünteetilise
  kasutajaga `{"username": "mcp", "role": "admin"}` — uut õigusloogikat ei tule.
- Vastus ei sisalda `access`-i ega auditivälju (kasutajanimed).
- `server/cache.py` siin EI kasutata (ADR 0042).

**MCP:**

- `client.api_get` saab valikulise päise; uus `mcp_get(path)` saadab võtme.
- Uus tööriist `list_work_sets`.
- `search_works` ja `search_pages` saavad parameetri `work_set` (kogu id):
  MCP küsib liikmed ja lisab `work_id IN [...]` olemasolevate filtrite KÕRVALE.
  Tühi liikmete loend → null tulemust (Meili-päringut ei tehta), mitte filtri
  ärajätmine. Tundmatu id → `VuttError` juhisega „kasuta `list_work_sets`".
- `instructions.py`: rida — kui kasutaja nimetab töökollektsiooni, leia id
  `list_work_sets`-iga ja piira otsing `work_set`-iga.

**Dokumendid:** ADR 0042 täiendus (MCP loeb liikmeid sama predikaadi kaudu, mitte
indeksist); `mcp/README.md` märge, et võti annab ka töökollektsioonid.

## Ehitaja otsustada

Testide täpne kuju; vastuse vormindus agendile (`format.py` stiilis).
