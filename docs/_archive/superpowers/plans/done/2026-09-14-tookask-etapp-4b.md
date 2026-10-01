# Töökäsk — VUTT etapp 4B

Sa teostad ühe etapi olemasolevast plaanist. Etapid 1a–4a on tehtud ja
**tootmises** (PR #361–#369). Plaan on valmis ja läbi vaadatud; sinu ülesanne
ei ole seda ümber mõelda, vaid teostada ja teatada, kui midagi selles ei pea
paika.

## Kõigepealt: tee endale OMA tööpuu

Repo põhikataloogis (`/home/mf/LLM/VUTT`) töötab teine sessioon. Kaks sessiooni
ühes checkout'is jagavad ühte HEAD-i ja ühte indeksit — 2026-09-14 läks see
korra katki nii, et üks pool tõmbas teise haru alt ära ja commit maandus
vales kohas.

```bash
cd /home/mf/LLM/VUTT
git fetch origin
git worktree add ../VUTT-4b -b feat/kogude-uhine-sisenemiskoht-4b origin/main
cd ../VUTT-4b
npm install            # oma node_modules
```

**Kogu töö käib `../VUTT-4b` sees.** Ära tee põhikataloogis ühtki
`git checkout`-i, `git stash`-i ega committi. Kui `git status` näitab seal
võõraid muudatusi, ei ole need sinu omad — jäta puutumata.

## Skoop

**Teosta plaani `docs/superpowers/plans/2026-09-14-kasutajad-ja-kogude-ligipaas-4.md`
osa „Osa 4b — ühine „Kogud" sisenemiskoht" (Task 4 kuni Task 9).**

- **Osa 4a on tehtud** (PR #369, tootmises) — seda ei korrata.
- **Osa 4c ei kuulu sinu skoopi.** Selle Task 10 on juba tehtud (PR #368);
  Task 11–12 tuleb eraldi.
- **Task 9 samm „käsitsi kontroll brauseris" EI KUULU skoopi** — seda pinda ei
  saa lokaalselt testida (`vite.config.ts` `DEV_BACKEND` ei vasta). Kirjuta
  kontrollnimekiri PR-i kirjeldusse.
- Lõpeta PR-i loomisega. **Merge, juurutus ja `ssh vutt` EI kuulu skoopi.**

## Enne esimest muudatust loe läbi

1. `CLAUDE.md` repo juurest — töökord ja invariandid. Eriti: i18n
   `fallbackLng` on **väljas**, **koodikommentaarid eesti keeles**, testid
   `.venv/bin/pytest`-iga, z-index kihid, „kerib AKEN, mitte konteiner".
2. `docs/decisions/0038-kahe-peegli-vahel-peab-olema-ulimuslikkus.md` —
   **selle etapi kõige tõenäolisem katkemiskoht.** Sinu filtrid elavad URL-is.
3. `docs/decisions/0042-tookollektsiooni-liikmesust-ei-indekseerita.md` ja
   `docs/decisions/0007-*` (tuletatud indeksid on read-modelid) — need
   määravad, mida „Teosed" tohib teha ja mida mitte.
4. `docs/superpowers/specs/2026-09-14-kasutajad-ja-kogude-ligipaas-design.md` §4.
5. Plaani osa „Osa 4b".

Vaata enne kirjutamist ka olemasolevat koodi, mida sa ümber paigutad:
`src/pages/admin/Collections.tsx` (kaob), `src/components/CollectionEditor.tsx`
(saab juhitava valiku), `src/pages/admin/WorkSets.tsx` (saab `?set=`
deep-lingi), `src/pages/Admin.tsx` (kaks kaarti → üks).

## Töökeskkond

- Haru: `feat/kogude-uhine-sisenemiskoht-4b`, baasiks `origin/main` (peab
  sisaldama merge-committi `2d97405a` või uuemat).
- Väravad enne iga committi: `npm run typecheck` · `npm test`.
  PR-i lõpus lisaks `npm run lint:ci` · `npm run build` · `.venv/bin/pytest tests/ -q`
  (server ei muutu, aga lepingud peavad kehtima).
- `npm run lint:ci` lävi on `--max-warnings 43`. **Läve ei tõsteta**; kui
  koristus vähendab hoiatusi, LANGETA arvu `package.json`-is.
- Uut teeki ei lisata. `@testing-library/react`-i ega jsdom-i projektis EI OLE
  (`vitest.config.ts` → `environment: 'node'`) — testid käivad puhastel
  moodulitel (`kogudeLoend.ts`, `diacritics.ts`), mitte komponentidel.

## Commitide attributsioon

Plaani commit-plokid sisaldavad `Co-Authored-By: Claude Opus 5` rida ja
sessiooni-URL-i. **Need on plaani autori omad — ära kopeeri neid.** Kasuta oma
attributsiooni või jäta trailerid ära. Commiti sõnumi esimene rida kopeeri
plaanist.

## Kuus asja, mis lähevad siin kõige tõenäolisemalt katki

1. **Kaks peeglit URL-i ja oleku vahel = lõputu tsükkel (#333, ADR 0038).**
   Hubi tüübifilter ja otsing elavad AINULT URL-is. Ära hoia neist paralleelset
   `useState`-koopiat, mida effect sünkroonib. Üks funktsioon kirjutab URL-i
   (`setSearchParams(..., { replace: true })`), kõik muu on tuletis.

2. **`?set=` on ÜHESUUNALINE sisenemispunkt.** `WorkSets.tsx` avab selle kogu
   paneelid mount'il, aga käsitsi avamine/sulgemine EI kirjuta URL-i tagasi.
   Tagasikirjutus oleks täpselt see teine peegel. Tundmatu `set` = tavaline
   loend, mitte viga.

3. **„Teosed" ei ole uus lugemistee.** Kollektsiooni detailis on LINK
   `/search?collection=<paljas id>` — parameeter on ainsuses ja paljas id
   (mitte `c:<id>`, mitte `collections`), seda loeb `useCollectionUrlSync`.
   Teoste kuuluvus elab `_metadata.json`-is ja otsingus (ADR 0007): uut loendit,
   endpointi ega read-modelit ei ehitata.
   See link MUUDAB aktiivset kogu — see on otsingulehe enda leping, mitte
   vastuolu punktiga 1. Keelatud on admin-lehel oma vastassuunalise peegli
   ehitamine, mitte otsingusse navigeerimine.

4. **`CollectionEditor` juhitav/juhtimata muster.** Ilma `selectedId` propita
   peab editor töötama täpselt nagu enne. **Kogu LOOMISE ja KUSTUTAMISE järel
   seab editor valiku ise** (`setSelectedId(uusId)` / `setSelectedId('')`) —
   need kohad peavad käima uue `vahetaValik`-i kaudu, muidu jääb hub vana rea
   peale ja kasutaja toimetab nähtamatut kogu.

5. **Hub peab töötama ka ilma admini õiguseta.** Töökollektsiooni HALDUR
   (editor/contributor) jõuab siia ja näeb ainult töökollektsioone;
   kollektsioonide pool on admin+. Peitmine ei ole autoriseerimine — server
   kontrollib edasi ja kollektsiooni SEADED jäävad superadminile.

6. **Ei ühtki uut päringut liikmete kohta** (ADR 0042). Hubi loend kasutab
   ainult seda, mille `listWorkSets` juba annab. Liikmete arv per kogu on
   kutsujapõhine ja seda hubis ei näidata.

Lisaks: **i18n mõlemasse keelde korraga** (`src/locales/et/admin.json` JA
`en/admin.json` samal committil) — valvurid `localeParity.test.ts` ja
`translationKeysResolve.test.ts`. Ja enne `Collections.tsx` kustutamist
kontrolli, et keegi seda enam ei impordi (`grep -rn "admin/Collections" src/`).

## Millal peatuda ja küsida

- Kui sama käsk ebaõnnestub kaks korda samamoodi.
- Kui plaan ütleb midagi, mis koodiga ei klapi. Plaan kirjutati enne PR #368-t
  ja #369-t; `CollectionAccessPanel.tsx` sisu on vahepeal muutunud (lülitid
  käivad nüüd läbi `rightsControl`-i). 4b ei pea seda puutuma, aga kui plaan
  eeldab vana kuju, ütle seda, ära kohanda vaikselt.
- Kui mõni olemasolev test kukub. Selles etapis **ei ole ühtki lubatud
  testiootuse muutust** — server ei muutu ja olemasolevad kliendi testid
  katavad puhtaid mooduleid.
- Kui kaalud uue teegi lisamist, serveri muutmist, pagineerimise lisamist või
  töökollektsiooni paneelide väljatõstmist `WorkSets.tsx`-ist. Kõik neli on
  teadlikult skoobist väljas (vt plaani „Teadlikult väljas").

## Mida „valmis" tähendab

1. Task 4–9 tehtud, iga task oma committiga.
2. `npm run typecheck` · `npm test` · `npm run lint:ci` (≤43) · `npm run build`
   · `.venv/bin/pytest tests/ -q` — kõik rohelised, **käivitatud ja nähtud**,
   mitte eeldatud.
3. Haru pushitud, PR loodud `main` vastu. PR-i kirjelduses PEAB olema:
   - mis kuhu liikus (kaks sisenemiskohta → üks; kollektsiooni detail;
     `?set=` deep-link) ja millised vanad URL-id edasi toimivad;
   - selgesõnaline lause, et andmemudeleid ei liidetud ja „Teosed" on link
     otsingusse, mitte uus lugemistee;
   - tootmises kontrollitav nimekiri (plaani Task 9), mõlemas keeles, sh
     rollivaated: superadmin / admin / töökollektsiooni haldur;
   - mis jäi tegemata ja miks.
4. Aruanne: mis sa tegid, mis kukkus vahepeal, millised otsused tegid Task 7 ja
   8 renderduse nõuete tõlgendamisel, ja mida sa plaanis valeks pead.

Aus aruanne kukkumistest on väärtuslikum kui sile aruanne. Kui midagi jäi
tegemata, ütle see välja — ära raporteeri valmis olekut, mida ei ole.
