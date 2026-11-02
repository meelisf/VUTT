# ADR 0077 — Fraktuur on absoluutne märgend `<f>`, mitte suhteline `<cs>`

**Kuupäev:** 2026-11-02
**Staatus:** kehtib (vastu võetud 2026-11-02; kood teostatud, korpuse migratsioon käivitamata — vt „Teostus“)
**Seotud:** ADR 0071 (märgendus = TEI alamhulk; asendab selle `cs`-erandi), ADR 0003/0009
(`<m>` välimine), ADR 0062 (migratsioon ühe teisendusfunktsiooniga), #649 (heebrea)

## Kontekst

`<cs>` tähendab „kiri vastupidine teose põhikirjale“ (ADR 0071). Teose põhikirja ei
ole kuskil kirjas: seda ei näe ei mudel, kes loeb ühte lehte, ega TEI teisendus.
Sama pilt saab treeningandmetes vastupidise märgenduse: fraktuuris lõik on
antiikvateoses `<cs>`, fraktuurteoses märgendamata. Trükimudel ei ole koodivahetust
usaldusväärselt õppinud. **Hüpotees** on, et põhjus on vastuoluline siht, mitte mudeli
võimekus: mudelilt küsitakse infot, mida lehel ei ole. Allolev loendus näitab, et
siht on teose kaupa vastupidine. Seda, et just see on õppimisraskuse põhjus, ta ei
tõesta. Kinnituse annab alles `<f>`-ga treenitud mudeli mõõtmine samal
hindamiskomplektil (`<f>`-vahemike F1 enne ja pärast). Otsus on põhjendatud ka ilma
selleta: absoluutne märgend teeb TEI teisenduse mehaaniliseks (ADR 0071 erand kaob).

Mõõdetud 2026-11-02 LOSSi treeningandmetel (`data/vutt/metadata.csv`, 1488 lehte,
137 teost). Põhikiri tuletati rea lõpu poolitusmärgist: juhis seob `⸗` fraktuuri ja
`-` antiikvaga.

- **125 teost on antiikvas**, 8 fraktuuris (~40 lehte), 4-l signaali ei ole (üks leht,
  poolitusi pole). Signaal on enamasti 100 % (nt 436/436, 248/249).
- **Antiikvateoses tähendab `<cs>` juba praegu fraktuuri.** Absoluutne märgend nõuab
  sisulist teisendust ainult fraktuurteostes.
- 1256 `<cs>`-vahemikust on mitmerealisi 6: reapiiri üle ei märgendata ka praegu.
- Kümnes teoses on üksikuid vastuolusid. Näiteks oratsioonides on üks `⸗` antiikvas
  väljaspool `<cs>`-i ja Hexen-Predigt 1626-s 13 `-` fraktuuris väljaspool `<cs>`-i.
  **Neid ei ole pildilt kontrollitud.** Vastuolu võib olla märgendusviga (unustatud
  `<cs>`, vale poolitusmärk) või autentne: varauusaegne trükk ei ole poolitusmärgi
  kasutuses alati järjekindel. Kumb, selgub alles pildilt; seepärast on punktis 4
  erandite nimekiri ja migratsiooni aruandes (6.2) eraldi rühm „vastuoluga“.

## Otsus

1. **Fraktuur märgitakse alati `<f>…</f>`-ga, sõltumata teose põhikirjast.**
   Märgendamata ladina tähestiku tekst on antiikva. TEI vaste on
   `hi rend="fraktur"`, mis on mehaaniline ilma põhikirja väljata. `<cs>`
   kaob registrist. Põhikirja välja **ei looda**: seda läheb vaja ainult ühekordses
   migratsioonis ja ka seal tuletatakse see andmetest.

2. **Fraktuurteose tekst on täies ulatuses `<f>`-is.** Toimetaja ei näe tägi, vaid
   kujundust (punkt 2a). Toimetaja töö pöördub: fraktuurlehel eemaldab ta
   antiikvasõnadelt märgenduse. See on olemasolev toiming: `selectionWrapChanges`
   ja „Puhasta“ (`cleanSelectionChanges`) poolitavad paari valiku kohalt
   (`<f>den exercitiis finden</f>` + „exercitiis“ → `<f>den </f>exercitiis<f> finden</f>`).

