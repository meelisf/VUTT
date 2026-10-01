# Kasutajad ja kogude ligipääs

Kuupäev: 2026-09-14 (rev 3)
Staatus: kasutajaga kokku lepitud suuna teostusettepanek; rakendamata
Seotud: #318, #354; ADR 0031, 0038, 0042, [0043](../../decisions/0043-kogude-oiguste-uhised-toimingud.md)

## Eesmärk

Admin saab lisada inimese töökollektsiooni sealsamas, kus ta kogu haldab.
Kollektsiooni juures saab vaadata ja muuta selle kaudu antud kasutajaõigusi.
Kasutaja juures saab ülevaate sama inimese kõigist õigustest. Mõlemad
sisenemisteed kasutavad samu salvestustoiminguid ja serveri õiguskontrolle.

See täpsustab #318 esialgset suunda: kasutajate nimekiri jääb lugemisvaateks,
aga õiguste muutmine ei piirdu kasutaja detailvaatega. Link filtreeritud
kasutajanimekirja on lisavõimalus, mitte ainus viis kogu õigusi hallata.

## 1. Kasutajad

### Integratsioon olemasoleva teostusega

See on olemasoleva halduse ümberkorraldus. Enne iga etapi muutmist jälgitakse
tervet olemasolevat ahelat: vaade → klienditeenus → endpoint → helper →
salvestus ja invalideerimine → olemasolevad testid. Allolevad asukohad on
teostuse lähtekohad; uus paneel ei õigusta paralleelset õiguste süsteemi.

| Olemasolev osa | Muudatus selle töö raames |
|---|---|
| `src/pages/admin/Users.tsx`, `POST /admin/users` | Kasutajate laadimine ja konto toimingud säilivad; loend ja detail eraldatakse praegusest vaatest. Uut kasutajaregistrit ega teist loendi-API-t ei looda. |
| `src/pages/admin/WorkSets.tsx` | Olemasoleva loomise, teoste loendi ja haldustoimingute juurde lisandub ligipääsupaneel; kogu lehte ei asendata uue haldusrakendusega. |
| `src/pages/admin/Collections.tsx`, `src/components/CollectionEditor.tsx` | Lehe rollipiir eraldatakse seadete piirist. Editorist tõstetakse õiguste osa jagatavaks paneeliks; seadete, loomise ja kustutamise töövood säilivad. |
| `GET /admin/collections/{id}/users` | Olemasolevat vastust laiendatakse §5 järgi; olemasolev `collection` objekt säilib. |
| `PUT /admin/collections/{id}` | Säilib seadete endpoint'ina; `allowed_users` eemaldatakse mõlemast kliendikirjutajast (`saveAllowedUsers` ja `handleSave`) koos serveriharuga. |
| `server/auth.py` kolm `update_user_*` helperit | Olemasolev rollihierarhia, sanitiseerimine, deterministlik järjestus ja sessioonikäitumine on alus; parandatakse luku ulatus ja eraldatakse jagatav muutmisloogika. |
| `src/pages/admin/workSetAccess.ts` ja `src/services/workSetService.ts` | Taaskasutatakse `applyUserRole`, `accessChanges`, `setWorkSetAccess`, olemasolevaid tüüpe ja ID-loendi invalideerimist. |
| `src/services/apiClient.ts`, `UserContext` | Õiguste päringud läbivad olemasoleva tokeni-, timeout'i-, `ApiError`- ja 401/sessiooni aegumise käsitluse (ADR 0004). Paneelile ei tehta uut fetch/auth kihti. |
| `CollectionContext`, `collectionService.ts` | Kogude metaandmed, puu, tüübid ja olemasolevad refresh-funktsioonid jäävad kasutusse. Õiguste isikupõhiseid andmeid ei lisata avaliku konfiguratsiooni vahemällu. |
| `src/App.tsx`, `src/pages/Admin.tsx` | Detailiteed lisatakse olemasoleva laisa laadimise ja navigeerimise mustriga. Ühine kogude sisenemiskoht tekib alles etapis 4. |

Uued lisandused on ligipääsupaneel, kasutajadetaili marsruut, haldusloendi
otsing/filtrid, #318 aktiivsuse päring ning olemasolevate kasutajaõiguste
helperitega ühine delta-toiming. Delta-toimingu API paigutatakse olemasolevasse
admin-routerisse; ei lisata eraldi õiguste routerit ega salvestuskihti.
Täpne payload lepitakse teostuses kokku olemasolevate API-mustrite järgi ja
kaetakse serveri ning kliendi lepingutestiga. Välditakse terve rakenduse
teenuste või kontekstide ümberkorraldamist selle töö ettekäändel.

