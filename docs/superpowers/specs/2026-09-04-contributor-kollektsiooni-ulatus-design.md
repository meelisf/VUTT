# contributor = kollektsiooni-ulatusega toimetaja + kollektsioonipõhine järelevalve

**Kuupäev:** 2026-09-04
**Seotud:** #297 (aed), #298 (SMTP-kanal), #299 (keel + kirjamallid), #300 (taotluste
säilitustähtaeg); ADR 0007 (tuletatud indeksid on read-modelid), ADR 0011 (i18n
pariteet); uus ADR 0031 (kirjutamisõigus = lugemisõigus JA ulatus; õigusotsust ei tehta
tuletatud indeksi põhjal)
**Staatus:** disain ülevaatamiseks, teostamata
**Muudetud 2026-09-04 pärast ülevaatust:** parandatud vale eeldus, nagu puuduks
kirjutustee-poolne ligipääsukontroll — `server/access_ops.py` on olemas ja contributori
reegel läheb sinna, mitte uude funktsiooni.

## Probleem

Kasutajaskond laieneb väljapoole seda ringi, keda administraator isiklikult tunneb —
lähiajal Saksamaalt. Kaks asja, mis seni on toiminud tänu väiksusele, lakkavad
toimimast korraga.

**1. Iga kinnitatud kasutaja saab kohe kirjutusõiguse kõigele, mida ta lugeda saab.**
Kutsevoo vaikeroll on kõvakodeeritud `editor` (`server/registration.py:317`).
Ligipääsukiht `server/access_ops.py` on olemas ja töötab, aga tal ei ole ulatuse-telge:
`can_write_work` on sõna-sõnalt `return can_read_work(...)`. Kollektsioonipiirang
kirjutamisel ei ole seega puudulik — teda ei ole mõistena olemas.

**2. Järelevalve ei skaleeru.** Administraator vaatab täna ise kasutajate paranduste
üle, et hinnata, kas inimene saab asjast aru. Kõiki ei jõua. Vaja on, et kollektsiooni
eest vastutav inimene saaks ise oma kollektsioonil silma peal hoida.

Rollihierarhia `contributor < editor < admin < superadmin` sisaldab juba rolli, mis ei
tee mitte midagi: `contributor` ei läbi ühtki kirjutusväravat. Koodikommentaarid
(`editing.py:102-105`, `registration.py:315-317`) ütlevad, et roll on reserveeritud
pending-edits voo jaoks.

## Mida EI tehta, ja miks

**Kinnitusjärjekorda ei tule.** `server/pending_edits.py` oli olemas ja kustutati
commitis `099d0ad` („koristuspass — pending-edit eemaldamine"). `Review.tsx:6-11`
kommentaar väidab siiani, et süsteem on implementeeritud ja ainult kasutusest väljas —
see on aegunud, faili ei ole; alles on `state/pending_edits.json` jäänuk. Kustutamise
põhjus oli halduskoormus ja see põhjus kehtib endiselt: probleem ongi see, et
administraator ei jõua kõike üle vaadata. Iga muudatuse eelkinnitamine teeks selle
hullemaks, mitte paremaks.

Lahenduse suund on **nähtavus koos vastutajaga**, mitte värav.

## Mudel: kaks telge, mitte üks redel

Rollihierarhia ütleb, **mida** tohib teha. Uus väli ütleb, **kus**.

**`edit_collections`** `users.json`-is, list kollektsiooni-id-sid:

- `contributor` — kirjutamine lubatud ainult siis, kui teose `collections` ja kasutaja
  `edit_collections` lõikuvad. Tühi list = ei saa kuskil kirjutada. Kollektsioonita
  teos ei ole contributor'ile kirjutatav.
- `editor` ja kõrgem — väli eiratakse, kirjutamine piiramata. Aed on ainult
  contributor'il.

**Miks mitte `allowed_collections`.** See on *lugemis*õigus piiratud
(`visibility == "restricted"`) kollektsioonidele ja sanitiseerija
(`server/auth.py:400-405`) viskab kõik mitte-restricted id-d minema. Avaliku
kollektsiooni contributor'it ei ole selles väljas võimalik väljendada. Lugemisõigus ja
kirjutamisulatus on eri teljed; ühe välja ülekoormamine paneks sanitiseerija reeglid
omavahel tülli.

**Lugemine ei muutu.** Contributor näeb täpselt seda, mida ta oma rolli ja
`allowed_collections`-iga niikuinii näeks. Aed on ainult kirjutamisel — nii jääb ta
kolleegide tööd nägema, mis on väiksema kogemusega kasutaja puhul eesmärk, mitte risk.

**Prosopograafia on contributor'ile lugemisõigusega.** Isikukaartidel ei ole
kollektsiooni-telge — nad on globaalne ühisvara (~2350 kaarti). Kaardi CRUD
(`server/prosopography/router.py` `POST`/`PUT`/`DELETE`) jääb `editor`-väravaga.

**Üks piirijuhtum jäetakse teadlikult lahti.** Lehe salvestamine kirjutab globaalsesse
`person_to_works.json`-i `mentioned` kirjeid (`server/prosopography/relations.py:127`,
`update_page_person_mentions`) lehe `page_tags` põhjal. See on *sidumine*, mitte kaardi
sisu muutmine, ja see on transkribeerimise lahutamatu osa — kinni pannes ei saaks
contributor lehele isikutägi panna. Reegel: **kaardi sisu on suletud, viide oma
kollektsiooni lehelt on lubatud.** CLAUDE.md invariant (kaks kirjutajat
`person_to_works`-i, kumbki ei pühi teise kirjeid) jääb muutmata.

**Kollektsiooni „vastutaja" ei ole tehniline objekt.** See on inimene, kes on pannud
kollektsiooni oma jälgimisnimekirja ja kellega on kokku lepitud, et ta vaatab.
Kokkulepe on sotsiaalne, tööriist annab ainult nähtavuse. `collections.json` skeem jääb
puutumata ja „omaniku" mõiste lahtised otsad (mis saab, kui omanik lahkub; kas omanikke
võib olla mitu; kas omanik saab kollektsiooni kustutada) ei teki üldse.

