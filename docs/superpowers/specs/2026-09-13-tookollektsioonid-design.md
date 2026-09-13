# Töökollektsioonid: paindlikud valikud ühises töökeskkonnas

Kuupäev: 2026-09-13 (rev 3)
Staatus: kokku lepitud suund; teostusjärjekord ja vastuvõtukriteeriumid all
Seotud: #319; ADR 0031, 0038, 0040; `2026-09-13-kollektsioonide-kaks-telge-design.md` (**asendatud**)

## Eesmärk ja piir

Admin saab luua näiteks „Fischeri konverents 2027", koondada sinna teoseid,
anda kasutajatele ligipääsu või haldamisõiguse ning kasutada seda päisest valitava
töökontekstina. Otsing, sirvimine, statistika ja isikute vaade järgivad valikut.
Pärast töö lõppu saab kogu arhiveerida ja selle lingi alles jätta.

Töökollektsioon on kureeritud teoste loend. Selle eluiga võib olla lühike või pikk;
see ei ole uus teoste ligipääsu ega tekstide toimetamisõiguse allikas.

Praegused kollektsioonid jäävad muutmata, kasutajaliideses jaotisse „Püsikogud".
See nimetus on praktiline eristus, mitte väide, et kõik praegused kogud on päritolukogud.
Klingeriana, PFS-i, matusetrükiste ega teiste kogude migratsioon ei ole eeltingimus.
Struktuurse puu korrastamine (Keiserliku ülikooli juur, „Määramata", kodutud teosed)
jääb eraldi otsuseks #319 all.

### Rev 2 kandev otsus: liikmesust ei indekseerita

Töökollektsiooni liikmesus **ei jõua Meilisearchi**. Ei uut välja, ei liitmist
olemasolevatesse väljadesse, ei liikmesuse sünki. Server tagastab kutsujale loetavate
teoste ID-d ja otsing kasutab neid filtris `work_id IN [...]` olemasoleva ligipääsufiltri
kõrval.

Põhjus on mõõdetud, mitte eelistuslik. Tenant-tokeni filter on
(`meilisearch_ops.py:586`):

```
is_public = true OR collections_hierarchy IN [allowed_collections]
```

`collections_hierarchy` **kannab lugemisõigust**. Iga lahendus, mis liikmesuse sinna
liidab, avab tee, kus kogu-ID sattumine kasutaja `allowed_collections`-i annab
lugemisõiguse kõigile selle kogu teostele. Indekseerimata liikmesus välistab selle
ehituslikult ja kaotab ühtlasi kogu sünkroniseerimise keerukuse: uut filtreeritavat
välja ei teki, indekseerimisteed ei muutu, liikmesuse muutmine ei vaja reindeksit
ega taastelugu.

## 1. Kasutaja töövoog

1. Admin avab päise koguvalija ja valib „Loo töökollektsioon".
2. Sisestab nime ja soovi korral kirjelduse. Vaikimisi on kogu määratud kasutajatele
   ning looja on selle haldur. Adminid saavad kõiki töökollektsioone hallata.
3. Lisab teoseid otsingutulemuste märgitud valikust või teose juurest.
4. Määrab kasutajahalduses vaatajad ja haldurid. Sama õiguste määrangut saab
   muuta kogu haldusvaatest.
5. Kasutaja valib kogu päisest ja töötab selle piires seniste vaadetega.
6. Vajadusel admin avaldab kogu: selle lubatud sisu saab sirvida ilma sisse logimata.
7. Töö lõppedes haldur arhiveerib kogu. Jagatud link töötab edasi.

Esimene versioon lisab ainult konkreetselt märgitud teosed. „Lisa kõik otsingutulemused"
ja automaatselt muutuva päringu salvestamine ei kuulu esimesse versiooni.

## 2. Õigused

| Toiming | Lubatud kasutaja |
|---|---|
| Luua töökollektsioon | admin või superadmin |
| Avada määratud kasutajatele kogu | selle vaataja või haldur; admin+ |
| Avada avalik kogu | kõik |
| Muuta nime, kirjeldust ja liikmeid | kogu haldur; admin+ |
| Arhiveerida või taasaktiveerida | kogu haldur; admin+ |
| Määrata kasutajaid, avaldada või muuta piiratud koguks | admin+ |
| Kustutada | admin+, allpool kirjeldatud piirangutega |
| Lugeda või muuta teost | teose senine lugemis- ja kirjutamisõigus |

Haldur võib olla contributor või editor; töökollektsiooni haldamine ei muuda tema
globaalset rolli. Vaataja ei pea olema eraldi kirjena lisatud, kui ta on haldur.
Kõik admini kontrollid kasutavad rollihierarhiat (`is_at_least` / `isAtLeast`), mitte
täpset rollinime võrdlust.

Kasutajahaldus kuvab kolm eraldi õiguste plokki:

- piiratud püsikogude lugemisõigus: olemasolev `allowed_collections`;
- teoste toimetamisulatus: olemasolev `edit_collections`;
- töökollektsioonide õigused: kogu kaupa „vaataja" või „haldur".

Töökollektsiooni õiguse määramine ei muuda kahte esimest välja. Ka kogu loomine,
avaldamine ja teose lisamine ei muuda teose `collections`, `is_public` ega `shareable`
väärtust.

Iga kasutaja näeb kogus ainult teoseid, mida tal on õigus lugeda. Varjatud teoste
nimesid, ID-sid ega nende arvu talle ei tagastata — server filtreerib ID-loendi enne
tagastamist ja tenant-token kaitseb lisaks otsingudokumente.

**Kaks lugemispredikaati, mis ei ole samad.** `can_read_work` (`access_ops.py:31`) tagastab
tõese ka `shareable`-teose kohta, aga tenant-tokeni filter (`meilisearch_ops.py:586`) on
`is_public = true OR collections_hierarchy IN [allowed_collections]` — `shareable` seal EI OLE
ja ei tohi olla (jagatav teos on lingiga avatav, teadlikult mitte otsitav). Ilma otsuseta
näitaks kogu arv ühte teost, mille sirvimine jääb tühjaks.

Otsus: **ID-loend, mis läheb otsingufiltrisse, kasutab otsingus-nähtavuse predikaati**, mitte
`can_read_work`-i. Tagajärjed:

- Jagatav-aga-piiratud teos võib olla kogu **liige** (haldur tohib teda lisada, ta näeb teda
  otselingiga), kuid ta ei kuulu selle kasutaja otsingunimekirja ega arvu.
- Kogu arv ja sirvimistulemus on alati sama hulk — arv ei luba midagi, mida vaade ei näita.
- Halduri vaates märgitakse selline liige eraldi („lingiga avatav, otsingus ei kuvata"),
  et liikme kadumine vaatest ei näiks veana.
Haldur võib lisada ainult talle loetavaid teoseid. Teose lugemisõiguse kaotamine ei
eemalda liikmesust; vajadusel saab varjatud või kustutatud viite eemaldada admin.
**Lisamise ja eemaldamise valideerimine on lahus** (§7): lisamine nõuab, et teos eksisteerib ja
on kutsujale loetav; eemaldamine nõuab ainult olemasolevat liikmesusviidet ja haldusõigust —
teos ise ei pea enam eksisteerima. Vastasel juhul oleks kustutatud teose viide korraga
„eemaldatav" ja „valideerimisel tagasi lükatav".

Kollektsioonita teost võib töökollektsiooni lisada. Selle õigused jäävad praeguse
`can_read_work` / `can_write_work` käitumise järgi määratuks; automaatset püsikogu ei lisata.

## 3. Päise valija ja töö kontekst

Olemasolev modaal saab kaks jaotist:

- „Püsikogud": praegune hierarhiline puu;
- „Töökollektsioonid": kasutajale nähtavate aktiivsete kogude lame loend.

Ühine otsinguväli otsib mõlema jaotise nimesid. „Kõik teosed" eemaldab kogu piirangu.
Töökollektsioonid järjestatakse kuvatava nime järgi, võrdse nime korral püsiva ID järgi.
Adminile on nähtav loomise tegevus; kogu haldurile valitud kogu haldamise tegevus.
Päis näitab valitud kogu nime ja liiki, et samanimelised kogud oleksid eristatavad.

Korraga on aktiivne üks valik:

```ts
type CollectionSelection =
  | { kind: 'all' }
  | { kind: 'collection'; id: string }
  | { kind: 'work_set'; id: string };
```

Valik elab senise `CollectionContext`-i edasiarenduses. URL-i sünk jääb ühte
olemasolevasse mehhanismi: suuna otsustab ainsana `decideCollectionSync`
(`src/contexts/collectionSync.ts`, ADR 0038). Lehtedele ei lisata eraldi peegeldavaid
efekte — kaks tingimusteta peeglit annavad lõputu URL-i vahetuse (#333).

- Püsikogu: senine `?collection=academia-gustaviana`.
- Töökollektsioon: `?set=<püsiv-id>`.
- Kogu vahetamine eemaldab teise liigi parameetri ning lähtestab leheküljenumbri.
- Kui välises URL-is on mõlemad, eelistatakse `set`-i ja eemaldatakse `collection`.
- Brauseri edasi/tagasi ning otselingi avamine taastavad kogu koos otsingutingimustega.
- Muud otsingutingimused säilivad kogu vahetamisel; null tulemust on lubatud tulemus.

Puuduvat või ligipääsmatut töökollektsiooni ei asendata vaikselt kogu korpusega.
Kuvatakse üldine teade „Töökollektsiooni ei leitud või puudub ligipääs" ja teadlik
tegevus „Kõik teosed". Määratud kasutajatele kogu tundmatu link ei avalda selle nime.
Õiguste laadimise ajal ei tehta veel piiramata korpuse päringut (sama väravamuster nagu
`Workspace.tsx` `authInitializing` juures).

Töökollektsioon piirab sirvimist ja otsingut. Teose avamine redaktoris säilitab
tagasitee sellesse konteksti, kuid ei anna õigust teost muuta ega lukusta redaktorit
ainult selle kogu teostele.

## 4. Otsing ja teised vaated

### Päringutee

Klient küsib serverilt valitud kogu liikmete ID-d (`GET /work-sets/{id}/works`) ja
lisab otsingupäringusse filtri `work_id IN ["…", …]` senise ligipääsu- ja
otsingufiltri kõrvale. Ühine päringu koostaja teisendab valiku kas
`collections_hierarchy` filtriks (püsikogu) või `work_id IN [...]` filtriks
(töökollektsioon); ühtki muud filtriteed ei ole.

- **Üks päring, mitte partiid.** Otsingutulemusi ei liideta kliendis partiidest kokku —
  järjestus ja lehekülgedeks jagamine läheksid katki. Kogu ID-loend läheb ühte filtrisse;
  suuruse hoiab ohjes §5 lagi.
- **Tühi ID-loend tähendab null tulemust**, mitte filtri ärajätmist. Tühi kogu, ligipääsu
  tõttu tühjaks filtreeritud kogu ja „kõik teosed" on kolm eri olekut.
- Pelgalt filtri peitmine brauseris ei ole ligipääsukontroll: ID-loendi filtreerib server,
  dokumente kaitseb tenant-token.

### Jõudluse kontroll enne teostust

1000 ID-ga filter on koodis olemas (`searchService.ts:535`, `WORK_FACET_BATCH = 1000`),
kuid see on **fassetipäring tühja otsisõnaga** — ta ei tõesta sama suure filtri jõudlust
tekstiotsingus. Enne teostust mõõdetakse esinduslik päring (sagedane sõnatüvi + 1000 ID-d
+ ligipääsufilter) tootmiskorpuse vastu. Kui vastus ei mahu mõistlikku aknasse, langetatakse
§5 lage, mitte ei lisata kliendipoolset partiide liitmist.

### Loendamine

- **Koguvalija arv** = unikaalseid kutsujale loetavaid teoseid kogus, sõltumata jooksvast
  otsingust. Allikas on serveri ID-loendi pikkus.
- **Otsingutulemuste arv** = jooksvale päringule vastavaid teoseid; võetakse
  `page`/`hitsPerPage` päringu `totalHits`-ist, **mitte** `estimatedTotalHits`-ist
  (oli 7,5× vale, #183).
- Need on eri arvud ja märgistatakse vastavalt. Toores leheküljeindeksi
  `facetDistribution` ei sobi teoste loenduseks ja `distinct` seda ei paranda.
  `fetchWorkLevelFacets` jääb kasutusse muutumatuna: ta saab juba lahendatud ID-loendi ja
  lisab `lehekylje_number = 1` — see on ohutu, sest ta ei otsi teksti. Sama võtet EI TOHI
  kasutada tekstiotsingu vastete loendamiseks (vaste leheküljel 2 jääks välja).

### Vaadete leping

| Vaade | Valiku mõju |
|---|---|
| Avaleht / teoste sirvimine | valitud kogu kutsujale loetavad teosed |
| Tekstiotsing | vasted ainult nende teoste lehtedelt |
| Statistika | sama teoste hulk; lehtede ja teoste arv on eristatud |
| Isikud | olemasolevad teose–isiku seosed, piiratud sama ID-loendiga |
| MCP | **v1-s ei toeta** töökollektsioone (vt allpool) |

**Isikute vaade on v1-s sees.** Kasutatakse sama liikmeloendit ja olemasolevaid
teose–isiku seoseid (`person_to_works.json`, `work_collections_index.json`) — **uut
liikmesusindeksit ei tehta**. Server kontrollib kogu ligipääsu ka sellel päringuteel;
piiratud teose seos ei tohi isikute filtri kaudu lekkida.

**MCP jääb v1-st välja** teadlikult: `vutt_mcp` on autentimata read-only ligipääs avaliku
API kaudu, töökollektsiooni liikmesus aga nõuab kutsuja tuvastamist. Avalike kogude
toetuse saab lisada eraldi, kui vajadus tekib.

## 5. Andmed ja muudatuste kooskõla

Üks autoriteetne fail töökollektsiooni kohta, `data/config/work_sets/<id>.json`:

```json
{
  "id": "ws_a83f20",
  "name": {"et": "Fischeri konverents 2027", "en": ""},
  "description": {"et": "Konverentsi ettevalmistusmaterjal", "en": ""},
  "visibility": "members",
  "status": "active",
  "ever_published": false,
  "access": {"mari": "manager", "juri": "viewer"},
  "works": ["v7Kq2mXp", "agu8di"],
  "revision": 1,
  "created_by": "mari",
  "created_at": "2026-09-13T10:00:00Z",
  "updated_by": "mari",
  "updated_at": "2026-09-13T10:00:00Z"
}
```

ID genereerib server ja see ei muutu koos nimega. Nõutud on vähemalt üks nimi;
kasutaja sisestatud sisu puuduvat tõlget kuvatakse olemasolevas keeles. Rakenduse
enda i18n-võtmed lisatakse alati mõlemasse keelde (ADR 0011, `fallbackLng` on väljas).

**Suuruse lagi: 1000 unikaalset liiget kogu kohta.** Piiri jõustab server kogu **tegeliku**
unikaalsete liikmete arvu peal (mitte kutsujale nähtava osa peal); piiri ületav lisamine
lükatakse **tervikuna** tagasi, mitte ei lisata osaliselt. Lagi on v1 valik, mis kaitseb ühe
filtripäringu suurust — muutmine on seadistus, mitte arhitektuur.

**Veavastus ei tohi lekitada varjatud liikmete arvu.** Kogu tegelik suurus on
admin-tasandi info: kui haldur ei näe osa liikmetest, saaks ta arvuga 409-st nende hulga
lahutamise teel tuletada. Seega: adminile 409 koos praeguse ja lisatava arvuga; mitte-adminile
üldine mahupiiri viga ilma arvudeta. Sama reegel kehtib igal teel, kus kogu suurus välja
paistab (§4 koguvalija arv näitab kutsujale nähtavat hulka, mitte tegelikku).

Õiguste autoriteet on `access`, mitte dubleeritud kasutajakirjes. Kasutajahaldus
loeb ja muudab samu määranguid. Kasutaja vormi salvestamine saadab ainult muudetud
määrangud; mitme kogu muudatuse osaline ebaõnnestumine näidatakse kogu kaupa.
Avalik lugemisvastus ei tagasta õiguste loendit, auditivälju ega filtreerimata liikmeid.

Salvestus kasutab `save_config_with_git`-i (ADR 0040). Kogu lugemine, muutmine ja
kirjutamine on ühe lukustatud operatsiooni sees (`threading.RLock`, sama muster nagu
`metadata_lock`); `revision` väldib vananenud vormiga ülekirjutamist (409 ja uuesti
laadimine). Atomaarne failivahetus üksi ei takista samaaegsete muudatuste kaotsiminekut.
**Piirang:** lukk on protsessi-lokaalne — mitme workeriga gunicorni juures vajab
protsessideülest lukku (sama hoiatus nagu `RENDER_SEMAPHORE`). Muutusteta ja korduv
liikmesustoiming on no-op (ADR 0012 joon).

**Mida indekseerimata liikmesus ära võtab.** Liikmesuse muutmine ei puuduta Meilisearchi
ega ühtki tuletatud indeksit: ei ole sünki, dirty-lippu, osalise ebaõnnestumise taastet
ega „salvestatud / otsingus uuendamisel" vahepealset olekut. Liikmesuse muutmine
tühjendab kliendipoolse ID-loendi vahemälu selle kogu jaoks ja käivitab uue päringu.
**„Kohe" tähendab siin: ilma reindekseerimiseta — mitte seda, et juba avatud vaated
mujal uuenevad ise.**

Õiguste äravõtmine ja avaliku kogu muutmine piiratud koguks jõustuvad autoriseerimises
kohe: järgmine ID-loendi päring tagastab 403 või kitsama loendi. Õiguste vahemälud
invalideeritakse; käimasoleva vaate järgmine päring kontrollib õigust uuesti.

Kustutatud teoste viited jäetakse lugemisel vahele; neid võib järgmise salvestamisega
koristada. Puuduv teos ja katkine kogu JSON on erinevad olukorrad: katkist faili ei
tõlgendata tühja koguna ega kirjutata vaikimisi üle.

## 6. Elutsükkel

Nähtavus (`members | public`) ja olek (`active | archived`) on sõltumatud.
Eraldi mustandistaatust pole vaja: uus kogu on aktiivne ja määratud kasutajatele.

Arhiveeritud kogu ei ole päise tavavalikus, kuid otselink ning halduse arhiivifilter
avavad selle samade lugemisõigustega. Päis näitab arhiivimärget. Sisu ja liikmesuse
muutmiseks tuleb kogu taasaktiveerida; admin saab ligipääsu vajadusel kohe piirata.
Arhiveerimine ei ole ajalooline hetkepilt: teoste sisu ja lugemisõigused võivad muutuda.

Varem avaldatud kogu (`ever_published = true`) tavaliidesest ei kustutata, vaid
arhiveeritakse. Avaldamata katsetuse võib admin pärast kinnitust kustutada. Kustutamisel
säilib git-ajalugu; sama ID-d ei anta uuele kogule. Tuletatud indeksite puhastust ei ole
vaja — liikmesust ei ole kusagil mujal.

## 7. API

| Endpoint | Sisu |
|---|---|
| `GET /work-sets` | kutsujale nähtavad kogud; arhiiv eraldi filtriga |
| `POST /work-sets` | admin loob kogu, server määrab ID ja looja halduriks |
| `GET /work-sets/{id}` | lubatud metaandmed ja kutsuja võimekused |
| `PATCH /work-sets/{id}` | nimi, kirjeldus, olek; adminile ka nähtavus |
| `GET /work-sets/{id}/works` | **kutsujale loetavad** liikme-ID-d (otsingufiltri sisend) |
| `POST /work-sets/{id}/works` | `{work_ids, revision}` lisamine |
| `DELETE /work-sets/{id}/works` | `{work_ids, revision}` eemaldamine |
| `PUT /work-sets/{id}/access` | admin muudab sama õiguste allikat mõlemast haldusvaatest |
| `DELETE /work-sets/{id}` | ainult avaldamata kogu kustutamine |

Muudatused nõuavad oodatud `revision`-it. Hulgioperatsioon valideeritakse tervikuna enne
kirjutamist, kuid **lisamisel ja eemaldamisel on eri reeglid**:

- **Lisamine:** iga ID peab olema olemasolev ja kutsujale loetav teos ning mahtuma lae sisse.
  Üks keelatud, tundmatu või laest välja viiv ID → ei rakendata ühtki.
- **Eemaldamine:** piisab olemasolevast liikmesusviitest ja haldusõigusest. Teos ise ei pea
  eksisteerima — just nii koristatakse kustutatud teoste viiteid. Tundmatu või mitteliikme
  ID eemaldamine on no-op, mitte viga.

Korduv lisamine või eemaldamine on idempotentne. Identiteedi-, auditi- ja
avaldamisajaloo väljad määrab server. Klient ei tee autoriseerimisotsust.

`GET /work-sets/{id}/works` on kuum tee (iga otsing kasutab teda), aga **vastus sõltub
kutsujast**, mitte ainult kogu seisust. Vahemälureeglid:

- **Server autoriseerib iga päringu** — kogu ligipääs ja teoste lugemisõigus kontrollitakse
  uuesti, TTL-ist ei piisa. Kogu `revision` ei muutu, kui muutub kasutaja õigus või teose
  nähtavus, seega `revision` üksi ei ole kehtivuse tõend.
- **`server/cache.py` EI SOBI** selle vastuse hoidmiseks: sealsed vahemälud on globaalsed
  moodulitasandi muutujad (`_collections_cache`, TTL 300 s) ja kasutajapõhise loendi panek
  sinna oleks risti-kasutaja leke. Kui serveripoolset vahemälu on vaja, on võti
  `(set_id, revision, kasutaja, õiguste epohh)` ja õiguste muutus tühistab ta kohe.
- **Klient hoiab loendit ainult aktiivse valiku jaoks** ja laeb uuesti, kui vahetub valik,
  muutub liikmesus või muutub autentimisolek.

**Mida aegunud kliendipoolne loend saab ja mida ei saa.** Ei saa anda ligipääsu ühelegi
dokumendile: tenant-token piirab dokumente sõltumatult sellest, mis ID-d filtrisse pannakse.
Saab lasta äsja eemaldatud liikmel jätkata **samade ID-de** filtreerimist kuni järgmise
loendipäringuni — see on teadmine, mis tal juba oli, mitte uus ligipääs. Õiguste äravõtmine
jõustub täielikult järgmisel loendipäringul; seda ei tohi kirjeldada kui „kohest" brauseris.

Kõik uued teed elavad oma routeris (`server/routers/work_sets.py`), mitte `main.py`-s.
Blokeeriv I/O `async def` sees on keelatud (ADR 0002).

## 8. Teostusjärjekord ja vastuvõtt

1. Mõõta **kogu ahel**, mitte ainult Meili päring: ID-loendi laadimine koos
   õiguskontrollidega + tekstiotsing 1000 ID-ga filtriga, ning päise arvude laadimine mitme
   töökollektsiooni korral (iga kogu arv on omaette serveripäring). Tulemus otsustab lae ja
   selle, kas arvud tuleb laadida laisalt. Ainult 1000 ID-ga Meili päring ei kata uut
   serveripoolset kulu.
2. Salvestus, õigused, API, lukustus ja `revision`-kontroll.
3. Admini loomine, liikmete haldus, kasutajahalduse õiguste plokk.
4. Ühine kontekst, päisevalija, URL (`decideCollectionSync`), kõik §4 tabelis nimetatud vaated.
5. Avaldamine, ligipääsu äravõtmine, arhiveerimine, veaolukorrad.

Vastuvõtukriteeriumid:

- Admin loob kogu ja määrab kasutaja vaatajaks või halduriks kasutajahaldusest.
- Vaataja ei muuda liikmeid; haldur muudab neid ilma teose toimetamisõigust saamata.
- Piiratud teose lisamine avalikku kogusse ei muuda teose ligipääsu ühelgi lugemisteel
  (`is_public`, `collections`, `shareable` puutumata).
- Kogu liikmesust ei saa uurida otsese Meili päringu, fasseti ega isikute filtri kaudu —
  liikmesust indeksis ei ole.
- Tühi ID-loend annab null tulemust; filtrit ei jäeta ära.
- Päisevalik, otselink ja brauseri edasi/tagasi annavad kõigis vaadetes sama konteksti.
- Õiguste kadumine ei lülita kasutajat vaikselt piiramata otsingule.
- Teoste arvud ei sõltu lehekülgede arvust; lehel 2 leiduv tekstivaste läheb arvesse.
- Samaaegsed muudatused ei kao (`revision` 409); lae ületamine ei jäta osalist tulemust ja
  mitte-admini veateade ei sisalda kogu tegelikku liikmete arvu.
- Kustutatud teose viite saab kogust eemaldada; sama ID lisamine ebaõnnestub.
- Kogu arv ja sirvimistulemus näitavad sama hulka ka siis, kui kogus on `shareable`-liige.
- Kogust eemaldatud kasutaja järgmine loendipäring tagastab 403; aegunud kliendipoolne
  ID-loend ei ava ühtki dokumenti, mida tenant-token ei lubaks.
- Arhiveeritud link töötab; avaldatud kogu tavakustutamine on keelatud.
- Senised kogu-URL-id, teosekaardid ja õiguskontrollid töötavad muutmata tähendusega.
- Läbivad `npm run typecheck`, `npm test`, `.venv/bin/pytest tests/`. Võrreldakse
  päisevalija ning otsingu laadimisaega enne ja pärast.

## 9. Arutelukohad

Vaikimisi valikud, mida saab enne teostust muuta:

- **Loomisõigus jääb v1-s adminile.** Haldur korraldab sisu, ei jaga ligipääsu ega avalda kogu.
- Arhiveerimine peatab liikmesuse muutmise kuni taasaktiveerimiseni.
- Päise arvud näitavad kogu suurust kasutaja õiguste piires, mitte jooksva otsingu vasteid.
- Esialgu puuduvad: püsikogu ja töökollektsiooni samaaegne valik, isiklikud nimekirjad,
  dünaamilised salvestatud päringud, automaatne aegumine, viidatavad sisuhetkepildid,
  MCP-tugi ja „lisa kõik otsingutulemused".
- Praeguste kogude temaatilisteks ümbertõstmine otsustatakse pärast uue tööviisi proovimist.