Iga parandusega uuendatakse sama käitumise olemasolevaid teste:
`src/pages/admin/__tests__/workSetAccess.test.ts`,
`tests/test_user_collections.py`, `tests/test_user_collections_api.py`,
`tests/test_admin_role_endpoints.py`, `tests/test_role_permissions.py` ning
`tests/test_work_sets_{api,ops,access}.py`. Uus testifail lisandub ainult uue
käitumise jaoks. Senist regressioonikaitset ei asendata paneeli testidega.

Olemasolevast käitumisest teadlikud muudatused on §5-s sõnaselgelt nimetatud:
vana kirjutusharu eemaldamine, salvestus mustandist, access-valvurite
kitsendamine, looja dekoratiivse kirje ärajätmine ning õiguste koristus.
Need vajavad olemasolevate kutsujate ja testide samaaegset kohandamist;
ülejäänud reegleid ei tuletata uue paneeli vajadustest uuesti.

### Nimekiri ja detail

`/admin/users` on kompaktne nimekiri: nimi, kasutajanimi, e-post, roll ja
viimane muudatus. Nime, kasutajanime ja e-posti otsing on diakriitikatundetu;
lisaks rollifilter ning URL-is säiliv kollektsiooni või töökollektsiooni filter.
Filtrite parameetrid on `rights_collection` ja `rights_work_set`, otsingul `q`
ning rollil `role`. Admin-leht ei kutsu `useCollectionUrlSync`-i ega muuda
aktiivset töökogu: need on haldusloendi filtrid (ADR 0038).
Otsing saab algfookuse; üles/alla ja Enter võimaldavad detaili avada.
Tagasi tulles säilivad filter ja otsing. Tühjal tulemusel on selge teade.

`/admin/users/:username` koondab praegused konto toimingud ja kolm eraldi plokki:
piiratud kollektsioonide lugemisõigus, contributori kirjutamisulatus ning
töökollektsioonide vaataja/halduri määrangud. Rolli muutmine, parooli lähtestus
ja kustutamine jäävad siia. Olemasolevad rollihierarhia ja iseenda piirangud
säilivad; parooli enda jaoks lähtestamise erand säilib samuti.

Viimane muudatus tähendab git-commit'i, mitte viimast sisselogimist.
#318 aktiivsuse lahendus säilib: adminiga kaitstud `/admin/users/activity`,
üks git-log läbimine, TTL 300, blokeeriv töö threadpoolis. Autor seotakse
kasutajaga ainult täpse kasutajanime alusel. Puuduv vaste kuvatakse kriipsuna.
Aktiivsuse laadimisviga ei blokeeri kasutajahaldust ega tähenda tegevusetust.

## 2. Kogu juures olev ligipääsupaneel

Paneel avaneb kogu juures ilma kasutajate nimekirja suunamata. See sisaldab
õiguste selgitust, inimesi ning adminile kasutajaotsingut ja lisamist.
Kasutaja nime juurest saab admin avada tema detaili. Teoseid nimetatakse
„Teosteks” ja inimesi „Kasutajateks”; praegune „liikmed” ei pea tähistama mõlemat.

### Kollektsioon

Näidata eraldi lugemisõigust ja kirjutamisulatust ning nende alust:
„avalik”, „määratud” või „rollist tulenev”. Contributori kirjutamisulatust
saab muuta ka avalikul kollektsioonil. Toimetaja kirjutamisulatus on üldine,
aga piiratud teose lugemisõigust vajab ta endiselt. Admin+ ligipääs on üldine.
Rollist tulenevat õigust ei kuvata eemaldatava käsitsi määranguna.

Kehtiva lugemisõiguse määrangu saab lisada ainult piiratud kollektsioonile. Avalikul
kollektsioonil on alus „avalik” ning lugemisõiguse lisamist ei pakuta; server
keeldub avalikule kogule määrangu lisamisest selge valideerimisveaga. Vana
avaliku kogu määrangu eemaldamine on lubatud koristustoiming, mitte ligipääsu
äravõtmine. Nähtavuse muutmine ei kirjuta kasutajaid ega korista määranguid.
Avaliku kogu vana määrang kuvatakse kasutajadetailis märkega „Praegu ei mõju:
kogu on avalik” ning lubatakse käsitsi eemaldada. Kui kogu muutub taas
piiratuks ja määrang on alles, hakkab see uuesti mõjutama ligipääsu; nähtavuse
vorm selgitab seda. Vana `update_user_allowed_collections` täisasendus võib
avaliku ID restricted-sanitiseerimisel eemaldada. Uus delta muudab ainult
nimetatud määranguid, nii et mõne teise kogu muutmine jäänukit vaikselt ei kustuta.
Lisatavate määrangute restricted-reegel säilib mõlemal teel.


