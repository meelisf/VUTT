# Bulk-lehtede lisamine teosele

**Kuupäev:** 2026-06-20
**Staatus:** Disain kinnitatud, ootab implementatsiooniplaani

## Probleem

`/work/{id}/manage` lehel ("Lisa leht" vorm) saab praegu lisada korraga ainult **ühe**
pildifaili teose lehekülgede vahele. Kasutajal on vaja lisada korraga mitu lehte (nt
20 või 200 skannitud pilti) valitud positsioonile. Praegu peaks selleks tegema kümneid
käsitsi-lisamisi.

## Eesmärk

Sama `/manage` "Lisa leht" vorm võtab vastu mitu pildifaili korraga ja lisab need
nimejärgi sorteerituna valitud positsioonile. UI jääb samasse kohta; uut lehte ega
uut nuppu ei teki. Lahendus peab töötama ka suurte partiide korral (200+ faili).

**Skoobist väljas:** OCR. Iga lisatud leht saab tühja `.txt` ja staatuse `Toores`,
täpselt nagu praegune ühe-lehe lisamine. OCR on eraldi, hilisem samm.

## Olemasolev seis (lähtekoht)

- **Frontend:** `src/pages/WorkManage.tsx` — `showAddForm` vorm, `handleAddPage()`
  (rida ~371). Üks `<input type="file">` (`addFile`), positsiooni-`<select>`
  (`addAfterPage`: `0`=algusesse, lehe `page_num`=selle järele, `-1`=lõppu). POST
  `multipart` → `FILE_API_URL/admin/work/{workId}/add-page`, väljad `file` +
  `after_page_num`. Eduka vastuse järel `loadPages()`.
- **Backend:** `server/main.py` `admin_add_page` (rida ~564). Loeb ühe faili mällu
  (`await file.read()`), tuvastab tüübi magic-byte'idega (JPG / PNG→JPG teisendus /
  PDF keeld), arvutab `new_seq` valitud pesa kohta (`seq_of` + midpoint, vajadusel
  `rebalance_sequences`), kirjutab pildi + tühja `.txt` + minimaalse `.json`
  (`{sequence, status:"Toores"}`), teeb git-commiti ja `sync_work_to_meilisearch`.
- **Abifunktsioonid:** `server/admin_page_ops.py` — `get_sorted_images`,
  `get_page_sequence`, `rebalance_sequences` (nummerdab kõik ümber sammuga 100 →
  kahe lehe vahele mahub kuni 99 uut).
- **Nginx:** `nginx.host.conf` `client_max_body_size 600M` `/api/files/admin/` all.
- **Järjekord:** lehed sorteeritakse `sequence` järgi; `page_num` on 1-indekseeritud
  positsioon sorteeritud nimekirjas.

## Disain

### 1. UI — `WorkManage.tsx` "Lisa leht" vorm

- Failiväli saab `multiple` atribuudi (`accept="image/jpeg,image/png"`).
- Valitud failid sorteeritakse **failinime järgi** (lokaalitundlik `localeCompare`,
  numeric: nt `scan_2 < scan_10`).
- Kui faile on >1, vorm näitab **arvu + järjestatud nimekirja eelvaadet** (sorteeritud
  failinimed), et kasutaja näeks tulemus-järjekorda enne kinnitamist.
- Positsiooni-`<select>` jääb muutmata.
- Submit käivitab tükeldatud üleslaadimise (vt 2) ja näitab **progressi**
  ("Laetud X / N"). Tühistus on lubatud partiide vahel.
- Üks valitud fail käitub täpselt nagu praegu (üks partii, N=1).
- Lõpetamisel: `loadPages()`, vorm lähtestatakse.

**i18n:** uued võtmed `et` + `en` failidesse (nt `manage.addPagesPreview`,
`manage.addPagesProgress`, `manage.addPagesPartialError`). Säilita olemasolevad
ühe-lehe võtmed.

### 2. Frontend — tükeldamise loogika (kasutajale nähtamatu)

- Failid sorditakse nimejärgi.
- `CHUNK_SIZE = 20` (konstant).
- Positsiooni-aritmeetika on deterministlik, **re-fetchi pole vaja**:
  - Lähte-`after_page_num` tuleb select'ist (`0`, lehe `page_num`, või `-1`).
  - Kui partii lisab K lehte positsiooni P järele, hõivavad need positsioonid
    P+1…P+K. Järgmise partii `after_page_num = P + K`.
  - "Algusesse" (`0`): esimene partii P=0 → lehed positsioonidel 1…K → järgmine
    `after_page_num = K`.
  - "Lõppu" (`-1`): iga partii jääb `-1` (alati lõppu).
- Iga partii: POST `multipart` → `/admin/work/{workId}/add-pages` (mitu `file` +
  `after_page_num`); progressi uuendus partii õnnestumisel.
- **Veakäsitlus:** partii viga → peatu, näita mitmes partii ebaõnnestus ja serveri
  veateade. Juba lisatud lehed jäävad alles; `loadPages()` peegeldab osalist tulemust.

### 3. Backend — uus endpoint `POST /admin/work/{work_id}/add-pages`

`require_role("admin")`. Multipart body: mitu `file` osa + `after_page_num` (int).