## A. Aed

### Olemasolev kiht, mida laiendatakse

`server/access_ops.py` sisaldab juba kolme funktsiooni:

- `is_work_public(meta)` — „public wins": üks avalik kollektsioon teeb teose avalikuks;
  kollektsioonita teos on avalik.
- `can_read_work(meta, user)` — avalik VÕI `shareable` VÕI admin+ VÕI
  `allowed_collections ∩ work.collections`.
- `can_write_work(meta, user)` — täna `return can_read_work(meta, user)`.

`server/routers/editing.py` juhib kõik teost puudutavad teed läbi
`_require_catalog_access(catalog, user, write=…)` (`editing.py:80`), mis loeb
`_metadata.json`-i ja kutsub õiget predikaati. Lugemine: read 203, 267, 278, 334.
Kirjutamine: 116 (`/save`), 352 (`/page-comments/restore`), 401 (`/git-restore`).
`/work/{work_id}/shareable` kutsub `can_write_work`-i otse (`public.py:40`).

**Muudatus on seega üks funktsioon, mitte kümme endpointi:**

```python
def can_write_work(work_metadata, user):
    if user is None:
        return False
    if not can_read_work(work_metadata, user):
        return False
    if user.get("role") != "contributor":
        return True
    scope = set(user.get("edit_collections", []))
    return bool(scope & set(work_metadata.get("collections", [])))
```

### ADR 0031, invariant 1: kirjutamisõigus = lugemisõigus JA ulatus

Kirjutamisõigus ei anna kunagi lugemisõigust. Ressurssi saab muuta ainult kasutaja,
kellel on sellele ka lugemisõigus. Praktiline juhtum: contributor, kellel on
`edit_collections=["X"]` (X on restricted), aga puudub `allowed_collections=["X"]` —
tulemus peab olema 403, mitte kaudne lugemisõigus. Kuna mõlemad kontrollid elavad ühes
funktsioonis AND-tingimusena, ei saa nad ajas lahkneda.

### ADR 0031, invariant 2: õigusotsust ei tehta tuletatud indeksi põhjal

`work_collections_index.json` on read-model, mis ehitatakse serveri stardil
taustalõimes uuesti (ADR 0007). Puuduv või vananenud kirje muudaks õigusotsuse
ettearvamatuks ja kumbki suund ei ole ohutu: fail-open lekitab, fail-closed lukustab
partneri keset tööd välja. Otsus loeb `_metadata.json`-i, mis on autoriteet.