Kirjutamisulatuse lisamine ei lisa vaikselt lugemisõigust. Kui contributorile
määratakse piiratud kogu ulatus ilma selle lugemisõiguseta, selgitab paneel,
et see üksi ei ava piiratud teoseid, ja pakub eraldi lugemisõiguse lisamist.
Virtuaalsele rühmale ei pakuta contributori kirjutamisulatust.

Paneeli tähendus on „Selle kollektsiooni kaudu antud õigused”. See ei ole
tõend kõigi kogu teoste tegeliku ligipääsu kohta: mitmesse kollektsiooni
kuuluv teos võib olla avalik teise kollektsiooni kaudu või lingiga jagatav.
Samuti võib contributoril olla kirjutamisulatus teise kollektsiooni kaudu.
Selgitus peab ütlema, et teose ligipääsu võivad mõjutada teised määrangud.
Täielik teosepõhine ligipääsuaudit ei kuulu sellesse muudatusse.

Praegune `/admin/collections` on tervikuna superadmin-only. Kollektsioonide
etapi (etapp 2) esimese sammuna tuleb selle ümbris avada adminile kogu loendi ja ligipääsu vaatamiseks;
`CollectionEditor` koos struktuuri, nähtavuse ja muude seadete muutmisega
jääb eraldi superadmini osaks. Serveri seadete muutmise piirang jääb alles.

### Töökollektsioon

Admin otsib inimese, valib „Vaataja” või „Haldur” ja salvestab kogu juures.
Olemasolevat määrangut saab muuta või eemaldada. Kogu loomise järel on sama
paneel kohe kättesaadav. Adminite üldine haldusõigus kuvatakse selgitusena,
mitte ei nõuta kõigi adminite lisamist õiguste loendisse. Admin+ kasutajaid
ei pakuta lisamiseks; server keelab nende uued määrangud. Vana kirje kohta
kuvatakse, et haldusõigus tuleneb rollist. Vana kirje koristamise piirid on §5-s.

Avalikul töökollektsioonil selgitatakse, et sirvimiseks pole isiklikku
vaatajamäärangut vaja. Olemasolevad määrangud jäävad nähtavaks ja muudetavaks,
sest need on olulised kogu hilisemal piiramisel. Arhiveerimine ei peida õigusi.

Tekst lisamise juures: „Töökollektsiooni õigus ei anna juurde teoste lugemise
ega tekstide muutmise õigust. Kasutaja näeb siin talle lubatud teoseid.”
Varjatud teoste arvu, pealkirju ega ID-sid ei avaldata.

Kui aktiivse töökollektsiooni õigus võetakse ära, säilib ADR 0042 kohane
ligipääsuviga: seda ei tõlgendata tühja kogu ega piiramata otsinguna.
Olemasoleva `useSelectionScope.ts` ja `Dashboard.tsx` veavaate juurde lisada
„Lähtesta valik”, mis kasutab olemasolevat koguvaliku muutmise teed.
Üleminek toimub kasutaja tegevusel, mitte vea korral vaikselt.

## 3. Rollipiirid

| Toiming | Superadmin | Admin | Editor / contributor |
|---|---|---|---|
| Kollektsiooni struktuur ja seaded | Jah | Ei | Ei |
| Kollektsiooni kasutajaõigused | Ainult madalama rolliga kasutaja | Ainult madalama rolliga kasutaja | Ei |
| Töökollektsiooni loomine ja avaldamine | Jah | Jah | Ei |
| Töökollektsiooni õiguste jagamine | Jah (sihtmärk editor/contributor; päranderand §5) | Jah (sihtmärk editor/contributor; päranderand §5) | Ei |
| Töökollektsiooni sisu, nimi, kirjeldus, arhiveerimine | Jah | Jah | Selle kogu haldur |
| Töökollektsiooni kustutamine | Kui pole kunagi avaldatud | Kui pole kunagi avaldatud | Ei |
| Teose lugemine ja muutmine | Senised teosepõhised kontrollid | Senised teosepõhised kontrollid | Senised teosepõhised kontrollid |