2a. **Andmed on absoluutsed, kuvamine on lehe kaupa suhteline.** Kerge hall taust
   (praegune `.vutt-cs`) tõstab esile lehe **vähemuskirja**: antiikvalehel `<f>`
   (nagu praegu `<cs>`), fraktuurlehel märgendamata ladina tähestiku teksti. Hall
   tähendab toimetajale endiselt „lehe põhikirjast erinev“, nii et harjumus ei muutu.
   Fraktuurlehel on hall kõik `<f>`-ist väljas olev peale servatühiku ja kreeka/heebrea,
   ka numbrid ja kirjavahemärgid (*täiendus 2026-11-02*: varem ainult esimesest tähest
   viimaseni, nii et `Lut: 19. &` / `20.` ja kustose `Hu-` poolitusmärk paistsid fraktuurina).
   - **Enamus arvutatakse lehe laadimisel**, mitte iga muudatusega: ladina tähed
     `<f>`-is vs väljas; kreeka, heebrea, numbrid ja kirjavahemärgid ei loe. Kui
     arvutataks elavalt, võiks ~50/50 lehel kogu esiletõst toimetamise ajal ümber
     pöörduda. Arvutus kordub igal sündmusel, mis asendab lehe teksti terviku
     või kinnitab selle:
     - lehe laadimine ja lehevahetus (remounti ei toimu (ADR 0010), seega tuleb
       arvutus selgesõnaliselt uuesti käivitada);
     - salvestamine;
     - re-OCR-i tulemuse rakendamine;
     - ettepaneku või ajaloo versiooni laadimine.

     Näide: märgendamata fraktuurlehel (`<f>` 0 % → režiim „antiikva“) märgib
     toimetaja Ctrl+A → Ctrl+K kogu teksti `<f>`-iks. Leht on hall kuni
     salvestamiseni või kuni ta režiimi käsitsi vahetab.
   - **Režiim on nähtav kahes kohas, ja kumbki ei pikenda tööriistariba** (see on juba
     täis: kitsal ribal on nupud ainult ikoonidega ja lehe tähistus avaneb eraldi
     paneelis):
     - **𝔉 nupp näitab, mida toiming praegu teeb.** Lüliti pöörab alati valiku kirja
       ümber. Nupu silt on täht, mille tähendus on hall, ja see seisab halli näidise
       peal: antiikvalehel `𝔉`, fraktuurlehel `A`. Hõljukvihje näiteks „Märgi antiikvaks ·
       lehe kirjastiil: fraktuur (Ctrl+K)“. Toiming ja kiirklahv ei muutu.
     - **„Lehekülje kirjastiil“ on redaktori alumisel ribal** („Erimärgid ja juhend“
       kõrval, paremas servas). Riba on lehe info ja abi jaoks, nii et legend kuulub
       sinna. Antiikvalehel on silt vaikne (hall), fraktuurlehel värviline, sest seal on
       halli tähendus vastupidine harjumuspärasele. Kui lehel ei ole ühtki `<f>`-i, silt
       peidetakse; märgendamata fraktuurlehel ilmub ta pärast esimest `<f>`-i.
     - **Miks mitte staatuse kõrval:** lehe staatus on salvestatud andmeväli, mida
       toimetaja määrab. Samasugune rippmenüü selle kõrval laseks arvata, et kirjastiil
       on samuti lehe omadus, mis salvestub.
   - **Käsitsi vahetus:** alumise riba sildil klõpsamine pöörab kuvarežiimi. See on
     vaate olek, mida ei salvestata, ja järgmine automaatne arvutus kirjutab selle üle.
     Hõljukvihje: „Kuvamine, ei salvestata“.
   - **Miks mitte absoluutne taust:** taustakanalit kasutavad `<m>` ja `<hi>` (kollane)
     ning lehe tähistused. `<f>` on nende sees (`<m><f>…</f></m>`) ja sisemise
     elemendi taust katab välimise. Täielikult halli fraktuurlehel kaotaks
     marginaalia oma kollase tausta.
   - **Miks mitte font** (proovitud mõttes 2026-11-02): fraktuurifont peidab
     transkriptsiooniotsused (`I`/`J` üks kuju, `ſ`/`f` ja `u`/`n` lähedased,
     makron) ja aeglustab lugemist. Serif ja sans-serif tähti ei sulanda, aga nende
     vahet ei märka silm lehte lappides lühikestes sõnades ega kirjavahemärkides,
     ja vahemiku ulatus (tühik, `/` sees või väljas) jääb nähtamatuks. Font võib
     hiljem olla teine kanal, mitte esimene.