1. **Valideeri kõik failid enne kirjutamist.** Iga faili kohta loe sisu, tuvasta tüüp
   magic-byte'idega (JPG; PNG → teisenda JPEG-iks Pillowiga; PDF/muu → viga). Kui
   **mõni** fail on toetamata → `HTTPException(400)` vigase faili nimega; **midagi ei
   kirjutata** (väldib osalist sisestust).
2. Sorteeri valideeritud failid **failinime järgi** (sama järjekord nagu frontend
   näitab; backend on autoriteetne).
3. **Jaota N järjekorranumbrit** valitud pessa (vt 4).
4. Kirjuta iga leht (vt 5): esimene sorditud fail → väikseim sequence.
5. **Üks git-commit** kogu partiile (`save_with_git` koos `additional_files` listiga,
   kõik `.txt` + `.json` korraga). **Üks** `sync_work_to_meilisearch`.
6. Tagasta `{status:"success", new_page_count, inserted:[{filename, sequence}, ...]}`.

### 4. Järjekorranumbrite jaotamine — `allocate_sequences(...)`

Uus abifunktsioon `admin_page_ops.py`-s. Sisend: teose tee, `after_page_num`, N.
Väljund: N kasvavat täisarvu õigetes pesades.

- Arvuta `seq_before` / `seq_after` valitud positsiooni kohta (sama `seq_of`-loogika
  nagu praegu: midpoint algusesse / lõppu / vahele).
- **Kui pesa mahutab N** (st `seq_after - seq_before > N`): jaota ühtlaselt —
  `step = (seq_after - seq_before) / (N + 1)`, `seq_k = seq_before + round(step·k)`,
  k = 1…N; taga rangelt kasvav (vajadusel +1).
- **Kui pesa EI mahuta N** (suur partii, nt 200): **nummerda kogu teos ümber koos
  uute lehtedega**. Ehita ühendatud järjestus (olemasolevad lehed + N uut splaisitud
  positsioonile P) ja anna kõigile `sequence = (i+1)·100`. Olemasolevate lehtede
  `.json`-id uuendatakse samas commitis. Töötab suvalise N korral.
  - NB: see laiendab `rebalance_sequences` mõtet — kaalu ühist abifunktsiooni, mis
    võtab "uute lehtede sisestuspunkti" parameetrina, või tee eraldi
    `renumber_with_inserts(...)`.

### 5. Per-lehe kirjutamine — `write_new_page(...)`

Tõsta `main.py` `admin_add_page`-st välja `admin_page_ops.py`-sse:

```
write_new_page(path, folder_name, work_id, content, ext, seq) -> (filename, txt_path, json_path, page_meta)
```

- Genereeri ainulaadne nimi `{folder_name}-{work_id}-{nanoid}{ext}` (kollisioonikontroll).
- Kirjuta pilt (`0o644`), tühi `.txt` (`0o644`), minimaalne `.json`
  `{sequence: seq, status: "Toores"}` (`0o644`).
- **Ära** tee siin git-commiti ega Meili-synci — kutsuja koondab need (bulk: üks kord).

Tagasta failiteed, et kutsuja saaks need ühte `save_with_git` kutsesse koondada.

### 6. Refaktor — `main.py` `admin_add_page`

Vana `/admin/work/{id}/add-page` **jääb alles** (tagasiühilduvus). Kirjuta see ümber
kasutama `allocate_sequences(N=1)` + `write_new_page` (üks fail, üks commit, üks sync).
Frontend lülitub `/add-pages`-ile (töötab ka N=1 korral); vana endpoint jääb varuks.

## Veakäsitlus

| Olukord | Käitumine |
|---------|-----------|
| Toetamata failitüüp partiis | 400, vigase faili nimi; partii tervikuna tagasi, midagi ei kirjutata |
| Pesa ei mahuta N | Kogu teose ümbernummerdamine (mitte viga) |
| Partii ebaõnnestub keskel (frontend) | Peatu, näita mitmes partii; juba lisatud lehed alles, `loadPages()` |
| Fail puudub / tühi multipart | 400 |
| Teost ei leitud | 404 |

## Testimine

Backend (`tests/`):
- `allocate_sequences`: keskele / algusesse / lõppu, õiged kasvavad väärtused.
- Ümbernummerdamise tee: suur N (nt 200), mis pessa ei mahu → kõik kasvavad,
  olemasolevad lehed säilivad õiges järjekorras.
- Nimejärjestus: sisendfailid suvalises järjekorras → sequence'id failinime järjekorras.
- Partii tagasilükkamine: üks toetamata fail → 400, kettale ei kirjutata midagi.
- `write_new_page`: loob pildi + `.txt` + `.json` õigete õigustega, ei commiti.

Frontend: tükeldamise positsiooni-aritmeetika (P+K loogika) — vajadusel väike
ühiktest või manuaalne kontroll `/manage`-l.

## Failid

| Fail | Muudatus |
|------|----------|
| `src/pages/WorkManage.tsx` | `multiple` failiväli, sorditud eelvaade, tükeldav handler, progress |
| `src/locales/{et,en}/*.json` | uued i18n võtmed |
| `server/main.py` | uus `add-pages` endpoint; `add-page` ümber `write_new_page`-le |
| `server/admin_page_ops.py` | `write_new_page`, `allocate_sequences`, ümbernummerdamise tee |
| `tests/` | backend testid |

## Deploy

Backend (Docker, `--no-cache`) + frontend (`npm run build` + `rsync`). Meili-skeem
ei muutu. Vt CLAUDE.md / MEMORY.md deploy-samme.
