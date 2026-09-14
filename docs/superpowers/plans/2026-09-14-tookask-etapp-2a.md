# Töökäsk — VUTT etapp 2A

Sa teostad ühe etapi olemasolevast plaanist. Plaan on valmis ja läbi
vaadatud; sinu ülesanne ei ole seda ümber mõelda, vaid teostada ja teatada,
kui midagi selles ei pea paika.

## Skoop

**Teosta plaani `docs/superpowers/plans/2026-09-14-kasutajad-ja-kogude-ligipaas-2.md`
osa „PR A" (Task 0 kuni Task 6, samm 2 kaasa arvatud).**

- **Task 6 sammud 3 ja 4 EI KUULU sinu skoopi.** Need on tootmisjuurutus.
  Lõpeta PR-i loomisega ja teata.
- **PR B (Task 7–8) ei kuulu sinu skoopi.**
- Ära merge'i midagi. Ära juuruta midagi. Ära puuduta serverit (`ssh vutt`).

## Enne esimest muudatust loe läbi

Selles järjekorras — iga järgmine eeldab eelmist:

1. `CLAUDE.md` repo juurest. See on projekti töökord ja invariantide loend.
   Iga rida seal on midagi, mis on varem katki läinud. Eriti: Python 3.9
   ühilduvus, i18n `fallbackLng` on väljas, testid käivad `.venv/bin/pytest`-iga,
   koodikommentaarid on **eesti keeles**.
2. `docs/decisions/0043-kogude-oiguste-uhised-toimingud.md` — selle töö
   arhitektuuriotsus.
3. `docs/decisions/0031-contributor-kollektsiooni-ulatus.md` — kaks õiguste
   telge. Kui sa seda valesti mõistad, teed vale UI.
4. `docs/superpowers/specs/2026-09-14-kasutajad-ja-kogude-ligipaas-design.md`
   §2 „Kollektsioon", §3, §5. Plaan argumenteerib speki pealt.
5. Plaan ise.

