# Seoste võrgustik: lähikond esile

**Kuupäev:** 2026-11-13
**Issue:** #812
**Plaan:** `docs/superpowers/plans/2026-11-13-seoste-vorgustik-lahikond.md`
**Seotud:** #461 (seoste vaated), ADR 0056 (seose liik, osa ulatus #464)
**Ulatus:** ainult frontend, isikulehe „Seosed" → vahekaart „Võrgustik"

## Eesmärk

Võrgustikuvaade peab vastama kahele küsimusele:

1. **Kellega töötas isik kõige rohkem koos?**
2. **Kes olid tema lähikonna inimesed?**

Praegune ringvaade ei vasta kummalegi. Kõik seotud isikud on fookusest samal kaugusel,
sama suured ja kõik nimedega, nii et kolme ühise teosega isik ei eristu ühekordsest.
Hallid kaaslaste kaared joonistavad sama fakti („olid samas teoses") kümneid kordi ja
teevad pildi tihedaks.

Edu: isikulehe avaja näeb ilma ühegi klõpsuta, kes on lähikond (nimed, järjestus
läheduse järgi), ja ühe klõpsuga, kellega mõni lähikonna isik fookuse ümber koos esines.

Proovitud ja tagasi lükatud (ära paku uuesti): ringid koos teose-mullidega (jooned
jooksid lähedastest läbi, ei mahtunud kasti), „saared" rollirühmadega, ajatelg
rühmapealkirjade ja lahtiklapitavate koondridadega (liiga koormav). Kasutaja hinnang:
lihtne pilt kahe küsimuse jaoks, mitte rohkem mõõtmeid.

## Mis ei muutu

- Ajatelg, kaart ja loend, sealhulgas nende järjestus.
- Serveripool ja võrgustiku API. Kõik arvutatakse olemasolevast vastusest
  (`VisibleNetwork`, `applyFilters`).
- Nõrkade seoste linnukesed (kaastekst, mainimine, trükkal) ja „Ainult kogus". Need
  mõjuvad nagu praegu ENNE lähikonna arvutamist.
- Kaardi (hüpiku) sisu.
- Mõõt: SVG `viewBox` 900×600. Üle 40 isiku kõrgemat kasti (760) enam ei kasutata.

## Vaade

### Kes on lähikonnas

Sisend on `net.persons` (juba filtreeritud). Mõisted:

- **ühiseid teoseid** = `workCount` (unikaalsed `work_id`-d, nagu praegu);
- **sugulane** = isikul on nähtav `family`-serv.

Reegel:

- Kui nähtavaid isikuid on **kuni 15**, on kõik lähikonnas (pilt on niikuinii hõre).
  *(Minu otsus, kasutaja ei ole seda juhtu näinud.)*
- Muidu on lähikonnas sugulased ja isikud, kellel on **vähemalt 2 ühist teost**.
  Ülempiir on **15**: sugulased mahuvad alati, ülejäänud kohad täidetakse ühiste teoste
  arvu järgi kahanevalt, viigi korral nime järgi.
- Kõik ülejäänud on **serv**.

Konstandid `CLOSE_MIN_WORKS = 2`, `CLOSE_MAX = 15` elavad uues moodulis `utils/closeCircle.ts`.

Kui üle 15 isikuga võrgustikus ei kvalifitseeru keegi (kõigil üks teos, sugulasi ei ole),
on lähikond tühi: keskel fookus, kõik serval. See on aus pilt („lähikond ei eristu");
SVG all on sel juhul üks selgitav rida. Tavajuhul on SVG all üks lugemisjuhise rida
(kes on nimega, mis on serv, mida klõps teeb). *(Minu otsus, kasutaja ei ole seda juhtu näinud.)*

### Lähikonna paigutus

- Fookus keskel (450, 300), nagu praegu.
- Isikud on ovaalil, ühtlaste nurgavahedega, järjestus nagu praegu: liik
  (`KIND_ORDER`) → esimene aasta → nimi. Alla 5 isiku korral pööratakse algnurka 45°,
  et nimed ei satuks täpselt fookuse nime kohale ja alla.
- **Kaugus = ühiste teoste arv.** Tegur `f` vahemikus 0,5 (kõige lähemal) kuni 1,0:
  `f = 1 − 0,5 · (workCount − 2) / (max − 2)`, kus `max` on lähikonna suurim
  `workCount`; kui `max = 2`, siis kahe teosega isikul `f = 0,75`. Ühe teosega isik
  (esineb lähikonnas ainult kuni 15 isikuga võrgustikus) on välispiiril, `f = 1,0`.
  Sugulane, kellel on alla 2 ühise teose: `f = 0,625`. Koht: `x = cx + 265·f·cos a`, `y = cy + 180·f·sin a`.
- **Joon fookusest isikuni** ainult lähikonnal. Värv ja paralleeljooned mitme tugeva
  liigi korral jäävad nagu praegu (`personKinds`, `KIND_COLOR`); jämedus
  `1,5 + (workCount / max) · 5`, pereserv ilma teoseta püsijämedusega 2,5 ja katkendlik.
- **Märk**: `KindMark` nagu praegu, raadius `5 + √(workCount / max) · 6`.
- **Silt on horisontaalne** (mitte pööratud): nimi paksult, all teine rida
  „N ühist teost" ja/või suguluse liik (sama tekst, mida annab `familyRelation`-i
  `type`). Ankur: `cos a > 0,25` → alates märgist paremale, `< −0,25` → vasakule, muidu
  keskele üles või alla. Nimi lõigatakse 24 märgi peale kolmikpunktiga.
- Sildid ei tohi kattuda. Kokkupõrke lahendus (nihe piki y-telge, vajadusel juhtjoon)
  on ehitaja valik; nõue on, et 15 isikuga lähikonnas oleks iga nimi loetav.

### Serv

- Kõik lähikonda mitte kuuluvad isikud täppidena ovaalil `rx = 405`, `ry = 266`.
  Üle 110 täpi korral iga teine täpp teguriga 0,94 sissepoole (kaks rida).
- **Ajajärjestus päripäeva**, algus üleval: `firstYear` → liik → nimi; aastata isikud
  lõpus. Üleval on väike vahe (0,12 rad), kus ring algab ja lõpeb. Nurgad on ühtlased —
  see on järjekord, mitte mõõtkava.
- **Aastamärgid** serva taga: kriips ja aastaarv kohas, kus algab uus aasta, kui
  eelmisest märgist on vähemalt 0,13 rad. Aastata lõigu märk on tõlgitav „aeg teadmata".
- Täpp: värv liigi järgi, raadius 3 ja läbipaistvus 0,32; isikul, kellel on vähemalt
  2 ühist teost, aga kes ülempiiri tõttu lähikonda ei mahtunud, raadius 4 ja 0,6.
- Jooni fookusest servale EI OLE. Nimesid vaikimisi ei ole.
- Tabamisala on täpist suurem (läbipaistev ring r = 9).

### Mis kaob

- Hallid kaaslaste kaared ja lüliti „kaaslaste jooned / ainult fookus"
  (`network.coLines`, `network.focusOnly`).
- Pööratud sildid, `many`-režiim ja vihje `network.labelsHint`.
- `radialLayout` praegusel kujul; kasutamata jäänud abilised ja tõlkevõtmed
  eemaldatakse mõlemast keelest.

## Käitumine

### „Samas teoses"

Kaks isikut on kaasosalised, kui neil on ühine **(teos, osa)** võti — sama rühmitus,
mida kasutab `coEdges` (`work_id#part_id`). Paljas `work_id` ei kõlba: kirjakogu seoks
kõik kirjutajad omavahel (ADR 0056, #464). Pereservad ilma teoseta kaasosalust ei loo.

### Hõljutus

Hiir isiku peal (lähikond või serv), kui ühtki isikut ei ole valitud:

- isik ise ja tema kaasosalised jäävad täisheledaks (servatäpid läbipaistvusega 0,95),
  kõik muu tuhmub;
- kahe **lähikonna** isiku vahele, kes on kaasosalised, joonistub peen hall kaar
  (ainult hõljutuse või valiku ajaks);
- ilmub praegune hõljukvihje (`popover.hover`), muutmata.

Hiire lahkumisel taastub pilt.

### Valik (klõps)

Klõps isikul avab **praeguse kinnitatud kaardi** (`popover.pin`) ja valib isiku:

- esiletõst jääb püsima, kuni kaart on lahti;
- valitud isiku ümber on rõngas;
- valitud isiku kaasosalistest servatäppidele ilmuvad nimed: kuni **14**, eelistatult
  need, kellel on valituga kõige rohkem ühiseid (teos, osa) võtmeid. Nimed on täpist
  ringi sisepoole, ei kattu omavahel (lükatakse y-teljel lahku);
- hõljutus teise isiku peal ei muuda esiletõstu. Servatäpi kohal ilmub ainult selle
  täpi nimi (kerge silt täpi juures, mitte hõljukkaart — see on valiku ajal lukus).

**Valiku ainus tõeallikas on kaardi olek** (`popover.state.pinned` + `personId`).
Graafis eraldi valiku-olekut ei hoita. Sellest järeldub:

- kaardi sulgemine (nupp, Esc, klõps mujale) taastab pildi algkuju;
- klõps teisel isikul vahetab kaardi ja valiku;
- isiku vahetus lehel sulgeb kaardi nagu praegu ja valik kaob.

### Lohistatav kaart

Kinnitatud kaarti saab **päisest** (nimerida) lohistada, et ta ei kataks seda, mida
vaadatakse. *(Minu otsus: kehtib kõigis seoste vaadetes, sest kaart on ühine.)*

- Ainult kinnitatud olekus; hõljukvihje ei ole lohistatav.
- Pointer-sündmused (hiir ja puude), kaart jääb vaateakna piiresse.
- Uuel avamisel (uus klõps) tuleb kaart jälle kursori kõrvale; nihet ei mäletata.
- Lohistamine ei tohi kaarti sulgeda ega käivitada linke; päises on `cursor: move`.
- Kaardi sisu kerimine ja lingid töötavad nagu praegu.

## Piirangud

- i18n (ADR 0011): iga uus võti korraga `et` ja `en`; eemaldatud võtmed mõlemast.
- z-index: kaart jääb `z-[1300]`.
- Ligipääsetavus: SVG `aria-label` jääb; tekstiline samaväärne on vahekaart „Loend".
  Värv ei ole ainus tunnus (kuju `KindMark`-ist jääb).
- `usePopover.hover` ei tohi iga hiireliigutusega kogu võrgustikku uuesti renderdada
  (praegune kaitse jääb).

## Testid

- `utils/__tests__/network.test.ts`: `radialLayout`-i testid asenduvad uue paigutuse
  testidega — lähikonna reegel (≤ 15 kõik; ≥ 2 teost või sugulane; ülempiir, sugulased
  mahuvad alati), kaugus kahaneb ühiste teoste arvuga, serv ajajärjestuses, tühi lähikond.
- Kaasosalus (teos, osa) võtme järgi: kirjakogu eri osade kirjutajad EI OLE kaasosalised.
- `RelationsViews.test.tsx`: lähikond nimedega, serv nimedeta; hõljutus tõstab esile
  kaasosalised; kinnitatud kaart hoiab valikut ja selle sulgemine taastab.
- `RelationPopover.test.tsx`: lohistamine nihutab kaarti ega sulge seda; uus kinnitus
  lähtestab asukoha.

## Ehitaja otsustada

- Siltide kokkupõrke lahendus (lähikond ja servanimed).
- Lohistamise teostus (oma väike hook vs. otse komponendis).
- Selgitava rea ja uute siltide täpne sõnastus (et/en).

## Visandi päritolu

Paigutuse arvud (ovaalide mõõdud, tegurid, läved) on võetud töötavast visandist, mida
kasutaja hindas kolme isiku päris andmetega: Johannes Uppendorf (`vutt:Pz5yvqo`,
23 isikut → 4 lähikonnas), Johann Fischer (`vutt:Pu837uz`, 62 → 7, sh abikaasa ja tütar),
Lorenz Luden (`vutt:Pfxxxsc`, 192 → 15). Nendega tasub valmis vaadet kontrollida
(tunnel + dev-server). Visand kasutas kaasosaluseks paljast `work_id`-d; päris lahendus
kasutab (teos, osa) võtit, mistõttu Fischeri kirjakogu puhul süttib vähem isikuid kui visandis.
