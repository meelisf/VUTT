# Sekundaarkirjanduse kogu MCP-s — disain

Kuupäev: 2026-08-19
Seis: kinnitatud disain, ootab teostusplaani
Muudetud: 2026-08-19 (ülevaate järel — värskuse tuvastus, leheküljemudel,
kollektsiooni identifitseerimine, indeksi aatomilisus, otsingu normaliseerimine,
privaatsuse sõnastus)

## Probleem

Kui agent teeb VUTT-i korpuse kohta sisulist tööd, puudub tal ligipääs
sekundaarkirjandusele — teatmeteostele, matriklitele ja monograafiatele, mis
17. sajandi Tartu kohta tegelikult vastuse annavad. Materjal on olemas
(Zoteros, ~1300 PDF-i), aga agendile kättesaamatu.

Senine ajutine lahendus on olnud kirjanduse **VUTT-i laadimine** `acad-sekundaar`
kollektsiooni. See ei tööta:

- VUTT-i upload-tee ajab faili läbi oma OCR-serveri, mis 500-leheküljelise köite
  puhul võtab tunde — **kuigi PDF-il on tekstikiht juba olemas**.
- Materjal muutub „teoseks": lehekaupa `.txt`-d, git-commitid, koht korpuse
  otsingus, statistikas ja fassettides.
- Trükise leheküljenumbrit ei säili — VUTT-i numeratsioon on skaneeringute
  1-põhine järjestus, millega ei saa viidata.

Eesmärk: anda agendile sekundaarkirjandus otsitavana ja **täpselt
tsiteeritavana**, ilma et see läheks VUTT-i korpusesse või läbi OCR-i.

## Ulatus

**Sees:** täistekstiotsing katketega, pikema lõigu lugemine, kogu sisu loend,
tsiteeritav bibliokirje koos trükise leheküljenumbriga.

**Väljas praegu:** semantiline/teemapõhine otsing (embeddingud), sidumine VUTT-i
`work_id`-de või isikukaartidega, kirjutamine, mitme Zotero-kollektsiooni
liitmine, PDF-ide OCR-imine (kogusse pääsevad ainult tekstikihiga failid).

## Otsused, mis on juba langetatud

| Küsimus | Otsus |
|---|---|
| Hoidmine | **Lokaalne.** PDF-id ja indeks ei liigu serverisse ega avaliku API taha. |
| Maht | Alustab kümnetega, disainitud kasvama sadadeni ilma ümberehituseta. |
| Kasutus | Leia katke tsiteeritava viitega; tõmba pikem lõik ette. |
| Metaandmete allikas | **Zotero** — bibliokirjeid käsitsi ei sisestata. |
| Skoop | Üks Zotero kollektsioon: **„VUTT kirjandus"**, koos alamkollektsioonidega. |
| Pakendus | Valikuline moodul olemasolevas `vutt_mcp`-is, mitte eraldi server. |

Kollektsiooni sisu valib omanik käsitsi ja **ainult kvaliteetse OCR-iga
dokumente** — indekseerija ei hinda tekstikvaliteeti.

### Mida „lokaalne" tähendab ja mida mitte

Täpne piir, et disain ei lubaks rohkem kui ta annab:

> PDF-id ja indeks jäävad lokaalseks — MCP ei avalda neid võrku ega ühegi API
> kaudu. **Kuid MCP-kliendile tagastatud katked ja leheküljetekstid liiguvad
> edasi selle agendi ja mudelipakkuja infrastruktuuri, keda omanik kasutab.**

See on MCP normaalne toimimine, mitte puudus. Aga see tähendab, et
„privaatne" käib **hoidmise**, mitte **kasutamise** kohta, ja pilvemudeliga
agent (Codex, Gemini CLI) näeb sedasama teksti nagu iga teine tööriistavastus.

Sama loogika on juba kirjas `2026-08-15-vutt-mcp-server-design.md`-s: seal on
alus „server jookseb lokaalselt omaniku võtmega", mitte „andmed on niikuinii
avalikud".

## Arhitektuur

```
Zotero (~/.zotero/Zotero/zotero.sqlite + storage/)
   │  SQLite snapshot; kollektsioon „VUTT kirjandus" + alamkollektsioonid
   ▼
vutt-library index          ← konsoolikäsk, kirjutav, käib omaniku käsul
   │  pdftotext -layout, lehekülg kaupa
   ▼
library.db  (SQLite + FTS5) ← tuletatud read-model, nullist taastatav
   ▲
   │  read-only, ühendus tööriistakutse kohta
vutt_mcp/library/           ← tööriistad, mis registreeruvad AINULT kui library.db on olemas
```