Kogu haldur ei ole uus üldroll. Praegune API lubab halduril näha oma
töökollektsiooni õiguste kaarti, kuid muuta seda saab ainult admin+.
Sellele haldurile võib kuvada senise kaardi kasutajanimesid lugemisvaates;
üldist kasutajaloendit ja e-posti ei laadita. Vaatajale ei tagastata teiste
kasutajate õigusi. Sama paneel on rolliti erinev: admin näeb kuvanime ja
kasutajanime ning otsib ka e-posti järgi; haldur näeb ainult kasutajanimesid
lugemisvaates. Haldur ei saa kasutaja olemasolu kontrollimiseks üldloendit.
Kollektsiooni õiguste üldvaade jääb admin+ tasemele.

## 4. Ühine „Kogud” sisenemiskoht

Neljandas etapis koondada halduse kaks senist sisenemiskohta ühe „Kogud” alla.
Tüübifilter: kõik / kollektsioonid / töökollektsioonid; lisaks nimeotsing.
Kollektsioonide hierarhia säilib ja tüüp on igal kirjel nähtav. Eri andmemudeleid
ei liideta. Kogu detailis on vastavalt õigustele „Teosed”, „Ligipääs”, „Seaded”.
Vanad URL-id jäävad suunamiste või sobivate filtritega toimima.

Editor ja contributor avavad neile nähtava kogu oma töövaatest. Töökollektsiooni
haldur näeb oma haldustoiminguid ilma üldise kasutajahalduse ligipääsuta.
Admini või superadmini tabide peitmine ei asenda serveri autoriseerimist.

## 5. Salvestamine ja kooskõla

### Olemasolevad teed ja nende asendamine

Õiguste autoriteetsed asukohad säilivad: `users.json` väljad
`allowed_collections` ja `edit_collections`, töökollektsiooni `access`.
Kasutaja- ja kogupaneel on kaks sisenemisteed samadele toimingutele (ADR 0043).

`PUT /admin/collections/{id}` olemasolev `allowed_users` haru eemaldatakse.
See käib praegu üle kõigi kasutajate, ei kasuta `can_manage_user`-it ega
restricted-sanitiseerimist, järjestab `list(set(...))` abil ja salvestab alati.
Seda ei jäeta uue tee kõrvale. `allowed_users` sisend lükatakse tagasi enne
seadete salvestust (selge 400), et vana klient ei saaks vaikset eduvastust.
`CollectionEditor.saveAllowedUsers` ja kõik selle välja saatmised viiakse
samal etapil üle uuele õiguste toimingule. Õiguste salvestus ei saada kaasa
`visibility`-t; nähtavuse muutmine jääb eraldi superadmini toiminguks.

Lugemiseks laiendatakse olemasolevat `GET /admin/collections/{id}/users`
(admin+): säilivad `collection` ja `allowed_users`, lisanduvad `edit_users`,
`visibility` ja `is_virtual` (konfiguratsiooni `type == virtual_group` põhjal).
`edit_users` sisaldab kõiki selle ID-ga salvestatud kirjutamisulatuse määranguid,
ka editor/admin omi. Paneel märgib need „Salvestatud ulatus ei piira: õigus
rollist” ning lubab inertse määrangu eemaldada olemasoleva sihtrolli kontrolli
piires. Rollist tulenev õigus ise pole eemaldatav. Avalikul kogul näitab
`allowed_users` samuti salvestatud määranguid, mitte kehtivat õigust: `visibility`
määrab avaliku aluse ja jäänuki märgistuse. Nii säilib GET-i senine tähendus
ning salvestatud andmed ei kao lugeja rolli-/nähtavusfiltri taha. Paralleelset
kollektsiooniõiguste lugejat ei looda. Vastus koostatakse luku all võetud
kasutajate hetktõmmisest, mitte muutuvast jagatud cache-objektist.

### Delta-toiming ja lukk

Uus adminiga kaitstud delta-toiming võtab kasutaja ja kollektsiooni kaupa
ainult muudetud lugemis-/kirjutamismäärangud, mitte tervet kasutaja loendit.
Üks päring võib sisaldada mitme inimese muudatusi; valideeritakse kogu pakett
ning vea korral ei rakendata sellest midagi. Samale määrangule vastuolulised
kordused lükatakse tagasi. Muud kasutajad ja kollektsioonid jäävad puutumata.
Mõlemad kliendivaated kasutavad seda toimingut; vanad kasutajapoolsed endpoint'id
kasutavad sama keskset valideerimis- ja muutmisloogikat kuni nende asendamiseni.
Sama määrangu puhul kehtib viimane edukalt salvestatud otsus; eri määrangute
deltad ei kirjuta üksteist üle. Kliendile tagastatakse kinnitatud lõppolek.

