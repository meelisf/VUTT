# Eksemplari kiht ja paber.ut.ee vesimärgid — arutelu

**Seis:** arutelu alus, mitte otsus (2026-10-19, tihendatud 2026-10-31). Issue [#696](https://github.com/meelisf/VUTT/issues/696).
**2026-11-25:** etapp 2 (eksemplari kiht) on tehtud — [ADR 0076](../../decisions/0076-eksemplari-kiht.md),
[ADR 0079](../../decisions/0079-eksemplari-pildid.md), [eksemplari leht](2026-11-10-eksemplari-leht-design.md).
Uurija vastused on jaotises [Uurija vastused](#uurija-vastused-2026-11); paberi (etapid 3–4) ADR kirjutamata.
Koodibaasi vastu kontrollitud:
[ülevaatus 2026-10-31](../../reviews/2026-10-31-eksemplari-kiht-koodi-ulevaade.md) (viited allpool „ül. §N")
ja [järelkontroll 2026-10-31](../../reviews/2026-10-31-eksemplari-kiht-jarelkontroll.md) („jk. §N");
sõnastus täpsustatud [kavandi täpsustuste](../../reviews/2026-10-31-eksemplari-kiht-kavandi-tapsustused.md) järgi.

## Lähtekoht

- **paber.ut.ee** ([Eesti varajased trükised][paber]) valmis ETF grandi 8205 raames: 522 eksemplari
  kirjeldust, vesimärgid IPH tüpoloogia järgi ([IPH Norm 2.1.1][iph]), fotod. Tarkvara ei ole üle
  10 aasta uuendatud, hooldus sõltub välisfirmast (5Dvision).
- **Ülevõtmine on võimalik:** kirjeldused ja täissuuruses pildid (`/pics/`) on HTML-ist kättesaadavad,
  ülekanne ei vaja vana tarkvara. Andmestiku täielikkus on kontrollimata — selgub etapi 1
  inventuurist.
- **Uurimine jätkub**, ka käsikirjadest (senatiprotokollid, kirjad). Vaja on kohta, kus andmeid
  jooksvalt täiendada.
- **VUTT on tekstikeskne.** Paber on eksemplari omadus, VUTT-is eksemplari mõistet ei ole.

## Probleem: „teos" on kaks asja korraga

VUTT-i teos on praegu nii bibliograafiline väljaanne kui ka üks digiteeritud eksemplar. Riia
eksemplari vesimärgid võivad Uppsala skaneeringu omadest täiesti erineda — paberit ei saa teosega
otse siduda. Segadus on andmetes juba näha:

- [`7zot7j`][7zot7j] — pealkirja sabas leidumus ja kohaviit („Tartu ÜR; Rīga LAB; Uppsala UB
  R Bergm. 357(8)").
- [`nri7ga`][nri7ga] — lk 1 (Rīga LAB, R Acad. doyp. 1702:17) ja lk 2 (Uppsala UB) on sama
  plakattrüki kaks terviklikku eksemplari ja kaks varianti: filosoofiateaduskonnas on Sjöberg
  ühes esimene, teises viimane (professorite tüli), ka teaduskondade järjekord erineb. Andmed
  seda ei ütle.

## Reegel: teosel kuni üks tekstitunnistaja

1. Transkribeeritakse üht eksemplari teose kohta; selle skaneering on teose lehed (nagu praegu).
2. Teised eksemplarid (digiteeritud või mitte) on **kirjed**: teksti ei transkribeerita; kirjel
   võib olla link välisele digikoopiale ja oma pildid (vesimärgid, erinev pühendusleht, köide).
3. Ühe lehe kaupa erinev eksemplar → leht eksemplari kirje juurde pildina, soovi korral
   transkriptsiooniga.
4. Sisuliselt erinev eksemplar → eraldi teos seosega „sama väljaanne, variant" (toimetaja otsus).
   `nri7ga` on selline: **tehtud 2026-11-01** — poolitatud kaheks teoseks (`nri7ga` = Rīga LAB,
   [`27ffq0`](https://vutt.utlib.ut.ee/work/27ffq0) = Uppsala UB), `isVersionOf` vastastikku.
   Poolitus käsitsi (uus upload + lehe kustutus); tekstiga poolituse toiming on #705.
5. Teise eksemplari leht täiendab tekstitunnistajat (nt puuduv leht) → teose lehed märgitakse
   eksemplari järgi („lk 7 = eksemplar B").

Kirjeid tuleb juurde, transkribeeritavaid tekste mitte.

## Andmemudel

Teos (olemas) → **eksemplar** → **vaatlus**; **vorm** on register, mis koondab vaatlusi eri
eksemplaridest ja teostest, ka käsikirjadest. Teose tekst ja paber ei puutu otse kokku.
Teosel on 0…n eksemplari, neist kuni üks kinnitatud tekstitunnistaja (lehtedeta või
migreerimata teosel võib see puududa); vaatlus kuulub alati ühele eksemplarile.

| Kiht | Kirjeldab | Põhiväljad |
|---|---|---|
| Eksemplar | üks füüsiline eksemplar | hoidja, kohaviit, tekstitunnistaja j/e, lehed (kui digiteeritud), väline digikoopia, seisund, tüpograafia, köide (kaaned, köitmisviis), provenients, konvoluut + järjekoht, märkus, pildid |
| Vaatlus | üks vesimärgitüüp (või vesimärgita paber) ühes eksemplaris, üks või mitu asukohta | asukoht (`locus` + valikulised lehetüved, vt allpool), IPH klassid, kirjeldus, tekst vesimärgil, paigutus, poogna mõõt, ahel- ja ribijooned, paberi tüüp ja kvaliteet, sõel, äär, fotod, kommentaar |
| Vorm | paberivorm, mille jälg vesimärk on | nimi, kirjeldus, kaksikvorm, veski/paberitegija, viited ([Bernstein][bernstein], [WZIS][wzis], [Briquet][briquet]), seotud vaatlused kindlusastmega |

- IPH põhiklassid (A…Z) on valikloend, mitte vaba tekst. Väljade loend tuleb paber.ut.ee-st ja on
  lahti.
- Paberi üldandmed (veržee, sõel, äär, mõõt) korduvad paber.ut.ee-s igal vaatlusel; uues mudelis
  eksemplari tasemel, vaatlusel ainult erinevuse korral.
- **Eksemplar kasvab välja `archive_refs`-ist** (ül. §1). Teose väli `archive_refs`
  (`{archive_id, reference, url}`, hoidjad `archives.json`-is, otsitav `archive_refs_text`) on
  juba hoidja + kohaviit + digikoopia. Paralleelset tõeallikat EI looda.
  - **`exemplars` on autoriteetne, `archive_refs` tuletatud** (jk. §1): `clean_archive_refs` ja
    kliendi `cleanArchiveRefs` ehitavad kirje uuesti kolmest väljast, nii et lisaväljad
    (`id`, `is_text_witness`, tüved) kaoksid iga tavalise metaandmete salvestusega. `exemplars`
    muutub AINULT oma otspunktidega; `archive_refs` jääb ühilduvuskujuks ilma sõltumatu
    kirjutajata. Migratsioon katab ka lugejad (hoidja kasutuse kontroll, `meili_doc`).
  - **Kirje ≠ eksemplar automaatselt** (jk. §2): üks eksemplar võib kanda mitut viidet (ADA teeb
    igast `dc.identifier.other`-ist eraldi kirje). Eksemplaril on **püsiv ID**, mida kohaviida
    parandus ei muuda; migratsioon säilitab algse viite ja päritolu, ebaselge vastavus läheb
    ülevaatusele. Esimest viidet EI valita automaatselt tekstitunnistajaks — kontrollimata seos
    võib jääda määramata; kinnitatud vaikimisi tekstitunnistajaid on teose kohta kuni üks.
  - Käsikirjal on `archive_refs` praegu tavaliselt tema ainus eksemplar.
- **Lehtede seos eksemplariga käib lehetüvede kaudu** (ül. §5), nagu teose osadel: vaikimisi kõik
  lehed tekstitunnistajale, ainult reegli 5 erand salvestab tüved ja saab `sync_work_parts`-i
  eeskujul ümberarvutuse `refresh_work_mentions` ahelas (ADR 0055). **Vaatlustel on teised reeglid
  kui osadel** (jk. §3–4):
  - Tüvi on digitaalne lehekoht, mitte füüsilise allika tõend. `replace-image` kirjutab uue pildi
    sama failinime peale (`7zot7j` Uppsala → Tartu oli just see) — asendusel eristada sama
    eksemplari uut skaneeringut ja teise eksemplari lehte; seotud vaatlused ülevaatusele.
  - Poolitus: eksemplari päritolu pärandub mõlemale poolele; vaatluse leheviide remapitakse
    kandidaatidena mõlemale, täpne pool märgitakse kontrollimist vajavaks (vesimärk on ühel poolel).
  - Lehe kustutus/asendus EI kustuta vaatlust, eksemplariseost ega `locus`-t — kehtetuks läheb
    ainult digitaalne leheviide. Vaikimisi tekstitunnistaja vahetus vajab oma reeglit.
- **Pildid `_`-prefiksiga alamkausta** (`_exemplars/…`, `_watermarks/…`, ül. §4): juurkausta pilt
  loetakse teose leheks; pildiserver (`server/image_server.py`) lubab praegu alamkaustadest ainult
  `_thumbs/` ja vajab laiendust sama ligipääsukontrolli all.
- **Eksemplarid `_metadata.json`-is oma otspunktiga** (`/works/{id}/exemplars`, nagu `parts`);
  **vaatlused eraldi failis** (nt `_watermarks.json`), et poolik arhiivisalvestus ei käivitaks
  teose täisteksti Meili-sünki (ül. §6). Korpuseülene vaade (töövoo p. 5) vajab siis tuletatud
  read-modelit (ADR 0007).
- Variandiseos (reegel 4) on **töös** (#701, [ADR 0075](../../decisions/0075-teoste-seos-uks-kirjutustee-vastastikune.md),
  2026-11-01): ainus kirjutustee `PUT /works/{id}/relations`, vastastikune ühe commitiga,
  kuvamine infopaneelil ja teosekaardil. Konvoluut tuleb samasse kuvamisse (#702).
- **Agent täidab** eksemplarid, konvoluudid ja seosed ESTERist ootel ettepanekutena (#703; osa 1 —
  MCP `get_work` annab `ester_id` + `archive_refs` — tehtud). Seetõttu peavad eksemplari väljad
  olema struktureeritud ja kandma allikaviidet.
- **Konvoluut** (mitu trükist ühes köites) on **eksemplari väli**, mitte oma kirje: `convolute =
  {reference, position (0 = põhiteos, N = N. kaasköide), total, contents}`; samas köites olevad
  trükised tuletatakse (sama hoidja + normaliseeritud konvoluudi kohaviit, „(I)" jääb võtmesse).
  Fakt „13 trükist" on number, sisukord vabatekst — VUTT-is puuduv trükis ei saa tühja kirjet.
  ESTER näitab konvoluuti ainult eksemplari märkuses (TÜR R Est.B-954: Fischer b2648642 põhiteos,
  *Personalia* b4346241 1. kaasköide; R Est.B-954 (I) on teine köide samade trükistega) — sama
  raamatukogu võib hoida sama trükist kahes konvoluudis, seega kuulub konvoluut eksemplarile.
  VUTT-is `xzy2ee` = need kaks kirjet ühe teosena. Enne eksemplari kihti saab ploki tuletada
  `archive_refs`-ist. Issue #702.
- „Köide" = köitmine (kaaned, köitmisviis), eksemplari väli; „konvoluut" = samas köites trükised.
- Hoidjatel (`archives.json`) võiks olla ISIL-kood (`EE-…`, `LV-…`, `SE-…`) — sobitus ESTERi,
  paber.ut.ee ja Bernsteiniga; ESTERi kirje number on teosel juba olemas (`ester_id`).
- Vormiregister võtab ADR 0059-st tehnilise mustri (VUTT-i võti, lukk, `save_config_with_git`),
  aga mitte skeemi — vormil ei ole Q-koodi ega tõlgitavat silti (ül. §7).
- Ehitada saab olemasoleva peale: teose osad ([ADR 0057](../../decisions/0057-teose-osad.md)), ameti- ja
  asutuseregister ([ADR 0059](../../decisions/0059-ameti-ja-asutusregistri-voti.md)).

## Näide: paber.ut.ee eksemplar 7 = `7zot7j`

[Eksemplar 7][eks7] on VUTT-is teos [`7zot7j`][7zot7j] (Skragge/Beutherus, *De Messia Judaico*,
1692). Kohaviit on sama → sobitub automaatselt.

- **Teos** jääb nagu on: tekst, isikud, 25 lehte.
- **Eksemplar A** (tekstitunnistaja, lehed 1–25): Tartu Ülikooli Raamatukogu, R Bergm. 357(8);
  seisund 3 (kahjustatud); antiikva, ehisliistud, ehisinitsiaalid S W; Jaanson 946; DSpace
  [10062/25368][dspace].
- **Eksemplarid B, C…** (ainult kirjed, leidumuse järgi): Kungliga biblioteket, Uppsala UB,
  Latvijas Akadēmiskā bibliotēka.
- **Vaatlused eksemplaril A** (6, paber.ut.ee numbritega):

| Nr | Poogen | IPH | Kirjeldus | Ahel / ribi | Seos |
|---|---|---|---|---|---|
| 7/1 | a2, a3 | A, W, Y | kaks seisvat figuuri, tõrvik, tekst ovaalis | 22–23 / 10–11 | — |
| 7/2 | a4 | Z | defineerimatu | — | — |
| 7/3 | b2 | A, R, T | tagurpidi süda vapikilbil, kroon | — / 13–14 | võib olla 7/4 ülemine osa |
| 7/4 | b3 | G, T | vapikilp, liilia | — / 13–14 | võib olla 7/3 alumine osa |
| 7/5 | c2, c3, d, e2, f3 | N, R, T, W | ristatud haamrid?, C ? M vapikilbil, kroon | — | vrd 502/1, ilmselt sama paber |
| 7/6 | c4, d2 | O | postisarv | 26 / — | vrd 502/2, sarnane, mitte identne |

Seos „vrd 502/1, ilmselt sama paber" on täpselt see, mida vormiregister struktureeriks: 7/5 ja
502/1 ühe vormi alla kindlusastmega „tõenäoline". Import toob vabateksti kommentaarina, uurija teeb
läbivaatusel seoseks.

**Esimene juhtum tehtud:** `7zot7j` pildid vahetati 2026-10-19 Tartu R Bergm. 357(8) skaneeringu
vastu. Vana (Uppsala UB eksemplari kseroks, 25 faili) on serveris
`data/._trash/7zot7j/replaced_images/`, märge teose notes'is → eksemplari kihi tulekul Uppsala
eksemplari kirje pildid.

## Töövoog (vesimärkide uurija)

1. **Leia teos** otsingust. Puudub (nt digiteerimata käsikiri) → bibliograafiline kirje ilma lehtedeta.
2. **Vali või loo eksemplar** (hoidja + kohaviit). Digiteeritud eksemplar on juba olemas.
3. **Lisa vaatlus:** fotod (läbiv valgus, mitu vaadet), IPH klassid, mõõdud, asukoht.
4. **Seo vormiga**, kui tuvastab (olemasolev või uus, kindlusaste) — võib ka hiljem.
5. **Korpuseülene vaade:** sama IPH klass, ühe vormi vaatlused ajateljel, ühe trükkali paberid.

Töö käib raamatukogudes ja arhiivides → vaatlus salvestub ka poolikuna. Teose transkriptsiooni see
ei puuduta.

## Mida see annab peale paberiuurimise

- **Mida me transkribeerime:** hoidja ja kohaviit väljades, mitte pealkirja sabas.
- **Variandid ja pühendused:** erineva pühendusega või muudetud loengukavaga eksemplaridel on nimi ja koht.
- **Leidumus** otsitavaks ja lingitavaks.
- **Käsikirjade paber** aitab dateerida ja käsi tuvastada; sama vorm trükises ja käsikirjas seob need.
- **Trükikoja ajalugu:** kust Pistorius, Brendeken jt paberit said — [Lepp 2014][lepp2014] küsimus
  kogu korpuse ulatuses.

## paber.ut.ee: staatiline arhiiv ja import

Uusi andmeid vanale lehele ei lisata; arhiveerimine ei oota VUTT-i muudatusi.

1. **Ülevõtmine:** 522 detaillehte + vesimärgikirjed + pildid (täissuurus + pisipilt); ka
   Raamatukahjustuste osa, kui samas süsteemis.
2. **Staatiline koopia samade URL-idega** — lingid Bernsteini portaalist (EEP) ja artiklitest jäävad tööle.
3. **Masinloetav andmestik** (tabelid + pildid) püsiarhiivi (DataDOI / DSpace) — viidatav ja ühtlasi
   impordi allikas.
4. **Bernsteini XML-eksport:** paber.ut.ee moodul ei ole aastaid töötanud → parandada, esialgu
   arhiveeritud andmestiku, hiljem VUTT-i andmete põhjal.
5. **Import VUTT-i** alles siis, kui eksemplari ja vaatluse mudel on olemas. Sobitus kohaviida,
   Jaansoni numbri ja DSpace'i viite järgi; proov 7 → `7zot7j` õnnestus, automaatse sobituse osakaal
   kontrollimata.

Pärast importi viitab staatiline leht igal eksemplaril VUTT-i kirjele.

## Etapid

Iga etapp on iseseisvalt kasulik. Seni jätkub töö märkmetes — nende struktuur võiks juba järgida
paber.ut.ee välju.

1. **Arhiiv** — ülevõtmine, staatiline koopia, andmestik püsiarhiivi. Sõltumatu, ~paar päeva.
2. **Eksemplari kiht** — eksemplari kirje teose juures, tekstitunnistaja märge, lehtede seos
   eksemplariga (reegel 5). Kasulik ka ilma paberiuurimiseta. **Tehtud** (ADR 0076, 0079).
3. **Vaatlused** — vaatluse vorm, fotod, IPH sõnastik, paneel „Paber" teose lehel; paber.ut.ee
   import. Siit alates uued vaatlused VUTT-i.
4. **Seotud vesimärgid ja korpuseülene vaade** — uurija vastuse järgi (K6) vormiregistrit ei
   tehta: piisab vaatlus → vaatlus viitest „seotud vesimärk" + märkmelahtrist; korpuseülene vaade
   vesimärgi nimetuse/kujundi ja aasta järgi (K10).

Etappide 3–4 maht hindamata.

## Otsustatud

- Kõik fotod avalikuks. **Vesimärgid (vaatlused) on samuti kohe avalikud** (uurija, K8):
  nähtavus = teose nähtavus, peidetud olekut ei ole.
- 5Dvisioniga tuleb suhelda (leping, ekspordimoodul).
- **Kuvamine (2026-11-03):** infopaneelil on eksemplaride kaardid AINULT lühiinfoga (hoidja,
  kohaviit, link, erandlehed, koopia liik); transkriptsiooni alus on esimene, rea lõpus pill, raamideta read.
  Paber ja vaatlused tulevad eraldi vahekaardile „Paber", mitte kaardile. Kasutajaliidese
  nimetus „tekstitunnistaja" asemel on „transkriptsiooni alus" (väli jääb `text_witness`).
- **Ettepanek: vaatlusel on oma asukohaväli** (`locus`, vabatekst: `a2, a3`, `a4`, `c4, d2`, `fol. 10`,
  `eesleht`) + valikulised VUTT-i lehetüved, kui vaatlus on tekstitunnistajal. *Muudetud
  2026-10-31* (ül. §2): varasem ettepanek „asukoht = VUTT-i üldine viitamisviis tägidest, eraldi
  välja pole vaja" ei pea — lehe aadress ([ADR 0070](../../decisions/0070-lehe-tahistus-ja-lehe-aadress.md),
  `server/page_address.py`) töötab ainult käsikirjadel; trükisel ei ole signatuuri igal poogna
  lehel (`a4`), toores leht on `<sig>`-tägita, eksemplare B/C ei transkribeerita, eeslehel
  tähist pole.

## Uurija vastused (2026-11)

Allikas: doktorandile tehtud lugejaversioon [„Vesimärgid ja eksemplarid VUTT-is"](https://claude.ai/artifact/LnzMS7D2ud6h7FnLBTHZu5)
(küsimuste tabel, vastused novembris; lühikokkuvõte ka
[eksemplari lehe disainis](2026-11-10-eksemplari-leht-design.md#uurija-vastustest-paberi-töö-jaoks-ei-kuulu-sellesse-töösse)).
Uurija vastus on tsitaadina, tagajärg on meie tõlgendus.

| K | Küsimus | Vastus | Tagajärg |
|---|---|---|---|
| 1 | Kas plaan tervikuna sobib? | „Ok" | — |
| 2 | Praeguste märkmete kuju ja maht | „Pole" | Esimene andmestik on paber.ut.ee import (522 eksemplari). Märkmete ülekannet ei ole. |
| 3 | Üks vaatlus = üks vesimärgitüüp mitme asukohaga? | „OK" | Mudel jääb: üks vaatlus, `locus` loetleb asukohad (7/5: `c2, c3, d, e2, f3`). Fotot/mõõtu iga esinemise kohta eraldi ei nõuta. |
| 4 | Paberi üldandmed eksemplaril; tühi väli vaatlusel = „sama" või „ei mõõdetud"? | „Oleks vaja lisada trükise formaat. Paberi mõõdud jäävad" | Uus väli: **trükise formaat**. Tühja välja tähendus jäi vastamata — meie otsus (vt Vastuolud p 3). |
| 5 | Fotode tegemine | „tagantvalgusega, jpg" | Üks fotoliik (läbiv valgus), JPG; valgustuse/skaala välja ei ole vaja. |
| 6 | „Sama vorm" / „kaksikvorm" / „sama partii"; kindlusastmed | „oleks hea, kui saaks teha viite: seotud vesimärk. Lisaks jääb märkmelahter" | **Vormiregistrit ei tehta.** Vaatlus → vaatlus viide „seotud vesimärk" (ka teise teose vaatlusele) + vaba märkus. Seoseliike ega kindlusastmeid ei ole. Import toob „vrd 502/1" märkusena, uurija teeb viiteks. |
| 7 | IPH põhiklassid või alamklassid? Bernstein/WZIS? | „Pigem eelistaks puud. Mõtlen veel selle peale!" | IPH **puuna** (alamklassid). Lõplik vastus ootel; Bernsteini/WZIS-i viitele vastust ei ole. |
| 8 | Kas vesimärgid võivad olla kohe avalikud? | „JAH" | Nähtavus = teose nähtavus. Peidetud olekut, eraldi õigust ega pildiserveri kontrolli ei tule. |
| 9 | Kes lisab vaatlusi? | „lisada saab ehk ka hiljem, kui on vaja" | Uut rolli/õigust praegu ei tule — kehtib olemasolev `can_write_work`. |
| 10 | Milliseid võrdlusi teed? | „Vesimärgi nimetuse/kujundi järgi. Aasta ka" | Korpuseülene vaade: vesimärgi nimetus/kujund + aasta. Mitte poogna, trükikoja ega paberitegija järgi. |
| 11 | Olulised katalooginumbrid | „ESTER" | Sobitus käib ESTERi järgi (`ester_id` teosel olemas). Struktureeritud Jaansoni/VD17 välja ei tehta. |
| 12 | Mis paber.ut.ee-st peab säilima? | „vesimärgi sõnaline kirjeldus / kommentaari lahter" | Mõlemad on vaatluse väljad ja import toob need üle. |
| 13 | Kas arhiveerimisel saab teha paber.ut.ee → VUTT edasisuunamise, mis see maksab? | „Mel uurib IT-lt" | Ootel. Mõjutab etapi 1 arhiveerimise kohta. |

Lisaks (eksemplari lehe arutelust): **vaatlus eeldab teost VUTT-is** — eraldi paberilehti ei
peeta, paber.ut.ee jääb staatiliseks arhiiviks. Impordis lähevad vasteta eksemplarid
ülevaatusnimekirja ja ootavad teose üleslaadimist. Vaatluste leheviited vajavad sama
sünkroonireeglit nagu pildipaarid (poolitus, kustutus).

## Lahtised küsimused

Vastatud ja vastuste tõttu ära langenud (vt tabel ülal): märkmete kuju (K2), fotod (K5),
seoseliigid ja kindlusastmed (K6), nähtavus (K8), kes lisab (K9), katalooginumbrid (K11),
**lehtedeta teos** (vaatlus eeldab teost; vasteta → ülevaatusnimekiri). Ajaloo jaoks: lehtedeta
teose probleem oli `build_work_documents` tagastab 0 pildiga teosele `[]` ja avalehe otsing
filtreerib `lehekylje_number = 1` (ül. §3, jk. §5) — kui seda kunagi siiski vaja läheb, on
see terviklik töö, mitte „leht 0".

Alles:

- **IPH puu** (K7) — uurija mõtleb; kas ka Bernsteini/WZIS-i viited struktureeritult.
- **Arhiveerimise koht ja edasisuunamine** (K13) — VUTT-i server või ÜR veebimajutus; IT vastus ootel.
- **Vaatluste korpuseülene indeks:** tuletatud JSON read-model või Meili? Mis jõuab MCP-sse?
  Võrdluse kuju on nüüd teada (nimetus/kujund + aasta, K10).
- **Impordi korduskäivitus** ei tohi tekitada duplikaate: allika nimeruumiga ID (nt
  `paber:7/5`) ja allikast imporditud väärtused eristatavad uurija hilisematest parandustest (jk.).
- Kolm disainiotsust allpool (Vastuolud p 1–3).

## Eksemplari lehe arutelust (2026-11-09): paber

Allikas: eksemplari lehe arutelu 09.11 (haru `docs/eksemplarid-vahekaart-arutelu`, commit
`e0890b31`, haru kustutatud 2026-11-14). Eksemplari lehe enda osa on üle läinud
[eksemplari lehe disaini](2026-11-10-eksemplari-leht-design.md) (10.11); siia on tõstetud ainult
paberi osa, mida mujal ei ole. Need on **töö käigus uuesti vaadatavad** — mitte lõplikud otsused.

### Kasutaja 09.11 otsused (paberit puudutavad)

- **Paberiinfo toimetamine on eksemplari kirje „Muuda"-st eraldi.** „Muuda" muudab ainult
  eksemplari kirjet (`_metadata.json` `exemplars[]`). Paberiinfot toimetatakse PABER-vahekaardil
  kaardi kaupa: „Paberi üldandmed" oma „Muuda", igal vesimärgikaardil oma „Muuda", „＋ Lisa
  vaatlus". Põhjused: eri hoidla (vaatlused oma failis, poolik salvestus ei käivita Meili sünki),
  eri töövoog (raamatukogus/arhiivis järk-järgult vs ESTERist agendi täidetud kirje), lahtised
  õigused/nähtavus, paber.ut.ee import kirjutab ainult paberiandmeid.
- **PABER-vahekaardi sisu:** kaart „Paberi üldandmed" (veržee, sõel, äär, poogna mõõt) + kaart
  „Vesimärgid", kus iga vaatlus on rida nagu paber.ut.ee-s (nr · fotod · asukoht + lehelingid,
  IPH sildid, kirjeldus, tekst, paigutus, ahel/ribi, kvaliteet, seos „vrd 502/1").
- **Kõrvutus arvestab alati paberiga:**
  - kõrvutatakse **eksemplari eksemplariga** — teose lehed on ühe eksemplari (transkriptsiooni
    alus) skaneering ja sel on oma paber;
  - **teose-lehe poole eksemplar tuleb lehest**, mitte vaikimisi teosest: erandleht („lk 7 =
    eksemplar B", reegel 5) näitab eksemplari B nime ja paberit; ka `replace-image` võib lehe
    taga eksemplari vahetada (`7zot7j` Uppsala → Tartu);
  - mõlemal poolel paberipaneel; lehega seotud vaatlus (kui seos on) tõstetakse esile,
    ülejäänud on eksemplari omad.
- **Vesimärgid on teose lehtedest ja piltide paaridest täiesti eraldi.** Vesimärk on poognal, mitte
  igal lehel: asukoht on `locus` (signatuur: a2, a3), seos teose lehega on **valikuline**. Fotod
  kuuluvad vaatlusele, mitte eksemplari piltide hulka (`images.json`) ega paaridesse;
  PILDID-võrgus vesimärgimärki ei ole. Paar = eksemplari pilt ↔ teose leht, ainult
  reproduktsioonidele.

Mockupid (git-ignored, ainult arendusmasinas):
`.superpowers/brainstorm/1845782-1794239506/content/eksemplari-leht-v3-grupid.html` (PABER-vahekaart,
vaatluse kaart) ja `korvutus-v3.html` (paberipaneel kõrvutuses).

### Vastuolud — arutada enne paberi tööd

Punktid 1–3 on disainiotsused (uurija vastustest ei tulene); punkt 4 on lahendatud.

1. **Kus elavad vesimärgifotod?**
   - 09.11: fotod kuuluvad **vaatlusele**, eksemplari pildikogust (`images.json`) eraldi.
   - [ADR 0079](../../decisions/0079-eksemplari-pildid.md) (rida 111): vaatlused viitavad
     järgmises etapis eksemplari piltide **`image_id`-dele**; eksemplari lehe disain (10.11, „Koht
     paberile"): „vaatlus viitab eksemplari piltidele, pildile saab hiljem lisada liigi ilma
     migratsioonita".
   - Siin (Andmemudel): pildid `_watermarks/…` alamkaustas — kolmas variant, eraldi kaust, aga
     viitamisviis lahtine.
   - Mõju: kas vesimärgifoto ilmub eksemplari PILDID-võrku, kas ta saab olla paar, kuidas
     paber.ut.ee import fotod paigutab, kas pildiserver vajab uut alamkausta.
2. **Kõrvutuse paberipaneel: kohustuslik või hilisem?**
   - 09.11: „kõrvutus arvestab **alati** paberiinfoga", paneel mõlemal poolel.
   - Eksemplari lehe disain (10.11, Mitte-eesmärgid): „paberipaneel kõrvutuses" on mitte-eesmärk.
     See kehtib eksemplari lehe tööle; küsimus on, kas paberi töö PEAB selle tooma ja kas
     kõrvutuse teose-lehe poole eksemplar tuleb lehest (erandleht, `replace-image`).
3. **Paberi üldandmete koht.**
   - Siin (Andmemudel): „eksemplari tasemel, vaatlusel ainult erinevuse korral".
   - 09.11 ettepanek (kasutaja ei kinnitanud): tase on eksemplar, aga **fail** on paberifail
     (`_watermarks.json` või sarnane), mitte `exemplars[]` väljad — kogu paberiinfo elab koos,
     eksemplari kirje jääb puhtaks ja eraldi toimetamine (vt ülal) vastab eraldi hoidlale.
   - Uurija (K4) lisas välja **trükise formaat** ja kinnitas, et paberi mõõdud jäävad; küsimusele,
     kas vaatluse tühi väli tähendab „sama mis eksemplaril" või „ei mõõdetud", vastust ei tulnud.
4. **Nähtavus kui eraldi toimetamise põhjus.** — **Lahendatud** (K8).
   - 09.11: üks põhjus paberi eraldi toimetamiseks on „lahtised õigused/nähtavus (doktoritöö)".
   - Uurija vastus (eksemplari lehe disain, „Uurija vastustest"): vesimärgid on **kohe avalikud**,
     nähtavus = teose nähtavus, peidetud olekut ei ole. Siis langeb see põhjus ära (ülejäänud
     kolm jäävad). Lahtiste küsimuste „Nähtavus ja õigused" punkt on sellega suletud.

## Viited

- [paber.ut.ee — Eesti varajased trükised, vesimärgid][paber]; [eksemplar 7][eks7]
- [IPH — International Standard for the Registration of Paper with or without Watermarks, Norm 2.1.1][iph]
- [Bernstein — The Memory of Paper][bernstein]; [WZIS — Wasserzeichen-Informationssystem][wzis]; [Briquet Online][briquet]
- Lepp, Anu. [„The first year of the Academia Gustaviana print shop as seen through the history of paper"][lepp2014]. *Ajalooline Ajakiri* 2014, nr 1.
- `7zot7j` digikoopia DSpace'is: [10062/25368][dspace]
- VUTT: [`7zot7j`][7zot7j], [`nri7ga`][nri7ga]

[paber]: https://paber.ut.ee/ET/vesimargid/tutvustus
[eks7]: https://paber.ut.ee/ET/vesimargid/eksemplar/7
[iph]: https://www.paperhistory.org/Standards/
[bernstein]: https://www.memoryofpaper.eu/
[wzis]: https://www.wasserzeichen-online.de/
[briquet]: https://briquet-online.at/
[lepp2014]: https://ojs.utlib.ee/index.php/EAA/article/view/AA.2014.1.04
[dspace]: http://hdl.handle.net/10062/25368
[7zot7j]: https://vutt.utlib.ut.ee/work/7zot7j
[nri7ga]: https://vutt.utlib.ut.ee/work/nri7ga/1
