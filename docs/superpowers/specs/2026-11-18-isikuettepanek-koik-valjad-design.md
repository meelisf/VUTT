# Isikuettepanek kõigile sisuväljadele (#834) — disain

Kuupäev: 2026-11-18. Staatus: kinnitamisel. Seotud: ADR 0058 (+ täiendused), 0039, 0048,
0059, 0078, 0084; #833 (vene keel ainult viide), #835 (täiend inglise vaates).

## Miks

Agent tuvastab isiku allikast (kontrollnäide: Johannes Horn `vutt:Pjjivpy`, Levitski I lk 106),
aga `submit_person_enrichment_proposal` võtab vastu ainult ameti- ja haridusridu. Sünd, surm,
päritolu ja elulugu jäävad tühjaks või tuleb kasutajal need käsitsi vormi kanda. Eesmärk:
agent saab ettepanekuna täita sisuliselt **kõiki isikukaardi sisuvälju** ameti ja hariduse
eeskujul — toimetaja kinnitab või lükkab tagasi rea kaupa isikuvormis.

## Eesmärgid, mitte-eesmärgid, anti-eesmärgid

- **Eesmärk (1. osa):** sünd, surm, päritolu, sugu, elulugu (`biography_et`, `biography_en`)
  ning eluloo „Allikad" (`sources[]`) kirjed.
- **Eesmärk (2. osa, eraldi plaan):** nimevariandid (`aliases`, `names`), staatused,
  konfessioonid, matmine, `floruit`, isiku seosed, identifikaatorid.
- **Mitte-eesmärk:** uute kohtade loomine koharegistrisse (1. osas peab koht olemas olema);
  tõlkeankrute (`*_src`) kirjutamine; `review`, `aa_raw`, `image_url`, `source_data`;
  MCP-l kinnitamise tööriist.
