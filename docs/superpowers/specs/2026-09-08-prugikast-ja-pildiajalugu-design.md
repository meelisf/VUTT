# Prügikast ja pildiajalugu: leitav taastus, aus liigitus, töötav git-jälg

**Kuupäev:** 2026-09-08
**Seotud:** #325 (kogumiskoht); PR #326 (varukoopiate kiht maha, tootmises 2026-09-08);
ADR 0007 (tuletatud andmed on read-modelid); CLAUDE.md nginx-reegel (`/api/files/`
proksib kõik backend-teed avalikult)
**Staatus:** disain ülevaatamiseks, teostamata

## Probleem

Kasutaja ei leidnud lehekülge, mille ta oli pildiredaktoris kogemata pooleks kärpinud.
Tema mudel oli „leht kadus" → prügikast; süsteemi mudel oli „pilt asendati" →
pildiredaktor. Taastus oli olemas kogu aeg (`restore_original_page_image`, commit
`e294cb1`, 2026-06-28), aga mitte seal, kust otsiti.

Selle ümber on kolm asja, mis tegid olukorra hullemaks, ja neljas, mille leidsin
mõõtmisel.

**1. Prügikast näitab kolme eri asja ühesugusena.** `._trash/{work_id}/pages/` alla
kirjutavad kaks eri operatsiooni: lehe kustutamine JA `split_page` (poolituseelne
topeltleht). Liides näitab neid ühe loendina, ühesuguse „Taasta" nupuga.

**2. „Taasta" poolituse jäägil loob duplikaadi.** `restore_deleted_page` toob `.json`-i
gitist tagasi **muutmata**, ja poolituseelse lehe `sequence` on täpselt vasaku poole
oma (`split_page`: vasak `orig_seq`, parem `orig_seq + 50`). Tulemus: sama sisu
korpuses kolm korda, kaks lehte sama järjekorranumbriga, ilma ühegi hoiatuseta.

**3. Pildi muutmise ajalugu ei ole kuskil nähtav.** `._originals/{work_id}/` sisaldab
iga muudetud lehe puutumatut originaali, aga ainus tee selleni on avada õige leht
pildiredaktoris ja märgata päises nuppu.

**4. (Mõõtmisel selgunud) Git-jälg leitakse vale meetodiga.** `list_deleted_pages` ja
`restore_deleted_page` otsivad kustutamise commiti sõnumi seest:
`git log --all --grep "{kaust}/{base}"`. Kustutamise sõnum on aga
`Kustuta {n} lehte: {kaust} [{work_id}]` — **failinime seal ei ole**.

Mõõdetud tootmises 2026-09-08, kõik 537 kirjet:

| Liik | vana `--grep` leiab | ei leia |
|---|---:|---:|
| poolituse jääk | 67 | 253 |
| kustutatud leht | 92 | 50 |
| teost ei ole enam olemas | — | 75 |

**303 kirjet 462-st (66%) on tänases liideses ilma kuupäeva ja autorita, ja nende
„Taasta" kukub veateatega „Git kustutamise committi ei leitud".** Teepõhine päring
`git log --all --diff-filter=D -- {kaust}/{base}.txt` leiab kõik 462.

See on tähtsuselt esimene: punkt 2 rikub andmeid harva (keegi peab jäägil „Taasta"
vajutama), punkt 4 teeb taastamise võimatuks kahel kolmandikul kirjetest alati.

## Otsused (omanik, 2026-09-07 ja 2026-09-08)

- Tab kannab nime **„Prügikast ja pildiajalugu"**; taastus elab seal, mitte eraldi
  vaates.
- Kirje juures peab **pilti näha saama** — nanoid-failinimi ei ütle inimesele midagi.
- **Versiooniloendit ei tule.** Algvariandi taastamisest piisab.
- **Poolituse jääk ei ole taastatav, ta on ajalugu.** „Tühista poolitus" ei ole omaette
  operatsioon: topeltleht on juba mõlema poole `._originals`-is olemas, seega õige tee
  on avada kumbki pool → „Taasta originaal" → poolita uuesti.
- **Tab jaguneb kolmeks plokiks** (mitte üheks sildistatud ajajooneks): kustutatud
  leheküljed, muudetud pildid, poolituse jäägid.
