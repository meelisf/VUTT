# ADR 0046 — Sessioon on kutsuja õiguste ainus tõde; tokenit loeb ainult `deps.py`

**Kuupäev:** 2026-09-23
**Staatus:** vastu võetud
**Seotud:** ADR 0031 (kirjutamisõigus = lugemisõigus JA ulatus), ADR 0043 (ühised õigustoimingud)
**Issue:** #356

## Kontekst

Päringu kutsujat luges kolm funktsiooni ja nad erinesid kolmel teljel:

| Telg | `deps.get_user` | `deps.optional_user` | `prosopography._get_user` |
|---|---|---|---|
| Kust token | päis → query | ainult päis | päis → **JSON-keha** → query |
| Puudumisel | 401 | `None` | 401 |
| Kasutaja kuju | sessiooni hetktõmmis | hetktõmmis + **värske** `allowed_collections` `users.json`-ist, **ilma 24 h aegumiseta** | sessiooni hetktõmmis |

Kaks tõeallikat (sessioon vs `users.json`) andsid sama tokeni peale eri vastuse
alati, kui mõni õigusvälja kirjutus sessiooni ei katkestanud — nii oli kogu
kustutamisega kuni ADR 0043-ni. Keha-kanalil ei olnud mõõdetult ühtki elavat
kutsujat; kliendi kolm `auth_token` välja (`workApi.ts`, `/works/bulk-*`) olid
surnud payload. Sama kuju („saladus elab domeeni-payloadis") tegi võimalikuks
#237.

## Otsus

1. **Sessioon on õiguste ainus tõde.** `get_user` ja `optional_user` tagastavad
   sama `require_token` tulemuse (hetktõmmis + aegumiskontroll); erineb ainult
   puudumise käitumine (401 vs `None`). `optional_user` tagastab koopia.
2. **Iga `allowed_collections` / `edit_collections` kirjutus katkestab muutunud
   kasutaja sessioonid** — luku väljas, üks kord kasutaja kohta (ADR 0043 muster).
   Sellel reeglil seisab punkt 1.
3. **Tokenit loeb ainult `server/deps.py`.** Prosopograafia `_get_user`,
   `_require_role` ja `_get_json` on kustutatud; JSON-keha ei ole
   autentimiskanal.

Teist varianti (`users.json` on tõde, sessioon ainult identiteet) ei valitud:
see oleks turvavõrk, mis teeb invalideerimise unustamise nähtamatuks, ja jätaks
alles kaks allikat, mis juba korra lahknesid.

## Tagajärjed

- Uus õigusvälja kirjutustee PEAB kutsuma `delete_user_sessions`-it. Valvur:
  `tests/test_oigusvalja_kirjutus_katkestab_sessiooni.py` (struktuurne;
  põhjendatud erandid: uus konto, kutsuja-invalideeriv abifunktsioon).
- Otse käsitsi muudetud `users.json` ei mõju enne sessiooni lõppu (≤ 24 h)
  või uut sisselogimist.
- Valvurid: `tests/test_token_lugeja_uks_reegel.py` (routeris ei loeta tokenit),
  `tests/test_deps.py` (kaks lugejat annavad sama kasutaja).