3. **Mis on `<f>`, mis mitte:**
   - **Ulatus on trükis.** `<cs>` on praegu ainult trüki juhistes (LOSSi `prompt.py`,
     `GEMINI_PRINT_INSTRUCTION`), mitte käekirja omas. Kurrendi ja ladina kirja
     vahetus käsikirjas on eraldi küsimus ja seda ADR ei lahenda.
   - Švaabahher ja teised gooti trükikirjad on `<f>`.
   - Kreeka ja heebrea **ei ole** `<f>` ka fraktuurlõigu sees. „Mitte-`<f>` =
     antiikva“ kehtib ainult ladina tähestikule.
   - **`<f>` ja `<i>` välistavad teineteist** (invariant). Gooti kirjal kursiivi ei
     ole, seega on trükise `<i>` alati antiikva kursiiv. Ei `<f><i>…</i></f>` ega
     `<i><f>…</f></i>`. Sama põhimõte on juhendis juba olemas: kursiivne leht
     märgitakse tervikuna kursiiviks, kuigi kursiiv on seal „normaalne“.
     **Redaktor kaitseb invarianti ise:** `<i>` mähkimine poolitab ümbritseva
     `<f>`-paari ja eemaldab valikus olevad `<f>`-id, ning `<f>` mähkimine teeb sama
     `<i>`-ga (`selectionWrapChanges`, samad poolitusreeglid nagu „Puhasta“).
     Fraktuurlehel saab antiikva kursiivis sõna märkida ühe klahvivajutusega:
     `<f>den exercitiis finden</f>` + Ctrl+I → `<f>den </f><i>exercitiis</i><f> finden</f>`.
   - **Numbrid ja kirjavahemärgid fraktuurlause sees jäävad `<f>`-i sisse.**
     `<f>im Jahr 1644. am 3. Martii</f>` on üks paar, mitte
     `<f>im Jahr </f>1644.<f> am </f>…`. Sama kehtib lõigu servas olevate
     märkide kohta (rea lõpu `⸗`, lõpupunkt, sulud). `<f>`-ita jääb ainult lõik, kus ei ole
     ühtki fraktuuri tähte: eraldi rida või plokk (leheküljenumber, rooma number)
     või number väljaspool fraktuurlõiku.
   - **Pesastus:** `<f>` on struktuuritägide **sees**, mitte ümber: `<m><f>Ge⸗</f></m>`,
     `<catch><f>Vor⸗</f></catch>`, `<sig>`, `<rh>`, `<add>`, `<hi>`. See on sama
     reegel, millega `skipStructural` (`wrapTagUtils.ts`) juba stiilitäge
     käsitleb. `<pb/>` ja `<fn>…</fn>` ei ole kunagi `<f>`-i sees. Ainult
     numbrist koosnev `<fw>12</fw>` ei ole `<f>` üldse.
   - `<f>` ei ületa reapiiri (punkt 3a).

3a. **Reapiir.** Fraktuurlehel on iga rida `<f>`-is ja tägid on peidetud. Kui
   toimetaja vajutab rea keskel Enterit, tekib `<f>rida 1\nrida 2</f>` ja hall
   taust jookseb üle reavahetuse, ilma et ta seda märkaks. 𝔉 / Ctrl+K otsib
   ümbritsevat paari ainult ühe rea piires (`findContainer(…, line.from, line.to)`),
   ei leia seda ja **mähib topelt**. „Puhasta“ (`cleanSelectionChanges`) paaritab
   kogu dokumendi ulatuses ja töötab ka mitmerealise paariga. Lahendus on kahes osas:
   - **Salvestamisel** poolitatakse üle reavahetuse ulatuv inline-stiilipaar
     (`CLEAN_SPLIT_TAGS`) rea kaupa `normalize_marginalia_tags`-i sees. Normaliseerimine
     toimub ainult salvestamisel (ADR 0003). See parandab ka olemasolevad
     mitmerealised `<cs>`-paarid (6 tükki 1256-st treeningandmetes).
   - **Redaktoris** otsustab lüliti lahtipakkimise sama globaalse paaritusega nagu
     „Puhasta“, nii et Ctrl+K töötab ka enne salvestust. Elavat poolitamist Enteri
     peale ei tehta, sest see oleks klahvivajutuse peale tehtav normaliseerimine
     (ADR 0003).