- `._originals` ja `._trash/pages/` jäävad **tähtajatuks**. „90 päeva" lubadus oli
  tekstides, aga koristajat ei ole kunagi olnud; PR #326 eemaldas lubaduse.

## Mida EI tehta

- **Uut andmevälja ega migratsiooni ei tule.** Liik on juba olemasolevas git-ajaloos
  olemas; sidecar-fail annaks sama info ainult UUTELE kirjetele ja jätaks 462 vana
  kirjet ikka git-päringu taha. Kaks allikat ühele küsimusele on halvem kui üks.
- **Poolituse jääke ei kustutata.** 320 kirjet on ketta peal (~600 MB), aga kustutamine
  on pöördumatu ja nende ainus praegune kahju on segadus liideses. Sildistamine
  lahendab kahju; koristus on eraldi otsus eraldi päeval.
- **Teose-tasandi prügikasti (`list_deleted_works`) ei puudutata.** 75 orvu kirjet
  kuuluvad kustutatud teoste alla ja on lehe-tabist niikuinii kättesaamatud.
- **Pildiredaktori „Taasta originaal" nupp jääb alles.** Uus koht on lisatee, mitte
  asendus — kasutaja, kes on juba redaktoris, ei pea kuhugi mujale minema.

## Disain

### A. Git-jälg: sõnumiotsingust teeotsinguks

`server/trash_ops.py`, üks abifunktsioon mõlemale tarbijale:

```python
def leia_kustutamise_commit(repo, folder_name, base):
    """Viimane commit, mis selle lehe .txt-i kustutas. Tee, mitte sõnum."""
    rida = repo.git.log('--all', '--oneline', '--diff-filter=D', '-1',
                        '--', f'{folder_name}/{base}.txt').strip()
    ...  # → (commit_hash, sõnum) või (None, None)
```

Kasutajad: `list_deleted_pages` (kuupäev, autor, liik) ja `restore_deleted_page`
(millisest commitist `^` võtta). `.txt` on ankur, sest see on iga lehe puhul olemas ja
git-tracked; `.json` kustutatakse samas commitis.

Käitumise muutus: kirje, mille `.txt`-i ei leia ühestki kustutamise commitist (ei
tohiks tekkida, aga vana andmestik on vana), saab `commit_hash: None` ja liigi
`tundmatu` — taastamine keeldub selgesõnaliselt, ei kuku üldise veaga.

### B. Liik tuleb sõnumist, sõnum tuleb konstandist

Uus moodul `server/trash_reason.py`:

```python
SPLIT_COMMIT_PREFIX = "Lõika leht"      # split_page kasutab seda sõnumi koostamisel
DELETE_COMMIT_PREFIX = "Kustuta"        # delete_pages / delete_page_from_git

def liigita(commit_sonum: Optional[str]) -> str:
    """→ 'split' | 'deleted' | 'unknown'. Tundmatu = EI ole taastatav."""
```

