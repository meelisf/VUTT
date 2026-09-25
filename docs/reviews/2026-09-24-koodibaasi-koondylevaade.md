# Koodibaasi koondülevaade — turvalisus, stabiilsus, jõudlus ja hallatavus

**Kuupäev:** 2026-09-24  
**Staatus:** aktiivne tööregister; ülevaatus ja soovitused, mitte paranduste teostus  
**Lähtekoodi seis ülevaatuse ajal:** `09855bdb` → `959dd078`  
**Koostaja:** Codex

See dokument on järgmise töö planeerimise lähtekoht. See koondab käesoleva
ülevaatuse leiud, varasemate ülevaatuste parandatud punktid ja veel lahendamata
või uuesti kontrollimist vajavad teemad. Vanade dokumentide prioriteediloendeid
ei tule käsitleda praeguse tööjärjekorrana.

Eelnevad allikad:

- [2026-07-09 skaleerimise ülevaade](2026-07-09-skaleerimise-ulevaade.md).
- [2026-09-15 koodibaasi ülevaade](2026-09-15-koodibaasi-ulevaade.md).
- [Tehnilise võla register](../tegemata_tood.md).
- GitHubi issue'd: seis loetud 2026-09-24 käsuga
  `gh issue list --state all --limit 180 --json number,title,state`.

**Põhihinnang:** kõige kiiremini vajavad parandamist lehesalvestuse failivalik,
piltide ligipääsukontroll ning samaaegsete lehekommentaaride salvestamine.
Arhitektuuri täielik vahetamine ei ole nende probleemide lahendamiseks vajalik.
Suurim hallatavuse võit tuleb ühistest kirjutus- ja ligipääsulepingutest ning
nende konkurentsitestidest. Jõudluse esimene siht on tarbetute täisskannide
eemaldamine, mitte workerite arvu suurendamine.

## 1. Staatuste ja tõendite tähendus

| Märge | Tähendus |
|---|---|
| **Lahtine, kinnitatud** | Praeguses koodis tuvastatud probleem; tõendi liik on leiu juures |
| **Tehtud, kood kontrollitud** | Varasemat probleemi parandav teostus on praeguses koodis olemas; ei kinnita automaatselt deploy'd |
| **Suletud GitHubis** | Issue on suletud; töö täielikkust või tootmise tulemust pole siin sõltumatult tõendatud |
| **Avatud GitHubis** | Issue on avatud; see ei tähenda, et ühtegi osa pole teostatud |
| **Vajab järelkontrolli** | Varasemast registrist üle kantud teema, mida selles ülevaatuses piisavalt uuesti ei kontrollitud |
| **Soovitus / hinnang** | Pakutud lahendus või prioriteet, mitte mõõdetud fakt ega kokkulepitud teostus |

**P1:** esmajärjekorras parandatav ligipääsu- või andmekao risk.  
**P2:** oluline töökindluse, jõudluse või kasutajaliidese probleem; järgneb P1-le.  
Prioriteet ei ole CVSS-skoor. Kinnitatud kooditee ei tähenda tõendit tegeliku
ärakasutamise ega tootmisintsidendi kohta.

## 2. Aktiivsete leidude register

Kõik kaheksa leidu olid ülevaatusel lahtised. 2026-09-24 järeltegevusena loodi
kasutaja palvel nende jaoks GitHubi issue'd #416–#423 (vastavus allpool).
Issue loomine ei tähenda paranduse teostamist. Enne töö alustamist kontrollida
värsket registrit, sest teine agent arendab samal ajal prosopograafiat.

| ID | Prioriteet | Valdkond | Leid | Tõend |
|---|---|---|---|---|
| R24-01 | P1 | Turvalisus | `/save` lubab kirjutada teose `_metadata.json`-i ja muid faile | Kood + mälus korratud kirjutuskutse |
| R24-02 | P1 | Turvalisus | Metaandmeteta pildialamkataloogide kaudu saab ligipääsukontrollist mööda | Kood + mälus korratud tee- ja õiguskontroll |
| R24-03 | P1 | Stabiilsus | Samaaegsetest kommentaarivastustest jääb alles ainult viimane | Deterministlik kahe lõimega mälukontroll |
| R24-04 | P1 | Stabiilsus | Indeksite taaste võib värske muudatuse vanema hetktõmmisega asendada | Koodist tuletatud konkurentsiolukord |
| R24-05 | P2 | Töökindlus | Metaandmete salvestus ei edasta Git-commiti ebaõnnestumist | Tagastusväärtuste kasutuse kontroll |
| R24-06 | P2 | Jõudlus | Olemasoleva kaanepildi leidmine loeb kogu teose lehemetaandmed | Kood + sünteetiline I/O-loendus |
| R24-07 | P2 | Jõudlus | Tekstisalvestus skannib tarbetult kogu teose isikumainimisi | Kutsujate ja skanni koodi kontroll |
| R24-08 | P2 | UI stabiilsus | Aegunud isikuotsingu vastus võib värske tulemuse üle kirjutada | Päringute ja Reacti sõltuvuste kontroll |
| R24-09 | P2 | Jõudlus | Isiku väikestes pildivaadetes kasutatakse täisresolutsiooniga faili | Kasutaja tähelepaneku järel kontrollitud serveri ja kliendi kood |
| R24-10 | P2 | Kasutajakogemus | Isikuloendi kordusotsing asendab senised tulemused laadimiskaartidega | Kood kontrollitud; kasutajaga kokku lepitud parandustöö |

### GitHubi tööregister

Kõik allolevad issue'd loodi 2026-09-24 avatuna. Kirjeldused sisaldavad mõju,
tõendi piire, soovitatud suunda ja valmimise kontrolli ning viitavad siinse
dokumendi R24-tunnusele. Selles etapis koodi ei parandatud.

