# Backend Smoke-testid ja Järgmine Plaan

Kuupäev: 2026-03-21

See dokument kirjeldab 2026-03-21 lisatud minimaalset backend smoke-testide kihti ning seda, kuidas seda kasutada enne suuremat crufti eemaldamist või upload/auth refaktorit.

## Eesmärk

Praegune testikiht ei püüa anda laia katvust. Eesmärk on lukustada mõned kõrge riskiga vood, et järgmised muudatused ei toimuks täiesti pimesi:

- autentimine ja sessiooni kontroll
- invite-tokeni redeem flow
- lihtne JSON state write
- upload-flow kriitilised lugemisteed

## Lisatud failid

- [requirements-dev.txt](/home/mf/LLM/VUTT/requirements-dev.txt)
- [pytest.ini](/home/mf/LLM/VUTT/pytest.ini)
- [conftest.py](/home/mf/LLM/VUTT/tests/conftest.py)
- [test_backend_smoke.py](/home/mf/LLM/VUTT/tests/test_backend_smoke.py)

## Kuidas teste käivitada

Esimene kord:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
```

Edaspidi:

```bash
.venv/bin/pytest -q
```

## Mis on praegu kaetud

Testid kasutavad isoleeritud ajutist `state/` ja `uploads/` kataloogi. Need ei kirjuta päris rakenduse andmetesse.

Praegune smoke-komplekt:

1. `login` tagastab sessioonitokeni.
2. `verify-token` aktsepteerib värsket tokenit.
3. `user-chars` write/read töötab `Authorization: Bearer` headeriga.
4. `invite/set-password` kasutab tokeni ära ainult ühe korra.
5. admin `collections` update kirjutab JSON state'i ootuspäraselt.
6. upload `status` tagastab staged upload state'i admin-authiga.
7. upload `thumb` serveerib faili olemasoleva legacy `?token=` authiga.

## Mida testid teadlikult EI kata

- OCR serveri või SFTP tegelik töö
- `admin/upload/{id}/files` üleslaadimine
- `import_as_work()` täielik import-flow
- concurrency või race-condition testid
- frontend komponentide käitumine

Need jäid välja, sest nende jaoks oleks vaja eraldi mocke või suuremat testharnessit.

## Tähelepanekud lisatud testide põhjal

### 1. Upload thumb sõltub endiselt query-tokenist

Praegune frontend kasutab upload thumb URL-is `?token=` query-parametrit. Smoke-test lukustab selle käitumise teadlikult, sest ilma selleta katkeks olemasolev UI flow.

Seotud failid:

- [Upload.tsx](/home/mf/LLM/VUTT/src/pages/Upload.tsx#L143)
- [main.py](/home/mf/LLM/VUTT/server/main.py#L829)

See on jätkuvalt tehniline võlg, mitte soovitus tulevikuks.

### 2. Upload status endpointi `status` väli tähendab upload state'i

`/admin/upload/{id}/status` tagastab `status` väärtusena uploadi tegeliku oleku (`pending`, `processing`, `done`, jne), mitte wrapperit `success`.

Seotud fail:

- [main.py](/home/mf/LLM/VUTT/server/main.py#L825)

See on praegune API käitumine ja testid lukustavad selle ära.

## Soovituslik järgmine plaan

Enne suuremat crufti eemaldamist:

1. Hoia see smoke-kiht rohelisena igal auth/upload/state muudatusel.
2. Lisa järgmises ringis 2-3 upload-flow testi juurde.
3. Alles siis liigu auth-query cleanupi või upload-refaktori juurde.

### Järgmine testilaiendus

Kõige mõistlikumad järgmised testid:

1. `POST /admin/upload/create` loob staging kausta ja state'i.
2. `GET /admin/upload/{id}/meta` ja `PATCH /admin/upload/{id}/meta` säilitavad metaandmete kuju.
3. `GET /admin/upload/{id}/thumb/{page}` ilma tokenita annab 401.

### Alles pärast seda

Kui ülaltoodud testid on olemas, siis võib turvalisemalt valida ühe kahest suunast:

1. auth-query fallbacki järkjärguline eemaldamine upload thumb flowst
2. `upload_ops.py` sisemiste state/write mustrite puhastamine

## Soovitus crufti eemaldamise järjekorraks

Upload-flow kontekstis:

1. lisa test
2. tee väike refaktor
3. jookse smoke-testid
4. korda

Mitte teha:

- suur auth cleanup ja upload cleanup korraga
- upload UI ja backend auth muutmine samas paketis ilma testikihi laienduseta
- OCR/SFTP refaktor enne lokaalse staging/state flow lukustamist
