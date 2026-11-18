# 0085 — Pildiredaktor on üks vaade: kärbe ja poolitus samal pildil

**Staatus:** vastu võetud, teostatud (2026-11-18). Täiendab ADR 0049 (kaks redaktorit,
ühine `pagePrep/`) ja ADR 0061 (punkt „kumbki avab redaktori oma vahekaardil").

## Kontekst

Mõlemal pildiredaktoril (teose halduse `PageImageEditorModal`, upload'i `SplitPageDetail`)
oli kaks vahekaarti, „Pööra ja kärbi" ja „Poolita". Lehe poolitamiseks ja kärpimiseks tuli
nende vahel hüpata. Märkimata kärbe läks vahekaardi vahetusel vaikselt plaani ja kasutajale
ei olnud selge, kus tegevus käib. Vahekaarte eristas sisuliselt ainult see, mis pilti näidati:
kärpimisel toores (pööratud) pilt, poolitamisel serveri eelvaade, kus kärbe on juba rakendatud.
Põhjus oli see, et `split_x` on **kärbitud** pildi laiuse osa (pööre → `adjust` → poolitus).

## Otsus

1. **Üks vaade.** Toores (pööratud) pilt, sellel kärpekast ja poolitusjoon korraga.
   Vahekaarte ei ole.
2. **Joon kärpe raamis, üks geomeetria** (`pagePrep/splitGeometry.ts`). Iga kärbe on ekraanil
   väljundi nelinurk TL, TR, BR, BL (`pendingAdjustOutline`). Aktiivne kast läheb sinna läbi
   `toServerParams`, ootel kärbe otse, ja kärpeta leht on kogu raam. Joon `x` on lõik
   `lerp(TL,TR,x)` → `lerp(BL,BR,x)`. See on täpne nii telgjoondatud kui kallutatud kastil
   (jäik pööre) kui ka perspektiivil, sest serveri `Image.QUAD` on **bilineaarne**: püstjoon
   väljundis on sirge lõik, mis jagab ülemise ja alumise serva samas suhtes. Klõpsu `x`
   leitakse pöördfunktsiooniga (bisektsioon), mitte ristküliku valemiga.
3. **Žestid.** Lohistus tühjal alal joonistab kärpekasti. **Klõps ilma liikumiseta paneb
   joone** (ka kasti sees). See on kasutaja kiireim töövõte ja PEAB jääma. Klõps käib ainult
   poolitataval lehel: poolitamata lehel ei tekita klõps poolitust, poolituse lülitab sisse
   nupp. Klõpsu lävi on 4 px. Klõps ei muuda kasti (kallet ega asukohta) ega loe
   kasutaja muudatuseks (`userEdited`).
4. **Kõik on kohe ootel.** Iga lõpetatud toiming lehel (kast pärast hiire lahtilaskmist,
   tööriistariba, pööre, joon) läheb KOHE ootel plaani (`usePendingCrop`, `crop.editSeq`).
   Pilt ise muutub alles „Rakenda"/„Edasi" peale. „Märgi" ega „Järgmine" nuppu ei ole:
   liikumine käib jaluse paremas servas noolte kaudu (‹ N / M ›, ka ← →), mis ei rakenda
   ega kaota midagi. Pakkumise korral ilmub noolte VASAKULE „Kärbi ja järgmine" (nooled
   ei nihku). Varem kehtis kolm eri reeglit: joon
   kohe, kast „Märgi" peale, pööre halduses „Märgi" peale ja upload'is kohe. Märkimata
   kast kadus lehelt lahkudes vaikselt.
   - **Ekraanil olev kast = ootel kärbe.** Lehele tagasi tulles taastatakse ootel kärbe
     MUUDETAVA kastina (`crop.restore`, pöördteisendus `serverParamsToRotatedCrop`).
     Taastamine ei ole kasutaja muudatus ega kirjuta plaani. Taastamine ootab, kuni
     kuvamõõdud kuuluvad selle lehe pildile (`imgReady`/`loadedKey`): lehe vahetuse
     renderdusel on olekus veel eelmise pildi mõõdud.
   - **Kärpe edasikandmine on eraldi lüliti** „Kanna kärbe edasi" (tööriistaribal,
     VAIKIMISI VÄLJAS). Väljas: uuele lehele kasti ise ei teki. Sees: kastita lehele
     pakutakse viimast kasti SAMASSE kohta (suurus, asukoht, kalle), mitte keskele.
     Pakkumine on punktiiriga ja plaani läheb alles siis, kui kasutaja seda puudutab või
     „Kärbi ja järgmine" vastu võtab. Noolega edasi minnes lehte ei kärbita. Muidu kärbiks
     iga läbi lehitsetud lehte (2026-11-17). Varem tekkis pakkumine alati ja lehe keskele,
     mis oli segadusttekitav.
   - Joone raam on plaani kärbe; lohistuse ajal järgib joon kasti juba enne kirjutust.
   - Päise ja jaluse kõrgus ei sõltu lehe olekust (päis ühel real, vihje fikseeritud
     kõrgusega), muidu hüppab pilt.
5. **Tulemuse eelvaade on lüliti** („Näita tulemust"). See näitab serveri renderdust nähtava
   pöörde ja kärpega (ADR 0061: CSS ei kattu lõikega täpselt) ja sirget joont, ainult
   vaatamiseks. Muutmine on selle ajal lukus. Lehe vahetus lülitab eelvaate välja.
6. **Teose halduse kaardil on üks nupp** (redaktor), mitte kaks.

## Tagajärjed

- `EditorTabs`, `initialTab`, `useSplitDrag` ja ristküliku-põhine `SplitLine` on
  eemaldatud. Joon on `SplitGuide` (otspunktid `splitSegment`-ist), tulemuse eelvaates
  lihtne püstjoon.
- Uus kärpe kuju (nt muu `adjust` liik) PEAB andma väljundi nelinurga
  `pendingAdjustOutline` kaudu, muidu läheb joon valesse kohta.
- Kui serveri perspektiiviteisendus muutub projektiivseks (`Image.PERSPECTIVE`), siis
  `splitGeometry` ei kehti: projektiivne kujutus ei säilita suhet servadel.
- Muudatus ühes redaktoris → ka teises (ADR 0049).
- Valvurid: `pagePrep/__tests__/splitGeometry.test.ts`, `usePendingCrop.test.tsx`,
  `useCropBox` klõpsutestid, `rotatedCropParams` edasi-tagasi test, mõlema redaktori
  komponenditestid.
