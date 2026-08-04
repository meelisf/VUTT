# VUTT Backend Arhitektuur (FastAPI)

See dokument kirjeldab VUTT backendi uut arhitektuuri pärast üleminekut FastAPI-le.

## Üldine ülesehitus

Backend jookseb Dockeris ja on jagatud järgmisteks osadeks:
- **`server/main.py`**: Rakenduse süda. Sisaldab kõiki ruute, autentimise kontrolli ja peamist loogikat.
- **`server/cache.py`**: Kollektsioonide, sõnavarade ja isikuandmete mälupõhine vahemälu.
- **`server/git_ops.py`**: Otsene liides Git versioonihaldusega.
- **`server/meilisearch_ops.py`**: Andmete sünkroniseerimine Meilisearchi otsingumootoriga.
- **`server/upload_ops.py`**: Teoste üleslaadimine, OCR ja importimine.

## Autentimine

Süsteem kasutab ühtset `get_user` ja `require_role` dependency injection süsteemi:
- **Tokenid**: Toetatud on nii `token` päringuparameeter (GET) kui ka `auth_token` JSON body-s (POST).
- **Rollid**: `contributor` (kaastööline), `editor` (toimetaja), `admin` (administraator).

## Süsteemne lähenemine (HTTP meetodid)

Kood on ühtlustatud vastavalt frontendi kasutusharjumustele:
- **GET**: Avalike andmete lugemine (collections, vocabularies) ja staatuse kontroll (uploads).
- **POST**: Kõik tegevused, mis muudavad andmeid või nõuavad autentimist (save, update, admin tegevused).
- **DELETE**: Teoste ja üleslaadimiste kustutamine.

## Taustategevused (BackgroundTasks)

FastAPI `BackgroundTasks` abil toimub:
- Meilisearchi sünkroniseerimine pärast salvestamist.
- Isikute andmete rikastamine pärast metaandmete uuendamist.
- Isikute aliaste perioodiline värskendamine.

## Arhiiv

Vana `http.server` baasil kood asub kataloogis `server/archive/` ja seda ei kasutata enam rakenduse töös.
