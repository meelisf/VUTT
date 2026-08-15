# VUTT MCP-server — disain

Kuupäev: 2026-08-15
Seis: kinnitatud disain, ootab teostusplaani

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
piltide laadimine mudelisse, kohanimede register, sõnavarad, arhiivide register.

**Väljas põhimõtteliselt:** piltide baidid. `is_public` väli kaitseb
**skaneeringuid**, mitte teksti — kaitstud materjali ei saadeta kolmandale
LLM-pakkujale. Link skaneeringule (töölaua kaudu) on lubatud; pilt ise mitte.

## Kontekst ja piirangud

### Kasutaja ja juurutus

Üks kasutaja, üks masin, mitu klienti. **stdio-transport**: klient käivitab
protsessi ise, andes käsu — agent ei pea VUTT-i repos olema ega sellest midagi
teadma.

Klientide MCP-tugi on ebaühtlane. Kindlalt toetatud on ainult **tools**.
Seega: **ei `resources`, `prompts`, `sampling`, `elicitation` ega
`structuredContent`** — ainult tööriistad ja tekstiplokid. Tööriistade
kirjeldused peavad olema iseseletavad: mudel, kes VUTT-ist midagi ei tea, peab
kirjeldusest aru saama, mis on `work_id` ja mida seisund `Toores` tähendab.

HTTP-transport ei ole praegu vaja, aga MCP SDK-s on transport käivitusparameeter
— sama tööriistade komplekt saab hiljem HTTP-serverina üles tulla ilma ühtki
tööriista ümber kirjutamata. Seda **ei ehitata praegu**.

### Andmeallikas

MCP-server on **avaliku HTTPS-API õhuke klient**. Backend-muudatusi ei tehta.

| Allikas | Tee | Märkus |
|---|---|---|
| Meilisearch | `https://vutt.utlib.ut.ee/meili/` | search-only võti, indeks `teosed` |
| Prosopograafia | `https://vutt.utlib.ut.ee/api/files/prosopography…` | `_optional_user` — juba avalikud |
| Töölaud (lingid) | `https://vutt.utlib.ut.ee/work/{work_id}/{lk}` | inimesele järelevaatamiseks |

**Meili indeks `teosed` on lehekülje-põhine** — iga dokument on üks lehekülg,
mitte üks teos. Katkepõhine otsing on seetõttu natiivne (`attributesToCrop` →
`_formatted`); teosetasandi otsing tuleb `distinct: "work_id"`-ga.

`is_public` väli on indeksis olemas, aga frontend ei filtreeri selle järgi ja
**ka MCP-server ei filtreeri** — tekst on niikuinii anonüümselt otsitav. Vt
„Ulatus" piltide kohta.

## Arhitektuur

```
mcp/
  pyproject.toml          # console-script: vutt-mcp
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

### Miks samas repos

Peamine katkemise allikas on Meili väljanimede muutumine. Sama repo tähendab,
et pariteedi-test (vt „Testimine") jookseb samas CI-s ja Meili skeemi muutus
katkestab buildi, mitte agendi vaikselt tühja tulemusega.

`mcp/` ei sõltu millestki peale HTTP-kliendi — kui see hiljem eraldi repoks või
avalikuks teenuseks tõsta, on kaust puhtalt välja tõstetav.

## Tööriistad

Seitse tööriista, teadlikult vähe. Iga lisatööriist on agendi jaoks valik, mille
ta võib valesti teha.

### `search_pages`

Täistekstiotsing lehekülje tasandil. Vastab küsimusele „kus seda mainitakse".

Parameetrid: `query` (kohustuslik), `collection`, `year_from`, `year_to`,
`language`, `genre_id`, `work_id`, `limit` (vaikimisi 10, max 50), `offset`.

Tagastab hitid koos ~200-tähemärgise katkega ümber leiu.

### `search_works`

Sama päring teosetasandil (`distinct: "work_id"`). Vastab küsimusele „millised
teosed seda üldse käsitlevad". Samad filtrid mis `search_pages`.

### `get_work`

Ühe teose täismetaandmed: pealkiri, loojad rollidega, aasta, koht, kirjastaja,
žanr, tüüp, keeled, kollektsioonid, väline ID (ESTER), märkmed — pluss
lehekülgede loend seisunditega.

Parameetrid: `work_id`.

### `get_pages`

Lehekülgede vahemiku täistekst.

Parameetrid: `work_id`, `from_page`, `to_page` (kaasa arvatud).

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

### `list_filter_values`

Legaalsed väärtused filtriväljadele: kollektsioonid, žanrid (Q-koodid +
sildid), tüübid, keeled (ISO-koodid). Parameeter: `field`.

Olemas seepärast, et ilma selleta pakub agent filtriväärtusi ära ja saab tühje
tulemusi — ta ei tea, et žanr on Q-kood ja keel ISO-kood.

## Väljund

Ainult tekstiplokid. Kaks stiili.

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

- 5xx või timeout → üks kordusekatse, siis loetav veateade (mitte traceback)
- Tundmatu `work_id` → veateade, mis soovitab `search_works`-i
- `get_pages` üle 20 lk → veateade lehekülgede arvu ja soovitusega
- Puuduv või kehtetu Meili võti → server keeldub käivitumast selge sõnumiga

Viimane ei ole teoreetiline: `.env.local`-i otsinguvõti ei kehti tootmises
(kontrollitud disainifaasis, `invalid_api_key`).

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

Kolm kihti:

1. **Üksustestid salvestatud HTTP-vastustega** — päringu koostamine
   (`queries.py`) ja vormindamine (`format.py`). Võrku CI-s ei puutu.
2. **Väljanime-pariteedi test** — impordib `server.meili_doc`-i ja kukub, kui
   `queries.py` küsib välja, mida indekseeritavas dokumendis pole. See on
   peamine põhjus, miks pakett elab samas repos.
3. **`@pytest.mark.live` suitsutest** päris API vastu, vaikimisi ei jookse.

Väravad: `mcp/tests/` lisatakse juurkataloogi `pytest.ini` testiteede hulka, nii
et olemasolev `.venv/bin/pytest` käivitab need koos ülejäänuga — eraldi
testikäsku ei teki.

## Tulevik (ei ehitata praegu)

- **Prosopograafia täiendamine agendi poolt** — autenditud kirjutustee
  `client.py`-sse. Nõuab oma disaini: kes tohib, mis läheb ülevaatusele, kuidas
  git-commit märgib agendi autorluse.
- **HTTP-transport** — `--http` lipp, kui agente hakkab jooksma konteinerites
  või mujal masinas.
- **Pildi laadimine mudelisse** — eeldab eraldi poliitikaotsust `is_public`
  materjali kohta. Ilma selleta jääb keeld püsima.