- **Anti-eesmärk:** üldine „väli X = Y" kirjutus (ADR 0058 lükkas tagasi); vaikne
  ülekirjutus; vene tekst kaardil (#833); tõend, mis järgmisel vormi salvestusel kaob.

## Lähenemised (valitud: A, kahes osas)

- **A. Olemasoleva isikuettepaneku laiendus uute realiikidega** — sama kood, hoidla,
  MCP tööriist, `/review` loend ja isikuvormi paneel. Iga liik saab oma valideerimise,
  olekuarvutuse ja kaardile kandmise. Hind: `enrichment_proposals.py` (726 rida) kasvab →
  liigiloogika eraldi moodulisse. **Valitud** (kasutaja 2026-11-18).
- B. Eraldi ettepanekuliik ja hoidla (nagu lehe teksti ettepanek) — dubleeriks ülevaatuse,
  aegumise, koodikulu; toimetaja vaataks ühe isiku kohta kahte paneeli.
- C. Üldine väljaparandus — ADR 0058 lükkas tagasi: peidab registri-, koha- ja
  kuupäevavalikud, valideerimine ei ole liigipõhine.

**Tõendi koht (kasutaja: segamudel):** skalaarväljal (sünd, surm, päritolu) oma `evidence`
nagu ametil → isikulehel joonealune viide. Elulool tekstisisesed viited nagu praegu
(`vutt:Pu837uz` Fischer): VUTT-i lehe Markdown-link `([VUTT, *pealkiri*, 2](https://vutt.utlib.ut.ee/work/<id>/<lk>))`
ja lühiviide („Aarma ja Bruns 2000/2020: 827–829"), mille täiskirje on `sources[]`-is.

**Elulugu (kasutaja: asendus erinevusvaatega):** agent võib asendada ka olemasoleva teksti;
ülevaatus näitab sõnataseme erinevust; vahepeal muutunud tekst blokeerib rea.

## Andmed

### Uued realiigid (`kind`)

| kind | Väljad (lisaks `kind`, `evidence` kus nõutud) | Kaardile |
|---|---|---|
| `birth` | `date` (sama kuju mis `date_from`: `date`, `precision`, `bound`, `calendar`, `is_circa`) | `birth.date/…` + `birth.evidence` |
| `death` | `date` (nagu ülal), valikuline `place_key` | `death.date/…`, `death.place` registrikirjest, `death.evidence` |
| `origin` | `place_key` (kohustuslik) | `origin.place` (+ `place_id`/`place_labels` registrist), `origin.evidence` |
| `gender` | `value`: `"M"` \| `"F"` | `gender` (tõendit ei salvestata kaardile, aga esitusel nõutud) |
| `biography` | `lang`: `"et"` \| `"en"`, `text` (Markdown), `base_hash` (praeguse välja `text_hash`, ADR 0039 — 12 hex-märki, tühik normaliseeritud), `sources_add` (valikuline list) | `biography_<lang>` asendatakse, `sources[]`-i lisanduvad uued kirjed |

Sünnikoht **ei ole** `birth` rea osa: ADR 0084 järgi on kanooniline koht `origin.place`
(„Päritolu" = kõige täpsem teadaolev sünni- või päritolukoht). Sünnikoha ettepanek = `origin`.

`match_status` uutel liikidel puudub (registrivaste ei ole rea olemus); server arvutab oleku.
Ühes ettepanekus on iga skalaarliiki ja iga `biography` keelt **kuni üks** rida.

### Kaardi skeemi laiendus

`birth.evidence`, `death.evidence`, `origin.evidence`: sama kuju mis ameti `evidence`
(`vutt_page` | `literature`, `citation` täidab MCP). **Invariant:** isikuvorm peab need läbi
kandma (`helpers.ts` ehitab `birth`/`death`/`origin` salvestamisel uuesti — praegu jääks
`evidence` maha, vrd `SERVERIPOOLSED_LEHE_VALJAD` õppetund). Vormis on tõend nähtav ja
eemaldatav (`EvidenceList` + `onRemove`), muutmist ei ole — nagu ametil.

`sources_add` kirje = ADR 0078 kuju: `{work_id, part_id?, page?, printed_page?, note?}` või
`{text, note?}`; `normalize_sources` valideerib. Kirjanduskogu viite `text` koostab MCP
kirjanduskogu reast (`citation`), mitte agent vabalt — sama loogika mis `literature`-tõendil.

## Valideerimine (esitusel)

- Range võtmekomplekt liigi kaupa; tundmatu võti → `invalid_item` (nimetab `items[i]`).
- `birth`/`death`/`origin`: `evidence` 1–5 (olemasolev kontroll, sh `vutt_page` olemasolu);
  `place_key` peab olema koharegistris (`unknown_place_key` — agent ütleb kasutajale, et koht
  on vaja lisada; uut kohta ettepanek ei loo).
- `gender`: `evidence` 1–5.
- `biography`: `text` 1…`MAX_BIOGRAPHY_CHARS` (40 000); Markdown, toores HTML keelatud
  (`<` + täht → `html_not_allowed`; ADR 0008 renderdab niikuinii escape'ituna, aga kaardile
  ei kirjutata seda). Vähemalt üks tekstisisene viide; iga VUTT-i link
  `…/work/<id>/<lk>` kontrollitakse nagu `vutt_page` (`unknown_work`, `page_out_of_range`).
  Lühiviite vastavust `sources[]`-ile server ei kontrolli (vabatekst) — juhis nõuab.
- **Vene keel (#833):** kirillitsa on keelatud `biography.text`-is ja kõigis kaardile
  minevates väljades; lubatud ainult viites endas (`citation`, `locator`, `sources_add[].text`).
- Mahupiirid: `MAX_BODY_BYTES` 32 000 → 128 000 (kaks pikka elulugu + allikad; Fischer
  ≈ 21 KB keele kohta). `MAX_ITEMS` jääb 20.

## Olek ülevaatusel (server arvutab, klient ei arvuta)

| Olek | Millal | Kinnitus |
|---|---|---|
| `applicable` | kaardi väli tühi | kirjutab väärtuse + tõendi |
| `already_present` | sama väärtus kaardil (kuupäev võrreldakse `date`+`precision` järgi, koht võtme järgi) | lisab ainult tõendi (duplikaatideta) |
| `conflict` | kaardil teine väärtus | **asendab**; paneel näitab „praegu → ettepanek" (vaikset ülekirjutust ei ole: otsus on toimetaja nupuvajutus) |
| `blocked` | isik puudub; `place_key` kadunud registrist; elulool `base_hash` ≠ praegune `text_hash` (`stale_biography`) | ei saa kinnitada — agent esitab uuesti |

Elulool lisaks olek `replace` (olemasolev tekst, räsi klapib) — kinnitus asendab; paneel
näitab erinevust.

## Kinnitus

Sama kolmeastmeline `apply_selected`: eelkontroll koopia peal → registrikirjed (uutel
liikidel puuduvad) → üks `update_person` (`updated_at` kontroll isikuluku all). Liigiloogika
`server/prosopography/enrichment_kinds.py`: iga liik = `validate(item)`, `review_state(item,
person)`, `apply(item, card_copy)`. `_merge_row` jääb ameti ja hariduse jaoks.

Elulugu: `biography_<lang>` asendatakse; `sources_add` lisatakse `sources[]`-i lõppu
duplikaatideta (sama `work_id`+`page` või sama `text`). Tõlkeankrut ei puudutata — teise
keele ankur muutub ise vananenuks (ADR 0039 räsi), toimetaja kinnitab vastavuse eraldi.
`gender`, `origin`, `death.place` lähevad läbi olemasoleva `normalize_person_facts`.

## MCP

- `submit_person_enrichment_proposal`: skeem ja docstring uute liikidega; MCP täidab
  `citation`-i ka `sources_add` kirjanduskogu kirjetele (`source_id` → `text`).
- `get_person_enrichment_context`: lisaks `gender`, `origin`, `biography_et`/`_en` koos
  `biography_*_hash`-iga (`text_hash`), `sources`; `MAX_ENRICHMENT_CHARS` 60 000 → 150 000.
- Juhis (`instructions.py`, ≤ 2048 märki): üks rida „isikukaardi kõik väljad käivad
  ettepanekuga" — detail docstringis: elulugu kirjuta välja keeles, lingitekst samas keeles
  (Fischeri inglise eluloos oli „pühendus"), viited tekstis nagu olemasolevates eludes.

## Kasutajaliides

- `AgentEnrichmentPanel`: rida liigi järgi — „Sünd 1755" / „Päritolu: Tartu" / „Sugu";
  `conflict` näitab praeguse ja pakutud väärtuse; elulool kokkupandav sõnataseme erinevus
  (`src/utils/textDiff.ts`, sama mis `BiographySection`) ja `sources_add` loend.
- Isikuleht (`PersonDetailPage`): sünni ja surma joonealused viited päises (kuupäevad on seal), päritolu oma `StructuredInfoCard`-is;
  viited samamoodi nagu ametil (`evidenceRef`); `evidenceWorkIds` ka nende tõenditest.
- Isikuvorm: `DateDraft`-i ja päritolu mustandisse `evidence`; `EvidenceList` välja juures.
- i18n: uued võtmed mõlemasse keelde (ADR 0011), `prosopography:agentEnrichment.*`.

## ADR

ADR 0058 täiendus „2026-11-18 (#834): kõik sisuväljad": realiigid, olekud (`conflict`
= toimetaja otsus asendada), eluloo asendus räsi vastu, tõend skalaarvälja küljes,
vene keele keeld, `sources_add`.

## Testid (vähemalt)

- Server: iga liigi valideerimine (vigane võti, puuduv tõend, tundmatu `place_key`,
  kirillitsa, HTML, VUTT-i link vales teoses/lehel); olekud `applicable`/`already_present`/
  `conflict`/`blocked`; eluloo `stale_biography`; kinnitus kirjutab väärtuse + tõendi,
  ei puuduta `*_src`; `sources_add` duplikaatideta; mitme liigi ühine kinnitus = üks commit.
- Frontend: vormi `toPersonPayload` säilitab `birth/death/origin.evidence` (valvur);
  paneeli renderdus liikide kaupa (jsdom); joonealused viited isikulehel.
- MCP: skeem, `citation` täitmine `sources_add`-ile, konteksti uued väljad, juhise pikkus.

## Ehitaja otsused (minu valikud, kontrolli)

- `gender`-i tõend nõutud esitusel, kaardile ei salvestata (kaardil pole kohta, ja ühe
  tähe joonealune viide oleks müra).
- Kuupäeva „sama väärtus" = sama `date` ja `precision`; ligikaudsus/kalender ei tee
  konflikti, need kantakse `already_present` korral üle ainult tühja kohta.
- `death.place` registrist; kui toimetaja on käsitsi Wikidata koha pannud, mis registris
  pole, on erinev koht `conflict`.
- 2. osa (identifikaatorid jt) saab eraldi disaini lõigu ja plaani pärast 1. osa
  kasutuselevõttu.
