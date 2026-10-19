# MCP lehe teksti ettepanek — disain (#641)

Kuupäev: 2026-10-19
Seotud: #641, #577, #492, #630; ADR 0010, 0012, 0054, 0058, 0060, 0061, 0070, 0071

## Miks

MCP-agent loeb lehti ja võrdleb neid pildiga, aga ei saa parandust VUTT-i tagasi
anda. 2026-10-19 jäi Tartu–Greifswaldi kontaktide töös pildi järgi kontrollitud
tekst agendi märkmesse („VUTT-i tagasikandmise ootel"), ja inimene peab selle
käsitsi redaktorisse tooma. Järgmine samm on süstemaatilised ülesanded: agent
märgendab teoses kustosed (`<catch>`) ja leheküljenumbrid (`<fw>`) kümnetel või
sadadel lehtedel.

Eesmärk: agent esitab lehe teksti muudatused **ootel ettepanekuna** (ADR 0058
muster), superadmin vaatab need üle **pildi kõrval, redaktoris** ja kinnitab kas
lehe kaupa või pistelise kontrolli järel terve paki korraga.

## Eesmärgid

1. Agent saab lugeda lehe **toorest** teksti (märgendus, reavahetused) ja esitada
   muudatused, mis ei riku lehe struktuuri.
2. Ülevaatus käib Workspace'is: pilt kõrval, ettepanek redaktoris salvestamata
   muudatusena, diff esile tõstetud. Vale koha parandab toimetaja otse redaktoris.
3. Ühe lehe otsus on üks toiming (Ctrl+S või „Lükka tagasi"), mitte rea kaupa
   kinnitamine.
4. Süstemaatilise paki saab pärast pistelist kontrolli kinnitada **korraga**.
5. Vahepealne inimparandus ei kao kunagi vaikselt.

## Mitte-eesmärgid

- Contributor'i pending-edits süsteemi taaselustamine (eemaldati 099d0ad, ADR 0031).
- Rea- või muudatusekaupa kinnita/lükka-nupud. Redaktor on parandamise tööriist.
- Paki tagasivõtmise tee UI-s. Erandjuhul `git revert` ssh kaudu, muidu lehe ajalugu.
- Lehe seisundi (Toores/Töös/…) muutmine. Seda muudab ainult inimene.
- Tabelid ega muud tägid, mida `server/vutt_tags.py` registris pole.
- Nähtavuse piiramine. Ettepanek tohib puudutada ka piiratud teost (kasutaja
  2026-10-19): töövoog on superadmini käes ja ka admin näeb kõiki teoseid. MCP
  otsinguvõti näeb juba praegu piiratud teoseid ja see on teadlik.
- #630 tägide disain. Spekk kasutab registris juba olemasolevaid tägisid.

## Anti-eesmärgid (läbikukkumine, isegi kui töötab)

- Kinnitus kirjutab üle teksti, mida inimene muutis pärast agendi lugemist.
- Diff näitab muud, kui kinnitus kirjutab (nt normaliseerimata tekst).
- Agendi ettepanek kaotab lehelt märgenduse või reavahetused, sest agent töötas
  otsinguks puhastatud tekstiga.
- Kinnitus muudab lehe seisundit, kommentaare, annotatsioone või muid JSON-välju.
- 80 lehe ülevaatus nõuab 80 × mitu klikki.

## Kitsendused (olemasolevast koodist)

- `get_pages` tagastab `lehekylje_tekst`-i: reavahetused tühikuteks, poolitused
  liidetud, märgendus eemaldatud, ß → ss. **Ettepanekut ei tohi sellele ehitada.**
  Toores tekst on kettal (`.txt`) ja Meilis `text_content`. Meili võib kettast maha
  jääda (async sünk, ADR 0013), seega loeb `get_page_source` ketast ja autoriteet on
  esitusel ketas.
- Salvestuse kanooniline kuju: `editing._normalize_page_text` (NFC +
  `normalize_marginalia_tags`). Kolmesuunaline liitmine: `page_merge.merge_page` /
  `merge_text` (ADR 0054). Lehe kirjutus käib `page_lock`-i all.
- ADR 0058 muster: koodi räsi + kasutuskorrad SQLite-s `state/` all (0644
  õigustega, #619), kood seotud **kasutajaga**, ettepanek aegub, `revoke_handoffs`
  konto kustutusel/rolli muutusel. Eeskuju: `server/work_part_proposals.py`.
- Hulgitoiming taustatööna: eeskuju `server/page_ops_jobs.py` (olek protsessi
  mälus, klient pollib, teose kohta üks töö).
- Workspace: lehepööre ei monteeri CodeMirrorit maha. Programmaatiline
  dokumendivahetus kannab `pageSwapAnnotation`-it ega ole `userEvent` (ADR 0010).
  Perioodiline dep ei tohi lehte uuesti laadida (ADR 0060). `ReocrPanel` näitab juba
  ootel kandidaatteksti, ja sellel on lähim olemasolev UI-muster.
- i18n: iga uus võti korraga et + en (ADR 0011).

## Otsustatud (kasutajaga)

1. **Ülevaatus = redaktor.** Ettepanek avaneb redaktoris salvestamata muudatusena,
   diff esile tõstetud. Õige → Ctrl+S. Üks muudatus vale → toimetaja parandab otse
   ja salvestab. Kõik vale → „Lükka tagasi". Salvestatakse **see, mis redaktoris on**.
2. **Pilt kõrval** on kohustuslik. Ülevaatuse mõte on kontroll pildi järgi.
3. **Pakk korraga:** pärast pistelist kontrolli „Kinnita kogu pakk".
4. **Agent tohib pakkuda kõike**, mida ta pildilt teisiti välja loeb: tähed,
   ortograafia, reavahetused, tägid. Piir on registris: tundmatu täg lükatakse tagasi.
5. **Agendile antakse teada, milliseid tägisid VUTT toetab**, et ta ei leiutaks
   uusi (nt tabelit).
6. **Kinnitus ei muuda lehe seisundit.**
7. **Õigus: ainult superadmin**, nii koodi andmine, loetelu kui ka otsused.
8. **Tõend:** agendi märkusest piisab. Kontroll tehakse ülevaatusel.
9. **Paki tagasivõtmine:** eraldi teed ei tehta. Üks pakk = üks commit, `git revert` ssh kaudu.

## Lahendus

### Andmevoog

```
agent: get_page_source(code, work_id, page)  ── server loeb KETTALT → {stem, text, text_hash}
agent: submit_page_text_proposal(code, work_id, pages=[{stem, text_hash, edits[], note}], note)
server: iga leht → ketta tekst (page_lock) → text_hash kontroll → edits → normaliseeri
        → struktuurikontroll → talletab {base = ketta tekst, proposed} SQLite-s; lehte EI muuda
superadmin, Workspace: ettepanek redaktoris → Ctrl+S (/save, base = ketta leht)
                       või „Kinnita kogu pakk" → taustatöö, merge iga lehe kohta, ÜKS commit
```

### MCP tööriistad (`mcp/vutt_mcp/`)

**`get_page_source(handoff_code, work_id, page)`**: lehe toores tekst, seisund,
**tüvi** (`stem`, failinimi, püsiv leheidentifikaator) ja **`text_hash`** = sha256
**täpselt tagastatud toorteksti UTF-8 baitidest** (mitte normaliseeritud tekstist:
kaks erinevat toorteksti võivad normaliseeruda samaks ja asendused rakenduvad
toortekstile), lisaks lühike tägide loend. Tekst tuleb **serveri otspunktist, mis loeb
ketta `.txt`-i** (nt `POST /works/{id}/pages/{n}/source`), mitte Meilist.
**Otspunkt nõuab üleandmiskoodi** (kehtiv, teos koodi ulatuses; lugemine kasutuskorda
ei kuluta). Ilma koodita lekiks piiratud teoste toores tekst avalikult, sest
`/api/files/` proksib kõik backend-teed (CLAUDE.md). Seega on tööriist
`get_page_source(handoff_code, work_id, page)`. Meili
`text_content` võib kettast maha jääda (ADR 0013), ja siis ei klapiks `text_hash`
kunagi. Number on ainult sisend. Edasi kannab lehte tüvi. Docstring ütleb selgelt: see on ainus tekst, mille põhjal
ettepanekut teha, `get_pages` ei kõlba.

- Tägide loend genereeritakse registrist, et see ei jääks koodist maha. MCP ei tohi
  `server`-it runtime'is importida (CLAUDE.md MCP reeglid), seega loend tuleb
  **serverist**: väike avalik otspunkt (nt `GET /markup/tags`), mis tagastab
  registri nime + lühikirjelduse + kas paaris. Teine võimalus on MCP-s koopia
  pariteeditestiga. **Ehitaja valik.**
- Kirjeldus peab katma `<m>` reegli (välimine, ilma reavahetuseta, üks füüsiline
  rida = üks plokk, ADR 0003/0009) ja lehe tähistuse tägid `fw sig catch rh`
  (ADR 0070).

**`submit_page_text_proposal(handoff_code, work_id, pages, note)`**

- `pages`: `[{stem, text_hash, edits: [{old, new}], note?: str}]`. `stem` ja
  `text_hash` tulevad `get_page_source`-ist. Number ei ole esituse võti, sest
  vahepealne ümberjärjestamine võib anda samale numbrile teise lehe ning korduv
  tekst (leheküljenumber, kustos) võib ka seal täpselt üks kord esineda.
- Server kontrollib `page_lock`-i all, et ketta teksti räsi == `text_hash`. Muidu
  `stale_page` (leht nimetatud): agent loeb lehe uuesti. Leht, mida enam ei ole →
  `unknown_page`.
- `edits` rakendatakse järjest **täpselt sellel tekstil, mida agent nägi**. `old` peab
  esinema täpselt üks kord. Muidu `old_not_found` või `old_ambiguous`, mis nimetab lehe ja edit'i
  indeksi. Agent loeb siis lehe uuesti ja annab pikema `old`-i.
- Terve lehe teksti tööriist **ei** võta. Asendused hoiavad ära selle, et agent
  kirjutab pika märgendatud lehe sõna-sõnalt ümber ja muudab midagi kogemata.
- `note` = paki selgitus (nt „kustosed lk 1–80, pildi järgi"). Lehe `note` on valikuline.
- MCP kasutab `api_post_once`-i (võrguvea järel ei korrata, ADR 0058 p 5).

### Server

**Moodul** `server/page_text_proposals.py` (+ router, nt `routers/page_text_proposals.py`).
SQLite `state/page_text_proposals.sqlite3`, skeem analoogne `work_part_proposals`-iga:

- `handoff(code_hash, scope_work_id | NULL, username, expires_at, max_uses, uses)`
- `proposal(id, work_id, username, note, created_at, expires_at)`: üks rida = üks pakk.
- `proposal_page(proposal_id, page_stem, base_text, proposed_text, note, state,
  decided_by, decided_at)`, `state ∈ pending | accepted | rejected | stale | superseded`.
  Lehe võti on **tüvi** (failinimi), mitte number. Agent annab tüve ise
  (`get_page_source`-ist), number on ainult kuvamiseks.

**Kood:**
- `POST /works/{work_id}/text-proposals/handoff` (superadmin): ühe teose kood.
- *Minu otsus:* lubada ka ulatus „kõik teosed" (`work_id` puudub), nagu prosopo
  koodil (ADR 0058 täiendus 2026-09-27). Lundi-tüüpi uurimistöö puudutab mitut teost.
- 8 h, 20 esitust. `revoke_handoffs` lisada samadesse kohtadesse kus teistel
  ettepanekumoodulitel (#619).

**Esitus** `POST /works/text-proposals/submit` (autentimata, kood on õigus;
järjekord nagu `work_part_proposals.submit`: kood → teos → sisu):

1. Teos on koodi ulatuses ja olemas. Leht on olemas. Nähtavust eraldi ei kontrollita,
   ka piiratud teos on lubatud.
2. Iga lehe kohta `page_lock`-i all loe ketta `.txt` ja kontrolli `text_hash`-i. See
   tekst on `base_text`.
3. Rakenda `edits` **toortekstile** (`base_text` = ketta baidid, normaliseerimata).
   Alles siis `_normalize_page_text` → `proposed_text`. Kui kettal olev tekst ei olnud
   kanoonilisel kujul, näitab diff ka normaliseerimise muudatusi. See on sama, mida
   tavaline Ctrl+S teeks. Normaliseerimine
   tuleb teha esitusel, et ülevaatuse diff ja kinnitus kirjutaksid sama teksti.
   `_normalize_page_text` tuleb tõsta `editing.py`-st jagatud kohta.
4. **Struktuurikontroll: muudatus ei tohi tekitada UUSI vigu** (*minu otsus*: kettal
   võib olla vana vigast märgendust või literaalne `<`, mis ei tohi blokeerida ühe
   tähe parandust). Jagatud funktsioon (nt `vutt_tags.markup_errors(text)`) parsib
   tägid pinuga ja tagastab vigade loendi:
   - registrist puuduv täg;
   - paarita avav/sulgev täg;
   - ristuvad paarid (`<i>x</i>` → `</i>x<i>` tuvastatakse siin, mitte arvudest);
   - `<m>` reavahetusega.

   Nõue: `markup_errors(proposed)` ⊆ `markup_errors(base)` (multihulgana, võti =
   vea liik + täg). Uus viga → `invalid_markup` koos lehe, tägi ja põhjusega. Midagi
   ei talletata.
5. **Annotatsiooniankrud on puutumata.** Ühegi edit'i `old` ega `new` ei tohi
   sisaldada `<annN>`/`</annN>` tokenit → muidu `anchor_touched`. Nii ei saa asendus
   ankrut lisada, kustutada, dubleerida ega tõsta üle säiliva teksti
   (`<ann1>üks</ann1> kaks` → `<ann1>üks kaks</ann1>` on keelatud, sest `old` sisaldab
   `</ann1>`). Ankru sees olevat teksti agent muuta tohib (OCR-viga). Lisakontroll:
   ann-tokenite järjestatud loend on identne ja `merge_page._seose_vead` (tekst ↔
   `text_annotations`) jääb samaks. Pärast ümberbaseerimist võrreldakse ann-tokeneid
   **ketta** tekstiga, sest inimese ankrumuudatus on lubatud.
6. `proposed_text == base_text` lehed jäetakse vaikselt välja (ADR 0012 vaim).
   Tühi pakk → `no_changes`.
7. **Lehel on korraga üks ootel ettepanek** (*minu otsus*). Uus esitus samale tüvele
   asendab vanema ootel lehe: vana märgitakse `superseded`. Nii saab agent oma
   ettepanekut parandada ilma, et ülevaatusele jõuaks kaks konkureerivat versiooni.
8. Kasutuskord kulub tingimusliku UPDATE-iga (nagu olemasolevates moodulites).

**Laed** (*minu otsus*, ehitaja võib mõõtmise järel muuta): kuni 200 lehte pakis,
kuni 100 edit'i lehel, keha ≤ 2 MB. Ettepanek aegub 14 päevaga (`PROPOSAL_TTL`
nagu osadel).

**Olemasoleva `/save`-i parandus (teostuse ulatuses).** `_merge_with_base`
normaliseerib kliendi `base`-i teksti, kuid ketta teksti (`theirs`) mitte. Kui kettal
on mittekanooniline tekst (nt lahutatud Unicode'i märgid: `Café` NFD-s), annab
liitmine konflikti, kuigi ketas pole muutunud (reprodutseeritud 2026-10-19: ettepanek
`vana` → `uus` sellisel lehel). Parandus: liitmises võrreldakse `base`-i ja ketast
samal normaliseeritud kujul (ka `theirs` läbib `_normalize_page_text`-i). Lisada tuleb
regressioonitest. Räsi ja asendused jäävad toortekstipõhiseks, nagu ülal kokku lepitud.
Ümberbaseerimine ja paki töö kasutavad sama ühtlustatud liitmist.

**Ümberbaseerimine enne näitamist** (kriitiline, anti-eesmärk 1). Ketas võib
esituse ja ülevaatuse vahel muutuda. Redaktori salvestuse `base` on laadimishetke
ketas (`useEditorSave` `baseFromSavedState`), mitte `base_text`. Kui redaktorisse
laaditaks paljas `proposed_text`, kirjutaks `/save` liitmine vahepealse
inimparanduse vaikselt üle, ja diff näitaks seda agendi kustutusena. Seepärast
tagastab server lehe ettepaneku alati **ümberbaseerituna**, ja **ühe hetktõmmisena**:
ühe `page_lock`-i all loetakse lehe vaade (`read_page_view`: tekst + JSON-väljad,
täpselt see, mida redaktor tavaliselt laeb) ning arvutatakse
`merge_text(base_text, proposed_text, ketta_tekst)`. Vastus = `{page: <see vaade>,
proposed_now}`.
- Klient rakendab need **koos**: `page` saab redaktori salvestatud seisuks (`base`),
  `proposed_now` redaktori tekstiks. Eraldi tavalist lehelaadimist ei usaldata, sest
  kaks päringut võivad näha eri ketta seisu.
- **Liitmise järel kontrollitakse uuesti** struktuuri (`markup_errors` ⊆ ketta vead)
  ja ankruid (p 4–5 ketta teksti vastu). `merge_text` võib konfliktita liita
  tulemuse, kuhu jääb üksik `</i>` (kontrollitud 2026-10-19: agent eemaldab paari,
  inimene nihutab sulgevat tägi). Kontrolli kukkumine = kokkupõrge.
- Puhas → redaktor laadib `proposed_now`. Diff ketta vastu on täpne.
- Kokkupõrge → leht märgitakse `stale`. Redaktorisse midagi ei laadita. Paneel
  näitab agendi diffi (`base_text` → `proposed_text`) ainult lugemiseks, et
  toimetaja saaks muudatuse käsitsi üle tuua või lehe tagasi lükata. Käsitsi
  parandatud `stale` lehe salvestus kannab samuti `proposal`-viidet (`{id, stem}`),
  ja see märgib lehe `accepted`. Ilma salvestuseta lõpetab „Lükka tagasi".
- Kui ketas == `base_text`, on `proposed_now == proposed_text`.

**Nähtavus:** kõik superadminid näevad kõiki ettepanekuid ja tohivad neid otsustada
(*minu otsus*). Erinevalt `work_part_proposals.list_pending`-ist ei filtreerita koodi
andja järgi. Töövoog on niikuinii ainult superadminile.

**Loetelu ja otsused** (kõik `require_role("superadmin")`):
- **Ülevaatust vajav = `pending` ∪ `stale`.** Pakk on loendis, kuni tal on kumbagi
  liiki lehti. Navigeerimine käib mõlemat liiki lehtede vahel.
- `GET /text-proposals` — ootel pakid (teos, pealkiri, lehtede arv olekute kaupa,
  märkus, autor-kasutaja, aeg). Review lehe jaoks.
- `GET /works/{work_id}/text-proposals` — teose ootel lehed. Workspace'i jaoks,
  lehe tüve järgi.
- `POST …/{proposal_id}/pages/{stem}/reject`, `POST …/{proposal_id}/reject` (terve pakk).
- **Lehe kinnitus redaktorist:** `/save` saab valikulise välja `proposal`
  (`{id, stem}`, superadmin). Pärast edukat salvestust märgitakse leht `accepted`
  ja commit-sõnum saab viite (nt `MCP-ettepanek <id>`). Muutusteta salvestus
  (toimetaja taastas ketta teksti) märgib lehe samuti otsustatuks: `rejected`, sest
  midagi ei kirjutatud. 409 kokkupõrge jätab ettepaneku ootele.
- **Paki kinnitus:** `POST /works/{work_id}/text-proposals/{id}/accept` käivitab
  taustatöö (`page_ops_jobs` muster: olek mälus, `…/status` pollimiseks, teose kohta
  üks töö, 409 kui juba käib). **Lukustus:** töö võtab paki KÕIGI ootel lehtede
  `page_lock`-id **tüve järjekorras** (lukk ei ole reentrant, järjekord väldib
  ummikut) ja hoiab neid lugemisest, liitmisest ja kirjutusest kuni commit'ini.
  Muidu läheks vahepealne Ctrl+S kaotsi, sest kogutud tekstid kirjutataks lõpus üle.
  `/save` ootab sel ajal luku taga. Iga lehe kohta:
  `merge_text(base_text, proposed_text, ketta_tekst)` + sama struktuuri- ja
  ankrukontroll nagu ülal.
  - Puhas → kirjuta tekst. JSON jääb puutumata, ka seisund.
  - Kokkupõrge → leht `stale`, ketast ei puudutata.
  - Kõik kirjutatud lehed lähevad **ühte commit'i**, mitte N eraldi commit'i (iga
    commit on oma `git add` + `commit` tsükkel ja N lehe pakk teeks N korda Meili- ja
    git-tööd). Meili sünk **üks kord** teose kohta.
  - **Commit'i viga = ketas taastatakse.** `save_with_git` kirjutab failid enne
    commit'i ja jätab Git-vea korral uue sisu kettale. Tavalisel Ctrl+S-il on see
    hoiatusega aktsepteeritud, aga kinnitamata pakk ei tohi avalikku teksti jääda.
    Töö hoiab iga kirjutatava lehe **toimingueelset toorteksti mälus** ja taastab
    Git-vea korral kõik kirjutatud failid sellest, **lukke vabastamata**. Lehed jäävad
    ootele ja töö tulemus on viga. Meili sünki ei käivitata.
  - **Katkestus keset tööd** (protsess sureb). Teksti võrdsus üksi ei tõesta
    commit'i, sest protsess võis surra ka pärast failide kirjutamist, aga enne commit'i.
    Seepärast eristab taaste kahte juhtu lehe kaupa, git'i järgi:
    - **Commit'itud** (lehe `.txt` ei ole `uncommitted_paths`-is, st ketas == HEAD)
      ja `proposed_now == ketta_tekst != base_text` → ettepanek on rakendatud. Leht
      märgitakse `accepted` ilma kirjutuseta. Ajalugu ja `git revert` on olemas.
    - **Commit'imata** (ketas ≠ HEAD) → poolik töö. Paki töö algul (lehelukkude all)
      taastatakse sellise lehe `.txt` HEAD-ist (`git show HEAD:<tee>`) ja töö jätkub
      tavapäraselt. Ümberbaseerimine lugemisel ei kirjuta: see näitab lehte ootel
      olevana ja jätab parandamise paki tööle või järgmisele `/save`-ile.
    - **Git-viga kontrollis** (`uncommitted_paths` tagastab vea korral tühja loendi,
      fail-open) → seda ei tõlgendata commit'ituna. Taaste peab kasutama varianti, mis
      eristab viga, ja vea korral jätab lehe ootele.

  - **Olekumuutused on serialiseeritud ettepaneku kaupa:** kinnitus, tagasilükkamine,
    `superseded` ja `/save` kaudu kinnitamine käivad sama ettepaneku-luku all
    (protsessi lukk ettepaneku id järgi).
  - **Lukkude kohustuslik järjekord KÕIGIS teedes:** ettepanekulukud **id järjekorras**
    → lehelukud **tüve järjekorras** → git-kirjutuslukk (`_git_write_lock`, võetakse
    `save_with_git`-i sees). Lukke ei võeta kunagi vastupidi.
    - `/save` `proposal`-viitega võtab ettepanekuluku **enne** `_save_page_locked`-i
      (mis võtab lehe luku).
    - Esitus, mis muudab varasemaid pakke `superseded`-iks, võtab kõigi puudutatud
      varasemate ettepanekute lukud (id järjekorras) enne lehelukke.
    - Paki töö: oma ettepaneku lukk → lehelukud → commit.
    - `/save` ilma viiteta võtab ainult lehe luku, nagu praegu. SQLite üleminekud on CAS-id
    (`UPDATE … WHERE state IN ('pending','stale')`). Paki töö loeb lehtede olekud
    luku all ja märgib kirjutatud lehed `accepted` pärast edukat commit'i. Commit'i
    ebaõnnestumisel jäävad lehed ootele.
  - Juba `accepted`/`rejected` lehti ei puudutata. Toimetaja ise üle vaadatud ja
    salvestatud versioon jääb seega alles.
  - Tulemus: `{accepted, stale, skipped}` lehtede loend.

`person_to_works` / `refresh_work_mentions` ei ole vaja: lehenumbrid ei nihku ja
isikutägid elavad JSON-is (ADR 0055).

### Frontend

**Workspace** (põhivaade):
- Kui avatud lehel on ootel ettepanek (superadmin), on redaktori kohal paneel
  `ReocrPanel`-i kõrval või selle mustris: paki märkus, lehe märkus, „N/M lehte
  ootel", nupud **Lükka tagasi** (leht), **Kinnita kogu pakk**, **Lükka tagasi pakk**,
  **← eelmine / järgmine →** (ainult ootel lehtede vahel, ka üle teose).
- Ettepaneku tekst (`proposed_now`, serveris ümberbaseeritud, vt ülal) laetakse
  redaktorisse salvestamata muudatusena. Salvestuse `base` on ketta leht,
  nagu tavaliselt. See on ohutu ainult seetõttu, et `proposed_now` on juba sama ketta
  vastu liidetud. Paljast `proposed_text`-i redaktorisse ei laadita.
- **Diff esile tõstetud** redaktori sees: kustutatu läbi kriipsutatud / punasega,
  lisatu värviga, ketta teksti (`base`) vastu. Rakendus on ehitaja valik:
  `@codemirror/merge` `unifiedMergeView` on lähim valmis variant (pole veel
  sõltuvus). Teine võimalus on oma mark-dekoratsioonid. Kitsendused:
  - `VuttMarkupExtension` reeglid kehtivad (mark + `atomicRanges`, replace ainult
    `<pb/>`/`<fn>`).
  - Ettepaneku laadimine on programmaatiline. Otsustada tuleb, kas see kannab
    `pageSwapAnnotation`-it (siis sanitiseerijad ei puuduta seda, aga `isDirty` tuleb
    seada käsitsi) või `userEvent`-i. Tekst on juba serveris normaliseeritud, seega
    sanitiseerija ei tohiks seda muuta. Kontrolli seda testiga.
  - Lehepööre / perioodiline dep ei tohi ettepanekut redaktorist pühkida ega uuesti
    laadida (ADR 0010, 0060). Lahkumisel kehtib tavaline `UnsavedChangesDialog`.
- **„Salvesta ja järgmine"** salvestab ja liigub järgmisele ülevaatust vajavale lehele.
  *Minu otsus:* see on paneeli eraldi nupp. Tavaline Ctrl+S jääb lehele,
  et redaktori harjumus ei muutuks.
- **Mustand enne paki kinnitust:** kontroll on **`hasUnsavedChanges`**
  (`useEditorState`), mitte `isDirty`. Seisund, kommentaarid, annotatsioonid ja
  kommentaarimustand võivad olla muudetud ka siis, kui `isDirty === false`. Kui neid
  on, avab „Kinnita kogu pakk" kõigepealt `UnsavedChangesDialog`-i (salvesta / loobu).
  Salvestamisel läheb aktiivne leht `/save` + `proposal`-viitega (toimetaja versioon).
  Paki töö käivitub **alles pärast edukat salvestusvastust**. Salvestusviga
  (sh 409) või dialoogi tühistamine → paki tööd ei käivitata. Server ei saa redaktori mustandit näha, seega ilma selle sammuta
  kinnitaks ta algse kandidaadi.
- **Hilinenud ettepanekuvastus:** ettepanek laetakse redaktorisse ainult siis, kui
  lehel pole salvestamata muudatusi (`!hasUnsavedChanges`, sest vastus asendab kogu
  baasseisu) ja sama leht (`pageLoadKey` sama). Kui kasutaja on juba
  kirjutama hakanud, näitab paneel „Ettepanek ootel" ja nuppu „Lae ettepanek", mis
  käib läbi `UnsavedChangesDialog`-i.
- Paki kinnituse ajal näitab paneel edenemist (pollib staatust). Pärast seda
  kokkuvõte: kirjutatud / aegunud / vahele jäetud. Aegunud lehed jäävad
  navigeeritavaks ja käsitsi üle vaadatavaks.

**Review leht:** jaotis „Agendi ettepanekud" (ainult superadmin). Pakkide loend:
teos, märkus, lehed olekute kaupa, vanus. Klikk avab Workspace'i esimesel ootel lehel.

**Kood agendile:** superadmin saab koodi Workspace'i paneelist või teose haldusest.
Ulatus „kõik teosed" on Review lehe jaotises. Kood näidatakse kopeerimiseks koos
aegumisajaga (nagu `PartsTab`).

**Ühine diffikomponent #577-ga:** sama esiletõstmine (praegune tekst ↔ kandidaattekst)
sobib re-OCR `.ocr` ülevaatusele. Ehita see nii, et kandidaattekst ja selle allikas
on parameetrid, mitte MCP-spetsiifilised. #577 ise ei kuulu siia.

## ADR

ADR 0058 täiendus „lehe teksti ettepanek". Põhimõtted:
- MCP kirjutab ka lehe teksti ainult ootel ettepanekuna;
- autoriteet on esitusel ketas, mitte Meili;
- normaliseerimine esitusel;
- tägid ainult registrist, `ann` ankrud puutumata;
- kinnitus `/save`-i või ühe commit'iga taustatöö kaudu;
- seisundit ei muudeta.

## Testid (miinimum)

- Esitus: `text_hash` ei klapi → `stale_page`. Ümberjärjestatud teos: tüvi viib õigele
  lehele. `old` puudub või on mitmekordne → viga, midagi ei talletata.
  `</i>x<i>` → `invalid_markup`. `<ann1>` dubleerimine või ankru piiri nihutamine
  (`<ann1>üks</ann1> kaks` → `<ann1>üks kaks</ann1>`) → `anchor_touched`. Vana vigane märgendus
  kettal ei blokeeri parandust.
- Ümberbaseerimine: konfliktita liitmine, mis jätab üksiku `</i>` → `stale`. Vastuse
  `page` ja `proposed_now` on samast hetktõmmisest.
- Paki kinnitus + samaaegne `/save` samal lehel: `/save` ootab, kumbki ei kao. Tundmatu täg,
  tasakaalustamata paar või muutunud `ann`-hulk → `invalid_markup`. Muutusteta leht
  jäetakse välja. Kood: aegunud, kasutatud, vale teos. Koodi ulatuses piiratud teos
  on lubatud (esitus ja `source`). Ilma kehtiva koodita `source` toorteksti ei väljasta.
- `/save` regressioon: NFD-tekstiga leht kettal, klient saadab muutmata `base`-i →
  liitmine ilma konfliktita.
- Taaste: commit'itud + `pending` → `accepted` ilma kirjutuseta. Commit'imata pooleli
  kirjutus → paki töö taastab HEAD-ist. `git status` viga → leht jääb ootele.
- Normaliseerimine: talletatud `proposed_text` == see, mille `/save` kirjutaks.
- Paki kinnitus: vahepeal sama koha muutnud leht → `stale`, ketas puutumata. Mujalt
  muudetud leht → liidetud. Juba otsustatud leht → vahele. Üks commit. JSON (seisund,
  kommentaarid) baithaaval sama.
- `/save` `proposal`-väljaga: kinnitab lehe. 409 → jääb ootele. Mitte-superadmin →
  väli lükatakse tagasi.
- Frontend: ettepaneku laadimine ei käivita sanitiseerijat ega muuda teksti. Lehepööre
  ja tagasi ei kaota ettepanekut. Tokeni uuendus ei laadi lehte uuesti.
- MCP: `get_page_source` tagastab toore teksti (reavahetused ja tägid alles).
  `VuttError` sõnum jõuab agendini (ToolError).

## Ehitaja otsustada

- Tägide loendi allikas MCP-le (serveri otspunkt vs koopia + pariteeditest).
- Diffi rakendus redaktoris (`@codemirror/merge` vs oma dekoratsioonid). Mõõda
  bundle'i kasvu gzip'iga.
- Routeri/moodulite täpne jaotus, otspunktide nimed.
- Lagede lõplikud väärtused.