Konkreetne eeltöö: `update_user_role`, `update_user_allowed_collections`,
`update_user_edit_collections` ja uus delta-toiming viia tervikuna
`with users_lock:` alla, alates `load_users()`-ist läbi kontrollide ja
muudatuste kuni `save_users()`-ini. `users_lock` on olemasolev `RLock`.
Praegu lukustab `save_users` ainult kirjutamise; `load_users` tagastab jagatud
`_users_cache` objekti. Lukk peab vältima ka seda, et üks lõim muudab dicti
teise lõime `atomic_write_json` serialiseerimise ajal.

Samal etapil auditeerida ülejäänud jagatud kasutajaobjekti kirjutajad
(kustutamine, konto loomine, parooliuuendused, kollektsiooni koristus) ja viia
nende loe-muuda-salvesta tsüklid sama luku alla. Ainult nelja tee lukustamine
pole piisav, kui mõni muu tee muudab cache-objekti lukuta. Kontrollida
sessiooni- ja reset-tokeni lukkude järjekorda; aeglast kõrvaltegevust
ei lisata pimesi kasutajaluku sisse. See RLock kaitseb ühe protsessi lõimi;
mitme kirjutava protsessi tugi vajaks eraldi protsessidevahelist lahendust.

Kollektsiooni kustutamise `_cleanup_allowed_collections_on_delete` laiendatakse
mõlemale väljale (`allowed_collections` ja `edit_collections`) sama luku all.
Varem kustutatud kogu ID kuvatakse kasutajadetailis „Kustutatud kollektsioon
(<id>)” koos eemaldamisega; seda ei käsitleta kehtiva õigusena. Koristus-delta
lubab eemaldada puuduvat ID-d, kuid ei luba seda lisada. Eemaldamine ei kirjuta
muid õigusi ümber. Nähtavuse muutmise endpoint kasutajaid ei kirjuta.

### Salvestamine ja sessioonid

Paneelid koguvad muudatused mustandisse. „Salvesta muudatused” rakendab paketi,
„Loobu” taastab laaditud oleku. Iga valiku/checkbox'i peale päringut ei tehta.
Kollektsiooni lugemisõigus ja kirjutamisulatus salvestatakse ühes paketis,
`users.json` kirjutatakse üks kord ning iga tegelikult muudetud kasutaja
sessioonid invalideeritakse ühe korra. Muutusteta pakett ei kirjuta ega
invalideeri. Sama kehtib kollektsiooni kustutamise koristusele.

Enne kollektsiooniõiguste salvestust näidatakse: „Õiguste muutmisel peavad
mõjutatud kasutajad uuesti sisse logima.” Viis muudetud kasutajat tähendab
endiselt viie inimese sessioonide lõppu; koondsalvestus väldib ühe inimese
korduvat väljalogimist sama redigeerimiskorra jooksul. Töökollektsiooni `access`
muudatus ei lõpeta sessioone: API kontrollib seda iga päringu ajal.

Kasutaja detaili eri töökollektsioonid salvestuvad eraldi revision-kaitsega
päringutena, mitte ühise failideülese tehinguna. Osalise edu korral kuvatakse
õnnestunud ja ebaõnnestunud muudatused eraldi; juba salvestatut ei saadeta uuesti.
Laadimisviga ei muutu tühjaks õiguste kaardiks ega luba selle salvestust.

### Töökollektsiooni access-valvurid ja vanad kirjed

Mõlemad vaated kasutavad `src/pages/admin/workSetAccess.ts` olemasolevaid
`applyUserRole` ja `accessChanges` funktsioone koos nende testidega ning
`workSetService.setWorkSetAccess`-i. Mitme kasutaja mustand koostatakse samade
funktsioonide abil; paneeli sisse ei teki teist access-kaardi muutmise loogikat.

**Otsus: säilitada `PUT /work-sets/{id}/access` täisasendus.**
Teoste POST/DELETE tee kasutab juba `mutate_members` deltasi; access-i delta
oleks samuti võimalik, kuid selles muudatuses säilib `setWorkSetAccess` API.
See vähendab protokolli üleminekut olemasolevas kasutajavaates. Hinnaks on
alljärgnev kohustuslik täieliku kaardi leping, mitte vaikimisi eeldus.

- Klient alustab serverilt laaditud tervest `access`-kaardist. Filtrid, otsing
  ja nähtavad read muudavad ainult kuvamist. Lukustatud superadmini/võrdse
  admini kirjed ja puutumata kustutatud kasutaja kirjed saadetakse muutmatult
  kaasa. `applyUserRole` muudab ainult valitud võtit; `accessChanges` ei tohi
  ehitada kaarti nähtavatest või muudetavatest ridadest.
