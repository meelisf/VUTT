# Teose osad: kirjad, luuletused, kõned, istungid ja lisad (#464)

**Kuupäev:** 2026-09-26 · **Issue:** #464 · **Seotud:** #461 (seoste vaade, ADR 0056),
#465 (toimumiskoht), #462/#471 (registrid, teise agendi töö: tõendi väljanimed on
kooskõlastatud plaanis `2026-09-26-prosopo-ametite-hariduse-rikastus.md` §10)

## Probleem

Teos on füüsiline üksus (trükis, köide). Selle sees võib olla kümneid iseseisvaid tekste:
kirjad kirjakogus (`o17ekb`, Fischeri kirjad, 512 lk), luuletused gratulatsioonitrükises,
senatiprotokolli istungid. Neil pole oma kirjet, seega:

- **Adressaati ei saa märkida.** Rolli `addressee` pole.
- **Link ei vii õige teksti juurde.** 100-leheküljelises teoses on luuletust raske leida.
- **Seosed on hägused.** Kaasgratulant = „samas teoses", mitte „luuletus X-ile". Kirjakogus
  oleks iga kirjutaja seotud iga teisega.
- **Koha ja aja kohta puudub usaldusväärne andmestik.** Kirja kirjutamiskoht ja istungi
  toimumiskoht on täpselt see, mida trükikoht ei tõenda (#461).

## Korpus (tootmine, 2026-09-26)

Žanr „kiri" 30 teost, gratulatsioonitrükiseid (≥ 3 gratulanti) 32, panegüürikat 73,
õnnitlusi 85. Lisaks käsikirjalised protokollid.

## Otsused arutelust

1. **Osa** on teose sees olev iseseisev üksus: liik, lehed, aeg, koht, isikud rollidega.
2. **Lehed on hulk, mitte vahemik**, ja need viidatakse **lehefaili tüve järgi**, mitte
   numbri järgi. Osa võib olla katkendlik: Fischeri kirja sees võib olla vahelehti, mis
   kirja ei kuulu. Leht võib kuuluda mitmesse osasse, sest üks kiri lõpeb ja järgmine
   algab samal lehel.
3. **Vahelehed ja lisad on eraldi osad** liigiga `attachment` ja viitega osale, mille
   juurde need kuuluvad (`attached_to`). Näide: tunnistajate leht → istung.
4. **Liigid (v1):** `letter`, `poem`, `speech`, `session`, `attachment`. Osad on lamedad:
   istungi sees päevakorrapunkte eraldi ei ole.
5. **Rollid (v1):** olemasolevad `auctor`, `praeses` ja `subject`; uued ainult **`addressee`**
   ja **`participant`**. **Mainitud isikud** tulevad lehekülje märksõnadest (olemas).
   Mainimine saab osa viite lehe kuuluvuse järgi.
6. **Salvestus:** `_metadata.json` väli `parts` (ADR 0031 autoriteet, git, ADR 0012 no-op).
7. **Kasutajaliides:** teose halduses on **„Osad" esimene ja vaikimisi aktiivne
   vahekaart**. Lehtede haldus (poolitus, järjestus) on teisejärguline, sest põhitöö
   tehakse juba sisestamisel.
8. **Seoste liigid ei laiene** (kolm värviga tugevat liiki, spekk #461 „Palett"):
   - saatja → adressaat kuulub liiki `dedicated` („Teos isikule"), suunatud;
   - istungi osalejad omavahel ja eesistuja → osaleja kuuluvad liiki `academic`
     („Akadeemiline akt"): istung tõendab kohalolekut.

## 1. Andmemudel

```jsonc
// _metadata.json
"parts": [
  {
    "id": "p7f3kq",                       // nanoid, teose piires unikaalne, püsiv
    "kind": "letter",                     // letter | poem | speech | session | attachment
    "title": "Spener Fischerile",         // valikuline
    "incipit": "Cum et pro felicissimo…", // valikuline, allika algus
    "pages": ["…-006", "…-007", "…-011"], // lehefailide tüved; järjekord kuvamisel teose järgi
    "dating": { "start": "1684-01-02", "calendar": "julian" },  // ADR 0037 kuju, valikuline
    "place": { "id": "Q1794", "label": "Frankfurt" },     // letter: kirjutamiskoht; session/speech: toimumiskoht
    "place_to": { "id": "Q…", "label": "Sulzbach" },      // ainult letter: sihtkoht
    "creators": [                                          // LinkedEntity nagu teose creators
      { "id": "vutt:P…", "name": "Philipp Jakob Spener", "role": "auctor" },
      { "id": "vutt:Pu837uz", "name": "Johann Fischer", "role": "addressee" }
    ],
    "attached_to": null,                  // ainult attachment: teise osa id
    "languages": ["deu"],                 // valikuline
    "notes": "",
    "needs_review": false                 // server seab, kui lehetoiming jättis osa tühjaks
  }
]
```

**Valideerimine** (server, iga kirjutuse juures):
- `id` on unikaalne ja `kind` kuulub lubatud loendisse;
- iga `pages` tüvi on teoses olemas;
- `attached_to` viitab olemasolevale osale, mis ise ei ole `attachment`, ega viita iseendale;
- `creators[].role` kuulub loendisse `auctor | addressee | praeses | participant | subject`;
- `place_to` on lubatud ainult liigil `letter`;
- `dating` läbib sama kontrolli mis teose `dating` (ADR 0037).
- Tühi `pages` on lubatud ainult juhul, kui `needs_review` on tõene. Kasutaja loodud osa
  peab sisaldama vähemalt ühte lehte.

## 2. Kirjutustee

Osi muudetakse **eraldi otspunktidega**, mitte kogu `parts` massiivi saatmisega. Nii ei
kirjuta kaks samaaegset toimetajat teineteise osi üle:

- `POST /works/{work_id}/parts` loob osa (keha: osa ilma `id`-ta) → `201 {part}`
- `PUT /works/{work_id}/parts/{part_id}` asendab osa
- `DELETE /works/{work_id}/parts/{part_id}`: kui teised osad viitavad sellele
  `attached_to`-ga, siis 409
- `POST /works/{work_id}/parts/{part_id}/pages` keha `{add: [...], remove: [...]}`
  (ruudustiku toiming)

Kõik teevad lugemise, muutmise ja kirjutamise **`metadata_lock`-i all**
`save_work_metadata` kaudu (transform-kuju nagu `bulk_update_works`). Git-commit
kirjeldab muudatust („Osa: lisa kiri Spener → Fischer [p7f3kq]"). Õigused:
`can_write_work` (ADR 0031). `parts` lisatakse `ALLOWED_METADATA_FIELDS`-i, aga
üldine metaandmete salvestus **ei tohi** osi üle kirjutada. Kui kliendi keha sisaldab
`parts`-i, lükatakse see tagasi (400) ning osad muutuvad ainult ülaltoodud
otspunktidega. Osa salvestus kutsub `refresh_work_mentions`-it, sest mainimiste osa
viited sõltuvad osade lehtedest.

## 3. Lehetoimingud (üks koht)

Uus `sync_work_parts(work_dir, work_id, renamed: dict[str, list[str]] | None = None)`
kutsutakse **`refresh_work_mentions`-i sees**, enne mainimiste arvutamist, sest mainimiste
osa viited sõltuvad osade lehtedest. `refresh_work_mentions` saab valikulise argumendi
`renamed`, mille ta annab edasi.

Sellest tuleneb, et iga praegune ja tulevane lehe numbreid või faile muutev tee sünkroniseerib
osad automaatselt. Kutsekohti on praegu üheksa:
- `admin_page_ops`: poolitus, `apply_page_ops`, lisamine ja **hulgikustutus `delete_pages`** (kasutajaliidese kustutustee; kutsus varem mainimiste uuendust otse ja jättis osad vahele);
- `routers/pages.py`: kustutus, lisamine ja **ümberjärjestamine** (`/reorder-pages`, kus
  kutse on ruuteris);
- `trash_ops`: kaks taastet.

Eraldi kutset ei saa seega unustada. Valvur (ADR 0055 muster) kontrollib, et
ümberjärjestamine, poolitus ja kustutus värskendavad osa `first_page`-i.

- **Poolitus** annab `renamed = {algne_tüvi: [vasak, parem]}`. Algne tüvi asendatakse igas
  osas mõlema poolega.
- **Puuduv tüvi** (kustutatud leht) eemaldatakse osast.
- **Tühjaks jäänud osa:** `pages: []`, `needs_review: true`. Osa ei kustutata.
- **Prügikastist taastatud leht** ei lähe osasse automaatselt tagasi. See on teadlik
  piirang: taaste on harv ja toimetaja lisab lehe ruudustikus uuesti.
- **Ümberjärjestamine** tüvesid ei muuda, kuid lehtede numbrid muutuvad.
  `sync_work_parts` kutsub seepärast alati `update_work_facts`-i, et osade `first_page`
  vastaks uuele järjekorrale (§ 4).

## 4. Indeksid ja seosed

**`person_to_works`:** osa isikud lisanduvad kirjetena `{"work_id", "role", "part_id"}`.
Kirjutab sama `update_person_to_works` (metaandmete tee), mis loeb ka `parts[].creators`-it.
Mainimise kirjed (`role: "mentioned"`) saavad lisaks `part_ids`: osad, kuhu mainimise
lehed kuuluvad. Need arvutab `collect_page_person_mentions` metaandmete `parts` põhjal.
Kahe kirjutaja reegel (CLAUDE.md) kehtib edasi.

**Teadaolev piirang: jagatud leht.** Kui lehel `…-006` lõpeb kiri A ja algab kiri B,
kuulub mainimine sellel lehel mõlemasse osasse ja seotakse mõlema kirja isikutega.
Lehetasemel märgendus ei saa seda eristada. Toimetajale tehakse see nähtavaks:
- ruudustikus on jagatud lehel mõlema osa märk;
- osa vormis on hoiatus „Leht …-006 kuulub ka osasse B; sellel lehel mainitud isikud
  seotakse mõlemaga".
Täpsem lahendus (mainimine teksti positsiooni järgi) jääb v1-st välja.

**Teose faktid (`_work_facts_entry`, ADR 0007):** kirjel on lisaks `parts:
{part_id: {kind, title, year, place (id, label), first_page}}`. `first_page` on
1-põhine leheküljenumber (positsioon `enumerate_page_images` järjekorras). See
arvutatakse **kirjutamisel**, mitte päringu ajal, et `/network` ei peaks kausta
skannima. Rebuild ja uuendus kasutavad sama ehitajat, mis saab teose kausta tee.
`sync_work_parts` kutsub pärast lehetoimingut `update_work_facts`-i, sest numbrid
nihkuvad.

**Seoste ehitaja (ADR 0056 laiendus):**
- **Paarid tehakse osa ulatuses.** Kui kummagi isiku roll tuleb osast, tekib serv ainult
  sama osa isikutega. Teose tasandi rollid (teose `creators`) paarituvad teose tasandi
  rollidega. Mainimine paarub nende osade isikutega, kuhu mainimise lehed kuuluvad; kui
  leht osasse ei kuulu, paarub see teose tasandi rollidega. Nii ei muutu kirjakogu
  150 kirjutajat üksteise „kaastekstiks".
- **Serv** kannab `evidence.part_id`. `year` võetakse osa dateeringust (tagavarana teose
  aastast). `place` on osa koht: `kind` on `sent_from` liigi `letter` korral ja `event`
  liikide `session` ja `speech` korral; tagavara on trükikoht (`print`).
- **Reeglitabel** (`network_rules.py`) täieneb nii:
  - `auctor` → `addressee` = `dedicated`, suunatud;
  - `participant` ↔ `participant` = `academic`, suunata;
  - `praeses` → `participant` = `academic`, suunatud;
  - `addressee` ja `participant` lisatakse `KNOWN`-i.
- **Vastus** saab välja `parts: [{work_id, part_id, kind, title, year, first_page}]`.
  Hüpikaken ja loend näitavad osa („Kiri: Spener → Fischer, 1684") ja link viib osa
  esimesele lehele (`first_page` teose faktidest).

**Isikuleht:** teoste loendis on osaga seotud kirje all osa read, näiteks „kiri
Spenerilt, 1684, lk 7–9, 11", ja link viib esimesele lehele.

## 5. Kasutajaliides (teose haldus)

- **Vahekaart „Osad"** on esimene ja vaikimisi aktiivne; „Lehed", „Asendus" ja
  „Prügikast" järgnevad.
- **Ruudustik:** olemasolev lehtede ruudustik ja valik (klikk, Shift-vahemik). Iga
  lehe küljes on selle osade märgid (liigi ikoon ja järjekorranumber sisukorras).
- **Toiminguriba:** „Loo osa valitud lehtedest", „Lisa valitud lehed osale …" ja
  „Eemalda valitud lehed osast …".
- **Sisukord:** osade loend teose järjekorras (esimese lehe järgi) koos liigi, pealkirja,
  aja ja isikutega; `needs_review` osad on esile tõstetud. Klikk osal tõstab ruudustikus
  esile selle lehed ja avab vormi.
- **Vorm:** liik, pealkiri, algus, aeg (sama sisend mis teose dateeringul), koht ja
  sihtkoht (kohtade registrist), isikud rolliga (`EntityPicker`), liigi `attachment`
  korral „lisa osale …". Salvestamata muudatuste kaitse: `useUnsavedChangesGuard`.
- **Leht avaneb töölaual** (`/work/{id}/{nr}`) klikiga pisipildil (uues vahekaardis, et
  töö teose halduses ei katkeks).
- **i18n:** kõik võtmed et ja en korraga.

## 6. CMIF-eksport (PR 4)

`GET /cmif.xml` on avalik ja sisaldab ainult avalike teoste (`is_work_public`) liigi
`letter` osi. CMIF 1.0 (`correspDesc`) iga kirja kohta:
- `correspAction type="sent"` + `persName` (`ref` = GND / VIAF / Wikidata isiku
  identifikaatoritest) + `placeName` (`ref` = Wikidata / GeoNames) + `date`;
- `correspAction type="received"` + adressaat + `place_to`;
- `@source` viitab VUTT-i teose URL-ile (osa esimene leht).

- **Eksporditakse ainult `kind == "letter"`.** Lisad (`attachment`), vahelehed, luuletused,
  kõned ja istungid eraldi CMIF-kirjeid ei saa. Kirjaga seotud lisa võib põhikirje juures
  olla viitena (`note` / `ref`); täpne kuju pannakse paika PR 4 plaanis.
- **Lünklikud kirjed:**
  - isik või koht ilma välise ID-ta kantakse nimena ilma `ref`-ita;
  - teadmata või anonüümne saatja ja pseudonüüm kantakse allika kujul (või „[teadmata]")
    ilma `ref`-ita;
  - kiri ilma adressaadita (nt avalik kiri) saab ainult `correspAction type="sent"`, kui
    CMIF seda lubab, muidu tähise „[teadmata]";
  - puuduv kuupäev jääb `date` elemendist välja.

  Täpne kuju kontrollitakse CMIF 1.0 juhendi vastu PR 4 plaanis. **Eksporditakse ainult
  seda, mis andmetes on**: VUTT ei täida lünki oletustega.
- XML-kuju ja correspSearchi registreerimine on PR 4 plaanis.

## Väljaspool skoopi (v1)

- Osade automaatne leidmine (agendi ettepanekud), pesastatud osad (päevakorrapunktid),
  osad töölaua ruudustikus (ainult vaatamiseks, hiljem), Meili otsing osade kaupa.
- #465 toimumiskoht teose tasandil (disputatsioonid). Osa `place` katab kirjad,
  istungid ja kõned.

## Testimine

- **Valideerimine:** iga reegel; lehe kuulumine mitmesse osasse; katkendlik osa;
  `attached_to` tsükkel ja viide lisale.
- **Kirjutustee:** samaaegsed osa-muudatused ei kirjuta teineteist üle (lukk);
  `parts` üldises metaandmete salvestuses → 400; õigused (`can_write_work`); git-commit.
- **Lehetoimingud:** poolitus asendab tüve mõlema poolega; kustutus eemaldab; tühi osa
  saab `needs_review`; `refresh_work_mentions` kutsub `sync_work_parts`-i. Valvur
  kontrollib, et **ümberjärjestamise** (`/reorder-pages`), poolituse ja kustutuse järel
  vastab osa `first_page` uuele järjekorrale.
- **Jagatud leht:** mainimine jagatud lehel saab mõlema osa `part_ids`-i; osa vorm
  näitab hoiatust.
- **Indeksid:** osa isikud `person_to_works`-is koos `part_id`-ga; mainimise
  `part_ids`; rebuild ja uuendus annavad sama teose faktide kirje (ADR 0007).
- **Seosed:** kirjakogus ei teki eri kirjade kirjutajate vahel servi; saatja →
  adressaat = `dedicated`; istungi osalejad = `academic`; `evidence.part_id`; osa aasta
  ja koht; sümmeetria (ADR 0056).
- **UI:** „Osad" on vaikimisi vahekaart; loomine valikust; lehe lisamine ja
  eemaldamine; sisukord; `needs_review` märk.
- **Päris näited:** `o17ekb` (kiri koos vahelehtedega), üks gratulatsioonitrükis ja
  üks protokoll.

## Tükeldus PR-ideks

1. **Mudel ja kirjutustee:** valideerimine, osade otspunktid, `sync_work_parts`
   lehetoimingutes, üldises salvestuses `parts` → 400.
2. **UI:** „Osad" vahekaart (esimene ja vaikimisi), ruudustiku märgid, sisukord, vorm.
3. **Indeksid, seosed ja isikuleht:** `person_to_works` `part_id`, teose faktide
   `parts`, ehitaja osa ulatus, reeglid, isikulehe osad.
4. **CMIF-eksport.**
