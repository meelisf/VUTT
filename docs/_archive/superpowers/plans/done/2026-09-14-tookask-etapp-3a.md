# Töökäsk — VUTT etapp 3A

Sa teostad ühe etapi olemasolevast plaanist. Plaan on valmis ja läbi
vaadatud; sinu ülesanne ei ole seda ümber mõelda, vaid teostada ja teatada,
kui midagi selles ei pea paika.

## Skoop

**Teosta plaani `docs/superpowers/plans/2026-09-14-kasutajad-ja-kogude-ligipaas-3.md`
osa „Osa 3a — server + kasutajadetail" (Task 0 kuni Task 7).**

- **Task 7 samm 2 (käsitsi kontroll brauseris) EI KUULU sinu skoopi.** Kirjuta
  selle asemel PR-i kirjeldusse nimekiri, mida brauseris kontrollida — teeb
  keegi teine.
- **Osa 3b (Task 8–11) ei kuulu sinu skoopi.** See tuleb eraldi töökäsuna
  pärast 3a merge'i.
- Ära merge'i midagi. Ära juuruta midagi. Ära puuduta serverit (`ssh vutt`).

## Enne esimest muudatust loe läbi

Selles järjekorras — iga järgmine eeldab eelmist:

1. `CLAUDE.md` repo juurest. Projekti töökord ja invariantide loend; iga rida
   seal on midagi, mis on varem katki läinud. Eriti: **Python 3.9 ühilduvus**
   (`Optional[dict]`, mitte `dict | None`), blokeeriv I/O `async def` sees on
   keelatud (ADR 0002), i18n `fallbackLng` on **väljas**, testid käivad
   `.venv/bin/pytest`-iga, **koodikommentaarid eesti keeles**.
2. `docs/decisions/0031-contributor-kollektsiooni-ulatus.md` — kaks õiguste
   telge. Kui sa seda valesti mõistad, teed vale UI.
3. `docs/decisions/0043-kogude-oiguste-uhised-toimingud.md` — selle töö
   arhitektuuriotsus, eriti p2 (delta-toiming) ja p7 (täieliku kaardi leping).
4. `docs/superpowers/specs/2026-09-14-kasutajad-ja-kogude-ligipaas-design.md`
   §1 ja §5. Plaan argumenteerib speki pealt.
5. Plaan ise.