- Server arvutab vana ja uue kaardi võtmete ühendi pealt diffi: lisatud,
  muudetud, muutmata, eemaldatud. Puuduv vana võti tähendab eemaldamist.
  Kirjepõhised valvurid rakenduvad sellele diffile tervikuna; ühe keelatud
  muudatuse korral ei salvestata midagi. Lukustatud võtme kogemata väljajätmine
  annab vea, mitte vaikse õiguse eemaldamise. Muutmata pärand lubatakse läbi.
- `revision` on kohustuslik. Kaardi lugemine, revision-kontroll, diff,
  valvurid ning salvestus toimuvad `_work_sets_lock` all samas olemasolevas
  `work_sets_ops.py` kihis. 409 korral laaditakse uus olek, säilitatakse
  kasutaja kavatsus võrdlemiseks ja näidatakse konflikti; ei automaatset
  kordussaatmist ega automaatset ühendamist.

**Lukkude leping:** kasutajate kopeeritud hetktõmmis (olemasolu ja rollid)
võetakse `users_lock` all ja see lukk vabastatakse ENNE `_work_sets_lock`-i.
`users_lock`-i ei võeta kunagi koguluku sees; neid lukke ei hoita korraga.
Kogutoiming kasutab ainult kaasa antud hetktõmmist, ei kutsu seal `load_users`-it.
Sama reegel kehtib koristus- ja migratsioonikoodile.

See annab kirjete valideerimise päringu hetktõmmise järgi, mitte tehingut
users.json ja kogufaili vahel. Vahepealne kasutaja kustutamine võib jätta
inertse jäänuki; vahepealne ülendamine adminiks dekoratiivse kirje. Mõlemat
taluvad allolevad reeglid ning nime taaskasutuse register välistab jäänuki
pärimise uue konto poolt. Teose ligipääs ja kutsuja autoriseerimine jäävad
seniste päringupõhiste kontrollide alla.

Otsused serveris, mitte ainult kasutajaotsingu filtris:

- Uus või muudetud määrang peab viitama olemasolevale editor/contributor'ile
  ja läbima `can_manage_user` kontrolli. Lubatud väärtused on viewer/manager.
  Admin+ uut määrangut ega vana kirje viewer/manager muutmist ei lubata.
- Olemasoleva admin+ kirje võib jätta muutmata. Eemaldada tohib enda või
  rangelt madalama rolliga kasutaja vana kirje; admin ei saa eemaldada ega
  muuta superadmini kirjet. Võrdse rolliga teise inimese kirje jääb lukustatuks.
  See erand koristab dekoratiivset määrangut, üldine haldusõigus ei muutu.
- `create_work_set` lõpetab administ looja automaatse lisamise `access`-kaarti;
  `created_by` jääb auditiinfoks. Vanade kogude jaoks ei tehta massmigratsiooni.
- Kustutatud kasutaja olemasoleva kirje võib muutmata säilitada või adminina
  eemaldada, kuid selle rolli muuta ei saa. Uus tundmatu kasutajanimi lükatakse
  tagasi. Ühe surnud kirje olemasolu ei blokeeri teiste õiguste salvestamist.
- Lisada `server/config.py`-sse `WORK_SET_MAX_MEMBERS` kõrvale eraldi
  `WORK_SET_MAX_ACCESS = 1000` kirjete piir; uut konstandifaili ei looda.
  Üle piiri uut kaarti ei salvestata; piiri ületav pärandkaart võib jääda
  muutmata (no-op) või väheneda ainult kirjete eemaldamisega.
  Olemasolevate õiguste automaatset kärpimist ei tehta. Piir on kaitsepiir,
  mitte mõõdetud kasutajate mahutavus.

`delete_user` ei kirjuta kustutamisel N töökollektsiooni ümber ega tõsta nende
revision-e. Adminipaneel kuvab jäänuki „Kustutatud kasutaja (<username>)” ja
pakub eemaldamist. Halduri lugemisvaates jääb kasutajanimi: tal pole üldloendit,
mille põhjal kustutamist kindlaks teha.

### Konto loomine, kustutamine ja kasutajanimede register

Kasutajanime ei taaskasutata pärast kustutamist ka siis, kui kõik access-kirjed
on koristatud. `delete_user` lisab nime püsivasse kustutatud nimede registrisse
`state/deleted_usernames.json`; tee defineeritakse `server/config.py`-s
olemasoleva `_STATE_DIR` põhjal. Mälus hoitakse `set`-i: konto loomise nimekontroll
on O(1) liikmesuskontroll, ei skanni töökollektsioonide faile. Register on
konto elutsükli autoriteetne olek ja kuulub state-varundusse, mitte `cache.py`-sse.

