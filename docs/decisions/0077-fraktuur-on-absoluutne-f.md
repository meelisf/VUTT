# ADR 0077 — Fraktuur on absoluutne märgend `<f>`, mitte suhteline `<cs>`

**Kuupäev:** 2026-11-02
**Staatus:** ettepanek
**Seotud:** ADR 0071 (märgendus = TEI alamhulk; asendab selle `cs`-erandi), ADR 0003/0009
(`<m>` välimine), ADR 0062 (migratsioon ühe teisendusfunktsiooniga), #649 (heebrea)

## Kontekst

`<cs>` tähendab „kiri vastupidine teose põhikirjale“ (ADR 0071). Teose põhikirja ei
ole kuskil kirjas: seda ei näe ei mudel, kes loeb ühte lehte, ega TEI teisendus.
Sama pilt saab treeningandmetes vastupidise märgenduse: fraktuuris lõik on
antiikvateoses `<cs>`, fraktuurteoses märgendamata. Trükimudel ei ole koodivahetust
usaldusväärselt õppinud. Selle põhjus on vastuoluline siht, mitte mudeli
võimekus: mudelilt küsitakse infot, mida lehel ei ole.

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
  Need on märgendusvead (unustatud `<cs>` või vale poolitusmärk), mitte signaali müra.

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
   - **Enamus arvutatakse lehe laadimisel**, mitte iga muudatusega: ladina tähed
     `<f>`-is vs väljas; kreeka, heebrea, numbrid ja kirjavahemärgid ei loe. Kui
     arvutataks elavalt, võiks ~50/50 lehel kogu esiletõst toimetamise ajal ümber
     pöörduda. Arvutus kordub lehevahetusel. Lehe vahetus remounti ei tee
     (ADR 0010), seega tuleb arvutus seal selgesõnaliselt uuesti käivitada.
   - **Režiim on nähtav:** tööriistariba juures silt, nt „Põhikiri: fraktuur ·
     esile tõstetud antiikva“. Ilma sildita ei tea toimetaja, kumba halli ta näeb.
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
   - **Numbrid ja kirjavahemärgid fraktuurlause sees jäävad `<f>`-i sisse.**
     `<f>im Jahr 1644. am 3. Martii</f>` on üks paar, mitte
     `<f>im Jahr </f>1644.<f> am </f>…`. `<f>`-ita jääb ainult lõik, kus ei ole
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
      sisendiks. Aruanne loetleb eraldi `<i>` fraktuurteostes, sest nende tähendus
      tuleb enne vaadata.
   3. **Antiikvateos:** `<cs>` → `<f>`.
   4. **Fraktuurteos:** iga rea fraktuurlõik mähitakse `<f>`-i ja `<cs>` eemaldatakse
      (selle sisu on antiikva). Lõik ulatub rea esimesest fraktuuri tähest
      viimaseni ja vahepealsed numbrid ning kirjavahemärgid jäävad sisse. Lõik
      katkeb `<cs>`-, `<i>`-, kreeka- ja heebrealõigu, `<fn>`-i ja `<pb/>`-ga. `<i>`
      jääb `<f>`-ist välja ja `<cs><i>x</i></cs>` muutub `<i>x</i>`-ks. Struktuuritägi
      sees mähitakse sisu (`<catch><f>…</f></catch>`), mitte tägi ennast. Kehtivad
      punkti 3 reeglid.
   5. Kõik lehed, ka **Toores**: nende `<cs>` on vana mudeli suhteline väljund.
   6. **Rakendus seisatud backendiga** (nagu ADR 0076): ükski toimetaja salvestus ei
      jookse vahele. Teose kohta üks commit (autor `"Automaatne"`), siis Meili
      täisreindeks (`server_seed_data.sh`).
   7. **Idempotentne:** `<f>`-iga lehte ei puudutata uuesti. `<cs>`-iga lehe
      teisendab korduskäivitus samamoodi, mis katab üleminekuaja (punkt 7).

   Mahuliselt on risk väike, sest enamik toimetatud lehti on antiikvas ja sealne
   teisendus on ümbernimetamine. Sisuliselt muutuvad ainult fraktuurteosed.

7. **Üleminek ühe korraga.** Järjekord: migratsioon → uus eksport → treening →
   mudel ja **mõlemad juhised** (LOSSi `scripts/prompt.py`, VUTT-i
   `server/ocr_prompts.py` Gemini tee) lähevad tootmisse koos. Vahepeal annab vana
   mudel `<cs>`-i. Need lehed teisendab migratsiooniskripti korduskäivitus
   (lehe kaupa poolitusmärgist või teose varem määratud põhikirjast). Pärast
   vahetust ei tohi korpuses ühtki `<cs>`-i olla. Viimane korduskäivitus kontrollib
   seda.

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
