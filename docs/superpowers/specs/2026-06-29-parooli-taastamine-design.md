# Parooli taastamine (admini-algatatud) — disain

**Kuupäev:** 2026-06-29
**Staatus:** disain kinnitatud, ootab implementatsiooniplaani

## Probleem

Praegu pole parooli taastamist. Kui kasutaja kaotab parooli ära, peab ta uuesti
registreeruma. Admin peaks saama genereerida olemasolevale kasutajale parooli
taastamise lingi, kopeerida selle ja saata kasutajale käsitsi.

## Ulatus

- **Ainult admin algatab.** Lõpp-kasutaja iseteenindust ("unustasin parooli") esialgu
  EI tee (kuna automaatset e-kirja pole — see tekitaks adminile nähtamatu järjekorra).
- **Kohaletoimetamine käsitsi:** admin kopeerib lingi ja saadab ise (nt e-postiga),
  sama muster nagu praegune invite-voog.
- **SMTP-valmidus:** token-genereerimine hoitakse lahus kohaletoimetamisest, et hiljem
  saaks lisada automaatse e-kirja kihi (ka registreerimistele) ilma core-loogikat muutmata.

## Valitud lähenemine

**Eraldi reset-token + olemasoleva `SetPassword` lehe taaskasutus.** Peegeldab juba
toimivat ja testitud invite-mustrit (`registration.py`), kuid hoiab kaks semantiliselt
erinevat voogu lahus:
- **Invite** = loo UUS kasutaja (kasutajanime arvutus, kasutaja loomine).
- **Reset** = muuda OLEMASOLEVAT kasutajat (leia kasutaja, vaheta parool, invalideeri
  sessioonid).

Tagasi lükatud:
- **B (laienda `invite_tokens.json` `type` väljaga):** segaks kaks voogu ühte funktsiooni,
  invite- ja reset-loogika põimuksid — riskantsem, raskem testida.
- **C (admin seab parooli otse):** admin näeks parooli (halb tava), kasutaja ei vali ise,
  ei sobi "saadan lingi" mudeliga.

## Komponendid

### 1. Backend — token-moodul (`server/password_reset.py`)

Uus moodul `registration.py` mustri järgi. Tokenid `state/reset_tokens.json` (runtime,
EI ole gitis — nagu `invite_tokens.json`). Luuakse esimesel kasutusel automaatselt.

Token-kirje:
```json
{
  "token": "<uuid4>",
  "username": "<olemasolev kasutaja>",
  "created_at": "...",
  "expires_at": "...",
  "created_by": "<admin username>",
  "used": false
}
```

Aegumine: `created_at + 24h` (lühem kui invite 48h — turvalisem).

Funktsioonid:
- `create_reset_token(username, created_by)` — kontrollib, et kasutaja on olemas;
  **passiivne puhastus:** eemaldab failist kirjed, mille `expires_at` on > 7 päeva vana
  (hoiab faili väikese ilma croonita); **invalideerib sama kasutaja varasemad kasutamata
  reset-tokenid** (üks aktiivne korraga); loob uue. Olematu kasutaja → viga.
- `validate_reset_token(token)` → `(token_data, error)` — kehtivuse kontroll (olemas,
  mitte kasutatud, mitte aegunud).