Registri loe-muuda-salvesta kasutab sama `users_lock`-i. Kustutamisel salvestatakse
nimi atomaarse kirjutusega registrisse ENNE konto eemaldamise salvestust.
Registri kirjutusveaga kontot ei eemaldata. Kui konto salvestus seejärel
nurjub, jääb nimi reserveerituks, olemasolev konto aga alles; kustutamist saab
uuesti proovida. Reserveeritus ei blokeeri olemasoleva konto sisselogimist.
Katkist registrit ei käsitleta tühjana: konto loomine/kustutamine annab vea.
Cache avaldatakse alles eduka kirjutamise järel; vea korral ei jää mällu
salvestamata kustutatud või loodud kontot.

`registration.create_user_from_token` on etapi 1a eraldi ülesanne:
kasutajanime valik (`while username in users`), kontroll kustutatud nimede
registri vastu ja konto lisamine/salvestamine viiakse ühe `users_lock` alla.
Praegu valitakse nimi väljaspool lukku ning kirjutatakse otse
`atomic_write_json(USERS_FILE, users)`, möödudes `save_users`-ist. Kasutada
ühist salvestusteed, mitte säilitada teist kirjutajat. Ka kaks samaaegset
kutset ei tohi valida sama nime. Kallis parooliräsi arvutatakse enne lukku;
olemasolev tokeni validate/consume ning `_unconsume_token` salvestusvea korral
säilivad. Tagastus võetakse kinnitatud tulemusest, mitte hiljem muutuvast cache'ist.
Kutse nime-ettepanek kasutab sama reserveeritud nime kontrolli; konto loomisel
kontrollitakse nime siiski uuesti luku all ja leitakse senise tava järgi vaba
numbrilise sufiksiga nimi.

Varem kustutatud nimesid uus register tagasiulatuvalt ei tea. Etapis 1a tehakse
ühekordne olemasolevate access-kaartide puuduva kasutaja nimede import registrisse,
mitte skann iga konto loomisel. See on juurutuse eelsamm peatatud kontokirjutustega;
katkine kogufail katkestab impordi, mitte ei jää vaikides vahele. Kogufaile ei
muudeta. Juba varem taaskasutatud nime puhul pole endist identiteeti andmetest
võimalik usaldusväärselt taastada; seda muudatus automaatselt ei lahenda.

Kasutajate andmeid tagastavad endpoint'id jäävad `/admin/` alla ja nõuavad
admini; töökollektsiooni senine haldurile piiratud kaart on eraldi olemasolev
leping. Kasutajapõhiseid õiguste vastuseid ei panda `server/cache.py`-sse.
Pärast salvestust laaditakse kinnitatud olek uuesti; vaate vahetamisel ei
näidata vana kliendikoopiat autoriteetse olekuna.

## 6. Teostusjärjekord ja vastuvõtt

Etapid 1a ja 1b on eraldi PR-id otse `main`-i vastu, järjestikku pärast eelmise
liitmist: virnastatud PR-idele siin CI kontrolle ei tule. 1a on serveriparandus,
mida saab testida ja juurutada olemasoleva kasutajaliidesega; 1b lisab paneeli.

**1a — server ja konto elutsükkel.** ADR 0043; kolme `update_user_*` helperi
ja uue delta-toimingu täielik lukk, teiste kasutajakirjutajate audit;
`registration.create_user_from_token` nimevaliku võidujooksu ja otsese kirjutuse
parandus; kustutatud nimede register ning ühekordne import; access-diffi valvurid,
hetktõmmise/lukkude leping ja mahupiir. Olemasolev PUT kuju ja vastused säilivad;
katsed kontrollivad ka praeguse `Users.tsx` saadetavaid kaarte. Uued piirangud
annavad praeguse kliendi tavapärase veateate. Vana kollektsiooni `allowed_users`
haru lukustatakse selle etapi auditiga, kuid eemaldatakse koos kliendiga etapis 2.

**1b — töökollektsiooni paneel.** Olemasolevate `workSetAccess.ts` funktsioonide
ja teenuse taaskasutus, täieliku kaardi säilitamine filtreerimisel, koondsalvestus
ning „Lähtesta valik” ligipääsu kadumisel. Admin loob kogu ja muudab kasutajaid
sealsamas. Muutus kajastub kasutajavaates, revision-konflikt säilitab teiste töö.

2. Eemaldada PUT-i `allowed_users` haru ja viia `CollectionEditor` ühisele
   koondsalvestusega delta-toimingule; laiendada olemasolevat GET users endpoint’i
   ning mõlema õiguse koristust kustutamisel. Seejärel kollektsioonide adminile
   ligipääsetav loend ja ligipääsupaneel, superadmini
   seadete eraldamine. Admin ei saa muuta kogu struktuuri ega endaga võrdse
   või kõrgema rolliga kasutaja kollektsiooniõigusi ka otse API kaudu.