`split_page` ja `delete_pages` impordivad prefiksi siit ja ehitavad sõnumi selle peale.
Nii ei saa sõnastus ühes otsas muutuda ilma teiseta — sama muster nagu `server/ocr_err.py`
ja `server/upload/page_status.py` (#261 punkt 1: kui väljavõte on võimalik, tee
väljavõte, ära kirjuta dokumentatsiooni „muuda mõlemat").

Tundmatu sõnum liigitub `unknown`-iks ja **ei ole taastatav** — ettevaatlik suund:
tundmatu päritoluga faili tagasitoomine võib teha duplikaadi, tema alles jätmine ei tee
midagi.

### C. Taastamise keeldumine on serveris

`restore_deleted_page` kontrollib liiki ENNE mis tahes faili puutumist:

```
liik == 'deleted'  → taasta (senine loogika, teepõhise commitiga)
liik == 'split'    → {'ok': False, 'reason': 'split', 'error': <selgitus>}
liik == 'unknown'  → {'ok': False, 'reason': 'unknown', 'error': <selgitus>}
```

Router annab 409 ja frontend kuvab selgituse, mis juhatab õigesse kohta („ava kumbki
pool → Taasta originaal → poolita uuesti"). Ainult UI-s peitmine jätaks vea endpointi
alles; endpoint on admin-only, aga „ainult adminid saavad andmeid rikkuda" ei ole
kaitse.

### D. Pisipildid `._trash` ja `._originals` alt

Uus endpoint (`server/routers/admin.py`, `/admin/` all + `require_role("admin")` —
CLAUDE.md: `/api/files/` proksib KÕIK backend-teed avalikult):

```
GET /admin/work/{work_id}/history-thumb/{kind}/{filename}     kind ∈ trash | original
```

- Tee ehitatakse serveris (`._trash/{work_id}/pages/` või `._originals/{work_id}/`),
  kliendi string läbib `os.path.basename` + `_is_safe_image_path` kontrolli.
- Vastus on **max 400 px JPEG**, mitte originaal: kirjeid on ühes teoses kuni sadu ja
  originaal on ~2 MB. Pisipilt genereeritakse esimesel päringul PIL-iga ja
  cache'itakse `._trash/{work_id}/.thumbs/{nimi}` (vastavalt `._originals/{work_id}/.thumbs/`).
  Cache-kaust on `pages/` **kõrval**, mitte sees, ja mõlemad loendajad
  (`list_deleted_pages`, `modified-images`) jätavad kataloogid vahele — muidu ilmuks
  pisipilt loendisse omaette kirjena.
- `Cache-Control: private, max-age=3600`; failinimi sisaldab nanoid'i, seega
  cache-bustimist vaja ei ole.

Praegune pildiserver (port 8001) jääb puutumata: ta serveerib teose kausta avalikult
token'iga, ja need failid ei ole avalikud.

### E. Liides: kolm plokki

`WorkManage.tsx` tab `trash` → nimi „Prügikast ja pildiajalugu". Fail on juba 1331 rida,
seega plokid tulevad omaette komponentidena `src/pages/manage/` alla
(`TrashDeletedPages.tsx`, `TrashModifiedImages.tsx`, `TrashSplitRemnants.tsx`) ja
`WorkManage.tsx` jääb koordinaatoriks.

```
┌─ Kustutatud leheküljed (142) ────────────────┐
│ [pisipilt]  kustutas Meelis · 07.09 14:22    │
│             {failinimi}         [ Taasta ]   │
└──────────────────────────────────────────────┘

┌─ Muudetud pildid (12) ───────────────────────┐
│ [enne│pärast]  lk 7 · kärbitud               │
│                Rahel · 07.09 [ Taasta orig. ]│
└──────────────────────────────────────────────┘

┌─ Poolituse jäägid (320) ─────────── [ näita ]┐
│ (kokku klapitud; avatuna pisipilt + selgitus)│
└──────────────────────────────────────────────┘
```

- **Kustutatud leheküljed** — senine loend + pisipilt; „Taasta" nagu praegu.
- **Muudetud pildid** — allikas `._originals/{work_id}/`, filtreeritud nendele, mille
  fail on veel teose kaustas (ülejäänud on hiljem kustutatud või poolitatud lehtede
  jäänukid ja nende näitamine eksitaks). Lehekülje number = indeks
  `get_sorted_images(path)`-is. Kes/millal/mis tegevus loetakse
  `data/transform_image.log`-ist (rea kuju:
  `ISO | kasutaja | work_id | failinimi | angle=… crop=… quad=… | -> WxH`),
  viimane rida faili kohta võidab; tegevuse nimi tuletatakse parameetritest
  (`crop` → kärbitud, `angle` → pööratud, `quad` → sirgestatud,
  `restore_original` → juba taastatud).
- **Poolituse jäägid** — vaikimisi kokku klapitud (`<details>`-tüüpi, mitte eraldi
  päring: andmed tulevad samast loendist), avatuna pisipilt + üherealine selgitus.
  Taastenuppu EI OLE.
- Pisipildid on `loading="lazy"`; kokkuklapitud plokk ei renderda ühtki `<img>`-i.

### F. Vastuse kuju

`GET /admin/work/{work_id}/trash-pages` laieneb (tagasiühilduvalt — olemasolevad väljad
jäävad):

```json
{"status": "success", "pages": [
  {"filename": "...jpg", "base_name": "...", "deleted_at": "...", "deleted_by": "...",
   "commit_hash": "...", "reason": "deleted|split|unknown", "restorable": true}
]}
```

`restorable` on serveri otsus, mitte kliendi tuletus — sama reegel, mis endpointi
keeldumist juhib, ja klient ei pea seda kordama.

Uus endpoint muudetud piltidele:

```
GET /admin/work/{work_id}/modified-images
→ {"images": [{"filename", "page": 7, "action": "crop", "at": "...", "by": "..."}]}
```

## Andmevoog

```
split_page ──┬─→ ._originals/{wid}/{vasak}.jpg, {parem}.jpg   (taastuse allikas)
             ├─→ ._trash/{wid}/pages/{originaal}.jpg          (ajalugu, mitte taastus)
             └─→ git commit "Lõika leht N (…): eemalda originaal"   ← LIIGI ALLIKAS

delete_pages ─┬─→ ._trash/{wid}/pages/{leht}.jpg
              └─→ git commit "Kustuta N lehte: …"                   ← LIIGI ALLIKAS

list_deleted_pages ──→ git log --diff-filter=D -- {kaust}/{base}.txt
                       └→ (hash, sõnum) → liigita() → reason + restorable
```

## Vea käsitlus

| Olukord | Käitumine |
|---|---|
| git-commiti ei leita | `reason: unknown`, `restorable: false`, kirje on loendis nähtav (fail on olemas — vaikimine oleks vale) |
| taastamine poolituse jäägil | 409 + selgitus, ühtki faili ei puudutata |
| pisipildi genereerimine kukub (katkine JPEG) | endpoint 404, liides näitab kohatäite-ikooni; loend ei kuku |
| `transform_image.log` puudub või rida on katki | „muudetud" ilma kasutaja/ajata; plokk töötab edasi |
| `._originals` kirje, mille fail on teose kaustast kadunud | kirjet ei näidata (kuulub kustutatud/poolitatud lehe juurde) |

## Testid

| Test | Mida lukustab |
|---|---|
| `liigita()` kolm haru + tundmatu | Ettevaatlik suund: tundmatu ei ole taastatav |
| `split_page` sõnum sisaldab `SPLIT_COMMIT_PREFIX`-it | Sõnastus ei triivi liigitajast lahku |
| Teepõhine leidmine päris git-repos (tmp_path, kaks commiti) | Kustutamise commit leitakse ka siis, kui sõnumis failinime EI OLE |
| `restore_deleted_page` jäägil → `ok: False`, failid puutumata | Punkt 2: duplikaat ei saa tekkida ka otse API kaudu |
| `restore_deleted_page` kustutatud lehel → töötab | Regressioon: keeldumine ei tohi tabada õiget juhtu |
| `history-thumb` ilma admin-rollita → 403; `../` failinimes → 400 | Endpoint ei ava failisüsteemi |
| `modified-images` filtreerib kadunud failid välja | Ei näidata kirjeid, mille lehte ei ole |
| i18n pariteet (olemasolev valvur) | Uued võtmed mõlemas keeles |

Frontendis testitakse puhtaid funktsioone (logirea parsimine, kirjete rühmitamine
kolmeks plokiks), mitte komponendipuud — sama joon nagu `impordiEdenemine` juures.

## Teostuse järjekord

1. **A + B** (teepõhine git-jälg + liigitus) — see üksi parandab 303 kirje kuupäeva,
   autori ja taastatavuse. Iseseisvalt deploy'tav.
2. **C** (keeldumine jäägil) — punkt 3 kinni, sõltub B-st.
3. **D + E + F** (endpointid + liides) — punktid 1 ja 2.

Kui töö tuleb pooleli jätta, on 1 kõige väärtuslikum ja 3 kõige suurem.

## Lahtised otsad pärast seda

- 320 poolituse jäägi (~600 MB) koristus — eraldi otsus, vajab eraldi kuivkäivitust.
- 75 prügikasti-kirjet teostest, mida enam ei ole — kuuluvad teose-tasandi prügikasti
  alla, kust neid täna kätte ei saa.
