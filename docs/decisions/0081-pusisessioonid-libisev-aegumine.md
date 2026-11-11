# 0081 — Püsisessioonid ja libisev aegumine

**Staatus:** vastu võetud 2026-11-11
**Seotud:** ADR 0046 (sessioon on õiguste ainus tõde), ADR 0002 (blokeeriv I/O `async def` sees)
**Issue:** #761

## Kontekst

`server/auth.py` hoidis sessioone ainult mälus. Iga backend-deploy või restart logis
kõik toimetajad välja; 2026-11-11 tehti kolm backend-deploy'd ja igaüks katkestas kõigi
töö. Lisaks loeti 24 h `created_at`-ist, mitte viimasest tegevusest: toimetaja kukkus
välja keset tööd, sõltumata sellest, kas ta oli aktiivne.

## Otsus

1. **Püsikiht `state/sessions.json`.** Võti on tokeni SHA-256 (`token_key`), mitte
   toortoken — ka mälus. Faili lugeja ei saa sessiooni üle võtta. Käivitusel laetakse
   kehtivad kirjed (`load_persisted_sessions`, lifespan'is enne esimest päringut);
   vigane fail või kirje → jäetakse välja (fail-closed: uus sisselogimine).
2. **Libisev aegumine ülempiiriga.** Sessioon aegub, kui viimasest autenditud
   päringust on möödas üle `SESSION_IDLE_TIMEOUT` (24 h) VÕI sisselogimisest üle
   `SESSION_MAX_AGE` (14 päeva). Tegevus = iga `require_token`-i läbiv päring, sh
   `UserContext`-i 5-minutiline `verify-token` — lahtine vahekaart hoiab sessiooni
   elus kuni ülempiirini. See on teadlik: toimetaja, kes jätab töölaua lahti, ei
   kaota tööd; 14 päeva lagi piirab varastatud tokeni eluiga.
3. **Kirjutusreeglid.**
   - Loomine, logout ja `delete_user_sessions` kirjutavad kettale **kohe**.
     Äravõetud sessioon ei tohi restardi järel kettalt tagasi tulla — ADR 0046 p 2
     kehtib ka püsikihile.
   - `last_seen` uueneb päringu teel **ainult mälus** (`get_user` on `async def`;
     kettale kirjutamine seal rikuks ADR 0002) ja mitte sagedamini kui kord minutis.
     Taustalõim kirjutab ta iga 60 s järel ja lifespan sulgemisel (`flush_sessions`).
     Restart kaotab halvimal juhul ≤ 60 s tegevusaega — see ei lühenda sessiooni
     märgatavalt.
   - Kirjutajad järjestatakse `_persist_lock`-iga ja iga kirjutaja võtab hetktõmmise
     selle luku SEES (versiooniloendur): vanem tõmmis ei saa uuemat üle kirjutada.
     `_sessions_lock`-i ei hoita kettale kirjutamise ajal.
   - Kettale kirjutavad muutjad (`create_session`, `delete_session`,
     `delete_user_sessions`) jooksevad threadpool'is; `async` ruuterid kutsuvad neid
     `run_in_threadpool`-iga.
4. **Sessiooni kirje** = `{user, created_at, last_seen}`. `user` on endiselt
   hetktõmmis (ADR 0046 p 1); püsikiht ei muuda seda.

Ei valitud: Redis või SQLite. Üks uvicorn-worker ja kümned sessioonid — väike JSON
atomaarse kirjutusega on piisav ja ei lisa teenust. Mitme workeri korral (CLAUDE.md
„Skaleerimine") tuleb see otsus üle vaadata: protsessi-lokaalne mälu ja failikirjutus
ei sünkroniseeru workerite vahel.

## Tagajärjed

- Deploy ei logi välja. Toimetaja logib uuesti sisse alles 24 h tegevusetuse või
  14 päeva järel.
- ADR 0046 tagajärg „käsitsi muudetud `users.json` ei mõju enne sessiooni lõppu
  (≤ 24 h)" muutub: kuni 14 päeva. Õiguste muutmine käib endiselt haldusvaate kaudu,
  mis katkestab sessiooni kohe.
- `state/sessions.json` läheb varukoopiasse (`state/` tervikuna, kaust 700). Taaste
  toob kaasa varunduse hetke sessioonid; need aeguvad oma reeglite järgi.
- `SESSION_DURATION` on asendatud `SESSION_IDLE_TIMEOUT` + `SESSION_MAX_AGE`-ga.
- Valvurid: `tests/test_session_persistence.py` (restart, kohene äravõtt, logout,
  libisev aegumine, lagi, päringu tee ei kirjuta ketast, vigane fail, kirjutustõrge),
  `tests/test_oigusvalja_kirjutus_katkestab_sessiooni.py` (ADR 0046).