4. **Poolitusmärk ja `<f>` peavad klappima:** rea lõpu `⸗` on `<f>`-i sees ja `-`
   väljas. Poolitusmärki **ei tuletata** salvestamisel, see on diplomaatiline
   transkriptsioon ja jääb toimetaja otsuseks. Vastuolu on kontroll treeningekspordis
   (vt Tagajärjed) ja hiljem võimalik redaktori hoiatus.
   - Kontrollitakse rea **viimast nähtavat märki enne sulgevaid täge**
     (`Ge⸗</f>`, `<m><f>Ge⸗</f></m>`, `<catch><f>Vor⸗</f></catch>`).
   - Arvesse läheb ainult tähe järel olev märk (`[^\W\d_]-`), nii et vahemik
     `1640-` ei ole poolitus.
   - Kui trükikoda on fraktuuris päriselt kasutanud ühekordset `-`, on transkriptsioon
     õige ja leht ei tohi jäädavalt välja jääda. Kontrollitud erandid on LOSSi
     ekspordi käsitsi nimekirjas (lehe võti + põhjus). VUTT-i andmetesse lipp ei
     lähe.

5. **Kanoniseerimine treeningekspordis, mitte VUTT-i salvestusteel.** Tühjade tägide
   koristus ja `<m>` välimiseks tõstmine on juba olemas ja registripõhised:
   `strip_empty_tags` ja `normalize_marginalia_tags` haaravad `<f>`-i registrikirje
   kaudu. Uut salvestusnormaliseerijat ei tehta. Kaks asja, mis kirja pildil ei
   näe, aga annaksid mudelile kõikuva sihi, kanoniseeritakse LOSSi
   `clean_markup`-is:
   - servatühik välja (`<f>den </f>` → `<f>den</f> `);
   - kõrvuti paarid tühiku üle kokku (`<f>A</f> <f>B</f>` → `<f>A B</f>`).

   Sama kehtib `<i>`/`<b>` kohta.

