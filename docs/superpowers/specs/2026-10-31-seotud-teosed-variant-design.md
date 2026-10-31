# Seotud teosed: variandiseos (#701) — kavand

**Seis:** kavand, kinnitamata (2026-10-31). Issue [#701](https://github.com/meelisf/VUTT/issues/701).
Kontekst: [#696 arutelufail](2026-10-19-eksemplari-kiht-ja-paber-arutelu.md) (reegel 4), [#702](https://github.com/meelisf/VUTT/issues/702) (konvoluut), [#703](https://github.com/meelisf/VUTT/issues/703) (agendi tee).

## Miks

Mõnel trükisel on kaks **sisuliselt erinevat varianti**, ja mõlemad tuleb säilitada koos seletusega. Esimene juhtum on [`nri7ga`](https://vutt.utlib.ut.ee/work/nri7ga) (*Series lectionum*, Pärnu 1702). Lk 1 (Rīga LAB, R Acad. doyp. 1702:17) ja lk 2 (Uppsala UB) on sama plakattrüki kaks terviklikku eksemplari. Filosoofiateaduskonnas on Sjöberg ühes esimene ja teises viimane (professorite tüli), ja ka teaduskondade järjekord erineb. Praegu on need ühe teose kaks lehte, ja andmed seda ei ütle.

Arutelu reegel 4 ütleb: sisuliselt erinev eksemplar → eraldi teos seosega „sama väljaanne, variant". Andmeväli on olemas (`Relation.rel_type = 'isVersionOf'`), aga seda ei saa lisada ega näha. Selle töö järel saab `nri7ga` poolitada kaheks teoseks, mis näitavad teineteist.

Laiem eesmärk on see, et teose juures oleks üks koht, kus on näha, mis on teosega seotud. Konvoluut („samas köites", #702) lisandub sinna hiljem eksemplari kihiga ja on kasutajale tegelikult olulisem. See töö ehitab kuvamise nii, et konvoluut saab samasse kohta tulla ilma ümberehitamiseta.

## Eesmärgid

1. Toimetaja saab lisada ja eemaldada variandiseose kahe teose vahel.
2. Seos kirjutatakse **mõlemasse teosesse korraga**, ühe git-commitiga. Üks pool ei saa olla ilma teiseta.
3. Teose infopaneelil on plokk „Seotud teosed", kus on teise teose pealkiri, aasta ja esimene arhiiviviide, et kaks samanimelist varianti oleksid eristatavad.
4. Teosekaardil (avaleht, otsing) on näha, et teosel on seoseid, ja hiirega üle minnes näeb, millised.
5. `nri7ga` saab pärast käsitsi poolitust seose, ja see toimib.

## Mitte-eesmärgid

- **Muud seose liigid.** „Viitab" lahendatakse märksõnaga. Koguteose seost (`isPartOf`/`hasPart`) ei ehitata: füüsilise kooskuuluvuse katab konvoluut (#702), mitmeköitelise teose `series`. Andmetüübis jäävad liigid alles, aga kasutajaliides neid ei paku.
- **Konvoluut.** See kuulub eksemplari kihti (#696, #702). Siin jäetakse kuvamises talle ainult koht.
- **Seose märkus.** Variandi seletus läheb mõlema teose märkustesse (`notes`). `Relation` skeemi ei muudeta.
- **`series` kuvamine.** See on samas olukorras (andmetes on, ei kuvata), aga ei kuulu siia.
- **MCP.** `get_work` ei näita seoseid. Selle võib lisada #703 raames.
- **Poolitamine.** Lehti uude teosesse viivat toimingut praegu ei ole (haldusvaate „poolitus" lõikab ühe lehe pildi kaheks sama teose sees). `nri7ga` poolitatakse **käsitsi**: lk 2 pilt laaditakse üles uue teosena (Uppsala UB), seejärel kustutatakse lk 2 `nri7ga`-st. Mõlemad lehed on toores OCR, kaob ainult lehekommentaar, mis lisatakse uuesti. Toiming „Vii lehed uude teosesse" on eraldi issue [#705](https://github.com/meelisf/VUTT/issues/705) (vajalik `xzy2ee` jaoks).

## Anti-eesmärgid (rike, isegi kui tehniliselt töötab)

- **Ühepoolne seos.** A näitab B-d, aga B ei näita A-d. See juhtub, kui jääb mõni kirjutustee, mis muudab ainult ühte teost.
- **Seos annab ligipääsu.** Piiratud teose pildid või transkriptsioon muutuvad seose kaudu nähtavaks. **Pealkiri ja aasta võivad olla nähtavad** (kasutaja otsus 2026-10-31: seose olemasolu ei ole saladus, kaitstakse pilte ja teksti).
- **Rippuv seos.** Kustutatud teos jääb teise teose seostesse kehtiva lingina.
- **Aeglane avaleht.** 12 teosekaarti teevad ette 12 lisapäringut.

## Praegune seis (kontrollitud koodist)

| Kiht | Olemas | Puudub |
|---|---|---|
| Tüüp | `Relation { id, rel_type, label? }` (`src/types.ts:69`) | — |
| Salvestus | `relations` on `ALLOWED_METADATA_FIELDS`-is (`server/metadata_ops.py:30`) ja läbib `/update-work-metadata`-i (`server/routers/editing.py:321`, **nõuab `admin`-i**) | sisu kontroll, vastastikkus |
| Indeks | Meili dokumendis (`server/meili_doc.py:577`), frontend loeb (`src/services/meiliService.ts:98`) | — |
| Tootmisandmed | **0 teosel on `relations`** (kontrollitud serveris 2026-11-01) — koristus- ega migratsioonisammu ei ole vaja | — |
| Metaandmete vorm | `MetadataModal` saadab välju `buildMetadataPayload`-iga. `relations` ei ole vormis ega payloadis | — |
| Kuvamine | — | infopaneel, kaart |

Mitme teose ühe commitiga kirjutamiseks on olemas `bulk_update_works` (`server/metadata_ops.py:106`): üks `metadata_lock`, üks path-skoobitud commit, Meili sünk iga muutunud teose kohta. Muutusteta teosed jäetakse vahele (ADR 0012). Teose kustutamine elab `server/routers/admin.py` (~rida 400–425) ja kutsub juba `remove_work_facts`-i.

## Otsustatud lahendus

### Andmed

`_metadata.json` → `relations: [{ "id": "<work_id>", "rel_type": "isVersionOf" }]`.

- `id` on sihtteose `work_id` (nanoid).
- `label` uued kirjutused ei salvesta. Olemasolevat `label`-it ei loeta tõeallikaks (pealkiri tuleb kuvamisel, vt allpool). Kui vanades andmetes on `label`, jääb see puutumata.
- Sama (`id`, `rel_type`) paar on teose seostes ainult üks kord. Teos ei viita iseendale.
- **„Seoseid pole" = võtme puudumine.** Tühi `relations` (`[]` või `None`) eemaldatakse `_metadata.json`-ist võtmena (`meta.pop("relations", None)`, samas kohas kus `normalize_title_fields`). Muidu tekitaks no-op eemaldamine või viimase seose eemaldamine teosel, millel võtit polnud, tühja `"relations": []` kirjutuse ja commiti (`metadata_unchanged` on `old == new`, `server/save_diff.py:17`). Tootmises pole võtit ühelgi teosel.

### Kirjutustee (üks ja ainus)

**`PUT /works/{work_id}/relations`**, keha `{ "add": [{id, rel_type}], "remove": [{id, rel_type}] }`.

- Roll: `require_role("admin")`, sama mis metaandmete vormil. (Teadlik valik: `/works/{id}/parts` lubab `editor`-it, aga seos muudab kahe teose metaandmeid, ja metaandmete muutmine on admini oma.) Lisaks **`can_write_work` MÕLEMALE teosele** (`server/access_ops.py`). Admini puhul on see praegu alati tõene (`can_read_work` → admin, `can_write_work` → mitte-contributor), nii et kontroll on kaitse juhuks, kui roll kunagi langeb, mitte praegu testitav keeld.
- `rel_type` lubatud väärtus on praegu ainult `isVersionOf`. Muu → 400.
- Kontrollid: sihtteos on olemas (`find_directory_by_id`) ja ei ole sama teos → muidu 400. **Juba olemasoleva paari lisamine ja puuduva eemaldamine on idempotentsed no-opid (200)**, ilma kirjutuse ja commitita.
- Kirjutus käib **`bulk_update_works`**-iga: mõlema teose `(meta_path, transform)` paarid ühes kutses, mis annab ühe luku, ühe commiti ja Meili sünk'i mõlemale. **NB:** `bulk_update_works` talub praegu osalist riket: loetamatu fail või viskav transform märgitakse `failed`-iks ja ülejäänud kirjutatakse ikkagi (`metadata_ops.py` ~140–190). Seose jaoks oleks see ühepoolne seos. Seepärast **lisatakse `bulk_update_works`-ile range režiim** (`all_or_nothing=True`). Olemasolevad kutsujad jäävad vaikimisi praeguse käitumise juurde. (Minu valik; alternatiiv oleks eraldi kahe faili primitiiv, aga see kordaks luku, commiti ja sünk'i loogikat.) Range režiimi reeglid:
  1. **Valideerimine enne kirjutamist:** kõik failid loetakse ja kõik transformid rakendatakse mälus `metadata_lock`-i all, ENNE kui ükski fail kettale läheb (praegune kood teeb juba nii; uus on see, et ükskõik milline `failed` katkestab partii tervikuna ja kutsuja saab erindi).
  2. **Tagasipööramine elab `save_with_git`-i sees, `_git_write_lock`-i all** (uus parameeter, nt `rollback_on_error=True`, sarnaselt `commit_add_and_remove`-iga). `save_with_git` loeb enne `atomic_write_text`-i kõigi failide **algse toorsisu** (baidid) mällu. Vea korral (teise faili kirjutus või `git add`/`commit`) kirjutab ta failid baithaaval tagasi ja eemaldab need indeksist (`git reset -q -- <failid>`) **enne** `_git_write_lock`-i vabastamist. Põhjus: kui indeks jääks luku vabastamise ja tagasipööramise vahele staged olekusse, haaraks mõni teine `repo.index.commit()`-i kasutav tee (`delete_page_from_git`, `commit_new_work_to_git`, `delete_work_from_git`, `restore_deleted_work`) need failid oma commiti. Toorsisu taastab faili täpselt, mitte uuesti serialiseeritud `json.dumps(originals[p])`-ina.
  3. **Commiti viga** pööratakse samuti tagasi (p. 2). #418 ei taga paari ühist hilisemat commiti: ta võtab kaasa ainult järgmise salvestuse enda failid, nii et A seos võiks jõuda ajalukku B omast eraldi. Kutsuja saab vea (`PUT` → 500 „Seost ei salvestatud") ja Meili sünki ei tehta. Garantii on seega „üks commit või mitte midagi". **Erand:** kui ka tagasipööramine ebaõnnestub, on mõlemad pooled kettal (vastastikkus kehtib failisüsteemis), viga logitakse `record_server_error`-iga ja ajalukku võivad pooled jõuda eraldi. See on dokumenteeritud topeltrike, mitte tavatee.
  4. **Meili sünk** käib ainult pärast edukat kirjutust, mõlemale teosele (praegune käitumine). Transform loeb teose praegused `relations`-id luku all ja lisab või eemaldab, nii et samaaegne toimetaja ei kirjuta teise muudatust üle.
- Vastastikune liik: `isVersionOf` ↔ `isVersionOf`. Kaardistus on ühes tabelis (`INVERSE = {"isVersionOf": "isVersionOf"}`), et tulevane liik saaks oma pöördliigi samast kohast.
- Commiti sõnumid: lisamine `Seos: lisa variant nri7ga ↔ wq3k9p`, eemaldamine `Seos: eemalda variant nri7ga ↔ wq3k9p`, kustutuse koristus `Kustutamine: eemalda seosed nri7ga ↔ wq3k9p, b8m2xd` (nii jääb ajalukku, millega kustutatud teos seotud oli).
- Vastus 200: `{ "relations": [ … ] }` — lähteteose uued seosed lahendatud kujul (sama element mis GET-is). `git_committed` välja ei ole, sest commiti viga pööratakse tagasi ja on 500 (vt range režiim p. 3). Klient näitab vea korral `useNotify()` veateadet ja jätab ploki endisesse seisu.

**`/update-work-metadata` lükkab `relations`-i tagasi** (400, „Seoseid muudetakse /works/{id}/relations kaudu"), täpselt nagu `parts`-iga (`editing.py:327`). Vorm `relations`-it ei saada, nii et see ei murra midagi. Muud teed (`bulk_update_works` teistes kutsujates, upload, ADA import) `relations`-it ei kirjuta. Builder kontrollib seda `grep`-iga.

### Lugemine kuvamiseks

**`GET /works/{work_id}/relations`** → `[{ id, rel_type, title, title_en, title_original, title_devised, year, year_display, dating, archive_ref, readable }]`.

- Nõuab `can_read_work` **lähteteosele** (`optional_user`, avalik teos on avalik). Lähteteose lugemisõiguseta → 404 (nagu muudel teose GET-idel).
- Iga sihtteose kohta loetakse tema `_metadata.json` **kettalt värskelt** kuvamise hetkel (`load_work_metadata_by_id`, `server/work_sets_access.py:17`, vahemälu ei ole): pealkirjaväljad (`TitleFields`: `title`, `title_en`, `title_original`, `title_devised`), aastaväljad (`year`, `year_display`, `dating`) ja esimene arhiiviviide (`archive_id` + `reference`). `readable = can_read_work(siht, user)`.
- **Klient vormindab ise:** pealkiri `workDisplayTitle(rel, lang).main` kaudu (ADR 0064, `workTitle.ts`: uus kuvamiskoht ei kasuta paljast `title`-it), aasta `formatYearDisplay(year_display, year, t, dating)` kaudu. Nii on kuvamine liidese keeles sama mis kaardil ja infopaneelil.
- **Pealkiri ja aasta tagastatakse ka siis, kui `readable` on `false`.** Pilte ja teksti see otspunkt ei puuduta.
- Puuduv sihtteos (kustutatud, rippuv) → `{ id, rel_type, missing: true }`. Kuvamine jätab selle vahele.
- Vastus sõltub kasutajast → **ei lähe `server/cache.py`-sse** (ADR 0042).
- See ei ole üldine pealkirjaoraakel: tagastab ainult lugeda lubatud teose seoste sihtmärgid.

### Kustutamine

Teose kustutamisel (`admin.py` kustutustee) eemaldatakse tema `work_id` teiste teoste `relations`-ist. Sihtmärgid on kustutatava teose enda `relations`-is, ja vastastikkuse tõttu piisab neist. **Rippuvad sihtmärgid** (`find_directory_by_id(id) is None`) jäetakse koristuspartiist välja, muidu viskaks range režiim „faili ei leitud" ja teost ei saaks kustutada.

**Ühine kriitiline sektsioon.** Praegune kustutustee `metadata_lock`-i ei võta. Muidu võiks samaaegne `PUT` lisada uue seose pärast seda, kui kustutus on seoste loendi lugenud, ja see jääks koristamata. Reegel:
- Kustutus võtab `metadata_lock`-i (RLock, `server/utils.py:18`) ja hoiab seda, kuni (a) kustutatava teose `relations` on luku all loetud, (b) **ühe range `bulk_update_works` partiiga on seosed eemaldatud nii kustutatavalt teoselt kui kõigilt vastaspooltelt** ja (c) teose kaust on kettalt eemaldatud (piltide liigutus prügikasti + `shutil.rmtree`). Git-kustutuscommit, Meili kustutus ja indeksid võivad järgneda väljaspool lukku.
- **Meili sünk ei tohi käia luku all:** ilma `background_tasks`-ita teeb `bulk_update_works` sünkroonse `sync_work_to_meilisearch`-i (koos `wait_for_task`-iga). Kustutus annab seepärast koristuspartiile `background_tasks`, nii et vastaspoolte sünk käib pärast vastust ja väljaspool `metadata_lock`-i. **Kustutatav teos ise ei tohi Meili sünki saada** (ta kustutatakse kohe järel indeksist ja sünk võiks ta tagasi tuua või rmtree järel vigu anda). Mehhanismi (nt `bulk_update_works` parameeter sünkist välja jäetavate teede kohta) valib builder.
- `PUT /works/{id}/relations` kontrollib mõlema teose olemasolu luku all (range režiim: puuduv fail → viga). Seega kas `PUT` jõuab enne kustutust (ja kustutus koristab ka uue seose) või pärast (ja `PUT` saab 400, sest sihtteost pole).
- **Koristuse ebaõnnestumine:** kui partii (b) ebaõnnestub (range režiim viskab ja pöörab tagasi), **kustutus katkestatakse** enne kausta eemaldamist ja admin saab vea. Rippuvat seost ei teki; teos jääb alles oma seostega.
- **Hilisem kustutusviga:** kui (b) õnnestus, aga piltide liigutus või `rmtree` ebaõnnestub, jääb alles **seosteta** teos (vastaspooled on samuti puhtad), mitte ühepoolne seos. Admin saab vea ja võib kustutust korrata; seoseid uuesti ei teki.

**Taastamine.** Teose taastamine prügikastist (`restore_deleted_work`, `server/trash_ops.py`) teeb `git checkout <commit>^ -- <kaust>`. Kuna kustutus commitib seoste koristuse **enne** kustutuscommiti, on `<commit>^` tavaliselt juba koristuscommit, ja taastatud failis pole `relations`-it. See ei ole aga garantii (nt käsitsi kustutatud teos, koristuseta vana kustutus või muutunud järjekord), ja siis tooks taastamine tagasi ühepoolse seose. Seepärast **eemaldab taastamine igal juhul taastatud teose `relations`-i** (kaitse) samas toimingus: pärast `git checkout`-i ja **enne taastamise commiti ja Meili indekseerimist** kirjutatakse taastatud `_metadata.json` ilma `relations`-ita **ja stage'itakse uuesti** (`git checkout` täitis indeksi vana sisuga ja `repo.index.commit()` kasutab indeksit), nii et commit ja Meili indeks näevad juba puhast seisu (minu valik: taastamine on harv ja seose saab uuesti lisada; vastaspoolte taastamine eeldaks, et nood teosed pole vahepeal muutunud).

### Kasutajaliides

**Infopaneel (`src/components/editor/WorkInfoPanel.tsx`).** Arhiiviviidete järel on plokk „Seotud teosed", samas stiilis (väike suurtäheline silt + loend). Rühmitatud liigi järgi, praegu ainult „Variant". Rida: `→ pealkiri (lühendatud) · aasta · arhiiviviide`. `readable` → link teosele, vastasel juhul tekst lingita + märge „piiratud ligipääs".
- **Päring ainult vajadusel:** `getWorkMetadata` annab `work.relations` juba kätte. `GET /works/{id}/relations` tehakse ainult siis, kui seal on vähemalt üks `isVersionOf` kirje (pealkirjade ja `readable` lahendamiseks). Ilma seosteta teos ei tee lisapäringut. Adminile näidatakse siis ainult nuppu „+ Lisa variant".
- **Teose vahetus sama komponendi sees:** variandi lingil klõpsates (`/work/nri7ga/1` → `/work/wq3k9p/1`) komponent ei remonteeru (ADR 0010 vaim). Effect ja lokaalne olek sõltuvad `work.work_id`-st ning lähtestatakse selgesõnaliselt, et eelmise teose seosed ei jääks uue teose vaatesse; hiljaks jäänud vastus eelmise teose kohta visatakse ära.
- Plokki ei kuvata, kui `isVersionOf` seoseid ei ole ja vaataja ei ole admin.

**Toimetamine on samas plokis, mitte metaandmete vormis** (minu valik). Adminile on ploki all nupp „+ Lisa variant", mis avab teoseotsingu (pealkiri, aasta või `work_id`). Iga rea kõrval on ✕. Valik ja ✕ salvestavad kohe `PUT`-iga, kinnitusküsimusega `useConfirm()` kaudu ainult eemaldamisel. Põhjus: metaandmete vorm salvestab teise otspunkti kaudu terve vormi korraga. Kahe salvestuse segu ühes vormis („miks seos salvestus, aga pealkiri mitte?") oleks segadusttekitav, ja seos puudutab niikuinii teist teost.

**Teoseotsing valijas** kasutab Meilit sama tenant-tokeniga mis avaleht; **ligipääs tuleb tokenist**. `scopeClauses` (`src/services/selectionFilter.ts`) piirab aktiivse kogu või töökollektsiooni järgi, mitte ligipääsu järgi, ja seda valijas **EI rakendata**: avalehel valitud kogu ei tohi välistada varianti, mis asub mujal. Otsingus on kõik teosed, mida toimetaja näeb. Praegune teos ja juba seotud teosed jäetakse välja.

**Teosekaart (`src/components/WorkCard.tsx`) ja loendirida (`WorkListRow.tsx`).** Avalehe päring (`src/services/searchService.ts` ~487) ja `getWorkMetadata` (`src/services/workService.ts` ~65) ei küsi praegu `relations`-it (`attributesToRetrieve`) — see tuleb lisada, muidu kaart seoseid ei näe. Kaardi paremas ülanurgas on info-nupp (`absolute top-2 right-2`, `w-6 h-6 rounded-full bg-black/25`). Selle alla tuleb **samasugune ümmargune nupp teises toonis**, ainult siis, kui teosel on vähemalt üks `isVersionOf` seos (filtreeritud loend, mitte `work.relations.length`). Väike number näitab `isVersionOf` seoste arvu (ka piiratud sihtteostega, sest olemasolu ei ole saladus). Muud liigid, kui andmetes peaks neid olema, ei lähe arvu ega kuvamisse. Ikooni ja tooni valib builder (näiteks `lucide` `GitFork`, violetne).
- **Hover** (sama 200 ms viivitus) avab ülekatte. **Esimesel avamisel** küsitakse `GET /works/{id}/relations`. Kaardi enda andmetes on ainult `id`-d, ette ei küsita midagi.
- **Hover-olek hõlmab nuppu JA ülekatet:** ülekate jääb lahti, kuni hiir on kas nupul või ülekatte enda peal (väike sulgemisviivitus, et 24×24 nupult ülekattele liikumine seda ei sulgeks). Praegune info-nupp (`WorkCard.tsx:378`) sulgeb `onMouseLeave` peale, ja see sobib ainult sellepärast, et info-ülekattes pole linke.
- **Klõps** nupul lukustab ülekatte lahti. Väljaspool klõps või Esc sulgeb.
- **Kaks ülekatet ei ole korraga lahti:** ühe avamine sulgeb teise ja peidab (või viib alla) teise nupu, sest mõlemad nupud on `z-30` ja ülekatted `z-20`: muidu paistaks teine nupp avatud ülekattest läbi.
- **Mobiil:** toks avab ja sulgeb, nagu info-nupul.
- Ülekatte sisu on struktureeritud plokkidena („Seotud teosed", hiljem „Samas köites"), et konvoluut saaks lisanduda uue plokina.
- **`WorkListRow`** (~64 px kõrge rida, `WorkListRow.tsx:46`): kaardi `inset-0` ülekate sinna ei mahu. Ikoon on pealkirja kõrval ja avab **nupu juurest ujuva popoveri** (väljaspool rida; rida ei tohi teda `overflow-hidden`-iga lõigata). Kogu rida navigeerib `onClick`-iga teosele, nii et iga klõps/puude nupul ja popoveri sees kutsub `e.stopPropagation()`.

**i18n:** kõik uued võtmed mõlemasse keelde korraga (ADR 0011, `localeParity.test.ts`). Silt `isVersionOf` = „Variant" / „Variant".

**z-index:** ülekate on kaardi sees, nagu info-ülekate (`z-20`/`z-30`). Kui valija avaneb modaalina, on see `z-[1300]` (CLAUDE.md z-index kihid).

### ADR

Uus ADR (järgmine number, praegu `0075`): „Teoste seos: üks kirjutustee, vastastikune, ainult variant". Sisu: ainus kirjutustee + `/update-work-metadata` keeld, vastastikkus `bulk_update_works` range režiimiga (tagasipööramine `save_with_git`-is `_git_write_lock`-i all) ja pöördliigi tabel, „seoseid pole" = võtme puudumine, kustutuse kriitiline sektsioon, `label` ei ole tõeallikas, piiratud sihtteose pealkiri on nähtav (pildid ja tekst ei ole), kustutamine eemaldab vastaspooled.

## Testid (vähemalt)

Backend (`tests/`):
- Lisamine kirjutab mõlemad teosed, ühe commitiga. Eemaldamine eemaldab mõlemalt.
- Range režiim: ühe teose fail puudub või on loetamatu → kumbagi ei muudeta, commiti ei teki, vastus on viga.
- Range režiim: teise poole transform viskab → esimest ei kirjutata.
- Range režiim: teise faili kirjutus ebaõnnestub (mock `atomic_write_text`) → esimene fail on tagasi algseisus.
- Kustutus ja lisamine samaaegselt (lõimed): lõpuks ei ole ühelgi alles jääval teosel seost kustutatud teosele.
- Vastaspoole koristus ebaõnnestub → kustutus katkestatakse, teose kaust on alles oma seostega.
- Koristus õnnestub, aga kausta eemaldamine ebaõnnestub (mock `shutil.rmtree`) → teos on alles seosteta, ühelgi vastaspoolel pole seost temale.
- Range režiim: commit ebaõnnestub (mock) → mõlemad failid on algseisus, indeksis pole muudatust, `PUT` → 500, Meili sünki ei tehtud.
- Teos iseendaga, tundmatu `rel_type`, puuduv sihtteos → 400. Olemasoleva paari lisamine ja puuduva eemaldamine → 200, faili ei kirjutata, commiti ei teki.
- Viimase seose eemaldamine eemaldab `relations` võtme; teosel, kellel võtit polnud, ei teki no-op eemaldamisel `"relations": []`.
- Kustutatava teose rippuv sihtmärk ei blokeeri kustutust.
- Taastamise kaitse: test loob ise olukorra, kus `<commit>^` sisaldab `relations`-it (nt kustutus ilma koristuseta), ja kontrollib, et taastatud teosel pole seost ei kettal, commitis ega Meilis. (Tavalises kustutus–taastamises on `<commit>^` juba koristuscommit, ja see test ei kontrolliks puhastuskoodi.)
- `save_with_git(rollback_on_error=True)`: commiti viga → failid baithaaval algseisus ja indeksis pole neid staged olekus pärast funktsioonist väljumist.
- `/update-work-metadata` `relations`-iga → 400.
- `GET`: piiratud sihtteos annab `title` ja `readable: false`. Lähteteose lugemisõiguseta → 404. Puuduv sihtteos → `missing: true`.
- Teose kustutamine eemaldab ta teiste seostest.

Frontend (`*.test.tsx` jsdom-päisega, kus vaja):
- Infopaneel: piiratud sihtteos on lingita koos märkega, loetav on link.
- Kaart: nupu nähtavus ja number lähtuvad **filtreeritud** loendist (`relations.filter(r => r.rel_type === 'isVersionOf')`): ainult muud liiki seosega teosel nuppu ei ole, segaloendi puhul on number ainult variantide arv. Esimene avamine teeb ühe päringu, teine mitte.
- Infopaneel: `PUT` 500 → veateade, plokk jääb endisesse seisu.
- Infopaneel: ilma `isVersionOf` seoseta teos ei tee `GET /works/{id}/relations` päringut; teose vahetus (sama komponent) ei näita eelmise teose seoseid.
- Loendirida: klõps seoste nupul ja popoveris ei navigeeri teosele.

Väravad: `npm run typecheck`, `npm test`, `npm run lint:ci` (lävi ei tõuse), `.venv/bin/pytest tests/ mcp/tests/`.

## Valmis, kui

- [ ] `nri7ga` on käsitsi poolitatud (uus upload + lk 2 kustutus). Mõlemad teosed näitavad teineteist plokis „Seotud teosed", ja seletus on märkustes.
- [ ] Seose lisamine ja eemaldamine ühelt poolt muudab mõlemat teost, ühe commitiga.
- [ ] Teosekaardil on seoste nupp, mille ülekattest saab teisele teosele klõpsata (ka mobiilis).
- [ ] Kõik ülaltoodud testid on olemas ja rohelised. ADR on kirjutatud.

## Builderi otsustada

- Ikoon ja toon kaardinupul, täpne paigutus ploki sees.
- Valija komponendi kuju (rippmenüü või väike modaal), kui see järgib olemasolevaid mustreid (`EntityPicker`, `WorkSetPicker`).
- Pealkirja lühendamise pikkus.
- Kas `GET` vastus tuleb `server/routers/`-i uude faili (`work_relations.py`) või olemasolevasse. Soovitus: uus router, loogika moodulis `server/work_relations.py`. Mitte `server/prosopography/work_relations_ops.py`: see on isikute ja teoste faktide moodul, nimi on juhuslikult sarnane.

## Minu valikud (kontrollimiseks)

1. Roll on `admin`, mitte `editor`. Põhjus: metaandmete muutmine nõuab juba praegu admini.
2. Toimetamine on infopaneeli plokis, mitte metaandmete vormis.
3. Teose taastamine prügikastist eemaldab taastatud teose seosed (ei taasta vastaspooli).
4. Uutes kirjetes `label`-it ei salvestata.
5. `bulk_update_works` saab range režiimi (kõik või mitte midagi, ka commiti vea korral tagasipööramisega), mitte eraldi kahe faili primitiivi.
6. Kustutus katkestatakse, kui seoste koristus ebaõnnestub (teos jääb alles oma seostega); hilisema kustutusvea korral jääb alles seosteta teos.
