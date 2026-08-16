# ADR 0021 — Üks nimi ühe seade kohta; aegunud nimi peatab käivituse

**Kuupäev:** 2026-08-16
**Staatus:** vastu võetud

## Kontekst

MCP-serveri registreerimine kukkus kaks korda järjest tühja võtme taha.
Sümptom oli `Failed to connect — CONNECTION_CLOSED`, mis ei vihja võtmele
kuidagi. Põhjus polnud fail, vaid **nimi**: käsuasendus otsis `.env.local`-ist
muutujat `VITE_MEILI_SEARCH_API_KEY`, mida seal ei ole — seal kannab sama
väärtus nime `MEILI_SEARCH_KEY`. Grep ei leidnud midagi, `mcp add` võttis
tühja stringi vastu vaikides.

Kaardistus näitas, et see ei olnud üksikjuhtum. **Neli tegelikku seadet
kandsid üheksat nime:**

| Seade | Nimed |
|---|---|
| Meili URL | `MEILISEARCH_URL`, `MEILI_URL` |
| Meili master-võti | `MEILISEARCH_MASTER_KEY`, `MEILI_MASTER_KEY`, `MEILI_SEARCH_API_KEY`, `MEILI_API_KEY` |
| Meili otsinguvõti | `MEILI_SEARCH_KEY`, `VITE_MEILI_SEARCH_API_KEY`, `VUTT_MEILI_SEARCH_KEY` |
| Pildi-HMAC | `IMAGE_TOKEN_SECRET` |

Väärtused olid kahes lokaalses failis (`.env`, `.env.local`) ja serveri
`.env`-is laiali, ilma et kusagil oleks olnud loendit sellest, mis nimi kuhu
kuulub — `.env.example` puudus, mõlemad failid on gitignore'itud.

Kaardistus paljastas kolm asja, mis ei olnud lihtsalt segadus:

1. **`VITE_MEILI_SEARCH_API_KEY` oli surnud.** Frontend ei loe Meili võtit
   üldse — ta küsib backendilt runtime'is tenant-tokeni
   (`meilisearch_ops.create_tenant_token`). Ainus `import.meta.env` kasutus
   kogu `src/`-is oli `VITE_FILE_SERVER_URL`. Päris otsinguvõti seisis kahes
   failis ilma ühegi tarbijata.

2. **`MEILI_SEARCH_API_KEY` nimi valetas.** `config.py` omistas selle
   `MEILI_KEY`-sse ehk **master-võtme** pesasse. Kes paneb sinna otsinguvõtme,
   saab backendi, mis jookseb vaikselt ilma kirjutusõiguseta.

3. **`vite.config.ts` süstis `process.env.MEILI_API_KEY` bundle'isse** — ja
   `.env.local` kommentaari järgi ON see master-võti. Kahjutu ainult sellepärast,
   et ükski `src/` fail sellele ei viidanud; `dist/` kontroll kinnitas, et kumbagi
   võtit seal ei olnud. Üks tulevane viide oleks pannud master-võtme avalikku
   bundle'isse. Samas plokis istus `GEMINI_API_KEY`, mis on juba korra lekkinud.

Ühisnimetaja: **vaikne fallback-ahel**. `config.py` proovis nime toorest nime
järel (`os.getenv(A) or os.getenv(B) or os.getenv(C)`), nii et vale nimi ei
andnud kunagi veateadet. Süsteem, mis alati leiab *mingi* väärtuse, ei suuda
kunagi öelda, et sa panid selle valesse kohta.

Ka `VITE_FILE_SERVER_URL` oli fantoom — seda ei ole üheski `.env` failis, nii
et `Admin.tsx` päris aadressilt `undefined/registrations` ja `.catch(() => {})`
neelas vea: admini taotluste loendur näitas alati 0.

## Otsus

**1. Üks nimi ühe seade kohta.** Kanooniline komplekt:

| Nimi | Mida |
|---|---|
| `MEILI_URL` | Meilisearch aadress |
| `MEILI_MASTER_KEY` | täisõigustega võti (ainult backend) |
| `MEILI_SEARCH_KEY` + `MEILI_SEARCH_KEY_UID` | tenant-tokeni allikas |
| `IMAGE_TOKEN_SECRET` | pildi-URL-ide HMAC |
| `VUTT_ENV`, `VUTT_DATA_DIR`, `UPLOAD_ENABLED`, `OCR_SERVER_*` | muutmata |

`VUTT_MEILI_SEARCH_KEY` (MCP-server) on **teadlik erand**: see on eraldi
protsess, mis paigaldatakse pipx-iga globaalselt ega loe repo `.env`-i.
`VUTT_` prefiks väldib kollisiooni kasutaja shellis oleva võõra
`MEILI_SEARCH_KEY`-ga.

**2. Aegunud nimi peatab käivituse.** `server/config.py`
`_fail_on_legacy_env_names()` skaneerib nii `os.environ`-i kui `.env`-i ja
teeb `sys.exit`-i veateatega, mis nimetab õige nime. Vaikset fallbackit ei ole
enam üheski nimes. Vali viga on parem kui vaikselt valede õigustega server.

**3. Üks fail masina kohta: `.env`.** `.env.local` kaob. Selle ainus eelis oli
gitignore, aga `.gitignore` katab mõlemat. `vite.config.ts` ei loe `.env`-i
enam üldse (`loadEnv` eemaldatud) — kliendile mõeldud seaded tulevad
`VITE_`-prefiksiga `import.meta.env` kaudu.

**4. `.env.example` on gitis** ja on ainus koht, kus nimed on dokumenteeritud —
väärtusteta, kommentaariga „kes loeb".

**5. Saladusi frontendi ei süstita.** `vite.config.ts`-is ei ole `define`-plokki.

## Tagajärjed

- Serveri `.env` ja `config.py` muudatus peavad minema **samas deploy'is** —
  vana nimi peatab backendi. See on tahtlik: ebaõnnestumine on kohene ja
  loetav, mitte hiljem ja vaikne.
- `MEILI_SEARCH_API_KEY`, `MEILI_API_KEY`, `VITE_MEILI_SEARCH_API_KEY`,
  `MEILISEARCH_URL`, `MEILISEARCH_MASTER_KEY` on kustutatud kõikjalt.
  `tests/test_env_names.py` skaneerib repo ja kukub, kui mõni tagasi tuleb.
- Uue seade lisamine: nimi `.env.example`-isse **ja** lugemine `config.env()`
  kaudu. Teist nime samale väärtusele ei looda — kui integratsioon nõuab oma
  nime (nagu MCP), dokumenteeri see erandina siin.

## Alternatiivid

**Jätta fallback-ahelad ja lisada ainult `.env.example`.** Odavam, aga jätab
alles täpselt selle mehhanismi, mis vea peitis: vale nimi töötaks edasi ja
`MEILI_SEARCH_API_KEY` suunaks endiselt otsinguvõtme master-pesasse.

**Ühtne nimeprefiks (`VUTT_*`) kõigile.** Järjekindlam, aga nõuaks ka
Meilisearchi enda konteineri muutujate ümbernimetamist docker-compose'is ja
tooks migratsiooni, mis ei lahenda ühtki tegelikku segadust.