6. **Migratsioon** (`scripts/migrate_cs_to_f.py`, üks teisendusfunktsioon nagu ADR 0062):
   1. **Hetktõmmis enne:** `data/` gitis silt `pre-0077-f` ja kõigi `.txt`-failide arhiiv
      (`tar czf ~/vutt-pre-0077-f-<kuupäev>.tar.gz data/**/*.txt`) väljaspool `data/`-t.
      Öine LOSSi varukoopia on lisakaitse, mitte asendus.
   2. **Kuivkäivitus vaikimisi.** Teose põhikiri tuletatakse kõigi lehtede (iga
      seisundi) poolitusmärgist. Aruanne loetleb teosed kolmes rühmas: antiikva,
      fraktuur ja otsustamata (signaalita või vastuoluga). Otsustamata teosed määrab
      inimene ühe pildi järgi; käsitsi loend (`work_id → F|A`) antakse skriptile
      sisendiks ja läheb manifesti (6.7). Aruanne loetleb eraldi `<i>` fraktuurteostes, sest nende tähendus
      tuleb enne vaadata.
   3. **Antiikvateos:** `<cs>` → `<f>`.
   4. **Fraktuurteos:** iga rea fraktuurlõik mähitakse `<f>`-i ja `<cs>` eemaldatakse
      (selle sisu on antiikva). Lõik on rea maksimaalne jupp, milles on vähemalt
      üks fraktuuri täht, **koos külgnevate numbrite ja kirjavahemärkidega**: rea
      lõpu `⸗`, `.`, `,`, sulud jms on sees (`<f>(Gott sey Lob).</f>`, `<f>Ge⸗</f>`,
      mitte `(<f>Gott sey Lob</f>).`). Muidu läheks migratsioon kohe vastuollu
      punkti 4 väravaga. Servatühik jääb välja. Lõik
      katkeb `<cs>`-, `<i>`-, kreeka- ja heebrealõigu, `<fn>`-i ja `<pb/>`-ga. `<i>`
      jääb `<f>`-ist välja ja `<cs><i>x</i></cs>` muutub `<i>x</i>`-ks. Pesastuses
      otsustab **sisemine** täg: antiikvateoses on `<i>…<cs>x</cs>…</i>` fraktuurisõna
      kursiivlõigus (nimed, kohanimed) ja kursiiv tükeldatakse —
      `<i>ne in </i><f>Frödzwijck</f><i> &c.</i>`. *Täiendus 2026-11-02:* esimene
      rakendus viskas selle `<cs>`-i ära (91 lehte, peaaegu kõik Valmis); parandus
      `migrate_cs_to_f.py --fix-italic pre-0077-f` teisendab need lehed
      migratsioonieelsest tekstist uuesti, kui leht pole vahepeal muutunud. Struktuuritägi
      sees mähitakse sisu (`<catch><f>…</f></catch>`), mitte tägi ennast. Kehtivad
      punkti 3 reeglid.
   5. Kõik lehed, ka **Toores**: nende `<cs>` on vana mudeli suhteline väljund.
   6. **Rakendus seisatud backendiga** (nagu ADR 0076): ükski toimetaja salvestus ei
      jookse vahele. Teose kohta üks commit (autor `"Automaatne"`), siis Meili
      täisreindeks (`server_seed_data.sh`).
   7. **Manifest, mitte `<f>`-i olemasolu, on teisendatuse tunnus.** `<f>`-i
      olemasolu ei kõlba: fraktuurteose täielikult antiikvas leht teisendub
      `<cs>ABC</cs>` → `ABC`, ja korduskäivitus loeks selle teisendamata fraktuuriks ning
      annaks `<f>ABC</f>`. Skript kirjutab manifesti
      `data/config/migrations/0077-f.json` (`save_config_with_git`, ADR 0040):
      - teose kohta põhikiri (`F|A`), päritolu (`signaal` | `käsitsi`) ja migratsiooni
        commit;
      - lehe kohta sisendi ja väljundi räsi.

      Korduskäivitus puudutab ainult lehte, mille praegune räsi ei ole manifestis
      väljundina. Selline leht on muutunud pärast migratsiooni, ja teisendatakse ta
      ainult siis, kui tal on `<cs>`. Manifest ei ole põhikirja väli andmemudelis: seda
      loeb ainult üleminekukiht (punkt 7), mitte mudel, import pärast üleminekut ega
      TEI eksport.

   Mahuliselt on risk väike, sest enamik toimetatud lehti on antiikvas ja sealne
   teisendus on ümbernimetamine. Sisuliselt muutuvad ainult fraktuurteosed.

7. **Üleminek ühe korraga.** Järjekord: migratsioon → uus eksport → treening →
   mudel ja **mõlemad juhised** (LOSSi `scripts/prompt.py`, VUTT-i
   `server/ocr_prompts.py` Gemini tee) lähevad tootmisse koos.

   **Vana märgendus võib tagasi tulla kolme teed pidi.** Iga tee kasutab sama
   teisendusfunktsiooni (`cs_to_f(text, põhikiri)`) ja manifesti:
   - **Vana mudeli väljund üleminekuajal** (upload'i import, re-OCR-i vastuvõtt,
     Gemini tee vana juhisega): teisendatakse impordi hetkel. Põhikiri tuleb
     manifestist; uue teose puhul lehe poolitusmärgist ja kui signaal puudub, siis
     `A` aruandesse. Pärast mudeli vahetust see kiht eemaldatakse.
   - **Ajaloo taastamine** (`/git-restore`, `server/routers/editing.py`): versioon, mis
     on vanem kui teose migratsiooni commit (manifestis), teisendatakse enne
     kirjutamist. Muidu tuleks tagasi `<cs>` või märgendamata vana fraktuurtekst.
     `/commit-diff` näitab ajalugu muutmata kujul, sest see on ajaloo kirje, mitte
     kirjutustee.
   - **Vananenud redaktoriseanss:** pärast migratsiooni salvestab enne migratsiooni
     avatud vaheleht, mille `base` on vana tekst (`/save` kolmesuunaline liitmine,
     ADR 0054). Muudetud read tuleksid vanas märgenduses tagasi. Kui `base` räsi on
     manifestis sisendina, vastab `/save` 409-ga („Leht on vahepeal teisendatud,
     laadi uuesti“) ega liida.
   - Agendi lehe teksti ettepanekud (ADR 0058) on räsiseotud ja vananevad ise.

   Valvur: korpuses ei ole pärast mudeli vahetust ühtki `<cs>`-i (skripti
   kontrollrežiim). Test: `/git-restore` migratsioonieelsele versioonile annab `<f>`-i.

