# Dashboard cold-start review

Kuupäev: 2026-03-19
Fookus: miks `/?collection=universitas-dorpatensis-1` võib hommikul esimesel avamisel kaua "keerelda", aga kohe järgnev hard refresh tuleb kiiresti ette.

## Peamised tähelepanekud

1. Dashboardi spinner on seotud otsingu laadimisega, mitte auth spinneriga.
   `Dashboard` näitab keerlevat loaderit siis, kui lokaalne `loading` on `true` [src/pages/Dashboard.tsx:844](/home/mf/LLM/VUTT/src/pages/Dashboard.tsx#L844).
   See `loading` seatakse `true` enne `searchWorks(...)` kutset [src/pages/Dashboard.tsx:328](/home/mf/LLM/VUTT/src/pages/Dashboard.tsx#L328).

2. `userLoading` loetakse küll kontekstist, aga seda dashboardi renderdamises ei kasutata.
   `const { user, isLoading: userLoading } = useUser();` on olemas [src/pages/Dashboard.tsx:33](/home/mf/LLM/VUTT/src/pages/Dashboard.tsx#L33), kuid `userLoading` ei osale nähtava spinneri juhtimises.
   See teeb admin-tokeni või sessiooni verifitseerimise peamiseks põhjuseks pigem ebatõenäoliseks.

3. Tokeni verifitseerimine toimub ainult siis, kui localStorage's on olemas `vutt_token` ja `vutt_user`.
   Kontroll tehakse `POST /verify-token` kaudu [src/contexts/UserContext.tsx:31](/home/mf/LLM/VUTT/src/contexts/UserContext.tsx#L31) ja käivitub provideri mountimisel [src/contexts/UserContext.tsx:49](/home/mf/LLM/VUTT/src/contexts/UserContext.tsx#L49).
   Kui see request oleks põhiprobleem, siis oleks oodata, et ka kohe järgnev hard refresh jääks samamoodi kinni. Kirjeldatud käitumine seda eriti ei toeta.

4. Tõenäoline on kaheastmeline esmane laadimine, kus esimene otsing tehakse enne kui URL-i kollektsioon on konteksti jõudnud.
   `selectedCollection` tuleb `CollectionContext` kaudu, mis laeb kõigepealt `/collections` [src/contexts/CollectionContext.tsx:29](/home/mf/LLM/VUTT/src/contexts/CollectionContext.tsx#L29).
   Alles pärast seda sünkroniseeritakse `?collection=` URL-ist konteksti [src/pages/Dashboard.tsx:123](/home/mf/LLM/VUTT/src/pages/Dashboard.tsx#L123).
   Otsinguefekt sõltub `selectedCollection` väärtusest [src/pages/Dashboard.tsx:367](/home/mf/LLM/VUTT/src/pages/Dashboard.tsx#L367), seega esimesel avamisel on võimalik järgmine jada:
   - esimene render läheb ilma õige kollektsioonita või default-kollektsiooniga;
   - `/collections` saabub;
   - `selectedCollection` muudetakse URL-i põhjal;
   - käivitatakse uus `searchWorks(...)`.
   Kui esimene päring on "külm" ja teine juba "soe", võib kasutaja tajuda seda just nii, et esimene avamine venib, aga kohe järgnev refresh on kiire.

5. Dashboardi otsing ise on raske.
   `searchWorks(...)` küsib kuni `5000` tulemust, palju välju ja facetid ühes päringus [src/services/searchService.ts:304](/home/mf/LLM/VUTT/src/services/searchService.ts#L304).
   Lisaks kasutatakse `collections_hierarchy` filtrit [src/services/searchService.ts:278](/home/mf/LLM/VUTT/src/services/searchService.ts#L278).
   Selline päring sobib hästi selgituseks, miks esimene "külm" päring võib võtta märgatavalt kauem kui järgmine sama filtriga päring.

6. Dashboardil on lisaks kunstlik 400 ms viivitus enne päringu tegelikku käivitamist.
   `fetchWorks()` käivitatakse `setTimeout(..., 400)` kaudu [src/pages/Dashboard.tsx:362](/home/mf/LLM/VUTT/src/pages/Dashboard.tsx#L362).
   See ei ole põhjus minutite/sekundite suurusjärgus aeglusele, aga ta teeb visuaalse "ootamise" veel selgemini nähtavaks.

## Mis tundub vähem tõenäoline

1. Admin-tokeni eripära.
   Koodis pole dashboardi põhiotsing seotud admin-õigustega. Admin mõjutab siin pigem UI lisavõimalusi, mitte shelfi laadimise põhiloogikat.

2. Thumbnailide cold start.
   Selle review eeldus on, et thumbid on juba olemas. Sellisel juhul thumbnaili laisk genereerimine ei ole põhisüüdlane.

## Tõenäolisim seletus

Kõige usutavam kombinatsioon on:

1. Esimese külastuse ajal tehakse vähemalt üks kallis Meilisearchi päring külmast olekust.
2. Dashboardi `collection`-sünkroonimine võib esimesel avamisel põhjustada lisapäringu või vähemalt nihutada õige päringu hilisemaks.
3. Kohe järgnev hard refresh tabab juba soojenenud rada: kollektsioonid on brauseris/teenuses olemas, Meili/OS cache on soe ja sama filtriga shelf tuleb kiiresti ette.

## Lühijäreldus

Kui otsida ühtainsat "huvitavat" põhjust, siis admin-token ei paista selle koodi põhjal tugev kandidaat.
Kui otsida praktilist seletust kirjeldatud käitumisele, siis kõige parem kandidaat on dashboardi esmane kahefaasiline laadimine koos raske Meili shelf-päringu cold-startiga.
