# Agendi eksemplari-ettepanekud (#703, etapp 1) — kavand

**Seis:** kavand, kinnitamata (2026-11-01). Issue [#703](https://github.com/meelisf/VUTT/issues/703).
Alus: ADR 0076 §7 (eksemplari ettepanek), ADR 0058 (MCP esitab ainult ootel ettepaneku, sh
täiendused 2026-09-28/29, 2026-10-20, 2026-10-29), [#696 arutelufail](2026-10-19-eksemplari-kiht-ja-paber-arutelu.md).

## Miks

Eksemplari kiht (#710, #713) ja konvoluut (#702) on tootmises, aga andmed on peamiselt
migratsioonist tulnud üksikud viited. Andmeid on palju ja need on peenekoelised: ESTERi
eksemplari märkused, põhiteos ja kaasköited, defektsus, provenients. Hoolikas inimene ei
suuda neid järjekindlalt sisestada. Agent loeb ESTERi kirje, esitab ootel ettepaneku ja
superadmin kinnitab selle teose juures.

Usaldus agendi vastu tekib ainult kogemusest. Seepärast ehitatakse töövoog valmis, kasutaja
proovib seda tootmises (nähtav ainult superadminile) ja konarused silutakse pärast. Mõõdupuud
„kindlast reast" ette ei määrata.

## Eesmärgid

1. Agent saab MCP-st teose olemasolevad eksemplarid (koos püsiva `id`-ga) ja hoidjate registri.
2. Agent esitab agendikoodiga ootel ettepaneku: read on kas **uus eksemplar** või
   **olemasoleva eksemplari väljade muudatus**. Konvoluut on eksemplari väli ja tuleb samas reas.
3. Iga rida lähtub **ühest konkreetsest allikaolukorrast** ja kannab allikaviidet koos tsitaadiga.
4. `/review` lame loend näitab teost liigiga „Eksemplarid"; klikk viib teose halduse vahekaardile
   „Eksemplarid", kus superadmin kinnitab või lükkab read tagasi — ükshaaval või valitud read ühe
   partiina (üks commit).
5. Kinnitus käib AINULT `work_exemplars` funktsioonide kaudu (sama tee mis käsitsi muutmisel).
6. Valmis-kriteerium: `xzy2ee` kohta tekib ettepanek (R Est.B-954 konvoluudi märge põhiteosena;
   uus eksemplar R Est.B-954 (I) defektsusega), superadmin kinnitab selle ja andmed on
   eksemplaride sektsioonis ning infopaneeli „Samas köites" plokis.

## Mitte-eesmärgid (selles etapis)

- **Seos teise teosega** (`isVersionOf`, #701) — tuleb hiljem eraldi reatüübina samale kaardile,
  kui eksemplaride tee on läbi proovitud.
- **Poolitusvihje** (`split_hint`) — ei tehta. Poolituse otsustab admin (#705).
- **`ester_id` kirjutamine teosele.** Agent võib ESTERi kirje ise leida ja kasutab seda allikana,
  aga teose `ester_id` välja ta ei muuda.
- **Süstemaatiline korpuse läbikäik** (töönimekiri, `ester_id` filtreeritavaks, „kas teosel on
  ettepanek" päring). Eeldab, et teostel on ESTERi seos — see on omaette katse (vt Järjekord).
- **Automaatne „kinnita kõik kindlad read".** Kriteerium tuleb kasutamisest.
- **Seansipõhine ülevaade** `/review`-l. Kasutaja laseb agendil teha korraga ühte tüüpi tööd;
  lame loend piisab.
- **Teistele rollidele avamine.** Kõik on `require_role("superadmin")`.

## Anti-eesmärgid (rike, isegi kui tehniliselt töötab)

- Ettepanek kirjutab midagi enne kinnitust (eksemplari, `needs_review`-d, indeksit).
- Kinnitus möödub `can_write_work`-ist, `metadata_lock`-ist või tekstitunnistaja reeglist.
- Rida, mille alus on vahepeal muutunud, kirjutab üle toimetaja hilisema paranduse.
- Rida segab mitut allikat nii, et toimetaja ei näe, kust väärtus tuli.
- Tagasilükatud teos pakutakse uuesti, sest töödeldus kadus.
- Agent määrab `text_witness`-i, `pages`-i või `needs_review`-d.

## Järjekord (kokku lepitud 2026-11-01)

1. **See kavand:** eksemplari-ettepanekud; teosed annab agendile ette kasutaja.
2. **ESTERi seose katse** (eraldi issue): VUTT-i teose sidumine ESTERi kirjega automaatselt
   (pealkiri, aasta, trükkal, lehtede arv), raport tabamustest ja kahtlastest; arvestada juhtumit,
   kus ühele teosele vastab mitu ESTERi kirjet (`xzy2ee`).
3. **Süstemaatiline läbikäik**, kui seos on olemas.

## Otsustatud lahendus

### Agendikood

Uus liik `exemplars` `agent_handoff.KINDS`-is (ADR 0058 täiendus 2026-10-29: uus liik = uus `kind`
+ piir `issue_agent_handoff`-is, uut koodihoidlat ei tehta). Ulatus „kõik teosed", lagi 20 esitust,
TTL 8 h nagu teistel. Kulutus ja ettepaneku INSERT ühes tehingus `ATTACH`-iga, **WAL keelatud**.

### Hoidla

`state/exemplar_proposals.sqlite3` (ADR 0076 §7), moodul `server/exemplar_proposals.py`
`work_part_proposals.py` eeskujul. Ettepanek = üks esitus ühe teose kohta; tal on read.
Rea olek: `pending` | `accepted` | `rejected` | `stale` (stale arvutab server loetelul, ei salvesta).
Ettepanek aegub nagu teised (7 päeva) — aga **töödeldud märge** (teosel on olnud kinnitatud või
tagasi lükatud ridu) peab säilima kauem, sest hiljem tulev läbikäik toetub sellele. Selles
etapis piisab, kui otsustatud ridu ei kustutata aegumisel (vt Ehitaja otsustada).

### Ettepaneku rida

```jsonc
// uus eksemplar
{ "op": "create",
  "fields": { "holder": "TÜR", "shelfmark": "R Est.B-954 (I)", "condition": "defektne, lk 1–8 puudu",
              "convolute": { "reference": "R Est.B-954 (I)", "position": 0, "total": 4 } },
  "source": { "kind": "ester", "ref": "b2648642", "quote": "R Est.B-954 (I): defektne …" } }

// olemasoleva muudatus
{ "op": "update", "exemplar_id": "a1b2c3",
  "fields": { "convolute": { "reference": "R Est.B-954", "position": 0, "total": 2 } },
  "base":   { "convolute": null },          // muudetavate väljade väärtus esitamise hetkel
  "source": { "kind": "ester", "ref": "b2648642", "quote": "konvoluut, koos 1 trükisega" } }
```

- Lubatud väljad = `work_exemplars.EDITABLE_FIELDS` (`holder`, `shelfmark`, `url`, `condition`,
  `binding`, `provenance`, `notes`, `convolute`). `text_witness`, `pages`, `needs_review`, `id`,
  `source` välja hulgas → `invalid_field`. Väärtused valideeritakse esitusel samade puhastajatega
  (`normalize_exemplar`, `clean_convolute`) — vigane rida lükatakse tagasi enne salvestamist,
  viga nimetab rea ja välja (`rows[i].fields.convolute.position`).
- **`base` on kohustuslik `update`-real** ja katab täpselt `fields` võtmed. Kinnitusel peab
  eksemplar `id`-ga olemas olema ja iga `base` väli peab elava väärtusega kattuma, muidu on rida
  `stale` (ADR 0076 §7: konflikt rea tasemel, mitte loendi räsiga). Teisi ridu see ei blokeeri.
- **Allikas.** `source.kind ∈ {"ester"}` selles etapis; `ref` = ESTERi kirje number
  (server kontrollib kuju), `quote` = lõik ESTERi kirjest sõnasõnalt, ≤ 500 märki.
  Toimetaja kontrollib väidet lingi kaudu (`https://www.ester.ee/record=<ref>*est`, URL-i koostab
  klient `ref`-ist, agent URL-i ei anna). Üks rida = üks allikas. Teised allikaliigid (nt muu
  konvoluudiallikas) lisatakse siis, kui esimene konkreetne juhtum tuleb; igaüks lähtub ühest
  konkreetsest olukorrast.
- Uus eksemplar **saab hoidja ainult registrist** (`archives.json` võti). Tundmatu hoidjaga rida
  võetakse vastu, aga ülevaatusel on ta blokeeritud märkega „hoidja puudub registris"; superadmin
  lisab hoidja olemasoleva vooga (#713) ja kinnitab siis. Agent ei loo hoidjat.
- **Topelt-eksemplar.** Migratsioon lõi igast vanast arhiiviviitest eksemplari, nii et suur osa
  ESTERi leidumusest on teosel juba olemas. Agent peab sellisel juhul esitama `update`-rea, mitte
  `create`-rea. Server kaitseb: `create`-rida, mille hoidja ja kohaviit (tühikud ja tähesuurus
  ühtlustatud) kattuvad olemasoleva eksemplariga, saab ülevaatusel oleku `duplicate` ja on
  blokeeritud. *(Kavandaja otsus.)*
- **Piiratud teos jääb selles etapis välja.** MCP loeb eksemplare avalikust otspunktist, mis annab
  piiratud teose kohta 403. Agent ei saa `base`-i, seega ettepanekut ei tehta. Kui vaja, lisatakse
  hiljem koodiga lugemine nagu lehe tekstil. *(Kavandaja otsus.)*
- ESTERi kirje numbri kuju: `^b\d{7,8}$`. *(Kavandaja otsus.)*
- Lagi: ≤ 30 rida ettepaneku kohta.

### Kinnitus

- Ülevaatus = **Kinnita** või **Lükka tagasi** (ADR 0058 täiendus 2026-09-29: paranduste
  mehhanismi ei ole). Toimetaja parandab pärast kinnitust tavalises eksemplari vormis.
- Kinnitus kutsub `work_exemplars` funktsioone (`create_exemplar` / `update_exemplar` või nende
  ühisosa; praegu teeb kumbki oma commiti, partii jaoks tuleb mutatsioon eraldada, et mitu rida
  läheks ühte `bulk_update_works` kirjutusse), mitte otse `_metadata.json`-i. **Partii** (valitud read) = üks `bulk_update_works`
  kirjutus = üks commit; atomaarne: üks vigane rida → midagi ei kirjutata, read jäävad ootele
  (nagu `work_part_proposals.decide_many`). Klient saadab need read, mida kasutaja nägi.
- Kinnitatud kirje `source` = `{kind: "ester", ref, at: <kinnituse kuupäev>}` — **nii uuel kui
  muudetud eksemplaril** (kasutaja otsus 2026-11-01). Muudatusrida asendab varasema allika (nt
  `migration`): kirje on nüüd ESTERiga kontrollitud; vana migratsiooniviide on tuletatav hoidjast
  ja kohaviidast. `quote` jääb ettepanekute hoidlasse (ajalugu), ESTERi number läheb ka
  commit-sõnumisse. Väljade kaupa allikat ei tehta, eksemplari skeemi ei laiendata.
- Uuest eksemplarist loodud kirje saab `needs_review` (ADR 0076 §7 ja p 2: kinnitus = toimetaja
  nõustub andmetega, mitte füüsiline vastavus kontrollitud). Muudatusrida `needs_review`-d ei muuda.
- Git autor = kinnitaja; commit-sõnum nimetab, et tegu on agendi ettepanekuga.
- Tagasilükkamine ei muuda teost.

### Otspunktid (superadmin)

Konventsioon nagu teose osadel:
- `POST /works/exemplar-proposals/submit` — MCP, autentimata, ainult kehtiva koodiga.
- `GET  /works/{id}/exemplar-proposals` — ootel ja otsustatud read koos serveri arvutatud
  `review_state`-iga (`pending` / `stale` / `blocked_holder` / `duplicate` / `accepted` / `rejected`) ja
  elava väärtusega, millega kõrvutada.
- `POST /works/{id}/exemplar-proposals/decide` — `{picks: [{proposal_id, index}], action}`.
- `agent_proposals.list_agent_proposals` saab neljanda haru: `kind: "exemplars"`,
  `target_url: /work/{id}/manage?tab=exemplars`, `stale` = aegunud ridade arv. Nähtavus: nagu
  osadel (koodi loonud kasutaja) — vt Ehitaja otsustada.

### Kasutajaliides

- **`/review`:** olemasolev lame loend, uus liigi silt „Eksemplarid". Muud muudatust ei ole.
- **Teose haldus › „Eksemplarid"** (uus vahekaart, nähtav superadminile, kui teosel on ettepanek;
  vt Ehitaja otsustada, kas ka muidu). Tabel, rida ettepaneku rea kohta: linnuke · liik (uus /
  muudatus + millise eksemplari kohta) · **praegu** · **ettepanek** (muutunud väljad esile tõstetud)
  · **allikas** (ESTERi kirje link + tsitaat) · Kinnita / Lükka tagasi. Kohal nupp „Kinnita valitud
  (N)". Aegunud ja blokeeritud read on märgitud ega ole valitavad. Makett:
  `.superpowers/brainstorm/…/eksemplari-ettepanek-asukoht.html` (variant B).
- Pärast kinnitust värskeneb eksemplaride loend ja infopaneel (`convolute_count` → „Samas köites").

### MCP

- `get_work_exemplars(work_id)` — loeb avalikku `GET /works/{id}/exemplars` (eksemplarid koos
  `id`-ga, konvoluudid). Väljund tekstina.
- `list_holders()` või hoidjad `get_work_exemplars` väljundis — avalik `GET /config/archives`.
- `submit_exemplar_proposal(handoff_code, work_id, rows, note)` — `structured_output=False`,
  vead `VuttError` (`ToolError` alamtüüp), FastAPI `detail` antakse agendile edasi.
- **Juhis** (tööriista docstring + serveri `instructions`): loe ESTERi kirjet oma veebivahendiga
  (MCP ESTERit ei puuduta); üks rida = üks allikaolukord; tsitaat sõnasõnalt; konvoluudi koht
  ESTERi märkusest („põhiteos" = 0, „N. kaasköide" = N); kohaviida rühmavõti on serveri asi
  (`convolute_key`), agent kirjutab viite nagu allikas; mida EI pakuta (tekstitunnistaja, lehed,
  poolitus, seosed, `ester_id`).

### ADR

ADR 0058-le täiendus (ühe lõiguna, viitega siia):
- **Tõendi liik `ester` on lubatud eksemplari-ettepanekul** — erand täiendusest 2026-09-28
  („tõend ainult VUTT-ist"). Põhjendus: ESTERi kirje on püsiv, kirje numbriga kontrollitav
  kataloog, mitte suvaline veebileht; server kontrollib numbri kuju ja klient koostab lingi.
  Muu veebiallika peale agent endiselt ettepanekut ei tee.
- Uus liik `exemplars`, hoidla, `target_url`.

ADR 0076 §7 jääb kehtima; vajadusel täpsustus `base` välja ja hoidja blokeeringu kohta.

## Ehitaja otsustada

- Kas otsustatud ridade säilitamine (töödeldud märge) käib ettepanekute tabelis (aegumine kustutab
  ainult ootel read) või eraldi kergemas tabelis.
- Kas „Eksemplarid" vahekaart on nähtav ka ilma ettepanekuta (näiteks ainult loendina) — vaikimisi
  ainult siis, kui ettepanek on.
- Nähtavus `/review`-l: koodi loonud kasutaja (nagu osad) vs kõik superadminid (nagu tekst).
  Vaikimisi nagu osad.
- Mitu ettepanekut samale teosele: kuvada koos ühe tabelina (vaikimisi) või ettepaneku kaupa.
- Tõlkevõtmed (et + en korraga, ADR 0011), komponentide jaotus, testid
  (`can_write_work`, lukk, stale, partii atomaarsus, keelatud väljad, WAL-kontroll).