## Tagajärjed

- **Registrikirje** `f` (`hi rend="fraktur"`, `marginalia_inline`, `strip_empty`,
  otsingusse jah) mõlemas registris (`server/vutt_tags.py`, `src/markup/vuttTags.ts`)
  ja `VUTT_TAGS` kuvaklass; `cs` kustub. Paarsustest (`tests/test_vutt_tags_parity.py`)
  ja `vuttTagsConsumers.test.ts` kukuvad, kui midagi jääb puudu. **Neid valvureid ei
  tabata** kõvasti kodeeritud `cs`-loendid, mis tuleb üle käia ja võimaluse korral
  registrist tuletada (`consumers.ts` / `vutt_tags.py`):
  - redaktor: `wrapTagUtils.ts` (`['i','b','cs']`), `useEditorFormattingActions.ts`,
    `EditorToolbar.tsx` (𝔉 nupp), `EditorEditTab.tsx` (`wrapWithTag` tüüp),
    `useCodeMirrorLifecycle.ts` (`Mod-k`), `marginaliaUtils.ts` (`wrapMarginaliaLines`
    regexid `i|b|cs|hi`, `toggleGroupStyle` tüüp), `index.css` (`.vutt-cs`);
  - **lugemisvaade:** `renderVuttMarkup.ts` (+ test) kuvab `<cs>`-i praegu kursiivina
    (`italic tracking-wide`). See peab järgima punkti 2a suhtelist reeglit (sama
    funktsioon kui redaktoris), mitte tegema oma tõlgendust;
  - server: `page_merge.py` (`_PAARISTÄG_RE`; sealt puuduvad juba praegu `add` ja lehe
    tähistused, mis on eraldi viga), `marginalia_audit.py`, `marginalia_migrate.py`;
  - LOSS: `convert_marginalia.py` regexid (`i|b|cs|hi`);
  - juhend (`public/transcription_guide*.html`, koodivahetuse lõik) ja tõlked
    (`editor.tooltips` 𝔉 nupu tekst mõlemas keeles).

  Juhendisse lähevad `<f>` reeglid punktidest 3 ja 3a.
- **`pageMarkEdit`** paneb lehe tähistuse praegu kahte moodi: ilma valikuta
  `<catch><f>Vor⸗</f></catch>`, valikuga `<f><catch>Vor⸗</catch></f>`. Punkti 3 järgi
  on õige ainult esimene. Valikuga tee peab tõstma tähistuse olemasoleva
  stiilipaari ümber.
- **„Puhasta“ valiku peal on fraktuurlehe põhitoiming** ja peab töötama ka siis, kui
  valik on paari sees: `cleanSelectionChanges` (`src/components/editor/cleanSelection.ts`)
  poolitab valikust välja ulatuva stiilipaari (`CLEAN_SPLIT_TAGS`, registrist).
  Struktuur (`m`, `fn`, lehe tähistus) eemaldub ainult tervikuna, annotatsioon ei
  eemaldu kunagi. Varem eemaldati ainult valikusse jäänud tokenid: valik paari sees
  ei teinud midagi ja valik üle ühe tokeni puhastas orvu kaudu ka valikust välja
  jäänud teksti.
- **Treeningeksport** (LOSS `build_vutt_dataset.py`): kanoniseerimine punktist 5 ja
  **värav**: leht, kus rea lõpu `⸗` on väljaspool `<f>`-i või `-` sees, lipustatakse ja
  jäetakse välja. Värav jookseb iga ekspordiga, mitte ainult migratsioonil.
- **Märgendamata fraktuurlehti** (näiteks LOSSi 1. etapi Becker 1644, `<cs>`-null) ei tee
  see ADR ausaks. Puuduv `<f>` on sama vale signaal nagu puuduv `<cs>`. Need jäävad
  välja, kuni on VUTT-is märgendatud.
- ADR 0071 tabelis asendub rida `cs` reaga `f`. Lause „TEI eksport on mehaaniline
  (v.a `cs`)“ kaotab erandi.
- **EI TOHI:** taastada suhtelist märgendit ega lisada teose põhikirja välja, et mudel
  või import saaks „teisendada tagasi“. Kogu mõte on, et siht tuleneb lehest üksi.

## Teostus (2026-11-02)