**Zotero on ainuke tõe allikas.** `library.db` on tuletatud read-model — sama
muster mis `person_to_works.json` VUTT-is (ADR 0007): kustutatav ja täielikult
taastatav. PDF-e ei kopeerita; indeks osutab failidele nende olemasolevas
asukohas.

### Miks moodul, mitte eraldi MCP-server

`vutt_mcp` on avalikult jagatav pakett; sekundaarkirjandus on isiklik ja
autoriõigusega. Lahendus: **tööriistad registreeritakse ainult siis, kui
indeksifail eksisteerib**. Kellelgi teisel, kes `vutt-mcp` paigaldab, ei teki
neid tööriistu ega vihjet nende olemasolule. Omanik saab ühe paigalduse, ühe
kliendiregistreeringu ja mõlemad tööriistakomplektid samasse seanssi.

**Erand, mis tuleb kirja panna:** `vutt_mcp` on seni olnud õhuke klient avaliku
HTTPS-API otsas, ilma lokaalse olekuta (`mcp/README.md`). See moodul lisab
lokaalse oleku. Erand läheb ADR-i, mitte ainult vestlusesse.

## Zotero lugemine

### Mõõdetud seis (2026-08-19)

| Näitaja | Väärtus |
|---|---|
| Andmekataloog | `~/.zotero/Zotero/` (flatpak-paigaldus, andmed siin) |
| `zotero.sqlite` | 433 MB, aktiivselt kasutuses |
| `storage/` | 15 GB, 2803 kataloogi, 1269 PDF-faili |
| PDF-manuseid kokku | 1319 |
| Skeemiversioon (`userdata`) | 125 |
| Kollektsioone / neist alamkollektsioone | 113 / 80 |
| Prügikastis kirjeid | 59 |
| Vanemkirjeid 2+ PDF-manusega | 19 |

### Snapshot, mitte `cp`

`zotero.sqlite` on WAL-režiimis ja aktiivselt kasutuses. **Tavaline
failikopeerimine on keelatud** — see annab viimase checkpointi seisu ja jätab
`-wal` sisu välja, mille tulemus on vaikselt aegunud või ebajärjekindel vaade.

Invariant: **koopia tehakse SQLite'i enda snapshot-mehhanismiga**
(`sqlite3.Connection.backup()`), lugedes originaali `mode=ro` URI-ga. Snapshot
on hetkeline ja järjekindel sõltumata sellest, mida Zotero parajasti teeb.

Üks praktiline eeldus: WAL-baasi read-only avamine nõuab kirjutusõigust
**kataloogile** (`-shm` mäppimiseks). Omaniku masinas see kehtib; kui ei kehti,
peab jooks kukkuma selge veateatega, mitte vaikselt vanema koopia peale minema.

### Kollektsiooni identifitseerimine

Kollektsiooni **nimi ei ole püsiv identifikaator**. Mõõtmine kinnitab, et see ei
ole teoreetiline mure: baasis on juba praegu **kolm duplikaat-nime** — `17. saj`
×2, `alkeemia` ×2, `saksa` ×2.

Reegel:

1. Konfiguratsioon võtab mugavuse pärast **nime**.
2. Indekseerija lahendab selle **`collections.key`-ks**.
3. **0 vastet → kukub. >1 vastet → kukub**, loetledes kandidaadid koos
   ülemkollektsiooni teega, et omanik saaks konfi asemel `key` kirjutada.
4. Konfiguratsioon aktsepteerib ka otse `key`-d, mis jätab lahendamise vahele.

**Alamkollektsioonid kuuluvad kaasa**, rekursiivselt
(`collections.parentCollectionID`). Põhjendus: kasvav kureeritud kollektsioon
saab loomulikult alamkaustu, ja nende vaikne väljajätmine tähendaks materjali,
mis on kogus olemas, aga otsingust puudub — täpselt see vaikne vale, mida see
disain mujal väldib. Aruanne näitab kaasatud alamkollektsioonid nimeliselt.

### Manusetüübid

`itemAttachments.linkMode` määrab, kust fail leida:

| `linkMode` | Tähendus | Arv | Kust fail |
|---|---|---|---|
| 0 | `imported_file` | 820 | `storage/{manuse_key}/{failinimi}` |
| 1 | `imported_url` | 473 | sama |
| 2 | `linked_file` | 25 | `path` = absoluutne tee |
| 3 | `linked_url` | 1 | faili ei ole — vahele |

