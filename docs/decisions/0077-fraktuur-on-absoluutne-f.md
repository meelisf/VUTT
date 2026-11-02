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
   kujundust (`<f>` kuvatakse sama kerge halli taustaga kui praegu `<cs>`; proovitud
   2026-11-02 terve lehe peal, lugemist ei sega). Toimetaja töö pöördub:
   fraktuurlehel eemaldab ta antiikvasõnadelt märgenduse. See on olemasolev
   toiming: `selectionWrapChanges` poolitab paari valiku kohalt
   (`<f>den exercitiis finden</f>` + „exercitiis“ → `<f>den </f>exercitiis<f> finden</f>`).

3. **Mis on `<f>`, mis mitte:**
   - Švaabahher ja teised gooti trükikirjad on `<f>`.
   - Kreeka ja heebrea **ei ole** `<f>` ka fraktuurlõigu sees. „Mitte-`<f>` =
     antiikva“ kehtib ainult ladina tähestikule.
   - Antiikva kursiiv fraktuuri sees on `<i>` ilma `<f>`-ita.
   - `<f>` ei ületa reapiiri. Marginaalias on ta `<m>` sees (`<m><f>Ge⸗</f></m>`),
     nagu iga inline-täg (`marginalia_inline`).
   - Ainult numbritest või kirjavahemärkidest koosnevat lõiku ei märgita, sest kirja
     ei saa sealt määrata.

4. **Poolitusmärk ja `<f>` peavad klappima:** rea lõpu `⸗` on `<f>`-i sees ja `-`
   väljas. Poolitusmärki **ei tuletata** salvestamisel, see on diplomaatiline
   transkriptsioon ja jääb toimetaja otsuseks. Vastuolu on kontroll treeningekspordis
   (vt Tagajärjed) ja hiljem võimalik redaktori hoiatus.

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
   4. **Fraktuurteos:** iga rea fraktuurlõigud (väljaspool `<cs>`-i) mähitakse `<f>`-i ja
      `<cs>` eemaldatakse (selle sisu on antiikva). Kehtivad punkti 3 reeglid.
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
  ja `vuttTagsConsumers.test.ts` kukuvad, kui midagi jääb puudu. Kõvasti kodeeritud
  `cs`-loendid väljaspool registrit tuleb üle käia: `wrapTagUtils.ts` (`['i','b','cs']`),
  `useEditorFormattingActions.ts`, `EditorToolbar.tsx` (𝔉 nupp), LOSSi
  `convert_marginalia.py` regexid (`i|b|cs|hi`). Juhend: `<f>` reeglid punktist 3.
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
