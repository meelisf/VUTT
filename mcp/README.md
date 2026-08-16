# VUTT MCP-server

Annab lokaalsetele agentidele (Claude Code, Codex CLI, Gemini CLI, Antigravity)
ligipääsu VUTT-i transkriptsioonidele ja prosopograafiale. Read-only, stdio.

Server on VUTT-i avaliku HTTPS-API õhuke klient — backendis midagi muutma ei pea.

## Paigaldus

```bash
pipx install -e mcp/            # → käsk `vutt-mcp` PATH-il
export VUTT_MEILI_SEARCH_KEY=…  # tootmise otsinguvõti
```

| Muutuja | Vaikimisi |
|---|---|
| `VUTT_BASE_URL` | `https://vutt.utlib.ut.ee` |
| `VUTT_MEILI_SEARCH_KEY` | — (kohustuslik) |

Võti on kõikjal sama väärtus, aga **nimi erineb faili kaupa** — see on kõige
kergem koht eksida:

| Asukoht | Nimi |
|---|---|
| repo `.env.local` | `MEILI_SEARCH_KEY` |
| repo `.env` | `VITE_MEILI_SEARCH_API_KEY` |
| serveri `~/VUTT/.env` | `MEILI_SEARCH_KEY` |
| MCP-server ise | `VUTT_MEILI_SEARCH_KEY` |

## Kliendi seadistus

Serverit **ei anta agendile kaustana** — see registreeritakse kliendile üks
kord, misjärel tööriistad on olemas igas seansis, ükskõik millises kataloogis.
`mcp/` kaust on ainult paigalduse allikas.