3. Otsitav kasutajanimekiri ja detailvaade koos filtrite, klaviatuuritoe ning
   #318 viimase muudatuse infoga. Konto senised toimingud säilivad.
4. Ühine „Kogud” sisenemiskoht, tüübiotsing ja rollile vastavad detailivaated.

Kontrollida vähemalt: piiratud kogu lugemisõiguseta editor; lugemisõiguseta
kirjutamisulatusega contributor; avalik kollektsioon; mitmesse kollektsiooni
kuuluv teos; töökollektsiooni haldur ilma teksti muutmise õiguseta; vaataja;
admin ja superadmin; avalik ja arhiveeritud töökollektsioon; kasutaja kustutamine
enne määrangu salvestust; kaks samaaegset õiguse muudatust; laadimise ja salvestuse
vead. Kontrollida ka teise kasutaja andmete puudumist vaataja API-vastuses.

Lisakontrollid olemasolevate teede vastu:

- Avalikule kollektsioonile lugemisõiguse lisamine: nupp puudub, otsepäring
  keeldub; kirjutamisulatuse muutmine avalikul kogul töötab.
- Vana PUT `allowed_users` keeldub enne kõrvalmõjusid; CollectionEditor ei
  saada enam seda välja ega salvesta õigusi iga kliki peale.
- Kaks admini muudavad samas kollektsioonis eri kasutajaid: mõlemad deltad
  säilivad `users.json`-is ja serialiseerimine ei näe muutuvat dicti.
- Lugemis- ja kirjutamisõiguse ühine salvestus: üks invalideerimine inimese
  kohta; no-op null; vigane pakett ei rakendu osaliselt.
- Admin proovib lisada admin+ määrangut või muuta/eemaldada superadmini vana
  töökollektsioonikirjet; enda dekoratiivse kirje eemaldamise erand.
- Tundmatu kasutajanimi PUT access-is; kustutatud kasutaja vana kirje
  säilitamine/eemaldamine ning keelatud muutmine ja nime taaskasutamine.
- Access-mahupiir, üle piiri pärandkaardi vähendamine, looja `created_by`
  säilimine ilma admini automaatse access-kirjeta.
- Kustutatud kollektsiooni jäänuk `edit_collections`-is; mõlema välja koristus
  kustutamisel; avalikuks muutmine ei kirjuta users.json-i; vana määrangu
  taasjõustumine piiramisel ning jäänuki käsitsi eemaldamine.
- Halduri paneel ei laadi üldist kasutajaloendit; admini nimed ja halduri
  kasutajanimed renderduvad eraldi; adminifilter ei muuda aktiivset kogu.

- Filtreeritud kliendivaade säilitab kõik puutumata access-võtmed; lukustatud
  võtme väljajätmine PUT-ist lükatakse tervikuna tagasi. Serveri diff katab
  kõik neli kirjekategooriat ja valideerimisviga ei tõsta revision-i.
- Lukkude leping: kogutoimingu sees ei kutsuta `load_users`-it ega võeta
  `users_lock`-i; samaaegne kasutaja kustutamine talutakse jäänukina.
- Kaks samaaegset `create_user_from_token` kutset saavad eri nimed; kustutatud
  nime ei taastata ka pärast access-koristust. Registri- ja kontofaili kirjutusvead,
  katkine register, tokeni taastamine ja ühekordse impordi katkestamine.
- Editor'i salvestatud `edit_collections` ilmub GET-is ja paneelis inertse
  määranguna, eemaldamisel rollist tulenev ulatus säilib.
- Õiguse kaotanud kasutaja näeb viga koos „Lähtesta valik” tegevusega;
  enne vajutust ei muutu päring piiramata korpuse päringuks.

I18n lisatakse eesti ja inglise keeles korraga. Otsingu/filtri ja õiguste
kuvamise utilid saavad vitest-katte; serveri testid katavad rollipiirid,
konfliktid ja teiste õiguste säilimise. Teostuse väravad: `npm run typecheck`,
`npm test`, `npm run lint:ci`, `.venv/bin/pytest tests/`, frontend build ja
brauseris mõlema keele ning rollide töövoogude kontroll.

Pagineerimine, registreerimistaotluste ümbertegemine, aktiivsuse ajajoon,
kogude struktuuri sisuline ümberkorraldus (#319) ja õiguste maatriks jäävad välja.