- `_validate_and_consume_token(token)` — atomaarne consume (lukuga, `used=True` +
  `used_at`) + `_unconsume_token(token)` rollback (peegeldab invite'i).

**Konkurentsus / faililukud:** moodul kasutab oma `reset_tokens_lock` (`threading.RLock`)
ja `atomic_write_json` (write-to-temp-and-rename) — sama muster nagu `registration.py`.
Server jookseb single-worker uvicorniga, seega threading-lukk on piisav; portalocker'i
(mitme protsessi lukk) pole vaja. `complete_password_reset` puudutab kahte faili kahe
eri lukuga: KÕIGEPEALT consume `reset_tokens.json` (`reset_tokens_lock`), SEEJÄREL
`save_users` (`users_lock`); kui kasutaja salvestus ebaõnnestub → `_unconsume_token`
rollback (nagu invite'is).
- `complete_password_reset(token, new_password)`:
  1. `validate_password_strength(new_password)` (taaskasuta `registration.py`-st).
  2. Atomaarne consume.
  3. Sea uus bcrypt-hash (`hash_password`) olemasolevale kasutajale, `save_users`.
  4. **Invalideeri kasutaja kõik aktiivsed sessioonid** (`delete_user_sessions` —
     sunnib uue parooliga uuesti sisse logima).
  5. Salvestamise ebaõnnestumisel → `_unconsume_token` rollback.

**Turvainvariant:** lingi genereerimisel vana parool EI muutu ja sessioonid jäävad alles
— parool vahetub alles siis, kui kasutaja lingi kaudu uue seab. Nii ei lukusta admin
kogemata kasutajat välja.

### 2. Backend — endpointid

`server/routers/admin.py` (admin-õigus, `require_role("admin")`):
- `POST /admin/users/reset-password` — body `{username}`.

  **Privileegide kontroll (kaitse eskaleerumise eest):** admin EI tohi lähtestada endast
  kõrgema VÕI võrdse privileegiga kasutajat, v.a iseendale. Rolli-hierarhia
  `{contributor:0, editor:1, admin:2}`:
  - admin saab lähtestada iseennast (sh enda parooli);
  - admin saab lähtestada madalama rolli (editor, contributor);
  - admin EI saa lähtestada teist admini (võrdne) → 403.

  Seetõttu jääb `meelis` (samuti `admin`-roll) kaitstuks üldreegli kaudu — teine admin ei
  saa tema parooli lähtestada, ainult ta ise. Eraldi `meelis`-hardcode'i pole vaja
  (erinevalt `update_user_role`/`delete_user`-ist). Tagastab:
  ```json
  { "status": "success",
    "reset_url": "/set-password?token=<uuid>&reset=1",
    "expires_at": "...",
    "username": "...", "name": "..." }
  ```

`server/routers/auth.py` (avalik, rate-limited):
- `GET /reset/{token}` — valideerib, tagastab `{status, valid, username, name, expires_at}`.
  Töötab ainult kehtiva tokeniga; ei lekita rohkem kui vaja.
  **Rate-limited** (`get_client_ip` + `check_rate_limit`) — väldib tokenite brute-force'imist
  ja kasutajanime lekkimist. NB: see on teadlik parandus invite-mustri suhtes — olemasolev
  `GET /invite/{token}` (`check_invite`) EI ole praegu rate-limited.
- `POST /reset/set-password` — body `{token, password}`, kutsub `complete_password_reset`.
  Rate-limit: `get_client_ip` + `check_rate_limit` (sama muster nagu `/invite/set-password`).

Aegunud tokenite eraldi koristust pole vaja (passiivne puhastus toimub `create_reset_token`-is,
vt eespool — valideerimisel hüljatakse niikuinii).

### 3. Frontend

**`src/pages/admin/Users.tsx`** — "Tegevused" veergu lisandub "Taasta parool" nupp
(`KeyRound` ikoon, kustutusnupu kõrvale). **Nähtav ainult lubatud sihtmärkidele:**
madalama rolliga kasutaja (editor/contributor) VÕI iseenda rida; teiste adminite real
nuppu ei kuvata (peegeldab backend-i privileegikontrolli — backend on autoriteet, UI
ainult peidab). Nupp:
- Klikk → `POST /admin/users/reset-password` → modaal/inline-paneel näitab täislinki
  (`window.location.origin + reset_url`) + "Kopeeri link" nupp (sama muster nagu
  `Registrations.tsx` invite-lingi puhul, `linkCopied` state).
- Näitab aegumisaega ("Link kehtib 24h"). Eraldi kinnitusastet pole vaja (ohutu).

**`src/pages/SetPassword.tsx`** — taaskasutame. Reset-režiim tuvastatakse
`searchParams.get('reset') === '1'` järgi:
- Reset: `GET /reset/{token}` valideerimiseks, `POST /reset/set-password` submitiks.
- Invite (senine): `GET /invite/{token}` + `POST /invite/set-password`.
- Tekstid kohanduvad: invite = "Tere tulemast!", reset = "Sea uus parool".
- Uued i18n võtmed `et`/`en` (`register.json`, kus SetPassword tekstid praegu elavad —
  kinnitada implementeerimisel).

**Teenusekiht** — endpointid olemasoleva `apiPost`/`fetchWithTimeout` kaudu, uut teenust
pole vaja.

## Turvalisus

- Reset-token = UUID4 (sama entroopia kui invite/sessioon).
- Token ühekordne (`used` + atomaarne consume + rollback).
- Parooli vahetusel invalideeritakse kasutaja sessioonid.
- Vana token sama kasutaja kohta tühistatakse uue genereerimisel.
- **Privileegide eskaleerumise kaitse:** admin ei saa lähtestada võrdse/kõrgema privileegiga
  kasutajat (sh teist admini ega `meelis`-t) — ainult madalamaid ja iseennast.
- **Rate-limit MÕLEMAL avalikul endpointil** — nii `GET /reset/{token}` kui
  `POST /reset/set-password`.
- Avalik `GET /reset/{token}` töötab ainult kehtiva tokeniga.

## Aktsepteeritud piirangud

- **Admini self-lockout:** kuna iseteenindust ("unustasin parooli") esialgu ei ole, peab
  parooli unustanud ja sisse logida mittesaaval adminil olema teine admin (kes genereerib
  lingi) VÕI otsene serveri-ligipääs (`state/users.json` käsitsi). Teadlik piirang kuni
  SMTP + iseteenindus lisatakse.

## SMTP-valmidus

`create_reset_token` ja `create_invite_token` jäävad puhtalt token-genereerivateks
(tagastavad token-andmed). Kohaletoimetamine on kutsuja vastutus. Hiljem lisandub eraldi
`send_reset_email(token_data)` kiht endpointi sisse, ilma core-loogikat muutmata.

## Testid

`tests/test_password_reset.py` (`.venv/bin/python -m pytest`):
- Token loomine kehtivale kasutajale.
- Olematu kasutaja → viga.
- `validate_reset_token`: kehtiv, aegunud, kasutatud, olematu.
- Atomaarne consume (üks edukas, teine "juba kasutatud").
- Varasema tokeni tühistamine uue loomisel.
- Passiivne puhastus: > 7 päeva vanad kirjed eemaldatakse uue tokeni loomisel.
- `complete_password_reset`: muudab bcrypt-hashi + invalideerib sessioonid.
- Parooli-tugevuse keeldumine (lühike / liiga lihtne).
- Salvestamise rollback (`_unconsume_token`).
- **Privileegide kontroll** (endpoint-tasandil): admin → editor/contributor OK; admin →
  teine admin 403; admin → iseennast OK.
- **Rate-limit** GET `/reset/{token}` ja POST `/reset/set-password` (vajadusel testitav,
  kui rate-limit on testikeskkonnas aktiivne).

Olemasolevat invite-voogu need ei puuduta (eraldi moodul + hoidla).

## Deploy

- Backend: `git pull && docker compose build --no-cache backend && docker compose up -d backend`.
- Frontend: `npm run typecheck` → `npm run build` → `rsync -avz dist/ vutt:~/VUTT/dist/`.
- `state/reset_tokens.json` luuakse esimesel kasutusel automaatselt.