Indeks tohib **kitsendada kandidaate** (nt „vaata neid 200 teost"), aga ükski tulemus ei
jõua kasutajani ilma autoriteetse kontrollita.

### Rollivärava allalaskmine

Kuna `contributor < editor`, ei piisa aiast — praegused `editor`-väravad tuleb ka alla
lasta, muidu ei avane contributor'il Workspace üldse.

| Endpoint | Fail | Uus värav |
|---|---|---|
| `/get-work-metadata` | `editing.py:195` | contributor (aeda ei ole, lugemine) |
| `/get-metadata-suggestions` | `editing.py:207` | contributor |
| `/git-history` | `editing.py:261` | contributor |
| `/commit-diff` | `editing.py:273` | contributor |
| `/page-comments/history` | `editing.py:331` | contributor |
| `/save` | `editing.py:106` | contributor + `can_write_work` |
| `/git-restore` | `editing.py:396` | contributor + `can_write_work` |
| `/page-comments/restore` | `editing.py:341` | contributor + `can_write_work` |
| `/page-comments/reply` | `notifications.py:158` | contributor + `can_write_work` |

`/recent-edits` (`editing.py:250`) ei vaja allalaskmist — ta kasutab `get_user`-it,
mille vaikimisi `min_role` on juba `contributor` (`deps.py:25`). Contributor näeb
Review-lehte; mida ta seal näeb, otsustab B osa nähtavusreegel.

**`/work/{work_id}/shareable` JÄÄB `editor`-väravaga.** `shareable: true` teeb teose
maailmale loetavaks — `can_read_work` tagastab selle peale `True` **enne**
kollektsioonikontrolli (`access_ops.py:24-25`). See ei ole teose muutmine, vaid
juurdepääsu muutmine, ja contributori töö on transkribeerimine, mitte avaldamine.

`/notifications/send` (`notifications.py:211`) jääb samuti `editor`-ile: contributori
kommentaarivastus tekitab teavituse serveripoolselt.

### Elav auk, mis parandatakse siin

`/page-comments/reply` (`notifications.py:158-180`) on ainus teost muutev endpoint, mis
ei tee **ühtki** ligipääsukontrolli — võtab `original_path`-i kliendilt ja kirjutab
otse. Editor, kellel puudub piiratud kollektsiooni `allowed_collections`, saab täna
kirjutada selle kollektsiooni teose lehele ja käivitada Meili sünki. See ei ole #297
tagajärg, vaid olemasolev viga; parandus (`_require_catalog_access(..., write=True)`)
kuulub sellesse töösse, sest see on sama rida, mida aed niikuinii puudutab.

### Teadlik piirang

Contributor ei saa teoseid juurde laadida — `upload` on admin-only ja jääb selleks.
Teosed paneb tema kollektsiooni administraator.

### Seos kutsevooga

Roll ja `edit_collections` valitakse **taotluse kinnitamise hetkel**
(`src/pages/admin/Registrations.tsx`) **ühe operatsioonina** — kasutajaseisund peab
tekkima atomaarselt, mitte „kõigepealt contributor tühja listiga, siis ulatus".
Vahepealne seisund oleks küll fail-closed, aga kontseptuaalselt katkine. Praegu on roll
invite-tokenis kõvakodeeritud (`registration.py:317`).

Ulatuse või rolli muutmine invalideerib kasutaja sessioonid, nagu
`update_user_allowed_collections` juba teeb (`auth.py:417`) — muidu jääks vana ulatus
24 tunniks kehtima.

## B. Järelevalve: nähtavus kollektsiooni kaupa

**Jälgimisnimekiri on kasutajaseade.** `watched_collections` lisandub
`server/routers/user_settings.py:24` lubatud väljadesse, `language` ja `default_tab`
kõrvale. Filter, mitte õigus.

**Nähtavusreegel:** kasutaja näeb muudatuste voogu nendes teostes, mida ta lugeda saab —
ja seda otsustab **sama `can_read_work`**, mis otsustab teose avamise. Mitte eraldi
restricted-kollektsioonide algoritm: teos võib kuuluda korraga avalikku ja piiratud
kollektsiooni („public wins") ja seda loogikat ei tohi kaks korda kirjutada.

See ei ole uus avalikustamine — `/git-history` ja `/commit-diff` on juba teose kaupa
avatud, st editor näeb praegugi iga avatud teose täisajalugu koos autorinimedega.
Review-leht näitab sama infot koondatult.

**`/recent-edits` (`editing.py:250`) saab kolm muudatust:**

1. **Autorifilter git'i sisse — koos täpse järelkontrolliga.** Praegu võtab
   `get_recent_commits` (`server/git_ops.py:853`) akna
   `max_commits = (skip + limit) * 3 + 50` ja filtreerib autori järgi alles **pärast
   seda** Pythonis. Sellest aknast välja jäävad muudatused ei ole olemas, ükskõik kui
   palju kerida. Git'i `--author` käib kogu ajaloo läbi, **aga see on regex
   author-headeri vastu, mitte täpne võrdlus**: autor on
   `Actor(username, f"{username}@vutt.local")` (`git_ops.py:678`), nii et `--author=mf`
   haakuks ka kasutajaga `mfoo`. Git-filter kitsendab kandidaate, täpne
   `commit.author.name == username` jääb autoriteediks.
2. **Kollektsioonifilter**, samuti git-natiivne: jälgitavate kollektsioonide teoste
   slug'id → `iter_commits(paths=[…])`.
3. **Nähtavusfilter `can_read_work`-iga**, mida praegu ei ole. Täna ei saa mitte-admin
   teiste commite üldse (`f_user` sunnitakse `user['username']`-ile), nii et lekkeriski
   ei eksisteeri; voo avamine tekitab selle. Filter kirjutatakse **koos** avamisega.

**Fallback ei tohi olla suurem konstant.** Kui pathspec läheb pika kollektsiooni puhul
liiga suureks, skaneerib fallback ajalugu **partiide kaupa edasi, kuni `limit`
tulemust on käes või ajalugu lõpeb**. Konstandi suurendamine taastaks sama vea suurema
kollektsiooni juures.

**Commit ei võrdu teosega.** Admini bulk-operatsioon teeb ühe commiti, mis puudutab
mitut teost korraga. `get_recent_commits` koostab kirjed **muudetud faili kaupa**
(`seen_files` dedupe), nii et filter kuulub faili, mitte commiti tasemele.
`/commit-diff` on juba õigesti kitsendatud — annab `filepaths=clean_path` (üks fail) ja
kontrollib kataloogi ligipääsu (`editing.py:277-286`) — aga see on täpselt selline
omadus, mis vaikselt ära kaob, seega tuleb tal test.

**V1-st väljas:** teavitused jälgitava kollektsiooni muudatuste kohta. Voog on esimene
samm; kui selgub, et keegi lehte ei ava, on `notifications_ops.py` olemas.

## Frontend

- `edit_collections` lisandub kasutajaobjekti (`auth.py:211`, `auth.py:314`), nagu
  `allowed_collections`.
- `src/utils/roleUtils.ts` → `canEditWork(user, work)`, mis peegeldab serveri reeglit.
  Workspace ei tohi avada redaktorit kirjutatavana, kui server niikuinii keelduks.
  **Server jääb tõe allikaks** — frontend on ergonoomika, mitte turve.
- Review-lehele kollektsioonifilter; Settings-lehele jälgitavate kollektsioonide valik;
  Registrations-lehele rolli + kollektsiooni valik kinnitamisel; Users-lehele
  `edit_collections` muutmine.
- Uued i18n võtmed **mõlemasse keelde korraga** (ADR 0011, `fallbackLng` on väljas).

## Testimine

**pytest — aed:**
- contributor oma kollektsioonis läbib; väljaspool 403; kollektsioonita teosel 403;
  `editor` läbib alati;
- **restricted contributor ilma `allowed_collections`-ita:** `edit_collections=["X"]`,
  `allowed_collections=[]`, X on restricted → 403 (kirjutamisulatus ei tohi muutuda
  kaudseks lugemisõiguseks);
- `can_write_work` otsus ei muutu, kui `work_collections_index.json` on eemaldatud või
  rikutud;
- `/page-comments/reply` ilma kataloogiõiguseta → 403 (täna läheb läbi).

**pytest — järelevalve:**
- piiratud kollektsiooni commit ei jõua kasutajani, kellel puudub ligipääs;
- **üks commit muudab korraga loetavat ja piiratud teost → kasutajale on nähtav ainult
  loetava teose osa** (nii voos kui diffis);
- autorifilter leiab commiti, mis jääb vanast aknast välja. **See test kukub enne
  parandust** — tõend, et viga oli päris;
- `--author` regex ei too kaasa võõrast autorit (`mf` ei tohi tuua `mfoo` commite).

**pytest — kasutajahaldus:**
- `editor → contributor` muutmine invalideerib sessioonid;
- roll + `edit_collections` kinnitamisel ühe operatsioonina.

**vitest:** `canEditWork`, locale-pariteet.

## Migratsioon ja koristus

Migratsiooni ei ole vaja: olemasolevatel kasutajatel puudub `edit_collections` ja nad on
kõik `editor`+, kelle puhul väli eiratakse. Vaikeväärtus puuduva välja korral on `[]`.

Koristus samas töös: `state/pending_edits.json` jäänuk ja `Review.tsx:6-11` aegunud
kommentaar, mis väidab olematu mooduli olemasolu.

## Jaotus

Kaks tarnitavat asja, üks mudel:

- **A — aed (#297).** `can_write_work` laiendus, üheksa endpointi rollivärava
  allalaskmine, `/page-comments/reply` ligipääsukontroll, kutsevoo valik, frontendi
  peegeldus. Blokeerib uute kasutajate vastuvõtmise.
- **B — järelevalve (uus issue).** `watched_collections`, `/recent-edits` kolm
  muudatust, Review-lehe filter. Iseseisvalt kasulik ka ilma contributor'iteta:
  autorifiltri viga vaevab administraatorit juba täna.

Alustatakse A-st. Kumbki saab oma teostusplaani.