**Lingitud failid on juba täna osaliselt katki: 25-st eksisteerib 18, seitse
mitte** (vana kasutajanimi `/home/meelis/…`, liigutatud failid). Katkised lingid
lähevad aruandesse **nimeliselt**.

**`attachments:` suhtelisi teid ei lahendata.** Mõõtmine: neid on baasis 0 ja
Zotero baasikataloogi (`extensions.zotero.baseAttachmentPath`) ei ole seatud.
Selle haru ehitamine oleks nulli kasutusega kood. Kui selline tee siiski ilmub,
**kukub jooks valjult** teatega, et baasikataloogi tugi on ehitamata — mitte ei
jäta faili vaikselt vahele.

### Päringu reeglid

- Puudutame ainult neid tabeleid: `collections`, `collectionItems`, `items`,
  `itemAttachments`, `itemData`, `itemDataValues`, `fields`, `itemCreators`,
  `creators`, `creatorTypes`, `deletedItems`.
- **Prügikast välistatakse** (`deletedItems`) — nii kirje kui manuse tasandil.
- **Skeemiversiooni kontroll** (`version.schema='userdata'`, ootus 125):
  tundmatu versioon annab **valju vea**, mitte vaikse osalise tulemuse.
- Duplikaadid tõrjutakse manuse `key` järgi (sama fail võib olla mitmes
  kollektsioonis, sh ülem- ja alamkollektsioonis korraga).

### Bibliokirje

Zoterost loetakse ja indeksisse salvestatakse: autorid/toimetajad rollidega,
pealkiri, aasta, koht, kirjastus, ajakiri, kd, nr, lk-vahemik, seeria, väljaanne,
ISBN, DOI. Välja-ID-d on stabiilsed (`title`=1, `date`=6, `volume`=19,
`place`=21, `publisher`=23, `ISBN`=25, `pages`=32, `publicationTitle`=38,
`series`=41, `edition`=43, `DOI`=59, `issue`=76), aga loetakse siiski
`fields`-tabeli kaudu nime järgi.

Iga tulemus kannab kaasa `zotero://select/library/items/{parent_key}` — klõps
avab kirje Zoteros, kust saab oma stiilis viite.

## Tsiteeritavus

Disaini süda. Kaks poolt peavad mõlemad õiged olema, muidu ei ole tööriistast
kasu.

### Leheküljemudel: tõeallikas on lehekülg, mitte nihe

PDF-i lehe indeks ≠ trükise lehekülg, ja seos **ei ole üldjuhul üks konstantne
nihe**. Tüüpiline köide:

```
PDF 1–12    → tiitel ja eessõna, trükitud i–xii
PDF 13      → trükitud lk 1
PDF 237     → nummerdamata tahvel
PDF 238     → trükitud lk 225
```

Seetõttu:

- **Tõeallikas on `pages.printed_page` iga lehe kohta.** Globaalset
  `page_offset`-i indeks ei kasuta; kui nihe on tuvastuse kõrvalsaadus, elab ta
  ainult diagnostikaväljas.
- **`printed_page` tüüp on TEXT**, et mahuksid `xviii`, `A3`, `225a` ja
  nummerdamata lehe puhul NULL.
- **`pdf_page` (INTEGER) on ainuke järjestusvõti.** Kõik sortimine ja
  vahemikuloogika käib selle järgi.

