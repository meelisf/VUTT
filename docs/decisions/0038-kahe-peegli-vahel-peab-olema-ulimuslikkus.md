# ADR 0038 — Kahe peegli vahel peab olema ülimuslikkus

**Kuupäev:** 2026-09-08
**Staatus:** vastu võetud
**Seotud:** ADR 0007 (read-model ei ole autoriteet), ADR 0010 (lehe vahetus)
**Issue:** #333 (viga), #323 (mille parandus silmuse sulges)

## Kontekst

Aktiivne kogu elab kahes kohas: `CollectionContext`-i olekus ja URL-i
`?collection=` parameetris. Mõlemad peavad kokku langema — kontekst juhib
päringuid, URL teeb vaate jagatavaks.

Kuni #323-ni oli see lahendatud kahe eraldi effectiga eri failides:

- `useCollectionUrlSync` kirjutas URL-i konteksti järgi, aga **ainult kogu
  vahetusel**;
- `Dashboard.tsx` ja `Statistics.tsx` seadsid konteksti URL-i järgi.

#323 parandas päris vea (jagatud link ei kandnud kogu) sellega, et tegi
esimese kirjutuse tingimusteta. Sellega sulgus silmus.

Tootmises mõõdetud tagajärg: URL vahetus avalehel ülem- ja alamkogu vahel
(`universitas-dorpatensis-1` ↔ `academia-gustaviana`) ~30 ms tagant, kümneid
sekundeid, kuni brauser hakkas `replaceState`-i piirama.

```
12  URL=ülem    ls=ülem
14  SET alam          ← Dashboardi effect
55  URL=alam    ls=alam
56  SET ülem          ← Dashboardi effect
94  URL=ülem
```

Kumbki effect ei olnud vale. Vale oli see, et **kumbki reageeris teise
EELMISELE väärtusele**. React-i effect näeb seda olekut, mis oli renderduse
hetkel; kui mõlemad pooled kirjutavad, on kummagi sisend teise juba aegunud
väljund. Ühe sammu faasivahest sünnib stabiilne 2-tsükkel: iga samm vahetab
mõlemad väärtused korraga, seega pooled ei jõua enam kunagi kokku. Selline
tsükkel ei sumbu — ta lõpeb ainult välise piiraja tõttu.

Oluline: viga ei olnud „unustasime deps-massiivi". Faasivahe võib tekkida iga
kord, kui URL ja kontekst muutuvad samas tiksus eri väärtusele.

## Otsus

**1. Kaks kohta, mis peavad kokku langema, ei tohi teineteist tingimusteta
peegeldada. Üks pool peab suutma öelda, KUMB liikus.**

Aktiivse kogu puhul teeb seda `agreed`: viimane väärtus, milles URL ja
kontekst kokku leppisid (meie enda kirjutis või omaks võetud väline muutus).
Lahknemise põhjus on sellest üheselt loetav:

- URL kannab veel kokkulepitut → liikus **kontekst** (kasutaja vahetas kogu)
  → kirjuta URL üle;
- URL kannab midagi muud → liikus **URL väljastpoolt** (jagatud link,
  tagasi-nupp, rakendusesisene `navigate('/?collection=…')`) → võta see
  konteksti.

**2. Omaksvõtt ei kirjuta URL-i.** See on tsükli struktuurne välistus:
lahknemine lõpeb ühe sammuga, mitte ei vasta uue kirjutusega. Ühtlasi jäävad
jagatud lingi ülejäänud parameetrid (`page`, filtrid) puutumata.

**3. Suuna otsustab puhas funktsioon** — `decideCollectionSync`
(`src/contexts/collectionSync.ts`), sama muster mis `resolveInitialCollection`.
Ülimuslikkuse järjekord ON siin kogu sisu, seega peab ta olema testitav ilma
React-ita. Testide hulgas on mudel, mis jooksutab tervet süsteemi (otsus →
olek → otsus) ja nõuab, et **iga** algseis jõuab püsipunkti — mitte et üks
teadaolev juht ei võngu.

**4. Sünkroniseerimine elab ÜHES kohas** — `useCollectionUrlSync`. Dashboardi
ja Statistika vastassuunalised effectid on kustutatud. Uus leht, mis tahab
kogu URL-is hoida, kutsub hooki; ta EI kirjuta oma kontrolli.

## Tagajärjed

- `useCollectionUrlSync` vajab nüüd `setSelectedCollection`-i ja
  `collections`-it — ta ei ole enam ühesuunaline.
- Tundmatu kogu URL-is (kustutatud või ligipääsmatu) ei ole omaksvõetav: vaadet
  ei tühjendata ja URL parandatakse. `?page=` jääb alles, sest see ei ole
  kasutaja tehtud vahetus.
- Leht lähtestatakse 1-le AINULT päris vahetusel (URL kannab veel
  kokkulepitut). Esimene peegeldus ja katkise lingi parandus jätavad `?page=`
  alles — muidu kaotaks `?page=3`-ga saabunud link kohe oma lehe.

## Üldistus

Sama muster kordub kõikjal, kus kaks olekukohta peavad kokku langema: URL ja
komponendi olek, `localStorage` ja kontekst, kaks read-modelit. Kaks
tingimusteta peeglit on lõputu tsükkel, mis ootab faasivahet. Kirjuta üles,
KUMB pool liikus, või anna ühele poolele ülimuslikkus — „mõlemad parandavad
teineteist" ei ole kokkulepe.
