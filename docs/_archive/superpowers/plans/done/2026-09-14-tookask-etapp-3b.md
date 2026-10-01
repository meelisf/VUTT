# Töökäsk — VUTT etapp 3B

Sa teostad ühe etapi olemasolevast plaanist. Etapp 3A on tehtud ja
**tootmises** (PR #366) — sinu töö on selle järelosa: kasutajate loend.
Plaan on valmis ja läbi vaadatud; sinu ülesanne ei ole seda ümber mõelda,
vaid teostada ja teatada, kui midagi selles ei pea paika.

## Skoop

**Teosta plaani `docs/superpowers/plans/2026-09-14-kasutajad-ja-kogude-ligipaas-3.md`
osa „Osa 3b — kompaktne nimekiri" (Task 8 kuni Task 11).**

- **Task 11 samm 3 (käsitsi kontroll brauseris) EI KUULU sinu skoopi.** Seda
  pinda ei saa lokaalselt testida (`vite.config.ts` `DEV_BACKEND` ei vasta) ja
  kontroll tehakse tootmises. Kirjuta nimekiri PR-i kirjeldusse.
- **Task 11 samm 4 (ADR 0043 staatus) KUULUB skoopi** — vt allpool „ADR".
- Ära merge'i midagi. Ära juuruta midagi. Ära puuduta serverit (`ssh vutt`).

## Enne esimest muudatust loe läbi

1. `CLAUDE.md` repo juurest. Projekti töökord ja invariandid; iga rida seal on
   midagi, mis on varem katki läinud. Eriti: i18n `fallbackLng` on **väljas**,
   **koodikommentaarid eesti keeles**, testid `.venv/bin/pytest`-iga.
2. `docs/decisions/0038-aktiivne-kogu-urlis.md` — **see on selle etapi kõige
   tõenäolisem katkemiskoht.** Sinu filtrid elavad URL-is ja kaks tingimusteta
   peeglit tekitasid #333-s lõputu tsükli.
3. `docs/decisions/0043-kogude-oiguste-uhised-toimingud.md` ja
   `docs/superpowers/specs/2026-09-14-kasutajad-ja-kogude-ligipaas-design.md` §1.
4. Plaani osa „Osa 3b".

Vaata enne kirjutamist ka:

- `src/pages/admin/UserDetail.tsx` (3A) — sinna kolisid konto toimingud ja
  õiguste toimetamine. Sinu töö on need loendist **ära võtta**, mitte dubleerida.
- `src/utils/userSearch.ts` — diakriitikatundetu otsing on JAGATUD utiliit, sa
  taaskasutad seda `userListFilter.ts`-is (`searchUsers`). Uut otsingut ei kirjuta.

## Töökeskkond

- **Tee endale oma tööpuu või kloon.** Põhitööpuus võib olla teine sessioon;
  `git add -A` seal neelaks võõra töö. Lavasta alati NIMELISELT.
- Haru: `feat/kasutajate-loend-3b`, baasiks värske `main` (peab sisaldama
  merge-committi `490d2768` või uuemat — see on 3A).
- Väravad enne iga committi: `npm run typecheck` · `npm test`.
  PR-i lõpus lisaks `npm run lint:ci` · `npm run build` · `.venv/bin/pytest tests/ -q`
  (server ei muutu, aga lepingud peavad kehtima).
- `npm run lint:ci` lävi on `--max-warnings 44`. **Läve ei tõsteta.** Kui sinu
  koristus vähendab hoiatusi, **LANGETA arvu** `package.json`-is.
- Uut teeki ei lisata. `@testing-library/react`-i ega jsdom-i projektis EI OLE
  (`vitest.config.ts` → `environment: 'node'`) ja seda ei muudeta. Seepärast on
  test puhtal moodulil (`userListFilter.ts`), mitte komponendil.

## Commitide attributsioon

Plaani commit-plokid sisaldavad `Co-Authored-By: Claude Opus 5` rida ja
sessiooni-URL-i. **Need on plaani autori omad — ära kopeeri neid.** Kasuta oma
attributsiooni või jäta trailerid üldse ära. Commiti sõnumi esimene rida
kopeeri plaanist.

## Kuidas läheneda

Task-haaval, järjekorras, iga task lõpeb committiga. Task 8 on TDD-tsükkel
välja kirjutatud koodiga: kirjuta test, **käivita ja veendu, et ta kukub**,
siis teosta. Kui test läbib enne teostust, siis ta ei valva seda, mida sa
arvad — peatu ja ütle.

Task 10 (`Users.tsx` ümberkirjutus) on suurim tükk ja plaan annab seal tuuma
koodi + renderduse nõuded, mitte tervet faili. See on **eemaldamise töö sama
palju kui lisamise töö**: praegusest 722-realisest failist kaob inline õiguste
toimetamine, kebab-menüü ja portal-popoverid.

## Viis asja, mis lähevad siin kõige tõenäolisemalt katki

1. **Kaks peeglit URL-i ja oleku vahel = lõputu tsükkel (#333, ADR 0038).**
   Filtrid elavad **ainult URL-is** (`useSearchParams`) — ära hoia neist
   paralleelset `useState`-koopiat, mida effect URL-iga sünkroonib. Kui sul
   tekib `useEffect`, mis kirjutab URL-i oleku pealt, ja teine, mis kirjutab
   oleku URL-i pealt, oled just selle vea ehitanud.
   Kasuta `setSearchParams(..., { replace: true })`, et iga klahvivajutus ei
   tekitaks ajaloo-kirjet.
2. **Admin-filter EI OLE koguvalik.** `rights_collection` ja `rights_work_set`
   on haldusloendi filtrid. **`useCollectionUrlSync`-i ei kutsuta**,
   `CollectionContext`-i ei kirjutata, aktiivne kogu ei muutu. Kui sa kirjutad
   koguvaliku konteksti, muudad kasutaja Dashboardi vaadet admin-lehelt —
   seda kontrollitakse tootmises esimese asjana.
3. **Aktiivsuse viga ≠ „ei ole midagi teinud".** `getUserActivity()` viskab
   vea korral. Kriips (`—`) tähendab „vastet ei ole"; **laadimisvea korral ei
   tohi kriipse näidata** — siis on `activity === null`, veerg jääb tühjaks ja
   ülal on teade `users.list.activityFailed`. Loend ise peab edasi töötama.
4. **Loendist eemaldatav kood peab päriselt kaduma.** `handleRoleChange`,
   `handleDeleteUser`, `handleResetPassword`, `handleCollectionsChange`,
   `handleEditCollectionsChange`, `handleWorkSetRoleChange`, `popoverStyle`,
   `anchorRect`, `createPortal`-menüüd ja nende `useState`-id lähevad maha
   koos kasutuseta jäävate importidega (`createPortal`, `apiPost`, lucide
   ikoonid, `accessChanges`, `setWorkSetAccess`, `getWritableCollectionOptions`,
   `ResetPasswordResult`…). Kontrolli lõpuks: `npm run lint:ci` ei tohi
   kasvada ja `npx tsc --noEmit` ei tohi kurta kasutamata muutujate üle.
   **`listWorkSets(true)` JÄÄB** — töökollektsiooni filter vajab `access`-kaarte.
5. **Klaviatuur ja filtrid peavad kokku klappima.** Aktiivne rida on indeks
   FILTREERITUD loendis. Kui filter muutub, lähtesta indeks 0-le (plaanis on
   see `seaFilter`-is), muidu osutab Enter eelmise tulemuse kirjele. Kontrolli
   ka, et indeks ei jää üle `nahtavad.length - 1`.

Lisaks: **i18n mõlemasse keelde korraga** (`src/locales/et/admin.json` JA
`en/admin.json` samal committil) — valvurid `localeParity.test.ts` ja
`translationKeysResolve.test.ts`.

## ADR (Task 11 samm 4)

`docs/decisions/0043-kogude-oiguste-uhised-toimingud.md` staatusrida ja
`docs/decisions/README.md` kirje ütlevad praegu, et 1a, 1b ja 2 on tootmises
ning 3–4 lahtised. **Kitsenda, ära eemalda:** pärast sinu tööd on tehtud
1a, 1b, 2 ja 3, lahtine on 4. Märkust „teostus pooleli" ei kustutata, sest
etapp 4 on ikka tegemata.

NB: sinu PR ei ole veel tootmises, kui sa selle kirjutad. Sõnasta nii, nagu
plaan ette näeb (tehtud = main'is), ja ütle aruandes, et juurutus on tegemata.

## Millal peatuda ja küsida

- Kui sama käsk ebaõnnestub kaks korda samamoodi. Ütle, mis blokeerib.
- Kui plaan ütleb midagi, mis koodiga ei klapi. Plaan kirjutati enne 3A-d;
  3A muutis `Users.tsx`-i (parooli-kast ja kuupäevavorming on nüüd eraldi
  moodulid `ResetPasswordResult.tsx` ja `src/utils/formatDateTime.ts`) ja
  lisas rea-lingi detaili. Reanumbrid plaanis on 3A-eelsed — **otsi sisu
  järgi**. Ütle, kui midagi on nihkunud, ära kohanda vaikselt.
- Kui mõni olemasolev test kukub. Selles etapis **ei ole ühtki lubatud
  testiootuse muutust** — server ei muutu, kliendi testid katavad puhtaid
  mooduleid.
- Kui kaalud uue teegi lisamist, serveri muutmist või pagineerimise lisamist.
  Ära tee. Pagineerimine on spekis teadlikult väljas.

## Üks teadaolev ebatäpsus plaanis

Plaani Task 8 testis `test_editor_ei_paase`-laadseid asju ei ole, aga tea
üldiselt: **rollipuudus annab selles koodibaasis 401, mitte 403**
(`server/deps.py` `get_user`). Kui kirjutad kuskile serveri ootuse, kasuta
401-t. 3A-s parandati plaani sama viga.

## Mida „valmis" tähendab

1. Task 8–11 tehtud, iga oma committiga.
2. `npm run typecheck` · `npm test` · `npm run lint:ci` (≤44, LANGETA kui
   hoiatusi jäi vähemaks) · `npm run build` · `.venv/bin/pytest tests/ -q` —
   kõik rohelised, **käivitatud ja nähtud**, mitte eeldatud.
3. Haru pushitud, PR loodud `main` vastu. PR-i kirjelduses PEAB olema:
   - mis loendist kadus ja kuhu see läks (detailvaade, 3A);
   - URL-parameetrite nimed (`q`, `role`, `rights_collection`, `rights_work_set`)
     ja selgesõnaline lause, et need EI muuda aktiivset kogu (ADR 0038);
   - tootmises kontrollitav nimekiri (plaani Task 11 samm 3), mõlemas keeles;
   - mis jäi tegemata ja miks.
4. Aruanne: mis sa tegid, mis kukkus vahepeal ja miks, millised otsused tegid
   Task 10 renderduse nõuete tõlgendamisel, ja mida sa plaanis valeks pead.

Aus aruanne kukkumistest on väärtuslikum kui sile aruanne. Kui midagi jäi
tegemata, ütle see välja — ära raporteeri valmis olekut, mida ei ole.
