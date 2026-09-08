# ADR 0036 — Katkenud vastus ei ole ebaõnnestunud töö

**Kuupäev:** 2026-09-08
**Staatus:** vastu võetud
**Seotud:** ADR 0028 (I1: elutsükli-staatust omab töö tegija), ADR 0002 (blokeeriv I/O)
**Issue:** #327

## Kontekst

524-leheline teos importis tootmises 75 sekundiga. Kasutaja nägi veateadet;
teos oli olemas, terve ja indekseeritud.

Import on sünkroonne ja kestab O(lehtede arv): SFTP alla ~45 s, git commit
~21 s, Meili sünk ~5 s. Tee peal oli kaks ooteaja lage, mõlemad 60 s ja
**mõlemad deklareerimata**: nginx `proxy_read_timeout` puudus (vaikeväärtus) ja
kliendi `importUpload` timeout oli 60 s. Kokkulangevus ei olnud kavandatud —
keegi ei olnud kirja pannud, kui kaua import tohib kesta.

Backend jookseb `run_in_threadpool`-is. Kliendi lahtiühendamine ei katkesta
teda: töö läks lõpuni, aga vastust ei olnud enam kellelegi saata (uvicorni
access-logis puudub POST-rida sootuks).

Kolmas asi tuli sellega kaasa: import ei märkinud kuskil, et ta KÄIB.
`state.json` staatus jäi `reviewing`/`done`-iks kuni lõpuni, seega ei olnud
kellelgi — ei kasutajal, ei serveril, ei taastel — võimalik vahet teha
„import käib" ja „importi ei ole alustatud" vahel.

## Otsus

**1. Kliendi poolel tähendab katkenud vastus „ma ei tea", mitte
„ebaõnnestus".** `importUploadWithRecovery` küsib vea järel upload'i staatust
ja loeb tulemuse SEALT: `imported` → õnnestus (`work_id` tuleb staatusest),
`importing` → käib veel, ootame, muu → server andis staatuse tagasi ehk töö
päriselt kukkus. Ainult viimane on kasutajale viga.

**2. Pikk töö deklareerib, et ta käib.** Import teeb CAS-i
`done|reviewing → importing`; teine kutse saab „Import juba käib", mitte
segase „Kaust data/… on juba olemas". Eelmine staatus salvestatakse
`import_prev_status`-i ja antakse iga vea korral tagasi (`BaseException`);
rippuva `importing`-u taastab käivitusel `taasta_rippuvad_impordid`
(sama muster nagu ADR 0028 apply-taaste).

**3. Jooksva töö staatust omab töö tegija.** `poll_and_sync_thumbs` ei muuda
`importing` staatust ega ava selle ajal SFTP-d — sama valvur nagu I1
`applying` juures. Ilma selleta oleks viisardi 5-sekundiline poll kirjutanud
`importing` kohe `done`-iks tagasi ja CAS oleks olnud dekoratsioon.

**4. Ooteaeg on leping kahe otsa vahel, mitte vaikeväärtus.**
`proxy_read_timeout 600s` (`nginx.host.conf`, `/api/files/admin/`) ja
`IMPORT_TIMEOUT_MS = 600_000` (`uploadApi.ts`) peavad kokku käima; valvur
`tests/test_lepingud_kahes_otsas.py`. Vaikeväärtus ei ole leping: ta ei ole
kuskil kirjas, ei anna muutmisel hoiatust ja lange (siin: nginx 60 s) ei ole
seotud sellega, kui kaua töö tegelikult kestab.

## Tagajärjed

- Suure teose import ei anna enam valet veateadet. Kui vastus siiski kaob
  (võrk, sülearvuti kaas), lõpeb viisard ikka teosel — kuni 15 min pärast.
- `importing` on uus upload'i staatus: `ALL_STATUSES`, `RESUMABLE_STATUSES`
  ja `REVIEW_STATUSES`. Lehe värskendus impordi ajal toob kasutaja tagasi
  ülevaatusele, kus nupp keerleb.
- Import jääb sünkroonseks. Päris taustatöö (202 + polling nagu prepress
  apply) oleks järgmine samm, kui import kunagi üle 10 minuti venib.
- Reegel ei ole impordi oma: iga pikk sünkroonne endpoint, mille klient võib
  kaotada, vajab kas deklareeritud lage või tulemuse teist lugemisteed.