`documents` hoiab ainult strateegiat ja diagnostikat: `page_mapping_source`
(`pagelabels` | `detected` | `sidecar` | `none`), `page_mapping_confidence`,
`page_mapping_summary` (inimloetav kokkuvõte, nt „i–xii, siis 1–530; PDF 237
nummerdamata").

### Kolm allikat prioriteedis

1. **PDF-i `/PageLabels`** — kui olemas, autoritatiivne. Katab rooma numbrid ja
   prefiksid loomulikult.
2. **Nihke-tuvastus** — pea- ja jalusridade numbrid, millest tuletatakse
   **vahemikud**, mitte üks nihe. Vahemik võetakse vastu ainult siis, kui seos
   kehtib piisaval hulgal järjestikustel lehtedel.
3. **Sidecar-ülekirjutus** (`{doc_id}.override.json`) — võidab alati
   automaatika. **Kirjeldab vahemikke**, mitte üht offsetti:

   ```json
   { "ranges": [
       { "pdf_from": 1,  "pdf_to": 12,  "style": "roman", "printed_from": "i" },
       { "pdf_from": 13, "pdf_to": 236, "style": "arabic", "printed_from": "1" },
       { "pdf_from": 237, "pdf_to": 237, "printed": null },
       { "pdf_from": 238, "pdf_to": 530, "style": "arabic", "printed_from": "225" }
   ] }
   ```

### Kuvamise reegel

**Alati kuvatakse mõlemad numbrid: „lk 217 (PDF 223)".**

Kui trükitud number on teadmata, **seda ei pakuta üldse** ja öeldakse välja, et
see on teadmata. Ei mingit vaikset oletust — süsteem, mis alati leiab mingi
väärtuse, ei oska öelda, et ta eksib.

### Tagajärg, mille TEXT-tüüp kaasa toob

Kuna `printed_page` on TEXT, **ei saa trükitud numeratsioonis vahemikupäringut
teha võrdlusoperaatoriga**. `get_literature_pages(page_ref="printed", …)`
lahendab vahemiku nii:

1. leiab `from_page` sildile vastava(d) lehe(d), võtab **väikseima** `pdf_page`;
2. leiab `to_page` sildile vastavad, võtab **suurima** `pdf_page`;
3. tagastab selle `pdf_page` vahemiku.

Kui silti ei leidu või ta esineb mitteühtses kohas, **kukub päring selge
veateatega**, mis loetleb lähedal olevad olemasolevad sildid. Vaikset lähima
lehe valikut ei tehta.

## Indeksi skeem

SQLite, üks fail.

- **`documents`** — üks rida faili kohta: `doc_id` (Zotero manuse key),
  `parent_key`, `collection_key`, bibliokirje väljad, failitee, `link_mode`,
  lehtede arv, `page_mapping_*`, `file_missing`, värskuse-sõrmejälg (allpool).
- **`pages`** — üks rida lehekülje kohta: `doc_id`, `pdf_page` (INTEGER),
  `printed_page` (TEXT, nullitav), `text`, `search_text`.
- **`pages_fts`** — FTS5 virtuaaltabel **`search_text`** kohal, katkete
  genereerimiseks (`snippet()`) ja järjestamiseks (`bm25()`).

`doc_id` = Zotero **manuse** key (üks fail = üks dokument; mõõdetult on 19
vanemkirjel 2+ PDF-i). Bibliokirje ja `zotero://` link osutavad
**vanemkirjele**.

### Kaks tekstivälja

- **`text`** — puutumata `pdftotext` väljund. **Ainus, mida tagastatakse.**
- **`search_text`** — konservatiivselt normaliseeritud, ainult indekseerimiseks.
  Ei ole otsitav ega kuvatav.

V1 normaliseerimine hoitakse kitsana: reavahetuse sidekriipsuga poolitatud
sõnade liitmine (digiteeritud monograafiate puhul suure mõjuga), ühtlustatud
tühikud, Unicode-normaliseerimine.

See on **täpselt sama muster, mis VUTT-is juba kehtib** (ADR 0006):
`lehekylje_tekst` on otsinguks puhastatud, `text_content` on toores redaktorile.
Kaks kogu käituvad seega ühtmoodi.

### Päringu parser

**Kasutaja päring ei lähe kunagi toorelt FTS5 `MATCH` avaldiseks.** Jutumärgid,
sidekriipsud, sulud, koolonid ja `*` on FTS5 süntaks ja annaksid kas
süntaksivea või vaikselt vale semantika.

Päring tokeniseeritakse ja ehitatakse kontrollitud avaldiseks:

- vaikimisi (`relax_matching=false`) — kõik tokenid `AND`-iga;
- `relax_matching=true` — `OR` bm25-järjestusega;
- kasutaja jutumärgid tõlgitakse FTS5 fraasiks **teadlikult**, mitte edasi
  antuna.

## Tööriistad

Kolm, kõik read-only, kõik `@mcp.tool(structured_output=False)`.

### `list_literature`

Mis kogus on: `doc_id`, autor, pealkiri, aasta, lehtede arv,
`page_mapping_source`, `file_missing`.

Ei ole luksus: ilma selleta ei tea mudel kogu sisu ja hakkab kas pimesi otsima
või järeldama tühjast tulemusest valesti.

### `search_literature`

Parameetrid: `query`, `limit` (vaikimisi 10), `doc_id` (piira ühele teosele),
`relax_matching`.

Tagastab: katke esiletõstuga (**`text`-ist, mitte `search_text`-ist**), `doc_id`,
lühiviide (autor, aasta), `lk 217 (PDF 223)`, `zotero://` link.

### `get_literature_pages`

Parameetrid: `doc_id`, `from_page`, `to_page`, **`page_ref`** (`printed` | `pdf`).

Kaks ülempiiri, mõlemad vajalikud:

- **20 lehekülge** (nagu `get_pages` VUTT-is);
- **märgimahu lagi**, mis lõikab vastuse varem, kui leheküljed on tihedad.
  Kakskümmend monograafialehekülge on agendi ühe tööriistavastuse kohta väga
  palju. Kärpimisel öeldakse **selgelt välja**, mitu lehekülge tagastati ja kust
  jätkata.

`page_ref` on **kohustuslikult selgesõnaline**. Ilma selleta tuleb varem või
hiljem päring, kus mudel mõtleb üht numeratsiooni ja server teist — ja viga on
vaikne.

## Indekseerija

Konsoolikäsk `vutt-library index`, **mitte MCP tööriist** — indekseerimine on
kirjutav ja käib omaniku käsul. MCP-pool jääb read-only.

### Värskuse tuvastus

Ainult faili muutumise jälgimine on liiga kitsas: Zoteros parandatud autor või
aasta ei puuduta PDF-i, ja sidecar-i muutmine ei puuduta samuti. Mõlemal juhul
jääks indeksisse vaikselt vana tõde.

Dokumendi sõrmejälg koosneb seetõttu **viiest osast**:

```
fingerprint = hash(
    failitee + mtime + suurus       ← fail ise
  + bibliokirje hash                ← Zotero metaandmed
  + sidecar-i hash (või puudumine)  ← käsitsi numeratsioon
  + extractor_version               ← pdftotext-tee ja normaliseerimine
  + indexer_schema_version          ← indeksi skeem
)
```

Kaks viimast lubavad **algoritmi muutmisel sundida ümberarvutust** ilma
indeksit käsitsi kustutamata: versiooni tõstmine muudab iga dokumendi
sõrmejälge.

Osaline ümberarvutus: metaandmete või sidecar-i muutus ei nõua teksti uuesti
ekstraheerimist, ainult vastava osa uuendamist. Ainult failimuutus või
`extractor_version` toob kaasa täieliku ümbertöötluse.

### Elutsükkel — kolm eristatud juhtu

Zotero on tõe allikas, seega peab indeks järgnema ka **eemaldamisele**:

| Olukord | Tulemus |
|---|---|
| Kollektsioonis, fail olemas | indekseeritakse / uuendatakse |
| **Kollektsioonis, fail kadunud** | **tekst säilib**, `file_missing = true`; otsing töötab, `get_literature_pages` ütleb algfaili puudumise välja |
| **Kollektsioonist eemaldatud või prügikastis** | **eemaldatakse indeksist** koos lehekülgedega |

Esimene ja teine on tahtlikult erinevad: kadunud fail ei tohi hävitada juba
tehtud tööd, aga kogust eemaldatud teos ei tohi otsingus edasi elada.

### Aatomilisus

**MCP ei tohi kunagi näha pooleliolevat indeksit.**

- Inkrementaalne jooks: kõik muudatused **ühes transaktsioonis**.
- Täielik ümberehitus: ehitatakse `library.db.tmp` ja lõpus **atomic rename**.
- **Indekseerija lukk** (failipõhine) — kaks `vutt-library index` protsessi ei
  käivitu korraga.
- MCP-pool avab **read-only ühenduse tööriistakutse kohta**, mitte ühe pikaajalise
  ühenduse. Põhjus: `rename` järel hoiaks avatud deskriptor vana inode'i elus ja
  tööriistad serveeriksid vaikselt aegunud indeksit kuni protsessi taaskäivituseni.
  Kümnete dokumentide juures on ühenduse avamine olematu kulu.

### Aruanne

Iga jooks lõpeb aruandega: mitu uut, muutunud, vahele, **eemaldatud**; kaasatud
alamkollektsioonid; **katkised lingid nimeliselt**; **mitmel teosel jäi trükitud
numeratsioon tuvastamata** (omaniku kontroll-list sidecar-i jaoks); mitmel failil
puudus tekstikiht.

Lisakäsk: `vutt-library status` (mis kogus on, kus indeks asub, mis on aegunud).

## Konfiguratsioon

| Muutuja | Vaikimisi |
|---|---|
| `VUTT_LIBRARY_DB` | `~/.local/share/vutt-library/library.db` |
| `VUTT_LIBRARY_COLLECTION` | `VUTT kirjandus` (nimi või `key`) |
| `VUTT_LIBRARY_ZOTERO_DIR` | `~/.zotero/Zotero` |

**Aktiveerimine ei sõltu keskkonnamuutujast** — tööriistad registreeruvad, kui
indeksifail on olemas.

## Testimine

Testid järgivad `mcp/tests/` olemasolevaid invariante: kaust **ilma
`__init__.py`-ta**, iga tööriist `structured_output=False`, **`server`-it ei
impordita**.

Kõik testid jooksevad **sünteetiliste fixture'ite peal**: programmiliselt
genereeritud minimaalsed PDF-id (teadaoleva teksti ja teadaolevate
lehesiltidega) ning käsitsi kokku pandud Zotero-kujuline SQLite. **Ükski test ei
tohi sõltuda omaniku päris Zoterost ega autoriõigusega failidest.**

Kaetavad juhud:

**Zotero lugemine**
- kõik neli `linkMode` väärtust;
- katkine link → aruandesse, jooks ei kuku;
- `attachments:` tee → **kukub valjult**;
- prügikastis kirje → välja jäetud;
- tundmatu skeemiversioon → **kukub**;
- **kaks sama nimega kollektsiooni → kukub**, loetleb kandidaadid;
- alamkollektsioonid kaasatud rekursiivselt, duplikaat loetud üks kord;
- **üks vanemkirje, kaks PDF-manust** → kaks eraldi `doc_id`-d, sama bibliokirje.

**Värskus ja elutsükkel**
- **bibliokirje muutub, PDF ei muutu** → metaandmed uuenevad;
- **sidecar muutub, PDF ei muutu** → numeratsioon uueneb;
- `extractor_version` tõuseb → tekst töödeldakse uuesti;
- muutumatu dokument → vahele jäetud;
- **teos eemaldatakse kollektsioonist** → indeksist eemaldatud;
- **fail kaob, kirje jääb** → tekst säilib, `file_missing = true`;
- **katkestatud jooks** → eelmine indeks jääb terviklikult kasutatavaks.

**Leheküljed ja tsiteeritavus**
- `/PageLabels` rooma eesosaga + araabia põhitekst;
- tuvastamata numeratsioon → trükitud numbrit **ei pakuta**;
- mitme vahemikuga sidecar, sh nummerdamata leht;
- `page_ref` mõlemad väärtused;
- tundmatu trükitud silt → **selge viga**, mitte lähim leht.

**Otsing**
- päring sisaldab `"`, `-`, `:`, `(`, `*` → **ei teki `MATCH`-süntaksiviga**;
- range vs lõdvendatud sobitamine;
- reavahetusega poolitatud sõna leitakse `search_text`-ist, aga **tagastatakse
  `text`-ist** algsel kujul.

## Väljaspool ulatust

- **Semantiline otsing** — kaalumist väärt, kui kogu kasvab sadadeni ja täpne
  sõnaotsing hakkab vahele jääma. Praegune skeem (eraldi `search_text`) ei takista
  lisamist.
- **Zotero baasikataloogi (`attachments:`) tugi** — null kasutust, ehitatakse
  siis, kui vaja.
- **Sidumine VUTT-iga** — „mida sekundaarkirjandus ütleb selle teose või isiku
  kohta". Loomulik järgmine samm, aga eeldab kogu olemasolu.
- **VUTT-i `acad-sekundaar` kollektsioon** jääb puutumata. Kaalusime Teringi
  *Album academicumi* eemaldamist; otsus: **jääb**. Kollektsioon on privaatne,
  leheküljed ei ole „Valmis" (seega ei satu treeningkorpusesse), ja teose tuum on
  matriklikirjete väljaanne — allikale lähedane, žanrilt Vasari
  allikapublikatsiooniga sarnane. VUTT juba kohtleb seda allikana: prosopograafia
  `AA:` identifikaatorid **on** Albumi kirjenumbrid.

## ADR

Uus ADR: `vutt_mcp` tohib hoida lokaalset olekut, kui see on valikuline ja
aktiveerub ainult andmete olemasolul. Senine invariant („õhuke klient avaliku
API otsas, oma olekut ei hoia") saab teadliku erandi, mitte vaikse rikkumise.
