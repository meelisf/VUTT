# Töökäsk — VUTT etapp 2B

Sa teostad ühe väikese etapi olemasolevast plaanist. Etapp 2A on juba tehtud
ja tootmises (PR #363, #364) — sinu töö on selle järelosa.

## Skoop

**Teosta plaani `docs/superpowers/plans/2026-09-14-kasutajad-ja-kogude-ligipaas-2.md`
osa „PR B" (Task 7 ja Task 8).**

- Lõpeta PR-i loomisega. **Merge, juurutus ja `ssh vutt` EI kuulu skoopi.**
- Task 7 samm 7 (juurutus) ja samm 8 (tootmiskontroll) jäta tegemata; kirjuta
  nende asemel PR-i kirjeldusse, mida tuleb tootmises kontrollida.

See on väike töö: rollipiiri muudatus, ainult frontend, serverit ei puutu.
Kui see paisub, oled kuskil valesti pööranud — peatu ja ütle.

## Enne esimest muudatust loe läbi

1. `CLAUDE.md` repo juurest — projekti töökord ja invariandid. Eriti: i18n
   `fallbackLng` on väljas, koodikommentaarid **eesti keeles**, testid
   `.venv/bin/pytest`-iga.
2. `docs/decisions/0043-kogude-oiguste-uhised-toimingud.md`, punkt 4 — see
   ongi selle etapi otsus.
3. Plaani osa „PR B".

## Töökeskkond

- Haru: `feat/kogude-loend-adminile-2b`, baasiks värske `main`
  (peab sisaldama committi `92b5fea6` või uuemat).
- Kui töötad põhitööpuus, **lavasta failid NIMELISELT** — `git add -A` võib
  neelata teise sessiooni tööd.
- Väravad, mis peavad rohelised olema enne committi:
  `npm run typecheck` · `npm test` · `npm run lint:ci` · `npm run build`.
  Jooksuta lõpus ka `.venv/bin/pytest tests/ -q` — server ei muutu, aga
  lepingud peavad kehtima.
- `npm run lint:ci` lävi on `--max-warnings 44`. **Läve ei tõsteta.**

## Commitide attributsioon

Plaani commit-plokid sisaldavad eelmise teostaja `Co-Authored-By` rida ja
sessiooni-URL-i. **Ära kopeeri neid.** Kasuta oma attributsiooni või jäta
trailerid ära. Commiti sõnumi esimene rida kopeeri plaanist.

## Plaan on 2A-eelne — need kohad on nihkunud

Plaani Task 7 kirjutati enne, kui 2A `CollectionEditor.tsx`-i ümber tegi.
Fail on nüüd **596 rida** (oli 668) ja plokid on kommentaaridega märgitud.
Kasuta neid, mitte plaani reanumbreid:

| Rida | Plokk | `canEditSettings === false` |
|---|---|---|
| 279 | Kollektsiooni valik | **JÄÄB** |
| 296 | Värv | peida |
| 303 | Nähtavus | peida |
| 335 | Ligipääs (`CollectionAccessPanel`) | **JÄÄB** |
| 353 | Lühikirjeldus | peida |
| 381 | Pikk kirjeldus | peida |
| 409 | Salvesta + Kustuta | peida |
| 482 | Lisa uus kollektsioon | peida |

`Collections.tsx` ja `Admin.tsx` ei ole vahepeal muutunud — plaani sammud 2
ja 4 kehtivad nagu kirjas. `Admin.tsx`-is tarbitakse `superadminOnly` ühes
kohas (rida 137, `cards.filter`), seega rea 98 lipu eemaldamine on piisav.

## Neli asja, mis siin kõige tõenäolisemalt katki lähevad

1. **Peitmine EI OLE autoriseerimine.** Server jätab kollektsiooni seadete
   endpointidele `require_role("superadmin")` alles ja **nii peabki jääma**.
   Ära lisa serverisse midagi. Ära „paranda" 401-e, mida admin sealt saab —
   need on õige käitumine.
2. **Admini vaade ei tohi jääda katkiseks paigutuseks.** Kui peidad kuus
   plokki kaheksast, jääb järele kogu valik + ligipääsupaneel. Vaata, et see
   näeks välja nagu vaade, mitte nagu poolik vorm.
3. **Ligipääsupaneel peab adminile TÖÖTAMA, mitte ainult paistma.** Ta laeb
   `GET /admin/collections/{id}/users` (admin+, töötab) ja salvestab
   `POST /admin/users/collection-rights` (admin+, töötab). Kontrolli, et
   paneel ei sõltu ühestki väärtusest, mis tuleb ainult peidetud vormist.
   Eriti: paneeli `key` võtmestab salvestatud nähtavuse
   (`collections[selectedId]?.visibility`) — see tuleb kontekstist, mitte
   vormist, seega peaks jääma toimima. **Kontrolli see üle.**
4. **i18n mõlemasse keelde korraga.** Kui lisad adminile selgituse, miks ta
   seadeid ei näe, läheb võti `et` JA `en` faili samal ajal. Ühe unustamine
   katkestab buildi (`fallbackLng` on väljas).

## Task 8 — ADR: KITSENDA, ära eemalda

ADR 0043 „Tagajärjed" all on üleminekumärkus, mis ütleb, et etapid on
tegemata. **Etapid 3 ja 4 on ikka tegemata**, seega märkust EI eemaldata.
Kitsenda teda: nimeta, mis on tehtud (1a, 1b, 2) ja mis on lahti (3, 4).
`docs/decisions/README.md` registris on kirje staatusega „teostus ootel
(#318)" — jäta see praegu nii.

## Millal peatuda ja küsida

- Kui sama käsk ebaõnnestub kaks korda samamoodi.
- Kui plaan ütleb midagi, mis koodiga ei klapi. Plaani Task 7 on 2A-eelne —
  ülal on parandused, aga võib olla veel. Ütle, ära kohanda vaikselt.
- Kui mõni olemasolev test kukub. Selles etapis EI OLE ühtki lubatud
  testiootuse muutust — kui midagi kukub, on see regressioon.
- Kui kaalud uue teegi lisamist või serveri muutmist. Ära tee kumbagi.

## Mida „valmis" tähendab

1. Task 7 ja 8 tehtud, iga oma committiga.
2. `npm run typecheck` · `npm test` · `npm run lint:ci` (≤44) ·
   `npm run build` · `.venv/bin/pytest tests/ -q` — kõik rohelised,
   **käivitatud ja nähtud**, mitte eeldatud.
3. Haru pushitud, PR loodud `main` vastu. PR-i kirjelduses:
   - mida admin nüüd näeb ja mida ei näe,
   - selgesõnaline lause, et serveri autoriseerimine ei muutunud ja peitmine
     ei ole autoriseerimine,
   - tootmises kontrollitav nimekiri (sinu eest keegi teine teeb selle).
4. Aruanne: mis sa tegid, mis kukkus, millised otsused tegid plaani lünkades,
   ja mida sa plaanis valeks pead.

Aus aruanne kukkumistest on väärtuslikum kui sile aruanne. Kui midagi jäi
tegemata, ütle see välja.