Käsuasendus loeb võtme `.env.local`-ist, et väärtus ei satuks shelli-ajalukku
ega agendi transkripti. **Jooksuta iga rida tervikuna ühe käsuna** — kui
tõstad `$(...)` eraldi `KEY=`-reale, kaob see teise käsu ajaks (nt Claude
Code'i `!`-käsud käivad igaüks omas shellis) ja server registreeritakse
tühja võtmega.

```bash
# Claude Code — kättesaadav igas projektis sellel masinal
claude mcp add --scope user vutt --env VUTT_MEILI_SEARCH_KEY="$(grep '^MEILI_SEARCH_KEY=' /path/to/VUTT/.env.local | cut -d= -f2- | tr -d '"')" -- vutt-mcp

# Codex CLI
codex mcp add vutt --env VUTT_MEILI_SEARCH_KEY="$(grep '^MEILI_SEARCH_KEY=' /path/to/VUTT/.env.local | cut -d= -f2- | tr -d '"')" -- vutt-mcp

# Gemini CLI — `-s user` on oluline, vaikimisi on scope `project`
gemini mcp add -s user -e VUTT_MEILI_SEARCH_KEY="$(grep '^MEILI_SEARCH_KEY=' /path/to/VUTT/.env.local | cut -d= -f2- | tr -d '"')" vutt vutt-mcp
```

`^MEILI_SEARCH_KEY=` lõpu-`=` on tahtlik — ilma selleta haaraks grep kaasa ka
`MEILI_SEARCH_KEY_UID` rea.

Antigravity: oma UI kaudu (Settings → MCP), sama käsk `vutt-mcp` ja sama
keskkonnamuutuja.

Kontroll: `claude mcp list` / `codex mcp list` / `gemini mcp list`.

`Failed to connect — CONNECTION_CLOSED` tähendab peaaegu alati tühja võtit:
`claude mcp add` võtab `--env` väärtuse vastu ka siis, kui käsuasendus ei
leidnud midagi, ja veateade ei vihja võtmele kuidagi. Diagnostika:
`claude mcp get vutt` näitab, kas `VUTT_MEILI_SEARCH_KEY=` on tühi;
`vutt-mcp </dev/null` kirjutab konfiguratsioonivea `stderr`-i.

Kolm asja, mis üllatavad:

- **Editable install** (`pipx install -e`) tähendab, et pipx-venv osutab tagasi
  repo `mcp/` kausta. Kausta liigutamine või kustutamine lõhub serveri.
  `git pull` jõustub kohe, aga klient peab serveri taaskäivitama (uus seanss).
- **README-d agent lugema ei pea** — tööriistade kirjeldused tulevad protokolli
  kaudu kaasa. See fail on inimesele.
- Server käib **avaliku HTTPS-API vastu**, mitte lokaalse backendi vastu.
  Lokaalse vastu testimiseks lisa `--env VUTT_BASE_URL=http://localhost:8002`.

## Tööriistad

| Tööriist | Mida teeb |
|---|---|
| `search_pages` | Täistekstiotsing, lehekülje-katked |
| `search_works` | Sama teosetasandil + esindav lehekülg |
| `get_work` | Teose metaandmed + lehekülgede loend |
| `get_pages` | Lehekülgede vahemiku täistekst (kuni 20 lk) |
| `search_persons` | Isikuotsing (nimevariandid kaetud) |
| `get_person` | Isikukaart + seotud teosed (kuni 50) |
| `list_filter_values` | Legaalsed filtriväärtused |

Otsing on vaikimisi range (`matchingStrategy: "all"` — kõik päringu sõnad peavad
esinema). `relax_matching=true` lülitab Meili vaikekäitumisele.

Lehekülje­numeratsioon on VUTT-i sisemine 1-põhine skaneeringute järjestus —
mitte trükise paginatsioon ega foliatsioon.

### Loojad ja rollid

`get_work` näitab kogu `creators`-massiivi rollide kaupa. Tuletatud väljad
`autor`/`respondens` ei kata **praesest, gratulante ega eessõna autorit** —
need elavad ainult `creators`-is.

| Roll | Tähendus |
|---|---|
| `auctor` | autor |
| `praeses` | eesistuja (disputatsiooni juhataja, sageli tegelik autor) |
| `respondens` | kaitsja |
| `aui` | eessõna või järelsõna autor |
| `dedicator` | pühendaja |
| `gratulator` | õnnitleja (gratulatsiooniluuletuse autor) |
| `editor` | toimetaja |

Otsingutulemuse päises näidatakse ainult peamine looja rolliga + respondens;
täisnimekiri tuleb `get_work`-ist.

### Seisund

Lehekülje seisundeid on **viis**: `Toores`, `Töös`, `Parandatud`,
`Annoteeritud`, `Valmis`. Kolmene `Toores/Töös/Valmis` on `WorkStatus` — teose
koondstaatus, eri asi. Sõnavara elab `src/types.ts`-is ja
`test_meili_contract.py` valvab, et legend sellest maha ei jääks.

## Arendus

```bash
.venv/bin/pip install -e mcp/
.venv/bin/pytest mcp/tests/                      # võrguvabad
VUTT_MEILI_SEARCH_KEY=… .venv/bin/pytest mcp/tests/ -m live   # päris API vastu
```

CI jooksutab `pytest tests/ mcp/tests/` — selgesõnaline tee, sest `testpaths`
üksi ei kataks seda.

**Invariandid** (vt `docs/superpowers/specs/2026-08-15-vutt-mcp-server-design.md`):

- `vutt_mcp` EI TOHI importida `server`-it runtime'is — pipx-venv on isoleeritud.
  Testid tohivad (`mcp/tests/conftest.py` lisab repo juure sys.path'i).
- `mcp/tests/` EI TOHI sisaldada `__init__.py`-d — pakett `mcp.tests` varjutaks
  repo enda `tests` paketi ja lõhuks 5 olemasolevat testi.
- `mcp` sõltuvus on AINULT `requirements-dev.txt`-is — `requirements.txt`
  paigaldatakse Docker-buildis Python 3.9 peale, kuhu SDK v2 ei mahu.
- Iga tööriist on `@mcp.tool(structured_output=False)`. Vaikimisi lisaks SDK
  `-> str` tagastusele ka `structured_content`-i, mille tugi on klientide vahel
  ebaühtlane.
- stdio-režiimis kirjutab ainult MCP protokoll `stdout`-i; logid `stderr`-i.
- Skaneeringu piltide baite ei väljastata kunagi — ainult töölaua lingid.
  `is_public` kaitseb pilte, mitte teksti.
- Meili väljanimed on legacy (ADR 0006). `mcp/tests/test_meili_contract.py`
  valvab, et päringus kasutatavad väljad oleksid indeksiseadetes õiges rühmas
  (filterable / sortable / searchable) — mitte ainult dokumendis olemas.

**Võltsandmed peavad päris kuju peegeldama.** Neli viga jõudsid teostuses läbi
ainult seetõttu, et fixture'id olid tootmisest lihtsamad:

1. listingu `occupations` on LinkedEntity-objektid, mitte stringid;
2. `get_work` päis oli tühi — päring ei küsinud metaandmevälju;
3. `creators` puudus päringust, nii et praeses/gratulandid/eessõna autor kadusid;
4. seisundeid on viis, mitte kolm (`Parandatud`, `Annoteeritud` puudusid legendist).

Kõik neli tulid välja live-kontrollis. Uue välja lisamisel kontrolli kuju
päris API vastu, ära oleta fixture'i põhjal.
