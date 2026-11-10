# Eksemplari leht — disain

**Kuupäev:** 2026-11-10 · **Issue:** #696 · **Alus:** ADR 0076, ADR 0079
**Seis:** disain valmis, ootab kasutaja kinnitust. Seejärel teostusplaan.

Märgistus: **[K]** = kasutaja otsus (tema sõnadega kinnitatud); **[M]** = minu valik, mida
kasutaja ei ole vaidlustanud ja mida ehitaja võib põhjendatult täpsustada.

## Miks

Eksemplar on VUTT-is olemas viies kohas (infopaneeli lühiread, metaandmete modaali
toimetamisvorm, piltide alamleht `/work/:id/exemplar/:eid`, halduse lehe päritolu valik,
MCP), aga kohta, kus eksemplar oleks tervikuna näha, ei ole:

- kirje pikki välju (seisund, köide, provenients, konvoluudi sisu, märkus) näeb ainult
  admin modaalis;
- eksemplari leht näitab ainult pilte;
- metaandmete modaalis on kaks salvestusloogikat korraga (metaandmed nupuga, eksemplarid kohe).

Järgmine töö on paber (vaatlused, vesimärgifotod, IPH). Põhikasutaja on paberiuurija
(doktorant); eksemplari kirje on vajalik kõigile. Leht peab olema koht, kuhu paber
loomulikult lisandub.

## Eesmärgid

- Üks leht, kus teose eksemplarid on tervikuna näha: kirje täisvaade + pildimaterjal.
- Kirje toimetamine samal lehel; metaandmete modaal vabaneb eksemplaridest.
- Leht näeb hea välja kolmes seisus:
  1. ainult kirjed (Jaansoni leidumus; pilte ega paberit pole) — praegu kõige tavalisem;
  2. alus + paber (pärast paber.ut.ee importi: vaatlused, võrdluspilte pole);
  3. alus + teise eksemplari pildid (6mwgby; kõrvutus).
- Kahte eksemplari saab kiiresti kõrvuti läbi lapata.
- Paber mahub hiljem samale lehele ilma ümberehituseta.

## Mitte-eesmärgid

- Paber: vaatlused, vesimärgifotod, IPH puu, „seotud vesimärk", trükise formaat,
  paber.ut.ee import. **Järgmine töö.** [K]
- Lehtedeta teos (teos ilma sisupiltideta). Erand, mitte kasutusjuht: eesmärk on teos
  alati digituna VUTT-i saada. [K] Meili, avalehe loendurid ja kaanepilt ei muutu. [M]
- Halduse ja eksemplari lehe kokkusulatamine. [K]
- Kolme poole kõrvutus; paberipaneel kõrvutuses. [M]
- Eksemplari kirje serveripoole, piltide üleslaadimise ja ADA impordi ümbertegemine.
- Töövaade (Workspace) ei muutu: eksemplari pildid sinna ei jõua (ADR 0079 p 3).

## Anti-eesmärgid (läbikukkumine, isegi kui töötab)

- Hõre teos näitab suurt tühja ala või kriipsudega täidetud tabelit.
- Aluse puudumine jääb märkamatuks või on peidetud võltseksemplari taha.
- Eksemplari kirje jaoks tekib teine, paralleelne vorm või kirjutustee.
- Poolitus või kustutus jätab pildipaari vaikselt valele lehele viitama.
- Töölaua pildivaatur käitub pärast „suurendus koos" lisamist teisiti.

## Leht

### Raam [K]

Sama raam mis `/work/:id/manage` (`WorkManage.tsx`): `max-w-4xl` keskveerg, tagasilink,
ikooniga pealkiri „Eksemplarid" + teose pealkiri, valged kaardid (`rounded-xl`), pisipiltide
võrk veerulaiuse liuguriga. Mockup: `paigutus-v6-halduse-raam.html`, detailid
`leht-v7-detailid.html` (mõlemad `.superpowers/brainstorm/2115728-1794336221/content/`).

Kaalutud ja kõrvale jäetud: loend vasakul (`paigutus-v4`), töölaua-laadne „pildid vasakul,
info paremal" (`paigutus-v5`).

### Aadress [M]

- `/work/:workId/exemplar/:exemplarId?` — olemasolev marsruut, `exemplarId` muutub
  valikuliseks. Spike'i `/work/:id/exemplars/…` ei tule.
