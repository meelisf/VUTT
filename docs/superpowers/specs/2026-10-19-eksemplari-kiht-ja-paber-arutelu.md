# Eksemplari kiht ja paber.ut.ee vesimärgid — arutelu

**Seis:** arutelu alus, mitte otsus (2026-10-19, tihendatud 2026-10-31). Issue [#696](https://github.com/meelisf/VUTT/issues/696).
ADR kirjutamata — tuleb enne etappi 2. Koodibaasi vastu kontrollitud:
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
- [`nri7ga`][nri7ga] — lk 1 ja lk 2 on eri eksemplarid, andmed seda ei ütle.

## Reegel: teosel kuni üks tekstitunnistaja

1. Transkribeeritakse üht eksemplari teose kohta; selle skaneering on teose lehed (nagu praegu).
2. Teised eksemplarid (digiteeritud või mitte) on **kirjed**: teksti ei transkribeerita; kirjel
   võib olla link välisele digikoopiale ja oma pildid (vesimärgid, erinev pühendusleht, köide).
3. Ühe lehe kaupa erinev eksemplar → leht eksemplari kirje juurde pildina, soovi korral
   transkriptsiooniga.
4. Sisuliselt erinev eksemplar → eraldi teos seosega „sama väljaanne, variant" (toimetaja otsus).
5. `nri7ga`-juhtum → teose lehed märgitakse eksemplari järgi („lk 2 = eksemplar B").

Kirjeid tuleb juurde, transkribeeritavaid tekste mitte.

## Andmemudel

Teos (olemas) → **eksemplar** → **vaatlus**; **vorm** on register, mis koondab vaatlusi eri
eksemplaridest ja teostest, ka käsikirjadest. Teose tekst ja paber ei puutu otse kokku.
Teosel on 0…n eksemplari, neist kuni üks kinnitatud tekstitunnistaja (lehtedeta või
migreerimata teosel võib see puududa); vaatlus kuulub alati ühele eksemplarile.

| Kiht | Kirjeldab | Põhiväljad |
|---|---|---|
| Eksemplar | üks füüsiline eksemplar | hoidja, kohaviit, tekstitunnistaja j/e, lehed (kui digiteeritud), väline digikoopia, seisund, tüpograafia, provenients, märkus, pildid |
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
  lehed tekstitunnistajale, ainult `nri7ga`-tüüpi erand salvestab tüved ja saab `sync_work_parts`-i
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
- Variandiseos (reegel 4) on olemas: `Relation.rel_type = 'isVersionOf'`.
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
   eksemplariga (`nri7ga`). Kasulik ka ilma paberiuurimiseta.
3. **Vaatlused** — vaatluse vorm, fotod, IPH sõnastik, paneel „Paber" teose lehel; paber.ut.ee
   import. Siit alates uued vaatlused VUTT-i.
4. **Vormiregister** — vormid, seosed kindlusastmega, korpuseülene vaade. Kuju tuleb uurija praktikast.

Etappide 2–4 maht hindamata.

## Otsustatud

- Kõik fotod avalikuks.
- 5Dvisioniga tuleb suhelda (leping, ekspordimoodul).
- **Ettepanek: vaatlusel on oma asukohaväli** (`locus`, vabatekst: `a2, a3`, `a4`, `c4, d2`, `fol. 10`,
  `eesleht`) + valikulised VUTT-i lehetüved, kui vaatlus on tekstitunnistajal. *Muudetud
  2026-10-31* (ül. §2): varasem ettepanek „asukoht = VUTT-i üldine viitamisviis tägidest, eraldi
  välja pole vaja" ei pea — lehe aadress ([ADR 0070](../../decisions/0070-lehe-tahistus-ja-lehe-aadress.md),
  `server/page_address.py`) töötab ainult käsikirjadel; trükisel ei ole signatuuri igal poogna
  lehel (`a4`), toores leht on `<sig>`-tägita, eksemplare B/C ei transkribeerita, eeslehel
  tähist pole.

## Lahtised küsimused

- Praeguste märkmete kuju ja maht; kas katavad paber.ut.ee välju (beta-radiograafia, täpsemad mõõdud)?
- Fotode tegemine (läbiv valgus, skaala, resolutsioon)?
- „Sama vorm", „kaksikvorm", „sama paberipartii" — eri seosed? Mitu kindlusastet?
- IPH: põhiklassid (A…Z) või ka alamklassid? Bernsteini / WZIS-i viited?
- Vesimärgid avalikud kohe või pärast avaldamist (doktoritöö prioriteet)?
- Kes lisavad vaatlusi — projekti uurijad või ka teised paberiajaloolased (uus õigus)?
- Arhiveerimine VUTT-i serveris või ÜR-i veebimajutuses?
- **Lehtedeta teos** (töövoo p. 1, ül. §3, jk. §5): `build_work_documents` tagastab 0 pildiga
  teosele `[]` ja sünk kustutab ka vanad lehe- ja kirjadokumendid → teost ei ole Meilis ega
  töölaual. Sünteetiline „leht 0" üksi EI aita: avalehe otsing ja teosepõhised loendurid
  filtreerivad `lehekylje_number = 1` (`src/services/searchService.ts`). Terviklik töö: loomine,
  indekseerimine (kuidas teose kirje lehedokumendist eristub), leidmine, avamine
  eksemplaride vaates, kaanepildi puudumine, loendurid/statistika. Vajadus selgub sobitusraportist.
- **Vaatluste korpuseülene indeks:** kas tuletatud JSON read-model või Meili? Mis jõuab MCP-sse?
- **Nähtavus ja õigused:** kuidas vaatlus enne doktoritöö ilmumist peidetakse ja kes lisab —
  seosta olemasoleva mudeliga (`can_write_work`, ADR 0031; kogu nähtavus, ADR 0069), mitte uus
  paralleelne kontroll. **Teose õigus ei piisa** (jk. §6): `can_read_work` ja pildiserver
  lubavad avaliku teose kõigile, seega avaldamiseelne vaatlus vajab oma nähtavust API-s, indeksis
  ja MCP-s. **Vastuolu:** „kõik fotod avalikuks" (Otsustatud) ja peidetud vaatlus ei käi kokku —
  kui fotod peidetakse koos vaatlusega, peab seda kontrollima ka pildiserver, mitte ainult UI.
- **Katalooginumbrid** (Jaanson, VD17, ESTER, DSpace): struktureeritud väli või mitte? Vastus tuleb
  kuivkäivitusega sobitusskriptist kohe etapi 1 järel (ül. §7), enne etapi 2 ADR-i. Raport
  näitab kindlad, mitmetähenduslikud ja vasteta sobitused (jk.).
- **Impordi korduskäivitus** ei tohi tekitada duplikaate: allika nimeruumiga ID (nt
  `paber:7/5`) ja allikast imporditud väärtused eristatavad uurija hilisematest parandustest (jk.).

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