| Leid | Issue | Staatus loomisel |
|---|---|---|
| R24-03 | [#416 Kommentaarivastuste samaaegne salvestamine](https://github.com/meelisf/VUTT/issues/416) | Avatud |
| R24-04 | [#417 Indeksite taaste ja jooksvad muudatused](https://github.com/meelisf/VUTT/issues/417) | Avatud |
| R24-05 | [#418 Metaandmete Git-commiti vea käsitlus](https://github.com/meelisf/VUTT/issues/418) | Avatud; seotud #412 punktiga 1, eraldi metaandmete skoop |
| R24-06 | [#419 Kaanepildi päringu täisskanni vältimine](https://github.com/meelisf/VUTT/issues/419) | Avatud |
| R24-07 | [#420 Isikumainimiste tarbetu kordustöö vältimine](https://github.com/meelisf/VUTT/issues/420) | Avatud |
| R24-08 | [#421 Isikuloendi aegunud päringuvastused](https://github.com/meelisf/VUTT/issues/421) | Avatud |
| R24-01 | [#422 Lehefailide valideerimine](https://github.com/meelisf/VUTT/issues/422) | **Parandatud** (PR #441, 2026-09-25; ADR 0051) |
| R24-02 | [#423 Pilditeede ühtne ligipääsukontroll](https://github.com/meelisf/VUTT/issues/423) | **Parandatud** (`5424bd01`, 2026-09-24) |
| R24-09 | [#424 Isikupildi suurusevariandid](https://github.com/meelisf/VUTT/issues/424) | Avatud; lisatud kasutaja tähelepaneku järel 2026-09-24 |
| R24-10 | [#425 Isikuloendi sujuvam uuendamine](https://github.com/meelisf/VUTT/issues/425) | Avatud; kokku lepitud 2026-09-24, sõltub #421 päringukaitsest |

**Riskide käsitlemise täpsustus (kasutaja otsus, 2026-09-24):** issue'd alustati
stabiilsusest ja jõudlusest. Turvateemad lisati neutraalsete parandustöödena,
ilma täpsete kuritarvitusnäideteta ja viitega sellele ülevaatele. Contributor'e
on vähe ning R24-01 eeldab teose kirjutamisõigust, mis vähendab praktilist
ründepinda. R24-02 piltide lugemise tee võib olla anonüümne, seega contributor'ide
arv selle mõju ei piira. Review P1 on võimaliku mõju põhine töösoovitus, mitte
väide käimasolevast intsidendist või kasutaja otsustatud erakorraline prioriteet.
Näidete väljajätmine issue'st ei ole saladuse kaitse: ülevaade ise on mõeldud
hoidlas versioonitavaks dokumendiks.

### R24-01 — lehesalvestus lubab muuta teose kaitstud faile

**Staatus:** **parandatud** PR #441-s (tootmises 2026-09-25, ADR 0051): ühine
nimeleping `server/page_paths.py` — `{tüvi}.txt`, reserveeritud `_`/`.` tüvi,
kirjutus ainult olemasolevale lehele; kehtib ka taaste- ja vastamisteedel.
Valvur: `tests/test_page_write_filename.py`. Allolev kirjeldus on
ülevaatuse-aegne seis.  
**Kood:** [editing.py](../../server/routers/editing.py), `save`, ülevaatuse ajal read 90–128.

`POST /save` kontrollib contributor'i kirjutamisõigust teosele, kuid `file_name`
puhul ainult nime mittetühjust pärast `os.path.basename`-i. Fail ei pea olema
tekstifail ega olemasolev lehekülg. Kliendi `text_content` jõuab valitud faili
`save_with_git` kaudu.

**Kontrollitud näide:** oma ulatuses muudetava teose kohta antud
`file_name: "_metadata.json"` ja tekst `{"collections":[],"shareable":true}`
jõudsid kirjutuskutsesse. Õiguskontroll ja kirjutaja olid mälukontrollis
asendatud: tegelikke õigusi, andmeid ega faile ei muudetud. Koodist kontrolliti,
et päris õiguskontroll lubab contributor'il tema ulatusse kuuluvat teost muuta.

**Mõju:** lehe muutmisõigusega kasutaja saab mööduda metaandmete adminiõigusest,
muuta teose avalikkust määravaid välju või rikkuda pildifaili. Rünne eeldab
autenditud kasutajat ja kirjutamisõigust vähemalt ühele teosele; see ei anna
iseenesest kirjutusõigust suvalise teose juurde.

**Soovitus:** üks valideerija, mis lahendab lubatud lehe ja selle `.txt`/`.json`
failipaari. Nõuda lehetekstile sobivat laiendit, keelata reserveeritud nimed,
kontrollida ka tuletatud JSON-tee lubatavust ning otsustada selgelt, kas
salvestus tohib uut lehte luua. Ainult `.txt` kontroll pole piisav:
`_metadata.txt` kõrvalfailiks võib muidu saada `_metadata.json`.

**Valmimise kontroll:** contributor'i lubatud lehesalvestus töötab; katsed
kirjutada `_metadata.json`, `_metadata.txt`, pildifaili või muud reserveeritud
faili lükatakse tagasi enne kirjutamist; sama kontroll kehtib taastamise ja
muude lehekirjutuste sobivates teedes.

### R24-02 — pildiserver lubab ligipääsu metaandmete puudumisel

**Staatus:** **parandatud** #423-s (`5424bd01`, tootmises 2026-09-25): puuduv või
vigane meta keelab, `_`/`.` algusega ja sisemised teed on keelatud, kõik pilditeed
läbivad sama teose õiguskontrolli. Valvur: `tests/test_image_access_http.py`
(`test_existing_internal_and_cached_cover_files_cannot_bypass_access`,
`test_missing_or_malformed_metadata_denied_even_with_token`). Allolev kirjeldus on
ülevaatuse-aegne seis.  
**Kood:** [image_server.py](../../server/image_server.py), `_load_work_meta_for_path`,
`_check_image_access`, `do_GET`, `translate_path` (read 44–80, 424–439, 563–586);
[nginx.host.conf](../../nginx.host.conf), `/api/images/`.

`_check_image_access` tagastab `True`, kui `meta is None`. Metaandmeid otsitakse
pildi vahetust vanemkataloogist. Üldine pilditee kontroll nõuab ainult lubatud
laiendit ja paiknemist `BASE_DIR` sees.

Probleem ei vaja katkist teose metaandmefaili: `._originals/{work_id}/page.jpg`
ja `_thumbs/_cover_…jpg` kõrval pole tavaliselt `_metadata.json`-i. Kaanepildi
otsene failitee ei lähe `_thumb_` prefiksiga lehepisipildi erikäsitlusse.
Olemasoleva faili korral võib üldine tee selle tokenita välja anda.

**Mälukontrolli tulemus:** originaalipildi tee jäi lubatud juurkausta sisse,
laiendikontroll tagastas `True` ning puuduv meta lubas anonüümse päringu.
Repos olev nginx-konfiguratsioon ei sulge seda alamteed. Tootmise nginx-i ega
päris piiratud pilte ei küsitud.

**Soovitus:** siduda iga serveeritav pilt teose autoriteetsete metaandmetega;
keelata sisemiste kataloogide üldine serveerimine; puuduva või vigase meta
korral keelduda. Kontrollida ka `HEAD` käsitlust ja õigusi arvestavat cache-poliitikat
sama paranduse ulatuses, ilma neid selles dokumendis eraldi kinnitatud lekkeks lugemata.

**Valmimise kontroll:** anonüümne klient ei saa piiratud teose originaali,
kaant ega pisipilti otsefaili kaudu; tokeniga lubatud tee töötab; avalikud
teosed säilivad; puuduv/vigane meta ei muuda teost avalikuks.

### R24-03 — kommentaaride read-modify-write ei ole tervikuna kaitstud

**Staatus:** lahtine, kinnitatud.  
**Kood:** [notifications.py](../../server/routers/notifications.py),
`_apply_reply_sync`, read 53–93; seotud kirjutused
[editing.py](../../server/routers/editing.py), `save` ja `page_comments_restore`.

Kaks vastamist võivad lugeda sama kommentaariloendi, lisada kumbki oma vastuse
ja salvestada erinevad koopiad. `save_with_git`-i lukk kaitseb kirjutust, mitte
enne seda tehtud lugemist. Funktsioon loeb ja kirjutab uuesti ka lehe teksti,
kuigi toiming muudab ainult kommentaare.

**Kordus:** kaks lõime peatati testasendatud kirjutaja ees barjääriga. Mõlemad
toimingud tagastasid edu; kirjutatud loendid sisaldasid vastavalt ainult
`reply B` ja ainult `reply A`. Lõppseisus oli üks vastus. Päris faile ei kirjutatud.
Vahepealse tekstiparanduse ülekirjutamine on sama koodijärjestuse järeldus,
mitte eraldi käivitatud kordus.

**Soovitus:** ühine lehepõhine lukustatud muutmistoiming, mida kasutavad kõik
sama lehe kirjutajad. Kommentaaritoiming salvestab ainult JSON-i. Avatud
redaktori vanale täissalvestusele lisada versioonikontroll; serverilukk üksi
ei välista aegunud kliendisisu ülekirjutust.

**Valmimise kontroll:** kaks samaaegset vastust jäävad alles; vastamine ja
tekstisalvestus ei kaota teineteise muudatusi; vana redaktoriversioon annab
selge konflikti; kommentaari taastamine järgib sama lepingut.

### R24-04 — rebuild avaldab aegunud hetktõmmise

**Staatus:** lahtine, kinnitatud koodijärjestus; deterministlik kordustest veel tegemata.  
**Kood:** [main.py](../../server/main.py), taustal käivitatav `rebuild_indices`;
[indices.py](../../server/prosopography/indices.py), read 321–435.

Taaste loeb isikukaardid mällu, skannib teosed ja lehed ning avaldab lõpuks
indeksid varasema hetktõmmise järgi. API võib samal ajal vastu võtta muudatusi.
Lõplikud kirjutuslukud ei tõenda, et loetud lähteandmed on veel värsked.

**Võimalik järjestus:** taaste loeb kaardi → API muudab kaarti või loob uue ning
uuendab indeksit → taaste kirjutab vanema hetkeseisu indeksisse. Kaardifail
säilib, kuid nimeotsing, seosed või välise ID duplikaadikontroll võivad eksida.
`ext_id_index.rebuild_from(all_persons, …)` asendab samuti indeksi vana loendiga.

See pole sama probleem mis parandatud upload-käivitustaaste #389. Isiku
üksiksalvestuse indeksi lukustamise parandused ei kata iseenesest terviktaastet.

**Soovitus:** määrata rebuild'i avaldamise protokoll: näiteks muudatuste
kogumine taaste ajal ja nende rakendamine enne avaldamist või versioonitud
hetktõmmis koos uuestiarvutusega. Alternatiiv on piiratud kirjutusvärav, mille
mõju käivitusele tuleb mõõta. Täisskanni hoidmine globaalse kirjutusluku all
võib olla liiga kulukas; see pole vaikimisi soovitus.

**Valmimise kontroll:** peatada taaste lähteandmete lugemise järel, luua/muuta
kaart ja teos, jätkata taastet ning kontrollida kõigi indeksite lõppseisu,
sealhulgas välise ID hõivatust. Katta ka kustutamine/liitmine.

### R24-05 — Git-viga ei jõua metaandmete toimingu vastusesse

**Staatus:** lahtine, kinnitatud koodis.  
**Kood:** [metadata_ops.py](../../server/metadata_ops.py), `bulk_update_works`
read 127–133 ja `save_work_metadata` read 228–237.

`save_with_git` võib pärast kettale kirjutamist tagastada `success: false`.
Üksiksalvestus kontrollib ainult `is_noop`-i; hulgiuuendus eirab tulemust ning
loeb kirjed uuendatuks. Kasutaja ei saa teada, et versiooniajalugu jäi tegemata.

**Soovitus:** ühine tulemusleping eristab kettale kirjutamist, commitimist ja
indekseerimist. Juba kirjutatud sisu puhul ei tohi vastus teeselda ei täielikku
õnnestumist ega täielikku tagasipööramist. Kasutada sobivat hoiatust/veaseisu
ning nähtavat taastamisvõimalust, nagu lehe `/save` juba osaliselt teeb.

**Valmimise kontroll:** testasendaja `success: false` jõuab nii üksik- kui
hulgioperatsiooni vastusesse; kasutaja näeb versioonihalduse probleemi;
muutusteta kordussalvestus ei varja parandamata commitiviga.

### R24-06 — kaanepildi päringu kulu sõltub kõigist lehtedest

**Staatus:** lahtine, kinnitatud.  
**Kood:** [image_server.py](../../server/image_server.py), `get_first_image`
read 130–153 ja `get_or_create_thumbnail` alates reast 287.

Enne olemasoleva kaanepildi kontrollimist loetakse järjestuse leidmiseks iga
lehe JSON ning sorditakse pildiloend. Sünteetilise 1000-leheküljelise teose
esimese pildi valimine tegi 1000 JSON-lugemist. See on operatsioonide arv,
mitte tootmises mõõdetud latentsus. Brauseri cache vähendab päringuid, kuid
backendini jõudnud päringu puhul töö kordub ka valmis kaanepildiga.

**Soovitus:** esimese lehe viide tuletatud indeksisse või korrektselt
invalideeritavasse vahemällu; uuendada lehtede lisamise, kustutamise ja
ümberjärjestamise korral. Säilitada praegune kaane ja lehepisipiltide eristus.

**Valmimise kontroll:** valmis kaane korduspäring ei ava kõigi lehtede JSON-e;
lehtede järjekorra muutmine annab õige uue kaane; mõõta külma ja sooja päringu
latentsust ning faililugemiste arvu eri pikkusega teostel.

### R24-07 — iga lehesalvestus võib teha isikumainimiste täisskanni

**Staatus:** lahtine, kinnitatud koodis.  
**Kood:** [editing.py](../../server/routers/editing.py), read 130–134;
[relations.py](../../server/prosopography/relations.py), `update_page_person_mentions`;
[indices.py](../../server/prosopography/indices.py), `collect_page_person_mentions`.

`work_id` olemasolul käivitub kogu teose lehefailide skann ka siis, kui muutus
ainult transkriptsioon. Järjestuse leidmine loeb samuti lehemetaandmeid ning
lõpus kirjutatakse kogu `person_to_works` indeks. Meilisearchi sünkide
koondamine seda eraldi taustatööd ei koonda.

**Soovitus:** võrrelda vana ja uut isikuviidete hulka; puhtal tekstimuutusel
isikumainimisi mitte uuendada. Lehtede ümberjärjestamise tõttu tuleb säilitada
eraldi leheküljenumbrite värskendustee. Suurema koormuse jaoks kasutada
lehepõhist uuendust või vähemalt teosepõhist koondatud tööd.

**Valmimise kontroll:** tekstimuutus ei käivita skanni; isikutägi lisamine ja
eemaldamine uuendab seoseid; kiire salvestuste jada ei tekita piiramatut
kordustööd; lehtede numbrid jäävad järjestusmuudatuse järel õigeks.

### R24-08 — isikuloendi päringud ei kaitse aegunud vastuse eest

**Staatus:** lahtine, kinnitatud koodis; brauseris aeglustatud võrgu kordus tegemata.  
**Kood:** [PersonsPage.tsx](../../src/prosopography/pages/PersonsPage.tsx),
`fetchPersons` ja `fetchFacets`, read 210–273.

Vanem päring võib lõppeda pärast uuemat ja kirjutada tulemused ning
laadimisoleku üle. Facetidel on sama puudus. Lisaks kasutab `fetchPersons`
`originPlace`-i, kuid seda pole `useCallback` sõltuvuste loendis.

**Soovitus:** päringupõlvkond või effect'i cleanup-kaitse, mis lubab olekut
muuta ainult aktiivsel päringul; võimalusel katkestada tarbetu võrgu töö.
Lisada puuduv sõltuvus, kontrollides kõrvalmõjusid.

**Valmimise kontroll:** vastused saabuvad testis tahtlikult vales järjekorras;
kuvatud loend, koguarv, facetid, viga ja laadimisolek kuuluvad viimasele
päringule. Ainult päritolukoha muutmine peab käivitama õige päringu.

### R24-09 — väike isikupilt laadib täisresolutsiooniga faili

**Staatus:** lahtine, kinnitatud koodis kasutaja tähelepaneku järel 2026-09-24.  
**Issue:** [#424](https://github.com/meelisf/VUTT/issues/424).  
**Kood:** [PersonDetailPage.tsx](../../src/prosopography/pages/PersonDetailPage.tsx),
[PersonCard.tsx](../../src/prosopography/components/PersonCard.tsx),
[PersonEditPage.tsx](../../src/prosopography/pages/PersonEditPage.tsx),
[router.py](../../server/prosopography/router.py) `prosopography_get_image`,
[person_crud.py](../../server/prosopography/person_crud.py) `upload_person_image`.

Detailvaate portree on `w-20 h-28` ehk vaikimisi Tailwindi skaalal umbes
80 × 112 CSS-pikslit. Detailvaade, loendikaart ja muutmisvormi eelvaade kasutavad
kõik sama `image_url`-i. Server tagastab salvestatud faili `FileResponse`-iga.
JPEG/WebP mõõtmeid üleslaadimisel ei vähendata; PNG teisendatakse JPEG-ks,
kuid piksliarv ei vähene. Loendi `loading="lazy"` ei vähenda laaditava pildi mahtu.

**Mõju:** suure lähtepildi puhul tarbetu ülekandemaht ja dekodeerimiskulu.
Tootmispiltide baidimahtu, mõõtmeid ega latentsust ei mõõdetud. Brauseri cache
võib kordusülekande ära hoida; väide pole, et iga külastus laadib kõik baidid uuesti.

**Soovitus:** säilitada salvestatud täissuuruses lähtepilt ja kasutada UI-s
piiratud hulka korduskasutatavaid suurusevariante, arvestades ka 2× kuvarit.
Ühine URL-i/suuruse valik, vajadusel `srcSet`/`sizes`. Genereerimine upload'il
või laisalt koos cache'iga; igal GET-il mitte teisendada ega teha kallist pilditööd
async-sündmussilmuses. Juba olemasolevad pildid peavad töötama uuesti üleslaadimiseta.
Asendamine/kustutamine peab invalideerima variandid ja pildi cache-võtme.

**Valmimise kontroll:** väikesed vaated kasutavad sobivat varianti; 1×/2× teravus,
kuvasuhe ja senine kärpepositsioon säilivad; väikesi lähtepilte ei suurendata;
korduspäring ei genereeri uuesti; lähtepilt säilib; pildi asendus on kohe nähtav;
esindusliku suure pildi baidimahu vähenemine ja külm/soe päring on mõõdetud.

See on eraldi R24-06/#419 teoste kaanepildi **failiskanni** probleemist:
R24-09 käsitleb üle kantava **isikupildi mõõtmeid**. Võtta jõudlustööde etappi
koos R24-06 ja R24-07-ga, ilma et neid peaks üheks PR-iks ühendama.

### R24-10 — isikuloendi kordusotsingu ajal säilib senine tulemus

**Staatus:** kokkulepitud parandustöö, teostamata.  
**Issue:** [#425](https://github.com/meelisf/VUTT/issues/425), seotud
[#421](https://github.com/meelisf/VUTT/issues/421).  
**Kood:** [PersonsPage.tsx](../../src/prosopography/pages/PersonsPage.tsx),
loendi laadimisoleku tingimuslik renderdamine.

Praegu kaovad senised kaardid ja koguarv iga päringu ajaks; kuni 48 kaardi
asemele ilmub kaheksa laadimiskaarti. Kasutajaga lepiti kokku, et esmalaadimise
ja kordusotsingu kuvamine eristatakse: esmalaadimisel laadimiskaardid, sama
ulatuse kordusotsingul senine tulemus koos „Uuendan…” märgiga.

Vana loendit, koguarvu ega lehekülge ei tohi näidata uue päringu vastusena.
Kollektsiooni, töökollektsiooni või autentimisulatuse muutumisel ei säilitata
eelmist sisu automaatselt. Vea puhul peab olema selge, et uuendamine ei
õnnestunud, ja võimalik uuesti proovida. Olekumärge peab olema ligipääsetav
ning tekstid mõlemas keeles. R24-08/#421 päringujärjekorra kaitse teha enne
või koos selle muudatusega.

**Valmimise kontroll:** kiire/aeglase võrgu ja vales järjekorras vastuste
testid; tühi tulemus ja korduskatse; ulatuse vahetus; et/en tekstid; nähtav
uuendamismärge ilma tarbetu vilkumise ja laadimisest tingitud kõrgusehüpeteta.
Otsinguviivituste muutmine ja kaardiloendi memoiseerimine ei kuulu sellesse töösse.

## 3. Varasemate suuremate leidude staatus

| Varasem teema | Staatus 2026-09-24 | Tõend / edasine tegevus |
|---|---|---|
| Dashboardi `limit: 5000` ja järelejäänud facetipiirid | **Tehtud, kood kontrollitud** | [#156](https://github.com/meelisf/VUTT/issues/156), [#183](https://github.com/meelisf/VUTT/issues/183), [#184](https://github.com/meelisf/VUTT/issues/184) suletud; vana dokumentide täislaadimise piir pole enam sama kujul |
| `save_with_git` ajaloo läbimine igal salvestusel | **Tehtud, kood kontrollitud** | Kasutab `git cat-file -e HEAD:<path>`; vana `iter_commits` soovitust mitte uuesti planeerida |
| Python 3.9/3.12 lahknevus ja lukustamata tootmissõltuvused | **Tehtud, kood kontrollitud** | [#387](https://github.com/meelisf/VUTT/issues/387) suletud; Docker kasutab Python 3.12 ja `requirements.lock`-i |
| Kaks serveriprotsessi ühes konteineris | **Tehtud, kood kontrollitud** | [#388](https://github.com/meelisf/VUTT/issues/388) suletud; `backend` ja `images` eraldi, `init` ja healthcheck'id olemas. Protsessi tapmise katset siin ei tehtud |
| Upload'i käivitustaaste võistlus uue tööga | **Tehtud, kood kontrollitud** | [#389](https://github.com/meelisf/VUTT/issues/389) suletud; `_kaivitustaasted` oodatakse enne lifespan'i `yield`-i ära. R24-04 on teine võistlus |
| TypeScripti strict-kontrolli puudumine | **Tehtud, kood kontrollitud** | [#390](https://github.com/meelisf/VUTT/issues/390) suletud; `strict`, `noUnusedLocals`, `noUnusedParameters` on sees. See ei tõenda kõigi runtime-vigade puudumist |
| Prosopograafia oma tokenilugejad | **Tehtud, kood kontrollitud** | [#356](https://github.com/meelisf/VUTT/issues/356) suletud; ühine `deps.py` |
| `state/` Docker image'is | **Tehtud, kood kontrollitud** | Dockerfile ei kopeeri runtime-sisu; vanade image'ite käsitlus on eraldi #386 |
| Vearaportite kodeeritud tokenite puhastus | **Varasemas ülevaatuses teostatud ja testitud; siin kordamata** | 2026-09-15 dokumendi §8 kirjeldab mõlema keele testikorpust ja lugemisel puhastamist; uut lekkeauditit ei tehtud |
| MapLibre varasem turvaleid | **Parandus olemas; värske turvaaudit tegemata** | `package.json`: 6.9.1; [#378](https://github.com/meelisf/VUTT/issues/378) suletud. See pole kinnitus kogu sõltuvuspuu turvalisusele |
| Varasemate image'ite ja tokenilogide järelmõjud | **Suletud GitHubis** | [#386](https://github.com/meelisf/VUTT/issues/386); tootmise kihte, varukoopiaid ega tokenite tühistamist siin ei kontrollitud |
| Lint-kommentaar, Docker build-kontekst, kasutamata Tailwind 4 plugin | **Varasema ülevaatuse järgi tehtud** | 2026-09-15 lõppseis; paketiloendis pole vana pluginat. Ehitusmahtu ega lint-tulemust siin uuesti ei mõõdetud |
| Serveripoolne veakoondus | **Suletud GitHubis; kood olemas** | [#133](https://github.com/meelisf/VUTT/issues/133); `server_errors`, HTTP-handler ja lõimede excepthook. Ei tõenda kõigi vigade nähtavust |
| Väliste ID-de pöördindeks ja Meili sünkide koondamine | **Olemas; seotud issue'd suletud** | [#180](https://github.com/meelisf/VUTT/issues/180), [#176](https://github.com/meelisf/VUTT/issues/176). Säilitada; R24-04 ja R24-07 ei ole nende kordus |

## 4. Endiselt avatud suuremad tööd

Need on olemasolevad issue'd; uut dubleerivat tööd pole vaja avada.

| Töö | Staatus | Soovitus / valmimise tõend |
|---|---|---|
| [#131 Varundus tervikuna](https://github.com/meelisf/VUTT/issues/131) | **Avatud GitHubis** | Kõrge operatiivne prioriteet. Varundusskript ja juhend on olemas; avatust ei tohi tõlgendada varunduse täieliku puudumisena. Vajalik tõend: off-site koopiast taastamise proov, sh pildid ja `state/`, määratud säilitusaeg ning taastamise eesmärgid |
| [#132 OCR job-state → SQLite](https://github.com/meelisf/VUTT/issues/132) | **Avatud GitHubis** | Käsitleda eraldi olekuhalduse projektina. Vanad #114–#119 üksikvead on suletud; neid ei loeta siin automaatselt lahtiseks. Määrata migratsioon, katkestuse taastumine ja konkurentsitestid |
| [#134 Standardeksport](https://github.com/meelisf/VUTT/issues/134) | **Avatud GitHubis** | Pikaealisuse prioriteet: dokumenteeritud dump/TEI koos näidise ja valideerimisega; ei blokeeri R24-01…08 parandamist |
| [#240 Prosopograafia kvaliteet](https://github.com/meelisf/VUTT/issues/240) | **Avatud GitHubis** | Käimasolev isiku lisamise voo töö seostub sellega. Kooskõlastada R24-04 parandamine sama ala muudatustega; kavand ega tööpuufail pole tõend deploy kohta |
| [#413 Töökollektsiooni liikmete lagi](https://github.com/meelisf/VUTT/issues/413) | **Avatud GitHubis** | Enne 1000 → 5000 muutmist mõõta filtreerimist, päringumahtu ja renderdust; see pole vana Dashboardi #156 probleem |
| [#412 Väikeste kohenduste koond](https://github.com/meelisf/VUTT/issues/412) | **Avatud GitHubis** | Kontrollida sisu enne uue väikese issue loomist; siinsed R24 leiud pole selle alla automaatselt arvatud |

Muud avatud tooteteemad, näiteks #298 ja #319, ei olnud selle tehnilise
ülevaatuse siht. Avatud issue olemasolu ei ole iseenesest koodiviga.

## 5. Varasemast võlaregistrist alles jäävad teemad

Järgnev tabel hoiab varasemad märkused nähtaval, kuid **ei esita kontrollimata
vana väidet värske leiuna**. Failide vanad reaarvud, loendused ja tootmismahud
vajavad enne kasutamist uut mõõtmist.

| Teema | Praegune hinnang / staatus | Soovitus |
|---|---|---|
| Vaikselt neelatud erandid | **Vajab järelkontrolli**; vana 117 haru pole uuesti loetud | Alustada kirjutusvigadest ja kasutaja töö peatavatest upload/re-OCR teedest; R24-05 on konkreetne kinnitatud töö |
| `_metadata.json` eri lugemisteostused | **Korduv muster kinnitatud**, täielik inventuur tegemata | Üks leping peab eristama puudumist, lugemisviga ja lubatud avalikku teost; R24-02 parandamisel mitte teha mehaanilist asendust |
| Ühilduvusfassaadid ja `_compat` | **Vajab järelkontrolli** | Uued otsesed impordid; migreerida testide patch'imise semantikat säilitades. Vana tarbijate arvu mitte kasutada praeguse mõõtmisena |
| Suured moodulid ja pikad funktsioonid | **Hallatavuse hinnang; inventuur kordamata** | Jagada vastutuse järgi pärast invariantide katmist; faili pikkus üksi ei määra prioriteeti |
| HTML-valvuri `.innerHTML`/`.outerHTML`/`insertAdjacentHTML` katvus | **Vajab järelkontrolli** | Laiendada valvurit tegelike renderdusteede järgi; vana kontrollipuudus ei tõenda ise XSS-i |
| `config.py` impordi kõrvalmõjud | **Vajab järelkontrolli** | Eraldada valideerimine käivitusest; vältida testide tahtmatut runtime-oleku muutmist |
| HMAC-saladuse tugevuse kontroll | **Vajab järelkontrolli** | Kontrollida pikkust ja tootmisseadistuse lepingut; selle ülevaatuse käigus saladusi ei loetud |
| `print` ja logger läbisegi | **Muster nähtav; loendus kordamata** | Ühtlustada puudutatavates veateedes, säilitades tundlike andmete puhastuse |
| OCR/dev-backendi kõvakodeeritud vaikeväärtused | **Infra vaikeväärtused nähtavad; täielik inventuur kordamata** | Tootmises selge env-leping; neid ei tohi nimetada lekkinud autentimissaladusteks |
| `get_client_ip` usaldab päiseid | **Koodis endiselt olemas** | Usaldada ainult tuntud proksit. Praegune leevendus: localhostile seotud pordid ja nginx-i päised; avalikku möödapääsu siin ei tõendatud |
| `find_directory_by_id` slug-match | **Vajab järelkontrolli** | Korrata lõpu-alakriipsuga slugi juhtum; säilitada õiguskontroll |
| Viewer-tokeni loogika duplikatsioon pisipiltides | **Vajab järelkontrolli** | Ühine komponent/teenus pärast praeguste tarbijate inventuuri; sobib R24-02 järel |
| `normalizePage`/`normalizeWork` ja teenuste erisused | **Vajab järelkontrolli** | Ühine sisend-väljund-testikorpus enne ühendamist |
| WorkManage hulgi- ja üksikvaliku UI-jäägid | **Vajab järelkontrolli** | Korrata 409 järel dialoog, esmarenderi järjestusriba ja kustutamine salvestamata järjestusega |
| `tags`, status/confession ja muud legacy-fallback'id | **Vajab andmete ja koodi järelkontrolli** | Mõõta tegelikud tabamused; migratsioon enne eemaldamist. Lokaalne `data/` ei tõenda tootmise seisu |
| Meili `lehekylje_pilt` sisaldab katalooginime | **Vajab järelkontrolli** | Nanoidile üleminek nõuab tarbijate kaardistust ja reindeksit |
| `page_number` jääk lehe-JSON-is | **Vajab andmete järelkontrolli** | Koristus eraldi migratsioonina, mitte kõrvalmuudatusena |
| Kohtade lineaarne label-otsing | **Vajab mõõtmist** | Optimeerida ainult reaalse kuuma tee tõendi alusel |

Varasema registri tooteotsused — isiku enda kuuluvus vs teostepõhine
kollektsioonifilter, arhiivinimede keelevariandid ja „loengukava” märksõna —
vajavad eraldi otsust. #136 on suletud, kuid see ei tõenda automaatselt kõigi
hiljem kirjeldatud kuuluvusjuhtude lahendamist. Neid ei ole siin tõstetud
turva- ega stabiilsusvigadeks.

## 6. Soovituslik tööjärjekord ja hinnangud

1. **R24-01 ja R24-02:** kaks eraldi piiratud turvaparandust koos eitavate
   ligipääsutestidega. Pärast merge'i kontrollida deploy'd, mitte ainult testi.
2. **R24-03:** lehe kirjutuslepingu parandamine. Ühine lukk ja versioonikontroll
   peavad katma seotud kirjutajad; ainult vastamisfunktsiooni eraldi lukk ei piisa.
3. **R24-04:** indeksite taaste konkurentsitest ja avaldamise protokoll;
   kooskõlastada käimasoleva prosopograafia tööga.
4. **R24-05:** salvestustulemuse ühine käsitlus; mitte peita seda üldise
   logimisrefaktori sisse.
5. **R24-06 ja R24-07:** mõõta faililugemiste arv ja latentsus ning eemaldada
   korduvad skannid. Mõlemad on eraldi kontrollitavad optimeerimised.
6. **R24-08:** loendi ja facetide päringuelutsükli parandus koos vastuste
   järjekorra testidega.
7. **#131 taastamisproov paralleelse operatiivtööna.** Seda ei pea ootama kuni
   kõik P2 parandused valmis; tegelik prioriteet sõltub praeguste koopiate seisust.
8. Muud võlaregistri teemad võtta ette puudutatava mooduli kaupa, esmalt nende
   värske kehtivus kontrollides.

### Arhitektuuri ja kasvu hinnang

- Failid + Git ning taastatavad indeksid sobivad jätkuvalt projekti eesmärgiga
  (ADR 0001 ja 0007). Käesolevad leiud ei põhjenda põhiandmete täielikku
  andmebaasi kolimist.
- Vana ülevaate „2× ei nõua midagi”, „5× sobib” ja „Meili kuni 100×” väited
  **ei ole käesoleva ülevaatuse mõõdetud järeldused**. Kasv sõltub ka lehtedest
  teose kohta, samaaegsetest kirjutustest, cache'ist ja kettast.
- Workerite lisamine ei ole ohutu esimene jõudlusparandus: mitmed lukud ja
  järjekorrad on protsessilokaalsed. Enne tuleb kirjeldada protsessideülene
  koordineerimine ja duplikaatsete taustatööde vältimine.
- Mõõta vähemalt lehesalvestuse p50/p95, Git-commit'i kestust ja lukujärjekorda,
  külma/sooja kaanepildi päringut, rebuild'i kestust ja kattumist kirjutustega
  ning taustatööde järjekorra pikkust.
- Olemasolevad tugevused tuleb säilitada: TypeScript strict, lukustatud
  sõltuvused, ühine Meili dokumendiehitus, koondatud Meili sünk, eraldi
  serverikonteinerid, atomaarne failikirjutus, Git-ajalugu ja ADR-id.

### Reageerimise arutelu — kasutaja täpsustus ja edasilükatud ideed

**2026-09-24 kokkulepe:** R24-10/#425 läheb konkreetseks tööks. Allolevad
teemad jäävad siia arutelumärkmeteks; eraldi mõtete kogumise issue't ei loodud.
Need ei ole automaatselt vead ega luba olemasolevaid viivitusi eemaldada.

**Otsingu ja lehevahetuse viivitused on osaliselt tahtlikud.** Kasutaja sõnul
on need lisatud kasutajate tagasiside põhjal: liiga kiire muutus võib jääda
märkamatuks ja tekitada segadust. Varasem vestluses tehtud soovitus eemaldada
viivitused kohe oli selle kontekstita liiga tugev ning ei kehti tööotsusena.

Koodist nähtud mehhanismid:

- `Dashboard.tsx` viivitab sisestuse URL-i kandmisega 400 ms ja päringu
  alustamisega veel 400 ms. Tekstiotsingul võib enne võrku lisanduda ligikaudu
  800 ms; lehevahetus läbib samuti päringueelset 400 ms pausi.
- `useSearchResults.ts` viivitab päringu alustamisega 400 ms ka tulemuste
  lehevahetusel, mitte ainult tippimisel.

**Võimalik hilisem katse, mitte kokkulepitud teostus:** eraldada andmete
küsima hakkamine ja muutuse tajutavaks tegemine. Päring võiks alata kohe,
kuid uuele seisule juhiks tähelepanu lühike tulemuste üleminek, aktiivse
leheküljenumbri muutus ja selge lehemärge. Tippimisele jääks üks sobiv paus.
Kiiresti vilksatav spinner üksi ei ole piisav asendus: märgatav peab olema
uus seis. Lahendust tuleb proovida nii kiire kui aeglase võrgu ja vähendatud
animatsioonide eelistusega ning kinnitada kasutajate tagasisidega. Eesmärk ei
ole viia ajamõõdik nulli kasutaja arusaadavuse arvelt.

**Isikuloendi renderdamine tippimisel — mõõtmise ootel.** Otsingukasti olek
asub `PersonsPage`-is, `PersonCard` pole memoiseeritud ning loend saab uusi
callback'e. See on võimalik lisatöö iga klahvivajutuse juures, kuid nähtavat
hangumist või selle kestust pole mõõdetud. `memo` pimesi lisamine ei ole
soovitus. Pärast käimasoleva prosopograafia töö stabiliseerumist mõõta
tippimise viivitust ja Reacti renderdusi aeglasema seadme/CPU profiiliga;
vajadusel eraldada sisend või stabiliseerida loendi omadused.

Läbivaadatud isiku lisamise voo spekk käsitleb paneeli, rikastust ja
ülevaatusjärjekorda, mitte `PersonsPage` otsingukasti renderdusulatust.
Käimasoleva teostuse kõrvale selle märkme põhjal uut refaktorit ei lisata.
Eraldi issue tekib siis, kui mõõtmine näitab probleemi või kasutajaga lepitakse
kokku konkreetne kasutajakogemuse katse.

Juba olemasolevad tugevused: kõrvallehtede eellaadimine töölaudas, CodeMirrori
säilitamine sama teose lehevahetusel, Dashboardi aegunud päringute katkestamine
ja raskemate lehtede laisk laadimine. Neid ei planeerita uuesti tegemata tööna.

## 7. Kontrollide ulatus ja piirid

**Tehti:** varasemate ülevaatuste ja tehnilise võla lugemine; GitHubi issue'de
olekute lugemine; valitud API-, õiguste-, salvestus-, indeksi-, pildiserveri-,
frontendi- ja käivituskonfiguratsiooni kooditeede läbivaatus.

Sünteetilised kontrollid käivitati projekti Pythoniga ja
`PYTHONDONTWRITEBYTECODE=1`, laadides vajalikud funktsioonid AST kaudu, et
vältida serveri importide kõrvalmõjusid. Faililugemised/kirjutused ja vajadusel
õiguskontroll asendati mälus. Testifaili reposse ei lisatud.

| Kontroll | Tulemus | Piirang |
|---|---|---|
| `/save` reserveeritud failinimega | Kirjutuskutse siht oli `/virtual/data/editable-work/_metadata.json` | Päris HTTP- ega kettakirjutust ei tehtud |
| Originaalipildi tee ja õiguskontroll | Lubatud juur/laiend `True`; puuduv meta lubas anonüümse päringu | Päris faili ega tootmise nginx-i ei kontrollitud |
| Kaks samaaegset kommentaarivastust | Mõlemad eduga; lõppseisus 1 vastus 2 asemel | Kirjutaja oli mälus testasendaja |
| 1000-leheküljelise teose esimese pildi valik | 1000 JSON-lugemist | I/O-arv, mitte latentsuse benchmark |

**Ei tehtud:** tootmisserveri päringuid, koormustesti, täielikku turva- ega
sõltuvusauditit, saladuste/ajaloo skanni, brauserikatset ega kogu testikomplekti
käivitamist. Ülevaatus ei kinnita kogu koodibaasi vigadeta olekut.

Koodiülevaatuse ajal liikus HEAD `09855bdb` → `959dd078`. Dokumendi koostamise
ajal olid teise agendi pooleliolevad `enrichment.py`, `auto_enrich.py` ja nende
testid tööpuus; neid ei muudetud ega loetud valmis parandusteks. Reaviited
kirjeldavad ülevaatuse hetke; funktsiooninimi on püsivam orientiir.

## 8. Kuidas seda registrit edasi kasutada

- Iga R24 leiu paranduse juurde lisada issue/PR, commit, valmimise kontrolli
  tulemus ning eraldi deploy või tootmiskontrolli staatus.
- „Tehtud” märge eeldab vastava leiu kontrolltingimuse täitmist; plaan,
  pooleliolev tööpuu või suletud issue üksi ei ole sama tõend.
- Järelkontrolli ootavad vanad teemad kinnitada või sulgeda enne suure töö
  planeerimist. Vanad numbrilised loendused ei uuene koos koodiga.
- Varasemad review-failid jäävad ajaloo ja põhjenduste allikaks. Nende
  praegust staatust lugeda selle dokumendi §3–5 järgi, kuni tekib uuem kontroll.
- Uuendamisel märkida kuupäev ja kontrollitud commit. Hoida „koodis tehtud”,
  „testitud” ja „tootmises kontrollitud” eraldi.

**2026-09-24 dokumendi loomine:** rakenduskoodi, teise agendi faile, issue'sid
ega tootmisandmeid selle töö käigus ei muudetud.

**2026-09-24 järeltegevus kasutaja palvel:** loodi GitHubi issue'd #416–#423,
kontrollides enne avatud issue'de sisu ja olemasolevaid silte. Selle dokumendi
§2 täiendati linkide ning riskide käsitlemise kokkuleppega. Rakenduskoodi ega
teise agendi faile ei muudetud; olemasolevate issue'de sisu ei kirjutatud üle.