Etapid 1a ja 1b on juba tootmises (PR #361, #362). Sinu töö toetub nende
serveripoolsele deltale `POST /admin/users/collection-rights` ja 1b
paneelimustrile `src/pages/admin/WorkSetAccessPanel.tsx` — vaata seda enne
oma paneeli kirjutamist, sest sinu oma peab olema sama muster.

## Töökeskkond

- **Tee endale oma tööpuu või kloon.** Põhitööpuus võib olla teine sessioon;
  `git add -A` seal neelaks võõra töö. Lavasta alati NIMELISELT.
- Haru: `feat/kollektsiooni-oigused-delta-2a`, baasiks värske `main`.
- Väravad, mis peavad rohelised olema enne iga committi:
  `.venv/bin/pytest tests/ -q` (serveritaskid),
  `npm run typecheck` + `npm test` (kliendi taskid).
  PR-i lõpus lisaks `npm run lint:ci` ja `npm run build`.
- `npm run lint:ci` lävi on `--max-warnings 44`. **Läve ei tõsteta.** Kui sinu
  muudatus toob uusi hoiatusi, paranda need.

## Commitide attributsioon

Plaani commit-plokid sisaldavad `Co-Authored-By: Claude Opus 5` rida ja
sessiooni-URL-i. **Need on eelmise teostaja omad — ära kopeeri neid.**
Kasuta oma attributsiooni või jäta trailerid üldse ära. Commiti sõnumi
esimene rida kopeeri plaanist, see on kokku lepitud.

## Kuidas läheneda

**Task-haaval, järjekorras, iga task lõpeb committiga.** Taskid on
järjestatud nii, et server on enne klienti — ära hüppa ette.

Iga taski sees on TDD-tsükkel välja kirjutatud: kirjuta test, **käivita ja
veendu, et ta kukub**, siis teosta, siis käivita uuesti. Ära jäta
kukkumiskontrolli vahele. Kui test läbib enne teostust, siis ta ei valva
seda, mida sa arvad — peatu ja ütle seda, ära kirjuta üle.

Plaan annab enamiku koodist valmis kujul. Kaks kohta on tahtlikult
otsustamiseks jäetud ja just neid ma vaatan:

- **Task 5 samm 2, NB-punktid 1–3.** Eriti punkt 3: seal on koodis
  `t('common:retry', { defaultValue: '' })` kohatäide. See EI TOHI jõuda
  committi sellisel kujul — kas leia `common.json`-ist olemasolev võti või
  lisa uus MÕLEMASSE keelde.
- **Task 5 samm 3.** See on ainus koht, kus plaan annab juhised, mitte valmis
  koodi: `CollectionEditor.tsx`-ist (668 rida) tuleb vana õiguste kiht välja
  lõigata. Ole seal aeglane ja põhjalik.

## Neli asja, mis lähevad siin kõige tõenäolisemalt katki

Need on juba korra katki läinud või on plaanis sisse kirjutatud lõksud:

1. **`allowed_users` läheb serverisse KAHEST kohast**, mitte ühest:
   `saveAllowedUsers` (iga kliki peale) ja `handleSave` payload-rida
   (~205). Ainult esimese eemaldamine annab kasutajaliidese, mis töötab kuni
   „Salvesta" nupuni ja siis 400. Otsi mõlemad üles:
   `grep -n "allowed_users" src/components/CollectionEditor.tsx`
2. **Kaks õiguste telge ei ole üks.** `allowed_collections` on lugemisõigus
   piiratud kogule; `edit_collections` on contributori kirjutamisulatus, mis
   kehtib KÕIGILE kogudele, ka avalikele. Nende liitmine üheks „ligipääsu"
   märkeruuduks näeks välja nagu lihtsustus, aga rikub ADR 0031. Praegune
   õiguste UI on `editVisibility === 'restricted'` tingimuse SEES — see peab
   sealt välja tulema.
3. **Task 2 keeldumine peab käima ENNE kõrvalmõjusid.** Kontroll läheb kohe
   `body = await request.json()` järele, mitte pärast `save_config_with_git`-i.
   Testi `test_keeldumine_kaib_ENNE_korvalmojusid` ei tohi „parandada" nii,
   et ta enam seda ei kata.
4. **Laadimisviga ei tohi muutuda tühjaks õiguste kaardiks.** Tühi kaart näeb
   välja nagu „õigusi ei ole" ja selle salvestamine kustutaks kõik. Plaani
   komponendis on see lahendatud (`mustand === null` → salvestusnuppu ei
   renderdata); ära lihtsusta seda ära.

## Millal peatuda ja küsida

- Kui sama käsk ebaõnnestub kaks korda samamoodi. Ütle, mis blokeerib; ära
  proovi variatsioone edasi.
- Kui plaan ütleb midagi, mis koodiga ei klapi (reanumbrid, funktsiooninimed,
  vastuse kuju). Plaan on kirjutatud 2026-09-14 seisuga — kui `main` on
  vahepeal edasi läinud, ütle seda, ära kohanda vaikselt.
- Kui mõni olemasolev test kukub ja sa pead selle ootust muutma. Task 2
  sammus 4 on üks selline teadlikult lubatud (lepingu muutus 200 → 400).
  **Iga muu** testiootuse muutmine on kas regressioon või vajab põhjendust —
  ütle see välja, ära paranda vaikselt.
- Kui kaalud uue teegi lisamist. Ära lisa. Selles projektis ei ole
  `@testing-library/react`-i ega jsdom-i (`vitest.config.ts` →
  `environment: 'node'`) ja seda ei muudeta selle töö raames.

## Mida „valmis" tähendab

1. Kõik PR A taskid tehtud, iga oma committiga.
2. `.venv/bin/pytest tests/ -q` · `npm run typecheck` · `npm test` ·
   `npm run lint:ci` (≤44) · `npm run build` — kõik rohelised, **käivitatud
   ja nähtud**, mitte eeldatud.
3. Haru pushitud, PR loodud `main` vastu. PR-i kirjelduses PEAB olema:
   - see on **murdev muudatus** (`PUT /admin/collections/{id}` lükkab
     `allowed_users` 400-ga tagasi),
   - server ja klient peavad juurutuma KOOS,
   - mis jäi tegemata ja miks.
4. Aruanne: mis sa tegid, mis kukkus vahepeal ja miks, millised otsused sa
   plaani lünkades tegid (eriti Task 5 NB-punktid), ja mida sa plaanis
   valeks pead.

Aus aruanne kukkumistest on väärtuslikum kui sile aruanne. Kui midagi jäi
tegemata, ütle see välja — ära raporteeri valmis olekut, mida ei ole.