Etapid 1a, 1b ja 2 on juba tootmises (PR #361–#365). Sinu töö toetub nende
serveripoolsele deltale `POST /admin/users/collection-rights` ja kliendi
mustrile. **Vaata enne kirjutamist need kaks faili läbi:**

- `src/pages/admin/collectionRightsDraft.ts` — sinu uus `userRightsDraft.ts`
  on selle peegelpilt (seal read kasutajate kohta ühes kogus, sinul kogude
  kohta ühel kasutajal). Alused `assigned` / `role_based` / `inert` peavad
  tähendama sama asja mõlemas.
- `src/components/CollectionAccessPanel.tsx` — sinu detailvaate õiguste plokk
  peab olema sama muster (mustand + „Salvesta muudatused", laadimisviga ei
  muutu tühjaks kaardiks, kinnitatud olek tuleb serveri vastusest).

## Töökeskkond

- **Tee endale oma tööpuu või kloon.** Põhitööpuus võib olla teine sessioon;
  `git add -A` seal neelaks võõra töö. Lavasta alati NIMELISELT.
- Haru: `feat/kasutajate-detail-3a`, baasiks värske `main` (peab sisaldama
  committi `d27fd281` või uuemat — see on plaan ise).
- Väravad, mis peavad rohelised olema enne iga committi:
  `.venv/bin/pytest tests/ -q` (Task 1–2),
  `npm run typecheck` + `npm test` (Task 3–6).
  PR-i lõpus lisaks `npm run lint:ci` ja `npm run build`.
- `npm run lint:ci` lävi on `--max-warnings 44`. **Läve ei tõsteta.** Kui sinu
  muudatus toob uusi hoiatusi, paranda need; kui vanu kaob, LANGETA arvu.
- Uut teeki ei lisata. Projektis EI OLE `@testing-library/react`-i ega jsdom-i
  (`vitest.config.ts` → `environment: 'node'`) ja seda ei muudeta selle töö
  raames. Seepärast on testid puhastel moodulitel, mitte komponentidel — nii
  on plaan meelega kirjutatud.

## Commitide attributsioon

Plaani commit-plokid sisaldavad `Co-Authored-By: Claude Opus 5` rida ja
sessiooni-URL-i. **Need on plaani autori omad — ära kopeeri neid.** Kasuta oma
attributsiooni või jäta trailerid üldse ära. Commiti sõnumi esimene rida
kopeeri plaanist, see on kokku lepitud.

## Kuidas läheneda

**Task-haaval, järjekorras, iga task lõpeb committiga.** Taskid on
järjestatud nii, et server on enne klienti ja puhtad moodulid enne vaadet —
ära hüppa ette.

Iga taski sees on TDD-tsükkel välja kirjutatud: kirjuta test, **käivita ja
veendu, et ta kukub**, siis teosta, siis käivita uuesti. Ära jäta
kukkumiskontrolli vahele. Kui test läbib enne teostust, siis ta ei valva
seda, mida sa arvad — peatu ja ütle seda, ära kirjuta üle.

Plaan annab Task 1–5 koodi valmis kujul. **Task 6 on ainus koht, kus plaan
annab nõuded, mitte valmis koodi:** `UserDetail.tsx` renderdus on kirjas
tingimuste ja i18n-võtmete loendina (samm 2, „Renderduse nõuded"). Seal ole
aeglane ja põhjalik; vaste on `CollectionAccessPanel.tsx`.

## Viis asja, mis lähevad siin kõige tõenäolisemalt katki

1. **Kaks õiguste telge ei ole üks.** `allowed_collections` on lugemisõigus
   piiratud kogule; `edit_collections` on contributori kirjutamisulatus, mis
   kehtib KÕIGILE kogudele, ka avalikele. Üks ei anna teist. Kirjutamisulatuse
   lisamine **ei tohi vaikselt lugemisõigust juurde panna** — plaanis on selle
   asemel selgitus + eraldi nupp („Ulatus üksi ei ava…" + „Lisa lugemisõigus").
   Nende liitmine üheks „ligipääsu" märkeruuduks näeks välja nagu lihtsustus,
   aga rikub ADR 0031.

2. **Laadimisviga ei tohi muutuda tühjaks õiguste kaardiks.** Tühi mustand
   näeb välja nagu „õigusi ei ole" ja selle salvestamine kustutaks kõik.
   Plaanis: `setLaetud(null); setMustand(null)` ja salvestusnuppu ei renderdata.
   Sama serveris: `get_user_activity` **laseb git-veal tõusta**, ei tagasta
   tühja kaarti. Testi `test_git_viga_ei_muutu_tyhjaks_kaardiks` ei tohi
   „parandada" nii, et ta enam seda ei kata.

3. **Töökollektsioonide täieliku kaardi leping (ADR 0043 p7).**
   `PUT /work-sets/{id}/access` saab TERVE `access`-kaardi. `accessChanges`
   ehitab selle serverilt laetud `WorkSetSummary.access`-ist — ära ehita kaarti
   nähtavatest ridadest ega mustandist. Pärast salvestust **lae kogude loend
   uuesti ja ehita `wsMustand` uuest kaardist**: `revision` on muutunud ja vana
   revisioniga teine salvestus annaks 409-ahela. Osaline edu on tavaline
   tulemus, mitte erand — ühe kogu konflikt ei tohi teisi ära jätta.

4. **`ResetPasswordResult` väljatõste peab olema käitumisneutraalne.** Kastil
   on kolm olekut (#298: kiri saadetud / saatmine ebaõnnestus / posti ei
   saadetud) ja saadetud kirja korral on link **peidus, mitte ära võetud**.
   Ära lihtsusta seda ära. Plaan viitab reanumbritele „~364–420" — **otsi plokk
   sisu järgi** (`resetResult && (`), mitte reanumbri järgi. `Users.tsx` jääb
   selles PR-is alles ja peab kasutama sama komponenti.

5. **Git-logi loetakse TEKSTIST, mitte `Commit`-objektist.** `_read_author_dates`
   kasutab `repo.git.log(...)`-i. Ära vaheta seda `repo.iter_commits` +
   `commit.author` vastu: GitPythoni Commit loeb autori ja kuupäeva laisalt
   jagatud objektibaasist ja kaks samaaegset päringut said sama torust
   vahetusse — see oli #337 (õige teos, võõras autor). Vt `server/git_ops.py`
   kommentaari `_read_commit_meta` juures.

Lisaks: **i18n mõlemasse keelde korraga.** Iga uus võti läheb
`src/locales/et/admin.json` JA `src/locales/en/admin.json` samal committil.
Ühe unustamine katkestab buildi (`fallbackLng` on väljas) — valvurid on
`localeParity.test.ts` ja `translationKeysResolve.test.ts`.

## Millal peatuda ja küsida

- Kui sama käsk ebaõnnestub kaks korda samamoodi. Ütle, mis blokeerib; ära
  proovi variatsioone edasi.
- Kui plaan ütleb midagi, mis koodiga ei klapi (reanumbrid, funktsiooninimed,
  vastuse kuju). Plaan on kirjutatud 2026-09-14 seisuga commiti `d27fd281`
  vastu — kui `main` on vahepeal edasi läinud, ütle seda, ära kohanda vaikselt.
- Kui mõni olemasolev test kukub. **Selles etapis ei ole ühtki lubatud
  testiootuse muutust:** server saab ainult uue lugemisendpoint'i ja klient
  uue vaate. Kukkuv olemasolev test on regressioon.
- Kui kaalud uue teegi lisamist, serveri kirjutusteede muutmist või uue
  õiguste endpoint'i lisamist. Ära tee. Kirjutusteed on olemas (etapp 1a/2).

## Mida „valmis" tähendab

1. Task 0–7 tehtud, iga oma committiga.
2. `.venv/bin/pytest tests/ -q` · `npm run typecheck` · `npm test` ·
   `npm run lint:ci` (≤44) · `npm run build` — kõik rohelised, **käivitatud ja
   nähtud**, mitte eeldatud.
3. Haru pushitud, PR loodud `main` vastu. PR-i kirjelduses PEAB olema:
   - uus endpoint `GET /admin/users/activity` ja uus marsruut
     `/admin/users/:username`;
   - selgesõnaline lause, et **olemasolev kasutajate loend jääb selles PR-is
     alles** (ei teki akent, kus õigusi ei saa muuta) — loendi asendamine on
     etapp 3b;
   - brauseris kontrollitav nimekiri (võta plaani Task 7 sammust 2), mõlemas
     keeles;
   - mis jäi tegemata ja miks.
4. Aruanne: mis sa tegid, mis kukkus vahepeal ja miks, millised otsused sa
   Task 6 renderduse nõuete tõlgendamisel tegid, ja mida sa plaanis valeks
   pead.

Aus aruanne kukkumistest on väärtuslikum kui sile aruanne. Kui midagi jäi
tegemata, ütle see välja — ära raporteeri valmis olekut, mida ei ole.