- Ilma id-ta vaikimisi valik: esimene piltidega eksemplar → alus → rida „Teose lehed" →
  esimene eksemplar.
- Rea „Teose lehed" valik, avatud pilt ja kõrvutuse pooled on URL-is (täpne kuju ehitajal;
  praegused `?image=` ja `?compare=` on eeskuju). Põhjus: jagatav link, ja paberi töös
  lisandub samasse skeemi vaatlus („seotud vesimärk" vajab linki konkreetse vaatluseni).
- `?page=N` kannab töölaual avatud lehte: tagasilink „Tagasi lehele N" (muidu „Tagasi teose
  juurde") ja kõrvutuse vaikimisi teose leht.

### Kaart „Eksemplarid" (loend + kirje) [K raam, M detailid]

- Üks rida eksemplari kohta, järjekord `orderExemplars` (alus esimesena, siis salvestatud
  järjekord). Kinnisel real: hoidja võti (paks), kohaviit; kui kohaviita pole, hoidja
  täisnimi hallilt; aluse pill „transkriptsiooni alus"; välislingi kiip; materjali arv
  („25 lehte", „6 pilti"); adminil järjestusnooled ja „vajab ülevaatust".
- **Valitud rida on lahti** ja näitab kirjet: ainult täidetud väljad [M] (Hoidja täisnimi,
  Koopia liik + allikas, Erandlehed, Seisund, Köide, Provenients, Konvoluut, Märkus,
  Allikas) ja adminil toimingud (Muuda, Märgi aluseks / Eemalda aluse märge, Märgi üle
  vaadatuks, Kustuta). Eraldi infokaarti ei ole: hoidja nimi ei kordu kaks korda.
- Konvoluut lahtisel real: kohaviit · koht · arv; selle all olemasolev plokk „Samas köites"
  (`SameVolumeBlock`, tuletatud lingid VUTT-i teostele) ja vabatekst `convolute.contents`.
- **`convolute.contents` silt muutub** [M]: praegune „Sisukord (vabatekst)" on
  mitmetähenduslik (kasutaja küsis, mille sisukord). Uus silt: **„Köite sisu"**, vihje
  „kõik samas köites olevad trükised, ka need, mida VUTT-is ei ole". Väli ise ei muutu
  (ADR 0076 p 6: VUTT-is puuduv trükis ei saa kirjet, temast räägivad `total` ja `contents`).
- **Toimetamine** [K]: „Muuda" teeb lahtise rea vormiks. Vorm on olemasolev
  `ExemplarsSection` ümber tõstetuna — samad väljad, sama valideerimine, korraga üks
  mustand, salvestub oma nupuga, iga kirjutuse järel loend serverist uuesti. Erinevus:
  rühmad (konvoluut, füüsiline eksemplar) on kohe lahti, mitte „Rohkem ▾" taga.
  Salvestamata mustandit kaitseb `useUnsavedChangesGuard` + `UnsavedChangesDialog`.
- „＋ Lisa eksemplar" kaardi päises (admin); käsikirjal ühe eksemplari piirang ja vihje
  nagu praegu. Eksemplarideta teosel on kaardis ainult tühi seis + „Lisa eksemplar".

### Rida „Teose lehed" (alus märkimata) [K]

Kui teosel on lehti ja ühelgi eksemplaril ei ole `text_witness`-it, on loendi lõpus eraldi
(kollane) rida: „Teose lehed · N — pole märgitud, millise eksemplari skaneering see on".
Rida EI ole eksemplar (spike'i võltseksemplari ei tehta). Adminil nupp **„Märgi alus…"**:
valik olemasolevate eksemplaride seast → sama kirjutus ja kinnitus mis praegune „Märgi
aluseks" [M]. Avalik lugeja näeb rida ilma nuputa [M]. Rida on valitav: all on siis teose
lehed.

Kui alus on märgitud, seda rida ei ole. Teadmata päritoluga lehed (`unknown_pages`)
kuvatakse samal kujul eraldi real „Teadmata päritoluga lehed · N" [M].

### Pildimaterjal: üks reegel [K põhimõte, M sõnastus]

Alus käitub nagu üks eksemplar teiste hulgas. Igal eksemplaril on kaks võimalikku osa,
leht näitab mõlemat samas jaotises (kaks alapealkirja, kui mõlemad on olemas):

- **teose lehed, mis lahenduvad sellele eksemplarile** (ADR 0076 p 4 lahendusjärjekord;
  andmed `GET /works/{id}/exemplars` vastusest: `exemplars[].pages`, `unknown_pages` ja
  täielik `page_numbers` — vt „Andmeleping: täielik leheloend");
- **eksemplari oma pildid** (ADR 0079).

| Valitud | Jaotis näitab |
|---|---|
| Alus | teose lehed, v.a erandlehed ja teadmata päritoluga lehed |
| Erandlehega eksemplar | oma erandlehed + oma pildid |
| Muu eksemplar | oma pildid; kui neid pole, üks rida „pilte ei ole" (adminil + üleslaadimine) |
| Rida „Teose lehed" | kõik teose lehed, v.a erandlehed |

- Teose lehed on siin **ainult vaatamiseks**; päises „Halda lehti →" (admin) ja paarimärki
  neil ei ole (teose leht on paari sihtmärk).
- Oma pildi kaardil: silt, paarimärk „⇄ lk N".
- Pikk võrk on vaikimisi piiratud („… N veel · Näita kõiki") ja laeb laisalt — mitmesaja
  lehega käsikirjal on ainus eksemplar ühtlasi alus.
- Tühi jaotis on **üks rida**, mitte suur ala. Avalikule lugejale tühja jaotist ei näidata.
- Piltide toimetamine jääb olemasolevaks (`ExemplarImageEditor`, `AdaImportDialog`):
  kaardi päises „Laadi üles", „ADA import…", „Muuda pilte".
- Klõps pisipildil → **suur pilt modaalis** (halduse pildiredaktori raam, `z-[1300]`):
  pildivaatur, pisipildiriba, silt, paar, allikarida („ADA 10062/14332, lk 8" — viide
  originaalile ei tohi kaduda, ADR 0079), nupp „Kõrvuta".

### Avalik lugeja [K]

Näeb kirje täisvaadet ja allikat, kui see on viide (`ester`, `jaanson`, `ada`). Ei näe
tehnilist allikat (`migration`, `manual`, `upload`), märki „vajab ülevaatust" ega ühtki
toimingut. Viiteallikas on näha ka kinnisel real [M] — hõreda kirje juures on see ainus sisu.
Nähtavus = teose nähtavus (ADR 0079 p 2).

### Koht paberile [K: „tuleb alati arvestada paberiga"]

- Pildid on lehel üks jaotis. Paberi tööga tekib loendikaardi alla vahekaardirida
  „Pildid · Paber"; selles töös rida ei kuvata (üks vahekaart oleks müra). [M]
- Leht ei eelda, et pildid on põhisisu (tühi jaotis = üks rida).
- Vesimärgifotode koht ei vaja praegu otsust: ADR 0079 järgi viitab vaatlus eksemplari
  piltidele; pildile saab hiljem lisada liigi ilma migratsioonita. [M]

## Kõrvutus [K]

Mockup (kinnitatud): `korvutus-v4.html`.

Eesmärk on **kahe eksemplari kiire läbilappamine**, mitte ühe lehe hoolikas võrdlus:
käsikirjalised märkmed ühel eksemplaril, erinev dedikatsioon (harva), korrektuur
tehtud/tegemata, erinev paber (sageli). Seni on eksemplare de visu olnud raske võrrelda.

- Täisekraani modaal (halduse pildiredaktori raam, `z-[1300]`).
- **Poole valik on JADA, mitte eksemplar** (ülevaatuse järel 2026-11-10 täpsustatud).
  Rippmenüüs on kaht liiki jadasid:
  - **„Teose lehed"** — KÕIK teose lehed teose järjekorras, sõltumata päritolust. Menüüs
    täpsustus „alus: Tartu TÜR" või „alus märkimata". Leht, mis lahendub teisele
    eksemplarile (erandleht) või on teadmata päritoluga, kannab poole päises märki
    („lk 7 · Riga LUAB" / „päritolu teadmata"). Jada on alati täielik, sest see on teksti
    järjekord ja paari sihtmärk.
  - **eksemplari oma pildid** — iga eksemplar, millel on pilte, manifesti järjekorras
    („Tartu TÜR · 6 pilti"). Ka alusel, kui tal on oma pilte.

  Jadasid ei ühendata: erandlehega eksemplari teose lehed on jadas „Teose lehed", tema
  pildid omaette jadas. Seega ei teki küsimust kahe osa omavahelisest järjekorrast, ja
  salvestatud paar osutab alati jadas „Teose lehed" olevale lehele, ükskõik kelle
  skaneering see on. Pildita eksemplar on menüüs hall. Kaks pildijada omavahel on lubatud.
  (Lehe enda jaotis näitab eksemplari kaht osa endiselt koos — see reegel puudutab ainult
  kõrvutust.)
- **Liikumine koos, nihkega.** Pooled seatakse eraldi kohakuti ja lukustatakse
  („🔒 Liigub koos"); edasi liigutab üks samm mõlemat. Nihkesse minekul (puuduv leht, kaas)
  lukk lahti → kohenda → lukusta. Ei eelda salvestatud paare.
- Klaviatuur: ← → liigutab lukus olekus mõlemat; lahtise lukuga poolt, mille kohal on hiir. [M]
- Kui lukus olekus jõuab üks pool lõppu, peatub samm mõlemal. [M]
- **Paar on salvestatud joonduspunkt.** Kõrvutus avaneb paari järgi (muidu `?page`, muidu
  algus). Admin saab praeguse joonduse salvestada („Salvesta paar A4v ↔ lk 7") — ainult
  kui üks pool on jada „Teose lehed" ja teine pildijada, sest paar on alati pilt ↔ teose leht. Kui lukus joondus
  läheb salvestatud paarist lahku, näitab pool seda märgina, aga ei hüppa. [M]
- **Suurendus koos** (linnuke) + **suurenduse liugur** päises: mõlemal poolel sama
  suurendus ja nihe; rull ja lohistamine ühel poolel liigutab mõlemat. Lehevahetus lukus
  olekus ei lähtesta suurendust (saab lapata suurendatult sama rea peal). Linnukeseta
  suurendab kumbki pool eraldi ja liugur ei ole aktiivne.
- „Kõrvuta" nupp on nähtav, kui teosel on vähemalt kaks pildimaterjali allikat. [M]
- Olemasolev `ExemplarCompare` (lehesisene poolitatud vaade) asendub selle modaaliga.

**Teostusnõue** [M]: `ImageViewer` hoiab `scale`/`position` sisemises olekus; vaja on
valikulist juhitud režiimi (nt `view` + `onViewChange`). Töölaud kasutab sama komponenti
ja ei tohi muutuda. Sünk on suhteline (suurendus „mahub aknasse" suhtes, nihe pildi mõõdu
osana), sest poolte pildid on eri pikslimõõduga.

## Haldus ja eksemplari leht [K]

Jäävad eraldi lehtedeks: haldus on teose lehtede tööriist (admin), eksemplari leht on
kirjete, piltide ja paberi koht (avalik).

| Halduse toiming | Mida muudab | Kelle oma |
|---|---|---|
| Pööre, kärbe, perspektiiv, pildi asendus | ainult pilti | eksemplari skaneeringu |
| Järjestus, poolitus, lisamine, kustutus, prügikast | lehte tervikuna (pilt + tekst + JSON + Meili + osad/mainimised) | teose |
| Lehestiku asendus, osad, teose kustutus | — | teose |

Põhjus, miks ei sulatata kokku: lehed võivad pärineda mitmest eksemplarist (erandleht),
enamikul teostel on alus märkimata, eksemplari leht peab olema avalik.

Sidumine:

- Halduse vahekaardil „Leheküljed" on päritolurida: „Skaneering: Tartu TÜR R Bergm. 357(8)"
  (link eksemplari lehele) või „alus märkimata — Märgi alus…" (link eksemplari lehele).
- Eksemplari lehel teose lehtede juures „Halda lehti →".
- Sama raam mõlemal.

## Sissepääsud [M]

- **Infopaneel** (`ExemplarCards`): ploki pealkirja juures „Kõik andmed →"; rea hoidja nimi
  on link sellele eksemplarile. Rida jääb lühiinfoks (otsus 2026-11-03); piltide arv
  tekstina, pisipildiriba kaob; välislink sildiga kiibina.
- **Metaandmete modaal:** `ExemplarsSection` asemel üks rida „Eksemplarid · N — Muuda
  eksemplaride lehel →" [K]. Modaalist kaob eksemplaride salvestamata-oleku kaitse
  (`exemplarsRef`, `exemplarsDirtyRef`, „Salvesta ja jätka" haru).
- **Välislingi silt** tuletatakse hostist: ADA (`hdl.handle.net/10062/`, `dspace.ut.ee`),
  ESTER, Alvin, DIGAR, Libris; muidu host.

## Paarid ja lehetoimingud [K: „tundub mõistlik"; võetud sellesse töösse — M tõlgendus]

Koodist kontrollitud (2026-11-10): lehetüvi on püsiv identiteet — järjestus muudab ainult
lehe JSON-i järjekorravälja. Tüvi kaob poolitusel (algne leht → kaks uut tüve, tekst
jagatakse `<pb/>` kohalt) ja kustutusel; lehestiku asendus kasutab tüved uuesti.
Eksemplaride `pages` sünkroonitakse (`sync_work_exemplars`, `renamed`), piltide paare
(`images.json` → `page`) praegu EI sünkroonita (ADR 0079 p 3).

- Vastavus ilma poolitamata töötab juba: mitu pilti võib viidata samale lehele (kaks
  üksiklehe pilti ↔ üks topeltleht).
- Poolitus muudab teost; eksemplari kirje ei muutu (sama füüsiline eksemplar, sama
  skaneering teisiti lõigatud).
**Reegel (ülevaatuse järel 2026-11-10 lihtsustatud): paar kehtib ainult siis, kui tema
tüvi on teose praeguste lehetüvede hulgas.** Kõik muu tuleneb sellest.

1. **Koristus on olekupõhine, mitte sündmusepõhine.** Sünk (samas ühenduskohas kus `pages`:
   `refresh_work_mentions` → eksemplaride sünk) eemaldab igast manifestist paarid, mille
   tüve teosel enam ei ole. Ta ei vaja poolituse `renamed`-vastavust ja on idempotentne:
   kui üks käivitus ebaõnnestub, teeb järgmine sama töö ära.
2. **Poolitus ei jaota paare pooltele — paar eemaldatakse.** Varasem kavand („täpselt kaks
   pilti → vasak ja parem") on tagasi võetud: kaks sama lehega seotud pilti võivad olla
   üldvaade ja detail või kaks võtet samast poolest, manifesti järjekord seda ei erista,
   ja tulemus oleks just anti-eesmärgis keelatud vaikne vale paar. Kaotus on väike:
   kõrvutuse lukk ei vaja paare ja uus paar on üks klõps. Lehetoimingu vastus kannab
   eemaldatud paaride arvu ja haldus näitab seda teatena (`useNotify`, `'warning'`).
3. **Lugemine ei usalda manifesti.** Klient ja server käsitlevad paari, mille tüve teose
   täielikus leheloendis ei ole, kui paari puudumist (ei märki, ei joondust). Nii on seis
   ohutu ka sünkrooni ebaõnnestumise ja järgmise sünkrooni vahel. Täielik leheloend on
   `page_numbers` uuel kujul — vt „Andmeleping: täielik leheloend" allpool.
4. **Kirjutus kontrollib sihtlehte.** Iga manifesti kirjutus, mis seab või muudab `page`
   väärtust (`patch_images` jt), kontrollib SAMA luku all (`exemplar_locks` hoiab
   `work_lock`-i, mida hoiab ka lehe kustutus), et tüvi on teose lehtede hulgas; muidu 409
   koos praeguse manifesti ja leheloendiga. Revisjon siin ei aita: kui kustutatud lehel
   paare polnud, ei muutunud ühegi manifesti revisjon ja vana leheloendiga brauser saaks
   paari kustutatud lehele salvestada. Muutmata jäänud `page` väärtust ei kontrollita
   (rippuv vana paar ei tohi blokeerida sildi muutmist; koristab sünk).
5. **Lehestiku asendus** (`replace_work_content`) kasutab tüved uuesti, seega olekupõhine
   koristus seal EI aita ja vale paar oleks vaikne. Kõik teose paarid eemaldatakse
   **enne** sisu asendamist sama `work_lock`-i all; kui eemaldamine ebaõnnestub, asendus
   katkeb ja midagi ei ole muutunud. Vastupidine tõrge (paarid eemaldatud, asendus
   ebaõnnestus) on ohutu suund: kadus mugavus, mitte tõde.
6. **Ebaõnnestumine on nähtav.** Ühenduskoht (`refresh_work_mentions`) neelab vea, sest
   lehetoiming on juba commit'itud; paaride sünk lisab logile `record_server_error`-i
   (`source: server:thread`/sisemine tee, vt #133) — admin näeb seda kliendivigade
   vaates. Punktid 1 ja 3 tagavad, et vahepealne seis on ohutu.
7. Manifesti kirjutus käib olemasoleva lukustuse ja revisjoniga (ADR 0079 p 4), üks commit
   eksemplari kohta; muutusteta manifesti ei kirjutata (ADR 0012).

### Andmeleping: täielik leheloend (ülevaatuse järel 2026-11-10)

Praegu annab `GET /works/{id}/exemplars` väljal `page_numbers` numbrid AINULT
erandlehtedele ja teadmata päritoluga lehtedele (`server/routers/work_exemplars.py`,
kommentaar „vaade ei tea lehtede loendit"). Tavalisel alusega teosel on see tühi —
reegli 3 otsene teostus peidaks seal kõik kehtivad paarid.

**Muutus:** `page_numbers` sisaldab KÕIKI teose lehetüvesid (`{tüvi: järjekorranumber}`,
`page_stems(path)` järjekorras; `page_count` jääb). See on üks allikas kolmele asjale:

- paari kehtivus (reegel 3) ja paarimärgi „⇄ lk N" number;
- kõrvutuse jada „Teose lehed" ja eksemplari lehe teose lehtede võrk (järjekord + tüved;
  pildi ja pisipildi URL tuletatakse tüvest olemasolevate lehepildi teedega);
- reegli 4 409-vastuse leheloend.

**Täpsustus plaani kirjutamisel (2026-11-10):**

- Tüvel ei ole faililaiendit, pildi URL vajab failinime. Vastus saab lisaks välja
  `page_files` (failinimed teose järjekorras; tüvi = nimi ilma laiendita, number = koht + 1).
- Reegli 4 409-vastus jääb olemasolevale kujule (praegune manifest); leheloendi laeb
  klient 409 peale uuesti samast otspunktist. Üks allikas, mitte kaks koopiat.
- `work_lock` EI OLE taassisenetav (`threading.Lock`) ja `refresh_work_mentions`-i kutsuja
  võib seda juba hoida. Paaride koristus võtab seepärast AINULT `metadata_lock`-i (RLock),
  mida hoiab ka `patch_images` — vastastikune välistus on olemas, ummikut ei teki.

Põhjendus, miks mitte Meili leheloend (`getWorkPageList`, nagu spike'is): Meili sünk on
asünkroonne (ADR 0013), nii et kohe pärast poolitust oleks loend vana ja kehtiv paar
paistaks rippuvana või vastupidi. Ketas on autoriteet.

Olemasolevad kasutajad (`exceptionPages`, infopaneel) otsivad kaardist tüve järgi ja
töötavad muutmata. Vastus kasvab pika teose puhul (600 lehte ≈ 15 kB); otspunkt ei ole
vahemälus ja infopaneel kutsub seda ainult eksemplaridega teosel — vastuvõetav. Kui
ehitaja mõõdab, et infopaneelile on see liiga kallis, on lubatud variant `?pages=all`
(vaikimisi vana kuju), aga leping „täielik loend tuleb kettalt, sellest otspunktist" jääb.

**ADR 0079 p 3 täiendus** (enne koodi): lause „lehetoimingutega seda ei sünkroniseerita"
asendub punktidega 1–6. `images.json` muutus ei puuduta endiselt `_metadata.json`-i ega
Meilit.

Paberi töö jaoks: vaatluste leheviited võivad sama reeglit kasutada, aga seal on kaotus
suurem (vaatlus on andmed, mitte mugavus) — repo arutelu pakub „kandidaadid mõlemale
poolele + kontrollimärge". See otsustatakse paberi töös.

## Mis muutub koodis (ülevaade ehitajale)

| Koht | Muutus |
|---|---|
| `src/pages/ExemplarPage.tsx` | kirjutatakse ümber: loend + lahtine rida + pildimaterjali jaotis; `exemplarId` valikuline |
| `src/components/exemplars/ExemplarsSection.tsx` | vorm ja kirjutused tõstetakse lehele (modaali-spetsiifiline ümbris kaob) |
| `src/components/MetadataModal.tsx` | sektsiooni asemel viiterida; kaitse-torustik eemaldatakse |
| `src/components/exemplars/ExemplarCards.tsx` | lingid lehele, sildiga välislink, pisipildiriba kaob |
| `src/components/exemplars/ExemplarCompare.tsx` | asendub kõrvutusmodaaliga |
| `src/components/ImageViewer.tsx` | valikuline juhitud suurendus; vaikekäitumine muutumatu |
| `src/pages/WorkManage.tsx` | päritolurida vahekaardil „Leheküljed" |
| `src/locales/{et,en}/workspace.json` | uued võtmed mõlemas keeles korraga (ADR 0011); `exemplars.convolute.contents` → „Köite sisu" |
| server: eksemplaride sünk + `exemplar_images` | olekupõhine paaride koristus, sihtlehe kontroll kirjutusel, paaride eemaldus enne lehestiku asendust, veateade `record_server_error`-iga |
| `docs/decisions/0079-…` | p 3 täiendus |

Uusi otspunkte ei tule: leht kasutab olemasolevaid (`/works/{id}/exemplars`, eksemplari
piltide otspunktid, ADA import). Üks vastuse kuju muutub: `page_numbers` muutub
täielikuks (vt „Andmeleping: täielik leheloend"). Spike (`spike/eksemplari-leht-proto`) on ära
visatav; töö algab `main`-ist.

Invariandid, mida tuleb hoida: täisekraani modaal `z-[1300]`; tagasiside ainult
`useNotify`/`useConfirm`; üks salvestamata muudatuste dialoog; number-sisendid
`type="text" inputMode="numeric"`; komponenditestid jsdom-päisega.

## Tagajärg, millega tuleb leppida

Käsikirjal (üks eksemplar, tavaliselt muudetakse ainult hoidjat ja kohaviita) läheb
toimetamine ühe sammu pikemaks: modaali asemel viite kaudu eksemplari lehele.

## Uurija vastustest paberi töö jaoks (ei kuulu sellesse töösse)

Allikas: [Vesimärgid ja eksemplarid VUTT-is](https://claude.ai/artifact/LnzMS7D2ud6h7FnLBTHZu5),
repo arutelu `2026-10-19-eksemplari-kiht-ja-paber-arutelu.md`.

- Vesimärgid on kohe avalikud → nähtavus = teose nähtavus, peidetud olekut ei ole.
- Vaatlus eeldab teost VUTT-is; eraldi paberilehti ei peeta; paber.ut.ee → staatiline
  arhiiv. [K] Impordis lähevad vasteta eksemplarid ülevaatusnimekirja ja ootavad teose
  üleslaadimist. [M]
- Vormiregistri asemel piisab viitest „seotud vesimärk" + märkmelahter (vaatlus → vaatlus,
  ka teise teose oma).
- Võrdleb vesimärgi nimetuse/kujundi ja aasta järgi (korpuseülene vaade), mitte poogna järgi.
- IPH pigem puuna (alamklassid); mõtleb veel.
- Lisada trükise formaat; paberi mõõdud jäävad.
- Üks vaatlus = üks vesimärgitüüp mitme asukohaga; fotod tagantvalgusega, JPG.
- Sõnaline kirjeldus ja kommentaar peavad säilima. Katalooginumbritest oluline ESTER.
- Olemasolevaid märkmeid ei ole → esimene andmestik on paber.ut.ee import (522 eksemplari).
- Vaatluste leheviited vajavad sama sünkroonireeglit mis paarid (poolitus, kustutus).

## Varasem töö

- Mockupid 2026-11-09: `.superpowers/brainstorm/1845782-1794239506/content/`
  (`eksemplari-leht-v3-grupid.html`, `korvutus-v3.html`) — paberi osa visandid on seal
  (PABER-vahekaart, vaatluse kaart, vesimärkide kõrvutus) ja kuluvad ära paberi töös.
- Spike: `spike/eksemplari-leht-proto`, `src/pages/ExemplarsProtoPage.tsx`.
- Mockupid 2026-11-10: `.superpowers/brainstorm/2115728-1794336221/content/`.