| ADR punkt | Kood |
|---|---|
| 1, registri kirje | `server/vutt_tags.py`, `src/markup/vuttTags.ts` (`f`, `hi rend="fraktur"`; `cs` kustus); `STYLE_TAGS`, `CLEAN_SPLIT_TAGS` (`consumers.ts`); `page_merge` paaristägid registrist |
| 2, 2a kuva | `src/components/editor/scriptMode.ts` (+ CodeMirrori väli), 𝔉/A nupp (`EditorToolbar`), „Lehekülje kirjastiil“ (`SpecialCharsPanel`), lugemisvaade ja marginaaliakaart (`renderVuttMarkup(text, mode)`), `.vutt-script-minority` |
| 3 `<f>`/`<i>` | `selectionWrapChanges` (`wrapTagUtils.ts`): vastandtägi eemaldus enne mähkimist; `cs_to_f` |
| 3 pesastus | `pageMarkEdit.ts` samm 4b (ainult `f`: `<i>`/`<b>` sees jääb tähistus ADR 0070 järgi stiili sisse) |
| 3a reapiir | `split_multiline_style_pairs` (`marginalia_normalize.py`, salvestamisel); lüliti `findContainerGlobal` + lahtipakkimine `cleanSelectionChanges(…, only)` kaudu |
| 6 migratsioon | `scripts/migrate_cs_to_f.py`, `server/script_migration.py` (`cs_to_f`, `infer_base`, manifest) |
| 7 üleminek | `server/script_transition.py`: `ocr_to_absolute` (re-OCR `_ocr_postprocess`, upload'i import), `restored_to_absolute` (`/git-restore`), `stale_premigration_base` (`/save` 409), `incoming_to_absolute` (vana JS-kimbu `<cs>`) |

Täpsustused teostuse käigus:

- **Manifest commititakse teose lehtedega samas commitis** (`save_with_git`
  `additional_files`, autor „Automaatne“), mitte eraldi `save_config_with_git`-iga. Nii ei
  jää katkenud jooksu järel teisendatud lehte manifestita. Vorming on sama.
- **Manifest kannab teose `migrated_at` ajatemplit, mitte commiti räsi.** Commit ei
  saa kanda iseenda räsi. Ajaloo taastamine võrdleb versiooni commiti aega sellega.
- **Gemini trükijuhis jääb üleminekuks suhteliseks `<cs>`-iks**, nagu punkt 7 ütleb,
  ja läbib sama teisenduse. Sellega ei ole vaja eristada, kumb pakkuja `.ocr` faili
  tootis. Vahetus käib koos LOSSi mudeliga ja lipuga `config.OCR_OUTPUT_RELATIVE_CS = False`.
- **Vana mudeli `<cs>`-ita lehte** teisendatakse ainult lehe enda fraktuurisignaali
  järgi, mitte manifesti põhikirja järgi. `_ocr_postprocess` kutsutakse mitu korda, ja
  teisendusest märgenduseta jäänud antiikvaleht mähitaks muidu teisel kutsel `<f>`-i.
  Käsikirja (`Q87167`) teksti ei teisendata.
- **Meili sünk käib migratsioonis teose kaupa** (nagu `migrate_macron_corpus.py`), mitte
  täisreindeksina. `lehekylje_tekst` eemaldab tägid niikuinii.
- **Migratsioon jookseb CAS + `page_lock`-iga** (leht loetakse enne kirjutust uuesti).
  Backendi seiskamine ei ole seega rangelt vajalik; vananenud vahelehed kaitseb
  `/save` 409. Vaikne aeg on siiski soovitatav.

Käivitamata — samm-sammult juhis: [`docs/runbook-adr-0077-migratsioon.md`](../runbook-adr-0077-migratsioon.md):

1. Kuivkäivitus serveris → aruanne, otsustamata teosed → `otsused.json`.
2. Hetktõmmis (`git tag pre-0077-f` + `tar`) → `--apply --decisions` → `--check`.
3. Frontendi ja backendi deploy **samal ajal** migratsiooniga: uus redaktor eeldab
   absoluutset `<f>`-i ja vana `<cs>` korpuses kuvataks märgendamata tekstina.
4. LOSS: eksport + kanoniseerimine + poolitusvärav (punkt 5 ja „Tagajärjed“), treening,
   seejärel mõlemad juhised + `OCR_OUTPUT_RELATIVE_CS = False`.

