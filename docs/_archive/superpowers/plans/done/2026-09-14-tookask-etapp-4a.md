# Töökäsk — VUTT etapp 4A

Sa teostad ühe väikese etapi olemasolevast plaanist. Etapid 1a–3b on tehtud ja
**tootmises** (PR #361–#367). Plaan on valmis ja läbi vaadatud; sinu ülesanne
ei ole seda ümber mõelda, vaid teostada ja teatada, kui midagi selles ei pea
paika.

## Skoop

**Teosta plaani `docs/superpowers/plans/2026-09-14-kasutajad-ja-kogude-ligipaas-4.md`
osa „Osa 4a — vanad kirjutusteed maha" (Task 0 kuni Task 3).**

- **Osa 4b ja 4c ei kuulu sinu skoopi.** Need on eraldi PR-id.
- Lõpeta PR-i loomisega. **Merge, juurutus ja `ssh vutt` EI kuulu skoopi.**
- See on EEMALDAMISE töö: serverisse ei lisandu ühtki uut endpointi ega
  funktsiooni, ainult üks valvurtest. Kui midagi hakkab juurde tekkima, oled
  kuskil valesti pööranud — peatu ja ütle.

## Enne esimest muudatust loe läbi

1. `CLAUDE.md` repo juurest — töökord ja invariandid. Eriti: **Python 3.9
   ühilduvus**, testid `.venv/bin/pytest`-iga, **koodikommentaarid eesti
   keeles**, ja rida „Funktsiooni eemaldamisel kontrolli ka `server/__init__.py`
   re-eksporte" — see on täpselt selle töö oht.
2. `docs/decisions/0043-kogude-oiguste-uhised-toimingud.md`, punkt 2 — „üks
   kirjutustee". See ongi eemalduse põhjus.
3. Plaani osa „Osa 4a".

Taust: alates etapist 2 kirjutab klient kollektsiooniõigusi ainult deltaga
(`POST /admin/users/collection-rights`) ja alates etapist 3b ei kutsu ükski
klient enam vanu endpointe. Vana täisasendus võis avalikuks muutunud kogu ID
sanitiseerimisel vaikselt maha võtta — just seepärast ta läheb, mitte
korrastamise pärast.

## Töökeskkond

- **Tee endale oma tööpuu või kloon.** Põhitööpuus võib olla teine sessioon;
  `git add -A` seal neelaks võõra töö. Lavasta failid NIMELISELT.
- Haru: `feat/vanade-oiguste-teede-eemaldus-4a`, baasiks värske `main` (peab
  sisaldama committi `f511b77a` või uuemat — see on plaan ise).
- Väravad: `.venv/bin/pytest tests/ -q` enne iga committi; PR-i lõpus ka
  `npm run typecheck` · `npm test` · `npm run lint:ci` · `npm run build`
  (klient ei muutu, aga lepingud peavad kehtima).
- `npm run lint:ci` lävi on `--max-warnings 43`. **Läve ei tõsteta.**

## Commitide attributsioon

Plaani commit-plokid sisaldavad `Co-Authored-By: Claude Opus 5` rida ja
sessiooni-URL-i. **Need on plaani autori omad — ära kopeeri neid.** Kasuta oma
attributsiooni või jäta trailerid ära. Commiti sõnumi esimene rida kopeeri
plaanist.

## Viis asja, mis lähevad siin kõige tõenäolisemalt katki

1. **Task 1 EI OLE punane-enne-rohelist tsükkel.** `tests/test_users_lock.py`
   valvur kolib kadumas oleva helperi pealt elava delta-tee peale. Ta peab
   läbima **nii enne kui pärast** eemaldust. Kui ta enne eemaldust ei läbi, ei
   testi sinu uus versioon lukku, vaid midagi muud — peatu ja ütle, ära
   „paranda" testi roheliseks.
   `apply_collection_rights_delta` valideerib kogu olemasolu
   `get_cached_collections()` kaudu — vaata `tests/test_collection_rights_delta.py`,
   kuidas see monkeypatch'itakse, ja tee samamoodi. Ilma selleta kukub delta
   „Kollektsiooni ei leitud" peale ja test näeb välja nagu lukuviga.

2. **`server/__init__.py` re-ekspordid.** Funktsiooni eemaldamine on selles
   projektis juba korra katki läinud just seal. Kontrolli enne committi:
   `grep -rn "update_user_allowed_collections\|update_user_edit_collections" server/`
   Import, mis osutab kadunud nimele, kukutab KOGU backendi käivitumisel —
   mitte testides, vaid tootmises.

3. **Kustutatud testide kate.** `tests/test_user_collections.py` (102 rida)
   testib kadunud helperi sisendikontrolli: tühi kasutajanimi, tüübikontroll,
   duplikaadid, sanitiseerimine, iseenda muutmise keeld. Enne kustutamist loe
   `tests/test_collection_rights_delta.py` läbi ja **ütle aruandes, millised
   kontrollid jäävad katmata.** Kui midagi olulist jääb katmata, ütle see
   välja — ära lisa omal algatusel uusi teste, aga ära ka vaiki.

4. **Eemalda täpselt kaks helperit.** `update_user_role`,
   `apply_collection_rights_delta`, `users_transaction`, `delete_user` ja kõik
   muu jäävad. `_RIGHTS_FIELDS` jääb (delta kasutab). Kui märkad, et mõni
   kommentaar viitab eemaldatud funktsioonile, paranda kommentaar — aga ära
   hakka `auth.py`-d muidu ümber korraldama.

5. **404 peab tulema marsruudi puudumisest**, mitte millegi muu pärast.
   Kontrolli, et `POST /admin/users/collection-rights` (delta) töötab edasi —
   plaani testi kolmas juht katab selle. Kui kõik kolm testi lähevad korraga
   roheliseks, aga delta on tegelikult katki, oled eemaldanud liiga palju.
   NB: selles koodibaasis annab ebapiisav roll **401, mitte 403**
   (`server/deps.py` `get_user`) — see puudutab vanu teste, mida sa loed.

## Millal peatuda ja küsida

- Kui sama käsk ebaõnnestub kaks korda samamoodi.
- Kui grep leiab vanadele helperitele KUTSUJA (mitte kommentaari). See
  tähendaks, et tee ei ole surnud, ja eemaldus vajab uut otsust.
- Kui plaan ütleb midagi, mis koodiga ei klapi. Plaan kirjutati 2026-09-14
  seisuga; ütle, ära kohanda vaikselt.
- Kui mõni muu olemasolev test kukub peale nende, mida plaan nimetab. Lubatud
  muutused on täpselt: `test_users_lock.py` (valvuri kolimine),
  `test_user_collections_api.py` (ümber kirjutatud) ja
  `test_user_collections.py` (kustutatud). **Iga muu** kukkuv test on
  regressioon.

## Mida „valmis" tähendab

1. Task 0–3 tehtud, iga oma committiga (kolm committi).
2. `.venv/bin/pytest tests/ -q` · `npm run typecheck` · `npm test` ·
   `npm run lint:ci` (≤43) · `npm run build` — kõik rohelised, **käivitatud ja
   nähtud**, mitte eeldatud.
3. Haru pushitud, PR loodud `main` vastu. PR-i kirjelduses PEAB olema:
   - mis eemaldati (kaks endpointi + kaks helperit) ja miks (ADR 0043 p2);
   - et klient ei kutsunud neid enam alates PR #367-st, mis on juba tootmises;
   - et **juurutus nõuab `./scripts/server_update.sh --no-cache`-i**, sest
     Python-kood muutus (juurutust ise ei tee);
   - mis jäi tegemata ja miks.
4. Aruanne: mis sa tegid, mis kukkus vahepeal, millised kontrollid jäid
   kustutatud testidest katmata (punkt 3), ja mida sa plaanis valeks pead.

Aus aruanne kukkumistest on väärtuslikum kui sile aruanne. Kui midagi jäi
tegemata, ütle see välja — ära raporteeri valmis olekut, mida ei ole.
