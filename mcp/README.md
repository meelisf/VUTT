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

Võti on repo `.env`-is nime all `MEILI_SEARCH_KEY` (ADR 0021 — üks nimi ühe
seade kohta). MCP-server ise loeb `VUTT_MEILI_SEARCH_KEY`; see on teadlik
erand, sest `vutt-mcp` paigaldatakse pipx-iga globaalselt ega loe repo
`.env`-i, ja prefiks väldib kollisiooni kasutaja shellis oleva võõra
`MEILI_SEARCH_KEY`-ga. Väärtus on sama.

## Kliendi seadistus

Serverit **ei anta agendile kaustana** — see registreeritakse kliendile üks
kord, misjärel tööriistad on olemas igas seansis, ükskõik millises kataloogis.
`mcp/` kaust on ainult paigalduse allikas.

Käsuasendus loeb võtme repo `.env`-ist, et väärtus ei satuks shelli-ajalukku
ega agendi transkripti. **Jooksuta iga rida tervikuna ühe käsuna** — kui
tõstad `$(...)` eraldi `KEY=`-reale, kaob see teise käsu ajaks (nt Claude
Code'i `!`-käsud käivad igaüks omas shellis) ja server registreeritakse
tühja võtmega.

```bash
# Claude Code — kättesaadav igas projektis sellel masinal
claude mcp add --scope user vutt --env VUTT_MEILI_SEARCH_KEY="$(grep '^MEILI_SEARCH_KEY=' /home/mf/LLM/VUTT/.env | cut -d= -f2- | tr -d '"')" -- vutt-mcp

# Codex CLI
codex mcp add vutt --env VUTT_MEILI_SEARCH_KEY="$(grep '^MEILI_SEARCH_KEY=' /home/mf/LLM/VUTT/.env | cut -d= -f2- | tr -d '"')" -- vutt-mcp

# Gemini CLI — `-s user` on oluline, vaikimisi on scope `project`
gemini mcp add -s user -e VUTT_MEILI_SEARCH_KEY="$(grep '^MEILI_SEARCH_KEY=' /home/mf/LLM/VUTT/.env | cut -d= -f2- | tr -d '"')" vutt vutt-mcp
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

### Serveri juhend (`instructions`)

`vutt_mcp/instructions.py` sisaldab teksti, mille klient süstib mudeli konteksti
juba ühendumisel — enne esimest tööriistakutset. Sinna kuulub see, mida ükski
üksik tööriista kirjeldus ei ütle: korpuse **keelekihid** (allikad ladina/saksa/
rootsi/kreeka, sekundaarkirjandus saksa/eesti), tööriistade järjekord ja
`work_id` tähendus.

**Claude Code lõikab juhendi 2048 märgi pealt** (logib „Server instructions
truncated from N to 2048 chars") — teksti pikendades jälgi seda piiri;
`mcp/tests/test_instructions.py` valvab.

## Kirjanduskogu (valikuline, lokaalne)

Lokaalne sekundaarkirjanduse kogu Zotero põhjal. **Tööriistad tekivad ainult
siis, kui indeksifail on olemas** — teisel paigaldajal neid ei ole.

```bash
vutt-library index     # loeb Zotero kollektsiooni „VUTT kirjandus", ehitab indeksi
vutt-library status    # mis kogus on
```

| Muutuja | Vaikimisi |
|---|---|
| `VUTT_LIBRARY_DB` | `~/.local/share/vutt-library/library.db` |
| `VUTT_LIBRARY_COLLECTION` | `VUTT kirjandus` (nimi või Zotero key) |
| `VUTT_LIBRARY_ZOTERO_DIR` | `~/.zotero/Zotero` (ainult `storage/` jaoks) |
| `VUTT_LIBRARY_ZOTERO_API` | `http://127.0.0.1:23119/api/users/0` |

| Tööriist | Mida teeb |
|---|---|
| `list_literature` | Kogu sisu: doc_id, viide, lehekülgede arv |
| `search_literature` | Täistekstiotsing → katked + tsiteeritav viide |
| `get_literature_pages` | Lehevahemiku täistekst (`page_ref` on kohustuslik) |

Kolm asja, mis üllatavad:

- **Zotero peab indekseerimise ajal jooksma** ja Local API olema lubatud
  (Settings → Advanced). Otse `zotero.sqlite` lugemine ei ole võimalik —
  jooksev Zotero hoiab baasi lukus nii, et isegi read-only ühendus kukub.
- **`page_ref` on kohustuslik.** Trükise lehekülg ja PDF-i leht ei ole samad;
  vaikimisi valik oleks vaikne viga.
- **Kogusse pane ainult kvaliteetse OCR-iga PDF-e.** Indekseerija ei hinda
  tekstikvaliteeti ja lagunenud OCR jääb otsingust vaikselt välja.

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
koondstaatus, eri asi. Sõnavara elab `src/types.ts`-is.

`get_work` ei loetle lehti ükshaaval, vaid **vahemikena** (`format_page_index`):
korpuses on mediaanteoses 9 lehte ja 89 % teostest kannab kõigil lehtedel sama
seisundit, nii et rida lehe kohta oli peaaegu puhas kordus — 706-leheküljeline
teos maksis ~18 000 tokenit, vahemikena ~33 (kogu korpuse peale −93 %).
Kodeering käib tegelike lehenumbrite peale, nii et auk numbrites annab eraldi
vahemiku. Täis-URL-i iga lehe juures annavad endiselt `search_pages` ja
`get_pages` — need on kohad, kust lehe sisuni jõutakse.

Skaala seletus on **ainult `instructions.py`-s**, mitte vastustes: klient süstib
juhendi konteksti üks kord seansi kohta, vastuses kordumine maksis ~100 tokenit
päringu kohta. `test_meili_contract.py` valvab, et juhend kõiki `types.ts`-i
seisundeid nimetaks; `test_instructions.py` valvab 2048-märgi lage, millest
klient juhendi lõikab. Sama loogika rollilegendil: `needs_role_legend()` väljastab
selle ainult siis, kui teosel on mõni roll peale `auctor`-i.

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
