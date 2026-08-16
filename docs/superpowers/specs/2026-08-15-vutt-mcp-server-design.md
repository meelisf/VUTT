# VUTT MCP-server — disain

Kuupäev: 2026-08-15
Seis: kinnitatud disain, ootab teostusplaani
Muudetud: 2026-08-15 (ülevaate järel — SDK v2, Meili leping, matchingStrategy,
stdio-reegel, mahuvalve, `is_public` sõnastus)

## Probleem

Kui agent (Claude Code, Codex CLI, Gemini CLI, Antigravity) teeb varauusaegsete
tekstide kohta faktikontrolli või otsib taustamaterjali, ei ole VUTT-i korpus
talle praktiliselt kättesaadav. Agent peaks kas HTTP-päringuid käsitsi kokku
panema (teades Meili legacy-väljanimesid) või materjali käsitsi kopeerima.

Eesmärk: anda agendile VUTT-i tekstid ja prosopograafia MCP-tööriistadena, nii
et faktikontroll ja materjali otsimine oleks üks tööriistakutse, mitte projekt.

## Ulatus

**Sees:** transkriptsioonid (otsing + lugemine), teoste metaandmed,
prosopograafia (~2350 isikukaarti), kollektsioonifiltrid.

**Väljas praegu:** kirjutamine (prosopograafia täiendamine agendi poolt),
kohanimede register, sõnavarad, arhiivide register.

### `is_public` ja skaneeringud — täpne piir

Omaniku otsus: `is_public` (tuletatud kollektsiooni nähtavusest) on mõeldud
**skaneeringu piltide kaitseks**; tekstikiht ei ole samal määral tundlik.

**NB — MCP näeb rohkem kui anonüümne brauser.** Frontend ei kasuta toorest
otsinguvõtit, vaid backendi genereeritud tenant-tokenit, ja anonüümne token
kannab filtrit `is_public = true` (`meilisearch_ops.py:584`; admin saab
piiranguta tokeni). MCP-server kasutab toorest `MEILI_SEARCH_KEY`-d ja on
seetõttu piiranguteta — nagu admin.

Alus ei ole seega „tekst on niikuinii avalik", vaid **„server jookseb
lokaalselt omaniku võtmega"**. Kui MCP kunagi avalikuks või jagatuks muutub,
tuleb see rida uuesti läbi vaadata ja tõenäoliselt tenant-tokenile üle minna.

Sellest järeldub kolm reeglit:

1. MCP tagastab teksti **sõltumata `is_public` väärtusest**. Filtrit ei ole.
2. MCP **ei laadi ega tagasta kunagi skaneeringu baite** — ei tööriista
   tulemusena ega mudelile nähtava sisuna. See on serveri garantii.
3. Link töölaua leheküljele on lubatud ja soovitav.

Piiri kolmas pool tuleb välja öelda: link on link. VUTT MCP-server ei saa
garanteerida, et host-agent ei ava seda URL-i mõne teise brauseri- või
HTTP-tööriistaga. „Pildibaite ei saadeta" on **selle serveri** garantii, mitte
kogu agendi oma.

Piltide mudelisse laadimine eeldaks eraldi poliitikaotsust `is_public`
materjali kohta. Ilma selleta jääb keeld püsima.

## Kontekst ja piirangud

### Kasutaja ja juurutus

Üks kasutaja, üks masin, mitu klienti. **stdio-transport**: klient käivitab
protsessi ise, andes käsu — agent ei pea VUTT-i repos olema ega sellest midagi
teadma.

Klientide MCP-tugi on ebaühtlane. Kindlalt toetatud on ainult **tools**.
Seega: **ei `resources`, `prompts` ega `elicitation`** (`sampling` on
2026-07-28 protokollis niikuinii deprecated). Tööriistade kirjeldused peavad
olema iseseletavad: mudel, kes VUTT-ist midagi ei tea, peab kirjeldusest aru
saama, mis on `work_id` ja mida seisund `Toores` tähendab.

HTTP-transport ei ole praegu vaja. SDK v2-s valitakse transport `run()` juures,
nii et sama tööriistade komplekt saab hiljem `streamable-http`-na üles tulla
ilma tools-kihti ümber kirjutamata. Seda **ei ehitata praegu**.

### SDK ja Python-versioon

