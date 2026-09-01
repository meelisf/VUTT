# Gemini re-OCR superadminile — teine OCR-pakkuja sama lõpptulemusega

**Kuupäev:** 2026-09-01
**Seotud:** ADR 0015 (hulgi-vastuvõtt), ADR 0017/0028 (LOSS ainult OCR-ib), ADR 0018
(katkestamine), ADR 0021 (env-nimed), ADR 0025 (`.err` vea-märgend)
**Staatus:** disain ülevaatamiseks, teostamata

## Probleem

Re-OCR käib täna ainult ühte teed: pilt läheb SFTP-ga LOSS-serverisse, seal töötleb
Qwen3.5 fine-tuunitud mudel ja VUTT tõmbab `.txt` tagasi. Sellel teel on kaks piirangut,
mida ei saa VUTT-i poolelt lahendada:

1. **Üks GPU, üks järjekord.** LOSSil ei ole tööde mõistet (#132) — kõik kasutajad ja
   kõik upload'id jagavad sama `main_loop`-i. Ühe teose hulgi-re-OCR blokeerib teised.
2. **Üks mudel — ja käsikirjal jääb see puudu.** VUTT-i oma kurrendi-mudel ei tule
   keerulise käekirjaga toime, ja fine-tuunitud mudelit ei saa ühe teose jaoks ümber
   sõnastada. Sama kehtib materjali kohta, mis ei ole raamatuleht: kataloogisedelid,
   tabelid, kreeka lõigud.

Vaja on **teist pakkujat** — Google Gemini API — nii, et:

- valik on **ainult superadminil** (vähemalt esialgu),
- API võti elab `.env`-is ega ole ühelegi teisele kasutajale kättesaadav,
- protsess annab **sama lõpptulemuse** kui tavaline re-OCR,
- see töötab mõlemas kohas, kus re-OCR täna elab: Workspace'i redaktoris (üksik leht) ja
  Manage-lehel (valitud lehtede hulgitöö).

**Peamine kasutus on käsikiri ja ebatavaline materjal, mitte trükis.** See ei ole
kõrvalmärkus — see määrab, kus spekk lubab kahel teel lahkneda (juhis) ja kus mitte
(`.ocr` → `.txt`).

## Miks „sama lõpptulemus" on odav lubada

Re-OCR-i tulemuse tee **ei sõltu juba täna pakkujast**:

```
pilt → [OCR] → tekst → {slug}/{tüvi}.ocr          ← staging, git-ignoreeritud
                              ↓
                  reocr_apply.apply_ocr_results()
                    NFC + normalize_marginalia_tags()
                    → {tüvi}.txt
                    → ÜKS git-commit (save_with_git, additional_files)
                    → ÜKS Meili sünk (background_tasks)
```

`server/reocr_apply.py` ei impordi `reocr_ops`-i ega tea LOSS-ist midagi — ta loeb
ainult `.ocr` faile teose kaustast. Sama kehtib kogu ülejäänud masinavärgi kohta:
`.ocr` varukoopiad (`state/reocr_backups/`), `produced_pages` omand, katkestamise CAS,
`reocr_active.json` püsivus, `reocr_log.json`, Manage'i „ootel" riba, Workspace'i
tulemuse-overlay.

**Sellest järeldub speki keskne väide:** kui Gemini-tee kirjutab sama `.ocr` faili sama
funktsiooniga (`_write_ocr_file`) ja registreerib omandi sama funktsiooniga
(`_record_produced`), on lõpptulemus definitsiooni järgi identne. Uus kood lõpeb `.ocr`
faili juures ja ei puutu ühtki rida allpool seda.

## Otsus

**Pakkuja on olemasoleva töömudeli uus dimensioon, mitte paralleelne süsteem.**

Job-kirjesse tuleb väli `provider: "loss" | "gemini"` (puuduv = `"loss"`). Uus moodul
`server/ocr_providers/gemini.py` on **puhas klient ilma oma olekuta**: sisse pildibaidid,
juhis ja näited, välja tekst või erind. Kogu olek, püsivus, katkestamine ja staatus
jäävad `reocr_ops`-i, kus nad täna on.

### Miks mitte eraldi moodul oma registriga

Kaalutud ja tagasi lükatud. Eraldi register tähendaks `.ocr` varundamise, `produced_pages`
omandi, katkestamise CAS-i, TTL-i, `reocr_active.json` püsivuse ja logi dubleerimist, ning
`build_reocr_status` peaks kaht allikat kokku liitma. **Kaks registrit, mis kirjutavad
samu `.ocr` faile teineteise varukoopiaid nägemata, on täpselt see viga, mille #217 juba
korra parandas** (`_write_ocr_file` varundab ülekirjutatava tulemuse; teine register ei
teaks sellest midagi). Hind — kuus haru `reocr_ops`-is — on väiksem kui hind, mille
dubleerimine tooks.

### Miks mitte Gemini LOSSi kaudu

Tagasi lükatud. Mõte on GPU-järjekorrast **mööda** minna; LOSSi kaudu käies jääks
järjekord alles. Lisaks on ADR 0017 põhimõte, et OCR-serverit ei muudeta, ja ADR 0025
näitas, et LOSSi skripti muutmine nõuab eraldi töövoogu (pyflakes + kasutaja restart).

## Eeldused, mis on kontrollitud

| Eeldus | Kontroll | Tulemus |
|---|---|---|
| Backend-konteinerist pääseb API-hostini | `docker exec vutt-backend` → `urlopen("https://generativelanguage.googleapis.com/")` | TLS + DNS OK (HTTP 404 juurteelt) |
| HTTP-klient on olemas | `requirements.txt` | `requests>=2.31.0` |
| Pildi töötlus on olemas | `requirements.txt` | `Pillow>=10.0.0` |
| Pildid mahuvad päringu lakke | `find ~/VUTT/data -name "*.jpg"`, n=25 955 | mediaan 1,4 MB, p95 3,2 MB, **max 12,9 MB** |
| Võtme nime ei ole veel kasutusel | serveri `.env` võtmenimed | `GEMINI_*` puudub |
| `UPLOAD_ENABLED` on tootmises sees | serveri `.env` | `true` (vt „Sõltuvus `UPLOAD_ENABLED`-ist") |

Max 12,9 MB base64-kodeerituna on ~17 MB ja API kogupäringu lagi on 20 MB — piir on
reaalne, mitte teoreetiline. Vt „Pildi ettevalmistus".

## Ligipääsu sulgemine — kolm kihti

Nõue „teised kasutajad ei saaks ligi" tähendab kolme eraldi asja, mitte üht:

1. **Endpoint.** `provider == "gemini"` nõuab `superadmin`-i. Rollikontroll läheb
   funktsiooni sisse, mitte `Depends`-i: FastAPI dependency ei näe request body't, ja
   pakkuja tuleb bodyst. Endpoint jääb `Depends(require_role("admin"))` peale (LOSS-tee
   säilitab praeguse läve) ja haru sees on
   `if not is_at_least(user["role"], "superadmin"): raise HTTPException(403, ...)`.
   **Alati `is_at_least()`, mitte `role == "superadmin"`.**
2. **Frontend.** Nupp renderdub ainult `isAtLeast(user?.role, 'superadmin')` korral.
   See on mugavus, mitte turve — turve on punkt 1.
3. **Võti.** `GEMINI_API_KEY` elab ainult backendi protsessis. Ta ei tohi jõuda ühessegi
   API-vastusesse, logireale ega veateatesse. Päringu headerid **ei lähe logisse** —
   API-võti on headeris.

   **Vastuse keha ei dumbita logisse.** Vea korral logitakse HTTP staatus, Gemini
   veaobjekti `code`/`status`/`message` väljad (JSON-ist parsituna) ja päringu id, kui see
   olemas on. Kui keha ei ole parsitav JSON, logitakse ainult pikkus ja content-type.
   Põhjus: 200-vastus ootamatu kujuga võib sisaldada transkribeeritud teksti, ja
   „välise API veakeha lõikamine logisse" muutub aastatega vaikselt sisulekkeks.

nginx `/api/files/` proksib **kõik** backend-teed avalikult (CLAUDE.md invariant), seega
peavad uued teed olema `/admin/` prefiksi all **ja** rollikontrolliga. Kumbki eraldi ei
ole piisav.

## Endpointid

Uusi kirjutusteid ei tule. Olemasolevad kaks saavad ühe välja juurde:

| Endpoint | Muutus |
|---|---|
| `POST /admin/work/{work_id}/reocr-page` | body: `provider`, `prompt_override?`, `few_shot_pages?` |
| `POST /admin/work/{work_id}/reocr-batch` | body: `provider`, `prompt_override?`, `few_shot_pages?` |
| `GET /admin/reocr/{job_id}/status` | muutmata |
| `GET /admin/work/{work_id}/reocr-status` | vastusesse `active_provider` |
| `POST /admin/work/{work_id}/reocr-apply` | **muutmata** |
| `POST /admin/work/{work_id}/reocr-discard` | **muutmata** |
| `DELETE /admin/reocr/{job_id}` | muutmata (vt „Katkestamine") |

Uued endpointid (kõik `superadmin`):

```
GET /admin/ocr/providers        → {"gemini": {"enabled": true, "model": "gemini-3.7-flash"}}
GET /admin/work/{id}/ocr-prompt → {"prompt": …, "few_shot": […], "default_prompt": …}
PUT /admin/work/{id}/ocr-prompt
```

`GET /admin/ocr/providers` on vajalik selleks, et nupp ei ilmuks siis, kui võtit pole
seatud, ja ei kukuks alles vajutusel. **Vastus ei sisalda võtit ega selle pikkust ega
prefiksit** — ainult `enabled` ja mudeli nime. `ocr-prompt` teed on kirjeldatud peatükis
„Prompti kohendamine ja few-shot näited".

`get_active_batch_for_work()` lukk jääb **pakkuja-üleseks**: ühel teosel tohib korraga
käia üks hulgitöö, ükskõik kumma pakkujaga. Kaks paralleelset batchi kirjutaksid samu
`.ocr` faile.

## Gemini-klient

`server/ocr_providers/gemini.py`, ainus avalik funktsioon:

```python
def transcribe(image_bytes: bytes, instruction: str,
               few_shot: Sequence[Tuple[bytes, str]] = ()) -> Tuple[str, Usage]:
    """Pilt + juhis (+ (pilt, tekst) näited) → (tekst, normaliseeritud usage).
    Viskab GeminiError-i, mille sõnum on kasutajale näidatav."""

# Usage on VUTT-i oma kuju, MITTE API väljundi peegeldus:
# {"input_tokens", "output_tokens", "thought_tokens", "cached_tokens", "total_tokens"}
```

Juhise **valik** (materjalitüüp → vaikeväärtus, teose salvestatud juhis, päringu
override) on kutsuja töö, mitte kliendi oma. Klient ei loe `_metadata.json`-it ega
`state/`-i — nii jääb ta puhtaks ja testitavaks ilma failisüsteemita.

**Klient normaliseerib usage-andmed kohe VUTT-i kujule.** Interactions API väljastab
`usage.total_input_tokens` / `total_output_tokens` / `total_thought_tokens` /
`total_cached_tokens`; legacy `generateContent` väljastas `usageMetadata` teiste nimedega;
järgmine API-põlvkond nimetab need kolmandat moodi. `reocr_ops` ja `reocr_log.json` ei tohi
ühtki neist nimedest teada — nad näevad ainult ülal kirjeldatud viit välja. See on sama
piir, mis teeb `transcribe()` signatuurist lepingu: API kuju on teostusdetail.

- **Endpoint:** Gemini API `generativelanguage.googleapis.com`, autentimine
  `x-goog-api-key` headeriga, mudel päringu kehas. Täpne tee ja keha kuju fikseeritakse
  teostusplaanis hetkel kehtiva dokumentatsiooni järgi — Google on API kuju viimase aasta
  jooksul vahetanud (`generateContent` → Interactions), seega **kutse kuju on
  teostusdetail, mitte selle speki leping**. Leping on `transcribe()` signatuur.
- **Mudel:** `GEMINI_OCR_MODEL`, vaikimisi `gemini-3.7-flash`.
- **Timeout:** `GEMINI_REQUEST_TIMEOUT`, vaikimisi 120 s. Ilma selleta ei lõpe töölõim
  kunagi ja katkestamine jääks rippuma.

**Invariant: iga päring kannab `store=false`.** Interactions API **salvestab vaikimisi**
(`store=true`) — dokumentatsiooni sõnastuses „the server enables state by default
(`store=true`), but you can opt into stateless behavior by setting `store=false`".

See ei ole hügieeni-, vaid **privaatsusküsimus**. Otsustatud on, et Gemini-tee tohib
puutuda ka mitteavalikke teoseid; `store=true` tähendaks, et need skannid ja nende
transkriptsioonid jäävad Google'i serverisse seisma, ilma et VUTT-i poolel oleks midagi,
mis seda näitaks või kustutaks. OCR-il ei ole serveripoolset vestlusolekut vaja ühelgi
juhul — `previous_interaction_id` ahelat siin ei ole.

Ilma selleta oleks väide „klient on olekuta" tõene ainult VUTT-i pool. Google dokumenteerib
tasulisel tasandil salvestatud interaktsioonide säilituseks **55 päeva**.

**Deploy-invariant: `GEMINI_API_KEY` peab kuuluma billing-enabled (Paid Tier) projektile.**
See on `store=false`-ist **eraldi ja sellest sõltumatu** nõue. Tasuta tasandil kasutatakse
sisu Google'i toodete parandamiseks, tasulisel mitte — ja kuna Gemini-tee tohib puutuda
mitteavalikke teoseid, on tasuta võtmega ajamine kvalitatiivselt teistsugune otsus kui see,
mille sina tegid. Runtime'is seda ei kontrollita (API ei anna mõistlikku tier-preflight'i);
see kuulub deploy-kontrollnimekirja.

**Täpsustus, mida `store=false` EI tee:** ta keelab Interaction-objekti tavapärase
serveripoolse salvestamise. Ta ei tähenda, et Google päringut ei töötle ega rakenda oma
tingimuste kohast väärkasutuse-seiret — sellel on API-logidest eraldi elutsükkel.

**Sampling-parameetreid ei saadeta.** `gemini-3.7-flash` migratsioonijuhis ütleb otse:
„remove deprecated sampling parameters (`temperature`, `top_p`, `top_k`)". Nende asemel on
`thinking_level` (`low` | `medium` | `high`, vaikeväärtus `medium`).

**`GEMINI_THINKING_LEVEL`, vaikimisi `low`.** Transkribeerimine on tajuülesanne, mitte
arutlusülesanne, ja thinking-tokenid lähevad väljundikulu hulka. `low` on lähtekoht, MITTE
mõõdetud tulemus — keerulise käekirja puhul võib `medium` end ära tasuda ja see on
võrdlusjooksu eraldi muutuja (vt allpool). Seadistatav just sellepärast, et seda saaks
mõõta ilma deploy'ta.

**`temperature` jaoks env-nime EI ole.** Kaalusin seda vanema mudeli katsetamiseks, aga
see oleks surnud konfiguratsiooniharu: 3.x-il ei tohi parameetrit saata, ja vanema mudeli
pinnimine on niikuinii ülevaatust nõudev muudatus (vt „Riskid"), mille käigus saab
parameetri koos ülejäänuga lisada. Üks tingimuslikult surnud env-nimi on halvem kui
puuduv nimi — ADR 0021 mõte on, et iga nimi kannab elavat seadet.

### Juhis (prompt)

Uus fail `server/ocr_prompts.py` sisaldab kaht konstanti. Materjalitüüp tuletatakse
**sama reegliga mis täna** (`server/routers/reocr.py` `_prepare_reocr_page`):
`_metadata.json` `type.id == "Q87167"` → `hand`, muidu `print`. Hulgitööl tuleb tüüp
kliendilt nagu praegugi.

**`GEMINI_PRINT_INSTRUCTION` — trükis, kopeeritud sõna-sõnalt** LOSSi
`~/Dokumendid/LLM/qwen3.5/scripts/prompt.py` `INSTRUCTION`-ist. See prompt **defineerib
VUTT-i märgenduse**: `<i> <b> <cs>`, `<m>` iga füüsilise marginaaliarea kohta eraldi,
`<fn>`, `<pb/>`, `<noodid>`, antiikva-poolitus `-` vs fraktuuri-poolitus `⸗`, ſ ja ß
säilitamine, ligatuuride reeglid, tühja lehe märgend. Siin on pariteet LOSS-iga range
nõue: sama teost transkribeeritakse mõlema pakkujaga ja tulemused peavad olema samas
märgenduses.

**`GEMINI_HAND_INSTRUCTION` — käsikiri, VUTT-i oma versioonitud juhis.** Alguspunkt (v1)
on LOSSi `KURRENT_INSTRUCTION` sõna-sõnalt, **aga see fail tohib LOSS-ist lahkneda** ja
seda arendatakse edasi VUTT-i repos. Kolm põhjust:

1. **Käsikiri on Gemini-tee peamine kasutus.** VUTT-i oma kurrendi-mudel ei tule
   keerulise käekirjaga toime; just seepärast see pakkuja lisatakse. Trükis on
   kõrvalvõimalus.
2. **Pariteedinõue on trükise oma, mitte käsikirja oma.** Range pariteet on vajalik seal,
   kus sama teost transkribeeritakse mõlema pakkujaga ja tulemused peavad kokku minema —
   see on trükis. Käsikirja materjali, mille pärast Gemini üldse lisatakse, LOSSi mudel
   praegu rahuldavalt ei transkribeeri; kahe teel identse juhise hoidmine ei anna seal
   võrreldavust, vaid ainult piirab paremat teed halvema järgi.

   > **Lahtine kontrollküsimus.** Speki varasem versioon põhjendas seda punkti väitega, et
   > LOSSi `get_instruction()` saadab mõlemale tüübile `INSTRUCTION`-i. Lugesin koodi ja
   > see näib nii olevat (`return INSTRUCTION`, `from prompt import INSTRUCTION`, mõlemad
   > mootoriteed real 571 ja 646), aga **Meelis ütles, et see ei ole nii** — järelikult on
   > midagi, mida kood ei näita. Kuni see on selgitatud, ei toetu ükski selle speki otsus
   > sellele väitele. Käsikirja prompti omamise põhjendus seisab iseseisvalt punktidel 1 ja 3.
3. **Gemini ei ole fine-tuunitud.** Qwen-i kurrendi-mudel on treenitud üht kindlat
   väljundivormi tootma; Gemini järgib ainult juhist. Juhise sõnastus **on** seal
   kvaliteedi peamine hoob, ja selle lukustamine kellegi teise mudeli treeningvormi
   külge annaks kehvema tulemuse ilma vastutasuta.

Mida see praktikas tähendab: `.ocr` → `.txt` tee jääb identseks (see on speki keskne
väide ja see ei sõltu promptist), aga **käsikirja väljundi vorm on VUTT-i otsus.**
v1 jääb LOSSi omaga samaks — plain text, ilma XML-märgenditeta, poolitus `¬` — et esimene
võrdlusjooks mõõdaks mudelit, mitte prompti. Iga hilisem muudatus on eraldi commit
mõõtmisega; kandidaadid, mis on juba teada:

- **Marginaalia.** Käsikirjades on servamärkusi, aga v1 keelab XML-märgendid täielikult.
  Kui `<m>` lubada, tuleb ADR 0009 reegel (iga füüsiline rida eraldi plokk) juhisesse
  sõnaselgelt kirjutada — muidu tekib üks hiigelplokk, mille `normalize_marginalia_tags`
  küll kanooniliseks viib, aga mis on sisuliselt vale.
- **Ebakindel lugem.** Keerulise käekirja puhul on „ei suuda lugeda" kasulikum kui
  väljamõeldis. Vorm tuleb valida enne, kui see juhisesse läheb — suvaline märk `[?]`
  läheks `.txt`-sse ja sealt Meilisse.
- **Poolitusmärk `¬`** ei ole see, mida trükise tee kasutab (`-` / `⸗`). Kui käsikirja
  tulemusi hakatakse otsingus trükistega kõrvuti kasutama, tuleb see ühtlustada.

### Prompti kohendamine ja few-shot näited

Kuna Gemini ei ole fine-tuunitud, on **kontekst kvaliteedi peamine hoob**. Vaikimisi
juhised on kirjutatud raamatulehe jaoks ja kukuvad läbi materjalil, mis ei ole raamatuleht.

Mõõdetud näide — sedelkataloog `996o7v` („Sedelkataloog Emil / ajalugu", 53 lehte, kõik
`Toores`). Praeguse mudeli väljund lehel 1:

```
Mus. 1309 Alexander I. Die Adreſse der Juden an Alexander den Erſten. Litographie. 1806. 2 Bl. Jn Deutſch und Jücliſch. 37,6 x 20,0 Jn. 1900 Ajaluzi
```

Kaardi **reastruktuur on täielikult kadunud** — signatuur, kirje, formaat ja mõõtmed on
ühel real. Kataloogisedel ei ole raamatuleht: seal ei ole jooksvat teksti, poolitusi ega
marginaale, küll aga on kindel väljajärjestus, mida iga järgmine sedel kordab. Ükski
üldjuhis seda ei ütle, ja pooltuhande sedeli jaoks ei ole mõtet seda igal käivitusel uuesti
sõnastada.

Sellest kaks nõuet, mis moodustavad ühe mehhanismi.

#### 1. Juhis on redigeeritav ja jääb teose külge

Töö käivitamise bodys on valikuline `prompt_override` (vaba tekst). Puudub → teose
salvestatud juhis; seda ka pole → `server/ocr_prompts.py` vaikeväärtus materjalitüübi
järgi.

Teosepõhine seadistus elab failis `state/ocr_prompts.json`:

```json
{"996o7v": {"prompt": "...", "few_shot": ["sedel_004", "sedel_011"],
            "updated_at": 1756...,  "updated_by": "meelis"}}
```

**`state/`, mitte `_metadata.json`.** Sama põhjus, miks `ocr_model` on omas state-väljas
(ADR 0028): see on **töötlusotsus**, mitte bibliograafiline väide. `_metadata.json` on
Meili allikas ja läheb `save_work_metadata()` teed — OCR-juhis ei kuulu sinna.
`state/` ei ole gitis; püsiv jälg tuleb logi hashist (allpool), ja hea juhise õige lõppkoht
on commit `server/ocr_prompts.py`-sse.

#### 2. Few-shot näited tulevad teose enda parandatud lehtedelt

Sedelkataloogi puhul õpetab **üks käsitsi parandatud sedel rohkem kui lõik juhist** —
just reastruktuur ja väljajärjestus on see, mida sõnadega on tüütu kirjeldada ja näitega
triviaalne.

Näiteid ei sisestata kuskile eraldi: **VUTT-is on need juba olemas.** Leht, millel on
mittetühi `.txt`, ongi (pilt, õige transkriptsioon) paar. Töövoog on seega:

1. paranda 1–2 sedelit käsitsi ja salvesta,
2. märgi need teose seadistuses näideteks,
3. lase ülejäänud 51 hulgitööna läbi.

Päringus on `few_shot_pages: [page_filename, ...]` (kuni `GEMINI_MAX_FEW_SHOT`,
vaikimisi 3).

**Näited esitatakse ÜHE multimodaalse user-inputina, mitte sünteetilise vestlusajaloona.**
Ilmnev variant oleks ehitada `user(pilt) → model(.txt)` paarid, aga see on dokumenteerimata
kasutus: stateless Interactions API nõuab, et mudeli genereeritud sammud saadetaks tagasi
**täpselt sellisena, nagu need API-st tulid**, ja VUTT-i `.txt` ei ole Gemini varasem
vastus — see on inimese kinnitatud ideaalvastus. Sünteetiline `model_output` samm töötaks
tõenäoliselt, aga toetuks käitumisele, mida keegi ei ole lubanud.

Selle asemel on kogu kontekst **üks user-input**, milles vahelduvad pildi- ja tekstiplokid:

```
<juhis>

NÄIDE 1
[pilt]
Selle pildi korrektne transkriptsioon:
<lehe .txt sisu>
LÕPP NÄIDE 1

NÄIDE 2
[pilt]
...
LÕPP NÄIDE 2

TRANSKRIBEERI JÄRGMINE PILT:
[sihtpilt]
Tagasta ainult transkriptsioon.
```

Sama few-shot semantika, sama vahemällu minev prefiks, aga ilma dokumenteerimata
konstruktsioonita.

**Sihtpilt ei ole päringu viimane element** — tema järel on lühike tekstiplokk. Vanem
`generateContent` migratsioonijuhis nõudis, et viimane user-turn sisaldaks mittetühja
teksti; Interactions API-l ma sama nõuet ei leidnud, aga rea lisamine ei maksa midagi ja
väldib API-versioonide vahelist üllatust.

Reeglid:

- **Näited tulevad ainult samast teosest ja peavad olema selle teose kanoonilise
  leheloendi liikmed.** Ei piisa `os.path.basename` kontrollist ega „fail on olemas"
  kontrollist: nõue on **kuuluvus teose lehtede loendisse**. Teisest teosest lugemine
  avaks tee, mida `can_read_work` ei valva.
- **Värav on mittetühi `.txt`, mitte seisund.** `996o7v` on üleni `Toores` — Valmis-nõue
  teeks funktsiooni kasutuks just seal, kus teda vaja on. Seisund kuvatakse valijas
  (nõuanne), see ei blokeeri.
- **Sihtleht ei tohi olla iseenda näide** — dedupe enne päringut.
- **Näitepildid skaleeritakse agressiivsemalt** kui sihtpilt (max mõõde 2000 px): nad on
  kontekst, mitte transkribeeritav objekt. Kogu päringu base64-eelarvet kontrollitakse
  enne saatmist ühe reeglina (`GEMINI_MAX_REQUEST_BYTES` kogu päringule, mitte pildi kohta)
  — 3 näidet + sihtleht ilma selleta ületaks API 20 MB lae.
- **Prefiksi sisu on sama ja järjekord stabiilne:**
  juhis → näide 1 (pilt) → vastus 1 → näide 2 → vastus 2 → **sihtpilt viimasena**.
  Implicit caching töötab ka stateless päringutel ja dokumentatsioon soovitab korduvat
  suurt konteksti hoida päringu alguses. `gemini-3.7-flash` nõuab tabamuseks **vähemalt
  4096 tokenit prefiksis** — few-shot pakiga see täitub, ilma näideteta üldjuhul mitte.
  Sedelkataloogi 51 lehe puhul **võib** see anda reaalse hinnavõidu ilma ühegi uue
  olekumehhanismita. Implicit cache ei ole garantii: dokumentatsioon soovitab *similar
  prefix*, mitte bait-võrdsust, ja tabamust ei lubata. **Seepärast mõõdetakse seda:**
  normaliseeritud usage'i `cached_tokens` ütleb, kas see päriselt töötab. Näidete loend on
  igal juhul **järjestatud, mitte hulk** — stabiilne järjekord on eeldus, mitte optimeering.
- **Kulu kasvab lineaarselt näidete arvuga** ja seda iga lehe kohta. Normaliseeritud usage
  läheb logisse (vt „Kulu nähtavus"), nii et hind on tagantjärele nähtav.

#### Ühised reeglid

- **Ainult Gemini-teel.** LOSS-tee `prompt_override`-i ega `few_shot_pages`-i ei
  aktsepteeri (400) — LOSSi juhis elab LOSSis ja päring seda ei mõjuta.
- **Sama rollivärav** mis pakkujal: `superadmin`. Kumbki ei ole eraldi õigus.
- **Pikkuse lagi** `GEMINI_MAX_PROMPT_BYTES` (vaikimisi 8 KB). Juhis läheb iga lehe
  päringusse; kontrollimatu pikkus on nii kulu- kui veaallikas.
- **Jälgitavus on kohustuslik.** Job-kirjesse ja `reocr_log.json` kirjesse lähevad
  `prompt_source: "default" | "work" | "custom"`, `prompt_sha256` (8 märki) ja
  `few_shot` (näidete tüved). Ilma selleta ei ole kuu aja pärast võimalik öelda, **miks**
  üks partii tuli teistsugune kui teine — ja see on täpselt see küsimus, mida katsetamine
  tekitab.
- **Täisteksti logisse ei kirjutata.** `reocr_log.json` on 500-kirjeline ringpuhver;
  8 KB × 500 oleks 4 MB olekufaili. Täistekst elab job-kirjes seni, kuni töö elab
  (sh `reocr_active.json`-is). INFO-real logitakse hash ja pikkus, mitte juhis ise.

#### Endpointid ja UI

```
GET  /admin/work/{work_id}/ocr-prompt     require_role("superadmin")
PUT  /admin/work/{work_id}/ocr-prompt     require_role("superadmin")
     → {"prompt": str|null, "few_shot": [str], "default_prompt": str}
```

`default_prompt` tuleb kaasa, et UI saaks „lähtesta vaikeväärtusele" teha ilma teist
päringut tegemata. `PUT` kirjutab `state/ocr_prompts.json`-i `atomic_write_json`-iga.

Frontendis on nupu juures kokkupandav „Juhis ja näited" ala: tekstiala eeltäidetud
kehtiva juhisega, näidete valik teose lehtede seast (kuvab seisundi ja tekstiotsa),
ning „salvesta teose juurde". Tühjaks jäetud tekstiala = vaikeväärtus, mitte tühi prompt.

**Mida see EI muuda:** juhis ega näited ei mõjuta `.ocr` → `.txt` teed. Prompt, mis toodab
ootamatut märgendust, läheb ikka läbi `normalize_marginalia_tags()`-i ja võib anda mõttetu
`.txt`. Ainus kaitse on inimene: tulemus on `.ocr` staging'us ja `apply` on käsitsi samm.
**Seda väravat ei tohi automatiseerida** — ja mida vabam on prompt, seda olulisemaks see
värav muutub.

### Väljundi puhastus

`strip_model_output()` — LOSSi `strip_output()` vaste: eemaldab `<think>…</think>` plokid,
assistendi markerid ja markdown-koodiplokid, `strip()`.

**`[tühi lehekülg]` jäetakse puutumata.** LOSS ei eemalda seda ja marker jõuab täna `.txt`-sse;
Gemini-tee peab käituma samamoodi, muidu ei ole tulemus sama.

### Pildi ettevalmistus

**Eelarvet mõõdetakse valmis päringu pealt, mitte pildibaitide summast.** API 20 MB lagi
katab kogu request'i: piltide base64, juhise, few-shot näidete vastusetekstid ja JSON-i
enda overhead'i. Seepärast on kontroll `GEMINI_MAX_REQUEST_BYTES` (15 MiB, konservatiivne
varu) **hinnangulise serialiseeritud payload'i** vastu — üks kontroll kogu päringule, mitte
per-pilt.

| Tingimus | Tegevus |
|---|---|
| päring mahub eelarvesse | pildid saadetakse **bait-baidilt**, ilma ümberkodeerimiseta |
| ei mahu | skaleeritakse: **esmalt näited** (max 2000 px), siis sihtpilt (max 4000 px, quality 90); **logitakse** |

Näiteid skaleeritakse esimesena, sest nad on kontekst, mitte transkribeeritav objekt.
Sihtpildi kvaliteedi ohverdamine on viimane samm.

**Kui päring ei mahu ka pärast mõlemat skaleerimisastet:** API-kutset EI tehta, leht läheb
`error`-iks sõnumiga `request_too_large`. Deterministlik keeldumine on parem kui kutse,
mille API niikuinii tagasi lükkab — ja ilma selle reeglita ei ole fallback-ahelal
terminaltingimust.

Bait-baidilt saatmine on pariteedi küsimus: LOSS saab sama 300 DPI / quality 95 faili
(`FULL_DPI` / `JPEG_QUALITY`, `server/upload/page_source.py`). Skaleerimine puudutab
mõõtmiste järgi murdosa lehtedest, aga see murdosa peab olema logis, et hilisemat
kvaliteedivahet saaks seletada.

### Samaaegsus ja vead

- **Üks töö on järjestikune — v1-s, teadlikult ajutiselt.** Batch käib lehtede üle
  ükshaaval, üks lennus olev päring töö kohta. Katkestamine ja olekumuutus on
  järjestikusel teel kordades lihtsamad, ja esimene versioon peab olema õige enne, kui
  ta on kiire. **Vt „Järelsamm: töösisene paralleelsus" — see ei ole lõppseis.**
- **`GEMINI_MAX_INFLIGHT_REQUESTS` (vaikimisi 4) on ülemine lagi tööde ÜLESES**, mitte
  ühe töö sisene paralleelsus. Ta hakkab mõjuma alles siis, kui korraga käib mitu tööd.
  Sama nagu `RENDER_SEMAPHORE`: **protsessi-lokaalne**, ja kui backend kunagi mitme
  workeriga jookseb, ei ole see enam õige piir — `config.check_render_concurrency()` juba
  hoiatab selle mustri eest. **Piir on VUTT-i poole ettevaatus, mitte Google'i rate limit:**
  konto on Tier 2 (1000–1500 RPM) ja neli lennus olevat päringut on sellest ~1 %.
- `429` ja `5xx` → eksponentsiaalne backoff (`GEMINI_MAX_RETRIES`, vaikimisi 3). Pärast
  viimast katset läheb **see leht** `error`-iks ja töö läheb edasi.
- **Vigane leht on lahendatud, mitte ootel** — sama semantika mis ADR 0025 `.err`
  märgendil. Batchi `last_progress_at` uueneb ka vea peale, muidu annab seisaku-tuvastus
  valehäire.
- Tühi väljund ei ole viga (ADR 0025).

### Kulu nähtavus

Logikirjesse (`reocr_log.json`) lisanduvad `provider`, `model` ja kliendi normaliseeritud
usage-andmed. Kõva eelarvelage ei tule — pidur on superadmin-roll. See on
teadlik valik: alternatiiv (kvoot kasutaja või päeva kohta) nõuaks uut olekuhoidlat, mille
ainus tarbija oleks üks kasutaja.

## Muudatused `reocr_ops`-is

Kuus kohta. Kõik ülejäänu jääb puutumata.

1. **`start_reocr_job`** — `provider` parameeter; `"gemini"` korral käivitub
   `_gemini_single_worker` `_upload` asemel. Job-kirjes ei ole `remote_*` välju.
2. **`start_reocr_batch`** — sama, `_gemini_batch_worker`.
3. **`poll_reocr_job`** — kohe alguses: `if snapshot.get("provider") == "gemini": return`
   salvestatud staatus. Gemini-tööl ei ole kaugfaili, mida küsida.
4. **`_poll_batch_job`** — sama varajane väljumine. Tööd jäävad `_poll_iteration` /
   `_batch_poll_iteration` loenditesse, sest `slow`-lipp ja absoluutne lagi on ka
   Gemini-tööl mõttekad; ainult kaugpärimine jääb ära.
5. **`build_reocr_status`** — vastusesse `active_provider`, et Manage saaks öelda, kumb
   pakkuja parajasti töötab.
6. **`start_reocr_background`** — vt allpool.

`_cleanup_remote_job` **ei vaja muudatust**: ta tagastab juba täna `True`, kui
`remote_work` puudub.

### Töölõim

Gemini töölõim on sama kuju mis `_upload`, aga tsükkel on lehtede üle:

```
iga lehe kohta:
    if _cancel_event(job_id).is_set(): return
    semafor:
        tekst, usage = gemini.transcribe(loe_pilt(), juhis, näited)
    with lock:                                      # ÜKS kriitiline sektsioon
        if job.status != "processing": return       # CAS — katkestamine võitis
        _write_ocr_file(slug, page_filename, tekst, job_id)
        _record_produced(job, page_filename)
        entry.status = "ready"
```

**Kirjutamine ja omandi registreerimine on ÜKS kriitiline sektsioon.** Ilmnev alternatiiv
— kirjuta, siis kontrolli luku all, ja kui katkestamine võitis, kustuta äsja kirjutatud
fail — on **vale**, sest `_write_ocr_file` ei ole puhas kirjutus: ta **varundab olemasoleva
`.ocr` faili enne ülekirjutamist**. Kustutamine ei ole seega tagasipööramine. Jada

> vana `.ocr` on olemas → varundatakse → uus kirjutatakse → katkestamine võidab →
> uus kustutatakse

jätaks sihtkoha tühjaks ja lehe `produced_pages`-ist välja. Taaste sõltuks siis üksnes
sellest, et `_restore_backups()` käib varukoopia-kausta, mitte `produced_pages` järgi, ja
et `_quiesce_upload` jõuab lõime ära oodata. Kaks tinglikku asjaolu terve invariandi all —
see on täpselt see arutluskäik, mida ADR 0018 püüab vältida.

Ühe sektsiooniga kaob kogu klass: katkestamine kas näeb lehte `produced_pages`-is (ja
ADR 0018 olemasolev koristus taastab varukoopia korrektselt) või ei näe teda üldse (ja
`.ocr` ei ole kunagi puudutatud). Vahepealset seisu ei eksisteeri.

**Kontrollitud eeldus:** `_write_ocr_file` ei võta kumbagi job-lukku — tema ainus lukk on
`reocr_state._file_lock`, mis on eraldi. Lukustuse all kutsumine ei anna deadlock'i. Kirjutus
on mõne KB suurune; luku all veedetud aeg on murdosa millisekundist ja seda lukku hoiavad
muidu ainult 10 s tagant käiv poll ja staatuse-endpoint.

Sellega **ei ole Gemini-teel enam oma katkestamisakna-parandust** — ta lihtsalt kasutab
olemasolevat omandi-invarianti atomaarsemalt. LOSSi batch-tee jääb oma laiema aknaga alles
(eraldi töö, eraldi risk), aga võiks sama mustri hiljem üle võtta.

### Katkestamine

`DELETE /admin/reocr/{job_id}` töötab muutmata:

- `_try_begin_cancel` seab `cancelling` → töölõime CAS-kontroll ei lase enam midagi
  kirjutada.
- `_quiesce_upload` join'ib töölõime 30 s. Gemini-lõim võib olla keset API-kutset ja
  join võib aeguda → 503. **See on aktsepteeritud, aga ainult kahe lisainvariandi
  toel** — ilma nendeta oleks „lõim lõpeb hiljemalt kahe minutiga" vale:

  1. **Katkestuslippu kontrollitakse ka iga korduskatse vahel**, mitte ainult lehe
     alguses. Vastasel juhul oleks halvim juhtum `MAX_RETRIES` × `REQUEST_TIMEOUT` +
     backoff ehk **6–8 minutit**, mitte kaks. Pärast katkestamist uut katset ei alustata.
  2. **`requests` timeout ei ole kogu operatsiooni wall-clock deadline** — see on
     connect/read timeout päringu kohta. Ühe lennus oleva päringu tegelik lagi on seega
     „üks read-timeout", ja just seda kaht minutit siin lubatakse: **ühte päringut, mitte
     ühte lehte**. Alternatiiv
  (quiesce'i mitte nõuda) oleks ohutu — Gemini-tööl ei ole kaugkoristust, mille alt
  kirjutaja faile tagasi kirjutaks — aga selle erandi tegemine nõuaks `cancel_reocr_job`
  haruks lõhkumist, mis on ADR 0018 kõige tundlikum kood. **Otsus: erandit ei tehta.**
- `_cleanup_remote_job` → `True` (kaugtööd pole).
- `produced_pages` järgi kustutatakse `.ocr`, varukoopiad taastatakse — ADR 0018
  invariandid kehtivad muutmata.

### Restart

Lennus olev Gemini-töö ei ela restarti üle: kaugartefakti pole, millest jätkata.
`_revive_dead_uploads` teisendab täna `uploading → processing`, lootuses et poll leiab
kaugserverist tulemuse. Gemini-tööl seda lootust ei ole → **käivitusel läheb säilinud
`uploading`/`processing` Gemini-töö `error`-isse** („server taaskäivitus").

**Juba kirjutatud `.ocr` failid jäävad alles.** Need on kehtivad tulemused ja Manage
näitab neid ootel olevana. See on teadlik erinevus katkestamisest (ADR 0018: „osalisi
tulemusi ei säilitata"): katkestamine on kasutaja otsus, et tööd ei olnud; krahh ei ole.

### Sõltuvus `UPLOAD_ENABLED`-ist

`start_reocr_background()` tagastab täna `None`, kui `UPLOAD_ENABLED` on väljas — ja siis
ei laadita `reocr_active.json`-ist **ühtki** tööd. Gemini-tee ei kasuta SFTP-d ega peaks
sellest lipust sõltuma. Muudatus: **tööde laadimine** toimub, kui
`UPLOAD_ENABLED or GEMINI_ENABLED` (viimane on tuletatud lipp „võti on seatud", mitte eraldi env-nimi); **SFTP-põhine `scan_and_recover` + reaper** jäävad
`UPLOAD_ENABLED` taha nagu praegu.

Tootmises on `UPLOAD_ENABLED=true`, seega see ei ole täna elav viga — aga sidumata jättes
oleks Gemini-tee vaikselt katki igas keskkonnas, kus upload on välja lülitatud.

## Konfiguratsioon (ADR 0021)

Üheksa nime, üks seade kohta:

| Nimi | Vaikimisi | Mida |
|---|---|---|
| `GEMINI_API_KEY` | (tühi) | API võti; tühi = funktsioon välja lülitatud |
| `GEMINI_OCR_MODEL` | `gemini-3.7-flash` | mudeli id |
| `GEMINI_MAX_INFLIGHT_REQUESTS` | `4` | lennus olevate päringute lagi **tööde üleselt** (üks töö on järjestikune) |
| `GEMINI_THINKING_LEVEL` | `low` | `low` \| `medium` \| `high`; mudeli vaikeväärtus oleks `medium` |
| `GEMINI_MAX_RETRIES` | `3` | korduskatseid 429/5xx peale |
| `GEMINI_REQUEST_TIMEOUT` | `120` | sekundit ühe kutse kohta |
| `GEMINI_MAX_REQUEST_BYTES` | `15728640` | **hinnanguline serialiseeritud päringu suurus** (API lagi 20 MB) |
| `GEMINI_MAX_PROMPT_BYTES` | `8192` | juhise pikkuse lagi |
| `GEMINI_MAX_FEW_SHOT` | `3` | näidislehti ühe päringu kohta |

Kõik loetakse `config.env()` kaudu. Vana nime ei ole, seega `_LEGACY_ENV_NAMES`-i ei
lisandu midagi.

**Kaks kohta, mitte üks:**

1. `.env.example` — ADR 0021 järgi ainus koht, kus nimed on dokumenteeritud.
2. `docker-compose.yml` backendi `environment:` blokk — compose loetleb muutujad
   **nimeliselt**. Ainult `.env`-i lisamine ei jõuaks konteinerisse ja funktsioon oleks
   vaikselt väljas, `enabled: false`-ga, ilma ühegi veateateta.

`check_production_secrets()` **ei nõua** `GEMINI_API_KEY`-d: puuduv võti on kehtiv
seisund (funktsioon välja lülitatud), mitte konfiguratsiooniviga.

Võti on varem korra lekkinud (`vite.config.ts` `define` plokk, 2026-07-14). Praegu
`vite.config.ts`-is `define`-plokki ei ole ja ADR 0021 punkt 5 keelab saladuste süstimise
frontendi — uus võti ei tohi seda tagasi tuua.

## Frontend

**Workspace** (`src/components/editor/`):

- `useReOcr` saab `provider`, `promptOverride` ja `fewShotPages` parameetrid, mis lähevad
  `reocr-page` bodysse. Kõik muu — pollimine, `localStorage` job_id, `.ocr` kontroll lehe
  vahetusel, overlay — jääb ühiseks. `reocrStorageKey` on lehepõhine, mitte
  pakkujapõhine: ühel lehel saab korraga olla üks ootel tulemus, ükskõik kummalt pakkujalt.
- `HistoryTab` admin-plokis on täna üks rida „Transkribeeri uuesti". Superadminile
  lisandub teine rida „Re-OCR (Gemini)". Rida renderdub ainult siis, kui
  `isAtLeast(user?.role, 'superadmin')` **ja** `GET /admin/ocr/providers` ütles
  `enabled: true`.

**Manage** (`src/pages/manage/`):

- `PageActionBar` — „Transkribeeri" kõrvale teine nupp, sama kinnitusdialoog (`batchConfirm`),
  teine tekst ja pakkuja. Nupp on samadel tingimustel nähtav mis Workspace'is.
- `WorkManage` — `handleBatchReocr(provider, promptOverride, fewShotPages)`;
  ootel-tulemuste rakendamine, katkestamine ja progressiriba on **ühised**, neid ei
  puudutata.

**Uus komponent `GeminiPromptPanel`** (mõlemas kohas sama): kokkupandav ala tekstialaga
(juhis) ja näidislehtede valikuga. Näidete valik loeb teose lehtede loendi, mis on
Manage'is juba olemas; Workspace'is tuleb see `GET /admin/work/{id}/ocr-prompt` +
olemasoleva lehtede-loendi pealt. Salvestamine läheb `PUT`-iga teose juurde. Komponent on
laisalt laetud — superadmini-only funktsioon ei kuulu tavakasutaja bundle'isse.

**i18n (ADR 0011):** uued võtmed lähevad **mõlemasse keelde korraga**
(`src/locales/et/workspace.json` + `en/`, `manage.*` võtmed vastavalt), muidu katkeb
build. `localeParity.test.ts` on valvur.

**z-index:** uusi modaale ei tule — olemasolev kinnitusriba ja overlay jäävad.

## Testid

`tests/` (pytest, `.venv/bin/pytest`):

| Test | Mida kaitseb |
|---|---|
| `provider="gemini"` ei ava SFTP-d | pakkuja-marsruutimine; mock `_sftp_open` peab jääma kutsumata |
| `admin`-roll saab Gemini-teel 403, `superadmin` 202 | ligipääsu kiht 1 |
| `GET /admin/ocr/providers` ei sisalda võtit üheski väljas | ligipääsu kiht 3 |
| `type.id == "Q87167"` → `GEMINI_HAND_INSTRUCTION` | juhise valik materjalitüübi järgi |
| juhise eelistusjärjekord: `prompt_override` > teose salvestatud > vaikeväärtus | „Prompti kohendamine" |
| `prompt_override` LOSS-teel → 400 | LOSSi juhist ei saa päringuga mõjutada |
| üle `GEMINI_MAX_PROMPT_BYTES` juhis → 400 | pikkuse lagi |
| `few_shot_pages` teisest teosest → 400; tühja `.txt`-ga leht → 400 | näidete värav |
| sihtleht oma näidete seas → eemaldatakse | dedupe |
| 3 näidet + sihtleht mahub `GEMINI_MAX_REQUEST_BYTES` sisse (näiteid skaleeritakse esimesena) | päringu eelarve |
| logikirjes on `prompt_sha256` ja `few_shot`, EI OLE juhise täisteksti | jälgitavus + logi suurus |
| **iga** Gemini päring kannab `store=false` | privaatsus: vaikeväärtus on `store=true` |
| päringus ei ole `temperature`/`top_p`/`top_k`, on `thinking_level` | 3.x deprecated parameetrid |
| `few_shot_pages` liige, mida teose leheloendis ei ole → 400 (ka siis, kui fail kettal on) | näidete värav |
| katkestamine 429-backoffi ajal → uut katset ei alustata | katkestamise garantii |
| katkestamine päringu ajal → hilinenud 200 vastus visatakse CAS-i tõttu ära | katkestamise garantii |
| restart keset Gemini batchi → töö `error`, olemasolevad `.ocr` jäävad ja on `apply`/`discard`-itavad | restart-semantika |
| vealogis ei ole vastuse keha lõiku | logi ei leki sisu |
| `strip_model_output()` eemaldab markdown-koodiplokid ja `<think>`, säilitab `[tühi lehekülg]` | pariteet LOSS-iga |
| 13 MB pilt skaleeritakse, 2 MB pilt saadetakse muutmata | pildi lagi |
| 429 → backoff → õnnestumine; 429 × N → lehe `error`, töö jätkub | vigade semantika |
| katkestamine `.ocr` kirjutamise ajal: leht on kas `produced_pages`-is või `.ocr` puutumata — vahepealset seisu ei ole | atomaarne kriitiline sektsioon |
| ülekirjutatud vana `.ocr` taastub katkestamisel ka siis, kui katkestamine tabas kirjutamise hetke | varukoopia ei lähe kaotsi |
| päring ei sisalda ühtki `model`-rolli sammu (näited on user-inputis) | dokumenteerimata konstruktsiooni ei kasutata |
| sihtpildi järel on mittetühi tekstiplokk | API-versioonide kindlus |
| skaleerimise järel liiga suur päring → `request_too_large`, API-kutset ei tehta | fallback-ahela terminaltingimus |
| `transcribe()` tagastab VUTT-i usage-kuju, mitte API oma välju | pakkuja-piir |
| sama `.ocr` sisu mõlemalt teelt → identne `.txt` pärast `apply_ocr_results` | **speki keskne väide** |

Gemini HTTP-kutse on kõigis testides mockitud. Päris API-t testid ei puuduta ja
`GEMINI_API_KEY` ei ole testide jooksutamiseks vajalik.

Frontend: `npm run typecheck` + `localeParity.test.ts` on väravad; uut Vitest-testi
vajab ainult `useReOcr` pakkuja-parameeter, kui selle loogika muutub.

## Teostuse järjekord

1. `server/ocr_prompts.py` + `strip_model_output()` + testid. Ei sõltu millestki.
2. `server/ocr_providers/gemini.py` — klient (juhis + näited parameetritena), mockitud
   testidega. Ei sõltu `reocr_ops`-ist ega failisüsteemist.
3. `config.py` env-nimed + `.env.example` + `docker-compose.yml`.
4. `reocr_ops` kuus haru + töölõimed + `start_reocr_background` gate.
5. `routers/reocr.py` — `provider` väli, rollivärav, `GET /admin/ocr/providers`.
6. Frontend, **minimaalne tee**: `useReOcr` → `HistoryTab` → `PageActionBar`/`WorkManage`
   + i18n. Selle punktiga on esialgne nõue („superadmin saab Gemini-ga re-OCR-i teha")
   täidetud ja funktsiooni saab tootmises proovida.
7. `state/ocr_prompts.json` moodul + `GET`/`PUT /admin/work/{id}/ocr-prompt`
   + `prompt_override` päringus.
8. `few_shot_pages` — serveripoolne kontekstiehitus + eelarvekontroll.
9. `GeminiPromptPanel` — juhise tekstiala + näidislehtede valik, mõlemas kohas.
10. **Võrdlusjooks** — vt allpool.

Punktid 1–6 on iseseisvalt kasutuskõlblik tulemus; 7–9 on iteratsioonisilmus, mille väärtus
selgub alles siis, kui punkt 6 on päris materjali peal proovitud. **Kui töö tuleb kuskilt
katkestada, siis 6. ja 7. vahelt** — mitte keset kontekstiehitust.

## Järelsamm: töösisene paralleelsus

Järjestikune v1 ei ole lõppseis, ja põhjus on mõõdetav: **Gemini-lehe latentsust domineerib
mudeli mõtlemisaeg, mitte VUTT-i töö.** See on aeg, mille API kulutab — VUTT ootab. N
paralleelset päringut võib seega anda kuni ligikaudu N-kordse läbilaskevõime ilma ühegi
lisaressursita VUTT-i poolel — „kuni", sest serveripoolne batching ja latentsuse hajuvus
söövad osa võidust ära. Just seda, mida `thinking_level` maksab, saab paralleelsusega tagasi.

50-leheline dokument järjestikku, ~20 s/leht, on ~17 minutit. Neljaga paralleelselt ~4.
Sedelkataloogi mõõtu töö juures on see vahe olulisem kui kogu ülejäänud optimeerimine kokku.

**RPM ei ole piirang ega saa selleks.** Konto on **Tier 2: 1000–1500 RPM** mudelist
sõltuvalt (Google ei avalda neid numbreid enam dokumentatsioonis — need on konto-põhised ja
nähtavad AI Studio limiidivaates; see arv on sealt).

Mida see tähendab 51-lehelise sedelkataloogi juures, ~20 s/leht:

| Workereid | Kestus | Kulutatud RPM | Osa limiidist |
|---|---|---|---|
| 1 (v1) | ~17 min | 3 | ~0,2 % |
| 4 | ~4 min | 12 | ~1 % |
| 8 | ~2 min | 24 | ~2 % |

Ehk RPM-i poolelt on ruumi kahe suurusjärgu jagu. **`GEMINI_MAX_INFLIGHT_REQUESTS = 4` on
seatud ettevaatusest VUTT-i poole vastu, mitte Google'i limiidi vastu** — ja seda tuleb
paralleelsuse lisamisel niimoodi ka põhjendada, mitte rate-limitiga. Vale põhjendus viiks
hiljem vale otsuseni.

**Kitsaskoht nihkub RPM-ilt TPM-ile, ja few-shot nihutab teda kiiremini.** Iga näide
kordab oma pildi tokenid **igas** päringus: 51 lehte × 2 näidet tähendab, et needsamad kaks
pilti saadetakse 51 korda. Just see teeb stabiilse prefiksi ja implicit caching'u (vt
„Prompti kohendamine ja few-shot näited") mitte optimeerimiseks, vaid **eelduseks** —
ilma tabamusteta kasvab TPM lineaarselt näidete arvuga. TPM-i tegelik number on samas AI
Studio vaates ja **see** tuleb enne paralleelsuse tõstmist üle vaadata, mitte RPM.

**Ja üks tagajärg teistpidi:** 1500 RPM tähendab, et vigane kordusloop suudab kulutada
raha kiiresti. Eelarvelage ei ole (teadlik valik, vt „Kulu nähtavus") — mida kõrgemaks
paralleelsus läheb, seda rohkem see valik kaalub.

Miks see siiski ei ole v1-s:

| Mida paralleelsus katki teeb | Kas on juba lahendatud |
|---|---|
| lehe `.ocr` kirjutamine + `produced_pages` | **jah** — CAS ja omand on juba per-leht, luku all |
| `last_progress_at` mitmest lõimest | **jah** — uuendus käib sama luku all |
| katkestamine N lennus oleva päringuga | **osalt** — `_cancel_event` on tööpõhine ja jagatud; iga worker peab seda kontrollima nagu praegu, aga `_quiesce_upload` join'ib **ühte** lõime |
| vigade kuhjumine (429 korraga N-lt lõimelt) | **ei** — backoff peab olema tööülene, mitte per-worker, muidu löövad kõik korraga uuesti |

Ehk kaks tegelikku tööd: `_quiesce_upload` peab join'ima worker-pooli, mitte üht lõime, ja
backoff peab olema jagatud. Ülejäänu on juba paigas, sest per-lehe invariandid kirjutati
algusest peale lehe, mitte lõime ümber.

Kuju: `ThreadPoolExecutor(max_workers=GEMINI_JOB_WORKERS)` lehtede üle, `max_workers=1`
vaikeväärtusena = tänane käitumine. Nii on lülitus tagasi järjestikusele ühe seadistuse
kaugusel, kui midagi üllatab.

**Eeltingimus:** võrdlusjooks (allpool) peab olema tehtud enne. Kiirem vale vastus ei ole
edasiminek, ja `thinking_level` valik mõjutab otseselt seda, kui palju paralleelsus üldse
võita annab.

## Enne laiemat kasutuselevõttu: võrdlusjooks

Gemini ei ole VUTT-i märgendusel treenitud nagu Qwen; ta järgib juhist, aga `<m>`
plokkide granulaarsus (ADR 0009: iga füüsiline rida eraldi täg), ⸗-poolitus ja ſ/ß
säilitamine on **mõõtmata**.

Kaks eraldi jooksu, sest põhikasutus ja pariteedinõue ei lange kokku:

**A. Käsikiri — kas see üldse tasub ära.** Peamine kasutus. Võta materjal, millega
kurrendi-mudel hädas on, lase mõlemast teest läbi ja võrdle silmaga; formaalne CER eeldab
tõesttausta, mida keerulisel käekirjal enamasti ei ole. Otsustav küsimus ei ole „kumb on
täpsem", vaid „kas parandamine läheb kiiremaks".

**B. Trükis — kas märgendus tuleb õige.** Siin on pariteedinõue range (sama teost
transkribeeritakse mõlema pakkujaga). ~20 lehte, mille kohta on inimese kinnitatud
„Valmis" tekst; mõõda CER, `<m>` plokkide arv, ⸗ vs `-` osakaal.

**A2. `thinking_level` — kas arutlus tasub ära.** Sama käsikirjamaterjal, `low` vs
`medium`, sama juhis. `low` on speki vaikeväärtus **lähtekohana, mitte mõõdetud
järeldusena**. Neli mõõdikut korraga, sest nad annavad vastuse ka paralleelsuse otsusele:

| Mõõdik | Miks |
|---|---|
| parandamise aeg | päris eesmärk — kas inimese töö läheb kiiremaks |
| API latentsus lehe kohta | kas `medium` teeb hulgitöö oluliselt aeglasemaks |
| `thought_tokens` | otsene kulu |
| subjektiivne lugemistäpsus | kas arutlus aitab keerulist kurrenti |

**`temperature` ei ole `gemini-3.7-flash`-il katsetatav muutuja** — parameeter on seal
deprecated ja seda ei saadeta. Selle mõõtmiseks tuleks `GEMINI_OCR_MODEL`-iga pinnida vanem
mudel, mis teeb muutujaid kaks (mudel + temperatuur) ja mõõtmise seega mitteinformatiivseks.
Kui see katse on ikkagi soovitud, on ta eraldi töö oma seadistusega.

**C. Sedelkataloog — kas few-shot töötab.** `996o7v` on valmis testjuhtum: paranda 2
sedelit käsitsi, lase ülejäänud 51 läbi (a) ilma näideteta, (b) näidetega. Mõõdetav
suurus on reastruktuuri säilimine — praegune väljund kaotab selle täielikult.

Ükski neist ei blokeeri teostust — funktsioon on superadmini käes ja üksiku lehe tee on
ohutu — aga **B peab olema tehtud enne, kui trükise Gemini-tulemusi teosekaupa `apply`-takse.**

## Riskid ja teadaolev võlg

- **Prompt on kahes kohas.** `server/ocr_prompts.py` ja LOSSi
  `qwen3.5/scripts/prompt.py` kannavad ühte lepingut. LOSSi juhise muutmine lahutaks teed
  vaikselt. Leevendus: `ocr_prompts.py` päises viide LOSSi failile ja kopeerimise kuupäev.
  Automaatset valvurit ei ole — LOSS ei ole VUTT-i jaoks runtime'is loetav ja ADR 0023
  põhimõte on, et MCP/väline pool ei impordi `server`-it. **Teadlikult aktsepteeritud võlg.**
- **Kvaliteet on mõõtmata** kuni võrdlusjooksuni (vt eelmine peatükk).
- **Kulu ei ole piiratud ja limiit ei piira seda ka.** Superadmin võib käivitada terve
  teose hulgitöö; Tier 2 (1000–1500 RPM) ei jõua vahele. Token-arvud lähevad logisse, aga
  eelarvelage ei ole. Teadlik valik (vt „Kulu nähtavus") — aga selle valiku hind kasvab
  koos paralleelsusega, sest ainus tegelik pidur on praegu järjestikuse töö aeglus.
- **Mudelinimed vananevad kiiresti.** `gemini-3.7-flash` on vaikimisi väärtus, mitte
  kõva sõltuvus — `GEMINI_OCR_MODEL` võimaldab vahetada ilma deploy'ta koodimuudatust.
  **Aga mudeli vahetus muudab ka parameetrite lepingut:** `thinking_level` on 3.x asi ja
  `temperature` on seal deprecated; vanemal mudelil on vastupidi. `GEMINI_OCR_MODEL`-i
  muutmine ei ole seega puhtalt konfiguratsiooni-, vaid ülevaatust nõudev muudatus.
- **`store=false` katab Google'i-poolse säilituse, mitte töötlemise.** Skann läheb ikka
  välisesse teenusesse. Otsustatud on, et see on lubatud ka mitteavalikel teostel;
  `store=false` vähendab jälge, ei kaota seda.
- **Käsikirja juhis lahkneb LOSS-ist teadlikult** (vt „Juhis"). Käsikirja tulemusi ei tohi
  kahe pakkuja vahel võrrelda eeldusel, et sisend oli sama.
- **Vaba prompt tähendab vaba väljundit.** Juhis, mis palub märgendust, mida VUTT ei tunne,
  annab `.txt`-i, mille `renderVuttMarkup` kuvab valesti või mille `normalize_marginalia_tags`
  vaikselt ümber tõstab. Kaitse on ainult inimene `apply` juures. Kui see osutub liiga
  õhukeseks, on järgmine samm juhise valideerimine lubatud tägide vastu — **mitte** speki
  praeguses ulatuses.
- **Teosepõhine juhis ei ole gitis.** `state/ocr_prompts.json` kaob koos `state/`-iga
  (varundus on eraldi, #131). Püsiv jälg on `reocr_log.json`-i hash, mis ütleb *kas* juhis
  oli sama, aga ei taasta selle sisu. Hea juhise õige lõppkoht on commit
  `server/ocr_prompts.py`-sse.
- **`GEMINI_MAX_INFLIGHT_REQUESTS` on protsessi-lokaalne.** Mitme workeriga (gunicorn) ei ole
  see enam õige piir. Sama nõrkus mis `RENDER_SEMAPHORE`-il; kui backend workereid saab,
  vajavad mõlemad protsessideülest lukku.

## Mida see spekk ei tee

- Ei muuda `reocr_apply.py`-d, `save_with_git`-i, Meili sünki ega ühtki rida `.ocr` faili
  rakendamisest allpool.
- Ei muuda LOSS-teed — ei prompti, ei SFTP-d, ei OCR-serveri skripti.
- Ei paranda LOSSi batch-tee orb-`.ocr` akent (nimetatud, mitte parandatud).
- Ei lisa pakkujavalikut upload'i viisardisse. Upload läheb endiselt ainult LOSSi.
- Ei tee kvoote, eelarvelagesid ega pakkuja-kaupa statistikat Review-vaates.
- Ei valideeri juhise sisu ega kontrolli väljundit lubatud tägide vastu.
- Ei tee näidete raamatukogu ega jaga näiteid teoste vahel — näited tulevad ainult sama
  teose enda lehtedelt.
- Ei anna `contributor`/`editor`/`admin` rollile Gemini-teed ega juhise redigeerimist.
- Ei tee töösisest paralleelsust — see on nimetatud järelsammuna, mitte selle speki osana.