Sõltuvus fikseeritakse `mcp>=2,<3` — v2 on stabiilne liin (`pip install mcp`
annab 2.x) ja API muutus juulis 2026 oluliselt: `mcp.server.fastmcp.FastMCP` →
`mcp.server.MCPServer`, transport konstruktorist `run()`-i.

**Python-versiooni piir ei kehti siin.** CLAUDE.md-i „Python 3.9 ühilduvus"
reegel puudutab `server/`-i, mis jookseb Dockeris (`python:3.9-slim`).
`vutt_mcp` jookseb ainult lokaalselt (venv 3.12, CI 3.12) ega lähe kunagi
konteinerisse.

**Sellest järeldub kohustuslik ettevaatusabinõu:** `mcp` sõltuvus läheb
**ainult** `requirements-dev.txt`-i, MITTE `requirements.txt`-i. Viimane
paigaldatakse Docker-buildis Python 3.9 peale ja SDK v2 murraks selle.

### Andmeallikas

MCP-server on **avaliku HTTPS-API õhuke klient**. Backend-muudatusi ei tehta
(v.a üks suunatud puhastus, vt „Meili seadete leping").

| Allikas | Tee | Märkus |
|---|---|---|
| Meilisearch | `https://vutt.utlib.ut.ee/meili/` | search-only võti, indeks `teosed` |
| Prosopograafia | `https://vutt.utlib.ut.ee/api/files/prosopography…` | `_optional_user` — juba avalikud |
| Töölaud (lingid) | `https://vutt.utlib.ut.ee/work/{work_id}/{lk}` | inimesele järelevaatamiseks |

**Meili indeks `teosed` on lehekülje-põhine** — iga dokument on üks lehekülg,
mitte üks teos. Katkepõhine otsing on seetõttu natiivne (`attributesToCrop` →
`_formatted`); teosetasandi otsing tuleb `distinct: "work_id"`-ga.

## Arhitektuur

```
mcp/
  pyproject.toml          # console-script: vutt-mcp; mcp>=2,<3
  vutt_mcp/
    __main__.py           # stdio-transport, käivitus, konfi valideerimine
    server.py             # tööriistade registreerimine (õhuke)
    client.py             # AINUS koht, mis räägib HTTP-d (Meili + FastAPI)
    queries.py            # Meili päringu koostamine (filtrid, distinct, cropping)
    persons.py            # prosopograafia päringud
    format.py             # dict → kompaktne agendile loetav tekst
  tests/
```

**`client.py` on tahtlik pudelikael.** Kogu võrgusuhtlus käib sealt: baas-URL,
võti, timeout, kordusekatse, veateadete tõlkimine. Kui hiljem tuleb autenditud
kirjutustee prosopograafiasse, on see lisandus sinna kihti, mitte tööriistade
ümberkirjutus.

**`format.py` ei tea HTTP-st midagi** ja `queries.py` ei tea väljundi kujust
midagi — mõlemad on puhtad funktsioonid, mida saab testida ilma võrguta.

### stdout on reserveeritud

**stdio-režiimis ei kirjutata `stdout`-i mitte midagi peale MCP protokolli
sõnumite.** Kogu diagnostika, logid ja hoiatused lähevad `stderr`-i.

See ei ole stiilisoovitus: üksainus `print()` silumise ajal rikub
protokollivoo ja klient kaotab serveri. Logimine konfigureeritakse
`__main__.py`-s `stderr`-i enne serveri käivitamist, ja `mcp/tests/` sisaldab
testi, mis kinnitab, et tööriista täitmine ei kirjuta `stdout`-i.

### Meili seadete leping

Praegu deklareeritakse indeksi seaded **kahes kohas**:

- `scripts/2-1_upload_to_meili.py` — täielik `update_settings` (searchable /
  filterable / sortable)
- `server/meilisearch_ops.py:_ensure_filterable_attributes()` — väiksem
  `needed`-hulk, mida jooksvalt juurde lapitakse

Kaks nimekirja, mis võivad lahku minna. Lepingu-test ei saaks otsustada, kumb
on tõde.

**Suunatud parandus:** seaded eralduvad `server/meili_settings.py`-sse
(`SEARCHABLE_ATTRIBUTES`, `FILTERABLE_ATTRIBUTES`, `SORTABLE_ATTRIBUTES`), mida
mõlemad olemasolevad kohad impordivad. See on eeldus lepingu-testile ja
kõrvaldab ühtlasi olemasoleva lahknevusriski.

## Tööriistad

Seitse tööriista, teadlikult vähe. Iga lisatööriist on agendi jaoks valik,
mille ta võib valesti teha.

### Ühine otsingusemantika

**`matchingStrategy: "all"`** on vaikimisi kõigil otsingutööriistadel. Meili
vaikimisi strateegia on `last`, mis hakkab päringust sõnu eemaldama, kui
täisvasteid napib — `search_pages("Daniel Sennert")` võiks siis anda ka
lehekülgi, kus kogu nime ei esine. Faktikontrolli jaoks on täpsus tähtsam kui
saagis.

Kirjaveataluvus jääb sisse — see aitab nimevariantide, mitte poolikute
päringute juures.

Kõigil otsingutööriistadel on `relax_matching` (vaikimisi `false`), mis lülitab
`last`-strateegiale. Tööriista kirjeldus ütleb, millal seda kasutada: kui range
otsing ei anna midagi.

### `search_pages`

Täistekstiotsing lehekülje tasandil. Vastab küsimusele „kus seda mainitakse".

Parameetrid: `query` (kohustuslik), `collection`, `year_from`, `year_to`,
`language`, `genre_id`, `work_id`, `relax_matching`, `limit` (vaikimisi 10,
max 50), `offset`.

Tagastab hitid koos ~200-tähemärgise katkega ümber leiu.

### `search_works`

Sama päring teosetasandil (`distinct: "work_id"`). Vastab küsimusele „millised
teosed seda üldse käsitlevad". Samad filtrid mis `search_pages`.

Meili valib sama `work_id` lehekülgedest kõrgeima rankinguga tabamuse. Seda
kasutatakse **teadlikult ära**: tulemus säilitab lisaks teose metaandmetele
just selle esindava lehekülje numbri ja katke. Tööriist vastab seega korraga
kahele küsimusele — „milline teos?" ja „miks see teos vaste oli?".

### `get_work`

Ühe teose täismetaandmed: pealkiri, loojad rollidega, aasta, koht, kirjastaja,
žanr, tüüp, keeled, kollektsioonid, väline ID (ESTER), märkmed — pluss
lehekülgede loend.

Parameetrid: `work_id`.

**Invariant:** leheküljed tagastatakse alati kanoonilises järjestuses
(`lehekylje_number` kasvavalt — väli on `sortableAttributes` hulgas) ja iga lehe
juures on vähemalt järjestusnumber, seisund ja töölaua link.

### `get_pages`

Lehekülgede vahemiku täistekst.

Parameetrid: `work_id`, `from_page`, `to_page` (kaasa arvatud).

**Numeratsioon:** `from_page=12` tähendab VUTT-i sisemist **1-põhist
järjestusnumbrit** (`lehekylje_number`, skaneeringute järjekord) — MITTE
trükise paginatsiooni ega foliatsiooni. Varauusaegse teose puhul on vahe
oluline: `p. 12`, `fol. B2r` ja VUTT-i kaheteistkümnes skaneering on üldjuhul
kolm eri asja. Tööriista kirjeldus ütleb selle sõnaselgelt välja.

Lagi **20 lehekülge**. Üle selle → viga, mis ütleb teose lehekülgede arvu ja
soovitab vahemikku kitsendada. Vaikselt kärbitud tulemust ei tagastata.

### `search_persons`

Isikuotsing. Parameetrid: `q`, `gender`, `occupation`, `origin_group`,
`institution`, `status_id`, `source`, `imm_year_from`, `imm_year_to`,
`collection`, `limit` (vaikimisi 10, max 50), `offset`.

Nimevariandid: otsing kasutab olemasolevat aliaste-mehhanismi, nii et
*Lorenz Luden* leiab ka *Laurentius Ludenius*.

### `get_person`

Isikukaardi täisandmed + seotud teosed (rollidega). Parameetrid: `person_id`,
`include_relations` (vaikimisi `false`) — tõesena lisab teostest tuletatud
isiku-isiku seosed.

**Mahuvalve.** Produktiivse professori kaart võib olla sama suur
kontekstiplahvatus kui piiramata `get_pages`. Seetõttu:

- seotud teoseid näidatakse maksimaalselt **50**, väljundis on alati
  `seotud_teoseid=N` ja märge, mitu välja jäi
- `include_relations=true` seoste lagi on samuti **50**, sama märkega
- ülejäänu kättesaamiseks suunab tööriist `search_works`-i juurde
  (`creator_ids` filtriga)

Kontekstikulu on MCP puhul arhitektuuriline omadus, mitte kosmeetika.

### `list_filter_values`

Legaalsed väärtused filtriväljadele: kollektsioonid, žanrid (Q-koodid +
sildid), tüübid, keeled (ISO-koodid). Parameeter: `field`.

**Allikas:** Meili `facets` päring vastava atribuudi peal. Kaks tagajärge, mis
teostuses kinni panna:

- iga selline väli **peab** olema `FILTERABLE_ATTRIBUTES` hulgas — lepingu-test
  kontrollib seda
- Meili piirab tagastatavate facet-väärtuste arvu `maxValuesPerFacet`-iga
  (vaikimisi 100), seega ei tähenda `facets` rangelt „kõik legaalsed
  väärtused". Praeguse nelja välja puhul on väärtusi vähe, aga kui hulk lõikub
  lae vastu, ütleb väljund seda välja, mitte ei vaiki

Tööriist on olemas seepärast, et ilma selleta pakub agent filtriväärtusi ära ja
saab tühje tulemusi — ta ei tea, et žanr on Q-kood ja keel ISO-kood.

## Väljund

### Ainult tekst — ja seda tuleb aktiivselt nõuda

Tööriistad tagastavad ainult tekstiplokke. **See ei ole SDK v2 vaikekäitumine.**

SDK v2 tuletab tagastustüübist ka struktureeritud väljundi: isegi `-> str`
annab nii `result.content` kui `result.structured_content` (dokumentatsioon
ütleb otse — „because you declared the return type as `-> str`"). Kuna
klientide `structuredContent`-tugi on ebaühtlane, oleks tulemus dubleeritud
kandmine ja ebaühtlane käitumine.

**Iga tööriist deklareeritakse `@mcp.tool(structured_output=False)`.**
`mcp/tests/` sisaldab testi, mis kinnitab, et ükski registreeritud tööriist ei
tagasta `structured_content`-i. Ilma selleta teeks teostus vaikselt midagi
muud, kui see dokument lubab.

### Vorming

**Otsingutulemused** — tihe, skannitav, üks plokk hiti kohta:

```
[1] Ludenius, Laurentius · "Disputatio politica de republica" (1642, Tartu)
    work_id=v7Kq2mXp · lk 12/48 · seisund=Valmis · kollektsioon=Disputatsioonid
    …quod respublica Suecorum eo tempore florentissima fuerit…
    vaata: https://vutt.utlib.ut.ee/work/v7Kq2mXp/12
```

**Detailid** (`get_work`, `get_person`, `get_pages`) — sildistatud väljad, mitte
JSON: sama loetav, ~30 % odavam, ja iga mudel saab aru.

Isikutulemuste link: `https://vutt.utlib.ut.ee/persons/{person_id}`.

### Teksti seisund

Iga tekstitükiga käib kaasas `seisund`. Tööriista kirjeldus selgitab:

- `Toores` — puutumata masinlugemine, võib sisaldada vigu
- `Töös` — osaliselt üle vaadatud
- `Valmis` — inimese kinnitatud transkriptsioon

Toorest OCR-i **ei filtreerita vaikimisi välja** — agent peab nägema kogu
korpust, aga teadma, millal ta loeb kontrollimata masinlugemist.

### Teksti valik

`get_pages` tagastab puhastatud teksti (`lehekylje_tekst`): reavahetuse
poolitused liidetud, XML-märgendus eemaldatud. **Marginaalia eraldi väljal**
(`marginaalia_tekst`), sest see on füüsiliselt eraldi tekstikiht.

Toorest redaktoriteksti (`text_content`) ei väljastata — märgendus on agendi
jaoks müra.

### Päringu normaliseerimine

Päring läbib sama `ß → ss` teisenduse mis frontendi `normalizeSearchQuery`
(#228). Ainult ühe poole normaliseerimine tähendaks, et `Schluß` ei leia enam
midagi.

## Veakäsitlus

### Käivitamine vs tööriistakutse

Eristus on tähtis: käivitusviga tähendab, et **kogu server kaob kliendi jaoks
ära**; tööriista-tasandi veast saab agent taastuda (päringut muuta, hiljem
uuesti proovida).

| Olukord | Käitumine |
|---|---|
| Puuduv `VUTT_MEILI_SEARCH_KEY` | fataalne käivitusviga, selge sõnum |
| 401/403 — tõestatult kehtetu võti | fataalne |
| VUTT/Meili ajutiselt kättesaamatu | **server käivitub**; tööriistakutsed tagastavad ajutise võrguvea |

Viimane rida on teadlik: VUTT-i viiesekundiline katkestus kliendi käivitamise
hetkel ei tohi tähendada, et agent kaotab kogu tööriistakomplekti.

Võtme kehtivus ei ole teoreetiline mure: `.env.local`-i otsinguvõti ei kehti
tootmises (kontrollitud disainifaasis, `invalid_api_key`).

### Vead tööriista sees

Tööriistad **tõstavad päris exception'e**, mitte ei tagasta `"Error: …"`
stringe. SDK muudab tõstetud vea `is_error=True` tulemuseks, mille mudel loeb
veana ja mille järel oskab päringut muuta. `"Error: …"` string näeks mudelile
välja nagu õnnestunud tulemus.

Veateade peab olema loetav ja tegevusele suunav — mitte traceback:

- tundmatu `work_id` → soovita `search_works`-i
- `get_pages` üle 20 lk → ütle teose lehekülgede arv, soovita kitsamat vahemikku
- tühi tulemus range otsinguga → maini `relax_matching`-ut

### Kordusekatsed

Üks kordusekatse järgmistel juhtudel: **5xx, 429, timeout, ühendusviga**.
`Retry-After` päist austatakse, kui see on olemas. Muudel juhtudel (4xx peale
429) kordust ei tehta — päring on vale ja kordus ei aita.

## Konfiguratsioon ja paigaldus

| Muutuja | Vaikimisi | Märkus |
|---|---|---|
| `VUTT_BASE_URL` | `https://vutt.utlib.ut.ee` | |
| `VUTT_MEILI_SEARCH_KEY` | — | kohustuslik, tootmisest |

```bash
pipx install -e mcp/          # → käsk `vutt-mcp` PATH-il
```

Klientide konf (Claude Code'i näide, sama rida sobib kõigile):

```bash
claude mcp add --scope user vutt -- vutt-mcp
```

## Testimine

Viis kihti, kõik võrguvabad peale viimase:

1. **Üksustestid salvestatud HTTP-vastustega** — päringu koostamine
   (`queries.py`) ja vormindamine (`format.py`).
2. **Meili lepingu test** — impordib `server.meili_settings`-i ja kontrollib
   iga välja kohta, mida `queries.py` kasutab:
   - väli eksisteerib indekseeritavas dokumendis (`server.meili_doc`)
   - filtris või `distinct`-is kasutatav väli on `FILTERABLE_ATTRIBUTES` hulgas
     (Meili nõuab seda ka `distinct: "work_id"` puhul)
   - sorteerimiseks kasutatav väli on `SORTABLE_ATTRIBUTES` hulgas
   - otsitav väli on `SEARCHABLE_ATTRIBUTES` hulgas

   Pelk väljanime-olemasolu ei piisaks: väli võib dokumendis alles olla, aga
   päring hakkab pärast indeksiseadete muutust 400-ga kukkuma. See test on
   peamine põhjus, miks pakett elab samas repos.
3. **`structured_output` test** — ükski registreeritud tööriist ei tagasta
   `structured_content`-i.
4. **stdout-puhtuse test** — tööriista täitmine ei kirjuta `stdout`-i.
5. **`@pytest.mark.live` suitsutest** päris API vastu, vaikimisi ei jookse.

`mcp/tests/` lisatakse juurkataloogi `pytest.ini` testiteede hulka, nii et
olemasolev `.venv/bin/pytest` käivitab need koos ülejäänuga — eraldi testikäsku
ei teki. `mcp` sõltuvus läheb `requirements-dev.txt`-i (CI jookseb 3.12 peal),
MITTE `requirements.txt`-i.

## Tulevik (ei ehitata praegu)

- **Prosopograafia täiendamine agendi poolt** — autenditud kirjutustee
  `client.py`-sse. Nõuab oma disaini: kes tohib, mis läheb ülevaatusele, kuidas
  git-commit märgib agendi autorluse.
- **HTTP-transport** — `streamable-http` `run()`-i juures, kui agente hakkab
  jooksma konteinerites või mujal masinas.
- **Pildi laadimine mudelisse** — eeldab eraldi poliitikaotsust `is_public`
  materjali kohta. Ilma selleta jääb keeld püsima.
